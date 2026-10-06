/**
 * Specialist pool.
 *
 * Answers "which agents COULD take this task, and why these were rejected" â€” a
 * capability question â€” and then deterministically orders the survivors.
 *
 * The system must be able to answer, for every selection:
 *
 *   why was this agent selected?
 *   why were the others rejected?
 *   which capabilities matched?
 *   which policy selected it?
 *
 * That is why every candidate, selected or not, carries a `CandidateAssessment`
 * with a reason. A selection that cannot be explained is indistinguishable from
 * an arbitrary one.
 *
 * TWO STAGES, mirroring the existing `DefaultRouter` rather than reinventing it:
 *
 *   1. FILTER â€” hard eligibility from recorded facts.
 *   2. ORDER  â€” deterministic ranking over recorded facts only.
 *
 * No numeric weights are invented. Where a fact is unmeasured it contributes
 * nothing, which means an unmeasured agent never wins a comparison it has not
 * earned.
 */

import { type Capability } from "../../capabilities/capability.js";
import { matchCapabilities, type CapabilityMatch } from "../../capabilities/match.js";
import { isRoutableStatus } from "../../health/health.js";
import { type TrustLevel } from "../agent/trust.js";
import { type AgentRecord, isSelectableStatus, costRank } from "../agent/record.js";
import { trustRank } from "../agent/trust.js";
import { type MemoryScope } from "../memory/memory.js";
import { type LearningSignal, signalWeight } from "../feedback/learningSignal.js";

/**
 * Why a candidate is ineligible. A selection must be able to say this.
 *
 * PHASE 08: `"unhealthy"` was REMOVED. It was unreachable rather than merely unused -
 * `HEALTH_STATUSES` is `unknown | healthy | degraded | unavailable | disabled`, so no
 * input can produce an unhealthy agent and the reason could never appear in a decision.
 * `unavailable` and `disabled` health are both reported as `agent_health_not_routable`,
 * which is what the pool has always pushed for them, so nothing was lost: the fiction went,
 * the report stayed.
 */
