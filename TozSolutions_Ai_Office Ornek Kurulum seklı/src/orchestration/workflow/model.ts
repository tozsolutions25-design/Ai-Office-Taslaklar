/**
 * PHASE 07: the execution domain model.
 *
 * These are RECORDS, not behaviour. Every one is immutable, and every one carries
 * the identifiers needed to trace an execution from the job through the worker,
 * the agent, the provider and the verification result.
 *
 * What is deliberately NOT here:
 *
 *   - A provider or model field on a task. A task states a capability
 *     requirement; which provider satisfies it is decided by PHASE 06 routing and
 *     by nothing else. A task that could name a model would let a job bypass
 *     `evaluateCandidate`, which is the single hard eligibility authority.
 *   - Arbitrary agent state on a Job. A job carries a typed, bounded set of
 *     constraints. Free-form state on a durable record is how a persisted object
 *     becomes an unversioned schema nobody can migrate.
 *   - A cost estimate. `ResourceBudget` holds measured spend only; where a
 *     provider reported no price, the contribution is absent rather than zero.
 */

import { type ErrorClass } from "../../core/errors.js";
import { type Capability } from "../../capabilities/capability.js";
import { type TrustLevel } from "../agent/trust.js";
import { type TaskPriority } from "../../workload/workload.js";
import { type WorkspaceRef } from "../workspace/workspace.js";
// PHASE 03 (B-08). The job records WHO submitted it, because the identity a
// background task runs as is exactly the identity an approval would be
// accepting - so the two answers cannot live in different layers.
//
// A TYPE-ONLY import of the frozen value object, and nothing else. The workflow
// layer never constructs a context, never reads a grant and never decides
// policy; it transports the one identity shape PHASE 08 defined so that identity
// has one spelling. `policy.ts`, `enforcement.ts`, `gate.ts` and `integration.ts`
// remain unreachable from here, which is what "no second policy engine" means in
// practice.
import { type SecurityContext } from "../governance/context.js";
import { type JobState, type WaitingReason } from "./jobState.js";
import { assertJobTransition, isTerminalJobState } from "./jobState.js";

/* -------------------------------------------------------------------------- */
/* Approval                                                                    */
/* -------------------------------------------------------------------------- */

