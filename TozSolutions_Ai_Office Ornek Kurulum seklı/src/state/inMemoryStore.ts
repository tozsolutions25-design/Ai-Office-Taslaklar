/**
 * PHASE 12: the in-memory durable store.
 *
 * ## WHY IT EXISTS RATHER THAN THE COORDINATOR'S MAPS
 *
 * This is NOT the coordinator's maps again. Those are caches; this is the authority. The
 * distinction is the whole point of the phase, and it is why this class is separate from the
 * eight `Map` fields it will replace as a source of truth.
 *
 * Its two jobs:
 *
 *  1. it is the REFERENCE implementation of `DurableStateRepository`, so the SQLite adapter has
 *     something to be compared against rather than only tests to satisfy;
 *  2. it keeps every existing test able to construct a runtime with no filesystem at all.
 *
 * ## IT IS NOT DURABLE, AND IT SAYS SO
 *
 * This class loses everything when the process ends, exactly as the coordinator's maps did. It
 * implements the same interface precisely so that "in memory" is a SELECTION rather than a
 * different kind of object - and `isDurable()` is on the interface for the same reason the
 * repository is: a caller that cannot tell which one it has will eventually believe it has the
 * durable one.
 */

import {
  UNATTRIBUTED_SCOPE,
  type ApprovalRow,
  type AttemptRow,
  type BeginIdempotentOutcome,
  type BudgetRow,
  type CheckpointRow,
  type ClaimRow,
  type ClaimRow as Claim,
  type DurableScope,
  type DurableStateRepository,
  type ExecutionRow,
  type IdempotencyRow,
  type JobRow,
  type JobTransitionRow,
  type ResultRow,
  type TaskRow,
  type TaskTransitionRow,
  type VerdictRow,
} from "./durable.js";

/**
 * A composite key, length-prefixed per part so `("a:b","c")` cannot collide with `("a","b:c")`.
 *
 * The same shape `StateStore.#ns` and `workspaceKey` use. Re-derived here rather than imported
 * because `core` files do not import each other's internals, and because a shared key function
 * is exactly the kind of thing that must not be silently changed for one caller.
 */
function key(...parts: readonly (string | number | null)[]): string {
  return parts.map((part) => (part === null ? "\u0001-" : `${String(part).length}:${String(part)}`)).join("\u0000");
}

export class InMemoryDurableStore implements DurableStateRepository {
  public readonly scope: DurableScope;
  public readonly isDurable = false;

  #jobs = new Map<string, JobRow>();
  #tasks = new Map<string, TaskRow>();
  #transitions = new Map<string, TaskTransitionRow[]>();
  /** PHASE 12 (12.5B-FIX): JOB-scoped history. Never merged with the task map above. */
  #jobTransitions = new Map<string, JobTransitionRow[]>();
  #executions = new Map<string, ExecutionRow>();
  #attempts = new Map<string, AttemptRow[]>();
  #checkpoints = new Map<string, CheckpointRow[]>();
  #claims = new Map<string, ClaimRow>();
  #idempotency = new Map<string, IdempotencyRow>();
  #results = new Map<string, ResultRow>();
  #verdicts = new Map<string, VerdictRow>();
  #approvals = new Map<string, ApprovalRow>();
  #budgets = new Map<string, BudgetRow>();
  #depth = 0;
  #snapshot: { jobs: Map<string, JobRow>; tasks: Map<string, TaskRow>; transitions: Map<string, TaskTransitionRow[]>; jobTransitions: Map<string, JobTransitionRow[]>; executions: Map<string, ExecutionRow>; attempts: Map<string, AttemptRow[]>; checkpoints: Map<string, CheckpointRow[]>; claims: Map<string, ClaimRow>; idempotency: Map<string, IdempotencyRow>; results: Map<string, ResultRow>; verdicts: Map<string, VerdictRow>; approvals: Map<string, ApprovalRow>; budgets: Map<string, BudgetRow> } | null = null;

  public constructor(options: { scope?: DurableScope } = {}) {
    this.scope = options.scope ?? UNATTRIBUTED_SCOPE;
  }

  public schemaVersion(): number {
    return 1;
  }

  public close(): void {
    /* nothing to release */
  }

