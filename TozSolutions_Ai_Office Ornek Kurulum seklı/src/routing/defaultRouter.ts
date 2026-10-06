import type { ModelRecord } from "../models/model.js";
import type { LifecycleState } from "../providers/lifecycle.js";
import type { ProviderRecord } from "../providers/provider.js";
import {
  type CandidateEvaluation,
  type CandidateSource,
  type ProviderRouter,
  type RoutingCandidate,
  type RoutingDecision,
  type RoutingRequest,
  applyCandidateExclusion,
  VerifiedFactsScorer,
  type Scorer,
  evaluateCandidate,
} from "./router.js";
import { explainPolicy, orderByPolicy, resolvePolicy } from "./policy.js";

/**
 * Default router: hard filter, then deterministic scoring.
 *
 * If nothing survives the filter the router returns a decision with
 * `selected: null` and the full rejection list. It never falls back to an
 * arbitrary candidate, because silently degrading the match is worse than
 * failing visibly and letting the caller escalate or surface the gap.
 */
export class DefaultRouter implements ProviderRouter {
  readonly #candidates: CandidateSource;
  readonly #scorer: Scorer;
  /** When true, `capability_unknown` candidates are admitted. Default: false. */
  readonly #allowUnknownCapabilities: boolean;

  public constructor(options: {
    candidates: CandidateSource;
    scorer?: Scorer;
    allowUnknownCapabilities?: boolean;
  }) {
    this.#candidates = options.candidates;
    this.#scorer = options.scorer ?? new VerifiedFactsScorer();
    this.#allowUnknownCapabilities = options.allowUnknownCapabilities ?? false;
  }

  /**
   * Deliberately asynchronous, returning the resolved value to satisfy the
   * `ProviderRouter` contract. The filter and scorer are pure CPU work with no I/O,
   * so there is nothing to await.
   *
   * PHASE 05: `async` rather than `Promise.resolve(this.#selectSync(request))`, and
   * the difference is not stylistic. A bad POLICY NAME now throws from inside the
   * method, and with the previous shape that throw escaped SYNCHRONOUSLY out of a
   * method whose declared return type is a promise - so `select(...).catch(...)` saw
   * nothing, and a caller who relied on the promise contract to handle a refused
   * policy got an unhandled exception instead. Refusing an unknown policy is only
   * useful if the refusal arrives where the caller is already looking.
   */
  public async select(request: RoutingRequest): Promise<RoutingDecision> {
    // The `await` is what makes the throw a REJECTION rather than a synchronous
    // escape. It has nothing to do with timing and must not be "optimised" away.
    return await Promise.resolve(this.#selectSync(request));
  }

  #selectSync(request: RoutingRequest): RoutingDecision {
    // PHASE 01 (C-1): the caller's exclusion is applied HERE, at the single point
    // where candidates enter the router. It used to be applied by `ModelRouter` to a
    // local array that was then discarded, so the denial never reached the only
    // place that decides eligibility. Narrowing first, then the hard filter, means
    // governance can remove a candidate but can never make an ineligible one
    // eligible, and `evaluateCandidate` cannot resurrect an excluded one.
    const all = applyCandidateExclusion(this.#candidates.candidates(), request.exclude);

    const evaluated: CandidateEvaluation[] = all.map((candidate) =>
      evaluateCandidate(candidate, request.requirements),
    );

    const eligible = evaluated.filter(
      (evaluation) =>
        evaluation.eligible ||
        (this.#allowUnknownCapabilities &&
          evaluation.rejections.length === 1 &&
          evaluation.rejections[0] === "capability_unknown"),
    );

    // PHASE 05 (B-09). Ordering is the only thing that changes, and only when a
    // policy was named. `evaluateCandidate` above is untouched, so eligibility is
    // still decided in exactly one place and a policy cannot reselect a candidate
    // the filter rejected.
    const policy = request.policy === undefined || request.policy === null ? null : resolvePolicy(request.policy);
    const eligibleCandidates = eligible.map((evaluation) => evaluation.candidate);
    const ordered =
      policy === null
        ? this.#scorer.order(eligibleCandidates, request.requirements)
        : orderByPolicy(eligibleCandidates, policy).ordered;

    const consideredOrder = ordered.map(
      (candidate) => `${candidate.provider.providerId}/${candidate.model?.modelId ?? ""}`,
    );

    const selected = ordered[0] ?? null;

    if (!selected) {
      const reasons = [...new Set(evaluated.flatMap((evaluation) => evaluation.rejections))];
      return {
        selected: null,
        evaluated,
        consideredOrder,
        selectionReason:
          reasons.length > 0
            ? `No eligible candidate. Rejection reasons: ${reasons.join(", ")}`
            : "No candidates were available.",
        selectionVerdict: null,
      };
    }

    if (policy === null) {
      const selectionReason = buildSelectionReason(selected, consideredOrder.length, request);
      return {
        selected,
        evaluated,
        consideredOrder,
        selectionReason,
        selectionVerdict: "compatible",
      };
    }

    // The explanation is computed from the ORDER, not from a template, so the
    // sentence a caller logs names the facts that actually separated the candidates -
    // including the ones that could not, because nothing recorded them.
    const comparison = orderByPolicy(eligibleCandidates, policy);
    const others = comparison.ordered.filter((candidate) => candidate !== selected);
    const explanation = explainPolicy(selected, others, policy);
    return {
      selected,
      evaluated,
      consideredOrder,
      selectionReason:
        `${explanation.statement} Considered ${consideredOrder.length} eligible candidate(s) for workload ` +
        `${request.workloadLabel ?? "unspecified"}.`,
      selectionVerdict: "compatible",
      ordering: {
        policy: policy.name,
        decidingFacts: [...comparison.decidingFacts],
        uninformedFacts: explanation.uninformedFacts,
      },
    };
  }
}

function buildSelectionReason(
  selected: RoutingCandidate,
  consideredCount: number,
  request: RoutingRequest,
): string {
  const modelId = selected.model?.modelId ?? "(no model)";
  return (
    `Selected ${selected.provider.providerId}/${modelId} by ${"verified-facts"} ordering ` +
    `from ${consideredCount} eligible candidate(s) for workload ` +
    `${request.workloadLabel ?? "unspecified"}. No weighted scoring applied.`
  );
}

/** Candidate source backed by the provider and model registries. */
export class RegistryCandidateSource implements CandidateSource {
  readonly #providers: () => readonly ProviderRecord[];
  readonly #modelsByProvider: (providerId: string) => readonly ModelRecord[];
  readonly #lifecycleOf: (providerId: string) => LifecycleState;

  public constructor(options: {
    providers: () => readonly ProviderRecord[];
    modelsByProvider: (providerId: string) => readonly ModelRecord[];
    lifecycleOf: (providerId: string) => LifecycleState;
  }) {
    this.#providers = options.providers;
    this.#modelsByProvider = options.modelsByProvider;
    this.#lifecycleOf = options.lifecycleOf;
  }

  public candidates(): readonly RoutingCandidate[] {
    const out: RoutingCandidate[] = [];
    for (const provider of this.#providers()) {
      const lifecycleState = this.#lifecycleOf(provider.providerId);
      const models = this.#modelsByProvider(provider.providerId);
      if (models.length === 0) {
        // A provider with no registered model is still a candidate: routing
        // to a provider directly is a valid case (model chosen downstream).
        out.push({ provider, model: null, lifecycleState });
        continue;
      }
      for (const model of models) {
        out.push({ provider, model, lifecycleState });
      }
    }
    return out;
  }
}
