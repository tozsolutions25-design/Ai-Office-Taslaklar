/**
 * PHASE 08: the policy engine.
 *
 * Governance controls execution. It does NOT orchestrate, does not route, and
 * does not hold authority it was not given. That boundary is enforced by
 * construction in this file:
 *
 *   - it holds no agent registry, no provider registry, no model registry and no
 *     router, so it cannot select a provider or an agent
 *   - its only output is a `GovernanceDecision`
 *   - its contribution to routing is a `RoutingRestriction`, which PHASE 06
 *     applies as a FILTER. It can remove a candidate; it cannot add one, choose
 *     one, or reorder one.
 *
 * DETERMINISM IS THE POINT. Rules are evaluated in a declared order, the first
 * non-`ALLOW` rule decides, and every rule that fired is recorded on the decision.
 * Two evaluations of the same input produce the same decision and the same
 * explanation, which is what makes an audit reproducible rather than a story.
 *
 * DEFAULT-DENY is scoped, not blanket. The brief warns against imposing
 * default-deny on unrelated internal mechanics, and the audit found three
 * subsystems that already answer their own questions correctly:
 * `authorizeToolCall` (tools), `MemoryAccessPolicy` (memory), and
 * `evaluateCandidate` (routing). Those keep their authority. Governance declares
 * itself `NOT_APPLICABLE` on them unless a policy explicitly takes an interest,
 * and even then it can only narrow.
 */

import { type Capability } from "../../capabilities/capability.js";
import { meetsTrustFloor, type TrustLevel } from "../agent/trust.js";
import { type Clock, systemClock } from "../../core/clock.js";
// TYPE-ONLY, and load-bearing. Governance must not CALL the routing layer -
// `tests/governance.architecture.test.ts` asserts no governance module imports
// `/routing/` at runtime, because governance decides and routing acts. Binding
// these two types binds nothing at runtime.
import { type CandidateExclusion, type RoutingCandidate } from "../../routing/router.js";
import {
  type GovernanceDecision,
  type GovernanceResource,
  type GovernanceVerdict,
  type ReasonCode,
  decide,
  malformed,
} from "./decision.js";
import {
  type Grant,
  type SecurityContext,
  delegate,
  grantFor,
  isDelegationLive,
} from "./context.js";
import {
  DEFAULT_TRUST_FLOORS,
  RESOURCE_BEARING_OPERATIONS,
  type Operation,
  isOperation,
  isSecuritySensitive,
} from "./operations.js";

/* -------------------------------------------------------------------------- */
/* Policy                                                                      */
/* -------------------------------------------------------------------------- */

/** One named rule. Deterministic: the same input always yields the same verdict. */
export interface GovernanceRule {
  readonly name: string;
  /**
   * `null` means "no opinion" - the rule defers to the next one. Every rule
   * therefore states a verdict, and the engine's own default-deny only applies if
   * the whole rule set returns `null`.
   */
  evaluate(request: GovernanceRequest): GovernanceVerdict | null;
  readonly reasonCode: ReasonCode;
}

export interface GovernanceRequest {
  readonly context: SecurityContext;
  readonly operation: Operation;
  readonly resource: GovernanceResource | null;
  readonly capability: Capability | null;
  readonly scope: string | null;
  /** Named policies that have already been consulted, for the explanation. */
  readonly policy: string;
  readonly at: number;
}

/* -------------------------------------------------------------------------- */
/* The engine                                                                  */
/* -------------------------------------------------------------------------- */

export interface PolicyEngineOptions {
  readonly rules: readonly GovernanceRule[];
  readonly clock?: Clock;
  /**
   * Operations governance declines to answer.
   *
   * The DEFAULT is the empty set, i.e. governance answers everything. A
   * deployment that wants governance to sit only beside the operations it owns
   * names the rest here, and those become `NOT_APPLICABLE` with
   * `subsystem_authoritative` - which is how PHASE 05's memory authority stays
   * authoritative without governance being disabled.
   */
  readonly deferToSubsystem?: readonly Operation[];
}

export interface CheckRequest {
  readonly context: SecurityContext;
  readonly operation: string;
  readonly resource?: GovernanceResource | null;
  readonly capability?: Capability | null;
  readonly scope?: string | null;
  readonly policy?: string;
  readonly jobId?: string | null;
  readonly workflowId?: string | null;
  readonly taskId?: string | null;
  readonly executionId?: string | null;
}

