/**
 * PHASE 12: the durable state contract.
 *
 * ## WHY THIS FILE IS IN `core` AND NOT IN `orchestration`
 *
 * `src/state/store.ts` already set the boundary rule for this directory: `core` must not import
 * `orchestration`. Durable state is the same kind of dependency - a store that knows about
 * `JobTaskState` by import would make `core` depend on the workflow model, and the dependency
 * would run straight back the other way once the workflow started storing things.
 *
 * So this file imports NOTHING from `src/orchestration/**`. Every state value below is a plain
 * structural type declared here, and the orchestration layer converts. That is more typing and
 * it is deliberate: the conversion is where a mistake becomes visible, and a store that shared
 * the orchestrator's own types could not tell a persisted row from an in-memory object.
 *
 * ## THE HARD INVARIANT, AND WHY IT IS WRITTEN HERE
 *
 * `DurableStateRepository` is the ONLY authoritative owner of durable state. Any in-memory map
 * in a consumer is a CACHE, and the ordering is fixed:
 *
 *     repository.write(...)   THEN   cache update
 *     repository.read(...)            is authoritative, always
 *     hydrate:                  repository  ->  cache
 *
 * The forbidden direction is `cache -> repository as an independent authority`. This repository
 * has no method that accepts a cache's opinion as truth, which is the cheapest way to make the
 * rule structural rather than a comment someone can forget.
 *
 * This is not a hypothetical. Three separate defects in this repository came from two places
 * holding an opinion about one fact: route accounting (D-64), the trace id that `worker.ts`
 * discarded with `void context`, and `AuditSink` having one read path per axis. A fourth is
 * easier to add than to remove, which is why the rule lives at the interface.
 *
 * ## NO `any`
 *
 * There is no `any` in this file, and there must not be one added. `strict` plus the generic row
 * types below are what make the SQLite adapter and the in-memory adapter interchangeable. The
 * moment a row becomes `Record<string, unknown>` at the contract, every guarantee below it is
 * decoration.
 */

/**
 * The schema version this build writes. Bump on any incompatible layout change.
 *
 * PHASE 12 (12.5B): bumped 1 -> 2 when `jobs.budget` was added. A durable store that cannot read
 * its own rows is worse than one that refuses to start, which is what this version exists to
 * allow: an existing version-1 database is REFUSED rather than opened with a `budget` column
 * silently missing.
 */
export const DURABLE_SCHEMA_VERSION = 2;

/**
 * The workspace partition a row belongs to.
 *
 * NOT a tenant identity and NOT an authorization boundary. `Job.owner` is recorded and reported
 * but read by nothing (PHASE 10 established this), so nothing here should be described as
 * multi-tenancy. What this IS: a mechanical partition applied to every key, with a distinguished
 * value for "no workspace was supplied".
 *
 * The unattributed partition is a RESERVED STRING rather than `null`, because SQL will never
 * match `NULL = NULL` and an unpartitioned row must be findable by an unpartitioned reader
 * without weakening the partitioned queries.
 */
export interface DurableScope {
  readonly workspace: string;
  readonly brand: string | null;
}

/** The partition used when a store is composed with no workspace. Matches `workspaceKey`'s `0:` head. */
export const UNATTRIBUTED_SCOPE: DurableScope = { workspace: "__unattributed__", brand: null };

/**
 * PHASE 12: how a null brand is stored.
 *
 * `brand` is nullable in `DurableScope`, and the first implementation persisted that NULL
 * straight into a PRIMARY KEY column. SQLite permits NULL in a non-INTEGER primary key and -
 * this is the part that matters - treats NULLs as DISTINCT for uniqueness. So `ON CONFLICT
 * ("workspace","brand","job_id")` never fired: an "update" inserted a SECOND row with the same
 * workspace and job id, and the read returned whichever came first.
 *
 * Found by a test that changed durable state behind the coordinator's back and read it through
 * the coordinator: the read answered `queued` from the original row while the update sat
 * unnoticed beside it. Nothing else could have caught it, because a single-writer test never
 * performs an upsert.
 *
 * So a null brand is stored as this reserved string, exactly as `workspace` already was.
 */
export const NO_BRAND = "__unbrand__";

export const brandColumn = (brand: string | null): string => brand ?? NO_BRAND;
export const brandValue = (column: string | null): string | null => (column === null || column === NO_BRAND ? null : column);

