/**
 * PHASE 08: the governance decision.
 *
 * FOUR STATES, NOT A BOOLEAN.
 *
 * The existing `SecurityDecision` in `policy/security.ts` is
 * `{allowed: true|false, reason: string}`, and it works for what it does - a
 * binary screen on inbound text. It cannot express "a human must decide this
 * first", so an operation that needs approval is currently forced to either allow
 * or deny. This is the gap PHASE 08 closes, and it is closed with a NEW type
 * rather than by changing the existing one: rewriting `SecurityDecision` would
 * ripple through the orchestrator's screening step and every policy implementation
 * for a need that screen does not have.
 *
 * The four states, and what each obliges the caller to do:
 *
 *   ALLOW            proceed
 *   DENY             do not proceed; the reason is mandatory
 *   REQUIRE_APPROVAL do not proceed until a human decides at the PHASE 07 gate
 *   NOT_APPLICABLE   governance has no opinion; the SUBSYSTEM's own authority
 *                    decides. Never a euphemism for ALLOW.
 *
 * `NOT_APPLICABLE` is the one that is easy to get wrong. It exists so governance
 * can decline to answer a question that a better-placed authority answers better -
 * PHASE 05 already answers "may this subject read this memory scope", and
 * governance's job there is to not override it, not to re-answer it worse.
 */

import { type TrustLevel } from "../agent/trust.js";
import { type Capability } from "../../capabilities/capability.js";
import { redactWithReport } from "../../audit/redaction.js";
import { type Operation, isOperation } from "./operations.js";

export const GOVERNANCE_DECISIONS = ["ALLOW", "DENY", "REQUIRE_APPROVAL", "NOT_APPLICABLE"] as const;
export type GovernanceVerdict = (typeof GOVERNANCE_DECISIONS)[number];

export function isGovernanceVerdict(value: unknown): value is GovernanceVerdict {
  return typeof value === "string" && (GOVERNANCE_DECISIONS as readonly string[]).includes(value);
}

