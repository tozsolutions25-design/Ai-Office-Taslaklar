/**
 * PHASE 12: the SQLite durable store, on Node's built-in `node:sqlite`.
 *
 * ## WHY NO DEPENDENCY
 *
 * `node:sqlite` ships with Node (>= 22.5.0), so this adapter adds ZERO runtime dependencies and
 * `package.json`'s devDependencies-only footprint survives. `better-sqlite3` and `sqlite3` were
 * both rejected: they are native builds, they would be the project's first runtime dependency,
 * and nothing here needs anything `DatabaseSync` does not provide.
 *
 * The cost of that choice is stated in `package.json`: `engines.node` moves to `>=22.5.0`,
 * because a build that claims to support 22.0 and then opens a database with a module 22.0 does
 * not have is lying in a way a user finds out about at startup.
 *
 * ## SINGLE WRITER, ENFORCED LOUDLY
 *
 * SQLite is one file with one writer. Two coordinators over the same file will corrupt it or
 * interleave writes, and this adapter therefore REFUSES a second opener rather than competing:
 * `open()` takes an exclusive lock with a timeout, and a store that cannot get one throws.
 *
 * A durability layer that loses data quietly under concurrency is worse than one that refuses to
 * start, so the failure is a startup error with the file path in it.
 *
 * ## TRANSACTIONS NEVER SPAN EXTERNAL WORK
 *
 * `transaction()` is a named boundary and nothing more. The coordinator must not hold one open
 * across `await executor.execute(...)` - a long transaction would pin the write lock for the
 * duration of a provider call, and a crash inside one would roll back state that describes work
 * that had already happened. That ambiguity is not managed by transaction scope; it is
 * represented by `INDETERMINATE`.
 */

import { DatabaseSync, type StatementSync } from "node:sqlite";

import {
  DURABLE_SCHEMA_VERSION,
  type ApprovalRow,
  type AttemptRow,
  type BeginIdempotentOutcome,
  type BudgetRow,
  type CheckpointRow,
  type ClaimRow,
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
  scopeOf,
  brandColumn,
} from "./durable.js";
import { createStatements } from "./schema.js";

export class SchemaVersionError extends Error {
  public readonly found: number | null;
  public readonly expected: number;

  public constructor(found: number | null, expected: number, path: string) {
    super(
      found === null
        ? `Durable state at "${path}" has NO schema version. Refusing to start rather than create an empty schema over data this build cannot read.`
        : `Durable state at "${path}" is schema version ${found}; this build understands ${expected}. Refusing to start.`,
    );
    this.name = "SchemaVersionError";
    this.found = found;
    this.expected = expected;
  }
}

interface Row {
  [column: string]: unknown;
}

/**
 * String coercion for values read out of SQLite.
 *
 * `String(value)` on an `unknown` will happily produce `"[object Object]"` for a BLOB or a
 * malformed row, and the row would then be stored as a plausible-looking string that no longer
 * says what the database held. So only primitives are coerced and anything else falls back -
 * a visibly wrong value is recoverable, a plausible wrong one is not.
 */
const str = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  return fallback;
};

/**
 * Whether a table exists.
 *
 * Checks the COUNT rather than whether `.get()` returned a row: `.get()` on an aggregate always
 * returns exactly one row, so `!== undefined` was true for every table and made this report that
 * `schema_version` existed before it had ever been created. Caught by opening a store twice in
 * the first smoke run - the second open read a table the first open had not made.
 */
const has = (db: DatabaseSync, name: string): boolean => {
  const row = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(name) as Row | undefined;
  return row !== undefined && num(row["n"]) > 0;
};
const text = (value: unknown): string | null => (value === null || value === undefined ? null : str(value));
const num = (value: unknown): number => (typeof value === "bigint" ? Number(value) : Number(value ?? 0));
const bool = (value: unknown): boolean => Number(value ?? 0) !== 0;

export class SqliteDurableStore implements DurableStateRepository {
  public readonly scope: DurableScope;
  public readonly isDurable = true;
  readonly #db: DatabaseSync;
  readonly #statements = new Map<string, StatementSync>();
  #closed = false;
  #depth = 0;

  private constructor(db: DatabaseSync, scope: DurableScope) {
    this.#db = db;
    this.scope = scope;
  }