export function scopeOf(workspace: { workspace: string; brand: string | null } | null | undefined): DurableScope {
  return workspace === null || workspace === undefined ? UNATTRIBUTED_SCOPE : { workspace: workspace.workspace, brand: workspace.brand };
}

/** True when two scopes name the same partition. Mirrors `sameAuditScope`, for the same reason. */
export function sameScope(a: DurableScope, b: DurableScope): boolean {
  return a.workspace === b.workspace && a.brand === b.brand;
}

/* -------------------------------------------------------------------------- */
/* Row types - the minimum authoritative state, not the process's maps         */
/* -------------------------------------------------------------------------- */

/**
 * The set of task states this build understands.
 *
 * Duplicated from `JOB_TASK_STATES` rather than imported - see this file's header. The
 * duplication is load-bearing and is checked by `durableSchema.p12`, which compares the two
 * lists and fails if they drift. An import would remove the check; the check is the point.
 */
export const DURABLE_TASK_STATES = [
  "pending",
  "ready",
  "running",
  "waiting_approval",
  "retrying",
  "completed",
  "failed",
  "skipped",
  "cancelled",
  /** PHASE 12. See `INDETERMINATE_SEMANTICS`. */
  "indeterminate",
] as const;
export type DurableTaskState = (typeof DURABLE_TASK_STATES)[number];

export const DURABLE_JOB_STATES = ["queued", "running", "waiting", "retrying", "paused", "completed", "failed", "cancelled"] as const;
export type DurableJobState = (typeof DURABLE_JOB_STATES)[number];

/**
 * PHASE 12 (12.5B) CORRECTION. This list was INVENTED in 12.3 and did not match the code.
 *
 * `model.ts` declares `EXECUTION_STATES = ["ready", "running", "verifying", "done"]`, and that is
 * what `Execution.state` has always been. The 12.3 list shared no value with it except
 * `"running"`, so the `executions.state` column could never have held a real execution state -
 * and the round-trip only failed to compile when `#executions` was actually migrated.
 *
 * The real vocabulary plus ONE addition:
 *
 *  - `indeterminate`, added because 12.2 requires it and because it is the only state that can
 *    honestly describe an execution a restart found unfinished. Nothing sets it in this slice;
 *    12.10 recovery classifies it. Adding it here rather than then is deliberate: the column has
 *    to be able to hold the answer before there is a reason to write it.
 */
export const DURABLE_EXECUTION_STATES = ["ready", "running", "verifying", "done", "indeterminate"] as const;
export type DurableExecutionState = (typeof DURABLE_EXECUTION_STATES)[number];

