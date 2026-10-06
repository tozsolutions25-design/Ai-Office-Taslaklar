/**
 * PHASE 09: the enforcement primitives, separated from the orchestration flow.
 *
 * These three functions were first written as private methods on `TozOrchestrator`
 * and are pulled out here for two reasons.
 *
 * First, auditability. The rule this module exists to make checkable is "an
 * unauthorised request never becomes a plan, never reaches routing, never reaches
 * a worker". A reader can verify that here, in one screen, without following
 * control flow through a 1500-line orchestrator.
 *
 * Second, they genuinely need no orchestrator state. Each is a pure function of
 * the gate, the request and its arguments - none of them mutates task state,
 * records a trace, or settles a result. `TozOrchestrator` still owns all three of
 * those, and still decides what to do with a refusal; it merely stops being the
 * place where the decision is COMPUTED.
 *
 * That separation is the safety property. An authorization check that can also
 * settle state is a check whose failure mode is ambiguous, and the tests in
 * `tests/governance.enforcement.test.ts` are only meaningful because a refusal
 * here cannot be anything other than a value.
 */

import { type AgentRecord } from "../agent/record.js";
import { type SubTask } from "../task/plan.js";
import {
  type RoutingRestriction,
  type SecurityContext,
} from "./index.js";
import { type OrchestratorGovernancePort } from "./gate.js";

/** The only request fields enforcement reads. Narrow on purpose. */
export interface EnforceableRequest {
  readonly taskId: string;
  readonly securityContext?: SecurityContext;
}

/** A refusal, in the shape the orchestrator's failure path already consumes. */
export interface EnforcementRefusal {
  readonly errorClass: "authorization_error" | "approval_required";
  readonly reason: string;
}

/** Null means "no refusal": the caller may proceed. */
export type EnforcementOutcome = EnforcementRefusal | null;

/**
 * An execution-level authorization, with the reason code that explains it.
 *
 * The code is carried rather than recomputed because a trace that says only
 * "refused" is not evidence: an operator reading a refused run needs to know
 * WHICH rule refused, and reconstructing that later from policy state is exactly
 * the kind of reconstruction that goes stale.
 */
export interface ExecutionAuthorization {
  readonly refusal: EnforcementRefusal | null;
  /**
   * The engine's reason code, when a decision was actually made. Null when no
   * gate is configured - which is itself a meaningful state, and must not be
   * rendered as though governance had declined.
   */
  readonly reasonCode: string | null;
  /** True when the caller could not be identified, so nothing was decided. */
  readonly unidentified: boolean;
}

const UNIDENTIFIED_ACTOR: EnforcementRefusal = {
  errorClass: "authorization_error",
  reason:
    "Governance is configured but the request carried no security context, so the actor could not be identified. An unidentified caller is not an authorised one.",
};

/**
 * PHASE 03 (B-08): establishes WHO is asking, before anything decides what they
 * may do.
 *
 * `identity.resolve` was documented as the runtime's identity source - "returning
 * null means this caller could not be identified, and the gate then
 * DEFAULT-DENIES" - and `GovernanceGate.resolve()` had no caller anywhere in
 * `src/`. The resolver was dead code, so a request carrying no context was refused
 * as unidentified WITHOUT the runtime ever being asked who it was.
 *
 * Three properties, each of which is a separate failure it prevents:
 *
 *   - a context the caller supplied is KEPT. Replacing it would mean the runtime
 *     overrode the party that actually asked, which is the opposite of
 *     establishing identity;
 *   - a request with no context is resolved ONCE, here, so every later check -
 *     execution, subtask capability, routing narrowing, the trace message - sees
 *     the same identity rather than a different answer each time;
 *   - null is left null. The resolver is not a default actor: a runtime that
 *     cannot identify a caller must not end up running work as somebody.
 *
 * Returns the SAME object when nothing changed, so an unchanged request is
 * `===` rather than merely equal.
 */
