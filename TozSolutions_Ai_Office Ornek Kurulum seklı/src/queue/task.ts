import { type Clock, systemClock } from "../core/clock.js";
import { InvalidTransitionError, ValidationError } from "../core/errors.js";
import { err, ok, type Result } from "../core/result.js";
import type { ErrorClass } from "../core/errors.js";
import type { WorkloadClass } from "../workload/workload.js";
import {
  type TaskState,
  assertTaskTransition,
  isTaskState,
  isTerminalTaskState,
} from "./taskState.js";

/** A record of one state change, for audit correlation. */
export interface TaskTransitionRecord {
  readonly from: TaskState | null;
  readonly to: TaskState;
  readonly at: Date;
  readonly reason: string | null;
}

export interface Task {
  readonly taskId: string;
  readonly workload: WorkloadClass;
  readonly state: TaskState;
  /** Non-sensitive prompt/reference. Never a secret. */
  readonly input: string;
  readonly attempt: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly assignedProviderId: string | null;
  readonly assignedModelId: string | null;
  readonly lastErrorClass: ErrorClass | null;
  readonly result: string | null;
  readonly history: readonly TaskTransitionRecord[];
}

export interface TaskInit {
  taskId: string;
  workload: WorkloadClass;
  input: string;
  now: Date;
}

/** Pure-ish task factory + the ONLY place task state is mutated. */
export class TaskRecord {
  #state: TaskState = "queued";
  #attempt = 0;
  #startedAt: Date | null = null;
  #finishedAt: Date | null = null;
  #assignedProviderId: string | null = null;
  #assignedModelId: string | null = null;
  #lastErrorClass: ErrorClass | null = null;
  #result: string | null = null;
  readonly #history: TaskTransitionRecord[] = [];

  public readonly taskId: string;
  public readonly workload: WorkloadClass;
  public readonly input: string;
  public readonly createdAt: Date;
  #updatedAt: Date;

  public constructor(init: TaskInit) {
    this.taskId = init.taskId;
    this.workload = init.workload;
    this.input = init.input;
    this.createdAt = init.now;
    this.#updatedAt = init.now;
    this.#history.push({ from: null, to: "queued", at: init.now, reason: "enqueued" });
  }

  public get state(): TaskState {
    return this.#state;
  }

  public get attempt(): number {
    return this.#attempt;
  }

  public get history(): readonly TaskTransitionRecord[] {
    return this.#history;
  }

  public snapshot(): Task {
    return {
      taskId: this.taskId,
      workload: this.workload,
      state: this.#state,
      input: this.input,
      attempt: this.#attempt,
      createdAt: this.createdAt,
      updatedAt: this.#updatedAt,
      startedAt: this.#startedAt,
      finishedAt: this.#finishedAt,
      assignedProviderId: this.#assignedProviderId,
      assignedModelId: this.#assignedModelId,
      lastErrorClass: this.#lastErrorClass,
      result: this.#result,
      history: [...this.#history],
    };
  }

  /**
   * Applies a state transition. Throws InvalidTransitionError on an illegal
   * edge, which is a programmer error rather than an expected condition.
   */
  public transition(to: TaskState, at: Date, reason: string | null = null): void {
    assertTaskTransition(this.#state, to);
    const from = this.#state;
    this.#state = to;
    this.#updatedAt = at;

    if (to === "running" && this.#startedAt === null) {
      this.#startedAt = at;
      this.#attempt += 1;
    }
    if (isTerminalTaskState(to)) {
      this.#finishedAt = at;
    }
    if (to === "retrying" || to === "fallback" || to === "failed") {
      // reason carries the classification; stored separately so it can be
      // typed without polluting the free-form event detail.
      this.#lastErrorClass = reason as ErrorClass | null;
    }
    this.#history.push({ from, to, at, reason });
  }

  /** Result-returning transition, for call sites that handle invalid input. */
  public tryTransition(
    to: unknown,
    at: Date,
    reason: string | null = null,
  ): Result<TaskState, InvalidTransitionError | ValidationError> {
    if (!isTaskState(to)) {
      return err(new ValidationError("Invalid task state", [`unknown state: ${String(to)}`]));
    }
    try {
      this.transition(to, at, reason);
      return ok(to);
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        return err(error);
      }
      throw error;
    }
  }

  public assign(providerId: string, modelId: string, at: Date): void {
    this.#assignedProviderId = providerId;
    this.#assignedModelId = modelId;
    this.#updatedAt = at;
  }

  public complete(result: string, at: Date): void {
    this.transition("completed", at, null);
    this.#result = result;
  }

  public get assignedProviderId(): string | null {
    return this.#assignedProviderId;
  }

  public get assignedModelId(): string | null {
    return this.#assignedModelId;
  }
}

/** Creates a task, validating identity. */
export function createTask(init: TaskInit, clock: Clock = systemClock): Result<TaskRecord, ValidationError> {
  const issues: string[] = [];
  if (typeof init.taskId !== "string" || init.taskId.trim() === "") {
    issues.push("taskId must be a non-empty string");
  }
  if (typeof init.input !== "string") {
    issues.push("input must be a string");
  }
  if (issues.length > 0) {
    return err(new ValidationError("Task validation failed", issues));
  }
  return ok(new TaskRecord({ ...init, now: init.now ?? clock.now() }));
}
