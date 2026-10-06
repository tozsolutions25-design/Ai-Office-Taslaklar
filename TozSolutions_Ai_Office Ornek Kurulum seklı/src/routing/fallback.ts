/**
 * PHASE 06: controlled fallback.
 *
 * A fallback chain is an ordered list of candidates that ALL passed the same hard
 * filter. The invariant that makes this safe:
 *
 *   FALLBACK CAN NEVER WIDEN ELIGIBILITY.
 *
 * Every hop is drawn from the filtered set, so a fallback can only ever move
 * between models that independently satisfy the task's requirements. There is no
 * "degraded mode" and no "last resort" that relaxes a capability, because a
 * relaxed capability is not a fallback, it is a different task executed with the
 * wrong tool. When the chain is exhausted the route fails, visibly.
 *
 * The second invariant is about loops. A system that re-routes to a provider
 * which just failed will ping-pong until something else breaks, so a failed
 * target is placed in COOLDOWN and is not eligible for fallback again until the
 * cooldown expires. Cooldown is driven by an injected clock, so it is testable
 * and reproducible.
 */

import { type Clock, systemClock } from "../core/clock.js";
import { type TaskPriority, type WorkloadRequirements } from "../workload/workload.js";
import {
  type CandidateEvaluation,
  type CandidateExclusion,
  type RoutingCandidate,
  applyCandidateExclusion,
  evaluateCandidate,
} from "./router.js";
import {
  type PolicyExplanation,
  type RoutingPolicy,
  candidateKey,
  explainPolicy,
  orderByPolicy,
  resolvePolicy,
} from "./policy.js";

/** Why a hop in a chain is what it is. */
export const HOP_REASONS = ["primary", "fallback"] as const;
export type HopReason = (typeof HOP_REASONS)[number];

export interface RouteHop {
  readonly candidate: RoutingCandidate;
  /** 0 for the primary, 1+ for each fallback. */
  readonly index: number;
  readonly reason: HopReason;
  /** Why this hop follows the one before it, in plain words. */
  readonly rationale: string;
  /** Present on the primary only: the full policy explanation. */
  readonly explanation?: PolicyExplanation;
}

export interface FallbackLimits {
  /**
   * Maximum hops, including the primary.
   *
   * Bounded on purpose. An unbounded chain over a slow provider is a latency
   * budget nobody agreed to, and a chain of fifty is a sign that eligibility is
   * too loose, not that fallback is working.
   */
  readonly maxHops: number;
  /**
   * How long a failed target is skipped, in ms.
   *
   * Zero disables cooldown, which the tests use to exercise the loop guard
   * explicitly. Production leaves it non-zero.
   */
  readonly cooldownMs: number;
}

export const DEFAULT_FALLBACK_LIMITS: FallbackLimits = { maxHops: 3, cooldownMs: 60_000 };

/**
 * Records which targets recently failed, and for how long they are skipped.
 *
 * The whole anti-loop mechanism. It is deliberately tiny and explicit rather than
 * a general cache, because its only job is "do not immediately retry something
 * that just failed".
 */
export class CooldownRegistry {
  readonly #until = new Map<string, number>();

  /**
   * No clock is held here on purpose.
   *
   * Every method takes `nowMs` explicitly. A hidden clock would make "is this
   * target still cooling down?" a question about time rather than about state,
   * and the one thing a cooldown must be is reproducible in a test.
   */
  public markFailed(key: string, nowMs: number, cooldownMs: number): void {
    if (cooldownMs <= 0) {
      // Explicitly disabled. Removing any prior entry keeps the state honest
      // rather than leaving a stale cooldown from an earlier configuration.
      this.#until.delete(key);
      return;
    }
    this.#until.set(key, nowMs + cooldownMs);
  }

  public markSucceeded(key: string): void {
    this.#until.delete(key);
  }

  public isCoolingDown(key: string, nowMs: number): boolean {
    const until = this.#until.get(key);
    if (until === undefined) {
      return false;
    }
    if (until <= nowMs) {
      // Expired. Dropped so the map cannot grow without bound over a long run.
      this.#until.delete(key);
      return false;
    }
    return true;
  }