export function establishRequestIdentity<T extends EnforceableRequest>(
  gate: OrchestratorGovernancePort | undefined,
  request: T,
  traceId: string,
): T {
  if (gate === undefined || typeof gate.resolve !== "function") {
    return request;
  }
  if (request.securityContext !== undefined) {
    return request;
  }
  const resolved = gate.resolve({ taskId: request.taskId, jobId: null, traceId });
  if (resolved === null) {
    return request;
  }
  return { ...request, securityContext: resolved };
}

/**
 * Whether this caller may run this job at all.
 *
 * Checked before classification, planning, memory recall and execution, so a
 * refusal here means the work never started.
 *
 * `REQUIRE_APPROVAL` is reported as `approval_required` and the work stops. It is
 * NOT resolved here, because the orchestrator owns no approval gate: the
 * `ExecutionCoordinator` does. Creating a second gate would duplicate the one
 * authority meant to enforce approval, so this function says what is needed and
 * lets the caller re-drive the work through the coordinator.
 *
 * PHASE 03 HONESTY NOTE (BLOCKER B-10): nothing currently does that re-drive.
 * `bridgeApproval` - the function written to open the coordinator's gate from
 * exactly this verdict - has no call sites, so an operation named by
 * `governance.approvalRequired` fails closed with `approval_required` rather than
 * waiting for a human. Failing closed is the safe direction and is why this is a
 * blocker and not a defect that had to be closed before PHASE 03 could pass; a
 * configuration that said "needs approval" and was ignored would be fail-open.
 */
export function authorizeExecution(
  gate: OrchestratorGovernancePort | undefined,
  request: EnforceableRequest,
): ExecutionAuthorization {
  if (gate === undefined) {
    return { refusal: null, reasonCode: null, unidentified: false };
  }
  const securityContext = request.securityContext;
  if (securityContext === undefined) {
    return { refusal: UNIDENTIFIED_ACTOR, reasonCode: null, unidentified: true };
  }
  const outcome = gate.authorize({
    context: securityContext,
    operation: "workflow.execute",
    resource: { kind: "job", id: request.taskId },
    jobId: null,
    taskId: request.taskId,
  });
  if (outcome.permitted) {
    return { refusal: null, reasonCode: outcome.decision.reasonCode, unidentified: false };
  }
  return {
    refusal: {
      errorClass: outcome.errorClass === null ? "authorization_error" : outcome.errorClass,
      reason: outcome.awaitingApproval
        ? `${outcome.reason} The work is blocked: it must be re-driven through the ExecutionCoordinator, which owns the PHASE 07 approval gate.`
        : outcome.reason,
    },
    reasonCode: outcome.decision.reasonCode,
    unidentified: false,
  };
}

/**
 * Whether this caller may use this subtask's capabilities.
 *
 * The narrower, per-unit counterpart to `authorizeExecution`, and not redundant
 * with it: a job can be permitted while one of its subtasks names a capability
 * the policy denies some callers.
 *
 * EVERY required capability is checked before ANY is exercised, so a
 * multi-capability subtask cannot partially execute and then be refused - which
 * would leave side effects behind that the refusal could not unsay.
 *
 * PHASE 01 (C-4): WHAT IS AUTHORIZED IS NO LONGER THE SUBTASK'S LIST ALONE.
 *
 * This used to iterate `subtask.requiredCapabilities` and nothing else. That list
 * is supplied by whoever wrote the plan, so declaring it empty switched capability
 * enforcement off entirely: the loop body never ran and the function returned
 * "permitted" without ever consulting the gate. The `AgentRecord` argument was
 * passed in and used only for its id in the refusal message, so the registry's
 * authoritative statement of what an agent can do was never the thing being
 * authorized.
 *
 * The enforced set is now the UNION of the subtask's declared requirements and the
 * agent's own positively-supported capabilities. The direction matters: a subtask
 * may require MORE than the agent's record declares, but it can no longer require
 * LESS and thereby narrow enforcement to nothing. Policy is not caller-controlled;
 * the decision to consult it is now policy-driven rather than plan-driven.
 *
 * An agent that declares no supported capability, on a subtask that declares none,
 * has nothing to authorize and is not refused. `SpecialistPool` has already
 * matched declared capabilities against requirements before an agent is ever
 * selected, so there is no work here that such an agent could be about to do.
 */