export interface JobRow {
  readonly jobId: string;
  readonly workflowId: string | null;
  readonly label: string;
  readonly state: DurableJobState;
  readonly priority: string;
  readonly owner: string;
  readonly correlationId: string;
  /**
   * PHASE 12 (12.5B): the job's `ResourceBudget`, JSON-encoded.
   *
   * Added because `budgetStatus` reads `job.budget.maxDurationMs` and a `Job` rebuilt from a row
   * without this field had `budget: undefined` - so `budgetStatus` THREW on any coordinator that
   * rehydrated a job from the database, and the job's cost and duration limits were lost across
   * a restart. Encoded rather than split into columns because it is read and written as one
   * value and has no queryable interior.
   */
  readonly budget: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TaskRow {
  readonly jobId: string;
  readonly taskId: string;
  readonly state: DurableTaskState;
  readonly attempts: number;
  readonly executionId: string | null;
  readonly claimToken: string | null;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  readonly resultRef: string | null;
  readonly failure: string | null;
  readonly failureClass: string | null;
  readonly retryable: boolean | null;
  /**
   * PHASE 12. Whether a REDRIVE of this task is safe to perform again.
   *
   * This is the ONLY thing that permits `indeterminate -> retrying`. It is declared by whoever
   * owns the task, never inferred: this system cannot know whether an external provider call it
   * made was billed, so it must be told.
   */
  readonly redriveSafe: boolean;
  /** Definition JSON - objective, input, capabilities, limits, dependencies. */
  readonly definition: string;
}

/**
 * PHASE 12 (12.5B-FIX): a JOB-scoped lifecycle transition.
 *
 * Every field of `JobTransitionRecord` is preserved, including `from_state` being null (which
 * means "this job came into existence", not "the previous state is unknown") and `waitingFor`
 * (which says what a `waiting` job is waiting FOR). Nothing was dropped for being unread by a
 * public API today: this is an audit trace, and the fields a trace does not currently expose are
 * exactly the ones a later reader needs.
 */
export interface JobTransitionRow {
  readonly jobId: string;
  readonly sequence: number;
  readonly from: string | null;
  readonly to: string;
  readonly at: number;
  readonly reason: string;
  readonly waitingFor: string | null;
}

export interface TaskTransitionRow {
  readonly jobId: string;
  readonly taskId: string;
  readonly from: DurableTaskState | null;
  readonly to: DurableTaskState;
  readonly at: number;
  readonly reason: string;
}

export interface ExecutionRow {
  readonly executionId: string;
  readonly jobId: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly workerId: string;
  readonly claimToken: string;
  readonly state: DurableExecutionState;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly traceId: string | null;
}

export interface AttemptRow {
  readonly jobId: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly executionId: string;
  readonly claimToken: string;
  readonly workerId: string;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly outcome: string | null;
  readonly durationMs: number | null;
  readonly errorClass: string | null;
  readonly error: string | null;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly idempotencyKey: string | null;
  /** JSON-encoded `MeasuredUsage`; the repository does not model it and stores it verbatim. */
  readonly usage: string | null;
}

export interface CheckpointRow {
  readonly checkpointId: string;
  readonly jobId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly sequence: number;
  readonly at: number;
  readonly progress: string;
  readonly dataRef: string;
  readonly recoverable: boolean;
  readonly notRecoverableReason: string | null;
}

export interface ClaimRow {
  readonly jobId: string;
  readonly taskId: string;
  readonly token: string;
  readonly workerId: string;
  readonly acquiredAt: number;
  /** PHASE 12: persisted, because a lease that does not survive a restart is not a lease. */
  readonly expiresAt: number;
}

export type IdempotencyOutcomeState = "in_progress" | "succeeded" | "failed";

export interface IdempotencyRow {
  readonly key: string;
  readonly taskId: string;
  readonly state: IdempotencyOutcomeState;
  readonly outcome: string | null;
  readonly resultRef: string | null;
  readonly at: number;
  readonly replays: number;
}

export interface ResultRow {
  readonly executionId: string;
  readonly jobId: string;
  readonly taskId: string;
  readonly succeeded: boolean;
  readonly output: string;
  readonly verificationVerdict: string | null;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly traceId: string | null;
  readonly failure: string | null;
}

export interface VerdictRow {
  readonly jobId: string;
  readonly taskId: string;
  readonly verdict: "pass" | "fail" | "needs_review" | null;
}

export interface ApprovalRow {
  readonly gateId: string;
  readonly jobId: string;
  readonly taskId: string;
  readonly question: string;
  readonly state: string;
  readonly decidedBy: string | null;
  readonly decidedAt: number | null;
  readonly intent: string;
}

export interface BudgetRow {
  readonly jobId: string;
  readonly measuredAmount: number;
  readonly currency: string;
  readonly attemptsUsed: number;
}

/* -------------------------------------------------------------------------- */
/* INDETERMINATE - the state this phase exists for                             */
/* -------------------------------------------------------------------------- */

/**
 * The meaning, written out once so that no later file has to re-derive it.
 *
 *   INDETERMINATE = "the system has evidence that execution may have started, but after a
 *   restart it cannot prove whether the external work completed."
 *
 * What it is NOT, and the reasons, because each was tempting:
 *
 * - NOT `completed`. Nothing observed a result. Writing `completed` here would assert an
 *   outcome nobody witnessed, and the whole point of this phase is that such assertions are the
 *   defect being fixed.
 * - NOT `failed`. The work may have SUCCEEDED and charged someone. Reporting failure invites a
 *   retry, and the retry may double-charge.
 * - NOT `retryable`. Retrying is safe only if the task declared `redriveSafe`. This system does
 *   not know whether an external call it made was billed; only the caller knows.
 *
 * So `INDETERMINATE` is a state that waits for EVIDENCE (an operator, or a remote system that
 * can be asked), not a state that guesses.
 */
export const INDETERMINATE_SEMANTICS =
  "execution may have started; completion is unprovable after restart; requires operator or remote evidence";

/** Task states from which no automatic recovery may proceed. */
export function isTerminalTaskState(state: DurableTaskState): boolean {
  return state === "completed" || state === "failed" || state === "skipped" || state === "cancelled";
}

/**
 * Whether recovery may move a task out of `from` WITHOUT new evidence.
 *
 * The transition table is the enforcement, and it is deliberately small. `indeterminate` can
 * only advance on the single condition the caller asserted: `redriveSafe`. Every other exit
 * needs a person or a remote answer, which is why they are absent from this table rather than
 * merely discouraged.
 */
export function mayAutoAdvance(from: DurableTaskState, redriveSafe: boolean): boolean {
  if (from === "indeterminate") return redriveSafe;
  if (from === "pending" || from === "ready" || from === "retrying") return true;
  return false;
}

/* -------------------------------------------------------------------------- */
/* Repository contract                                                         */
/* -------------------------------------------------------------------------- */

export type BeginIdempotentOutcome =
  | { readonly ok: true; readonly replayed: boolean; readonly row: IdempotencyRow }
  | { readonly ok: false; readonly reason: "in_progress"; readonly detail: string };

/**
 * The single authoritative owner of durable state.
 *
 * Every method is scoped: there is no unscoped read, because an unscoped read is the shape that
 * lets one workspace's rows answer for another's.
 *
 * Methods are synchronous. `node:sqlite` is synchronous, and the alternative - making all of
 * this async - would force every existing `await` in the coordinator's execution path to change
 * for no durability benefit. The consequence is stated plainly in `FINAL_ARCHITECTURE.md`: this
 * design assumes a SINGLE WRITER. Two coordinators over one database file are not supported and
 * `open()` takes a lock to make that failure loud rather than silent.
 */
export interface DurableStateRepository {
  readonly scope: DurableScope;
  schemaVersion(): number;
  close(): void;

