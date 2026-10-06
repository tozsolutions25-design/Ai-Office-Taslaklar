/**
 * PHASE 12: the SQLite schema.
 *
 * ## WHY ONE FILE, AND WHY IT IS DATA AND NOT STRINGS
 *
 * Every statement lives here as a constant so that the schema has exactly one definition. The
 * alternative - each store method carrying its own SQL - is how a schema drifts into two
 * answers, and this repository has already spent a phase removing three copies of that mistake
 * (`SENSITIVE_KEY_FRAGMENTS`, the provider route table, the manual event-kind list).
 *
 * ## WORKSPACE IS IN EVERY KEY
 *
 * `workspace` is part of every primary key. It is NOT a tenant identity and NOT an authorization
 * boundary - `Job.owner` is recorded and read by nothing (PHASE 10) - but it IS a mechanical
 * partition, and a durable store that could be queried across partitions would make that
 * partition decorative.
 *
 * The unattributed partition is the reserved string `__unattributed__` rather than `NULL`,
 * because `NULL = NULL` is never true in SQL: an unpartitioned reader would otherwise never find
 * an unpartitioned row.
 *
 * ## SCHEMA VERSION IS A ROW, NOT A COMMENT
 *
 * `schema_version` is a persisted singleton row. On open, a database with no version row, or a
 * version this build does not understand, is REFUSED. Creating a fresh empty schema over
 * existing durable data would silently destroy the only copy of a job's outcome, which is the
 * worst thing a durable store can do and the one thing it must never do quietly.
 */

export interface ColumnSpec {
  readonly name: string;
  readonly type: "TEXT" | "INTEGER" | "REAL";
  readonly notNull?: boolean;
  readonly primary?: boolean;
  readonly autoincrement?: boolean;
  readonly default?: number | string;
}

export interface TableSpec {
  readonly name: string;
  readonly columns: readonly ColumnSpec[];
  /** Column names forming the primary key, in order. */
  readonly primaryKey: readonly string[];
  readonly indexes?: readonly { readonly name: string; readonly columns: readonly string[] }[];
}

/** Column definitions shared by most tables. */
const scopeColumns: readonly ColumnSpec[] = [
  { name: "workspace", type: "TEXT", notNull: true, primary: true },
  { name: "brand", type: "TEXT", primary: true },
];

