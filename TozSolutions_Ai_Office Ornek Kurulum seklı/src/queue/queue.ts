import type { InvalidTransitionError} from "../core/errors.js";
import { CapacityError, ValidationError } from "../core/errors.js";
import { err, ok, type Result } from "../core/result.js";
import { type Clock, systemClock } from "../core/clock.js";
import { type IdGenerator, uuidIdGenerator } from "../core/ids.js";
import { type WorkloadClass, isWorkloadClass } from "../workload/workload.js";
import type { TaskRecord} from "./task.js";
import { type Task, createTask } from "./task.js";
import { type TaskState, isTaskState } from "./taskState.js";

export class DuplicateTaskError extends Error {
  public readonly taskId: string;
  public constructor(taskId: string) {
    super(`Task already queued: ${taskId}`);
    this.name = "DuplicateTaskError";
    this.taskId = taskId;
  }
}

export class QueueFullError extends CapacityError {
  public readonly maxTasks: number;
  public constructor(maxTasks: number) {
    super(`Queue is full: refusing new task (maxTasks=${maxTasks})`);
    this.name = "QueueFullError";
    this.maxTasks = maxTasks;
  }
}

export class UnknownTaskError extends Error {
  public readonly taskId: string;
  public constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = "UnknownTaskError";
    this.taskId = taskId;
  }
}

export type QueueError =
  | ValidationError
  | DuplicateTaskError
  | QueueFullError
  | UnknownTaskError
  | InvalidTransitionError;

export interface EnqueueInput {
  taskId?: string;
  workload: WorkloadClass;
  input: string;
}

/**
 * Bounded task queue.
 *
 * The bound is mandatory: an unbounded queue converts a traffic spike into
 * unbounded memory growth and unbounded task latency. Once `maxTasks` is
 * reached, enqueue fails fast with QueueFullError rather than silently
 * growing.
 *
 * The queue is the structural first stage of the pipeline:
 *   QUEUE -> SCHEDULER -> CONCURRENCY LIMITER -> PROVIDER SELECTION
 *         -> EXECUTION -> RESULT -> RETRY/FALLBACK -> COMPLETION
 * The scheduler, limiter, selector and executor are separate components; this
 * class owns only the first stage.
 */
export class TaskQueue {
  readonly #tasks = new Map<string, TaskRecord>();
  readonly #order: string[] = [];
  readonly #maxTasks: number;
  /**
   * PHASE 06: the workspace this queue serves, or `null` when composed without one.
   *
   * A structural shape rather than the orchestration layer's `WorkspaceRef`, because
   * `core` must not import `orchestration` and a test enforces that. The partition
   * is verified at the identity boundary before a task ever reaches this queue; what
   * is guaranteed HERE is that the duplicate check and every lookup are scoped to it.
   */
  readonly #workspace: { readonly workspace: string | null; readonly brand: string | null };
  readonly #clock: Clock;
  readonly #ids: IdGenerator;

  public constructor(
    options: {
      maxTasks?: number;
      clock?: Clock;
      ids?: IdGenerator;
      /** PHASE 06. Absent means the unattributed partition, not "any workspace". */
      workspace?: { readonly workspace: string | null; readonly brand: string | null } | null;
    } = {},
  ) {
    const maxTasks = options.maxTasks ?? 1000;
    if (!Number.isInteger(maxTasks) || maxTasks <= 0) {
      throw new CapacityError("TaskQueue maxTasks must be a positive integer");
    }
    this.#maxTasks = maxTasks;
    this.#clock = options.clock ?? systemClock;
    this.#ids = options.ids ?? uuidIdGenerator;
    this.#workspace = options.workspace ?? { workspace: null, brand: null };
  }

  /** PHASE 06: the workspace this queue serves, or `null` when composed without one. */
  public get workspace(): { readonly workspace: string | null; readonly brand: string | null } {
    return this.#workspace;
  }

  public get size(): number {
    return this.#tasks.size;
  }

  public get capacity(): number {
    return this.#maxTasks;
  }

  public get remainingCapacity(): number {
    return this.#maxTasks - this.#tasks.size;
  }