export const APPROVAL_STATES = ["waiting", "approved", "rejected", "expired", "cancelled"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

const APPROVAL_TRANSITIONS: Readonly<Record<ApprovalState, readonly ApprovalState[]>> = {
  waiting: ["approved", "rejected", "expired", "cancelled"],
  approved: [],
  rejected: [],
  expired: [],
  cancelled: [],
};

export function canTransitionApproval(from: ApprovalState, to: ApprovalState): boolean {
  return APPROVAL_TRANSITIONS[from].includes(to);
}

export function isTerminalApprovalState(state: ApprovalState): boolean {
  return state !== "waiting";
}

/**
 * An approval gate.
 *
 * The one rule that matters: a gate is resolved by an APPROVER, and the approver
 * is recorded. There is no path by which the task being approved, the worker
 * executing it, or a fallback provider can supply that identity - the coordinator
 * refuses a decision whose approver is the execution itself, and the tests pin
 * that. Approval that the executor can grant is not approval.
 */
export interface ApprovalGate {
  readonly gateId: string;
  readonly jobId: string;
  readonly taskId: string | null;
  readonly state: ApprovalState;
  /** What a human is being asked to approve. Non-secret. */
  readonly question: string;
  /**
   * PHASE 04: WHAT was approved, as a digest of the execution intent.
   *
   * The gate used to record a question and a pair of ids, which meant an approval
   * for "publish the Q3 report" would release a task whose objective had since
   * become "wire fifty thousand to account X". A name is not a binding.
   *
   * Derived by the authority from the task it holds, never supplied by a caller:
   * `ApprovalRegistry.open` computes it, and `mayRelease` re-computes it. There is
   * no value a caller could pass that would make two different contents agree.
   *
   * Recorded on the record rather than only checked, because `MASTER_PLAN.md`
   * §8.6 asks for an approval that is ATTRIBUTABLE - an auditor holding a decided
   * gate must be able to say what was approved without re-deriving anything.
   */
  readonly binding: string;
  readonly requestedAt: number;
  readonly decidedAt: number | null;
  /** Who decided. null while `waiting`. */
  readonly decidedBy: string | null;
  readonly decisionReason: string | null;
  /** Epoch ms after which the gate expires on its own. null = never. */
  readonly expiresAt: number | null;
}

/* -------------------------------------------------------------------------- */
/* Checkpoint                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A checkpoint.
 *
 * `recoverable` is a DECLARED property of the task, not an inference. A task that
 * cannot safely resume states `false`, and the coordinator then restarts it from
 * the beginning instead of pretending to resume. A checkpoint that records bytes
 * without saying whether replaying from them is safe is worse than no checkpoint,
 * because it invites exactly the assumption this field exists to prevent.
 */
export interface Checkpoint {
  readonly checkpointId: string;
  readonly jobId: string;
  readonly taskId: string;
  /** Execution this checkpoint belongs to. */
  readonly executionId: string;
  /** Monotonic per task. A lower sequence is never treated as newer. */
  readonly sequence: number;
  readonly at: number;
  /** Non-secret progress marker, e.g. "3 of 7 steps". */
  readonly progress: string;
  /**
   * Where the resumable data lives. A REFERENCE, never the data itself: a
   * checkpoint is a record that something was saved, not a second copy of it.
   */
  readonly dataRef: string;
  /** Whether resuming from this checkpoint is actually safe for this task. */
  readonly recoverable: boolean;
  /** Why recovery is not safe, when it is not. */
  readonly notRecoverableReason: string | null;
}

/* -------------------------------------------------------------------------- */
/* Task                                                                        */
/* -------------------------------------------------------------------------- */

export const JOB_TASK_STATES = [
  "pending",
  "ready",
  "running",
  "waiting_approval",
  "retrying",
  "completed",
  "failed",
  "skipped",
  "cancelled",
  /**
   * PHASE 12: execution may have started and completion is UNPROVABLE.
   *
   * Reached only by recovery, only when a task was `running` with no persisted result. It is
   * not a failure report and not a success report, and it exists because neither of those can
   * be asserted without evidence. See `INDETERMINATE_SEMANTICS` in `src/state/durable.ts` for
   * why it must not collapse into either.
   */
  "indeterminate",
] as const;
export type JobTaskState = (typeof JOB_TASK_STATES)[number];

/** True for the four states no recovery and no worker may move a task out of. */
export function isTerminalTaskState(state: JobTaskState): boolean {
  return state === "completed" || state === "failed" || state === "skipped" || state === "cancelled";
}

/**
 * PHASE 12: the task transition table.
 *
 * It did not exist before this phase - `#setTaskState` assigned whatever it was given and
 * validated nothing, so a task could go from `completed` straight back to `running` and the only
 * thing that noticed was a test happening to assert the absence.
 *
 * Two rows are the reason this table is written down rather than implied:
 *
 *   running -> indeterminate          recovery's only automatic edge out of `running`
 *   indeterminate -> {completed, failed, retrying}
 *
 * The second row exists but is NOT reachable automatically. `indeterminate -> completed` and
 * `indeterminate -> failed` require evidence - an operator, or a remote system that can be
 * asked - and `indeterminate -> retrying` additionally requires the task to have declared
 * itself safe to redrive. `mayAutoAdvance` in `src/state/durable.ts` is what enforces that, and
 * the table alone would be too weak: a legal transition and an automatic one are not the same
 * claim, and this phase has been wrong about exactly that distinction before.
 */
export const JOB_TASK_TRANSITIONS: Readonly<Record<JobTaskState, readonly JobTaskState[]>> = {
  pending: ["ready", "skipped", "cancelled", "failed"],
  ready: ["running", "skipped", "cancelled", "failed"],
  running: ["waiting_approval", "retrying", "completed", "failed", "cancelled", "skipped", "indeterminate"],
  waiting_approval: ["running", "retrying", "cancelled", "failed", "skipped"],
  retrying: ["running", "ready", "cancelled", "failed", "skipped"],
  // Terminal. No edges leave these three.
  completed: [],
  failed: [],
  skipped: [],
  cancelled: [],
  // Legal, but never automatic. See the header.
  indeterminate: ["completed", "failed", "retrying"],
};

export function canTransitionTask(from: JobTaskState, to: JobTaskState): boolean {
  return JOB_TASK_TRANSITIONS[from].includes(to);
}

export function allowedTaskTransitions(from: JobTaskState): readonly JobTaskState[] {
  return JOB_TASK_TRANSITIONS[from];
}

export interface TaskLimits {
  /** Wall-clock budget for one attempt, in ms. */
  readonly timeoutMs: number | null;
  /** Total attempts including the first. Always >= 1. */
  readonly maxAttempts: number;
  /** How long the task may sit in the queue before it is abandoned, in ms. */
  readonly queueTimeoutMs: number | null;
}

export interface WorkflowTask {
  readonly taskId: string;
  readonly jobId: string;
  /** Non-secret objective handed to the orchestrator. */
  readonly objective: string;
  readonly input: string;
  readonly requiredCapabilities: readonly Capability[];
  readonly minimumTrust: TrustLevel;
  /** Task ids that must complete successfully first. */
  readonly dependsOn: readonly string[];
  /** Whether this task needs a human decision before it may run. */
  readonly approvalRequired: boolean;
  readonly limits: TaskLimits;
  /** Whether this task may resume from a checkpoint. */
  readonly checkpointable: boolean;
  /**
   * Verification kinds this task's result must pass, when any.
   *
   * A background task that is never verified can never be reported as complete
   * under PHASE 07's own rule that execution is not verification, so a task that
   * wants a real pass has to say which kinds it requires.
   */
  readonly verificationKinds?: readonly string[];
  readonly priority: TaskPriority;
  /**
   * The conditional this task sits behind, when it is inside one.
   *
   * Carried on the TASK, not the step, because the coordinator releases tasks and
   * must be able to answer "does this task's branch apply?" without holding the
   * workflow tree.
   */
  readonly guard?: BranchGuard;
}

/** A task plus everything the coordinator tracks about it. */
export interface TaskRecord {
  readonly task: WorkflowTask;
  readonly state: JobTaskState;
  readonly attempts: number;
  readonly executionId: string | null;
  readonly claimToken: string | null;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  readonly resultRef: string | null;
  readonly failure: ExecutionFailure | null;
  readonly latestCheckpoint: Checkpoint | null;
  readonly approval: ApprovalGate | null;
}

/* -------------------------------------------------------------------------- */
/* Execution and attempts                                                      */
/* -------------------------------------------------------------------------- */

export const ATTEMPT_OUTCOMES = ["succeeded", "failed", "cancelled", "timed_out"] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

export interface ExecutionAttempt {
  readonly attempt: number;
  readonly executionId: string;
  /**
   * The JOB this attempt belonged to, not just the task.
   *
   * PHASE 10: added because a taskId is only unique within a job. Attempts were
   * stored in a process-wide map keyed by taskId alone, so two jobs containing a
   * task of the same name produced one merged history. Carrying the job on the
   * record is the same argument the `taskId` note below makes, one level up.
   */
  readonly jobId: string;
  /**
   * The task this attempt was for.
   *
   * Carried on the record rather than inferred from the execution id: an attempt
   * that cannot say what it was an attempt AT is not traceable, and the audit
   * trail is the whole point of keeping one.
   */
  readonly taskId: string;
  readonly claimToken: string;
  readonly workerId: string;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly durationMs: number | null;
  readonly outcome: AttemptOutcome | null;
  readonly errorClass: ErrorClass | null;
  readonly error: string | null;
  /** Provider and model actually used, when one was routed. Never chosen here. */
  readonly providerId: string | null;
  readonly modelId: string | null;
  /** Idempotency key this attempt ran under, when one applied. */
  readonly idempotencyKey: string | null;
  /** What the attempt actually reported, as measured. */
  readonly usage: MeasuredUsage | null;
}

/**
 * Usage a provider actually reported.
 *
 * Mirrors PHASE 06 exactly, including the part that matters: a field the provider
 * did not report is `null`, never `0`. A budget is enforced against measured
 * spend, and an unmeasured field must not be silently read as free.
 */
export interface MeasuredUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly latencyMs: number | null;
  readonly amount: number | null;
  readonly currency: string | null;
}

