import { type Capability, isCapability } from "../capabilities/capability.js";
import { ValidationError } from "../core/errors.js";
import { err, ok, type Result } from "../core/result.js";

/**
 * Workload model.
 *
 * A workload describes WHAT work is required, never WHICH provider should run
 * it. Routing decisions are explicitly out of scope here: adding a provider
 * or a scoring weight must not require touching a workload definition.
 */

export const WORKLOAD_CLASSES = [
  "coding",
  "debugging",
  "research",
  "reasoning",
  "ui_design",
  "documentation",
  "seo",
  "content",
  "testing",
  "browser_automation",
  "long_running",
] as const;

export type WorkloadClass = (typeof WORKLOAD_CLASSES)[number];

export function isWorkloadClass(value: unknown): value is WorkloadClass {
  return typeof value === "string" && (WORKLOAD_CLASSES as readonly string[]).includes(value);
}

/** How much reliability the caller demands. Used later by scoring, not by matching. */
export const RELIABILITY_LEVELS = ["best_effort", "standard", "high", "critical"] as const;
export type ReliabilityLevel = (typeof RELIABILITY_LEVELS)[number];

/** Relative latency appetite. Deliberately ordinal, not milliseconds. */
export const LATENCY_PREFERENCES = ["realtime", "balanced", "throughput"] as const;
export type LatencyPreference = (typeof LATENCY_PREFERENCES)[number];

/** Relative cost appetite. Never a monetary claim about any provider. */
export const COST_PREFERENCES = ["free_only", "low_cost", "balanced", "premium"] as const;
export type CostPreference = (typeof COST_PREFERENCES)[number];

/**
 * How much the caller wants quality, as an ORDINAL preference.
 *
 * Deliberately not a number and deliberately not a claim about any model. This
 * repository holds no quality benchmark, so "prefer_high" can only mean "prefer
 * the highest operator-declared tier, and say plainly when no tier has been
 * declared". A policy that scored quality on its own would be inventing the data
 * it is ranking on.
 */
export const QUALITY_PREFERENCES = ["baseline", "prefer_high"] as const;
export type QualityPreference = (typeof QUALITY_PREFERENCES)[number];

/** How urgent the work is. Affects willingness to fall back, not eligibility. */
export const TASK_PRIORITIES = ["background", "normal", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * Requirements attached to a workload.
 *
 * `null` means "not specified / unknown" and is never coerced to a number.
 * Numeric thresholds are absolute; cost and latency are preferences that a
 * future scorer may weigh, and are not used as hard filters in PHASE 01.
 */
export interface WorkloadRequirements {
  readonly requiredCapabilities: readonly Capability[];
  /** Minimum context window the candidate model must offer. null = no minimum. */
  readonly minContextTokens: number | null;
  /** Logical tool names that must be available to the candidate. */
  readonly requiredTools: readonly string[];
  readonly reliability: ReliabilityLevel;
  readonly latencyPreference: LatencyPreference;
  readonly costPreference: CostPreference;
  /** When true, the candidate must have at least one fallback candidate. */
  readonly fallbackRequired: boolean;
  /**
   * PHASE 06, additive and optional.
   *
   * Each of these is a requirement or preference a routing policy may use. None
   * is required, none defaults to a strong claim, and adding one must never
   * change the behaviour of a caller that does not set it.
   */
  /** Minimum output the caller's expected response must fit into. */
  readonly minOutputTokens?: number | null;
  /** Ordinal quality appetite. See `QualityPreference`. */
  readonly qualityPreference?: QualityPreference;
  /** Urgency. Affects fallback willingness, never eligibility. */
  readonly priority?: TaskPriority;
  /** The policy the caller wants used. Absent means "the default policy". */
  readonly policy?: string;
}

export interface WorkloadDefinition {
  readonly class: WorkloadClass;
  readonly requirements: WorkloadRequirements;
  /** Free-form, non-authoritative annotations. */
  readonly metadata: Readonly<Record<string, unknown>>;
}

export const DEFAULT_REQUIREMENTS: WorkloadRequirements = {
  requiredCapabilities: [],
  minContextTokens: null,
  requiredTools: [],
  reliability: "standard",
  latencyPreference: "balanced",
  costPreference: "balanced",
  fallbackRequired: false,
};

/**
 * Unknown extensions are permitted: the model is deliberately open so future
 * phases can add requirement dimensions without a breaking change. Validation
 * checks the dimensions it knows about and leaves the rest alone.
 */

const KNOWN_SCALARS = new Set([
  "class",
  "requiredCapabilities",
  "minContextTokens",
  "requiredTools",
  "reliability",
  "latencyPreference",
  "costPreference",
  "fallbackRequired",
  "metadata",
]);

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function checkStringArray(
  field: string,
  value: unknown,
  issues: string[],
): readonly string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    issues.push(`${field} must be an array of strings`);
    return [];
  }
  return [...(value as string[])] as readonly string[];
}