export const TABLES: readonly TableSpec[] = [
  {
    name: "jobs",
    columns: [
      ...scopeColumns,
      { name: "job_id", type: "TEXT", notNull: true, primary: true },
      { name: "workflow_id", type: "TEXT" },
      { name: "label", type: "TEXT", notNull: true, default: "" },
      { name: "state", type: "TEXT", notNull: true },
      { name: "priority", type: "TEXT", notNull: true, default: "normal" },
      { name: "owner", type: "TEXT", notNull: true, default: "" },
      { name: "correlation_id", type: "TEXT", notNull: true, default: "" },
      // PHASE 12 (12.5B): the job's ResourceBudget as JSON. See `JobRow.budget`.
      { name: "budget", type: "TEXT", notNull: true, default: "{}" },
      { name: "created_at", type: "INTEGER", notNull: true, default: 0 },
      { name: "updated_at", type: "INTEGER", notNull: true, default: 0 },
    ],
    primaryKey: ["workspace", "brand", "job_id"],
    indexes: [{ name: "idx_jobs_state", columns: ["state"] }],
  },
  {
    name: "tasks",
    columns: [
      ...scopeColumns,
      { name: "job_id", type: "TEXT", notNull: true, primary: true },
      { name: "task_id", type: "TEXT", notNull: true, primary: true },
      { name: "state", type: "TEXT", notNull: true },
      { name: "attempts", type: "INTEGER", notNull: true, default: 0 },
      { name: "execution_id", type: "TEXT" },
      { name: "claim_token", type: "TEXT" },
      { name: "started_at", type: "INTEGER" },
      { name: "finished_at", type: "INTEGER" },
      { name: "result_ref", type: "TEXT" },
      { name: "failure", type: "TEXT" },
      { name: "failure_class", type: "TEXT" },
      { name: "retryable", type: "INTEGER" },
      // PHASE 12. The ONLY thing that lets recovery advance an `indeterminate` task on its own.
      { name: "redrive_safe", type: "INTEGER", notNull: true, default: 0 },
      { name: "definition", type: "TEXT", notNull: true, default: "{}" },
    ],
    primaryKey: ["workspace", "brand", "job_id", "task_id"],
    indexes: [{ name: "idx_tasks_state", columns: ["state"] }],
  },
  {
    // PHASE 12 (12.5B-FIX). Distinct from `task_transitions` and deliberately so: this is the
    // JOB lifecycle audit trace, that is per-TASK state history. `#transitions` in the coordinator
    // is job-scoped, and before this table existed it had NO durable representation at all - so a
    // restart silently lost a job's entire history. Not folded into the task table: a job
    // transition has no task id, and inventing one would make the two histories unreadable.
    name: "job_transitions",
    columns: [
      ...scopeColumns,
      { name: "job_id", type: "TEXT", notNull: true, primary: true },
      // Durable ordering. Allocated by the repository from durable state, never a process
      // counter - the same lesson as checkpoint identity.
      { name: "sequence", type: "INTEGER", notNull: true, primary: true },
      // `from_state` is nullable because CREATION is `null -> queued`, not a transition.
      { name: "from_state", type: "TEXT" },
      { name: "to_state", type: "TEXT", notNull: true },
      { name: "at", type: "INTEGER", notNull: true, default: 0 },
      { name: "reason", type: "TEXT", notNull: true, default: "" },
      { name: "waiting_for", type: "TEXT" },
    ],
    primaryKey: ["workspace", "brand", "job_id", "sequence"],
  },
  {
    name: "task_transitions",
    columns: [
      ...scopeColumns,
      { name: "seq", type: "INTEGER", notNull: true, primary: true, autoincrement: true },
      { name: "job_id", type: "TEXT", notNull: true },
      { name: "task_id", type: "TEXT", notNull: true },
      { name: "from_state", type: "TEXT" },
      { name: "to_state", type: "TEXT", notNull: true },
      { name: "at", type: "INTEGER", notNull: true, default: 0 },
      { name: "reason", type: "TEXT", notNull: true, default: "" },
    ],
    primaryKey: ["seq"],
    indexes: [{ name: "idx_transitions_task", columns: ["job_id", "task_id"] }],
  },
  {
    name: "executions",
    columns: [
      ...scopeColumns,
      { name: "execution_id", type: "TEXT", notNull: true, primary: true },
      { name: "job_id", type: "TEXT", notNull: true },
      { name: "task_id", type: "TEXT", notNull: true },
      { name: "attempt", type: "INTEGER", notNull: true, default: 1 },
      { name: "worker_id", type: "TEXT", notNull: true, default: "" },
      { name: "claim_token", type: "TEXT", notNull: true, default: "" },
      { name: "state", type: "TEXT", notNull: true },
      { name: "started_at", type: "INTEGER", notNull: true, default: 0 },
      { name: "finished_at", type: "INTEGER" },
      { name: "trace_id", type: "TEXT" },
    ],
    primaryKey: ["workspace", "brand", "execution_id"],
    indexes: [{ name: "idx_executions_task", columns: ["job_id", "task_id"] }],
  },
  {
    name: "attempts",
    columns: [
      ...scopeColumns,
      { name: "job_id", type: "TEXT", notNull: true, primary: true },
      { name: "task_id", type: "TEXT", notNull: true, primary: true },
      { name: "attempt", type: "INTEGER", notNull: true, primary: true },
      { name: "execution_id", type: "TEXT", notNull: true, default: "" },
      { name: "claim_token", type: "TEXT", notNull: true, default: "" },
      { name: "worker_id", type: "TEXT", notNull: true, default: "" },
      { name: "started_at", type: "INTEGER", notNull: true, default: 0 },
      { name: "finished_at", type: "INTEGER" },
      { name: "outcome", type: "TEXT" },
      // PHASE 12 (12.5B): these seven were MISSING. `ExecutionAttempt` carries them, and the
      // 12.3 schema had columns for only the first nine fields - so migrating `#attempts` would
      // have silently dropped an error class, a provider id and the measured usage on every
      // restart. Found by the type checker when the round-trip failed to compile, which is the
      // cheapest possible way to find it.
      { name: "duration_ms", type: "INTEGER" },
      { name: "error_class", type: "TEXT" },
      { name: "error", type: "TEXT" },
      { name: "provider_id", type: "TEXT" },
      { name: "model_id", type: "TEXT" },
      { name: "idempotency_key", type: "TEXT" },
      { name: "usage", type: "TEXT" },
    ],
    primaryKey: ["workspace", "brand", "job_id", "task_id", "attempt"],
  },
  {
    name: "checkpoints",
    columns: [
      ...scopeColumns,
      { name: "checkpoint_id", type: "TEXT", notNull: true, primary: true },
      { name: "job_id", type: "TEXT", notNull: true },
      { name: "task_id", type: "TEXT", notNull: true },
      { name: "execution_id", type: "TEXT", notNull: true, default: "" },
      // Continues from durable state. See `nextCheckpointSequence`.
      { name: "sequence", type: "INTEGER", notNull: true, default: 1 },
      { name: "at", type: "INTEGER", notNull: true, default: 0 },
      { name: "progress", type: "TEXT", notNull: true, default: "" },
      { name: "data_ref", type: "TEXT", notNull: true },
      { name: "recoverable", type: "INTEGER", notNull: true, default: 0 },
      { name: "not_recoverable_reason", type: "TEXT" },
    ],
    primaryKey: ["workspace", "brand", "checkpoint_id"],
    indexes: [{ name: "idx_checkpoints_task", columns: ["job_id", "task_id", "sequence"] }],
  },
  {
    name: "claims",
    columns: [
      ...scopeColumns,
      { name: "job_id", type: "TEXT", notNull: true, primary: true },
      { name: "task_id", type: "TEXT", notNull: true, primary: true },
      { name: "token", type: "TEXT", notNull: true, default: "" },
      { name: "worker_id", type: "TEXT", notNull: true, default: "" },
      { name: "acquired_at", type: "INTEGER", notNull: true, default: 0 },
      // PHASE 12: persisted, because a lease that does not survive a restart is not a lease.
      { name: "expires_at", type: "INTEGER", notNull: true, default: 0 },
    ],
    primaryKey: ["workspace", "brand", "job_id", "task_id"],
  },
  {
    name: "idempotency_records",
    columns: [
      ...scopeColumns,
      { name: "key", type: "TEXT", notNull: true, primary: true },
      { name: "task_id", type: "TEXT", notNull: true, default: "" },
      // `in_progress` PERSISTED, so a restart can see an execution that started and never finished.
      { name: "state", type: "TEXT", notNull: true },
      { name: "outcome", type: "TEXT" },
      { name: "result_ref", type: "TEXT" },
      { name: "at", type: "INTEGER", notNull: true, default: 0 },
      { name: "replays", type: "INTEGER", notNull: true, default: 0 },
    ],
    primaryKey: ["workspace", "brand", "key"],
  },
  {
    name: "results",
    columns: [
      ...scopeColumns,
      { name: "execution_id", type: "TEXT", notNull: true, primary: true },
      { name: "job_id", type: "TEXT", notNull: true, default: "" },
      { name: "task_id", type: "TEXT", notNull: true, default: "" },
      { name: "succeeded", type: "INTEGER", notNull: true, default: 0 },
      { name: "output", type: "TEXT", notNull: true, default: "" },
      { name: "verification_verdict", type: "TEXT" },
      { name: "provider_id", type: "TEXT" },
      { name: "model_id", type: "TEXT" },
      { name: "trace_id", type: "TEXT" },
      { name: "failure", type: "TEXT" },
    ],
    primaryKey: ["workspace", "brand", "execution_id"],
  },
  {
    name: "verdicts",
    columns: [
      ...scopeColumns,
      { name: "job_id", type: "TEXT", notNull: true, primary: true },
      { name: "task_id", type: "TEXT", notNull: true, primary: true },
      { name: "verdict", type: "TEXT" },
    ],
    primaryKey: ["workspace", "brand", "job_id", "task_id"],
  },
  {
    name: "approvals",
    columns: [
      ...scopeColumns,
      { name: "gate_id", type: "TEXT", notNull: true, primary: true },
      { name: "job_id", type: "TEXT", notNull: true, default: "" },
      { name: "task_id", type: "TEXT", notNull: true, default: "" },
      { name: "question", type: "TEXT", notNull: true, default: "" },
      { name: "state", type: "TEXT", notNull: true },
      { name: "decided_by", type: "TEXT" },
      { name: "decided_at", type: "INTEGER" },
      { name: "intent", type: "TEXT", notNull: true, default: "{}" },
    ],
    primaryKey: ["workspace", "brand", "gate_id"],
    indexes: [{ name: "idx_approvals_job", columns: ["job_id"] }],
  },
  {
    name: "budget_ledger",
    columns: [
      ...scopeColumns,
      { name: "job_id", type: "TEXT", notNull: true, primary: true },
      { name: "measured_amount", type: "REAL", notNull: true, default: 0 },
      { name: "currency", type: "TEXT", notNull: true, default: "" },
      { name: "attempts_used", type: "INTEGER", notNull: true, default: 0 },
    ],
    primaryKey: ["workspace", "brand", "job_id"],
  },
];

function columnDdl(column: ColumnSpec): string {
  const parts = [`"${column.name}"`, column.type];
  if (column.notNull === true) parts.push("NOT NULL");
  if (column.default !== undefined) parts.push(`DEFAULT ${typeof column.default === "string" ? `'${column.default}'` : column.default}`);
  return parts.join(" ");
}

export function createStatements(): readonly string[] {
  const statements: string[] = [];
  for (const table of TABLES) {
    const columns = table.columns.map(columnDdl).join(",\n  ");
    const keys = table.primaryKey.map((key) => `"${key}"`).join(", ");
    statements.push(`CREATE TABLE IF NOT EXISTS "${table.name}" (\n  ${columns},\n  PRIMARY KEY (${keys})\n);`);
    for (const index of table.indexes ?? []) {
      statements.push(`CREATE INDEX IF NOT EXISTS "${index.name}" ON "${table.name}" (${index.columns.map((c) => `"${c}"`).join(", ")});`);
    }
  }
  return statements;
}