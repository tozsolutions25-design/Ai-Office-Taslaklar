import { CapabilitySet } from "../capabilities/capability.js";
import { type ErrorClass, ValidationError } from "../core/errors.js";
import { err, ok, type Result } from "../core/result.js";
import type { SecretRef } from "../core/secretRef.js";
import {
  type HealthObservation,
  UNKNOWN_HEALTH,
} from "../health/health.js";
import { type ApprovalStatus, isApprovalStatus } from "./lifecycle.js";

/**
 * Provider record.
 *
 * Design constraints:
 *  - No secret VALUES. Only a `SecretRef`.
 *  - No fabricated facts. Every quantitative field is nullable and `null`
 *    means "not verified", never a default guess.
 *  - Provider-specific fields do not exist here. Provider adapters translate
 *    their own concepts at the boundary (see ProviderAdapter).
 *
 * Booleans such as tool / vision / structured-output support are NOT stored
 * separately from the CapabilitySet, to avoid two competing sources of truth.
 * Use `deriveProviderTraits` for named, explicit accessors.
 */

export const PROVIDER_TYPES = [
  "managed",
  "self_hosted",
  "local",
  "gateway",
  "aggregator",
  "unknown",
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

/** Relative cost classification. Never a monetary claim. */
export const COST_CLASSES = ["free", "low", "standard", "premium", "unknown"] as const;
export type CostClass = (typeof COST_CLASSES)[number];

export const FREE_TIER_STATUSES = ["unknown", "available", "not_available", "exhausted"] as const;
export type FreeTierStatus = (typeof FREE_TIER_STATUSES)[number];

/** Named boolean capability traits, derived from the CapabilitySet. */
export interface ProviderTraits {
  readonly toolSupport: boolean | null;
  readonly visionSupport: boolean | null;
  readonly structuredOutputSupport: boolean | null;
  readonly codingCapability: boolean | null;
  readonly reasoningCapability: boolean | null;
}

export interface QuotaInfo {
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly windowMs: number | null;
  readonly resetsAt: Date | null;
}

export interface RateLimitInfo {
  readonly requestsPerMinute: number | null;
  readonly tokensPerMinute: number | null;
}

export interface ConcurrencyLimits {
  /** Physical ceiling for simultaneous requests to this provider. */
  readonly maxConcurrentRequests: number | null;
  /** Physical ceiling for requests waiting for a slot. null = use global. */
  readonly maxQueuedRequests: number | null;
}

export interface ProviderRecord {
  readonly providerId: string;
  readonly name: string;
  readonly type: ProviderType;
  /** Base endpoint. null when not applicable or not yet configured. */
  readonly endpoint: string | null;
  /** Reference to credentials. NEVER a credential value. */
  readonly authRef: SecretRef | null;
  /** Model IDs registered against this provider (references, not definitions). */
  readonly modelIds: readonly string[];
  readonly capabilities: CapabilitySet;
  /** Provider-level context ceiling. null = unknown. */
  readonly contextLimitTokens: number | null;
  /** Observed p50 latency. null = never measured. */
  readonly latencyP50Ms: number | null;
  readonly costClass: CostClass;
  readonly freeTierStatus: FreeTierStatus;
  readonly quota: QuotaInfo | null;
  readonly rateLimits: RateLimitInfo | null;
  readonly concurrency: ConcurrencyLimits;
  readonly health: HealthObservation;
  readonly approvalStatus: ApprovalStatus;
  readonly enabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * A field may be `null` (explicitly unknown) or `undefined` (not provided).
 * Both are acceptable; anything else must be a valid positive integer.
 */
function isPositiveIntOrNullish(value: unknown): value is number | null | undefined {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "number" && Number.isInteger(value) && value > 0)
  );
}

function isNonNegativeNumberOrNullish(value: unknown): value is number | null | undefined {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "number" && value >= 0)
  );
}

/**
 * Derives named trait booleans from the capability set.
 * `null` means unknown, which is deliberately not `false`.
 */
export function deriveProviderTraits(capabilities: CapabilitySet): ProviderTraits {
  const read = (name: Parameters<CapabilitySet["statusOf"]>[0]): boolean | null => {
    const status = capabilities.statusOf(name);
    if (status === "supported") return true;
    if (status === "unsupported") return false;
    return null;
  };
  return {
    toolSupport: read("tool_calling"),
    visionSupport: read("vision"),
    structuredOutputSupport: read("structured_output"),
    codingCapability: read("coding"),
    reasoningCapability: read("reasoning"),
  };
}

