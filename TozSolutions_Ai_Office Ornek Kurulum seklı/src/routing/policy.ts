/**
 * PHASE 06: routing policies.
 *
 * A policy is an ORDERED LIST OF FACTS, compared lexicographically. It is not a
 * weighted sum, and that is the whole design:
 *
 *   - No weights means no invented trade-off. "Latency matters 0.4 as much as
 *     context" is a claim about the world that nobody has evidence for. An order
 *     is a claim only about what the caller asked to prioritise, which they did.
 *   - Lexicographic order means the first fact that differs decides, so an
 *     explanation can name that fact exactly. "Chosen because it has more
 *     context headroom" is checkable; "chosen because it scored 0.87" is not.
 *   - Every fact is either recorded or `null`. A `null` is NEVER treated as a
 *     good value and never as a bad one: it simply does not win the comparison,
 *     so an unmeasured provider cannot buy an advantage by having no data.
 *
 * This module adds no eligibility rule. `evaluateCandidate` in `router.ts` remains
 * the single hard filter, and a policy only ever orders candidates that already
 * survived it. A policy can therefore never reselect something routing rejected.
 */

import { type CapabilitySet } from "../capabilities/capability.js";
import { type HealthStatus, type HealthObservation } from "../health/health.js";
import { declaredQualityTier, type QualityTier } from "../models/model.js";
import { type CostClass } from "../providers/provider.js";
import { type RoutingCandidate } from "./router.js";


/**
 * A fact a policy can order by.
 *
 * `value: null` means "not recorded". `direction` says which end of the scale
 * wins. There is no magnitude, because there is no measurement to scale.
 */
export const ROUTE_FACT_KINDS = [
  "quality_tier",
  "capability_breadth",
  "context_headroom",
  "output_headroom",
  "health",
  "latency",
  "cost_class",
  "structured_output",
] as const;
export type RouteFactKind = (typeof ROUTE_FACT_KINDS)[number];

export const FACT_DIRECTIONS: Readonly<Record<RouteFactKind, "higher_is_better" | "lower_is_better">> = {
  quality_tier: "higher_is_better",
  capability_breadth: "higher_is_better",
  context_headroom: "higher_is_better",
  output_headroom: "higher_is_better",
  health: "higher_is_better",
  latency: "lower_is_better",
  cost_class: "lower_is_better",
  structured_output: "higher_is_better",
};

export interface RouteFact {
  readonly kind: RouteFactKind;
  /** null when the fact was never recorded. Never a guess. */
  readonly value: number | null;
  /** Non-secret provenance of the value, for the explanation. */
  readonly source: string;
}

/* -------------------------------------------------------------------------- */
/* Ordinal scales                                                              */
/* -------------------------------------------------------------------------- */

const HEALTH_SCALE: Readonly<Record<HealthStatus, number>> = {
  healthy: 3,
  degraded: 2,
  unknown: 1,
  unavailable: 0,
  disabled: 0,
};

const QUALITY_SCALE: Readonly<Record<QualityTier, number>> = {
  frontier: 3,
  strong: 2,
  adequate: 1,
  unverified: 0,
};

/**
 * Cost classes on an ordinal scale of BADNESS, where `unknown` is `null`.
 *
 * Two things are load-bearing here:
 *
 *   - The scale runs free(0) -> premium(3) because `cost_class` is compared with
 *     `lower_is_better`, the same direction as latency. An earlier version
 *     scaled it as goodness (free = 3) and therefore ranked `premium` as the
 *     cheapest thing in the system, which is the exact inversion the policy
 *     exists to avoid.
 *   - `unknown` is `null`, not the bottom of the scale. Putting it at 0 would
 *     state that an unpriced model is the cheapest option available.
 */
const COST_SCALE: Readonly<Record<CostClass, number | null>> = {
  free: 0,
  low: 1,
  standard: 2,
  premium: 3,
  unknown: null,
};

/* -------------------------------------------------------------------------- */
/* Fact extraction                                                             */
/* -------------------------------------------------------------------------- */

function countSupported(capabilities: CapabilitySet): number {
  return [...capabilities.entries()].filter(([, status]) => status === "supported").length;
}

function structuredOutputOf(
  capabilities: CapabilitySet,
): { value: number | null; source: string } {
  const status = capabilities.statusOf("structured_output");
  if (status === "unknown") {
    return { value: null, source: "structured_output was never verified" };
  }
  return { value: status === "supported" ? 1 : 0, source: `structured_output is ${status}` };
}

/**
 * Every fact about a candidate that a policy may order by.
 *
 * Reads the model first and the provider second, matching the precedence the
 * existing filter already uses: a model's own declaration is authoritative, and
 * a provider profile is the fallback. Nothing is inferred across the two.
 */
