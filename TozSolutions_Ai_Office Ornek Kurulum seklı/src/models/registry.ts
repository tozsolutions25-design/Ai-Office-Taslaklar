import { type Clock, systemClock } from "../core/clock.js";
import type { ValidationError } from "../core/errors.js";
import { err, ok, type Result } from "../core/result.js";
import type { HealthObservation } from "../health/health.js";
import type { ApprovalStatus } from "../providers/lifecycle.js";
import {
  type ModelRecord,
  type ModelRecordInput,
  createModelRecord,
  modelKey,
} from "./model.js";

export class DuplicateModelError extends Error {
  public readonly key: string;
  public constructor(key: string) {
    super(`Model already registered: ${key}`);
    this.name = "DuplicateModelError";
    this.key = key;
  }
}

export class UnknownModelError extends Error {
  public readonly key: string;
  public constructor(key: string) {
    super(`Model not found: ${key}`);
    this.name = "UnknownModelError";
    this.key = key;
  }
}

/** The provider a model claims to belong to is not registered. */
export class OrphanModelError extends Error {
  public readonly providerId: string;
  public constructor(providerId: string) {
    super(`Cannot register a model for an unregistered provider: ${providerId}`);
    this.name = "OrphanModelError";
    this.providerId = providerId;
  }
}

export type ModelRegistryError =
  | ValidationError
  | DuplicateModelError
  | UnknownModelError
  | OrphanModelError;

export interface ProviderLookup {
  has(providerId: string): boolean;
}

/**
 * Model registry.
 *
 * Enforces referential integrity: a model cannot be registered against a
 * provider that does not exist. PHASE 01 ships zero models.
 */
export class ModelRegistry {
  readonly #records = new Map<string, ModelRecord>();
  readonly #byProvider = new Map<string, Set<string>>();
  readonly #clock: Clock;
  readonly #providers: ProviderLookup;

  public constructor(options: { clock?: Clock; providers: ProviderLookup }) {
    this.#clock = options.clock ?? systemClock;
    this.#providers = options.providers;
  }

  public get size(): number {
    return this.#records.size;
  }

  public register(
    input: Omit<ModelRecordInput, "now">,
  ): Result<ModelRecord, ModelRegistryError> {
    if (typeof input.providerId === "string" && !this.#providers.has(input.providerId)) {
      return err(new OrphanModelError(input.providerId));
    }
    const key = modelKey(input.providerId, input.modelId);
    if (this.#records.has(key)) {
      return err(new DuplicateModelError(key));
    }
    const built = createModelRecord({ ...input, now: this.#clock.now() });
    if (!built.ok) {
      return built;
    }
    this.#records.set(key, built.value);
    const bucket = this.#byProvider.get(input.providerId) ?? new Set<string>();
    bucket.add(key);
    this.#byProvider.set(input.providerId, bucket);
    return built;
  }

  public has(providerId: string, modelId: string): boolean {
    return this.#records.has(modelKey(providerId, modelId));
  }

  public get(providerId: string, modelId: string): ModelRecord | null {
    return this.#records.get(modelKey(providerId, modelId)) ?? null;
  }

  public list(): readonly ModelRecord[] {
    return [...this.#records.values()];
  }

  public listByProvider(providerId: string): readonly ModelRecord[] {
    const keys = this.#byProvider.get(providerId);
    if (!keys) {
      return [];
    }
    return [...keys].map((key) => this.#records.get(key)).filter((r): r is ModelRecord => r !== undefined);
  }

  public setEnabled(providerId: string, modelId: string, enabled: boolean): Result<ModelRecord, ModelRegistryError> {
    return this.#mutate(providerId, modelId, (record) => ({
      ...record,
      enabled,
      updatedAt: this.#clock.now(),
    }));
  }

  public setApproval(providerId: string, modelId: string, approvalStatus: ApprovalStatus): Result<ModelRecord, ModelRegistryError> {
    return this.#mutate(providerId, modelId, (record) => ({
      ...record,
      approvalStatus,
      updatedAt: this.#clock.now(),
    }));
  }

  public setHealth(providerId: string, modelId: string, health: HealthObservation): Result<ModelRecord, ModelRegistryError> {
    return this.#mutate(providerId, modelId, (record) => ({
      ...record,
      health,
      updatedAt: this.#clock.now(),
    }));
  }

  public remove(providerId: string, modelId: string): Result<ModelRecord, ModelRegistryError> {
    const key = modelKey(providerId, modelId);
    const record = this.#records.get(key);
    if (!record) {
      return err(new UnknownModelError(key));
    }
    this.#records.delete(key);
    this.#byProvider.get(providerId)?.delete(key);
    return ok(record);
  }

  #mutate(
    providerId: string,
    modelId: string,
    fn: (record: ModelRecord) => ModelRecord,
  ): Result<ModelRecord, ModelRegistryError> {
    const key = modelKey(providerId, modelId);
    const existing = this.#records.get(key);
    if (!existing) {
      return err(new UnknownModelError(key));
    }
    const next = fn(existing);
    this.#records.set(key, next);
    return ok(next);
  }
}
