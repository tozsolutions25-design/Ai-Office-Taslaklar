/**
 * Background workers.
 *
 * Periodic work — health checks, memory maintenance, cost monitoring — must not
 * run inside a request, and must not be able to take an execution down with it.
 *
 * Every worker is:
 *   observable   each run is recorded
 *   cancellable   a run can be aborted
 *   bounded       a run has a timeout and an attempt ceiling
 *   restartable   a failed worker can be started again
 *
 * A worker that throws is recorded as failed and NOT restarted silently. Silent
 * restart is how a failing worker becomes an invisible one.
 *
 * A worker has no authority. It may read registries and use services, but it
 * cannot start an execution: it has no reference to the orchestrator.
 */

import { type Clock, systemClock } from "../../core/clock.js";
import { type Result, err, ok } from "../../core/result.js";

export const WORKER_STATUSES = ["idle", "running", "stopped", "failed"] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];

export interface WorkerRunRecord {
  readonly workerId: string;
  readonly runId: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly durationMs: number;
  readonly outcome: "succeeded" | "failed" | "cancelled";
  /** Non-secret failure detail. */
  readonly error: string | null;
  /** What the run did, for the audit. */
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface Worker {
  readonly id: string;
  /** Interval the host should aim for, in ms. A hint, not a promise. */
  readonly intervalMs: number;
  /**
   * Performs one unit of work.
   *
   * Must respect `signal` and return promptly. A worker that ignores
   * cancellation cannot be stopped, which is why the signal is part of the
   * contract rather than an optional convenience.
   */
  run(signal: AbortSignal): Promise<Readonly<Record<string, unknown>>>;
}

export class WorkerTimeoutError extends Error {
  public readonly workerId: string;
  public constructor(workerId: string, timeoutMs: number) {
    super(`Worker "${workerId}" exceeded its ${timeoutMs}ms budget`);
    this.name = "WorkerTimeoutError";
    this.workerId = workerId;
  }
}

export interface WorkerHostOptions {
  readonly clock?: Clock;
  /** Default per-run budget. */
  readonly defaultTimeoutMs?: number;
  /** Maximum attempts per run before a run is abandoned. */
  readonly maxAttempts?: number;
  readonly maxHistory?: number;
}

interface WorkerEntry {
  readonly worker: Worker;
  status: WorkerStatus;
  controller: AbortController | null;
}

/**
 * Supervises workers.
 *
 * Deliberately not a scheduler: it starts, stops and runs workers on demand. A
 * future phase may add timing, and the lifecycle here is what such a scheduler
 * would drive.
 */
export class WorkerHost {
  readonly #entries = new Map<string, WorkerEntry>();
  readonly #history: WorkerRunRecord[] = [];
  readonly #clock: Clock;
  readonly #defaultTimeoutMs: number;
  readonly #maxAttempts: number;
  readonly #maxHistory: number;
  #runCounter = 0;

  public constructor(options: WorkerHostOptions = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.#maxAttempts = options.maxAttempts ?? 1;
    this.#maxHistory = options.maxHistory ?? 200;
  }

  public register(worker: Worker): Result<true, Error> {
    if (worker.id.trim() === "") {
      return err(new Error("Worker id must be a non-empty string"));
    }
    if (this.#entries.has(worker.id)) {
      return err(new Error(`Worker already registered: ${worker.id}`));
    }
    this.#entries.set(worker.id, { worker, status: "idle", controller: null });
    return ok(true);
  }

  public ids(): readonly string[] {
    return [...this.#entries.keys()];
  }

  public statusOf(workerId: string): WorkerStatus {
    return this.#entries.get(workerId)?.status ?? "stopped";
  }

  public get size(): number {
    return this.#entries.size;
  }

  public isRunning(workerId: string): boolean {
    return this.statusOf(workerId) === "running";
  }

  public start(workerId: string): Result<true, Error> {
    const entry = this.#entries.get(workerId);
    if (!entry) {
      return err(new Error(`Unknown worker: ${workerId}`));
    }
    if (entry.status === "running") {
      return err(new Error(`Worker "${workerId}" is already running`));
    }
    // Clears a previous failure, so a restart is a real restart.
    entry.status = "idle";
    return ok(true);
  }

  public stop(workerId: string): Result<true, Error> {
    const entry = this.#entries.get(workerId);
    if (!entry) {
      return err(new Error(`Unknown worker: ${workerId}`));
    }
    entry.controller?.abort();
    entry.controller = null;
    entry.status = "stopped";
    return ok(true);
  }

  /** Aborts a running worker without changing its registration. */
  public cancel(workerId: string): boolean {
    const entry = this.#entries.get(workerId);
    if (!entry?.controller) {
      return false;
    }
    entry.controller.abort();
    return true;
  }

  public stopAll(): void {
    for (const id of this.ids()) {
      this.stop(id);
    }
  }

  /**
   * Runs one worker to completion, bounded by its timeout.
   *
   * The attempt loop is capped by `maxAttempts`, so a permanently failing worker
   * cannot spin. Every attempt is recorded, and the last error is returned.
   */
  public async runOnce(workerId: string, timeoutMs?: number): Promise<Result<WorkerRunRecord, Error>> {
    const entry = this.#entries.get(workerId);
    if (!entry) {
      return err(new Error(`Unknown worker: ${workerId}`));
    }
    if (entry.status === "running") {
      return err(new Error(`Worker "${workerId}" is already running`));
    }

    const budget = timeoutMs ?? this.#defaultTimeoutMs;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      const controller = new AbortController();
      entry.controller = controller;
      entry.status = "running";
      const startedAt = this.#clock.nowMs();

      const timer = setTimeout(() => controller.abort(), budget);
      timer.unref?.();

      try {
        const detail = await entry.worker.run(controller.signal);
        const finishedAt = this.#clock.nowMs();
        entry.status = "idle";
        const record: WorkerRunRecord = {
          workerId,
          runId: this.#nextRunId(workerId),
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
          outcome: controller.signal.aborted ? "cancelled" : "succeeded",
          error: null,
          detail,
        };
        return this.#record(record);
      } catch (error) {
        const finishedAt = this.#clock.nowMs();
        const cancelled = controller.signal.aborted;
        const failure = error instanceof Error ? error : new Error(String(error));
        const record: WorkerRunRecord = {
          workerId,
          runId: this.#nextRunId(workerId),
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
          outcome: cancelled ? "cancelled" : "failed",
          error: failure.message,
          detail: { attempt },
        };
        this.#pushHistory(record);
        if (cancelled) {
          entry.status = "idle";
          return err(failure);
        }
        lastError = failure;
        entry.status = "failed";
      } finally {
        clearTimeout(timer);
        entry.controller = null;
      }
    }

    return err(lastError ?? new Error(`Worker "${workerId}" failed`));
  }

  public history(workerId?: string): readonly WorkerRunRecord[] {
    return workerId === undefined
      ? [...this.#history]
      : this.#history.filter((record) => record.workerId === workerId);
  }

  public clearHistory(): void {
    this.#history.length = 0;
  }

  #record(record: WorkerRunRecord): Result<WorkerRunRecord, Error> {
    this.#pushHistory(record);
    return ok(record);
  }

  #pushHistory(record: WorkerRunRecord): void {
    this.#history.push(record);
    while (this.#history.length > this.#maxHistory) {
      this.#history.shift();
    }
  }

  #nextRunId(workerId: string): string {
    this.#runCounter += 1;
    return `${workerId}-${this.#runCounter}`;
  }
}
