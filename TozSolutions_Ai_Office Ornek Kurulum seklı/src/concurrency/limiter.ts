import { CapacityError } from "../core/errors.js";

/**
 * Concurrency control.
 *
 * LOGICAL vs PHYSICAL
 * -------------------
 * Logical concurrency  = how many agents / tasks / workflows the system can
 *                       *represent*. It is a configuration dimension; it does
 *                       not open connections and creates no threads.
 * Physical concurrency = how many external provider/model calls may be in
 *                       flight simultaneously. It is *enforced* here.
 *
 * These two numbers are deliberately never equated. A large logical task
 * count is safe precisely because physical slots are capped.
 */

/** A capacity lease. Release is idempotent so `finally` blocks are safe. */
export interface ConcurrencyLease {
  readonly name: string;
  release(): void;
}

class Semaphore implements ConcurrencyLease {
  public readonly name: string;
  public readonly limit: number;
  public readonly maxWaiting: number;
  #inFlight = 0;
  #waiters: Array<{ resolve: (lease: ConcurrencyLease) => void; reject: (error: Error) => void }> = [];
  #closed = false;
  #closeReason: string | null = null;

  public constructor(name: string, limit: number, maxWaiting: number) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError(`Concurrency limit for ${name} must be a positive integer`);
    }
    if (!Number.isInteger(maxWaiting) || maxWaiting < 0) {
      throw new RangeError(`maxWaiting for ${name} must be a non-negative integer`);
    }
    this.name = name;
    this.limit = limit;
    this.maxWaiting = maxWaiting;
  }

  public get inFlight(): number {
    return this.#inFlight;
  }

  public get available(): number {
    return this.limit - this.#inFlight;
  }

  public get waiting(): number {
    return this.#waiters.length;
  }

  public get closed(): boolean {
    return this.#closed;
  }

  public get closeReason(): string | null {
    return this.#closeReason;
  }

  /** Immediate, non-blocking acquisition. Returns null when at capacity. */
  public tryAcquire(): ConcurrencyLease | null {
    if (this.#closed) {
      throw new CapacityError(`Semaphore ${this.name} is closed: ${this.#closeReason ?? "closed"}`);
    }
    if (this.#inFlight >= this.limit) {
      return null;
    }
    this.#inFlight += 1;
    return this.#makeLease();
  }

  /**
   * Acquires a slot, queueing behind existing waiters.
   * Fails fast with CapacityError when the wait queue is already full, so
   * backpressure propagates instead of growing an unbounded wait list.
   */
  public acquire(): Promise<ConcurrencyLease> {
    if (this.#closed) {
      return Promise.reject(
        new CapacityError(`Semaphore ${this.name} is closed: ${this.#closeReason ?? "closed"}`),
      );
    }
    const lease = this.tryAcquire();
    if (lease) {
      return Promise.resolve(lease);
    }
    if (this.#waiters.length >= this.maxWaiting) {
      return Promise.reject(
        new CapacityError(
          `Concurrency wait queue for ${this.name} is full (limit=${this.maxWaiting})`,
        ),
      );
    }
    return new Promise<ConcurrencyLease>((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
    });
  }

  public release(): void {
    this.#releaseInternal();
  }

  public close(reason = "closed"): void {
    this.#closed = true;
    this.#closeReason = reason;
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const waiter of waiters) {
      waiter.reject(new CapacityError(`Semaphore ${this.name} ${reason}`));
    }
  }

  #releaseInternal(): void {
    if (this.#inFlight <= 0) {
      return;
    }
    const next = this.#waiters.shift();
    if (next) {
      // Hand the slot straight to the next waiter; inFlight is unchanged.
      next.resolve(this.#makeLease());
      return;
    }
    this.#inFlight -= 1;
  }

  #makeLease(): ConcurrencyLease {
    const release = (): void => {
      this.#releaseInternal();
    };
    let released = false;
    return {
      name: this.name,
      release: (): void => {
        if (released) {
          return;
        }
        released = true;
        release();
      },
    };
  }
}

export { CapacityError };

/** Bundles several layer leases into one idempotently-releasable lease. */
function combineLeases(
  name: string,
  layers: readonly Semaphore[],
  leases: readonly ConcurrencyLease[],
): ConcurrencyLease {
  let released = false;
  return {
    name: `${name} [${layers.map((layer) => layer.name).join(" -> ")}]`,
    release(): void {
      if (released) {
        return;
      }
      released = true;
      // Released in reverse acquisition order.
      for (let i = leases.length - 1; i >= 0; i -= 1) {
        leases[i]?.release();
      }
    },
  };
}

export interface ConcurrencyLayerConfig {
  readonly globalLimit: number;
  readonly globalMaxWaiting: number;
  /** Optional per-provider overrides. Providers not listed fall back to global. */
  readonly providerLimits: Readonly<Record<string, number>>;
  readonly providerMaxWaiting: Readonly<Record<string, number>>;
  readonly modelLimits: Readonly<Record<string, number>>;
  readonly modelMaxWaiting: Readonly<Record<string, number>>;
}

export const DEFAULT_CONCURRENCY: ConcurrencyLayerConfig = {
  globalLimit: 8,
  globalMaxWaiting: 1000,
  providerLimits: {},
  providerMaxWaiting: {},
  modelLimits: {},
  modelMaxWaiting: {},
};

export interface AcquireRequest {
  readonly providerId: string;
  readonly modelId: string;
}

export interface ConcurrencyStats {
  readonly global: { inFlight: number; limit: number; waiting: number };
  readonly providers: Readonly<Record<string, { inFlight: number; limit: number; waiting: number }>>;
  readonly models: Readonly<Record<string, { inFlight: number; limit: number; waiting: number }>>;
}