export class PolicyEngine {
  readonly #rules: readonly GovernanceRule[];
  readonly #clock: Clock;
  readonly #deferred: ReadonlySet<string>;
  readonly #decisions: GovernanceDecision[] = [];

  public constructor(options: PolicyEngineOptions) {
    this.#rules = [...options.rules];
    this.#clock = options.clock ?? systemClock;
    this.#deferred = new Set(options.deferToSubsystem ?? []);
  }

  public get ruleNames(): readonly string[] {
    return this.#rules.map((rule) => rule.name);
  }

  /** Every decision this engine has made, newest last. In memory. */
  public decisions(): readonly GovernanceDecision[] {
    return [...this.#decisions];
  }

  public refusals(): readonly GovernanceDecision[] {
    return this.#decisions.filter((decision) => decision.verdict === "DENY");
  }

  /**
   * The single decision point.
   *
   * Never throws for a caller error. A malformed request comes back as `DENY`,
   * because a thrown error on an execution path is a different thing from a
   * refusal, and a caller that only checks for exceptions would treat a malformed
   * authorization context as permission.
   */
  public check(request: CheckRequest): GovernanceDecision {
    const at = this.#clock.nowMs();
    const nowMs = this.#clock.nowMs();

    if (request.context === null || request.context === undefined) {
      return this.#record(
        malformed({ detail: "no security context was supplied", at, operation: request.operation }),
      );
    }
    if (!isOperation(request.operation)) {
      return this.#record(
        malformed({
          detail: `unknown operation "${String(request.operation)}"`,
          actor: request.context.actor,
          operation: request.operation,
          at,
        }),
      );
    }
    const operation = request.operation;
    const resource = request.resource ?? null;

