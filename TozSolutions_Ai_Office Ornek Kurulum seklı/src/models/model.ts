import { CapabilitySet } from "../capabilities/capability.js";
import { ValidationError } from "../core/errors.js";
import { err, ok, type Result } from "../core/result.js";
import { type HealthObservation, UNKNOWN_HEALTH } from "../health/health.js";
import type { ApprovalStatus } from "../providers/lifecycle.js";
import { type CostClass } from "../providers/provider.js";

/**
 * Model record.
 *
 * A model is independently addressable (`providerId::modelId`) but always
 * owned by exactly one provider. Model specifications are NEVER invented:
 * context window, output limit and cost class default to `null` / `unknown`
 * until a real source or probe supplies them.
 */

export const AVAILABILITY_STATUSES = ["available", "unavailable", "unknown"] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export function isAvailabilityStatus(value: unknown): value is AvailabilityStatus {
  return typeof value === "string" && (AVAILABILITY_STATUSES as readonly string[]).includes(value);
}

export interface ModelRecord {
  /** Globally addressable identifier. */
  readonly modelId: string;
  /** Owning provider. Must reference a registered provider. */
  readonly providerId: string;
  readonly displayName: string;
  readonly capabilities: CapabilitySet;
  readonly contextWindowTokens: number | null;
  readonly maxOutputTokens: number | null;
  readonly availability: AvailabilityStatus;
  readonly health: HealthObservation;
  readonly costClass: CostClass;
  readonly approvalStatus: ApprovalStatus;
  readonly enabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /**
   * PHASE 06: the ONLY metadata a model record may carry.
   *
   * This used to be `Readonly<Record<string, unknown>>`, which is the single reason
   * `core.models` could not be listed as deployment-scoped without a caveat: nothing
   * in that type stopped a caller filing a customer id, a workspace, a document body
   * or a task id under it, and `createModelRecord` passed the bag straight through.
   * A field-name check cannot see inside a bag, so the caveat was unavoidable while
   * the bag existed.
   *
   * It is now a CLOSED type - see `ModelMetadata` - and a validator rejects any key
   * outside the allowlist, because a closed type alone is bypassed by a cast and a
   * cast is exactly what a determined caller reaches for.
   */
  readonly metadata: ModelMetadata;
}

export interface ModelRecordInput {
  modelId: string;
  providerId: string;
  displayName?: string;
  capabilities?: CapabilitySet;
  contextWindowTokens?: number | null;
  maxOutputTokens?: number | null;
  availability?: AvailabilityStatus;
  health?: HealthObservation;
  costClass?: CostClass;
  approvalStatus?: ApprovalStatus;
  enabled?: boolean;
  now: Date;
  /**
   * PHASE 06: typed, not `Record<string, unknown>`. See `ModelRecord.metadata`.
   *
   * The narrower type is the POINT: a caller writing `{ workspace: "acme" }` gets a
   * compile error rather than a record that quietly carries customer data inside a
   * registry `describe()` calls deployment-scoped.
   */
  metadata?: ModelMetadata;
}

function isPositiveIntOrNullish(value: unknown): value is number | null | undefined {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "number" && Number.isInteger(value) && value > 0)
  );
}

export function createModelRecord(input: ModelRecordInput): Result<ModelRecord, ValidationError> {
  const issues: string[] = [];

  if (typeof input.modelId !== "string" || input.modelId.trim() === "") {
    issues.push("modelId must be a non-empty string");
  }
  if (typeof input.providerId !== "string" || input.providerId.trim() === "") {
    issues.push("providerId must be a non-empty string");
  }
  if (input.displayName !== undefined && (typeof input.displayName !== "string" || input.displayName === "")) {
    issues.push("displayName must be a non-empty string when provided");
  }
  if (!isPositiveIntOrNullish(input.contextWindowTokens)) {
    issues.push("contextWindowTokens must be a positive integer or null");
  }
  if (!isPositiveIntOrNullish(input.maxOutputTokens)) {
    issues.push("maxOutputTokens must be a positive integer or null");
  }
  if (input.availability !== undefined && !isAvailabilityStatus(input.availability)) {
    issues.push(`availability must be one of: ${AVAILABILITY_STATUSES.join(", ")}`);
  }
  // PHASE 06: the runtime half of the closed metadata type. See `validateModelMetadata`.
  issues.push(...validateModelMetadata(input.metadata));

  if (issues.length > 0) {
    return err(new ValidationError("Model record validation failed", issues));
  }

  return ok({
    modelId: input.modelId,
    providerId: input.providerId,
    displayName: input.displayName ?? input.modelId,
    capabilities: input.capabilities ?? CapabilitySet.unknown(),
    contextWindowTokens: input.contextWindowTokens ?? null,
    maxOutputTokens: input.maxOutputTokens ?? null,
    availability: input.availability ?? "unknown",
    health: input.health ?? UNKNOWN_HEALTH,
    costClass: input.costClass ?? "unknown",
    approvalStatus: input.approvalStatus ?? "pending",
    enabled: input.enabled ?? false,
    createdAt: input.now,
    updatedAt: input.now,
    metadata: input.metadata ?? {},
  });
}
/** Canonical cross-registry address of a model. */
export function modelKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

