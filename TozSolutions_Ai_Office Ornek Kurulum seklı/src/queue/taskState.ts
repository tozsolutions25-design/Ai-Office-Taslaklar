/**
 * Task state machine.
 *
 * Intended pipeline:
 *   QUEUED -> SCHEDULED -> RUNNING -> (COMPLETED | FAILED | RETRYING | FALLBACK | CANCELLED)
 *   RETRYING -> SCHEDULED
 *   FALLBACK -> SCHEDULED
 *
 * States are only ever changed through `assertTaskTransition`, so no code path
 * can set an arbitrary status.
 */

import { InvalidTransitionError } from "../core/errors.js";

export const TASK_STATES = [
  "queued",
  "scheduled",
  "running",
  "retrying",
  "fallback",
  "completed",
  "failed",
  "cancelled",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export function isTaskState(value: unknown): value is TaskState {
  return typeof value === "string" && (TASK_STATES as readonly string[]).includes(value);
}

const TASK_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  queued: ["scheduled", "cancelled", "failed"],
  // A scheduled task can be returned to the queue (preemption) or cancelled.
  scheduled: ["running", "queued", "cancelled", "failed"],
  running: ["completed", "failed", "retrying", "fallback", "cancelled"],
  retrying: ["scheduled", "failed", "cancelled"],
  fallback: ["scheduled", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export const TERMINAL_TASK_STATES: readonly TaskState[] = ["completed", "failed", "cancelled"];

export function allowedTaskTransitions(from: TaskState): readonly TaskState[] {
  return TASK_TRANSITIONS[from];
}

export function canTransitionTask(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function assertTaskTransition(from: TaskState, to: TaskState): void {
  if (!canTransitionTask(from, to)) {
    throw new InvalidTransitionError("task", from, to);
  }
}

export function isTerminalTaskState(state: TaskState): boolean {
  return TERMINAL_TASK_STATES.includes(state);
}