export function authorizeSubtask(
  gate: OrchestratorGovernancePort | undefined,
  request: EnforceableRequest,
  agent: AgentRecord,
  subtask: SubTask,
): EnforcementOutcome {
  if (gate === undefined) {
    return null;
  }
  const securityContext = request.securityContext;
  if (securityContext === undefined) {
    // Already refused by `authorizeExecution` for the same request, so reaching
    // here without a context means the run was assembled in a way that first check
    // could not have covered. Refuse rather than assume.
    return {
      errorClass: "authorization_error",
      reason: `Subtask "${subtask.taskId}" has no identified actor, so its capabilities could not be authorized`,
    };
  }
  // Subtask-declared first, then the agent's own, so the refusal names the
  // capability the caller actually asked for before it names the agent's.
  const agentDeclared = [...agent.capabilities.entries()]
    .filter(([, status]) => status === "supported")
    .map(([capability]) => capability);
  const subject = [...new Set([...subtask.requiredCapabilities, ...agentDeclared])];
  for (const capability of subject) {
    const outcome = gate.authorize({
      context: securityContext,
      operation: "capability.execute",
      resource: { kind: "capability", id: capability },
      capability,
      jobId: null,
      taskId: subtask.taskId,
    });
    if (!outcome.permitted) {
      return {
        errorClass: outcome.errorClass === null ? "authorization_error" : outcome.errorClass,
        reason: `Agent "${agent.agentId}" may not use capability "${capability}" for subtask "${subtask.taskId}": ${outcome.reason}`,
      };
    }
  }
  return null;
}

/**
 * Governance's contribution to the candidate set, or null for none.
 *
 * Narrowing only, and that is structural rather than a promise: the return type
 * has no field for a preference, a score, a priority or a replacement, so this
 * function cannot express "route here instead" even if a caller tried.
 *
 * Defensive about a throwing port. A governance subsystem that errors must not
 * crash an otherwise healthy run, and the direction that preserves security is to
 * narrow rather than to widen: when the hook cannot be consulted, nothing is
 * removed and the hard filter still applies. That is a limitation, not a
 * guarantee.
 */
export function routingRestriction(
  gate: OrchestratorGovernancePort | undefined,
  request: EnforceableRequest,
  taskId: string,
): RoutingRestriction | null {
  if (gate === undefined || request.securityContext === undefined) {
    return null;
  }
  // The hook is OPTIONAL on the port, so "declines to narrow" and "narrows to
  // nothing" must both mean the same thing here: the candidate set is untouched.
  if (typeof gate.narrowRouting !== "function") {
    return null;
  }
  try {
    return gate.narrowRouting(request.securityContext, { taskId }) ?? null;
  } catch {
    return null;
  }
}

/**
 * The step-log line for an execution-level decision.
 *
 * Kept beside the decision so the trace a reader sees and the branch the code
 * took cannot drift apart, which is the failure that makes an audit trail
 * untrustworthy. The engine's own reason code is included, because "refused" on
 * its own is a claim rather than evidence.
 */
export function describeExecutionDecision(
  request: EnforceableRequest,
  authorization: ExecutionAuthorization,
): string {
  const code = authorization.reasonCode === null ? "undecided" : authorization.reasonCode;
  if (authorization.unidentified) {
    return "2b refused at governance: the caller supplied no security context, so no actor could be identified";
  }
  if (authorization.refusal === null) {
    return `2b governance allowed workflow.execute (${code}) for "${request.securityContext?.actor ?? "unknown"}"`;
  }
  return authorization.refusal.errorClass === "approval_required"
    ? `2b governance requires an approval before workflow.execute (${code}) for "${request.securityContext?.actor ?? "unknown"}"`
    : `2b governance refused workflow.execute (${code}) for "${request.securityContext?.actor ?? "unknown"}"`;
}