export const EXECUTION_STATES = ["ready", "running", "verifying", "done"] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

export interface Execution {
  readonly executionId: string;
  readonly jobId: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly workerId: string;
  readonly claimToken: string;
  readonly state: ExecutionState;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly traceId: string | null;
}

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

export interface ExecutionFailure {
  readonly errorClass: ErrorClass;
  readonly message: string;
  /** Whether the coordinator considered a retry legitimate. */
  readonly retryable: boolean;
  readonly attempt: number;
  readonly at: number;
}

export interface ExecutionResult {
  readonly executionId: string;
  readonly jobId: string;
  readonly taskId: string;
  readonly succeeded: boolean;
  readonly output: string;
  /** Present only when verification was required AND was performed. */
  readonly verificationVerdict: "pass" | "fail" | "needs_review" | null;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly traceId: string | null;
  readonly usage: MeasuredUsage | null;
  readonly failure: ExecutionFailure | null;
}

/* -------------------------------------------------------------------------- */
/* Cancellation                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A cancellation request.
 *
 * Cooperative by construction. `requestedAt` plus the job's own state is what
 * makes a late worker result harmless: the coordinator refuses to apply a result
 * for a job already cancelled, and the absence of an edge out of `cancelled`
 * means there is nothing to apply it to.
 */