/* -------------------------------------------------------------------------- */
/* Declared quality tier                                                       */
/* -------------------------------------------------------------------------- */

/**
 * PHASE 06: a quality tier an OPERATOR declares about a model.
 *
 * This repository contains no quality benchmark, so nothing infers a tier. The
 * only way one exists is for a deployment to state it. `unverified` means exactly
 * that: nobody said, so nothing is known - it is emphatically not "the worst".
 */
export const QUALITY_TIERS = ["unverified", "adequate", "strong", "frontier"] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];

export function isQualityTier(value: unknown): value is QualityTier {
  return typeof value === "string" && (QUALITY_TIERS as readonly string[]).includes(value);
}

/**
 * Metadata key holding the declared tier.
 *
 * Namespaced so it cannot collide with a provider's own metadata, and so it is
 * obvious in a record dump that this is a TOZ annotation rather than something
 * the provider reported.
 */
export const QUALITY_TIER_METADATA_KEY = "toz.qualityTier";

/**
 * PHASE 06: EVERY metadata key a model record may carry.
 *
 * The allowlist is a closed union, not an index signature. Adding a sanctioned key is
 * a one-line change HERE and that is deliberate - it makes "what may a deployment
 * attach to a model?" a question with an answer you can read, and it forces every
 * addition through the review where someone has to ask whether the new key could hold
 * a customer identifier.
 *
 * It exists because `core.models` is deployment-scoped. Anything a customer could
 * write here would be readable by every workspace in the process, and PHASE 06's whole
 * claim about that registry is that it holds no customer data. A free-form bag makes
 * the claim unfalsifiable; this makes it checkable.
 */
export const MODEL_METADATA_KEYS = [QUALITY_TIER_METADATA_KEY] as const;
export type ModelMetadataKey = (typeof MODEL_METADATA_KEYS)[number];

/**
 * The closed metadata shape.
 *
 * A mapped type over the key union, so there is NO index signature and no
 * `Record<string, unknown>` anywhere in it. Two consequences, both wanted:
 *
 *   1. `{ [QUALITY_TIER_METADATA_KEY]: "strong" }` compiles.
 *   2. `{ workspace: "acme" }`, `{ tenantId: 7 }` and `{ customerId: "c-1" }` do not,
 *      and neither does assigning a `Record<string, unknown>` to it - `unknown` is not
 *      assignable to `QualityTier`, so the bag cannot be laundered in whole.
 */
export type ModelMetadata = { readonly [K in ModelMetadataKey]?: QualityTier };

/** Every value a model metadata field may hold: a primitive, never a structure. */
function isPrimitiveModelMetadataValue(value: unknown): boolean {
  return (
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  );
}

/**
 * PHASE 06: rejects metadata the type cannot fully prevent.
 *
 * A closed type is enforced by the compiler, and the compiler is bypassed by `as`,
 * by JSON parsed at a boundary, and by any future widening of `MODEL_METADATA_KEYS`
 * whose values nobody re-examined. So the same allowlist is enforced again at
 * runtime, where the value actually lands.
 *
 * The failure is a `ValidationError` like every other malformed input here, rather
 * than a silently dropped field: a caller whose metadata vanished would have no way
 * to know, and would go looking for a bug that is really a policy decision.
 */
export function validateModelMetadata(metadata: unknown): string[] {
  if (metadata === undefined) {
    return [];
  }
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return ["metadata must be an object of sanctioned keys"];
  }
  const issues: string[] = [];
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (!(MODEL_METADATA_KEYS as readonly string[]).includes(key)) {
      issues.push(
        `metadata key "${key}" is not sanctioned; permitted keys are ${MODEL_METADATA_KEYS.join(", ")}`,
      );
      continue;
    }
    if (value === undefined) {
      continue;
    }
    if (!isPrimitiveModelMetadataValue(value)) {
      issues.push(`metadata["${key}"] must be a string, number or boolean`);
      continue;
    }
    if (key === QUALITY_TIER_METADATA_KEY && !isQualityTier(value)) {
      issues.push(`metadata["${key}"] must be one of ${QUALITY_TIERS.join(", ")}`);
    }
  }
  return issues;
}

/**
 * Reads a model's declared tier, or `unverified` when none was declared.
 *
 * PHASE 06: takes `ModelMetadata`, not `Readonly<Record<string, unknown>>`. The
 * parameter used to be a bag, which meant a caller could hand this function whatever
 * it liked and be told a tier - so the closed guarantee did not extend to the one
 * function in this file that READS the bag. Reading it is how a value escapes a
 * closed type, and this was the reader.
 *
 * `unverified` is returned for an absent or malformed value rather than throwing,
 * because a routing decision must not depend on a caller having validated its own
 * metadata first; `createModelRecord` is where the refusal happens.
 */
export function declaredQualityTier(metadata: ModelMetadata): QualityTier {
  const value = metadata[QUALITY_TIER_METADATA_KEY];
  return isQualityTier(value) ? value : "unverified";
}
