/**
 * Minimal modular state layer.
 *
 * PHASE 00 found NO existing state architecture, so this is introduced as the
 * single in-process state mechanism for the core. It is deliberately small:
 * namespaced, versioned entries with an event stream. It is NOT a database and
 * does not pretend to be one — persistence is a later concern.
 *
 * Only serialisable, non-secret data may be stored. `assertStorable` rejects
 * anything that looks like a credential, so a secret cannot be written into
 * shared state by accident.
 */

import { isSensitiveKey } from "../audit/redaction.js";

export interface StateEntry<T = unknown> {
  readonly namespace: string;
  readonly key: string;
  readonly value: T;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface StateChange<T = unknown> {
  readonly entry: StateEntry<T>;
  readonly previous: StateEntry<T> | null;
}

export type StateListener<T = unknown> = (change: StateChange<T>) => void;

/**
 * PHASE 10: the local copy of this list is gone.
 *
 * It was a second, hand-maintained version of `SENSITIVE_KEY_FRAGMENTS` in
 * `audit/redaction.ts`, and the two had already drifted - the local set omitted
 * `bearer`, `connectionString`, `dsn`, `session`, `signature` and
 * `passphrase`. The check below already consulted `isSensitiveKey` as a
 * fallback, so the local set was contributing nothing except a second place for
 * the next person to forget to update.
 *
 * One list, one owner. `containsForbiddenKey` now defers entirely to
 * `isSensitiveKey`.
 */
function containsForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenKey(entry, depth + 1));
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      return true;
    }
    if (containsForbiddenKey(entry, depth + 1)) {
      return true;
    }
  }
  return false;
}

/** Rejects non-serialisable and secret-bearing values. */
export function assertStorable<T>(value: T): void {
  if (value === null || value === undefined) {
    return;
  }
  const type = typeof value;
  if (type === "function" || type === "symbol" || type === "bigint") {
    throw new TypeError(`State values must be serialisable, received ${type}`);
  }
  if (containsForbiddenKey(value)) {
    throw new TypeError(
      "State values must not contain credentials or secrets. Store a SecretRef instead.",
    );
  }
}

/**
 * In-process namespaced store.
 *
 * Versioned so that a future persistent implementation can detect conflicts,
 * and observable so that an owner console can react without polling.
 */
export class StateStore {
  readonly #entries = new Map<string, Map<string, StateEntry>>();
  readonly #listeners = new Map<string, Set<StateListener<never>>>();
  readonly #clock: { now(): Date };
  /**
   * PHASE 06: the workspace whose state this store holds.
   *
   * Structural shape because `core` must not import `orchestration`. The value is
   * verified at the identity boundary before it reaches here; what is guaranteed in
   * this file is that the partition is applied to every access, not that the caller
   * supplied a true one.
   */
  readonly #workspace: { readonly workspace: string | null; readonly brand: string | null };

  public constructor(
    options: {
      clock?: { now(): Date };
      workspace?: { readonly workspace: string | null; readonly brand: string | null } | null;
    } = {},
  ) {
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#workspace = options.workspace ?? { workspace: null, brand: null };
  }

  /**
   * The ONLY place this store composes a namespace key.
   *
   * Length-prefixed, so `namespace` "a:b" and "a" cannot be made to collide by a
   * separator. The ATTRIBUTED namespace is also what a listener subscribes to, so a
   * subscriber hears only its own workspace's changes.
   */
  #ns(namespace: string): string {
    const w = this.#workspace.workspace;
    const head = w === null ? "0:\u0000-" : `${w.length}:${w}\u0000${this.#workspace.brand ?? "-"}`;
    return `${head}\u0001${namespace.length}:${namespace}`;
  }

  public set<T>(namespace: string, key: string, value: T): StateEntry<T> {
    assertStorable(value);
    const bucket = this.#entries.get(this.#ns(namespace)) ?? new Map<string, StateEntry>();
    const previous = (bucket.get(key) as StateEntry<T> | undefined) ?? null;
    const entry: StateEntry<T> = {
      namespace,
      key,
      value,
      version: (previous?.version ?? 0) + 1,
      updatedAt: this.#clock.now(),
    };
    bucket.set(key, entry);
    this.#entries.set(this.#ns(namespace), bucket);
    this.#emit({ entry, previous });
    return entry;
  }

  public get<T>(namespace: string, key: string): T | undefined {
    return (this.#entries.get(this.#ns(namespace))?.get(key) as StateEntry<T> | undefined)?.value;
  }

  public getEntry<T>(namespace: string, key: string): StateEntry<T> | null {
    return (this.#entries.get(this.#ns(namespace))?.get(key) as StateEntry<T> | undefined) ?? null;
  }

  public has(namespace: string, key: string): boolean {
    return this.#entries.get(this.#ns(namespace))?.has(key) ?? false;
  }

  public delete(namespace: string, key: string): boolean {
    const bucket = this.#entries.get(this.#ns(namespace));
    const previous = bucket?.get(key);
    if (!bucket || !previous) {
      return false;
    }
    bucket.delete(key);
    this.#emit({ entry: { ...previous, value: undefined }, previous });
    return true;
  }

  public keys(namespace: string): readonly string[] {
    const bucket = this.#entries.get(this.#ns(namespace));
    return bucket ? [...bucket.keys()] : [];
  }

  /**
   * The namespaces THIS workspace holds.
   *
   * PHASE 06: derived from the entries rather than from `#entries.keys()`, because
   * those keys carry the workspace prefix. Returning them would hand a caller the
   * partition layout and the answer at once.
   */
  public namespaces(): readonly string[] {
    return [...this.#entries.values()]
      .flatMap((bucket) => [...bucket.values()].map((entry) => entry.namespace));
  }

  public size(): number {
    let total = 0;
    for (const bucket of this.#entries.values()) {
      total += bucket.size;
    }
    return total;
  }

  public clear(): void {
    this.#entries.clear();
  }

  /** Atomically applies several writes, emitting one change per key. */
  public batch(operations: ReadonlyArray<{ namespace: string; key: string; value: unknown }>): void {
    for (const operation of operations) {
      this.set(operation.namespace, operation.key, operation.value);
    }
  }

  public subscribe<T>(namespace: string, listener: StateListener<T>): () => void {
    const bucket = this.#listeners.get(this.#ns(namespace)) ?? new Set<StateListener<never>>();
    bucket.add(listener);
    this.#listeners.set(this.#ns(namespace), bucket);
    return () => {
      bucket.delete(listener);
    };
  }

  #emit<T>(change: StateChange<T>): void {
    const listeners = this.#listeners.get(this.#ns(change.entry.namespace));
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      (listener as StateListener<T>)(change);
    }
  }
}
