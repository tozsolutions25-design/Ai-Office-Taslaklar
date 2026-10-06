/**
 * PHASE 07: the job lifecycle state machine.
 *
 * WHY THIS IS A THIRD MACHINE, and not an extension of an existing one.
 *
 * The repository already has two, and `orchestration/task/state.ts` explains in
 * its own header why more than one is correct: they model different scopes.
 *
 *   - `queue/taskState.ts`  a single queued unit inside one process's queue
 *   - `orchestration/task/state.ts`  an in-run orchestrated task
 *
 * A durable background JOB is a third scope. It must be pausable, and it may sit
 * waiting for a human approval for an unbounded time. Neither is an in-run
 * orchestration state:
 *
 *   - `orchestration.task.test.ts` asserts `isOrchestrationState("paused")` is
 *     false. That is a deliberate PHASE 04 decision, not an oversight, and the
 *     phase brief forbids weakening a valid invariant. So `paused` is NOT added
 *     there.
 *   - `queue/taskState.ts` is core and is depended on by the public site. Adding
 *     states to it would change a public interface for a phase-07 concern.
 *
 * So this machine is job-scoped, and the two existing ones are used unchanged.
 * There is exactly one authority for each scope, which is the property that
 * matters: not one machine everywhere, but one authority per scope.
 *
 * The other invariant encoded here: a CANCELLED job is terminal. A stale worker
 * reporting "done" after a cancellation must not be able to revive it, and the
 * only way to guarantee that is for there to be no edge out of `cancelled`.
 */

import { InvalidTransitionError } from "../../core/errors.js";

export const JOB_STATES = [
  "queued",
  "running",
  "waiting",
  "retrying",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;

export type JobState = (typeof JOB_STATES)[number];

/** Why a job is `waiting`. A waiting job is waiting for something specific. */
export const WAITING_REASONS = ["approval", "dependency", "external", "budget"] as const;
export type WaitingReason = (typeof WAITING_REASONS)[number];

const JOB_TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  queued: ["running", "paused", "cancelled", "failed"],

  // `waiting` is entered when a gate is unsatisfied, and `retrying` when the
  // coordinator has decided to try again. Both return to `running` only through
  // the coordinator, which owns that decision.
  running: ["waiting", "retrying", "paused", "completed", "failed", "cancelled"],
  waiting: ["running", "retrying", "paused", "failed", "cancelled"],
  retrying: ["running", "waiting", "paused", "failed", "cancelled"],

  // Pausing is cooperative: a paused job holds no worker and can always resume or
  // be cancelled. It is NOT terminal, because a pause a human cannot lift is a
  // deadlock.
  paused: ["running", "queued", "cancelled", "failed"],

  // Terminal. No edges leave any of these three. This is the entire stale-result
  // defence: a worker that reports a result after its job was cancelled has no
  // legal transition to take.
  completed: [],
  failed: [],
  cancelled: [],
};

export const TERMINAL_JOB_STATES: readonly JobState[] = ["completed", "failed", "cancelled"];

export function isJobState(value: unknown): value is JobState {
  return typeof value === "string" && (JOB_STATES as readonly string[]).includes(value);
}

export function allowedJobTransitions(from: JobState): readonly JobState[] {
  return JOB_TRANSITIONS[from];
}

export function canTransitionJob(from: JobState, to: JobState): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

export function assertJobTransition(from: JobState, to: JobState): void {
  if (!canTransitionJob(from, to)) {
    throw new InvalidTransitionError("job", from, to);
  }
}

export function isTerminalJobState(state: JobState): boolean {
  return TERMINAL_JOB_STATES.includes(state);
}

/**
 * Whether a job is still making progress on its own.
 *
 * A waiting job is NOT idle: something external must happen, and a caller
 * watching for "is this stuck?" needs that to be a question it can ask.
 */
export function isActiveJobState(state: JobState): boolean {
  return !isTerminalJobState(state) && state !== "paused";
}

/**
 * A recorded transition, for the audit history.
 *
 * `from: null` is the creation of the job. Every transition the coordinator
 * performs is recorded, including the ones it refuses - see the coordinator,
 * which records a rejected transition rather than silently ignoring it.
 */
export interface JobTransitionRecord {
  readonly jobId: string;
  readonly from: JobState | null;
  readonly to: JobState;
  readonly at: number;
  /** Non-secret reason. Never contains a credential. */
  readonly reason: string;
  /** Set when entering `waiting`. */
  readonly waitingFor: WaitingReason | null;
}

export class JobStateError extends Error {
  public readonly jobId: string;
  public readonly from: JobState;
  public readonly to: JobState;

  public constructor(jobId: string, from: JobState, to: JobState) {
    const allowed = JOB_TRANSITIONS[from];
    super(
      `Job "${jobId}" cannot move from "${from}" to "${to}". ` +
        (allowed.length === 0
          ? `"${from}" is terminal, so a late or stale report cannot change it.`
          : `Allowed from "${from}": ${allowed.join(", ")}.`),
    );
    this.name = "JobStateError";
    this.jobId = jobId;
    this.from = from;
    this.to = to;
  }
}