/** Why a decision went the way it did. Named, so a policy author can find it. */
export const REASON_CODES = [
  // allow
  "permission_granted",
  "delegation_permits",
  "no_policy_applies",
  "within_trust_floor",
  "within_resource_budget",
  // deny
  "unknown_actor",
  "unknown_permission",
  "unknown_resource",
  "malformed_context",
  "permission_not_granted",
  "scope_not_granted",
  "capability_not_permitted",
  "tool_not_permitted",
  "provider_not_permitted",
  "model_not_permitted",
  "below_trust_floor",
  "delegation_expired",
  "delegation_out_of_scope",
  "resource_budget_exceeded",
  "resource_cost_unknown",
  "concurrency_limit",
  "self_approval_forbidden",
  "approval_required_not_granted",
  // require approval
  "side_effecting_operation",
  "privileged_operation",
  "explicit_approval_required",
  // not applicable
  "subsystem_authoritative",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * The resource a decision is about.
 *
 * Explicit rather than a bag of optional fields, because a decision about
 * "something" is not a decision. `kind` says what sort of thing, and the
 * identifier is the value in the registry that owns it.
 */
export interface GovernanceResource {
  readonly kind: "agent" | "capability" | "tool" | "provider" | "model" | "memory_scope" | "workflow" | "job" | "task" | "budget";
  /** A registry id, or a scope name. Null when the resource is the job itself. */
  readonly id: string | null;
}

/**
 * A decision, with everything needed to audit it.
 *
 * `metadata` is passed through `redact` before it is stored, so a caller cannot
 * accidentally record a secret by putting one in a reason. That is the reason the
 * redaction is applied in the constructor rather than left to the caller.
 */
export interface GovernanceDecision {
  readonly verdict: GovernanceVerdict;
  readonly operation: Operation | null;
  readonly actor: string | null;
  readonly resource: GovernanceResource | null;
  readonly capability: Capability | null;
  readonly scope: string | null;
  readonly reasonCode: ReasonCode;
  /** Human-readable. Never a secret: the metadata has already been redacted. */
  readonly reason: string;
  /** The named policy that produced this, for "which rule decided it". */
  readonly policy: string | null;
  /** Set when `verdict` is `REQUIRE_APPROVAL` or an approval was consulted. */
  readonly approvalRequired: boolean;
  readonly approvalId: string | null;
  /** Correlation ids, so a decision is traceable to the work it governed. */
  readonly jobId: string | null;
  readonly workflowId: string | null;
  readonly taskId: string | null;
  readonly executionId: string | null;
  readonly trustLevel: TrustLevel | null;
  /** Every rule that fired, in evaluation order. More than one is normal. */
  readonly evaluatedRules: readonly string[];
  readonly at: number;
}

function allow(verdict: GovernanceVerdict, rest: Omit<GovernanceDecision, "verdict" | "at"> & { readonly at: number }): GovernanceDecision {
  return { verdict, ...rest };
}

/**
 * Builds a decision, redacting its metadata.
 *
 * The redaction is not optional and not the caller's job. A governance decision
 * carries actor, resource, capability and scope names, and a caller that puts a
 * token into any of them - by mistake, or by copying a request wholesale - would
 * otherwise write it into the one log that is supposed to be safe to keep.
 */
export function decide(input: {
  readonly verdict: GovernanceVerdict;
  readonly operation: Operation | null;
  readonly actor: string | null;
  readonly resource?: GovernanceResource | null;
  readonly capability?: Capability | null;
  readonly scope?: string | null;
  readonly reasonCode: ReasonCode;
  readonly reason: string;
  readonly policy?: string | null;
  readonly approvalRequired?: boolean;
  readonly approvalId?: string | null;
  readonly jobId?: string | null;
  readonly workflowId?: string | null;
  readonly taskId?: string | null;
  readonly executionId?: string | null;
  readonly trustLevel?: TrustLevel | null;
  readonly evaluatedRules?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly at: number;
}): GovernanceDecision {
  const { value: redacted, redactedFields } = redactWithReport({
    reason: input.reason,
    ...(input.metadata ?? {}),
  });
  const redactedRecord = (typeof redacted === "object" && redacted !== null ? redacted : {}) as Record<string, unknown>;

  // `redactWithReport` names fields it redacted BY KEY. A secret pasted into a
  // free-text reason has no suspicious key and so is not reported by name - it is
  // still redacted, but the report alone would make the decision look clean.
  // Comparing the result against the input catches both cases, so the recorded
  // claim matches what actually happened.
  const redactedSomething =
    redactedFields.length > 0 || stableStringify(redactedRecord) !== stableStringify({ reason: input.reason, ...(input.metadata ?? {}) });

  const rules = [...(input.evaluatedRules ?? []), input.reasonCode];
  if (redactedSomething) {
    // Recorded, so a reader can tell a clean reason from a sanitised one. Silently
    // redacting would make a decision look innocuous when it was not.
    rules.push("redacted");
  }

  return allow(input.verdict, {
    operation: input.operation,
    actor: input.actor,
    resource: input.resource ?? null,
    capability: input.capability ?? null,
    scope: input.scope ?? null,
    reasonCode: input.reasonCode,
    reason: typeof redactedRecord["reason"] === "string" ? redactedRecord["reason"] : input.reason,
    policy: input.policy ?? null,
    approvalRequired: input.approvalRequired ?? input.verdict === "REQUIRE_APPROVAL",
    approvalId: input.approvalId ?? null,
    jobId: input.jobId ?? null,
    workflowId: input.workflowId ?? null,
    taskId: input.taskId ?? null,
    executionId: input.executionId ?? null,
    trustLevel: input.trustLevel ?? null,
    evaluatedRules: rules,
    at: input.at,
  });
}

/* -------------------------------------------------------------------------- */
/* Adaptation to the existing binary screen                                     */
/* -------------------------------------------------------------------------- */

import { type SecurityDecision } from "../policy/security.js";

/**
 * Narrows a governance decision to the existing binary `SecurityDecision`.
 *
 * Used ONLY at the pre-existing screening boundary, which has exactly two states.
 * `REQUIRE_APPROVAL` becomes `allowed: false` there - deliberately the STRICT
 * reading. A screen that cannot express "wait for a human" must not pass the
 * operation through while approval is outstanding, because the boundary that does
 * express it has not been reached yet.
 */
export function toSecurityDecision(decision: GovernanceDecision): SecurityDecision {
  return decision.verdict === "ALLOW"
    ? { allowed: true, reason: decision.reason }
    : { allowed: false, reason: decision.reason };
}

/** Whether a decision permits the operation to start now. */
export function isPermitted(decision: GovernanceDecision): boolean {
  return decision.verdict === "ALLOW";
}

/** Whether the operation is blocked until a human decides. */
export function isAwaitingApproval(decision: GovernanceDecision): boolean {
  return decision.verdict === "REQUIRE_APPROVAL" || decision.reasonCode === "approval_required_not_granted";
}

/**
 * A minimal, order-independent-enough serializer for comparing two values.
 *
 * Only used to answer "did redaction change anything?", so it needs to be
 * deterministic and total, not fast or elegant. Key order is sorted so two
 * structurally equal objects always produce the same string.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

/**
 * A malformed request.
 *
 * Returned rather than thrown, so a caller on an execution path has to handle it
 * like any other decision and cannot accidentally treat a thrown error as "allow".
 */
export function malformed(input: {
  readonly detail: string;
  readonly actor?: string | null;
  readonly operation?: unknown;
  readonly at: number;
  readonly jobId?: string | null;
  readonly taskId?: string | null;
}): GovernanceDecision {
  return decide({
    verdict: "DENY",
    operation: isOperation(input.operation) ? input.operation : null,
    actor: input.actor ?? null,
    reasonCode: "malformed_context",
    reason: `Refused: the authorization context is malformed. ${input.detail}`,
    policy: "default-deny",
    ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    at: input.at,
  });
}