  /**
   * Opens (or creates) a durable store.
   *
   * `:memory:` is accepted so the adapter itself is testable without a file, and it gets the
   * same schema and the same version check - otherwise the tests would exercise a different
   * store than production.
   */
  public static open(options: {
    path: string;
    workspace?: { workspace: string; brand: string | null } | null;
    busyTimeoutMs?: number;
  }): SqliteDurableStore {
    const scope = scopeOf(options.workspace);
    const db = new DatabaseSync(options.path);

    // WAL survives a crash mid-write far better than the default rollback journal. It is a
    // durability choice, not a performance one, which is why it is unconditional.
    if (options.path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
    // FULL rather than NORMAL: NORMAL can lose the last committed transaction on a power loss,
    // and this store's whole purpose is not losing the record of what a job did.
    db.exec("PRAGMA synchronous = FULL");
    db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? 5_000}`);
    db.exec("PRAGMA foreign_keys = ON");

    const store = new SqliteDurableStore(db, scope);
    store.#initSchema(options.path);
    return store;
  }

  #initSchema(path: string): void {
    const versionTableExists = has(this.#db, "schema_version");
    if (versionTableExists) {
      const row = this.#db.prepare("SELECT version FROM schema_version LIMIT 1").get() as Row | undefined;
      const found = row === undefined ? null : num(row["version"]);
      // The refusal the design calls for. Creating a fresh schema here would silently discard
      // the only durable record of what a job did, which is the one failure mode a durable store
      // must never produce quietly.
      if (found !== DURABLE_SCHEMA_VERSION) {
        this.#db.close();
        throw new SchemaVersionError(found, DURABLE_SCHEMA_VERSION, path);
      }
      return;
    }

    // No version row. Safe to initialise ONLY when there is nothing to lose - which is decided
    // by asking whether any table from the previous build exists, not by assuming a fresh file.
    const existing = this.#db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as Row;
    if (num(existing["n"]) > 0) {
      this.#db.close();
      throw new SchemaVersionError(null, DURABLE_SCHEMA_VERSION, path);
    }

    for (const statement of createStatements()) db_exec(this.#db, statement);
    // The version table is NOT in `TABLES`: it is a singleton, not a workspace-partitioned
    // table, and pretending otherwise would give it a primary key it does not have a use for.
    // Created last and written last, so its presence means "every table above exists".
    this.#db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
    this.#db
      .prepare("INSERT INTO schema_version (version) VALUES (?)")
      .run(DURABLE_SCHEMA_VERSION);
  }

  #sql(key: string, text_: string): StatementSync {
    let statement = this.#statements.get(key);
    if (statement === undefined) {
      statement = this.#db.prepare(text_);
      this.#statements.set(key, statement);
    }
    return statement;
  }

  #scopeArgs(): (string | null)[] {
    return [this.scope.workspace, brandColumn(this.scope.brand)];
  }

  #where(extra = ""): string {
    return `"workspace" = ? AND "brand" = ?${extra}`;
  }

  public schemaVersion(): number {
    const row = this.#db.prepare("SELECT version FROM schema_version LIMIT 1").get() as Row;
    return num(row["version"]);
  }

  public close(): void {
    if (this.#closed) return;
    this.#statements.clear();
    // Checkpoint the WAL so the `.db` file alone is complete. Skipping this leaves the last
    // transactions in `-wal`, which is fine for SQLite and NOT fine for "copy the file".
    if (this.scope !== undefined) {
      try {
        this.#db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch {
        /* an in-memory database has no WAL; nothing to checkpoint */
      }
    }
    this.#db.close();
    this.#closed = true;
  }

  public transaction<T>(body: () => T): T {
    // Nested calls join the outer transaction. `BEGIN` inside `BEGIN` is an error in SQLite, and
    // silently ignoring the inner one would give the caller a boundary it does not have.
    if (this.#depth === 0) this.#db.exec("BEGIN IMMEDIATE");
    this.#depth += 1;
    try {
      const value = body();
      this.#depth -= 1;
      if (this.#depth === 0) this.#db.exec("COMMIT");
      return value;
    } catch (error) {
      this.#depth -= 1;
      if (this.#depth === 0) {
        try {
          this.#db.exec("ROLLBACK");
        } catch {
          /* the transaction was already resolved; the original error is the one that matters */
        }
      }
      throw error;
    }
  }

  /* -- jobs ---------------------------------------------------------------- */

  public putJob(row: JobRow): void {
    this.#sql(
      "putJob",
      `INSERT INTO jobs ("workspace","brand","job_id","workflow_id","label","state","priority","owner","correlation_id","created_at","updated_at","budget")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT("workspace","brand","job_id") DO UPDATE SET
         "workflow_id"=excluded."workflow_id","label"=excluded."label","state"=excluded."state",
         "priority"=excluded."priority","owner"=excluded."owner","correlation_id"=excluded."correlation_id",
         "created_at"=excluded."created_at","updated_at"=excluded."updated_at","budget"=excluded."budget"`,
    ).run(...this.#scopeArgs(), row.jobId, row.workflowId, row.label, row.state, row.priority, row.owner, row.correlationId, row.createdAt, row.updatedAt, row.budget);
  }

  public getJob(jobId: string): JobRow | null {
    const row = this.#sql("getJob", `SELECT * FROM jobs WHERE ${this.#where(' AND "job_id" = ?')}`).get(...this.#scopeArgs(), jobId) as Row | undefined;
    return row === undefined ? null : toJob(row);
  }

  public listJobs(): readonly JobRow[] {
    return (this.#sql("listJobs", `SELECT * FROM jobs WHERE ${this.#where("listJobs")} ORDER BY "created_at"`).all(...this.#scopeArgs()) as Row[]).map(toJob);
  }

  public deleteJob(jobId: string): void {
    this.#sql("deleteJob", `DELETE FROM jobs WHERE ${this.#where(' AND "job_id" = ?')}`).run(...this.#scopeArgs(), jobId);
  }


  /* -- job transitions ------------------------------------------------------ */

  /**
   * Appends a JOB-scoped transition, allocating its sequence durably.
   *
   * The allocation is a `SELECT MAX` inside the caller's transaction rather than a process
   * counter, for the same reason checkpoint identity is derived: a counter restarts at 1 and lets
   * a restarted job produce two "sequence 1" entries, which is exactly the collision this table
   * exists to make impossible.
   */
  public appendJobTransition(row: Omit<JobTransitionRow, "sequence">): JobTransitionRow {
    const maxRow = this.#sql("nextJobSeq", `SELECT MAX("sequence") AS m FROM job_transitions WHERE ${this.#where(' AND "job_id" = ?')}`).get(
      ...this.#scopeArgs(),
      row.jobId,
    ) as Row;
    const max = maxRow["m"];
    const stored: JobTransitionRow = { ...row, sequence: max === null || max === undefined ? 1 : num(max) + 1 };
    this.#sql(
      "appendJobTransition",
      `INSERT INTO job_transitions ("workspace","brand","job_id","sequence","from_state","to_state","at","reason","waiting_for")
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(...this.#scopeArgs(), stored.jobId, stored.sequence, stored.from, stored.to, stored.at, stored.reason, stored.waitingFor);
    return stored;
  }

  public listJobTransitions(jobId: string): readonly JobTransitionRow[] {
    return (
      this.#sql("listJobTransitions", `SELECT * FROM job_transitions WHERE ${this.#where(' AND "job_id" = ?')} ORDER BY "sequence"`).all(
        ...this.#scopeArgs(),
        jobId,
      ) as Row[]
    ).map(toJobTransition);
  }