  /**
   * Rolls back on throw, exactly as the SQLite adapter does.
   *
   * This was a no-op wrapper at first, on the reasoning that an in-memory store cannot half-write.
   * That reasoning was wrong in the way this phase exists to catch: a caller written against the
   * SQLite adapter would get atomicity in production and NOT in tests, and the test suite would
   * be the one place the guarantee was absent - which is precisely where nobody looks for it.
   *
   * So both implementations commit on return and roll back on throw. Snapshot-per-depth rather
   * than a journal, because this store is for tests and clarity beats throughput here.
   */
  public transaction<T>(body: () => T): T {
    if (this.#depth === 0) {
      this.#snapshot = {
        jobs: new Map(this.#jobs),
        tasks: new Map(this.#tasks),
        transitions: new Map([...this.#transitions].map(([k, v]) => [k, [...v]])),
        jobTransitions: new Map([...this.#jobTransitions].map(([k, v]) => [k, [...v]])),
        executions: new Map(this.#executions),
        attempts: new Map([...this.#attempts].map(([k, v]) => [k, [...v]])),
        checkpoints: new Map([...this.#checkpoints].map(([k, v]) => [k, [...v]])),
        claims: new Map(this.#claims),
        idempotency: new Map(this.#idempotency),
        results: new Map(this.#results),
        verdicts: new Map(this.#verdicts),
        approvals: new Map(this.#approvals),
        budgets: new Map(this.#budgets),
      };
    }
    this.#depth += 1;
    try {
      const value = body();
      this.#depth -= 1;
      if (this.#depth === 0) this.#snapshot = null;
      return value;
    } catch (error) {
      this.#depth -= 1;
      if (this.#depth === 0 && this.#snapshot !== null) {
        const s = this.#snapshot;
        this.#jobs = s.jobs;
        this.#tasks = s.tasks;
        this.#transitions = s.transitions;
        this.#jobTransitions = s.jobTransitions;
        this.#executions = s.executions;
        this.#attempts = s.attempts;
        this.#checkpoints = s.checkpoints;
        this.#claims = s.claims;
        this.#idempotency = s.idempotency;
        this.#results = s.results;
        this.#verdicts = s.verdicts;
        this.#approvals = s.approvals;
        this.#budgets = s.budgets;
        this.#snapshot = null;
      }
      throw error;
    }
  }

  public putJob(row: JobRow): void {
    this.#jobs.set(key(this.scope.workspace, this.scope.brand, row.jobId), row);
  }

  public getJob(jobId: string): JobRow | null {
    return this.#jobs.get(key(this.scope.workspace, this.scope.brand, jobId)) ?? null;
  }

  public listJobs(): readonly JobRow[] {
    return [...this.#jobs.values()];
  }

  public deleteJob(jobId: string): void {
    this.#jobs.delete(key(this.scope.workspace, this.scope.brand, jobId));
  }

  public putTask(row: TaskRow): void {
    this.#tasks.set(key(this.scope.workspace, this.scope.brand, row.jobId, row.taskId), row);
  }

  public getTask(jobId: string, taskId: string): TaskRow | null {
    return this.#tasks.get(key(this.scope.workspace, this.scope.brand, jobId, taskId)) ?? null;
  }

  public listTasks(jobId: string): readonly TaskRow[] {
    return [...this.#tasks.values()].filter((row) => row.jobId === jobId);
  }

  public appendJobTransition(row: Omit<JobTransitionRow, "sequence">): JobTransitionRow {
    // Durable sequence allocation, inside the caller's transaction. A process counter would
    // restart at 1 and let a restarted job produce two "sequence 1" entries.
    const k = key(this.scope.workspace, this.scope.brand, row.jobId);
    const list = this.#jobTransitions.get(k) ?? [];
    const last = list[list.length - 1];
    const stored: JobTransitionRow = { ...row, sequence: last === undefined ? 1 : last.sequence + 1 };
    list.push(stored);
    this.#jobTransitions.set(k, list);
    return stored;
  }

  public listJobTransitions(jobId: string): readonly JobTransitionRow[] {
    return [...(this.#jobTransitions.get(key(this.scope.workspace, this.scope.brand, jobId)) ?? [])];
  }

  public latestJobTransition(jobId: string): JobTransitionRow | null {
    const list = this.listJobTransitions(jobId);
    return list.length === 0 ? null : (list[list.length - 1] ?? null);
  }

  public putTaskTransition(row: TaskTransitionRow): void {
    const k = key(this.scope.workspace, this.scope.brand, row.jobId, row.taskId);
    const list = this.#transitions.get(k) ?? [];
    list.push(row);
    this.#transitions.set(k, list);
  }

  public listTaskTransitions(jobId: string, taskId: string): readonly TaskTransitionRow[] {
    return [...(this.#transitions.get(key(this.scope.workspace, this.scope.brand, jobId, taskId)) ?? [])];
  }

  public putExecution(row: ExecutionRow): void {
    this.#executions.set(key(this.scope.workspace, this.scope.brand, row.executionId), row);
  }

  public getExecution(executionId: string): ExecutionRow | null {
    return this.#executions.get(key(this.scope.workspace, this.scope.brand, executionId)) ?? null;
  }

  public listExecutions(jobId: string): readonly ExecutionRow[] {
    return [...this.#executions.values()].filter((row) => row.jobId === jobId);
  }

  public putAttempt(row: AttemptRow): void {
    const k = key(this.scope.workspace, this.scope.brand, row.jobId, row.taskId);
    const list = this.#attempts.get(k) ?? [];
    const at = list.findIndex((a) => a.attempt === row.attempt);
    if (at >= 0) list[at] = row;
    else list.push(row);
    this.#attempts.set(k, list);
  }

  public listAttempts(jobId: string, taskId: string): readonly AttemptRow[] {
    return [...(this.#attempts.get(key(this.scope.workspace, this.scope.brand, jobId, taskId)) ?? [])];
  }

  public latestAttempt(jobId: string, taskId: string): AttemptRow | null {
    const list = this.listAttempts(jobId, taskId);
    return list.length === 0 ? null : (list[list.length - 1] ?? null);
  }

  public appendCheckpoint(row: CheckpointRow): void {
    const k = key(this.scope.workspace, this.scope.brand, row.jobId, row.taskId);
    const list = this.#checkpoints.get(k) ?? [];
    list.push(row);
    this.#checkpoints.set(k, list);
  }

  public listCheckpoints(jobId: string, taskId: string): readonly CheckpointRow[] {
    return [...(this.#checkpoints.get(key(this.scope.workspace, this.scope.brand, jobId, taskId)) ?? [])];
  }

  public latestCheckpoint(jobId: string, taskId: string): CheckpointRow | null {
    const list = this.listCheckpoints(jobId, taskId);
    return list.length === 0 ? null : (list[list.length - 1] ?? null);
  }

  public nextCheckpointSequence(jobId: string, taskId: string): number {
    const latest = this.latestCheckpoint(jobId, taskId);
    return latest === null ? 1 : latest.sequence + 1;
  }

  public putClaim(row: ClaimRow): void {
    this.#claims.set(key(this.scope.workspace, this.scope.brand, row.jobId, row.taskId), row);
  }

  public getClaim(jobId: string, taskId: string): ClaimRow | null {
    return this.#claims.get(key(this.scope.workspace, this.scope.brand, jobId, taskId)) ?? null;
  }

  public releaseClaim(jobId: string, taskId: string): boolean {
    return this.#claims.delete(key(this.scope.workspace, this.scope.brand, jobId, taskId));
  }

  public listClaims(): readonly ClaimRow[] {
    return [...this.#claims.values()];
  }

  public beginIdempotent(k: string, taskId: string, at: number): BeginIdempotentOutcome {
    const id = key(this.scope.workspace, this.scope.brand, k);
    const existing = this.#idempotency.get(id);
    if (existing !== undefined) {
      if (existing.state === "in_progress") {
        return {
          ok: false,
          reason: "in_progress",
          detail: `Idempotency key "${k}" is already being executed. A duplicate is told to wait rather than given an answer that does not exist yet.`,
        };
      }
      const replayed: IdempotencyRow = { ...existing, replays: existing.replays + 1 };
      this.#idempotency.set(id, replayed);
      return { ok: true, replayed: true, row: replayed };
    }
    const row: IdempotencyRow = { key: k, taskId, state: "in_progress", outcome: null, resultRef: null, at, replays: 0 };
    this.#idempotency.set(id, row);
    return { ok: true, replayed: false, row };
  }

  public completeIdempotent(k: string, outcome: "succeeded" | "failed", resultRef: string | null, at: number): IdempotencyRow | null {
    const id = key(this.scope.workspace, this.scope.brand, k);
    const existing = this.#idempotency.get(id);
    if (existing === undefined) return null;
    const row: IdempotencyRow = { ...existing, state: outcome, outcome, resultRef, at };
    this.#idempotency.set(id, row);
    return row;
  }

  public abandonIdempotent(k: string): boolean {
    return this.#idempotency.delete(key(this.scope.workspace, this.scope.brand, k));
  }

  public getIdempotent(k: string): IdempotencyRow | null {
    return this.#idempotency.get(key(this.scope.workspace, this.scope.brand, k)) ?? null;
  }

  public listIdempotent(): readonly IdempotencyRow[] {
    return [...this.#idempotency.values()];
  }

  public putResult(row: ResultRow): void {
    this.#results.set(key(this.scope.workspace, this.scope.brand, row.executionId), row);
  }

  public getResult(executionId: string): ResultRow | null {
    return this.#results.get(key(this.scope.workspace, this.scope.brand, executionId)) ?? null;
  }

  public putVerdict(row: VerdictRow): void {
    this.#verdicts.set(key(this.scope.workspace, this.scope.brand, row.jobId, row.taskId), row);
  }

  public getVerdict(jobId: string, taskId: string): VerdictRow | null {
    return this.#verdicts.get(key(this.scope.workspace, this.scope.brand, jobId, taskId)) ?? null;
  }

  public putApproval(row: ApprovalRow): void {
    this.#approvals.set(key(this.scope.workspace, this.scope.brand, row.gateId), row);
  }

  public getApproval(gateId: string): ApprovalRow | null {
    return this.#approvals.get(key(this.scope.workspace, this.scope.brand, gateId)) ?? null;
  }

  public listApprovals(jobId: string): readonly ApprovalRow[] {
    return [...this.#approvals.values()].filter((row) => row.jobId === jobId);
  }

  public putBudget(row: BudgetRow): void {
    this.#budgets.set(key(this.scope.workspace, this.scope.brand, row.jobId), row);
  }

  public getBudget(jobId: string): BudgetRow | null {
    return this.#budgets.get(key(this.scope.workspace, this.scope.brand, jobId)) ?? null;
  }
}

/** Re-exported so consumers need not import two modules for one type. */
export type { Claim };