    if (this.#deferred.has(operation)) {
      return this.#record(
        decide({
          verdict: "NOT_APPLICABLE",
          operation,
          actor: request.context.actor,
          resource,
          capability: request.capability ?? null,
          scope: request.scope ?? null,
          reasonCode: "subsystem_authoritative",
          reason: `Governance defers "${operation}" to the subsystem that owns it, which remains authoritative.`,
          policy: request.policy ?? "default",
          trustLevel: request.context.trustLevel,
          jobId: request.jobId ?? request.context.jobId,
          taskId: request.taskId ?? request.context.taskId,
          at,
        }),
      );
    }

    const evaluated: string[] = [];
    // Tracks whether ANY rule actually permitted. Without this, a rule set whose
    // rules all return `ALLOW` would still fall through to default-deny and
    // refuse an operation that was properly granted - a denial of correct
    // behaviour dressed up as a safety check.
    let permitted = false;
    const internal: GovernanceRequest = {
      context: request.context,
      operation,
      resource,
      capability: request.capability ?? null,
      scope: request.scope ?? null,
      policy: request.policy ?? "default",
      at: nowMs,
    };

    for (const rule of this.#rules) {
      const verdict = rule.evaluate(internal);
      if (verdict === null) {
        continue;
      }
      evaluated.push(rule.name);
      if (verdict === "ALLOW") {
        permitted = true;
        continue;
      }
      return this.#record(
        decide({
          verdict,
          operation,
          actor: request.context.actor,
          resource,
          capability: request.capability ?? null,
          scope: request.scope ?? null,
          reasonCode: rule.reasonCode,
          reason: RULE_REASONS[rule.reasonCode](internal, rule.name),
          policy: internal.policy,
          approvalRequired: verdict === "REQUIRE_APPROVAL",
          jobId: request.jobId ?? request.context.jobId,
          workflowId: request.workflowId ?? request.context.workflowId,
          taskId: request.taskId ?? request.context.taskId,
          executionId: request.executionId ?? request.context.executionId,
          trustLevel: request.context.trustLevel,
          evaluatedRules: evaluated,
          at,
        }),
      );
    }

    if (permitted) {
      return this.#record(
        decide({
          verdict: "ALLOW",
          operation,
          actor: request.context.actor,
          resource,
          capability: request.capability ?? null,
          scope: request.scope ?? null,
          reasonCode: "permission_granted",
          reason: `${evaluated.length} rule(s) permitted "${operation}" for "${request.context.actor}": ${evaluated.join(", ")}.`,
          policy: internal.policy,
          jobId: request.jobId ?? request.context.jobId,
          workflowId: request.workflowId ?? request.context.workflowId,
          taskId: request.taskId ?? request.context.taskId,
          executionId: request.executionId ?? request.context.executionId,
          trustLevel: request.context.trustLevel,
          evaluatedRules: evaluated,
          at,
        }),
      );
    }

    // Nothing permitted. A security-sensitive operation is denied, because
    // "nobody objected" is not "somebody permitted". This is the ONE place
    // default-deny is applied, and it applies only to operations that carry
    // authority - blanket default-deny over unrelated internal mechanics would
    // break subsystems that already answer correctly.
    if (isSecuritySensitive(operation)) {
      return this.#record(
        decide({
          verdict: "DENY",
          operation,
          actor: request.context.actor,
          resource,
          capability: request.capability ?? null,
          scope: request.scope ?? null,
          reasonCode: "permission_not_granted",
          reason: `No rule permitted "${operation}" for "${request.context.actor}". An operation nobody explicitly permitted is not permitted.`,
          policy: internal.policy,
          jobId: request.jobId ?? request.context.jobId,
          taskId: request.taskId ?? request.context.taskId,
          trustLevel: request.context.trustLevel,
          evaluatedRules: [...evaluated, "default-deny"],
          at,
        }),
      );
    }

    return this.#record(
      decide({
        verdict: "ALLOW",
        operation,
        actor: request.context.actor,
        resource,
        capability: request.capability ?? null,
        scope: request.scope ?? null,
        reasonCode: "no_policy_applies",
        reason: `No governance rule took an interest in "${operation}".`,
        policy: internal.policy,
        jobId: request.jobId ?? request.context.jobId,
        taskId: request.taskId ?? request.context.taskId,
        trustLevel: request.context.trustLevel,
        evaluatedRules: [...evaluated, "no-policy-applies"],
        at,
      }),
    );
  }

  #record(decision: GovernanceDecision): GovernanceDecision {
    this.#decisions.push(decision);
    return decision;
  }

  /* ---------------------------------------------------------------------- */
  /* Delegation, governed                                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Delegates, then RE-CHECKS the result against this engine.
   *
   * The re-check is not redundant. `delegate` guarantees the child holds a subset
   * of the parent's grants; this confirms the child's authority still passes
   * policy at the child's own trust level, which can be lower. A delegation that
   * narrows grants but not trust can still produce a child that policy would
   * refuse, and finding that out at delegation time is far better than at use.
   */
  public delegateAuthority(
    parent: SecurityContext,
    input: {
      readonly to: string;
      readonly operations: readonly Operation[];
      readonly resources?: readonly string[];
      readonly allowList?: readonly string[];
      readonly capabilities?: readonly Capability[];
      readonly scopes?: readonly string[];
      readonly expiresAt?: number | null;
      readonly resource?: GovernanceResource | null;
      readonly policy?: string;
    },
  ): { readonly ok: true; readonly context: SecurityContext } | { readonly ok: false; readonly detail: string } {
    const at = this.#clock.nowMs();
    const outcome = delegate(parent, { ...input, at });
    if (!outcome.ok) {
      return { ok: false, detail: outcome.detail };
    }
    for (const operation of input.operations) {
      const decision = this.check({
        context: outcome.context,
        operation,
        ...(input.resource === undefined ? {} : { resource: input.resource }),
        ...(input.policy === undefined ? {} : { policy: input.policy }),
      });
      if (decision.verdict === "DENY") {
        return {
          ok: false,
          detail: `The delegated authority for "${operation}" does not survive policy: ${decision.reason}`,
        };
      }
    }
    return { ok: true, context: outcome.context };
  }
}

/* -------------------------------------------------------------------------- */
/* Reasons                                                                     */
/* -------------------------------------------------------------------------- */