  public remainingMs(key: string, nowMs: number): number {
    return this.isCoolingDown(key, nowMs) ? (this.#until.get(key) ?? 0) - nowMs : 0;
  }

  public coolingKeys(nowMs: number): readonly string[] {
    return [...this.#until.keys()].filter((key) => this.isCoolingDown(key, nowMs));
  }

  public clear(): void {
    this.#until.clear();
  }
}

export interface FallbackChainRequest {
  readonly requirements: WorkloadRequirements;
  /** Overrides `requirements.policy`. */
  readonly policy?: string | null;
  readonly limits?: Partial<FallbackLimits>;
  /**
   * PHASE 01 (C-1): the caller's narrowing-only exclusion, exactly as
   * `RoutingRequest.exclude`.
   *
   * A fallback chain is the most dangerous place for a governance denial to be
   * lost, because a chain is tried precisely when the primary route FAILED - so a
   * denial that was honoured on the first attempt and dropped on the retry would
   * fail open exactly when the system is already under stress. The exclusion is
   * applied before the hard filter, so `plan()` and `select()` can never disagree
   * about eligibility.
   */
  readonly exclude?: CandidateExclusion | null;
}

export interface FallbackChain {
  /** Ordered hops. Empty when nothing was eligible. */
  readonly hops: readonly RouteHop[];
  /** Every candidate the filter rejected, with its reasons. */
  readonly rejected: readonly CandidateEvaluation[];
  /** Targets skipped because they were in cooldown. */
  readonly coolingDown: readonly string[];
  readonly policy: string;
  /** Why there is no route, or why the chain looks the way it does. */
  readonly summary: string;
}

export class FallbackPlanner {
  readonly #candidates: () => readonly RoutingCandidate[];
  readonly #cooldown: CooldownRegistry;
  readonly #clock: Clock;

  public constructor(options: {
    candidates: () => readonly RoutingCandidate[];
    cooldown?: CooldownRegistry;
    clock?: Clock;
  }) {
    this.#candidates = options.candidates;
    this.#cooldown = options.cooldown ?? new CooldownRegistry();
    this.#clock = options.clock ?? systemClock;
  }

  public get cooldown(): CooldownRegistry {
    return this.#cooldown;
  }

  /**
   * Builds the chain.
   *
   * Order of operations, and the order matters:
   *   1. filter - the existing hard eligibility rule, unchanged
   *   2. cooldown - remove targets that just failed
   *   3. order - the caller's policy
   *   4. truncate - to `maxHops`
   *
   * Cooldown is applied AFTER filtering and BEFORE ordering, so a cooling target
   * is never counted as eligible and never influences the order of the rest.
   */
  public plan(request: FallbackChainRequest): FallbackChain {
    const policy: RoutingPolicy = resolvePolicy(request.policy ?? request.requirements.policy);
    const limits: FallbackLimits = { ...DEFAULT_FALLBACK_LIMITS, ...request.limits };
    const nowMs = this.#clock.now().getTime();

    const all = applyCandidateExclusion(this.#candidates(), request.exclude);
    const evaluated = all.map((candidate) => evaluateCandidate(candidate, request.requirements));
    const eligible = evaluated.filter((evaluation) => evaluation.eligible);

    const cooling: string[] = [];
    const available: RoutingCandidate[] = [];
    for (const evaluation of eligible) {
      const key = candidateKey(evaluation.candidate);
      if (this.#cooldown.isCoolingDown(key, nowMs)) {
        cooling.push(key);
        continue;
      }
      available.push(evaluation.candidate);
    }

    const { ordered } = orderByPolicy(available, policy);
    const chosen = ordered.slice(0, Math.max(1, limits.maxHops));

    const hops: RouteHop[] = chosen.map((candidate, index) => {
      const explanation = index === 0 ? explainPolicy(candidate, chosen.slice(1), policy) : undefined;
      return {
        candidate,
        index,
        reason: index === 0 ? "primary" : "fallback",
        rationale:
          index === 0
            ? (explanation?.statement ?? "Selected as the highest-ranked eligible candidate.")
            : `Fallback hop ${index}: eligible for the same requirements, ranked below the candidate above.`,
        ...(explanation === undefined ? {} : { explanation }),
      };
    });

    const rejected = evaluated.filter((evaluation) => !evaluation.eligible);

    if (hops.length === 0) {
      const reasons = [...new Set(rejected.flatMap((evaluation) => evaluation.rejections))];
      const coolingNote =
        cooling.length === 0 ? "" : ` ${cooling.length} further candidate(s) were in cooldown.`;
      return {
        hops,
        rejected,
        coolingDown: cooling,
        policy: policy.name,
        summary:
          all.length === 0
            ? "No provider or model is registered, so no route exists."
            : `No route exists under the "${policy.name}" policy. Rejection reasons: ${reasons.join(", ")}.${coolingNote}`,
      };
    }

    return {
      hops,
      rejected,
      coolingDown: cooling,
      policy: policy.name,
      summary:
        `${hops.length} hop(s) built under the "${policy.name}" policy.` +
        (hops.length > 1
          ? ` Fallback is available: ${hops.length - 1} further candidate(s) satisfy the same requirements.`
          : " No further candidate satisfies the requirements, so there is no fallback."),
    };
  }
}

/** Records a hop's outcome into the cooldown registry. */
export function recordHopOutcome(
  cooldown: CooldownRegistry,
  hop: RouteHop,
  outcome: { success: boolean },
  limits: FallbackLimits = DEFAULT_FALLBACK_LIMITS,
  nowMs: number = Date.now(),
): void {
  const key = candidateKey(hop.candidate);
  if (outcome.success) {
    cooldown.markSucceeded(key);
    return;
  }
  cooldown.markFailed(key, nowMs, limits.cooldownMs);
}

/**
 * Whether another hop may be tried.
 *
 * `urgent` work may exhaust the chain; `background` work stops after the primary
 * rather than spending a latency budget nobody asked for. Eligibility is never
 * affected by priority - this only governs how much fallback is spent.
 */
export function mayFallback(priority: TaskPriority | undefined): boolean {
  return priority !== "background";
}


