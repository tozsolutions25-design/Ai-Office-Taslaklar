/**
 * Model router.
 *
 * AGENT AND MODEL ARE SEPARATE CONCERNS. An agent declares what it needs; the
 * router decides which provider and model serve it. An agent that hard-codes a
 * model cannot be re-pointed at a different one, and cannot work on a provider
 * that is down.
 *
 * This router does NOT reimplement routing. It translates agent requirements
 * into the `RoutingRequest` the existing PHASE 01 `ProviderRouter` already
 * understands, and returns its decision with its rejection list intact.
 *
 * A second routing authority would be the exact defect PHASE 04 exists to
 * prevent, so this is a thin adapter over the existing router rather than a new
 * implementation.
 */

import { type Capability } from "../../capabilities/capability.js";
import { type ProviderRegistry } from "../../providers/registry.js";
import { type ModelRegistry } from "../../models/registry.js";
import { type RoutingCandidate, type RoutingDecision, type ProviderRouter } from "../../routing/router.js";
import { type TrustLevel } from "../agent/trust.js";
import {
  type FallbackChain,
  type FallbackLimits,
  type RouteHop,
  FallbackPlanner,
  CooldownRegistry,
  mayFallback,
  recordHopOutcome,
} from "../../routing/fallback.js";
import { resolvePolicy } from "../../routing/policy.js";
import { type Clock, systemClock } from "../../core/clock.js";
import { type TaskPriority } from "../../workload/workload.js";
import { type RoutingRestriction, applyRoutingRestriction, toCandidateExclusion } from "../governance/policy.js";

export interface ModelRequirements {
  readonly taskId: string;
  readonly capabilities: readonly Capability[];
  readonly minimumTrust?: TrustLevel;
  readonly minContextTokens?: number | null;
  readonly costPreference?: "free_only" | "low_cost" | "balanced" | "premium";
  /**
   * PHASE 06, additive.
   *
   * Minimum output the expected response must fit into, and how urgently the work
   * needs to run. Priority affects only how much FALLBACK may be spent; it never
   * changes which candidates are eligible, because urgency is not a capability.
   */
  readonly minOutputTokens?: number | null;
  readonly priority?: TaskPriority;
  /** The routing policy to use. Absent means the configured default. */
  readonly policy?: string;
  /**
   * PHASE 09: candidates the caller has ruled out. OPTIONAL.
   *
   * Applied to the candidate set BEFORE PHASE 06 evaluateCandidate, so governance
   * narrows eligibility and the hard filter still decides. That ordering is the
   * whole point: governance cannot make an ineligible candidate eligible, and
   * evaluateCandidate cannot resurrect a denied one.
   *
   * Narrowing only, and enforced by construction: a RoutingRestriction has no
   * field for a preference, a score, a priority or a replacement, so a caller
   * holding one cannot express "route here instead" even if it tried.
   *
   * A port implementation that ignores this field is still correct; it simply
   * declines to narrow. ModelRouter honours it.
   */
  readonly denied?: RoutingRestriction | null;
  /** Fallback bounds for this request. */
  readonly fallback?: Partial<FallbackLimits>;
}

export interface ModelRoute {
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly decision: RoutingDecision | null;
  readonly reason: string;
}

export interface ModelRouterOptions {
  readonly providers: ProviderRegistry;
  readonly models: ModelRegistry;
  readonly router: ProviderRouter;
  /**
   * The routing policy to apply when a request names none.
   *
   * PHASE 02. SCOPE, stated precisely because the alternative is a claim this
   * module cannot support: it configures the **fallback chain** built by `plan()`,
   * and the **primary selection** made by `selectRoute()`.
   *
   * PHASE 05 widened the second half. The primary was `verified-facts` regardless of
   * this setting, and passing `policy` into `router.select()` was deliberately not
   * done - a line of code that looks like it wires something up and does not is the
   * exact defect D-03 documents. `RoutingRequest.policy` now carries it, and
   * `DefaultRouter` orders by it, so the two decisions are governed by one setting
   * and `RoutingDecision.ordering` reports which facts decided the primary.
   *
   * A name that is not a shipped policy is NOT silently replaced with the default:
   * it is resolved here, at construction, so the operator sees the failure where
   * they are looking instead of on the first request of the day.
   */
  readonly policy?: string;
}