export function validateWorkload(input: unknown): Result<WorkloadDefinition, ValidationError> {
  const issues: string[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return err(new ValidationError("Workload must be an object", ["workload must be an object"]));
  }

  const raw = input as Record<string, unknown>;

  if (!isWorkloadClass(raw["class"])) {
    issues.push(`class must be one of: ${WORKLOAD_CLASSES.join(", ")}`);
  }

  const capabilities = checkStringArray("requiredCapabilities", raw["requiredCapabilities"], issues);
  for (const capability of capabilities) {
    // `isCapability` narrows to `Capability`, which is open (`string & {}`), so
    // the rejected branch would be `never` and the name could not be reported.
    // Checking the boolean separately keeps the offending value printable.
    if (!isCapability(capability)) {
      issues.push(`requiredCapabilities contains unknown capability: ${String(capability)}`);
    }
  }

  const tools = checkStringArray("requiredTools", raw["requiredTools"], issues);

  let minContextTokens: number | null = null;
  if (raw["minContextTokens"] !== undefined && raw["minContextTokens"] !== null) {
    const value = raw["minContextTokens"];
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      issues.push("minContextTokens must be a positive integer or null");
    } else {
      minContextTokens = value;
    }
  }

  let reliability: ReliabilityLevel = DEFAULT_REQUIREMENTS.reliability;
  if (raw["reliability"] !== undefined) {
    if (!isOneOf(raw["reliability"], RELIABILITY_LEVELS)) {
      issues.push(`reliability must be one of: ${RELIABILITY_LEVELS.join(", ")}`);
    } else {
      reliability = raw["reliability"];
    }
  }

  let latencyPreference: LatencyPreference = DEFAULT_REQUIREMENTS.latencyPreference;
  if (raw["latencyPreference"] !== undefined) {
    if (!isOneOf(raw["latencyPreference"], LATENCY_PREFERENCES)) {
      issues.push(`latencyPreference must be one of: ${LATENCY_PREFERENCES.join(", ")}`);
    } else {
      latencyPreference = raw["latencyPreference"];
    }
  }

  let costPreference: CostPreference = DEFAULT_REQUIREMENTS.costPreference;
  if (raw["costPreference"] !== undefined) {
    if (!isOneOf(raw["costPreference"], COST_PREFERENCES)) {
      issues.push(`costPreference must be one of: ${COST_PREFERENCES.join(", ")}`);
    } else {
      costPreference = raw["costPreference"];
    }
  }

  let fallbackRequired = DEFAULT_REQUIREMENTS.fallbackRequired;
  if (raw["fallbackRequired"] !== undefined) {
    if (typeof raw["fallbackRequired"] !== "boolean") {
      issues.push("fallbackRequired must be a boolean");
    } else {
      fallbackRequired = raw["fallbackRequired"];
    }
  }

  const metadataRaw = raw["metadata"];
  let metadata: Readonly<Record<string, unknown>> = {};
  if (metadataRaw !== undefined) {
    if (typeof metadataRaw !== "object" || metadataRaw === null || Array.isArray(metadataRaw)) {
      issues.push("metadata must be an object");
    } else {
      metadata = metadataRaw as Record<string, unknown>;
    }
  }

  // Extensibility check: surface unexpected top-level keys as warnings-free
  // acceptance, but reject a non-object `metadata` that would hide typos.
  for (const key of Object.keys(raw)) {
    if (!KNOWN_SCALARS.has(key)) {
      // Unknown key -> permitted extension point, no issue raised.
      continue;
    }
  }

  if (issues.length > 0) {
    return err(new ValidationError("Workload validation failed", issues));
  }

  return ok({
    class: raw["class"] as WorkloadClass,
    requirements: {
      requiredCapabilities: capabilities as Capability[],
      minContextTokens,
      requiredTools: tools,
      reliability,
      latencyPreference,
      costPreference,
      fallbackRequired,
    },
    metadata,
  });
}