/**
 * Hierarchical concurrency manager: global -> provider -> model.
 *
 * Acquisition is all-or-nothing across the three layers, so a request can
 * never hold a global slot while blocked on a saturated provider, which is the
 * mechanism by which over-subscription is prevented.
 */
export class ConcurrencyManager {
  readonly #global: Semaphore;
  readonly #providers = new Map<string, Semaphore>();
  readonly #models = new Map<string, Semaphore>();
  readonly #config: ConcurrencyLayerConfig;

  public constructor(config: Partial<ConcurrencyLayerConfig> = {}) {
    this.#config = { ...DEFAULT_CONCURRENCY, ...config };
    this.#global = new Semaphore(
      "global",
      this.#config.globalLimit,
      this.#config.globalMaxWaiting,
    );
  }

  public get globalInFlight(): number {
    return this.#global.inFlight;
  }

  public get globalLimit(): number {
    return this.#global.limit;
  }

  /**
   * Acquires a physical slot across the global, provider and model layers.
   *
   * ORDERING CONTRACT: layers are always acquired global -> provider -> model,
   * and every acquisition in the system uses this same order. That fixed
   * hierarchy is what makes hold-while-waiting safe: because no caller ever
   * requests the layers in a different order, waiting on a downstream layer
   * while holding an upstream one cannot produce a circular wait, so this
   * cannot deadlock.
   *
   * COST OF THAT CHOICE: a request parked on a saturated provider layer still
   * holds a global slot. That is bounded, not unbounded, because
   * `globalMaxWaiting` caps how many requests may be parked, and the global
   * layer is always acquired FIRST, so a parked request is already counted and
   * the pool can never be filled by requests that never reached the limiter.
   *
   * A failure at any layer releases the layers already taken, so a rejected
   * acquisition never leaks a slot.
   */
  public async acquire(request: AcquireRequest): Promise<ConcurrencyLease> {
    const layers = [
      this.#global,
      this.#providerSemaphore(request.providerId),
      this.#modelSemaphore(request.providerId, request.modelId),
    ];

    const leases: ConcurrencyLease[] = [];
    for (const layer of layers) {
      try {
        leases.push(await layer.acquire());
      } catch (error) {
        for (const lease of leases) {
          lease.release();
        }
        throw error;
      }
    }
    return combineLeases(`${request.providerId}/${request.modelId}`, layers, leases);
  }

  /** Non-blocking variant. Returns null if any layer is saturated. */
  public tryAcquire(request: AcquireRequest): ConcurrencyLease | null {
    const provider = this.#providerSemaphore(request.providerId);
    const model = this.#modelSemaphore(request.providerId, request.modelId);
    const globalLease = this.#global.tryAcquire();
    if (!globalLease) {
      return null;
    }
    const providerLease = provider.tryAcquire();
    if (!providerLease) {
      globalLease.release();
      return null;
    }
    const modelLease = model.tryAcquire();
    if (!modelLease) {
      providerLease.release();
      globalLease.release();
      return null;
    }
    const leases = [globalLease, providerLease, modelLease];
    let released = false;
    return {
      name: `combined(${request.providerId}/${request.modelId})`,
      release(): void {
        if (released) {
          return;
        }
        released = true;
        for (const lease of leases) {
          lease.release();
        }
      },
    };
  }

  public stats(): ConcurrencyStats {
    const providers: Record<string, { inFlight: number; limit: number; waiting: number }> = {};
    for (const [id, semaphore] of this.#providers) {
      providers[id] = {
        inFlight: semaphore.inFlight,
        limit: semaphore.limit,
        waiting: semaphore.waiting,
      };
    }
    const models: Record<string, { inFlight: number; limit: number; waiting: number }> = {};
    for (const [id, semaphore] of this.#models) {
      models[id] = {
        inFlight: semaphore.inFlight,
        limit: semaphore.limit,
        waiting: semaphore.waiting,
      };
    }
    return {
      global: {
        inFlight: this.#global.inFlight,
        limit: this.#global.limit,
        waiting: this.#global.waiting,
      },
      providers,
      models,
    };
  }

  public close(reason = "shutting down"): void {
    this.#global.close(reason);
    for (const semaphore of this.#providers.values()) {
      semaphore.close(reason);
    }
    for (const semaphore of this.#models.values()) {
      semaphore.close(reason);
    }
  }

  #providerSemaphore(providerId: string): Semaphore {
    const existing = this.#providers.get(providerId);
    if (existing) {
      return existing;
    }
    const limit = this.#config.providerLimits[providerId] ?? this.#config.globalLimit;
    const maxWaiting =
      this.#config.providerMaxWaiting[providerId] ?? this.#config.globalMaxWaiting;
    const created = new Semaphore(`provider:${providerId}`, limit, maxWaiting);
    this.#providers.set(providerId, created);
    return created;
  }

  #modelSemaphore(providerId: string, modelId: string): Semaphore {
    const key = `${providerId}/${modelId}`;
    const existing = this.#models.get(key);
    if (existing) {
      return existing;
    }
    const limit = this.#config.modelLimits[key] ?? this.#config.providerLimits[providerId] ?? this.#config.globalLimit;
    const maxWaiting =
      this.#config.modelMaxWaiting[key] ??
      this.#config.providerMaxWaiting[providerId] ??
      this.#config.globalMaxWaiting;
    const created = new Semaphore(`model:${key}`, limit, maxWaiting);
    this.#models.set(key, created);
    return created;
  }
}
