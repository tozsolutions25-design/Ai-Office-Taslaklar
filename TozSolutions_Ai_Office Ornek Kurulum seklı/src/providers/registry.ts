import { type Clock, systemClock } from "../core/clock.js";
import { err, ok, type Result } from "../core/result.js";
import { ValidationError } from "../core/errors.js";
import type { HealthObservation } from "../health/health.js";
import {
  type ApprovalStatus,
  type LifecycleState,
  ProviderLifecycle,
  isProductionEligible,
} from "./lifecycle.js";
import { type ProviderRecord, createProviderRecord, type ProviderRecordInput } from "./provider.js";

export class DuplicateProviderError extends Error {
  public readonly providerId: string;
  public constructor(providerId: string) {
    super(`Provider already registered: ${providerId}`);
    this.name = "DuplicateProviderError";
    this.providerId = providerId;
  }
}

export class UnknownProviderError extends Error {
  public readonly providerId: string;
  public constructor(providerId: string) {
    super(`Provider not found: ${providerId}`);
    this.name = "UnknownProviderError";
    this.providerId = providerId;
  }
}

export type RegistryError = ValidationError | DuplicateProviderError | UnknownProviderError;

/**
 * Provider registry.
 *
 * The single place a provider becomes part of the system. Holds only records
 * (never credentials) and a lifecycle position per provider. PHASE 01
 * contains NO registered providers: the registry starts empty and stays empty
 * until a real, human-approved integration is added.
 */
export class ProviderRegistry {
  readonly #records = new Map<string, ProviderRecord>();
  readonly #lifecycles = new Map<string, ProviderLifecycle>();
  readonly #clock: Clock;

  public constructor(options: { clock?: Clock } = {}) {
    this.#clock = options.clock ?? systemClock;
  }

  public get size(): number {
    return this.#records.size;
  }

  /**
   * Registers a new provider. Fails on duplicate ID — overwriting a provider
   * silently would hide configuration mistakes.
   */
  public register(
    input: Omit<ProviderRecordInput, "now"> & { lifecycleState?: LifecycleState },
  ): Result<ProviderRecord, RegistryError> {
    if (typeof input.providerId === "string" && this.#records.has(input.providerId)) {
      return err(new DuplicateProviderError(input.providerId));
    }
    const now = this.#clock.now();
    const built = createProviderRecord({ ...input, now });
    if (!built.ok) {
      return built;
    }
    this.#records.set(built.value.providerId, built.value);
    this.#lifecycles.set(built.value.providerId, new ProviderLifecycle(input.lifecycleState ?? "discovered"));
    return built;
  }

  public has(providerId: string): boolean {
    return this.#records.has(providerId);
  }

  public get(providerId: string): ProviderRecord | null {
    return this.#records.get(providerId) ?? null;
  }

  public require(providerId: string): Result<ProviderRecord, UnknownProviderError> {
    const record = this.#records.get(providerId);
    return record ? ok(record) : err(new UnknownProviderError(providerId));
  }

  public list(): readonly ProviderRecord[] {
    return [...this.#records.values()];
  }

  public lifecycleOf(providerId: string): ProviderLifecycle | null {
    return this.#lifecycles.get(providerId) ?? null;
  }

  public enable(providerId: string): Result<ProviderRecord, RegistryError> {
    return this.#mutate(providerId, (record) => ({ ...record, enabled: true, updatedAt: this.#clock.now() }));
  }

  public disable(providerId: string): Result<ProviderRecord, RegistryError> {
    return this.#mutate(providerId, (record) => ({ ...record, enabled: false, updatedAt: this.#clock.now() }));
  }

  public setApproval(providerId: string, approvalStatus: ApprovalStatus): Result<ProviderRecord, RegistryError> {
    return this.#mutate(providerId, (record) => ({
      ...record,
      approvalStatus,
      updatedAt: this.#clock.now(),
    }));
  }

  public setHealth(providerId: string, health: HealthObservation): Result<ProviderRecord, RegistryError> {
    return this.#mutate(providerId, (record) => ({ ...record, health, updatedAt: this.#clock.now() }));
  }

  /** Advances the lifecycle, failing if the edge is not declared legal. */
  public transition(
    providerId: string,
    to: LifecycleState,
  ): Result<{ record: ProviderRecord; lifecycle: LifecycleState }, RegistryError> {
    const lifecycle = this.#lifecycles.get(providerId);
    if (!lifecycle) {
      return err(new UnknownProviderError(providerId));
    }
    if (!lifecycle.canTransitionTo(to)) {
      return err(new ValidationError("Illegal provider lifecycle transition", [
        `${lifecycle.state} -> ${to} is not a legal transition`,
      ]));
    }
    lifecycle.transitionTo(to);
    const updated = this.#mutate(providerId, (record) => ({
      ...record,
      approvalStatus: lifecycle.approvalStatus,
      updatedAt: this.#clock.now(),
    }));
    if (!updated.ok) {
      return updated;
    }
    return ok({ record: updated.value, lifecycle: lifecycle.state });
  }

  /** Providers eligible to receive production traffic. */
  public productionPool(): readonly ProviderRecord[] {
    return this.list().filter((record) => {
      const lifecycle = this.#lifecycles.get(record.providerId);
      return lifecycle
        ? isProductionEligible(lifecycle.state, record.enabled, record.approvalStatus)
        : false;
    });
  }

  /** Retires and removes a provider. Removal is a lifecycle event, not a silent delete. */
  public retire(providerId: string): Result<ProviderRecord, RegistryError> {
    const lifecycle = this.#lifecycles.get(providerId);
    if (!lifecycle) {
      return err(new UnknownProviderError(providerId));
    }
    if (lifecycle.state !== "retired") {
      if (!lifecycle.canTransitionTo("retired")) {
        return err(new ValidationError("Illegal provider lifecycle transition", [
          `${lifecycle.state} -> retired is not a legal transition`,
        ]));
      }
      lifecycle.transitionTo("retired");
    }
    const record = this.#records.get(providerId);
    this.#records.delete(providerId);
    return record ? ok(record) : err(new UnknownProviderError(providerId));
  }

  #mutate(
    providerId: string,
    fn: (record: ProviderRecord) => ProviderRecord,
  ): Result<ProviderRecord, RegistryError> {
    const existing = this.#records.get(providerId);
    if (!existing) {
      return err(new UnknownProviderError(providerId));
    }
    const next = fn(existing);
    this.#records.set(providerId, next);
    return ok(next);
  }
}