export function routeFactsOf(candidate: RoutingCandidate): readonly RouteFact[] {
  const { provider, model } = candidate;
  const capabilities: CapabilitySet = model?.capabilities ?? provider.capabilities;
  const contextLimit = model?.contextWindowTokens ?? provider.contextLimitTokens;
  const latency = provider.health.latencyMs ?? provider.latencyP50Ms;
  const costClass: CostClass = model?.costClass ?? provider.costClass;
  const health: HealthObservation = model?.health ?? provider.health;
  const structured = structuredOutputOf(capabilities);
  const quality: QualityTier = model === null ? "unverified" : declaredQualityTier(model.metadata);

  return [
    {
      kind: "quality_tier",
      value: quality === "unverified" ? null : QUALITY_SCALE[quality],
      source: `operator-declared tier "${quality}"`,
    },
    { kind: "capability_breadth", value: countSupported(capabilities), source: "capabilities recorded as supported" },
    {
      kind: "context_headroom",
      value: contextLimit,
      source: contextLimit === null ? "no context limit has been recorded" : "recorded context window",
    },
    {
      kind: "output_headroom",
      value: model?.maxOutputTokens ?? null,
      source: model?.maxOutputTokens === null || model?.maxOutputTokens === undefined
        ? "no output limit has been recorded"
        : "recorded output limit",
    },
    {
      kind: "health",
      value: HEALTH_SCALE[health.status],
      source: `health is "${health.status}"`,
    },
    {
      kind: "latency",
      value: latency,
      source: latency === null ? "latency has never been measured" : "recorded p50 latency",
    },
    {
      kind: "cost_class",
      value: COST_SCALE[costClass],
      source: `cost class is "${costClass}"`,
    },
    { kind: "structured_output", value: structured.value, source: structured.source },
  ];
}

/* -------------------------------------------------------------------------- */
/* Policies                                                                    */
/* -------------------------------------------------------------------------- */

export interface RoutingPolicy {
  readonly name: string;
  /**
   * Facts in PRIORITY order. The first that differs between two candidates
   * decides the order between them.
   */
  readonly factOrder: readonly RouteFactKind[];
  /**
   * What the policy states about itself when it has no data to work with.
   *
   * Purely documentary, and asserted in tests. A policy that silently degrades to
   * an unrelated ordering is how a deployment ends up believing it is being
   * routed cost-sensitively when it is not.
   */
  readonly rationale: string;
}

/**
 * The shipped policies.
 *
 * None of them is a "best model" ordering. Each states which recorded facts it
 * consults, in what order of importance, and what it does when those facts are
 * absent. `capability_breadth` leads everywhere except the cost and latency
 * policies, because a broader declared capability set is the closest thing this
 * repository has to a quality signal - and it is a declaration, not a benchmark.
 */
export const ROUTING_POLICIES: Readonly<Record<string, RoutingPolicy>> = {
  /**
   * Widest declared capability set, then the rest of the ordinary facts.
   * The default, because it is the ordering that asks the fewest questions.
   */
  "capability-first": {
    name: "capability-first",
    factOrder: [
      "capability_breadth",
      "quality_tier",
      "health",
      "context_headroom",
      "output_headroom",
      "latency",
      "cost_class",
      "structured_output",
    ],
    rationale:
      "Prefers the widest DECLARED capability set, then declared quality, then recorded health and limits.",
  },

  /**
   * Operator-declared quality first.
   *
   * When no candidate has a declared tier - the normal state of this repository,
   * because there is no quality benchmark - every candidate's quality fact is
   * null, the fact cannot discriminate, and ordering falls through to the
   * remaining facts. `explainPolicy` reports that rather than pretending.
   */
  "quality-first": {
    name: "quality-first",
    factOrder: ["quality_tier", "capability_breadth", "health", "context_headroom", "latency", "cost_class"],
    rationale:
      "Prefers the highest operator-declared quality tier. This repository has NO quality benchmark, so with no declared tier this policy cannot rank on quality at all and says so.",
  },

  "latency-sensitive": {
    name: "latency-sensitive",
    factOrder: ["latency", "health", "context_headroom", "output_headroom", "capability_breadth", "cost_class"],
    rationale:
      "Prefers the lowest RECORDED latency. An unmeasured provider has a null latency and therefore never wins this comparison.",
  },

  "cost-sensitive": {
    name: "cost-sensitive",
    factOrder: ["cost_class", "capability_breadth", "health", "context_headroom", "latency"],
    rationale:
      "Prefers the cheapest DECLARED cost class. A provider with no declared cost class is null, not premium, and wins nothing by being unpriced.",
  },

  "structured-output": {
    name: "structured-output",
    factOrder: ["structured_output", "capability_breadth", "health", "context_headroom", "latency", "cost_class"],
    rationale:
      "Prefers candidates that verifiably support structured output. A candidate whose structured-output support was never verified cannot win this comparison.",
  },
};

export const DEFAULT_ROUTING_POLICY_NAME = "capability-first";

export function resolvePolicy(name: string | null | undefined): RoutingPolicy {
  if (name === null || name === undefined) {
    return ROUTING_POLICIES[DEFAULT_ROUTING_POLICY_NAME];
  }
  const policy = ROUTING_POLICIES[name];
  if (policy === undefined) {
    throw new UnknownRoutingPolicyError(name, Object.keys(ROUTING_POLICIES));
  }
  return policy;
}

export class UnknownRoutingPolicyError extends Error {
  public readonly policyName: string;
  public readonly known: readonly string[];