const RULE_REASONS: Readonly<Record<ReasonCode, (request: GovernanceRequest, rule: string) => string>> = {
  permission_granted: (request, rule) => `Rule "${rule}" granted "${request.operation}" to "${request.context.actor}".`,
  delegation_permits: (_request, rule) => `Rule "${rule}" allowed the operation through a delegation.`,
  no_policy_applies: (request, rule) => `Rule "${rule}" took no interest in "${request.operation}".`,
  within_trust_floor: (request, rule) => `Rule "${rule}" found trust sufficient for "${request.operation}".`,
  within_resource_budget: (_request, rule) => `Rule "${rule}" found the operation within its resource budget.`,
  unknown_actor: (request) => `The actor "${request.context.actor}" is not known to governance.`,
  unknown_permission: () => `The permission is not in the catalogue.`,
  unknown_resource: (request, rule) => `Rule "${rule}" could not resolve the resource for "${request.operation}".`,
  malformed_context: (request) => `The authorization context for "${request.operation}" is malformed.`,
  permission_not_granted: (request, rule) => `Rule "${rule}" found no grant of "${request.operation}" for "${request.context.actor}".`,
  scope_not_granted: (request, rule) => `Rule "${rule}" found "${request.scope ?? "(no scope)"}" outside the granted scopes.`,
  capability_not_permitted: (request, rule) => `Rule "${rule}" found "${request.capability ?? "(no capability)"}" not permitted.`,
  tool_not_permitted: (_request, rule) => `Rule "${rule}" refused this tool.`,
  provider_not_permitted: (_request, rule) => `Rule "${rule}" refused this provider.`,
  model_not_permitted: (_request, rule) => `Rule "${rule}" refused this model.`,
  below_trust_floor: (request, rule) => `Rule "${rule}" requires trust "${DEFAULT_TRUST_FLOORS[request.operation]}" and the actor is "${request.context.trustLevel}".`,
  delegation_expired: (request) => `The delegation under which "${request.context.actor}" acts has expired.`,
  delegation_out_of_scope: (request) => `The delegation under which "${request.context.actor}" acts does not cover "${request.operation}".`,
  resource_budget_exceeded: (_request, rule) => `Rule "${rule}" found the operation beyond its resource budget.`,
  resource_cost_unknown: (request) => `The cost of "${request.operation}" is unknown, and the budget requires a known cost. Unknown is not within limit.`,
  concurrency_limit: (request, rule) => `Rule "${rule}" found the concurrency limit reached for "${request.operation}".`,
  self_approval_forbidden: (request) => `"${request.context.actor}" may not resolve the approval for its own "${request.operation}".`,
  approval_required_not_granted: (request) => `"${request.operation}" requires an approval that has not been granted.`,
  side_effecting_operation: (request, rule) => `Rule "${rule}" requires approval because "${request.operation}" has side effects.`,
  privileged_operation: (request, rule) => `Rule "${rule}" requires approval because "${request.operation}" is privileged.`,
  explicit_approval_required: (request, rule) => `Rule "${rule}" requires an explicit approval for "${request.operation}".`,
  subsystem_authoritative: (request) => `The subsystem that owns "${request.operation}" is authoritative for it.`,
};

/* -------------------------------------------------------------------------- */
/* Shipped rules                                                               */
/* -------------------------------------------------------------------------- */

/**
 * RULE SEMANTICS, and the trap in them.
 *
 * A rule returns one of three things, and conflating the first two is a real bug
 * this file had:
 *
 *   `ALLOW`   the rule VERIFIED a requirement. An opinion.
 *   `DENY` / `REQUIRE_APPROVAL`  the rule REFUSED. Short-circuits.
 *   `null`    the rule has NO OPINION about this request. Evaluation continues.
 *
 * A rule that checks a requirement and finds it satisfied must return `ALLOW`, NOT
 * `null`. Returning `null` looks equivalent - "nothing to say" - but it leaves the
 * decision with no permitting rule, and the engine's default-deny then refuses an
 * operation that was properly granted. That is a denial of correct behaviour
 * wearing the costume of a safety check, and it is the reason "confirmed" and
 * "silent" are different values here.
 */

/** The actor must be known. An unknown principal is refused, never assumed. */
export class KnownActorRule implements GovernanceRule {
  public readonly name = "known-actor";
  public readonly reasonCode: ReasonCode = "unknown_actor";
  public constructor(private readonly known: (actor: string) => boolean) {}
  public evaluate(request: GovernanceRequest): GovernanceVerdict | null {
    if (request.context.actor.trim() === "") {
      return "DENY";
    }
    return this.known(request.context.actor) ? "ALLOW" : "DENY";
  }
}

/** The operation must hold a live grant. */
export class GrantRule implements GovernanceRule {
  public readonly name = "grant";
  public readonly reasonCode: ReasonCode = "permission_not_granted";
  public evaluate(request: GovernanceRequest): GovernanceVerdict | null {
    if (!isDelegationLive(request.context, request.at)) {
      return "DENY";
    }
    const grant = grantFor(request.context, request.operation, request.resource, request.at);
    return grant === null ? "DENY" : "ALLOW";
  }
}

