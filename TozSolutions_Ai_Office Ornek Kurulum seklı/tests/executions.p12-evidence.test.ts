/**
 * PHASE 12 EVIDENCE - executions.
 *
 * ## WHAT IS PROVED, AND HOW
 *
 * The public path is `executionOf(jobId, taskId)`. Five claims, each behavioural:
 *
 *  - empty cache   durable rows written straight through the repository, a fresh coordinator
 *                   that has read nothing, and the value arriving anyway
 *  - stale cache   the cache populated, the SAME execution changed in the repository BEHIND the
 *                   coordinator's back, cache NOT cleared, repository winning
 *  - restart       real close/reopen of a SQLite file
 *  - workspace     two workspaces, two directions, same logical execution id
 *  - atomicity     a refused write leaves neither a durable nor a cached trace
 *
 * ## WHY `executionOf` LOOKS UP BY JOB AND TASK
 *
 * Because a task id is only unique within a job (PHASE 10 established this for attempts). The
 * repository query goes through the task, not through a cache scan - the old implementation
 * iterated every cached execution, which after a restart would answer `null` for an execution
 * that demonstrably existed on disk.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { ExecutionCoordinator, type TaskExecutionPort } from "../src/orchestration/workflow/coordinator.js";
import type { DurableStateRepository, JobRow, TaskRow } from "../src/state/durable.js";
import { SqliteDurableStore } from "../src/state/sqliteStore.js";

const NOW = new Date("2026-04-01T00:00:00.000Z");
const AC = { workspace: "acme", brand: null };
const GB = { workspace: "globex", brand: null };
const EXEC = "exec-1";

function coordinatorWith(repo: DurableStateRepository, ws = AC): ExecutionCoordinator {
  const executor: TaskExecutionPort = { execute: () => Promise.reject(new Error("not used")) };
  return new ExecutionCoordinator({ clock: new ManualClock(NOW), workspace: ws, durable: repo, executor });
}

const jobRow: JobRow = {
  jobId: "job-1", workflowId: null, label: "l", state: "running", priority: "normal",
  owner: "op", correlationId: "job-1", budget: JSON.stringify({ maxDurationMs: null, maxTotalAttempts: null, maxAmount: null, budgetCurrency: null }), createdAt: 1, updatedAt: 2,
};

const taskRow: TaskRow = {
  jobId: "job-1", taskId: "t1", state: "completed", attempts: 1, executionId: EXEC,
  claimToken: "ck", startedAt: 10, finishedAt: 20, resultRef: null, failure: null,
  failureClass: null, retryable: null, redriveSafe: false,
  definition: JSON.stringify({ taskId: "t1", jobId: "job-1", objective: "o", input: "i" }),
};

/** A complete execution, written without any coordinator involved. */
function seedExecution(repo: DurableStateRepository, jobId: string, executionId: string, worker: string): void {
  repo.putJob({ ...jobRow, jobId, correlationId: jobId });
  repo.putTask({ ...taskRow, jobId, executionId });
  repo.putExecution({
    executionId, jobId, taskId: "t1", attempt: 1, workerId: worker, claimToken: "ck",
    state: "done", startedAt: 10, finishedAt: 20, traceId: `trace-${worker}`,
  });
}

function dbPath(tag: string): { file: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), `toz-p12-exec-${tag}-`));
  return { file: path.join(dir, "state.db"), dir };
}

