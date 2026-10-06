/**
 * PHASE 08: integration with the authorities that already exist.
 *
 * This file is deliberately thin. Governance's job is to decide, and then to hand
 * that decision to the component that already enforces it:
 *
 *   REQUIRE_APPROVAL  ->  the PHASE 07 `ApprovalRegistry`, opened here but owned
 *                         there. No second gate, no second approval record.
 *   resource limits   ->  the PHASE 07 `budgetStatus`, extended with ceilings and
 *                         with the unpriced-spend rule preserved verbatim.
 *   a decision        ->  the ONE `TraceRecorder` history, redacted.
 *
 * What this file must never do, and cannot: route, select, orchestrate, write
 * memory, or verify. It holds no registry and no reference to any of them.
 */

import { type Clock, systemClock } from "../../core/clock.js";
import { type TraceRecorder, type OrchestrationEventKind } from "../observability/trace.js";
import { type Capability } from "../../capabilities/capability.js";
import { type SecurityContext } from "./context.js";
import { type GovernanceDecision, isAwaitingApproval, isPermitted } from "./decision.js";
import { type PolicyEngine } from "./policy.js";
import { type Operation } from "./operations.js";
import { type GovernanceResource } from "./decision.js";

/* -------------------------------------------------------------------------- */
/* Approval bridge                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The PHASE 07 surface governance needs, and nothing more.
 *
 * Declared as a port so governance does not hold a coordinator. It needs to be
 * able to ASK that a gate be opened and to READ the gate's state; it must not be
 * able to move a job, release a task, or run anything.
 */
export interface ApprovalGatePort {
  openApproval(input: {
    jobId: string;
    taskId: string;
    question: string;
    expiresAtMs?: number | null;
  }): { gateId: string; state: string };
  /** The current state of a gate, or null when there is none. */
  forTask(taskId: string): { gateId: string; state: string } | null;
}

export type ApprovalBridgeOutcome =
  | { readonly action: "proceed"; readonly decision: GovernanceDecision }
  | { readonly action: "blocked"; readonly decision: GovernanceDecision; readonly gateId: string; readonly detail: string }
  | { readonly action: "denied"; readonly decision: GovernanceDecision };

/**
 * Turns a governance decision into an instruction, opening a PHASE 07 gate when
 * approval is required.
 *
 * The ordering here is the whole point, and it is the ordering the brief
 * specifies:
 *
 *   DENY            -> the caller must not start. No gate is opened, because a
 *                      gate is a way to ASK, and asking about something already
 *                      refused would imply it might be permitted.
 *   REQUIRE_APPROVAL-> a gate is opened (or the existing one reused) and the
 *                      caller is blocked. PHASE 07's registry then enforces it,
 *                      so a retry, a fallback, a worker or an adapter cannot slip
 *                      past: they all reach this same gate.
 *   ALLOW           -> proceed.
 *   NOT_APPLICABLE  -> proceed; the subsystem's own authority decides.
 */