/** The trust floor for the operation. */
export class TrustFloorRule implements GovernanceRule {
  public readonly name = "trust-floor";
  public readonly reasonCode: ReasonCode = "below_trust_floor";
  public evaluate(request: GovernanceRequest): GovernanceVerdict | null {
    const floor = DEFAULT_TRUST_FLOORS[request.operation] as TrustLevel;
    if (meetsTrustFloor(request.context.trustLevel, floor)) {
      return "ALLOW";
    }
    // A low-trust actor reaching a privileged operation does not get ALLOW, and
    // does not get REQUIRE_APPROVAL either: approval is a human decision, and
    // raising trust is a different one. It is refused.
    return "DENY";
  }
}

/** The resource must be inside the grant's allow-list, when it has one. */
export class ResourceAllowListRule implements GovernanceRule {
  public readonly name = "resource-allow-list";
  public readonly reasonCode: ReasonCode = "permission_not_granted";
  public evaluate(request: GovernanceRequest): GovernanceVerdict | null {
    if (!RESOURCE_BEARING_OPERATIONS[request.operation]) {
      return null;
    }
    const id = request.resource?.id ?? null;
    if (id === null) {
      return null;
    }
    const grant = grantFor(request.context, request.operation, request.resource, request.at);
    if (grant === null || grant.allowList.length === 0) {
      // No allow-list means the grant is deliberately broad, which `GrantRule`
      // has already confirmed. Nothing to add here.
      return null;
    }
    return grant.allowList.includes(id) ? "ALLOW" : "DENY";
  }
}

/** The capability must be permitted. */
export class CapabilityRule implements GovernanceRule {
  public readonly name = "capability";
  public readonly reasonCode: ReasonCode = "capability_not_permitted";
  public evaluate(request: GovernanceRequest): GovernanceVerdict | null {
    if (request.capability === null) {
      return null;
    }
    const permitted = request.context.grants
      .filter((grant) => grant.operation === request.operation)
      .flatMap((grant) => [...grant.capabilities]);
    if (permitted.length === 0) {
      return null;
    }
    return permitted.includes(request.capability) ? "ALLOW" : "DENY";
  }
}

/** The memory scope must be within the context's scopes. Narrowing only. */
export class ScopeRule implements GovernanceRule {
  public readonly name = "scope";
  public readonly reasonCode: ReasonCode = "scope_not_granted";
  public evaluate(request: GovernanceRequest): GovernanceVerdict | null {
    if (request.scope === null) {
      return null;
    }
    if (!request.operation.startsWith("memory.")) {
      return null;
    }
    if (request.context.scopes.length === 0) {
      // No scopes named means none are permitted. The same direction PHASE 05
      // takes when `writableScopes` is omitted.
      return "DENY";
    }
    return request.context.scopes.includes(request.scope) ? "ALLOW" : "DENY";
  }
}

/**
 * An approval as the approval authority recorded it, and nothing more.
 *
 * Every field is a fact about a gate that already exists. There is no verb here
 * through which a caller could create, decide or expire one - which is what makes
 * the observation safe to consult from a rule.
 */
export interface RecordedApproval {
  readonly gateId: string;
  readonly state: string;
  readonly decidedBy: string | null;
  readonly decidedAt: number | null;
}

/**
 * The one thing governance may ASK about an approval, and the ONLY thing.
 *
 * PHASE 03 (B-10). The `ApprovalRule` states a requirement; something has to be
 * able to answer it, and the answer has to come from the authority that actually
 * records approvals rather than from a field on the context being checked. This
 * port is that answer's route.
 *
 * It is read-only by construction: there is no `open`, no `decide` and no `expire`
 * verb on it, so a rule that consults it can observe an approval and can never
 * produce one. The governance layer names no workflow class anywhere near it - the
 * composition root supplies the implementation, so governance depends on the shape
 * of the question and not on where the answer is stored.
 *
 * EXPIRY IS NOT RE-DECIDED HERE. Whether a decided gate has gone stale is the
 * approval authority's rule, applied once, when the decision is made
 * (`ApprovalRegistry.decide` refuses to approve an expired gate). Re-deriving it in
 * a second place would let governance and the release path disagree about the same
 * gate, and two answers to "is this approved?" is the failure this project exists
 * to remove.
 */
export interface ApprovalGateObserver {
  observedApproval(input: { readonly jobId: string | null; readonly taskId: string | null }): RecordedApproval | null;
}