  public constructor(policyName: string, known: readonly string[]) {
    super(
      `Unknown routing policy "${policyName}". Known policies: ${known.join(", ")}. An unknown name is refused rather than silently replaced by a default, because silently using a different policy than the one configured is exactly the failure this is guarding against.`,
    );
    this.name = "UnknownRoutingPolicyError";
    this.policyName = policyName;
    this.known = known;
  }
}

/* -------------------------------------------------------------------------- */
/* Comparison                                                                  */
/* -------------------------------------------------------------------------- */

/** A negative result means `a` wins. `0` means the fact did not discriminate. */
function compareFact(
  kind: RouteFactKind,
  a: RouteFact | undefined,
  b: RouteFact | undefined,
): number {
  const left = a?.value ?? null;
  const right = b?.value ?? null;
  // A fact that was never recorded cannot outrank one that was, in either
  // direction. This is the rule that stops "no data" from reading as "best".
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (left === right) return 0;
  const better = FACT_DIRECTIONS[kind] === "higher_is_better" ? left > right : left < right;
  return better ? -1 : 1;
}

/** Identity tie-break, so ordering is total and reproducible. */
export function candidateKey(candidate: RoutingCandidate): string {
  return `${candidate.provider.providerId}/${candidate.model?.modelId ?? ""}`;
}

export interface PolicyComparison {
  readonly ordered: readonly RoutingCandidate[];
  /** Facts that actually decided the order, highest priority first. */
  readonly decidingFacts: readonly RouteFactKind[];
}

/**
 * Orders candidates by a policy, recording which fact decided each comparison.
 *
 * Pure and deterministic. The `decidingFacts` are the facts that separated
 * consecutive pairs, which is exactly the set a caller needs to be told why the
 * winner won.
 */
export function orderByPolicy(
  candidates: readonly RoutingCandidate[],
  policy: RoutingPolicy,
): PolicyComparison {
  const decorated = candidates.map((candidate) => ({
    candidate,
    facts: routeFactsOf(candidate),
    key: candidateKey(candidate),
  }));

  const deciding = new Set<RouteFactKind>();
  const ordered = [...decorated].sort((a, b) => {
    for (const kind of policy.factOrder) {
      const result = compareFact(
        kind,
        a.facts.find((fact) => fact.kind === kind),
        b.facts.find((fact) => fact.kind === kind),
      );
      if (result !== 0) {
        deciding.add(kind);
        return result;
      }
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return { ordered: ordered.map((entry) => entry.candidate), decidingFacts: [...deciding] };
}

/* -------------------------------------------------------------------------- */
/* Explanation                                                                 */
/* -------------------------------------------------------------------------- */

export interface FactReading {
  readonly kind: RouteFactKind;
  readonly value: number | null;
  readonly source: string;
  /** True when this fact was null for EVERY candidate and so decided nothing. */
  readonly uninformed: boolean;
}

export interface PolicyExplanation {
  readonly policy: string;
  readonly rationale: string;
  readonly factOrder: readonly RouteFactKind[];
  /** One reading per fact in the policy's order, for the selected candidate. */
  readonly readings: readonly FactReading[];
  /** Facts that were null for every candidate and therefore could not rank. */
  readonly uninformedFacts: readonly RouteFactKind[];
  /** The single sentence a caller can log or show. */
  readonly statement: string;
}

/**
 * Explains a policy application honestly.
 *
 * When a policy cannot rank on a fact because nothing recorded it, that fact is
 * reported as uninformed. This is the difference between "routed by latency" and
 * "would have preferred to route by latency, but no latency has ever been
 * measured, so it ordered by capability breadth instead".
 */
export function explainPolicy(
  selected: RoutingCandidate,
  others: readonly RoutingCandidate[],
  policy: RoutingPolicy,
): PolicyExplanation {
  const all = [selected, ...others];
  const selectedFacts = routeFactsOf(selected);
  const factSets = all.map((candidate) => routeFactsOf(candidate));

  const readings: FactReading[] = policy.factOrder.map((kind) => {
    const own = selectedFacts.find((fact) => fact.kind === kind);
    const uninformed = factSets.every(
      (facts) => facts.find((fact) => fact.kind === kind)?.value === null,
    );
    return { kind, value: own?.value ?? null, source: own?.source ?? "not recorded", uninformed };
  });

  const uninformedFacts = readings.filter((reading) => reading.uninformed).map((reading) => reading.kind);
  const deciding = readings.filter((reading) => !reading.uninformed);

  const basis =
    deciding.length === 0
      ? "nothing was recorded for any candidate, so the order was the deterministic identity tie-break"
      : `ordered by ${deciding.map((reading) => reading.kind).join(", then ")}`;

  const caveat =
    uninformedFacts.length === 0
      ? ""
      : ` Not used, because nothing recorded it: ${uninformedFacts.join(", ")}.`;

  return {
    policy: policy.name,
    rationale: policy.rationale,
    factOrder: policy.factOrder,
    readings,
    uninformedFacts,
    statement:
      `Selected ${candidateKey(selected)} under the "${policy.name}" policy: ${basis}.` +
      ` ${policy.rationale}${caveat}`,
  };
}