export function bridgeApproval(input: {
  decision: GovernanceDecision;
  gates: ApprovalGatePort | null;
  jobId: string;
  taskId: string;
  question?: string;
  expiresAtMs?: number | null;
}): ApprovalBridgeOutcome {
  const { decision } = input;
  if (decision.verdict === "DENY") {
    return { action: "denied", decision };
  }
  if (decision.verdict === "ALLOW" || decision.verdict === "NOT_APPLICABLE") {
    return { action: "proceed", decision };
  }

  if (input.gates === null) {
    // REQUIRE_APPROVAL with nowhere to ask is a refusal, not a pass. The strict
    // reading is the only safe one: "no gate available" must never mean "no
    // approval needed".
    return {
      action: "denied",
      decision,
    };
  }

  const existing = input.gates.forTask(input.taskId);
  if (existing !== null) {
    // Reuse the gate PHASE 07 already owns. Opening a second one for the same
    // task would be the competing-approval-system failure the brief names.
    if (existing.state === "approved") {
      return {
        action: "proceed",
        decision: { ...decision, approvalId: existing.gateId, approvalRequired: true },
      };
    }
    return {
      action: "blocked",
      decision: { ...decision, approvalId: existing.gateId },
      gateId: existing.gateId,
      detail: `Approval ${existing.gateId} for task "${input.taskId}" is ${existing.state}. The established gate is still blocking.`,
    };
  }

  const opened = input.gates.openApproval({
    jobId: input.jobId,
    taskId: input.taskId,
    question: input.question ?? `Approve "${decision.operation}" for task "${input.taskId}"?`,
    ...(input.expiresAtMs === undefined ? {} : { expiresAtMs: input.expiresAtMs }),
  });
  return {
    action: "blocked",
    decision: { ...decision, approvalId: opened.gateId },
    gateId: opened.gateId,
    detail: `Governance requires approval for "${decision.operation}"; gate ${opened.gateId} is open and the task stays blocked until a human resolves it.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Resource governance                                                         */
/* -------------------------------------------------------------------------- */

export interface ResourceLimits {
  /** Maximum simultaneous operations across all actors. null = unbounded. */
  readonly maxConcurrent: number | null;
  /** Maximum attempts a single operation may spend. null = no extra limit. */
  readonly maxAttempts: number | null;
  /** Maximum runtime for one operation, in ms. null = no governance limit. */
  readonly maxRuntimeMs: number | null;
  /** Whether a cost budget that cannot be evaluated stops the operation. */
  readonly blockOnUnknownCost: boolean;
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxConcurrent: null,
  maxAttempts: null,
  maxRuntimeMs: null,
  // TRUE by default. PHASE 07 already blocks when a cost budget exists and no
  // amount was reported, and governance must not relax that. It can be turned off
  // explicitly by a deployment that does not price its providers, and that choice
  // is recorded in the decision rather than being assumed.
  blockOnUnknownCost: true,
};

export interface ResourceState {
  readonly inFlight: number;
  readonly attemptsByActor: Readonly<Record<string, number>>;
  readonly startedAt: ReadonlyMap<string, number>;
}

export type ResourceVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reasonCode: "concurrency_limit" | "resource_budget_exceeded" | "resource_cost_unknown"; readonly reason: string };

/**
 * Governance's contribution to resource limits.
 *
 * A SEPARATE, additional check - not a replacement. PHASE 07's `budgetStatus`
 * remains authoritative for spend and attempts; this adds ceilings governance
 * cares about, and refuses when a cost is unknown and a budget requires one.
 *
 * The unknown-cost rule is preserved exactly: a provider that reported tokens and
 * no amount means the budget CANNOT BE EVALUATED, and that blocks. Reading it as
 * zero would make a cost budget decorative.
 */
export function checkResourceLimits(input: {
  limits: ResourceLimits;
  state: ResourceState;
  actor: string;
  operation: Operation;
  nowMs: number;
  /** PHASE 07's own budget answer, consulted rather than recomputed. */
  budget?: { readonly mayProceed: boolean; readonly detail: string; readonly measuredAmount: number | null } | null;
}): ResourceVerdict {
  const { limits, state } = input;

  if (limits.maxConcurrent !== null && state.inFlight >= limits.maxConcurrent) {
    return {
      allowed: false,
      reasonCode: "concurrency_limit",
      reason: `The governance concurrency limit of ${limits.maxConcurrent} is reached. The operation is refused rather than queued indefinitely.`,
    };
  }

  const used = state.attemptsByActor[input.actor] ?? 0;
  if (limits.maxAttempts !== null && used >= limits.maxAttempts) {
    return {
      allowed: false,
      reasonCode: "resource_budget_exceeded",
      reason: `"${input.actor}" has spent all ${limits.maxAttempts} governance-permitted attempt(s) of "${input.operation}".`,
    };
  }

  const started = state.startedAt.get(input.actor);
  if (limits.maxRuntimeMs !== null && started !== undefined && input.nowMs - started > limits.maxRuntimeMs) {
    return {
      allowed: false,
      reasonCode: "resource_budget_exceeded",
      reason: `"${input.actor}" has run for ${input.nowMs - started}ms, over the governance runtime limit of ${limits.maxRuntimeMs}ms.`,
    };
  }

  if (limits.blockOnUnknownCost && input.budget !== undefined && input.budget !== null) {
    if (!input.budget.mayProceed) {
      return {
        allowed: false,
        reasonCode: input.budget.measuredAmount === null ? "resource_cost_unknown" : "resource_budget_exceeded",
        reason: input.budget.detail,
      };
    }
  }

  return { allowed: true };
}

/** Tracks the in-flight and attempt state the limits above are checked against. */
export class ResourceTracker08 {
  readonly #inFlight = new Map<string, number>();
  readonly #attempts = new Map<string, number>();
  readonly #startedAt = new Map<string, number>();
  readonly #clock: Clock;

  public constructor(options: { clock?: Clock } = {}) {
    this.#clock = options.clock ?? systemClock;
  }

  public begin(actor: string): number {
    const next = (this.#inFlight.get(actor) ?? 0) + 1;
    this.#inFlight.set(actor, next);
    this.#attempts.set(actor, (this.#attempts.get(actor) ?? 0) + 1);
    if (!this.#startedAt.has(actor)) {
      this.#startedAt.set(actor, this.#clock.nowMs());
    }
    return next;
  }

  public end(actor: string): void {
    const current = this.#inFlight.get(actor) ?? 0;
    if (current <= 1) {
      this.#inFlight.delete(actor);
      this.#startedAt.delete(actor);
    } else {
      this.#inFlight.set(actor, current - 1);
    }
  }

  public totalInFlight(): number {
    let total = 0;
    for (const value of this.#inFlight.values()) {
      total += value;
    }
    return total;
  }

  public attemptsOf(actor: string): number {
    return this.#attempts.get(actor) ?? 0;
  }

  public state(): ResourceState {
    return {
      inFlight: this.totalInFlight(),
      attemptsByActor: Object.fromEntries(this.#attempts),
      startedAt: new Map(this.#startedAt),
    };
  }

  public clear(): void {
    this.#inFlight.clear();
    this.#attempts.clear();
    this.#startedAt.clear();
  }
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

export interface GovernanceRecorderOptions {
  readonly engine: PolicyEngine;
  readonly traces?: TraceRecorder | null;
  readonly clock?: Clock;
}

/**
 * Records governance decisions into the ONE history.
 *
 * The decision's metadata was already redacted when the decision was built, so
 * there is nothing sensitive left to strip here. What this adds is the audit
 * event, so a decision is visible alongside the work it governed rather than only
 * inside the governance engine.
 */
export class GovernanceRecorder {
  readonly #engine: PolicyEngine;
  readonly #traces: TraceRecorder | null;
  readonly #clock: Clock;

  public constructor(options: GovernanceRecorderOptions) {
    this.#engine = options.engine;
    this.#traces = options.traces ?? null;
    this.#clock = options.clock ?? systemClock;
  }

  /**
   * The checks an operation passed, in one call.
   *
   * Ordered: policy first, then resource. A policy refusal is recorded and the
   * resource check is not performed, because refusing on cost after permitting on
   * authority would put a cheaper explanation on the more fundamental refusal.
   */
  public authorize(input: {
    context: SecurityContext | null;
    operation: string;
    resource?: GovernanceResource | null;
    capability?: Capability | null;
    scope?: string | null;
    limits?: ResourceLimits;
    tracker?: ResourceTracker08;
    budget?: { readonly mayProceed: boolean; readonly detail: string; readonly measuredAmount: number | null } | null;
    policy?: string;
  }): { readonly decision: GovernanceDecision; readonly permitted: boolean; readonly resource: ResourceVerdict | null } {
    const decision = this.#engine.check({
      // A null context is passed straight through: the engine turns it into a
      // `malformed_context` DENY, which is the correct answer for a caller that
      // could not or would not supply authority.
      context: input.context as never,
      operation: input.operation,
      ...(input.resource === undefined ? {} : { resource: input.resource }),
      ...(input.capability === undefined ? {} : { capability: input.capability }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      ...(input.policy === undefined ? {} : { policy: input.policy }),
    });
    this.#record(decision, input.context);

    if (decision.verdict === "DENY") {
      return { decision, permitted: false, resource: null };
    }

    let resource: ResourceVerdict | null = null;
    if (input.limits !== undefined && input.tracker !== undefined) {
      resource = checkResourceLimits({
        limits: input.limits,
        state: input.tracker.state(),
        actor: input.context === null ? "unknown" : input.context.actor,
        operation: decision.operation ?? "workflow.execute",
        nowMs: this.#clock.nowMs(),
        ...(input.budget === undefined ? {} : { budget: input.budget }),
      });
      if (!resource.allowed) {
        this.#record(
          {
            ...decision,
            verdict: "DENY",
            reasonCode: resource.reasonCode,
            reason: resource.reason,
            evaluatedRules: [...decision.evaluatedRules, "resource-governance"],
          },
          input.context,
        );
        return { decision: { ...decision, verdict: "DENY", reasonCode: resource.reasonCode, reason: resource.reason }, permitted: false, resource };
      }
    }

    return {
      decision,
      permitted: isPermitted(decision) || decision.verdict === "NOT_APPLICABLE",
      resource,
    };
  }

  #record(decision: GovernanceDecision, context: SecurityContext | null): void {
    if (this.#traces === null) {
      return;
    }
    const kind: OrchestrationEventKind = "governance_decided";
    // Every field is read defensively. A malformed request produces a decision
    // with no context at all, and an audit path that throws on a malformed
    // request is an outage vector: the caller could not record the refusal, and
    // the refusal would look like it never happened.
    const principal = context === null ? "unknown" : (context.principal ?? "unknown");
    const actor = decision.actor ?? (context === null ? null : (context.actor ?? null));
    const delegationDepth = context === null ? 0 : context.delegation.length;
    this.#traces.record(
      kind,
      {
        traceId: decision.jobId ?? principal,
        // A governance decision may concern no task at all - an `admin.configure`
        // check has none - so this is a real possibility rather than a null guard.
        taskId: decision.taskId ?? (context === null ? null : context.taskId) ?? "governance",
        parentTaskId: null,
        teamId: null,
      },
      {
        verdict: decision.verdict,
        operation: decision.operation,
        actor,
        resource: decision.resource === null ? null : `${decision.resource.kind}:${decision.resource.id ?? ""}`,
        capability: decision.capability,
        scope: decision.scope,
        reasonCode: decision.reasonCode,
        reason: decision.reason,
        policy: decision.policy,
        approvalRequired: decision.approvalRequired,
        approvalId: decision.approvalId,
        workflowId: decision.workflowId,
        executionId: decision.executionId,
        trustLevel: decision.trustLevel,
        evaluatedRules: [...decision.evaluatedRules],
        // A refusal count per decision, so a reader can see a redaction happened
        // without being shown the value that was removed.
        delegationDepth,
      },
      new Date(decision.at),
    );
  }
}

export { isAwaitingApproval, isPermitted };