/**
 * Operations that always need a human.
 *
 * Emits `REQUIRE_APPROVAL`, which is the whole reason the decision is not a
 * boolean. The caller is expected to open a PHASE 07 approval gate, which remains
 * the thing that actually blocks execution.
 *
 * PHASE 03 REMOVED THE `context.approvalState === "approved"` SHORT-CIRCUIT.
 *
 * It read the caller's own claim: `approvalState` is a field on the context the
 * caller constructed, so anyone who wanted an operation approved wrote
 * `approvalState: "approved"` and walked through. Nothing in this repository ever
 * set it to `"approved"` by any other route, so the rule had exactly one
 * satisfiable path and it was caller-attested - the same fail-open shape as an
 * asserted actor, one layer up.
 *
 * PHASE 03 (B-10) REPLACED IT WITH A RECORDED DECISION. A rule may consult a
 * record it cannot write; it must not consult a field the party it is checking
 * wrote for itself. So the rule asks `ApprovalGateObserver` - read-only, supplied
 * by the composition root, backed by the ONE registry that records approvals - and
 * is satisfied only by a gate that registry says is approved, that names who
 * decided it, and that carries the timestamp of that decision.
 *
 * FAIL-CLOSED AT EVERY STEP, which is the direction that matters:
 *
 *   - no observer wired            -> REQUIRE_APPROVAL (the pre-wiring behaviour)
 *   - no job or task to look up    -> REQUIRE_APPROVAL
 *   - no gate for that job and task-> REQUIRE_APPROVAL
 *   - a gate in any other state    -> REQUIRE_APPROVAL
 *   - a gate with no decider, or a
 *     decision with no timestamp   -> REQUIRE_APPROVAL
 *
 * The lookup is keyed on the JOB as well as the task, because a task id is unique
 * only within a job. Keyed on the task alone, one job's approval would satisfy
 * another job's identically-named task - which is the PHASE 10 bypass, reproduced
 * in a new place.
 */
export class ApprovalRule implements GovernanceRule {
  public readonly name = "approval";
  public readonly reasonCode: ReasonCode = "privileged_operation";
  public constructor(
    private readonly approvalRequired: readonly Operation[],
    private readonly observer: ApprovalGateObserver | null = null,
  ) {}
  public evaluate(request: GovernanceRequest): GovernanceVerdict | null {
    if (!this.approvalRequired.includes(request.operation)) {
      return null;
    }
    return this.#satisfiedBy(request) ? null : "REQUIRE_APPROVAL";
  }

  /**
   * Whether a RECORDED approval answers this requirement.
   *
   * A separate method because "the rule found what it was looking for" and "the
   * rule found nothing" are different answers with different reasons, and a reader
   * should be able to see the whole of the fail-closed chain in one place.
   */
  #satisfiedBy(request: GovernanceRequest): boolean {
    const observer = this.observer;
    if (observer === null) {
      return false;
    }
    const jobId = request.context.jobId;
    const taskId = request.context.taskId ?? request.resource?.id ?? null;
    if (jobId === null || jobId === "" || taskId === null || taskId === "") {
      return false;
    }
    const observed = observer.observedApproval({ jobId, taskId });
    if (observed === null || observed.state !== "approved") {
      return false;
    }
    // An approval nobody signed and an approval nobody can date are not approvals.
    // A gate record that says "approved" with no decider is exactly the shape the
    // PHASE 03 freeze work was about.
    return observed.decidedBy !== null && observed.decidedBy.trim() !== "" && observed.decidedAt !== null;
  }
}

/**
 * Who may resolve an approval.
 *
 * Governance decides this; PHASE 07's `ApprovalRegistry` enforces it. A worker
 * may never resolve its own approval, and a delegated context never inherits its
 * parent's approval state - so handing authority to an agent cannot hand it the
 * approval that authorises the hand-off.
 */
export class ApprovalResolverRule implements GovernanceRule {
  public readonly name = "approval-resolver";
  public readonly reasonCode: ReasonCode = "self_approval_forbidden";
  public constructor(private readonly operation: Operation = "approval.resolve") {}
  public evaluate(request: GovernanceRequest): GovernanceVerdict | null {
    if (request.operation !== this.operation) {
      return null;
    }
    const target = request.resource?.id ?? null;
    if (target === null) {
      return "DENY";
    }
    if (request.context.actor === target) {
      return "DENY";
    }
    return null;
  }
}