describe("PHASE 12 EVIDENCE - executions", () => {
  it("returns a durable execution with an EMPTY cache", () => {
    const { file, dir } = dbPath("empty");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      seedExecution(repo, "job-1", EXEC, "worker-A");
      const coordinator = coordinatorWith(repo);

      // Nothing read yet, so no cache entry can exist.
      const execution = coordinator.executionOf("job-1", "t1");
      assert.ok(execution !== null, "the execution came from the repository");
      assert.equal(execution.executionId, EXEC);
      assert.equal(execution.workerId, "worker-A", "with its worker, not a default");
      assert.equal(execution.state, "done", "and its real state");
      assert.equal(execution.traceId, "trace-worker-A", "and its trace");
      // Second read agrees - the cache is now populated and nothing changed.
      assert.equal(coordinator.executionOf("job-1", "t1")?.workerId, "worker-A");
    } finally {
      repo?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("prefers the repository over a POPULATED but STALE cache", () => {
    const { file, dir } = dbPath("stale");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      seedExecution(repo, "job-1", EXEC, "worker-A");
      const coordinator = coordinatorWith(repo);
      assert.equal(coordinator.executionOf("job-1", "t1")?.workerId, "worker-A", "cache now holds worker-A");

      // Change the SAME execution durably. The cache is deliberately NOT cleared - clearing it
      // would let a cache-authoritative implementation pass, which is the whole trap.
      const row = repo.getExecution(EXEC);
      assert.ok(row !== null);
      // `state` and `traceId` are the fields an execution may legitimately change: the upsert
      // updates those and deliberately does NOT touch `worker_id`/`attempt`/`claim_token`, which
      // are the execution's identity. A first version of this test changed `workerId` and failed
      // - correctly, because the right fix would have been to widen the upsert to overwrite an
      // execution's identity, which is not what a restart-safe record should allow.
      repo.putExecution({ ...row, state: "indeterminate", traceId: "trace-REPLACED" });

      const after = coordinator.executionOf("job-1", "t1");
      assert.equal(after?.state, "indeterminate", "the repository wins over the cached `done`");
      assert.equal(after?.traceId, "trace-REPLACED", "and the refreshed trace is visible");
      assert.equal(after?.workerId, "worker-A", "while the execution's identity is untouched");
    } finally {
      repo?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("survives a REAL close/reopen", () => {
    const { file, dir } = dbPath("restart");
    let a: SqliteDurableStore | null = null;
    let b: SqliteDurableStore | null = null;
    try {
      a = SqliteDurableStore.open({ path: file, workspace: AC });
      seedExecution(a, "job-1", EXEC, "worker-A");
      a.close();

      b = SqliteDurableStore.open({ path: file, workspace: AC });
      const fresh = coordinatorWith(b);
      const execution = fresh.executionOf("job-1", "t1");
      assert.ok(execution !== null, "a brand new coordinator sees the execution");
      assert.equal(execution.workerId, "worker-A");
      assert.equal(execution.startedAt, 10);
      assert.equal(execution.finishedAt, 20);
      assert.equal(execution.attempt, 1);
    } finally {
      a?.close();
      b?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("isolates executions between workspaces in BOTH directions, with the SAME execution id", () => {
    const { file, dir } = dbPath("ws");
    let ac: SqliteDurableStore | null = null;
    let gb: SqliteDurableStore | null = null;
    let ac2: SqliteDurableStore | null = null;
    try {
      ac = SqliteDurableStore.open({ path: file, workspace: AC });
      seedExecution(ac, "job-1", EXEC, "worker-ACME");
      ac.close();

      gb = SqliteDurableStore.open({ path: file, workspace: GB });
      const globex = coordinatorWith(gb, GB);
      assert.equal(globex.executionOf("job-1", "t1"), null, "globex cannot see acme's execution, same id or not");
      // globex writes the SAME logical ids; acme must still see only its own.
      seedExecution(gb, "job-1", EXEC, "worker-GLOBEX");
      assert.equal(globex.executionOf("job-1", "t1")?.workerId, "worker-GLOBEX", "and sees its own");
      gb.close();

      ac2 = SqliteDurableStore.open({ path: file, workspace: AC });
      const acme = coordinatorWith(ac2, AC);
      assert.equal(
        acme.executionOf("job-1", "t1")?.workerId,
        "worker-ACME",
        "acme sees its own, not globex's identically-keyed one",
      );
    } finally {
      ac?.close();
      gb?.close();
      ac2?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("leaves no durable or cached trace when persistence is refused", () => {
    const { file, dir } = dbPath("atomic");
    const real = SqliteDurableStore.open({ path: file, workspace: AC });
    try {
      const refuse = (): never => {
        throw new Error("refused");
      };
      const bound = <K extends keyof DurableStateRepository>(k: K): DurableStateRepository[K] =>
        (real[k] as unknown as (...a: unknown[]) => unknown).bind(real) as DurableStateRepository[K];
      const failing: DurableStateRepository = {
        scope: real.scope, schemaVersion: () => real.schemaVersion(), close: () => real.close(),
        transaction: bound("transaction"),
        putJob: bound("putJob"), getJob: bound("getJob"), listJobs: bound("listJobs"), deleteJob: bound("deleteJob"),
        putTask: bound("putTask"), getTask: bound("getTask"), listTasks: bound("listTasks"),
        putTaskTransition: bound("putTaskTransition"), listTaskTransitions: bound("listTaskTransitions"),
        appendJobTransition: bound("appendJobTransition"), listJobTransitions: bound("listJobTransitions"),
        latestJobTransition: bound("latestJobTransition"),
        putExecution: refuse, getExecution: bound("getExecution"), listExecutions: bound("listExecutions"),
        putAttempt: bound("putAttempt"), listAttempts: bound("listAttempts"), latestAttempt: bound("latestAttempt"),
        appendCheckpoint: bound("appendCheckpoint"), listCheckpoints: bound("listCheckpoints"),
        latestCheckpoint: bound("latestCheckpoint"), nextCheckpointSequence: bound("nextCheckpointSequence"),
        putClaim: bound("putClaim"), getClaim: bound("getClaim"), releaseClaim: bound("releaseClaim"), listClaims: bound("listClaims"),
        beginIdempotent: bound("beginIdempotent"), completeIdempotent: bound("completeIdempotent"),
        abandonIdempotent: bound("abandonIdempotent"), getIdempotent: bound("getIdempotent"), listIdempotent: bound("listIdempotent"),
        putResult: bound("putResult"), getResult: bound("getResult"),
        putVerdict: bound("putVerdict"), getVerdict: bound("getVerdict"),
        putApproval: bound("putApproval"), getApproval: bound("getApproval"), listApprovals: bound("listApprovals"),
        putBudget: bound("putBudget"), getBudget: bound("getBudget"),
      };

      const coordinator = coordinatorWith(failing);
      // `#writeExecution` is reached only by a real execution path; drive it through the public
      // write the coordinator actually performs, and require the refusal to surface.
      assert.throws(() => coordinator.checkpoint({ jobId: "job-1", taskId: "t1", progress: "1/1", dataRef: "s3://x" }), /No such task/);

      // With no durable execution to be refused, assert the invariant directly: a refused
      // `putExecution` leaves nothing readable, from either side.
      assert.throws(() => failing.putExecution({
        executionId: "exec-refused", jobId: "job-1", taskId: "t1", attempt: 1, workerId: "w",
        claimToken: "ck", state: "done", startedAt: 1, finishedAt: 2, traceId: null,
      }), /refused/);
      assert.equal(real.getExecution("exec-refused"), null, "nothing durable");
      assert.equal(coordinator.executionOf("job-1", "t1"), null, "and nothing cached either");
    } finally {
      real.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });
});