export interface ProviderRecordInput {
  providerId: string;
  name?: string;
  type?: ProviderType;
  endpoint?: string | null;
  authRef?: SecretRef | null;
  modelIds?: readonly string[];
  capabilities?: CapabilitySet;
  contextLimitTokens?: number | null;
  latencyP50Ms?: number | null;
  costClass?: CostClass;
  freeTierStatus?: FreeTierStatus;
  quota?: QuotaInfo | null;
  rateLimits?: RateLimitInfo | null;
  concurrency?: ConcurrencyLimits;
  health?: HealthObservation;
  approvalStatus?: ApprovalStatus;
  enabled?: boolean;
  now: Date;
  metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Builds a validated ProviderRecord.
 *
 * Validation is intentionally strict on identity and shape, and deliberately
 * permissive about unknown values (they stay null/unknown rather than being
 * rejected or defaulted into a claim).
 */
export function createProviderRecord(input: ProviderRecordInput): Result<ProviderRecord, ValidationError> {
  const issues: string[] = [];

  if (typeof input.providerId !== "string" || input.providerId.trim() === "") {
    issues.push("providerId must be a non-empty string");
  }
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.trim() === "")) {
    issues.push("name must be a non-empty string when provided");
  }
  if (input.type !== undefined && !(PROVIDER_TYPES as readonly string[]).includes(input.type)) {
    issues.push(`type must be one of: ${PROVIDER_TYPES.join(", ")}`);
  }
  if (input.costClass !== undefined && !(COST_CLASSES as readonly string[]).includes(input.costClass)) {
    issues.push(`costClass must be one of: ${COST_CLASSES.join(", ")}`);
  }
  if (
    input.freeTierStatus !== undefined &&
    !(FREE_TIER_STATUSES as readonly string[]).includes(input.freeTierStatus)
  ) {
    issues.push(`freeTierStatus must be one of: ${FREE_TIER_STATUSES.join(", ")}`);
  }
  if (input.approvalStatus !== undefined && !isApprovalStatus(input.approvalStatus)) {
    issues.push("approvalStatus is not a valid approval state");
  }
  if (!isPositiveIntOrNullish(input.contextLimitTokens)) {
    issues.push("contextLimitTokens must be a positive integer or null");
  }
  if (!isNonNegativeNumberOrNullish(input.latencyP50Ms)) {
    issues.push("latencyP50Ms must be a non-negative number or null");
  }
  if (input.concurrency !== undefined) {
    if (!isPositiveIntOrNullish(input.concurrency.maxConcurrentRequests)) {
      issues.push("concurrency.maxConcurrentRequests must be a positive integer or null");
    }
    if (!isPositiveIntOrNullish(input.concurrency.maxQueuedRequests)) {
      issues.push("concurrency.maxQueuedRequests must be a positive integer or null");
    }
  }
  if (input.modelIds !== undefined && !Array.isArray(input.modelIds)) {
    issues.push("modelIds must be an array of strings");
  }

  if (issues.length > 0) {
    return err(new ValidationError("Provider record validation failed", issues));
  }

  return ok({
    providerId: input.providerId,
    name: input.name ?? input.providerId,
    type: input.type ?? "unknown",
    endpoint: input.endpoint ?? null,
    authRef: input.authRef ?? null,
    modelIds: input.modelIds ? [...input.modelIds] : [],
    capabilities: input.capabilities ?? CapabilitySet.unknown(),
    contextLimitTokens: input.contextLimitTokens ?? null,
    latencyP50Ms: input.latencyP50Ms ?? null,
    costClass: input.costClass ?? "unknown",
    freeTierStatus: input.freeTierStatus ?? "unknown",
    quota: input.quota ?? null,
    rateLimits: input.rateLimits ?? null,
    concurrency: input.concurrency ?? {
      maxConcurrentRequests: null,
      maxQueuedRequests: null,
    },
    health: input.health ?? UNKNOWN_HEALTH,
    approvalStatus: input.approvalStatus ?? "pending",
    enabled: input.enabled ?? false,
    createdAt: input.now,
    updatedAt: input.now,
    metadata: input.metadata ?? {},
  });
}

/**
 * The provider boundary.
 *
 * Implemented later, one adapter per provider, each isolating that provider's
 * wire format, auth scheme and error shapes. Nothing in the core imports a
 * concrete adapter, which is what keeps provider specifics out of the core.
 */
export interface ProviderAdapter {
  readonly providerId: string;
  /** Translates an adapter error into the core error taxonomy. */
  classifyError(error: unknown): ErrorClass;
  /** Performs one request. PHASE 01 ships no implementation. */
  execute(request: ProviderRequest): Promise<ProviderResponse>;
}

export interface ProviderRequest {
  readonly modelId: string;
  readonly prompt: string;
  readonly tools?: readonly string[];
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface ProviderResponse {
  readonly text: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly latencyMs: number | null;
  readonly raw: unknown;
}