export const REJECTION_REASONS = [
  "not_available",
  "agent_disabled",
  "agent_health_not_routable",
  "capability_incompatible",
  "capability_unverified",
  "trust_below_floor",
  "missing_tool",
  "missing_provider",
  "memory_scope_unavailable",
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface SelectionRequest {
  readonly taskId: string;
  readonly requiredCapabilities: readonly Capability[];
  /** Minimum trust level. An agent below this is never selected. */
  readonly minimumTrust: TrustLevel;
  /** Tool names that must be available. */
  readonly requiredTools?: readonly string[];
  /** Provider ids that must be registered. */
  readonly requiredProviders?: readonly string[];
  /** Memory scopes that must be granted. */
  readonly requiredMemoryScopes?: readonly MemoryScope[];
  /** When true, a capability with no positive declaration is withheld. */
  readonly requireVerifiedCapabilities?: boolean;
  /**
   * Optional learning signals, keyed by agent key.
   *
   * Used ONLY inside the ranking, and only as a tiebreaker. It cannot make an
   * ineligible agent eligible, because eligibility is settled before it is
   * consulted. Absent means no learning is applied at all, which keeps selection
   * explainable by default.
   */
  readonly learningSignals?: ReadonlyMap<string, LearningSignal>;
}

export interface CandidateAssessment {
  readonly agentKey: string;
  readonly agent: AgentRecord;
  readonly eligible: boolean;
  readonly rejections: readonly RejectionReason[];
  readonly capabilityMatch: CapabilityMatch;
  /** Higher ranks first. Derived only from recorded facts. */
  readonly rank: number;
  readonly rationale: string;
}

/** One agent, assessed on its own. Not a routing decision. */
export interface Candidate {
  readonly agent: AgentRecord;
  /**
   * Lifecycle state, as the agent registry reports it.
   *
   * Carried on the candidate rather than looked up through a context callback,
   * because it is per VERSION: `researcher@1.0.0` can be available while
   * `researcher@2.0.0` is still only registered, and a lookup by agent id alone
   * cannot tell those apart.
   */
  readonly lifecycle: string;
}

export interface SelectionDecision {
  readonly selected: readonly CandidateAssessment[];
  readonly rejected: readonly CandidateAssessment[];
  readonly selectedAgent: AgentRecord | null;
  readonly reason: string;
}

export interface PoolContext {
  /** Registered provider ids. */
  readonly providerIds: () => readonly string[];
  /** Tool names currently available. */
  readonly availableTools: () => readonly string[];
  /** Memory scopes granted to the requesting subject. */
  readonly grantedMemoryScopes: () => readonly MemoryScope[];
}

/**
 * Assesses one candidate against a request.
 *
 * Pure. Exported so the reasoning is independently testable and so a caller can
 * explain a single agent without running a whole selection.
 */
export function assessCandidate(
  agent: AgentRecord,
  lifecycle: string,
  request: SelectionRequest,
  context: PoolContext,
): CandidateAssessment {
  const rejections: RejectionReason[] = [];

  if (lifecycle !== "available") {
    rejections.push("not_available");
  }
  if (!isSelectableStatus(agent.status)) {
    rejections.push("agent_disabled");
  }
  if (!isRoutableStatus(agent.health.status)) {
    rejections.push("agent_health_not_routable");
  }

  // Trust is a gate: a floor, not a score. An untrusted integration can be
  // registered and visible while never being selected.
  if (trustRank(agent.trustLevel) < trustRank(request.minimumTrust)) {
    rejections.push("trust_below_floor");
  }

  // Capability verdict comes from the existing matcher, so a capability that is
  // undeclared here is undeclared everywhere.
  const capabilityMatch = matchCapabilities(request.requiredCapabilities, agent.capabilities);
  if (capabilityMatch.verdict === "incompatible") {
    rejections.push("capability_incompatible");
  } else if (capabilityMatch.verdict === "unknown") {
    if (request.requireVerifiedCapabilities === true) {
      rejections.push("capability_unverified");
    }
  }

  const availableTools = new Set(context.availableTools());
  for (const tool of agent.toolRequirements) {
    if (!availableTools.has(tool)) {
      rejections.push("missing_tool");
      break;
    }
  }

  const providers = new Set(context.providerIds());
  for (const providerId of agent.providerRequirements) {
    if (!providers.has(providerId)) {
      rejections.push("missing_provider");
      break;
    }
  }

  const granted = new Set(context.grantedMemoryScopes());
  for (const scope of agent.memoryScopes) {
    if (!granted.has(scope)) {
      rejections.push("memory_scope_unavailable");
      break;
    }
  }

  const rank = computeRank(agent, capabilityMatch, request.learningSignals?.get(agentKeyOf(agent)) ?? null);
  return {
    agentKey: `${agent.agentId}@${agent.version}`,
    agent,
    eligible: rejections.length === 0,
    rejections,
    capabilityMatch,
    rank,
    rationale: buildRationale(agent, capabilityMatch, rejections, rank),
  };
}

function agentKeyOf(agent: AgentRecord): string {
  return `${agent.agentId}@${agent.version}`;
}

/**
 * Deterministic ranking over recorded facts.
 *
 * Ordered so that capability coverage dominates: an agent that fully supports the
 * required set outranks one that supports it only because an unknown capability
 * was not withheld. Trust, health and measured latency follow. An unmeasured
 * latency contributes nothing rather than a favourable default, and `costClass`
 * of `unknown` ranks last, so an unmeasured agent cannot be preferred as cheap.
 *
 * The final term is the agent key, which gives a total order and therefore a
 * reproducible result.
 */
export function computeRank(
  agent: AgentRecord,
  capabilityMatch: CapabilityMatch,
  signal: LearningSignal | null = null,
): number {
  // Coverage counts the absolute number of satisfied requirements and subtracts
  // for gaps. A ratio would be wrong here: two candidates are always assessed
  // against the SAME required set, so the ratio is identical for both and
  // cannot break a tie, whereas the absolute count can.
  const satisfied = capabilityMatch.satisfied.length;
  const gaps = capabilityMatch.gaps.length;
  // The recorded-fact terms are each far larger than the learning term, so a
  // signal can only decide between candidates that are otherwise equal. This is
  // structural, not a convention: there is no arrangement of facts that a signal
  // can overturn.
  const coverage = satisfied * 1_000_000 - gaps * 100_000;
  const trust = trustRank(agent.trustLevel) * 10_000;
  const health = agent.health.status === "healthy" ? 3_000 : agent.health.status === "degraded" ? 2_000 : 1_000;
  const cost = (4 - costRank(agent.costClass)) * 100;
  // A measured latency is a fact; an absent one contributes nothing.
  const latency =
    agent.measuredLatencyMs === null
      ? 0
      : Math.max(1, 99 - Math.min(99, Math.round(agent.measuredLatencyMs / 100)));
  const learning = signalWeight(signal);
  return coverage + trust + health + cost + latency + learning;
}

function buildRationale(
  agent: AgentRecord,
  match: CapabilityMatch,
  rejections: readonly RejectionReason[],
  rank: number,
): string {
  if (rejections.length > 0) {
    return `Rejected: ${rejections.join(", ")}.`;
  }
  const satisfied = match.satisfied.length === 0 ? "no required capabilities" : match.satisfied.join(", ");
  return `Eligible. Supports ${satisfied}. Trust "${agent.trustLevel}", health "${agent.health.status}", cost "${agent.costClass}", rank ${rank}.`;
}

/**
 * The specialist pool.
 *
 * Holds no agents of its own: candidates are supplied, so the pool cannot become
 * a second registry. It cannot execute or choose a model. It produces an
 * ordered, explained selection.
 */
export interface PoolOptions {
  readonly candidates: () => readonly Candidate[];
  /**
   * The HIGHEST trust floor a task may demand. A request above it is REFUSED.
   *
   * PHASE 08: this doc said "Rejects a task whose trust floor is BELOW this", which is the
   * opposite of what the code has always done - it refuses one that is ABOVE. A guard that
   * reads as the reverse of its behaviour is a guard somebody eventually removes.
   *
   * It is a misconfiguration guard, not a default. `defaultMinimumTrust` - the floor used
   * when a task states none - is a different setting, and PHASE 08 found the two wired to
   * each other, which meant the shipped default of `"low"` silently refused every task that
   * asked for `standard` or more.
   */
  readonly maximumTrustFloor?: TrustLevel;
  /** Rejects a limit above this, so a swarm cannot be requested by accident. */
  readonly maximumSelectedAgents?: number;
}

export class SpecialistPool {
  readonly #candidates: () => readonly Candidate[];
  readonly #maximumTrustFloor: TrustLevel;
  readonly #maximumSelectedAgents: number;

  public constructor(options: PoolOptions) {
    this.#candidates = options.candidates;
    this.#maximumTrustFloor = options.maximumTrustFloor ?? "privileged";
    this.#maximumSelectedAgents = options.maximumSelectedAgents ?? 8;
  }

  public assess(request: SelectionRequest, context: PoolContext): readonly CandidateAssessment[] {
    return this.#candidates().map((candidate) =>
      assessCandidate(candidate.agent, candidate.lifecycle, request, context),
    );
  }

  /**
   * Selects candidates.
   *
   * `limit` defaults to 1: the smallest sufficient choice. Returning more is
   * explicit, because running several agents when one suffices costs tokens,
   * latency and failure surface for nothing.
   */
  public select(
    request: SelectionRequest,
    context: PoolContext,
    limit = 1,
  ): SelectionDecision {
    const assessed = this.assess(request, context);
    const rejectedOnly = assessed.filter((a) => !a.eligible);

    if (trustRank(request.minimumTrust) > trustRank(this.#maximumTrustFloor)) {
      return {
        selected: [],
        rejected: rejectedOnly,
        selectedAgent: null,
        reason: `Requested trust floor "${request.minimumTrust}" exceeds the configured maximum "${this.#maximumTrustFloor}"`,
      };
    }
    if (!Number.isInteger(limit) || limit < 1) {
      return {
        selected: [],
        rejected: rejectedOnly,
        selectedAgent: null,
        reason: "Selection limit must be a positive integer",
      };
    }
    if (limit > this.#maximumSelectedAgents) {
      return {
        selected: [],
        rejected: rejectedOnly,
        selectedAgent: null,
        reason: `Requested ${limit} agents, which exceeds the configured maximum of ${this.#maximumSelectedAgents}`,
      };
    }

    const eligible = assessed.filter((candidate) => candidate.eligible);
    const rejected = rejectedOnly;

    const ordered = [...eligible].sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank;
      // Total order, so the result is reproducible rather than dependent on
      // insertion order.
      return a.agentKey < b.agentKey ? -1 : a.agentKey > b.agentKey ? 1 : 0;
    });

    const selected = ordered.slice(0, limit);
    const reason =
      selected.length === 0
        ? rejected.length === 0
          ? "No agents are registered as candidates"
          : `No eligible agent. ${rejected.length} candidate(s) rejected: ${[...new Set(rejected.flatMap((r) => r.rejections))].join(", ")}`
        : `Selected ${selected.map((candidate) => candidate.agentKey).join(", ")} by deterministic rank from ${eligible.length} eligible of ${assessed.length} candidate(s).`;

    return {
      selected,
      rejected,
      selectedAgent: selected[0]?.agent ?? null,
      reason,
    };
  }
}