  public enqueue(input: EnqueueInput): Result<TaskRecord, QueueError> {
    if (!isWorkloadClass(input.workload)) {
      return err(new ValidationError("Enqueue failed", [
        `workload must be a valid workload class, received: ${String(input.workload)}`,
      ]));
    }
    if (this.#tasks.size >= this.#maxTasks) {
      return err(new QueueFullError(this.#maxTasks));
    }
    const taskId = input.taskId ?? this.#ids.newId("task");
    // PHASE 06 (N-2): the queue holds ONE workspace, and the key is composed from
    // it. `taskId` is caller-supplied and the duplicate check used to be
    // process-wide, so a caller in one workspace could not enqueue a task whose id
    // another workspace already held - a denial of service across a partition
    // boundary, which is a cross-tenant effect even though it is a refusal.
    //
    // WHY THE QUEUE IS PER-WORSPACE rather than taking a workspace per call. The
    // same reasoning as `MemoryStore` and `AuditLog`: the alternative is a
    // workspace argument on `enqueue`, `get`, `snapshot`, `transition` and `remove`,
    // five optional arguments that are exactly the kind of thing a caller forgets
    // - C-1 was a denial list computed correctly and then not passed on. A
    // deployment serving two workspaces composes two runtimes, and the composition
    // root is the one place that can see both.
    //
    // A structural `{ workspace, brand }` shape, not the orchestration layer's
    // `WorkspaceRef`: `core` must not import `orchestration`, and a test enforces
    // that. The value is verified at the identity boundary before anything reaches
    // this queue; what is guaranteed HERE is that the check is partitioned.
    const key = this.#key(taskId);
    if (this.#tasks.has(key)) {
      return err(new DuplicateTaskError(taskId));
    }
    const created = createTask(
      { taskId, workload: input.workload, input: input.input, now: this.#clock.now() },
      this.#clock,
    );
    if (!created.ok) {
      return created;
    }
    this.#tasks.set(key, created.value);
    this.#order.push(key);
    return created;
  }

  /** The one place this queue composes a store key. */
  #key(taskId: string): string {
    return `${this.#workspace.workspace === null ? "0:" : `${this.#workspace.workspace.length}:${this.#workspace.workspace}`}\u0000${
      this.#workspace.brand ?? "-"
    }\u0001${taskId}`;
  }

  public peek(): TaskRecord | null {
    while (this.#order.length > 0) {
      const id = this.#order[0];
      if (id === undefined) {
        return null;
      }
      const task = this.#tasks.get(id);
      if (task && task.state === "queued") {
        return task;
      }
      this.#order.shift();
    }
    return null;
  }

  /**
   * Atomically moves the next queued task to `to` (normally "scheduled").
   * Returns null when nothing is ready.
   */
  public claimNext(to: TaskState = "scheduled", reason: string | null = null): TaskRecord | null {
    if (!isTaskState(to)) {
      throw new ValidationError("claimNext received an invalid state", [String(to)]);
    }
    const task = this.peek();
    if (!task) {
      return null;
    }
    task.transition(to, this.#clock.now(), reason);
    if (to !== "queued") {
      this.#order.shift();
    }
    return task;
  }

  public get(taskId: string): TaskRecord | null {
    return this.#tasks.get(this.#key(taskId)) ?? null;
  }

  public snapshot(taskId: string): Task | null {
    return this.#tasks.get(this.#key(taskId))?.snapshot() ?? null;
  }

  public transition(
    taskId: string,
    to: TaskState,
    reason: string | null = null,
  ): Result<TaskRecord, QueueError> {
    const task = this.#tasks.get(this.#key(taskId));
    if (!task) {
      return err(new UnknownTaskError(taskId));
    }
    if (!isTaskState(to)) {
      return err(new ValidationError("Unknown task state", [String(to)]));
    }
    const attempted = task.tryTransition(to, this.#clock.now(), reason);
    if (!attempted.ok) {
      return attempted;
    }
    // A task returning to `queued` must be re-queued for scheduling.
    if (to === "queued" && !this.#order.includes(this.#key(taskId))) {
      this.#order.push(this.#key(taskId));
    }
    return ok(task);
  }

  public list(): readonly Task[] {
    return [...this.#tasks.values()].map((task) => task.snapshot());
  }

  public countByState(state: TaskState): number {
    let count = 0;
    for (const task of this.#tasks.values()) {
      if (task.state === state) {
        count += 1;
      }
    }
    return count;
  }

  /** Removes terminal tasks so capacity is reclaimed. Returns removed IDs. */
  /**
   * Removes terminal tasks and returns their ids.
   *
   * PHASE 06: the returned ids are stripped of the partition prefix. The internal
   * key is an implementation detail of this queue, and a caller reading
   * `0:\u0000-\u0001a` learns the key format and nothing about the task.
   */
  public pruneCompleted(): readonly string[] {
    const removed: string[] = [];
    for (const [id, task] of [...this.#tasks.entries()]) {
      if (task.state === "completed" || task.state === "cancelled" || task.state === "failed") {
        this.#tasks.delete(id);
        const index = this.#order.indexOf(id);
        if (index >= 0) {
          this.#order.splice(index, 1);
        }
        removed.push(task.snapshot().taskId);
      }
    }
    return removed;
  }
}