export interface CancellationRequest {
  readonly jobId: string;
  readonly requestedAt: number;
  readonly reason: string;
  /** Whether in-flight attempts were asked to abort. */
  readonly cooperative: boolean;
  /** Job ids acknowledged as stopped by their workers. */
  readonly acknowledged: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Job                                                                         */
/* -------------------------------------------------------------------------- */

export interface ResourceBudget {
  /** Wall-clock budget for the whole job, in ms. */
  readonly maxDurationMs: number | null;
  /** Total attempts the job may spend, across every task. */
  readonly maxTotalAttempts: number | null;
  /**
   * Maximum recorded monetary spend, in `budgetCurrency`.
   *
   * Enforced against MEASURED amounts only. A provider that reported no price
   * contributes nothing to this figure and the budget is NOT silently exceeded -
   * the job stops with the reason "budget cannot be evaluated" rather than
   * pretending it is within limit.
   */
  readonly maxAmount: number | null;
  readonly budgetCurrency: string | null;
}

export interface Job {
  readonly jobId: string;
  readonly workflowId: string | null;
  /** Non-secret description of the work, for a queue listing. */
  readonly label: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly state: JobState;
  readonly priority: TaskPriority;
  /**
   * PHASE 10 CORRECTION. This comment previously read "Owner or tenant context,
   * used for scoping and audit". Only the second half was ever true.
   *
   * `owner` is RECORDED and REPORTED - it is set on job creation and emitted in
   * `job_created` - and it is read by NOTHING. No filter, no partition, no
   * authorization check, and it is not a key in any store. A `taskId` in this
   * file, and an `owner` here, are both purely informational.
   *
   * So Toz AI Office is NOT tenant-partitioned. Two jobs owned by different
   * "tenants" in one process share every registry, every memory scope and every
   * store. See `docs/FINAL_ARCHITECTURE.md` §23 for the classification and the
   * structural work real multi-tenancy would require.
   */
  readonly owner: string;
  /** Correlates every event this job produces. */
  readonly correlationId: string;
  readonly budget: ResourceBudget;
  readonly finishedAt: number | null;
  readonly failure: ExecutionFailure | null;
  readonly cancellation: CancellationRequest | null;
  readonly waitingFor: WaitingReason | null;
  /**
   * PHASE 03 (B-08): who submitted this job.
   *
   * `null` when nobody said. That is NOT the same as borrowing the runtime's
   * service principal - a job that declared no caller records none, and the
   * executor then falls back to the principal the runtime declared for
   * background work. Recorded here so the coordinator can answer "which identity
   * executed this?" from its own records rather than from an argument, which is
   * what makes the self-approval rule unforgeable (B-05).
   */
  readonly caller: SecurityContext | null;
  /**
   * PHASE 06. The workspace this job belongs to, or `null` when the submitter's
   * identity did not resolve one.
   *
   * DERIVED FROM THE VERIFIED CALLER, never from `owner` and never from a field on
   * `CreateJobInput`. `owner` is a caller-supplied string that is read by nothing;
   * a tenancy field cannot be one of those, and this is the reason the distinction
   * is spelled out here rather than left to a reader.
   *
   * `null` is a real state and not a wildcard. A job created without a verified
   * workspace lives in the unattributed partition, and a partitioned context can
   * never act on it - so "we do not know where this is" cannot be laundered into
   * "this is available to everyone".
   *
   * NOTE ON JOB IDS. `createJob` has always refused a duplicate `jobId`, which means
   * two workspaces cannot both call a job `job-1` in one process. The namespace is
   * therefore PROCESS-wide rather than per-workspace, and a deployment serving two
   * workspaces must use distinct job ids. That is a stated limitation rather than
   * a claim of per-workspace job namespacing; the per-workspace partition is on
   * the job's AUTHORITIES (approvals, claims, checkpoints, results) and on who may
   * act on it.
   */
  readonly workspace: WorkspaceRef | null;
}

/* -------------------------------------------------------------------------- */
/* Workflow composition                                                        */
/* -------------------------------------------------------------------------- */

export const STEP_KINDS = [
  "task",
  "sequential",
  "parallel",
  "conditional",
  "wait",
  "retry",
  "approval",
  "verification",
  "handoff",
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/**
 * A workflow is a TREE of steps, composed by typed constructors.
 *
 * Deliberately not a DSL. A string-parsed workflow definition would need its own
 * parser, its own validator, and its own error messages, and would then be a
 * second place where orchestration policy could be expressed. A typed tree is
 * checked by the compiler and has exactly one interpretation.
 */
export type WorkflowStep =
  | TaskStep
  | SequentialStep
  | ParallelStep
  | ConditionalStep
  | WaitStep
  | RetryStep
  | ApprovalStep
  | VerificationStep
  | HandoffStep;

/**
 * The approval a step declared, when it declared one.
 *
 * PHASE 01 (C-3). `flattenWorkflow` used to flatten an `approval` step into a
 * plain task, DISCARDING the question and the expiry. The gate that a caller
 * opened afterwards therefore had to be given a question the caller invented,
 * and the question the workflow actually declared - the thing a human is meant to
 * be asked - was lost before anything could open a gate from it.
 *
 * Carrying it here is what lets `createJob` open the gate the step declared,
 * instead of requiring the declaration to be honoured by remembering.
 */
export interface DeclaredApproval {
  readonly question: string;
  readonly expiresAtMs: number | null;
}

export interface TaskStep {
  readonly kind: "task";
  readonly stepId: string;
  readonly task: WorkflowTask;
  /** The conditional this task sits behind, when it is inside one. */
  readonly guard?: BranchGuard;
  /** Present only when this step was declared with the `approval()` builder. */
  readonly approval?: DeclaredApproval;
}

export interface SequentialStep {
  readonly kind: "sequential";
  readonly stepId: string;
  /** Runs in order. A failure stops the sequence unless the step is tolerant. */
  readonly steps: readonly WorkflowStep[];
  readonly continueOnFailure: boolean;
}

export interface ParallelStep {
  readonly kind: "parallel";
  readonly stepId: string;
  readonly steps: readonly WorkflowStep[];
  /** How many children may run at once. Bounded, and validated as >= 1. */
  readonly maxConcurrency: number;
  /** Whether one child failing fails the whole group. */
  readonly failFast: boolean;
}

export interface ConditionalStep {
  readonly kind: "conditional";
  readonly stepId: string;
  /**
   * A PREDICATE over observed state - never over a string a model produced.
   * Branching on generated text would make the workflow's control flow
   * non-deterministic and unauditable.
   */
  readonly predicate: string;
  readonly whenTrue: readonly WorkflowStep[];
  readonly whenFalse: readonly WorkflowStep[];
}

export interface WaitStep {
  readonly kind: "wait";
  readonly stepId: string;
  readonly reason: "external" | "approval" | "dependency";
  readonly maxWaitMs: number | null;
}

export interface RetryStep {
  readonly kind: "retry";
  readonly stepId: string;
  readonly step: WorkflowStep;
  /** Total attempts including the first. Always >= 1. */
  readonly maxAttempts: number;
  /** Base backoff; the existing `computeBackoffDelay` derives the delay. */
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
}

export interface ApprovalStep {
  readonly kind: "approval";
  readonly stepId: string;
  readonly task: WorkflowTask;
  readonly question: string;
  readonly expiresAtMs: number | null;
}

export interface VerificationStep {
  readonly kind: "verification";
  readonly stepId: string;
  /** Tasks whose results must verify before the workflow may complete. */
  readonly requiresVerificationFor: readonly string[];
}

export interface HandoffStep {
  readonly kind: "handoff";
  readonly stepId: string;
  /** Next step, chosen by the coordinator from recorded task outcomes only. */
  readonly onSuccess: WorkflowStep;
  readonly onFailure: WorkflowStep | null;
}

export interface Workflow {
  readonly workflowId: string;
  readonly name: string;
  readonly root: WorkflowStep;
}

/* -------------------------------------------------------------------------- */
/* Builders                                                                    */
/* -------------------------------------------------------------------------- */

export function task(stepId: string, definition: WorkflowTask): TaskStep {
  return { kind: "task", stepId, task: definition };
}

export function sequential(
  stepId: string,
  steps: readonly WorkflowStep[],
  options: { continueOnFailure?: boolean } = {},
): SequentialStep {
  return { kind: "sequential", stepId, steps, continueOnFailure: options.continueOnFailure ?? false };
}

export function parallel(
  stepId: string,
  steps: readonly WorkflowStep[],
  options: { maxConcurrency?: number; failFast?: boolean } = {},
): ParallelStep {
  const maxConcurrency = options.maxConcurrency ?? steps.length;
  if (maxConcurrency < 1) {
    // A parallel group that can run nothing would deadlock rather than fail, so
    // the limit is validated at construction where the mistake is visible.
    throw new Error(`Parallel step "${stepId}" must allow at least 1 concurrent task`);
  }
  return { kind: "parallel", stepId, steps, maxConcurrency, failFast: options.failFast ?? true };
}

export function conditional(
  stepId: string,
  predicate: string,
  whenTrue: readonly WorkflowStep[],
  whenFalse: readonly WorkflowStep[],
): ConditionalStep {
  return { kind: "conditional", stepId, predicate, whenTrue, whenFalse };
}

export function wait(
  stepId: string,
  reason: "external" | "approval" | "dependency",
  maxWaitMs: number | null = null,
): WaitStep {
  return { kind: "wait", stepId, reason, maxWaitMs };
}

export function retry(
  stepId: string,
  step: WorkflowStep,
  options: { maxAttempts?: number; backoffBaseMs?: number; backoffMaxMs?: number } = {},
): RetryStep {
  const maxAttempts = options.maxAttempts ?? 2;
  if (maxAttempts < 1) {
    throw new Error(`Retry step "${stepId}" must allow at least 1 attempt`);
  }
  return {
    kind: "retry",
    stepId,
    step,
    maxAttempts,
    backoffBaseMs: options.backoffBaseMs ?? 250,
    backoffMaxMs: options.backoffMaxMs ?? 10_000,
  };
}

export function approval(
  stepId: string,
  definition: WorkflowTask,
  question: string,
  expiresAtMs: number | null = null,
): ApprovalStep {
  return { kind: "approval", stepId, task: { ...definition, approvalRequired: true }, question, expiresAtMs };
}

export function verification(stepId: string, requiresVerificationFor: readonly string[]): VerificationStep {
  return { kind: "verification", stepId, requiresVerificationFor };
}

export function handoff(stepId: string, onSuccess: WorkflowStep, onFailure: WorkflowStep | null = null): HandoffStep {
  return { kind: "handoff", stepId, onSuccess, onFailure };
}

export function workflow(workflowId: string, name: string, root: WorkflowStep): Workflow {
  return { workflowId, name, root };
}

/* -------------------------------------------------------------------------- */
/* Guards                                                                      */
/* -------------------------------------------------------------------------- */

/** Every step id in a tree, for duplicate detection and lookup. */
export function stepIdsOf(step: WorkflowStep): readonly string[] {
  switch (step.kind) {
    case "task":
    case "wait":
    case "verification":
      return [step.stepId];
    case "approval":
      return [step.stepId];
    case "sequential":
    case "parallel":
      return [step.stepId, ...step.steps.flatMap(stepIdsOf)];
    case "conditional":
      return [step.stepId, ...step.whenTrue.flatMap(stepIdsOf), ...step.whenFalse.flatMap(stepIdsOf)];
    case "retry":
      return [step.stepId, ...stepIdsOf(step.step)];
    case "handoff":
      return [step.stepId, ...stepIdsOf(step.onSuccess), ...(step.onFailure === null ? [] : stepIdsOf(step.onFailure))];
  }
}

/**
 * Flattens a tree into a dependency-ordered list of task steps.
 *
 * Order is derived from the tree structure alone: a child always follows its
 * parent group, and parallel siblings keep their declaration order so the plan is
 * reproducible. Nothing is sorted by anything measured, so two runs of the same
 * workflow produce the same plan.
 *
 * Each step carries the CONDITIONAL GUARD it sits behind. A conditional
 * flattens to both branches, so without a guard on each step a conditional
 * workflow would run BOTH branches - which is not a conditional, it is two
 * unrelated jobs wearing one name. The coordinator consults the guard before
 * releasing a task, so exactly one branch runs.
 */
export function flattenWorkflow(step: WorkflowStep): readonly TaskStep[] {
  const out: TaskStep[] = [];
  const visit = (current: WorkflowStep, guard: BranchGuard | null): void => {
    switch (current.kind) {
      case "task":
        out.push({ kind: "task", stepId: current.stepId, task: current.task, ...(guard === null ? {} : { guard }) });
        return;
      case "approval":
        out.push({
          kind: "task",
          stepId: current.stepId,
          task: current.task,
          ...(guard === null ? {} : { guard }),
          // PHASE 01 (C-3): the declared question and expiry are carried rather
          // than dropped. Without them the gate can only be opened with a question
          // the caller made up, and the declaration is unenforceable.
          approval: { question: current.question, expiresAtMs: current.expiresAtMs },
        });
        return;
      case "sequential":
      case "parallel":
        current.steps.forEach((child) => visit(child, guard));
        return;
      case "conditional":
        // Both branches are flattened, each tagged with the side it belongs to.
        // Which one runs is decided at release time by the predicate.
        current.whenTrue.forEach((child) => visit(child, { predicate: current.predicate, whenTrue: true }));
        current.whenFalse.forEach((child) => visit(child, { predicate: current.predicate, whenTrue: false }));
        return;
      case "retry":
        visit(current.step, guard);
        return;
      case "handoff":
        visit(current.onSuccess, guard);
        if (current.onFailure !== null) {
          visit(current.onFailure, guard);
        }
        return;
      case "wait":
      case "verification":
        return;
    }
  };
  visit(step, null);
  return out;
}

/** Which side of a conditional a task sits on. */
export interface BranchGuard {
  readonly predicate: string;
  readonly whenTrue: boolean;
}

/**
 * The predicate vocabulary, stated exhaustively.
 *
 * A predicate is evaluated over RECORDED outcomes only - never over text a model
 * produced. Branching a workflow on generated text would make its control flow
 * non-deterministic and impossible to audit, which is the one thing a workflow
 * engine must not be.
 *
 * A predicate outside this vocabulary returns `null`, meaning "cannot be
 * evaluated". The coordinator then refuses to release the branch and says so.
 * Guessing would be worse than waiting: a wrong branch is work nobody asked for.
 */
export type PredicateVerdict = boolean | null;

export const PREDICATE_FORMS = [
  "all_succeeded",
  "any_failed",
  "any_cancelled",
  "none_pending",
] as const;

export function evaluatePredicate(
  predicate: string,
  observed: {
    readonly completed: number;
    readonly failed: number;
    readonly cancelled: number;
    readonly pending: number;
  },
): PredicateVerdict {
  switch (predicate) {
    case "all_succeeded":
      return observed.pending === 0 && observed.failed === 0 && observed.cancelled === 0;
    case "any_failed":
      return observed.failed > 0;
    case "any_cancelled":
      return observed.cancelled > 0;
    case "none_pending":
      return observed.pending === 0;
    default:
      return null;
  }
}

/** Re-asserts a job transition at the type boundary. */
export function assertJobStateChange(job: Job, to: JobState): void {
  if (isTerminalJobState(job.state)) {
    throw new Error(`Job "${job.jobId}" is ${job.state} and cannot change state`);
  }
  assertJobTransition(job.state, to);
}