/**
 * What the orchestrator needs from routing.
 *
 * A port, so the orchestrator depends on the ability to pick a provider and a
 * model rather than on this particular class. A caller with its own routing
 * policy (a private cluster, a fixed model per department) satisfies the same
 * contract without the orchestrator learning about it.
 *
 * There is still exactly ONE routing authority at runtime: whichever
 * implementation is supplied. The port does not permit a second router to be
 * consulted behind the orchestrator's back, because only one is ever passed in.
 */
export interface ModelRoutingPort {
  route(requirements: ModelRequirements): Promise<ModelRoute>;
  /**
   * PHASE 06: plan the full fallback chain for a request. OPTIONAL.
   *
   * `route()` answers "which one, now". This answers "which one, and if that
   * fails, what next" - a question an orchestrator needs answered before it
   * spends a latency budget it cannot yet see.
   *
   * It is optional because a deployment supplying its own routing policy should
   * not be forced to implement planning to use this port. An absent method means
   * "fallback availability is unknown", which is a different statement from
   * "there is no fallback", and callers must not confuse the two.
   */
  plan?(requirements: ModelRequirements): FallbackChain;
}

export class ModelRouter implements ModelRoutingPort {
  readonly #providers: ProviderRegistry;
  readonly #models: ModelRegistry;
  readonly #router: ProviderRouter;
  readonly #clock: Clock;
  readonly #policy: string | undefined;
  readonly #cooldown: CooldownRegistry;
  readonly #planner: FallbackPlanner;

