import { type CapabilityMatch, type MatchVerdict, matchCapabilities } from "../capabilities/match.js";
import { isRoutableStatus } from "../health/health.js";
import type { ModelRecord } from "../models/model.js";
import { isProductionEligible, type LifecycleState } from "../providers/lifecycle.js";
import type { ProviderRecord } from "../providers/provider.js";
import type { WorkloadRequirements } from "../workload/workload.js";

/**
 * Routing.
 *
 * Routing is a pipeline of two clearly separated stages:
 *
 *   1. FILTER  - hard, deterministic eligibility. A candidate that fails any
 *                hard requirement is removed. This is why routing is never
 *                "first provider in the list" or "round robin": ineligible
 *                candidates cannot survive the filter.
 *   2. SCORE   - ordering among survivors. PHASE 01 ships the extension point
 *                and a documented, weight-free comparator. It deliberately
 *                ships NO numeric weights, because no measured latency,
 *                cost, or reliability data exists to justify any.
 *
 * A future phase may introduce weights once real observations exist. Adding
 * them must not require editing the filter.
 */

export interface RoutingCandidate {
  readonly provider: ProviderRecord;
  readonly model: ModelRecord | null;
  readonly lifecycleState: LifecycleState;
}

export const REJECTION_REASONS = [
  "provider_disabled",
  "provider_unapproved",
  "provider_not_in_production_pool",
  "provider_health_not_routable",
  "model_disabled",
  "model_unavailable",
  "model_health_not_routable",
  "capability_incompatible",
  "capability_unknown",
  "context_insufficient",
  "cost_preference_unsatisfied",
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface CandidateEvaluation {
  readonly candidate: RoutingCandidate;
  readonly eligible: boolean;
  readonly rejections: readonly RejectionReason[];
  readonly capabilityMatch: CapabilityMatch;
  /** Higher sorts first. Derived only from verified facts, never from a guess. */
  readonly rank: number;
}

export interface RoutingDecision {
  readonly selected: RoutingCandidate | null;
  readonly evaluated: readonly CandidateEvaluation[];
  /** The order the filter/scorer processed candidates in. */
  readonly consideredOrder: readonly string[];
  /** Why the selection was made, in human-readable non-secret form. */
  readonly selectionReason: string;
  readonly selectionVerdict: MatchVerdict | null;
  /**
   * PHASE 05, closing B-09: how the candidates were ORDERED, when a policy was named.
   *
   * ABSENT means `verified-facts`, which is what a router does when nobody asks for
   * anything else. It is not `undefined` because of laziness - it is absent because
   * no policy was applied, and a caller reading `selectionReason` deserves to know
   * which of the two mechanisms produced the order.
   *
   * `uninformedFacts` is the honest half. A policy that consults latency when no
   * latency has ever been measured did not rank on latency, and saying so is the
   * difference between "routed by latency" and "would have preferred to route by
   * latency, but nothing has been measured, so it ordered by capability instead".
   */
  readonly ordering?: {
    readonly policy: string;
    /** Facts that actually separated the candidates, highest priority first. */
    readonly decidingFacts: readonly string[];
    /** Facts the policy consulted that were `null` for every candidate. */
    readonly uninformedFacts: readonly string[];
  };
}

export interface RoutingRequest {
  readonly requirements: WorkloadRequirements;
  readonly correlationId?: string | null;
  /** Logical label, e.g. the workload class. Non-secret. */
  readonly workloadLabel?: string;
  /**
   * PHASE 01 (C-1): candidates the caller has ruled out. Narrows ONLY.
   *
   * WHY THIS FIELD EXISTS
   *
   * `ModelRouter` computed governance's denied-provider list and then did not
   * pass it to the router, because there was nowhere to pass it. The router went
   * on to re-derive the full candidate set from its own `CandidateSource`, so a
   * provider governance had denied was still selectable. The exclusion has to
   * travel with the request, because the request is what the router receives.
   *
   * It lives here, in the core, rather than being imported from
   * `orchestration/governance/`, because `core` must never import `orchestration`.
   * `RoutingRestriction` (governance) is mapped onto this shape by
   * `toCandidateExclusion`, so the denylist itself is still written down once.
   *
   * The shape can only REMOVE. There is no preferred, score, order or replacement
   * field, so a caller holding one cannot express "route here instead" even if it
   * tried. That is the same structural argument that makes `RoutingRestriction`
   * safe, preserved here so it survives the hop across the layer boundary.
   */
  readonly exclude?: CandidateExclusion | null;
  /**
   * PHASE 05, closing B-09: the ORDERING policy to apply, by name.
   *
   * A deployment sets `orchestration.routing.defaultPolicy`, and until this field
   * existed that setting governed the FALLBACK CHAIN only. Primary selection was
   * hardcoded to `verified-facts` and the selection reason said so in as many words,
   * which is honest but means the shipped policy engine - which already exists, is
   * already used for the chain, and already explains itself - was unreachable for the
   * decision that matters most.
   *
   * The field travels with the request for the same reason `exclude` does: the
   * request is what the router receives, and a policy held by the caller that the
   * router cannot see is a policy that silently does nothing.
   *
   * ABSENT means `verified-facts`, unchanged, so every existing caller behaves
   * exactly as before. An unknown name is REFUSED, never replaced with a default:
   * silently ordering by a different policy than the one configured is precisely the
   * failure this makes visible.
   *
   * A policy orders candidates that already survived `evaluateCandidate`. It cannot
   * add an eligibility rule, and nothing here changes that.
   */
  readonly policy?: string | null;
}

/**
 * A narrowing-only exclusion over candidates, in core routing terms.
 *
 * Mirrors the three ways `RoutingRestriction` can deny: a provider id, a whole
 * provider class, and one specific provider/model pair.
 */
export interface CandidateExclusion {
  readonly providerIds: readonly string[];
  readonly modelKeys: readonly string[];
  readonly providerTypes: readonly string[];
}

/** The key a candidate is addressed by in an exclusion. */
export function candidateKeyOf(candidate: RoutingCandidate): string {
  return `${candidate.provider.providerId}/${candidate.model?.modelId ?? ""}`;
}

/**
 * Whether one candidate is excluded.
 *
 * A null or absent exclusion excludes nothing - that is the ordinary
 * ungoverned case and must not change routing. Everything else REMOVES, and an
 * exclusion with three empty lists is treated as excluding nothing rather than
 * everything, because "no opinion" and "deny all" are different statements.
 */
export function isCandidateExcluded(
  candidate: RoutingCandidate,
  exclusion: CandidateExclusion | null | undefined,
): boolean {
  if (exclusion === null || exclusion === undefined) {
    return false;
  }
  if (
    exclusion.providerIds.length === 0 &&
    exclusion.modelKeys.length === 0 &&
    exclusion.providerTypes.length === 0
  ) {
    return false;
  }
  if (exclusion.providerIds.includes(candidate.provider.providerId)) {
    return true;
  }
  if (exclusion.providerTypes.includes(candidate.provider.type)) {
    return true;
  }
  return candidate.model !== null && exclusion.modelKeys.includes(candidateKeyOf(candidate));
}

/** Applies an exclusion, preserving input order. */
export function applyCandidateExclusion(
  candidates: readonly RoutingCandidate[],
  exclusion: CandidateExclusion | null | undefined,
): readonly RoutingCandidate[] {
  if (exclusion === null || exclusion === undefined) {
    return candidates;
  }
  return candidates.filter((candidate) => !isCandidateExcluded(candidate, exclusion));
}

/** A candidate source. Backed by the registries in production. */
export interface CandidateSource {
  candidates(): readonly RoutingCandidate[];
}

/** The core routing contract. */
export interface ProviderRouter {
  select(request: RoutingRequest): Promise<RoutingDecision>;
}

/**
 * Hard filter. Pure and deterministic.
 *
 * Every rule below is a boolean fact about a record. No scoring, no weights.
 */
export function evaluateCandidate(
  candidate: RoutingCandidate,
  requirements: WorkloadRequirements,
): CandidateEvaluation {
  const rejections: RejectionReason[] = [];
  const { provider, model } = candidate;

  if (!provider.enabled) {
    rejections.push("provider_disabled");
  }
  if (provider.approvalStatus !== "approved") {
    rejections.push("provider_unapproved");
  }
  if (!isProductionEligible(candidate.lifecycleState, provider.enabled, provider.approvalStatus)) {
    rejections.push("provider_not_in_production_pool");
  }
  if (!isRoutableStatus(provider.health.status)) {
    rejections.push("provider_health_not_routable");
  }

  if (model) {
    if (!model.enabled) {
      rejections.push("model_disabled");
    }
    if (model.availability === "unavailable") {
      rejections.push("model_unavailable");
    }
    if (!isRoutableStatus(model.health.status)) {
      rejections.push("model_health_not_routable");
    }
  }

  // Capability facts may be declared on the model, the provider, or neither.
  // A model declaration is authoritative when present; otherwise the
  // provider's profile is used. Nothing is inferred across the two.
  const capabilitySource = model?.capabilities ?? provider.capabilities;
  const capabilityMatch = matchCapabilities(requirements.requiredCapabilities, capabilitySource);
  if (capabilityMatch.verdict === "incompatible") {
    rejections.push("capability_incompatible");
  } else if (capabilityMatch.verdict === "unknown") {
    // Unknown is NOT support. Candidates with unverified requirements are
    // withheld from production routing rather than guessed at.
    rejections.push("capability_unknown");
  }

  const context = model?.contextWindowTokens ?? provider.contextLimitTokens;
  if (requirements.minContextTokens !== null) {
    if (context === null) {
      rejections.push("context_insufficient");
    } else if (context < requirements.minContextTokens) {
      rejections.push("context_insufficient");
    }
  }

  if (requirements.costPreference === "free_only") {
    const cost = model?.costClass ?? provider.costClass;
    const freeTier = provider.freeTierStatus;
    const isFree = cost === "free" || freeTier === "available";
    if (!isFree) {
      rejections.push("cost_preference_unsatisfied");
    }
  }

  // Rank encodes only verified-facts ordering, used purely as a stable
  // tie-breaker. It is NOT a quality or performance score.
  const rank = computeVerifiedFactsRank(candidate);

  return { candidate, eligible: rejections.length === 0, rejections, capabilityMatch, rank };
}

/**
 * A deterministic tie-breaker derived from recorded facts.
 *
 * Ordering, highest first:
 *   1. More positively supported required capabilities.
 *   2. Larger known context window (unknown treated as 0).
 *   3. A healthy provider outranks degraded/unknown.
 *   4. Lower recorded latency (unknown treated as +Infinity).
 *   5. Free/lower cost class outranks premium.
 *   6. providerId ascending, for total ordering.
 *
 * This is intentionally NOT a weighted score: it encodes no claim about which
 * trade-off matters more, only a stable order over facts already recorded.
 */
export function computeVerifiedFactsRank(candidate: RoutingCandidate): number {
  const { provider, model } = candidate;
  const capabilities = model?.capabilities ?? provider.capabilities;
  const satisfiedCount = [...capabilities.entries()].filter(([, status]) => status === "supported").length;
  const context = model?.contextWindowTokens ?? provider.contextLimitTokens ?? 0;
  const latency = provider.latencyP50Ms ?? Number.POSITIVE_INFINITY;

  const healthScore =
    provider.health.status === "healthy" ? 2 : provider.health.status === "degraded" ? 1 : 0;
  const costScore =
    (model?.costClass ?? provider.costClass) === "free"
      ? 3
      : (model?.costClass ?? provider.costClass) === "low"
        ? 2
        : (model?.costClass ?? provider.costClass) === "standard"
          ? 1
          : 0;

  return (
    satisfiedCount * 1_000_000 +
    Math.min(context, 999_999) +
    healthScore * 1_000 +
    costScore * 10 +
    // A recorded latency is a fact; an absent one is not. A known value always
    // outranks an unmeasured one, so an unmeasured provider can never be
    // preferred by masquerading as fast. Scale: 0ms -> 10, 10s+ -> 1.
    (Number.isFinite(latency) ? Math.max(1, 10 - Math.min(9, Math.round(latency / 1000))) : 0)
  );
}

export interface ScoredCandidate extends RoutingCandidate {
  readonly score: number;
}

/**
 * Scoring extension point.
 *
 * PHASE 01 provides only the deterministic comparator below. A future phase
 * may add weighted factors, but any such factor needs real measurement data
 * behind it; inventing weights now would encode unfounded policy.
 */
export interface ScoreFactor {
  readonly name: string;
  /** Returns a non-negative contribution. Must be deterministic. */
  score(candidate: RoutingCandidate, requirements: WorkloadRequirements): number;
}

export interface Scorer {
  readonly name: string;
  order(candidates: readonly RoutingCandidate[], requirements: WorkloadRequirements): readonly ScoredCandidate[];
}

export class VerifiedFactsScorer implements Scorer {
  public readonly name = "verified-facts";

  public order(
    candidates: readonly RoutingCandidate[],
    _requirements: WorkloadRequirements,
  ): readonly ScoredCandidate[] {
    return [...candidates]
      .map((candidate) => ({ ...candidate, score: computeVerifiedFactsRank(candidate) }))
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        // Total ordering: deterministic tie-break on identity.
        const keyA = `${a.provider.providerId}/${a.model?.modelId ?? ""}`;
        const keyB = `${b.provider.providerId}/${b.model?.modelId ?? ""}`;
        return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
      });
  }
}