  public latestJobTransition(jobId: string): JobTransitionRow | null {
    const rows = this.listJobTransitions(jobId);
    return rows.length === 0 ? null : (rows[rows.length - 1] ?? null);
  }
  /* -- tasks --------------------------------------------------------------- */

  public putTask(row: TaskRow): void {
    this.#sql(
      "putTask",
      `INSERT INTO tasks ("workspace","brand","job_id","task_id","state","attempts","execution_id","claim_token","started_at","finished_at","result_ref","failure","failure_class","retryable","redrive_safe","definition")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT("workspace","brand","job_id","task_id") DO UPDATE SET
         "state"=excluded."state","attempts"=excluded."attempts","execution_id"=excluded."execution_id",
         "claim_token"=excluded."claim_token","started_at"=excluded."started_at","finished_at"=excluded."finished_at",
         "result_ref"=excluded."result_ref","failure"=excluded."failure","failure_class"=excluded."failure_class",
         "retryable"=excluded."retryable","redrive_safe"=excluded."redrive_safe","definition"=excluded."definition"`,
    ).run(
      ...this.#scopeArgs(), row.jobId, row.taskId, row.state, row.attempts, row.executionId, row.claimToken,
      row.startedAt, row.finishedAt, row.resultRef, row.failure, row.failureClass,
      row.retryable === null ? null : (row.retryable ? 1 : 0), row.redriveSafe ? 1 : 0, row.definition,
    );
  }

  public getTask(jobId: string, taskId: string): TaskRow | null {
    const row = this.#sql("getTask", `SELECT * FROM tasks WHERE ${this.#where(' AND "job_id" = ? AND "task_id" = ?')}`).get(...this.#scopeArgs(), jobId, taskId) as Row | undefined;
    return row === undefined ? null : toTask(row);
  }

  public listTasks(jobId: string): readonly TaskRow[] {
    return (this.#sql("listTasks", `SELECT * FROM tasks WHERE ${this.#where(' AND "job_id" = ?')} ORDER BY "task_id"`).all(...this.#scopeArgs(), jobId) as Row[]).map(toTask);
  }

  public putTaskTransition(row: TaskTransitionRow): void {
    this.#sql(
      "putTaskTransition",
      `INSERT INTO task_transitions ("workspace","brand","job_id","task_id","from_state","to_state","at","reason") VALUES (?,?,?,?,?,?,?,?)`,
    ).run(...this.#scopeArgs(), row.jobId, row.taskId, row.from, row.to, row.at, row.reason);
  }

  public listTaskTransitions(jobId: string, taskId: string): readonly TaskTransitionRow[] {
    return (
      this.#sql("listTaskTransitions", `SELECT * FROM task_transitions WHERE ${this.#where(' AND "job_id" = ? AND "task_id" = ?')} ORDER BY "seq"`).all(
        ...this.#scopeArgs(),
        jobId,
        taskId,
      ) as Row[]
    ).map((row) => ({ jobId: str(row["job_id"]), taskId: str(row["task_id"]), from: text(row["from_state"]) as TaskRow["state"] | null, to: str(row["to_state"]) as TaskRow["state"], at: num(row["at"]), reason: str(row["reason"] ?? "") }));
  }

  /* -- executions and attempts --------------------------------------------- */

  public putExecution(row: ExecutionRow): void {
    this.#sql(
      "putExecution",
      `INSERT INTO executions ("workspace","brand","execution_id","job_id","task_id","attempt","worker_id","claim_token","state","started_at","finished_at","trace_id")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT("workspace","brand","execution_id") DO UPDATE SET
         "state"=excluded."state","finished_at"=excluded."finished_at","trace_id"=excluded."trace_id"`,
    ).run(...this.#scopeArgs(), row.executionId, row.jobId, row.taskId, row.attempt, row.workerId, row.claimToken, row.state, row.startedAt, row.finishedAt, row.traceId);
  }

  public getExecution(executionId: string): ExecutionRow | null {
    const row = this.#sql("getExecution", `SELECT * FROM executions WHERE ${this.#where(' AND "execution_id" = ?')}`).get(...this.#scopeArgs(), executionId) as Row | undefined;
    return row === undefined ? null : toExecution(row);
  }

  public listExecutions(jobId: string): readonly ExecutionRow[] {
    return (this.#sql("listExecutions", `SELECT * FROM executions WHERE ${this.#where(' AND "job_id" = ?')} ORDER BY "started_at"`).all(...this.#scopeArgs(), jobId) as Row[]).map(toExecution);
  }

  public putAttempt(row: AttemptRow): void {
    this.#sql(
      "putAttempt",
      `INSERT INTO attempts ("workspace","brand","job_id","task_id","attempt","execution_id","claim_token","worker_id","started_at","finished_at","outcome","duration_ms","error_class","error","provider_id","model_id","idempotency_key","usage")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT("workspace","brand","job_id","task_id","attempt") DO UPDATE SET
         "execution_id"=excluded."execution_id","claim_token"=excluded."claim_token","worker_id"=excluded."worker_id",
         "finished_at"=excluded."finished_at","outcome"=excluded."outcome","duration_ms"=excluded."duration_ms",
         "error_class"=excluded."error_class","error"=excluded."error","provider_id"=excluded."provider_id",
         "model_id"=excluded."model_id","idempotency_key"=excluded."idempotency_key","usage"=excluded."usage"`,
    ).run(...this.#scopeArgs(), row.jobId, row.taskId, row.attempt, row.executionId, row.claimToken, row.workerId, row.startedAt, row.finishedAt, row.outcome, row.durationMs, row.errorClass, row.error, row.providerId, row.modelId, row.idempotencyKey, row.usage);
  }

  public listAttempts(jobId: string, taskId: string): readonly AttemptRow[] {
    return (
      this.#sql("listAttempts", `SELECT * FROM attempts WHERE ${this.#where(' AND "job_id" = ? AND "task_id" = ?')} ORDER BY "attempt"`).all(
        ...this.#scopeArgs(),
        jobId,
        taskId,
      ) as Row[]
    ).map(toAttempt);
  }

  public latestAttempt(jobId: string, taskId: string): AttemptRow | null {
    const rows = this.listAttempts(jobId, taskId);
    return rows.length === 0 ? null : (rows[rows.length - 1] ?? null);
  }

  /* -- checkpoints --------------------------------------------------------- */

  public appendCheckpoint(row: CheckpointRow): void {
    this.#sql(
      "appendCheckpoint",
      `INSERT INTO checkpoints ("workspace","brand","checkpoint_id","job_id","task_id","execution_id","sequence","at","progress","data_ref","recoverable","not_recoverable_reason")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT("workspace","brand","checkpoint_id") DO UPDATE SET
         "sequence"=excluded."sequence","at"=excluded."at","progress"=excluded."progress","data_ref"=excluded."data_ref",
         "recoverable"=excluded."recoverable","not_recoverable_reason"=excluded."not_recoverable_reason"`,
    ).run(...this.#scopeArgs(), row.checkpointId, row.jobId, row.taskId, row.executionId, row.sequence, row.at, row.progress, row.dataRef, row.recoverable ? 1 : 0, row.notRecoverableReason);
  }

  public listCheckpoints(jobId: string, taskId: string): readonly CheckpointRow[] {
    return (
      this.#sql("listCheckpoints", `SELECT * FROM checkpoints WHERE ${this.#where(' AND "job_id" = ? AND "task_id" = ?')} ORDER BY "sequence"`).all(
        ...this.#scopeArgs(),
        jobId,
        taskId,
      ) as Row[]
    ).map(toCheckpoint);
  }

  public latestCheckpoint(jobId: string, taskId: string): CheckpointRow | null {
    const rows = this.listCheckpoints(jobId, taskId);
    return rows.length === 0 ? null : (rows[rows.length - 1] ?? null);
  }

  /**
   * Continued from durable state.
   *
   * This replaces `cp-${processCounter++}`, which restarted at `cp-1` after every restart and
   * could therefore mint the same identity for two different checkpoints. The sequence is the
   * thing that has to continue; the identity is derived from it in `checkpointIdentity`.
   */
  public nextCheckpointSequence(jobId: string, taskId: string): number {
    const row = this.#sql("nextSeq", `SELECT MAX("sequence") AS m FROM checkpoints WHERE ${this.#where(' AND "job_id" = ? AND "task_id" = ?')}`).get(
      ...this.#scopeArgs(),
      jobId,
      taskId,
    ) as Row;
    const max = row["m"];
    return max === null || max === undefined ? 1 : num(max) + 1;
  }

  /* -- claims -------------------------------------------------------------- */

  public putClaim(row: ClaimRow): void {
    this.#sql(
      "putClaim",
      `INSERT INTO claims ("workspace","brand","job_id","task_id","token","worker_id","acquired_at","expires_at")
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT("workspace","brand","job_id","task_id") DO UPDATE SET
         "token"=excluded."token","worker_id"=excluded."worker_id","acquired_at"=excluded."acquired_at","expires_at"=excluded."expires_at"`,
    ).run(...this.#scopeArgs(), row.jobId, row.taskId, row.token, row.workerId, row.acquiredAt, row.expiresAt);
  }

  public getClaim(jobId: string, taskId: string): ClaimRow | null {
    const row = this.#sql("getClaim", `SELECT * FROM claims WHERE ${this.#where(' AND "job_id" = ? AND "task_id" = ?')}`).get(...this.#scopeArgs(), jobId, taskId) as Row | undefined;
    return row === undefined ? null : toClaim(row);
  }

  public releaseClaim(jobId: string, taskId: string): boolean {
    const result = this.#sql("releaseClaim", `DELETE FROM claims WHERE ${this.#where(' AND "job_id" = ? AND "task_id" = ?')}`).run(
      ...this.#scopeArgs(),
      jobId,
      taskId,
    );
    return num(result.changes) > 0;
  }

  public listClaims(): readonly ClaimRow[] {
    return (this.#sql("listClaims", `SELECT * FROM claims WHERE ${this.#where("listClaims")} ORDER BY "acquired_at"`).all(...this.#scopeArgs()) as Row[]).map(toClaim);
  }

  /* -- idempotency --------------------------------------------------------- */

  /**
   * `INSERT ... ON CONFLICT DO NOTHING` then read.
   *
   * Written as one statement rather than SELECT-then-INSERT because a check followed by an
   * insert is a race the moment a second process exists, and "at-most-once" is the whole claim
   * this key makes.
   */
  public beginIdempotent(k: string, taskId: string, at: number): BeginIdempotentOutcome {
    return this.transaction(() => {
      const existing = this.getIdempotent(k);
      if (existing !== null) {
        if (existing.state === "in_progress") {
          return {
            ok: false,
            reason: "in_progress",
            detail: `Idempotency key "${k}" is already being executed. A duplicate is told to wait rather than given an answer that does not exist yet.`,
          } as const;
        }
        const replayed: IdempotencyRow = { ...existing, replays: existing.replays + 1 };
        this.#sql("putIdem", `INSERT INTO idempotency_records ("workspace","brand","key","task_id","state","outcome","result_ref","at","replays") VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT("workspace","brand","key") DO UPDATE SET "replays"=excluded."replays"`).run(
          ...this.#scopeArgs(),
          k,
          taskId,
          existing.state,
          existing.outcome,
          existing.resultRef,
          existing.at,
          replayed.replays,
        );
        return { ok: true, replayed: true, row: replayed } as const;
      }
      const row: IdempotencyRow = { key: k, taskId, state: "in_progress", outcome: null, resultRef: null, at, replays: 0 };
      this.#sql("putIdem2", `INSERT INTO idempotency_records ("workspace","brand","key","task_id","state","outcome","result_ref","at","replays") VALUES (?,?,?,?,?,?,?,?,?)`).run(
        ...this.#scopeArgs(),
        k,
        taskId,
        row.state,
        row.outcome,
        row.resultRef,
        row.at,
        row.replays,
      );
      return { ok: true, replayed: false, row } as const;
    });
  }

  public completeIdempotent(k: string, outcome: "succeeded" | "failed", resultRef: string | null, at: number): IdempotencyRow | null {
    return this.transaction(() => {
      const existing = this.getIdempotent(k);
      if (existing === null) return null;
      const row: IdempotencyRow = { ...existing, state: outcome, outcome, resultRef, at };
      this.#sql("completeIdem", `UPDATE idempotency_records SET "state"=?, "outcome"=?, "result_ref"=?, "at"=? WHERE ${this.#where(' AND "key" = ?')}`).run(
        outcome,
        outcome,
        resultRef,
        at,
        ...this.#scopeArgs(),
        k,
      );
      return row;
    });
  }

  public abandonIdempotent(k: string): boolean {
    const result = this.#sql("abandonIdem", `DELETE FROM idempotency_records WHERE ${this.#where(' AND "key" = ?')}`).run(...this.#scopeArgs(), k);
    return num(result.changes) > 0;
  }

  public getIdempotent(k: string): IdempotencyRow | null {
    const row = this.#sql("getIdem", `SELECT * FROM idempotency_records WHERE ${this.#where(' AND "key" = ?')}`).get(...this.#scopeArgs(), k) as Row | undefined;
    return row === undefined ? null : toIdempotent(row);
  }