  public constructor(options: ModelRouterOptions & { clock?: Clock }) {
    this.#providers = options.providers;
    this.#models = options.models;
    this.#router = options.router;
    this.#clock = options.clock ?? systemClock;
    // Resolved eagerly so a bad policy name fails at construction, where the
    // operator is looking, rather than on the first request of the day.
    this.#policy = options.policy === undefined ? undefined : resolvePolicy(options.policy).name;
    this.#cooldown = new CooldownRegistry();
    this.#planner = new FallbackPlanner({
      candidates: () => this.#candidates(),
      cooldown: this.#cooldown,
      clock: this.#clock,
    });
  }

  /** The deployment default FALLBACK policy, or null when none was configured. */
  public get policy(): string | null {
    return this.#policy ?? null;
  }

  /**
   * How the PRIMARY candidate is ordered.
   *
   * `"policy"` when a policy is configured, because the configured policy is now
   * what orders the primary. `"verified-facts"` when none is, which is the router's
   * own deterministic ordering over recorded facts.
   */
  public get selectionOrder(): "policy" | "verified-facts" {
    return this.#policy === undefined ? "verified-facts" : "policy";
  }

  /**
   * The shared anti-loop state.
   *
   * Exposed so a caller that drives several routers can see what is in cooldown.
   * It is read-mostly by design: the planner is the only thing that should put a
   * target into cooldown, and it does so from a recorded outcome.
   */
  public get cooldown(): CooldownRegistry {
    return this.#cooldown;
  }

  public async route(requirements: ModelRequirements): Promise<ModelRoute> {
    return this.selectRoute(requirements);
  }

  /** The routing decision, named for callers that only need the route. */
  public async selectRoute(requirements: ModelRequirements): Promise<ModelRoute> {
    // PHASE 01 (C-1). The exclusion is now HANDED TO THE ROUTER, rather than
    // applied to a local array that was then thrown away. Previously this method
    // computed the narrowed set, used it only for a length check, and then called
    // `#router.select()` with nothing but requirements - so the router re-derived
    // the full candidate set and a governance-denied provider was selected.
    const exclusion = toCandidateExclusion(requirements.denied ?? null);
    const candidates = applyRoutingRestriction(this.#candidates(), requirements.denied ?? null);

    if (candidates.length === 0) {
      return {
        providerId: null,
        modelId: null,
        decision: null,
        reason:
          requirements.denied === null || requirements.denied === undefined
            ? "No provider or model is registered, so no route exists"
            : `Governance denied every candidate for this request, so no route exists: ${requirements.denied.reason}`,
      };
    }

    const decision = await this.#router.select({
      requirements: {
        requiredCapabilities: requirements.capabilities,
        minContextTokens: requirements.minContextTokens ?? null,
        requiredTools: [],
        reliability: requirements.minimumTrust === "privileged" ? "critical" : "standard",
        latencyPreference: "balanced",
        costPreference: requirements.costPreference ?? "balanced",
        fallbackRequired: false,
      },
      workloadLabel: requirements.taskId,
      exclude: exclusion,
      // PHASE 05, closing B-09. The policy travels WITH the request, so the one
      // router can order the primaries by it. This is the line that was missing: the
      // configured policy reached the fallback chain and stopped there, so a
      // deployment's `defaultPolicy` did not govern the decision that mattered most
      // and nothing in the system said so.
      //
      // `null` when neither the request nor the deployment names one, which leaves
      // the router on `verified-facts` - today's behaviour, unchanged.
      policy: requirements.policy ?? this.#policy ?? null,
    });

    if (!decision.selected) {
      return {
        providerId: null,
        modelId: null,
        decision,
        reason: decision.selectionReason,
      };
    }

    return {
      providerId: decision.selected.provider.providerId,
      modelId: decision.selected.model?.modelId ?? null,
      decision,
      reason: decision.selectionReason,
    };
  }

  /**
   * The full fallback chain for a request.
   *
   * `route()` answers "which one, now". `plan()` answers "which one, and if that
   * fails, what next" - and the answer to the second question is the one the
   * orchestrator needs before it spends a latency budget it cannot yet see.
   *
   * The chain is built by `FallbackPlanner` over the SAME `evaluateCandidate`
   * filter `route()` uses, so the two can never disagree about eligibility. There
   * is still exactly one eligibility authority.
   */
  public plan(requirements: ModelRequirements): FallbackChain {
    const policy = requirements.policy ?? this.#policy;
    return this.#planner.plan({
      requirements: {
        requiredCapabilities: requirements.capabilities,
        minContextTokens: requirements.minContextTokens ?? null,
        requiredTools: [],
        reliability: requirements.minimumTrust === "privileged" ? "critical" : "standard",
        latencyPreference: "balanced",
        costPreference: requirements.costPreference ?? "balanced",
        fallbackRequired: false,
        ...(requirements.minOutputTokens === undefined ? {} : { minOutputTokens: requirements.minOutputTokens }),
        ...(requirements.priority === undefined ? {} : { priority: requirements.priority }),
        ...(policy === undefined ? {} : { policy }),
      },
      ...(policy === undefined ? {} : { policy }),
      ...(requirements.fallback === undefined ? {} : { limits: requirements.fallback }),
      // PHASE 01 (C-1): the chain must honour the same denial as `selectRoute`.
      // A fallback is attempted precisely because the primary route failed, so a
      // denial honoured on the first attempt and dropped here would fail open
      // exactly when the system is already degraded.
      exclude: toCandidateExclusion(requirements.denied ?? null),
    });
  }

  /**
   * Records the outcome of a hop, and reports whether another may be tried.
   *
   * The caller drives the chain; this only maintains the state that stops it
   * looping. `mayFallback` is false for background work, so a low-priority task
   * spends one attempt rather than the whole chain.
   */
  public recordOutcome(input: {
    hop: RouteHop;
    succeeded: boolean;
    priority?: TaskPriority;
    limits?: Partial<FallbackLimits>;
  }): { mayFallback: boolean; reason: string } {
    const limits: FallbackLimits = { maxHops: 3, cooldownMs: 60_000, ...input.limits };
    recordHopOutcome(this.#cooldown, input.hop, { success: input.succeeded }, limits, this.#clock.now().getTime());
    if (input.succeeded) {
      return { mayFallback: false, reason: "The hop succeeded; no fallback is needed." };
    }
    if (!mayFallback(input.priority)) {
      return {
        mayFallback: false,
        reason: "Background work does not spend fallback hops, so the task is failed rather than retried elsewhere.",
      };
    }
    const key = `${input.hop.candidate.provider.providerId}/${input.hop.candidate.model?.modelId ?? ""}`;
    return {
      mayFallback: true,
      reason: `Hop ${input.hop.index} (${key}) failed and is now in cooldown; a remaining eligible candidate may be tried.`,
    };
  }

  /**
   * Candidates drawn from the existing registries.
   *
   * Only providers that have reached the production pool appear, and only models
   * that are enabled. Lifecycle and approval therefore filter routing before it
   * starts, which is the point of the PHASE 01 lifecycle.
   */
  #candidates(): readonly RoutingCandidate[] {
    const out: RoutingCandidate[] = [];
    for (const provider of this.#providers.productionPool()) {
      const models = this.#models.listByProvider(provider.providerId).filter((model) => model.enabled);
      const lifecycle = this.#providers.lifecycleOf(provider.providerId)?.state ?? "discovered";
      if (models.length === 0) {
        out.push({ provider, model: null, lifecycleState: lifecycle });
        continue;
      }
      for (const model of models) {
        out.push({ provider, model, lifecycleState: lifecycle });
      }
    }
    return out;
  }
}