/**
 * A governance predicate supplied by the caller, for resource checks that need
 * live state (a budget, a concurrency counter) the engine cannot see.
 *
 * Returning `null` means "no opinion", which is distinct from allowing: an
 * external check that has not run has not permitted anything.
 */
export class ExternalCheckRule implements GovernanceRule {
  public readonly name: string;
  public readonly reasonCode: ReasonCode;
  readonly #check: (request: GovernanceRequest) => GovernanceVerdict | null;

  public constructor(input: {
    name: string;
    reasonCode: ReasonCode;
    check: (request: GovernanceRequest) => GovernanceVerdict | null;
  }) {
    this.name = input.name;
    this.reasonCode = input.reasonCode;
    this.#check = input.check;
  }

  public evaluate(request: GovernanceRequest): GovernanceVerdict | null {
    return this.#check(request);
  }
}

/* -------------------------------------------------------------------------- */
/* Routing restriction - NARROWING ONLY                                         */
/* -------------------------------------------------------------------------- */

/**
 * What governance may say about a routing candidate.
 *
 * ONLY the negative. There is deliberately no `preferred`, no `score` and no
 * `order` field, because any of those would make governance a second router -
 * exactly what the brief forbids and what PHASE 06 spent its effort preventing.
 *
 * Governance can remove a provider, a model, or a whole class of candidates.
 * It cannot add one, and it cannot express a preference between two candidates
 * it has permitted.
 */
export interface RoutingRestriction {
  readonly deniedProviders: readonly string[];
  readonly deniedModels: readonly string[];
  /** Deny every candidate whose provider has this type. */
  readonly deniedProviderTypes: readonly string[];
  readonly reason: string;
  readonly decidedBy: string;
}

/**
 * Applies a restriction to PHASE 06 candidates.
 *
 * A FILTER, applied before `evaluateCandidate`. Governance removes candidates
 * here; `evaluateCandidate` remains the hard eligibility authority, and policy
 * ordering remains PHASE 06's. Nothing here reorders anything.
 */
export function applyRoutingRestriction(
  candidates: readonly RoutingCandidate[],
  restriction: RoutingRestriction | null,
): readonly RoutingCandidate[] {
  // Self-contained on purpose. This module must not CALL the routing layer -
  // governance decides, routing acts - and `tests/governance.architecture.test.ts`
  // enforces that no governance module imports `/routing/` at runtime. The three
  // conditions below are therefore written out here rather than delegated to the
  // core's `applyCandidateExclusion`, which is a runtime function. Type-only
  // imports are permitted, which is why `RoutingCandidate` and
  // `CandidateExclusion` appear above and nothing from routing is invoked.
  if (restriction === null) {
    return candidates;
  }
  return candidates.filter((candidate) => {
    if (restriction.deniedProviders.includes(candidate.provider.providerId)) {
      return false;
    }
    if (restriction.deniedProviderTypes.includes(candidate.provider.type)) {
      return false;
    }
    if (
      candidate.model !== null &&
      restriction.deniedModels.includes(`${candidate.provider.providerId}/${candidate.model.modelId}`)
    ) {
      return false;
    }
    return true;
  });
}

/**
 * PHASE 01 (C-1): `RoutingRestriction` in core routing terms.
 *
 * `core` cannot import `orchestration/governance/`, and governance cannot import
 * `core` at runtime, so the denylist is translated at the boundary by a pure
 * mapping rather than shared by import. The translation is total and mechanical:
 * three lists to three lists, and a `null` restriction to a `null` exclusion so
 * "governance said nothing" is never rendered as "governance denied everything".
 *
 * The reason this exists at all is that `ModelRouter` had nowhere to put a
 * `RoutingRestriction` when calling the router, so it applied one locally and
 * dropped it. A denial that cannot travel to the only component that decides
 * eligibility is not a denial.
 *
 * This function only PRODUCES the description. The core applies it. Governance
 * still cannot make a provider eligible, cannot rank, and cannot select.
 */
export function toCandidateExclusion(
  restriction: RoutingRestriction | null,
): CandidateExclusion | null {
  if (restriction === null) {
    return null;
  }
  return {
    providerIds: restriction.deniedProviders,
    modelKeys: restriction.deniedModels,
    providerTypes: restriction.deniedProviderTypes,
  };
}

export { type Grant };