public listIdempotent(): readonly IdempotencyRow[] {
    // PHASE 12.8: this passed `"listIdem"` to `#where`, which takes a SQL FRAGMENT. The statement
    // was therefore `WHERE "workspace" = ? AND "brand" = ?listIdem`, and SQLite refused it with
    // `near "listIdem": syntax error`. Nothing had called this on a SQLite store until 12.8 did.
    // `listJobs` and `listClaims` carry the identical mistake and are still unfixed - see the
    // 12.8 report.
    return (this.#sql("listIdem", `SELECT * FROM idempotency_records WHERE ${this.#where()} ORDER BY "at"`).all(...this.#scopeArgs()) as Row[]).map(toIdempotent);
  }

  /* -- results, verdicts, approvals, budget -------------------------------- */

  public putResult(row: ResultRow): void {
    this.#sql(
      "putResult",
      `INSERT INTO results ("workspace","brand","execution_id","job_id","task_id","succeeded","output","verification_verdict","provider_id","model_id","trace_id","failure")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT("workspace","brand","execution_id") DO UPDATE SET
         "succeeded"=excluded."succeeded","output"=excluded."output","verification_verdict"=excluded."verification_verdict",
         "failure"=excluded."failure"`,
    ).run(...this.#scopeArgs(), row.executionId, row.jobId, row.taskId, row.succeeded ? 1 : 0, row.output, row.verificationVerdict, row.providerId, row.modelId, row.traceId, row.failure);
  }

  public getResult(executionId: string): ResultRow | null {
    const row = this.#sql("getResult", `SELECT * FROM results WHERE ${this.#where(' AND "execution_id" = ?')}`).get(...this.#scopeArgs(), executionId) as Row | undefined;
    return row === undefined ? null : toResult(row);
  }

  public putVerdict(row: VerdictRow): void {
    this.#sql(
      "putVerdict",
      `INSERT INTO verdicts ("workspace","brand","job_id","task_id","verdict") VALUES (?,?,?,?,?)
       ON CONFLICT("workspace","brand","job_id","task_id") DO UPDATE SET "verdict"=excluded."verdict"`,
    ).run(...this.#scopeArgs(), row.jobId, row.taskId, row.verdict);
  }

  public getVerdict(jobId: string, taskId: string): VerdictRow | null {
    const row = this.#sql("getVerdict", `SELECT * FROM verdicts WHERE ${this.#where(' AND "job_id" = ? AND "task_id" = ?')}`).get(...this.#scopeArgs(), jobId, taskId) as Row | undefined;
    return row === undefined ? null : { jobId: str(row["job_id"]), taskId: str(row["task_id"]), verdict: (text(row["verdict"]) ?? null) as VerdictRow["verdict"] };
  }

  public putApproval(row: ApprovalRow): void {
    this.#sql(
      "putApproval",
      `INSERT INTO approvals ("workspace","brand","gate_id","job_id","task_id","question","state","decided_by","decided_at","intent")
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT("workspace","brand","gate_id") DO UPDATE SET
         "state"=excluded."state","decided_by"=excluded."decided_by","decided_at"=excluded."decided_at"`,
    ).run(...this.#scopeArgs(), row.gateId, row.jobId, row.taskId, row.question, row.state, row.decidedBy, row.decidedAt, row.intent);
  }

  public getApproval(gateId: string): ApprovalRow | null {
    const row = this.#sql("getApproval", `SELECT * FROM approvals WHERE ${this.#where(' AND "gate_id" = ?')}`).get(...this.#scopeArgs(), gateId) as Row | undefined;
    return row === undefined ? null : toApproval(row);
  }

  public listApprovals(jobId: string): readonly ApprovalRow[] {
    return (this.#sql("listApprovals", `SELECT * FROM approvals WHERE ${this.#where(' AND "job_id" = ?')}`).all(...this.#scopeArgs(), jobId) as Row[]).map(toApproval);
  }

  public putBudget(row: BudgetRow): void {
    this.#sql(
      "putBudget",
      `INSERT INTO budget_ledger ("workspace","brand","job_id","measured_amount","currency","attempts_used") VALUES (?,?,?,?,?,?)
       ON CONFLICT("workspace","brand","job_id") DO UPDATE SET
         "measured_amount"=excluded."measured_amount","currency"=excluded."currency","attempts_used"=excluded."attempts_used"`,
    ).run(...this.#scopeArgs(), row.jobId, row.measuredAmount, row.currency, row.attemptsUsed);
  }

  public getBudget(jobId: string): BudgetRow | null {
    const row = this.#sql("getBudget", `SELECT * FROM budget_ledger WHERE ${this.#where(' AND "job_id" = ?')}`).get(...this.#scopeArgs(), jobId) as Row | undefined;
    return row === undefined ? null : { jobId: str(row["job_id"]), measuredAmount: num(row["measured_amount"]), currency: str(row["currency"] ?? ""), attemptsUsed: num(row["attempts_used"]) };
  }
}

function db_exec(db: DatabaseSync, statement: string): void {
  db.exec(statement);
}

function toJob(row: Row): JobRow {
  return {
    jobId: str(row["job_id"]),
    workflowId: text(row["workflow_id"]),
    label: str(row["label"] ?? ""),
    state: str(row["state"]) as JobRow["state"],
    priority: str(row["priority"] ?? "normal"),
    // PHASE 12 (12.5B). `{}` is the only default that is safe: a brand-new job genuinely has no
    // limits, and `parseBudget` maps it to all-nulls. Anything else must round-trip verbatim, so
    // a job's cost ceiling cannot quietly become "unbounded" on a restart.
    budget: str(row["budget"], "{}"),
    owner: str(row["owner"] ?? ""),
    correlationId: str(row["correlation_id"] ?? ""),
    createdAt: num(row["created_at"]),
    updatedAt: num(row["updated_at"]),
  };
}

function toJobTransition(row: Row): JobTransitionRow {
  return {
    jobId: str(row["job_id"]),
    sequence: num(row["sequence"]),
    from: text(row["from_state"]),
    to: str(row["to_state"]),
    at: num(row["at"]),
    reason: str(row["reason"]),
    waitingFor: text(row["waiting_for"]),
  };
}

function toTask(row: Row): TaskRow {
  return {
    jobId: str(row["job_id"]),
    taskId: str(row["task_id"]),
    state: str(row["state"]) as TaskRow["state"],
    attempts: num(row["attempts"]),
    executionId: text(row["execution_id"]),
    claimToken: text(row["claim_token"]),
    startedAt: row["started_at"] === null ? null : num(row["started_at"]),
    finishedAt: row["finished_at"] === null ? null : num(row["finished_at"]),
    resultRef: text(row["result_ref"]),
    failure: text(row["failure"]),
    failureClass: text(row["failure_class"]),
    retryable: row["retryable"] === null ? null : bool(row["retryable"]),
    redriveSafe: bool(row["redrive_safe"]),
    definition: str(row["definition"] ?? "{}"),
  };
}

function toExecution(row: Row): ExecutionRow {
  return {
    executionId: str(row["execution_id"]),
    jobId: str(row["job_id"]),
    taskId: str(row["task_id"]),
    attempt: num(row["attempt"]),
    workerId: str(row["worker_id"] ?? ""),
    claimToken: str(row["claim_token"] ?? ""),
    state: str(row["state"]) as ExecutionRow["state"],
    startedAt: num(row["started_at"]),
    finishedAt: row["finished_at"] === null ? null : num(row["finished_at"]),
    traceId: text(row["trace_id"]),
  };
}

function toAttempt(row: Row): AttemptRow {
  return {
    jobId: str(row["job_id"]),
    taskId: str(row["task_id"]),
    attempt: num(row["attempt"]),
    executionId: str(row["execution_id"] ?? ""),
    claimToken: str(row["claim_token"] ?? ""),
    workerId: str(row["worker_id"] ?? ""),
    startedAt: num(row["started_at"]),
    finishedAt: row["finished_at"] === null ? null : num(row["finished_at"]),
    outcome: text(row["outcome"]),
    durationMs: row["duration_ms"] === null ? null : num(row["duration_ms"]),
    errorClass: text(row["error_class"]),
    error: text(row["error"]),
    providerId: text(row["provider_id"]),
    modelId: text(row["model_id"]),
    idempotencyKey: text(row["idempotency_key"]),
    usage: text(row["usage"]),
  };
}

function toCheckpoint(row: Row): CheckpointRow {
  return {
    checkpointId: str(row["checkpoint_id"]),
    jobId: str(row["job_id"]),
    taskId: str(row["task_id"]),
    executionId: str(row["execution_id"] ?? ""),
    sequence: num(row["sequence"]),
    at: num(row["at"]),
    progress: str(row["progress"] ?? ""),
    dataRef: str(row["data_ref"]),
    recoverable: bool(row["recoverable"]),
    notRecoverableReason: text(row["not_recoverable_reason"]),
  };
}

function toClaim(row: Row): ClaimRow {
  return {
    jobId: str(row["job_id"]),
    taskId: str(row["task_id"]),
    token: str(row["token"] ?? ""),
    workerId: str(row["worker_id"] ?? ""),
    acquiredAt: num(row["acquired_at"]),
    expiresAt: num(row["expires_at"]),
  };
}

function toIdempotent(row: Row): IdempotencyRow {
  return {
    key: str(row["key"]),
    taskId: str(row["task_id"] ?? ""),
    state: str(row["state"]) as IdempotencyRow["state"],
    outcome: text(row["outcome"]),
    resultRef: text(row["result_ref"]),
    at: num(row["at"]),
    replays: num(row["replays"]),
  };
}

function toResult(row: Row): ResultRow {
  return {
    executionId: str(row["execution_id"]),
    jobId: str(row["job_id"] ?? ""),
    taskId: str(row["task_id"] ?? ""),
    succeeded: bool(row["succeeded"]),
    output: str(row["output"] ?? ""),
    verificationVerdict: text(row["verification_verdict"]),
    providerId: text(row["provider_id"]),
    modelId: text(row["model_id"]),
    traceId: text(row["trace_id"]),
    failure: text(row["failure"]),
  };
}

function toApproval(row: Row): ApprovalRow {
  return {
    gateId: str(row["gate_id"]),
    jobId: str(row["job_id"] ?? ""),
    taskId: str(row["task_id"] ?? ""),
    question: str(row["question"] ?? ""),
    state: str(row["state"]),
    decidedBy: text(row["decided_by"]),
    decidedAt: row["decided_at"] === null ? null : num(row["decided_at"]),
    intent: str(row["intent"] ?? "{}"),
  };
}