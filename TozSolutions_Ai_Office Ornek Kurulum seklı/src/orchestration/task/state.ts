/**
 * Execution task state machine.
 *
 * ORCHESTRATION-SCOPED, and deliberately separate from the existing
 * `src/queue/taskState.ts`.
 *
 * The existing state machine models a single queued unit of work:
 * queued -> scheduled -> running -> completed. That remains correct and is
 * unchanged, because the public site and core already depend on it.
 *
 * An orchestrated execution has states the queue does not have: it is planned
 * before it runs, verified after it runs, and can be escalated for human review.
 * Adding those to `TaskState` would change a public interface that three phases
 * already depend on, for no benefit. So orchestration gets its own machine, and
 * the queue state remains what it was.
 */

import { InvalidTransitionError } from "../../core/errors.js";

export const ORCHESTRATION_TASK_STATES = [
  "created",
  "classifying",
  "planning",
  "ready",
  "running",
  "verifying",
  "completed",
  "failed",
  "retrying",
  "escalated",
  "cancelled",
] as const;

export type OrchestrationTaskState = (typeof ORCHESTRATION_TASK_STATES)[number];

const ORCHESTRATION_TRANSITIONS: Readonly<Record<OrchestrationTaskState, readonly OrchestrationTaskState[]>> = {
  created: ["classifying", "cancelled", "failed"],
  classifying: ["planning", "ready", "failed", "cancelled"],
  planning: ["ready", "failed", "cancelled"],
  // A ready task may return to planning if the plan proves insufficient.
  ready: ["running", "planning", "cancelled", "failed"],
  running: ["verifying", "completed", "failed", "retrying", "escalated", "cancelled"],
  // A task with no verification requirement may complete straight from running.
  verifying: ["completed", "failed", "escalated"],
  completed: [],
  failed: ["retrying", "escalated", "cancelled"],
  retrying: ["ready", "failed", "escalated", "cancelled"],
  // Escalated is terminal: it waits for a human, not for a retry counter.
  escalated: ["ready", "cancelled", "failed"],
  cancelled: [],
};

export const TERMINAL_ORCHESTRATION_STATES: readonly OrchestrationTaskState[] = [
  "completed",
  "cancelled",
];

/** States from which a task can no longer make progress without intervention. */
export const BLOCKED_ORCHESTRATION_STATES: readonly OrchestrationTaskState[] = ["escalated"];

export function isOrchestrationState(value: unknown): value is OrchestrationTaskState {
  return typeof value === "string" && (ORCHESTRATION_TASK_STATES as readonly string[]).includes(value);
}

export function allowedOrchestrationTransitions(from: OrchestrationTaskState): readonly OrchestrationTaskState[] {
  return ORCHESTRATION_TRANSITIONS[from];
}

export function canTransitionOrchestration(
  from: OrchestrationTaskState,
  to: OrchestrationTaskState,
): boolean {
  return ORCHESTRATION_TRANSITIONS[from].includes(to);
}

export function assertOrchestrationTransition(from: OrchestrationTaskState, to: OrchestrationTaskState): void {
  if (!canTransitionOrchestration(from, to)) {
    throw new InvalidTransitionError("orchestration task", from, to);
  }
}

export function isTerminalOrchestrationState(state: OrchestrationTaskState): boolean {
  return TERMINAL_ORCHESTRATION_STATES.includes(state);
}

/**
 * Whether a task is allowed to finish.
 *
 * A task that requires verification cannot reach `completed` from `running`; it
 * must pass through `verifying`. Encoding that here, rather than leaving it to
 * each caller, is what stops "the agent said it is done" from being treated as a
 * completed task.
 */
export function canCompleteFrom(
  state: OrchestrationTaskState,
  verificationRequired: boolean,
): boolean {
  if (state === "running") {
    return !verificationRequired;
  }
  return state === "verifying";
}