  putJob(row: JobRow): void;
  getJob(jobId: string): JobRow | null;
  listJobs(): readonly JobRow[];
  deleteJob(jobId: string): void;

  putTask(row: TaskRow): void;
  getTask(jobId: string, taskId: string): TaskRow | null;
  listTasks(jobId: string): readonly TaskRow[];

  putTaskTransition(row: TaskTransitionRow): void;
  /** PHASE 12 (12.5B-FIX). Sequence is allocated INSIDE the repository, durably. */
  appendJobTransition(row: Omit<JobTransitionRow, "sequence">): JobTransitionRow;
  listJobTransitions(jobId: string): readonly JobTransitionRow[];
  latestJobTransition(jobId: string): JobTransitionRow | null;
  listTaskTransitions(jobId: string, taskId: string): readonly TaskTransitionRow[];

  putExecution(row: ExecutionRow): void;
  getExecution(executionId: string): ExecutionRow | null;
  listExecutions(jobId: string): readonly ExecutionRow[];

  putAttempt(row: AttemptRow): void;
  listAttempts(jobId: string, taskId: string): readonly AttemptRow[];
  latestAttempt(jobId: string, taskId: string): AttemptRow | null;

  appendCheckpoint(row: CheckpointRow): void;
  listCheckpoints(jobId: string, taskId: string): readonly CheckpointRow[];
  latestCheckpoint(jobId: string, taskId: string): CheckpointRow | null;
  /** The next sequence for a task, continued from durable state rather than a process counter. */
  nextCheckpointSequence(jobId: string, taskId: string): number;

  putClaim(row: ClaimRow): void;
  getClaim(jobId: string, taskId: string): ClaimRow | null;
  releaseClaim(jobId: string, taskId: string): boolean;
  listClaims(): readonly ClaimRow[];

  beginIdempotent(key: string, taskId: string, at: number): BeginIdempotentOutcome;
  completeIdempotent(key: string, outcome: "succeeded" | "failed", resultRef: string | null, at: number): IdempotencyRow | null;
  abandonIdempotent(key: string): boolean;
  getIdempotent(key: string): IdempotencyRow | null;
  listIdempotent(): readonly IdempotencyRow[];

  putResult(row: ResultRow): void;
  getResult(executionId: string): ResultRow | null;

  putVerdict(row: VerdictRow): void;
  getVerdict(jobId: string, taskId: string): VerdictRow | null;

  putApproval(row: ApprovalRow): void;
  getApproval(gateId: string): ApprovalRow | null;
  listApprovals(jobId: string): readonly ApprovalRow[];

  putBudget(row: BudgetRow): void;
  getBudget(jobId: string): BudgetRow | null;

  /**
   * Runs `body` inside one transaction, committing on return and rolling back on throw.
   *
   * Present because "SQLite is a database" is not an atomicity argument. Callers must be able to
   * name the boundary, and must be able to see that no transaction is held across external work.
   */
  transaction<T>(body: () => T): T;
}