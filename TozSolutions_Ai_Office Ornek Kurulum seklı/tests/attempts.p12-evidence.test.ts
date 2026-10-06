/**
 * PHASE 12 EVIDENCE - attempts, including the seven fields the schema once dropped.
 *
 * ## WHY THIS FILE IS THE LONGEST OF THE FIVE
 *
 * The 12.3 schema gave `attempts` columns for nine of `ExecutionAttempt`'s sixteen fields. The
 * migration compiled clean and every test passed, and a restart would still have discarded an
 * error class, a provider id and the measured usage. Nothing caught it until the round trip was
 * actually written.
 *
 * So the restart test here compares EVERY field, one assertion each, with deliberately distinct
 * values - `durationMs: 4321`, `errorClass: "timeout"`, a provider and model that differ from the
 * job's own, a usage object with every field set. A regression that dropped one column again
 * would pass a test that checked `attempt` and `executionId`, and would fail this one.
 *
 * Public path: `attemptsOf(jobId, taskId)`.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { ExecutionCoordinator, type TaskExecutionPort } from "../src/orchestration/workflow/coordinator.js";
import type { AttemptRow, DurableStateRepository, JobRow, TaskRow } from "../src/state/durable.js";
import { SqliteDurableStore } from "../src/state/sqliteStore.js";

const NOW = new Date("2026-04-01T00:00:00.000Z");
const AC = { workspace: "acme", brand: null };
const GB = { workspace: "globex", brand: null };

/** Every field set to something no default would produce. */
const FULL: Omit<AttemptRow, "jobId" | "taskId"> = {
  attempt: 7,
  executionId: "exec-attempt",
  claimToken: "claim-token-value",
  workerId: "worker-ATTEMPT",
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_009_999,
  outcome: "failed",
  durationMs: 4321,
  errorClass: "timeout",
  error: "the provider did not answer within 4321ms",
  providerId: "provider-ATTEMPT",
  modelId: "model-ATTEMPT",
  idempotencyKey: "idem-ATTEMPT",
  usage: JSON.stringify({ inputTokens: 111, outputTokens: 222, amount: 33.25, currency: "EUR", latencyMs: 4321 }),
};

function coordinatorWith(repo: DurableStateRepository, ws = AC): ExecutionCoordinator {
  const executor: TaskExecutionPort = { execute: () => Promise.reject(new Error("not used")) };
  return new ExecutionCoordinator({ clock: new ManualClock(NOW), workspace: ws, durable: repo, executor });
}

const jobRow: JobRow = {
  jobId: "job-1", workflowId: null, label: "l", state: "running", priority: "normal",
  owner: "op", correlationId: "job-1", budget: JSON.stringify({ maxDurationMs: null, maxTotalAttempts: null, maxAmount: null, budgetCurrency: null }), createdAt: 1, updatedAt: 2,
};
const taskRow: TaskRow = {
  jobId: "job-1", taskId: "t1", state: "failed", attempts: 7, executionId: "exec-attempt",
  claimToken: "claim-token-value", startedAt: 1_700_000_000_000, finishedAt: 1_700_000_009_999,
  resultRef: null, failure: "the provider did not answer within 4321ms", failureClass: "timeout",
  retryable: true, redriveSafe: false,
  definition: JSON.stringify({ taskId: "t1", jobId: "job-1", objective: "o", input: "i" }),
};

function seed(repo: DurableStateRepository, jobId: string, attempt: number, worker: string): void {
  repo.putJob({ ...jobRow, jobId, correlationId: jobId });
  repo.putTask({ ...taskRow, jobId });
  repo.putAttempt({ ...FULL, jobId, taskId: "t1", attempt, workerId: worker });
}

function dbPath(tag: string): { file: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), `toz-p12-att-${tag}-`));
  return { file: path.join(dir, "state.db"), dir };
}

describe("PHASE 12 EVIDENCE - attempts", () => {
  it("reads a durable attempt with an EMPTY cache", () => {
    const { file, dir } = dbPath("empty");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      seed(repo, "job-1", 7, "worker-ATTEMPT");
      const coordinator = coordinatorWith(repo);

      const attempts = coordinator.attemptsOf("job-1", "t1");
      assert.equal(attempts.length, 1, "the attempt came from the repository");
      assert.equal(attempts[0]?.attempt, 7);
      assert.equal(attempts[0]?.error, "the provider did not answer within 4321ms");
      assert.equal(coordinator.attemptsOf("job-1", "t1").length, 1, "and a second read agrees");
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
      seed(repo, "job-1", 7, "worker-FIRST");
      const coordinator = coordinatorWith(repo);
      assert.equal(coordinator.attemptsOf("job-1", "t1")[0]?.workerId, "worker-FIRST", "cache holds the first value");

      // Replace the SAME attempt number durably. The cache is NOT cleared.
      repo.putAttempt({ ...FULL, jobId: "job-1", taskId: "t1", attempt: 7, workerId: "worker-SECOND", error: "a different failure" });

      const attempts = coordinator.attemptsOf("job-1", "t1");
      assert.equal(attempts.length, 1, "still one attempt - the same number was updated, not added");
      assert.equal(attempts[0]?.workerId, "worker-SECOND", "the repository wins");
      assert.equal(attempts[0]?.error, "a different failure");
    } finally {
      repo?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("survives a REAL close/reopen with EVERY field intact", () => {
    const { file, dir } = dbPath("restart");
    let a: SqliteDurableStore | null = null;
    let b: SqliteDurableStore | null = null;
    try {
      a = SqliteDurableStore.open({ path: file, workspace: AC });
      seed(a, "job-1", 7, "worker-ATTEMPT");
      a.close();

      b = SqliteDurableStore.open({ path: file, workspace: AC });
      const attempts = coordinatorWith(b).attemptsOf("job-1", "t1");
      assert.equal(attempts.length, 1);
      const attempt = attempts[0];
      assert.ok(attempt !== undefined, "the attempt is present");

      // --- identity and relationships ---
      assert.equal(attempt.jobId, "job-1", "jobId");
      assert.equal(attempt.taskId, "t1", "taskId");
      assert.equal(attempt.attempt, 7, "attempt number");
      assert.equal(attempt.executionId, "exec-attempt", "executionId");
      assert.equal(attempt.claimToken, "claim-token-value", "claimToken");
      assert.equal(attempt.workerId, "worker-ATTEMPT", "workerId");
      assert.equal(attempt.startedAt, 1_700_000_000_000, "startedAt");
      assert.equal(attempt.finishedAt, 1_700_000_009_999, "finishedAt");
      assert.equal(attempt.outcome, "failed", "outcome");

      // --- THE SEVEN. Each one named, because the whole point is that they once had no column. ---
      assert.equal(attempt.durationMs, 4321, "durationMs");
      assert.equal(attempt.errorClass, "timeout", "errorClass");
      assert.equal(attempt.error, "the provider did not answer within 4321ms", "error");
      assert.equal(attempt.providerId, "provider-ATTEMPT", "providerId");
      assert.equal(attempt.modelId, "model-ATTEMPT", "modelId");
      assert.equal(attempt.idempotencyKey, "idem-ATTEMPT", "idempotencyKey");
      assert.equal(attempt.usage?.inputTokens, 111, "usage.inputTokens");
      assert.equal(attempt.usage?.outputTokens, 222, "usage.outputTokens");
      assert.equal(attempt.usage?.amount, 33.25, "usage.amount");
      assert.equal(attempt.usage?.currency, "EUR", "usage.currency");
      assert.equal(attempt.usage?.latencyMs, 4321, "usage.latencyMs");
    } finally {
      a?.close();
      b?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("orders attempts durably, oldest attempt number first", () => {
    const { file, dir } = dbPath("order");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      repo.putJob(jobRow);
      repo.putTask(taskRow);
      // Inserted OUT OF ORDER on purpose: ordering must come from the data, not insertion order.
      repo.putAttempt({ ...FULL, jobId: "job-1", taskId: "t1", attempt: 3 });
      repo.putAttempt({ ...FULL, jobId: "job-1", taskId: "t1", attempt: 1 });
      repo.putAttempt({ ...FULL, jobId: "job-1", taskId: "t1", attempt: 2 });

      assert.deepEqual(
        coordinatorWith(repo).attemptsOf("job-1", "t1").map((a) => a.attempt),
        [1, 2, 3],
        "ordered by attempt number regardless of the order they were written",
      );
    } finally {
      repo?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("isolates attempts between workspaces in BOTH directions", () => {
    const { file, dir } = dbPath("ws");
    let ac: SqliteDurableStore | null = null;
    let gb: SqliteDurableStore | null = null;
    let ac2: SqliteDurableStore | null = null;
    try {
      ac = SqliteDurableStore.open({ path: file, workspace: AC });
      seed(ac, "job-1", 7, "worker-ACME");
      ac.close();

      gb = SqliteDurableStore.open({ path: file, workspace: GB });
      const globex = coordinatorWith(gb, GB);
      assert.deepEqual(globex.attemptsOf("job-1", "t1"), [], "globex sees none of acme's attempts");
      seed(gb, "job-1", 7, "worker-GLOBEX");
      assert.equal(globex.attemptsOf("job-1", "t1")[0]?.workerId, "worker-GLOBEX", "and sees its own");
      gb.close();

      ac2 = SqliteDurableStore.open({ path: file, workspace: AC });
      const acme = coordinatorWith(ac2, AC);
      const attempts = acme.attemptsOf("job-1", "t1");
      assert.equal(attempts.length, 1, "acme sees exactly its own attempt, not globex's");
      assert.equal(attempts[0]?.workerId, "worker-ACME");
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
        putExecution: bound("putExecution"), getExecution: bound("getExecution"), listExecutions: bound("listExecutions"),
        putAttempt: refuse, listAttempts: bound("listAttempts"), latestAttempt: bound("latestAttempt"),
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
      assert.throws(() => failing.putAttempt({ ...FULL, jobId: "job-1", taskId: "t1" }), /refused/);
      assert.deepEqual(real.listAttempts("job-1", "t1"), [], "nothing durable");
      assert.deepEqual(coordinator.attemptsOf("job-1", "t1"), [], "and nothing cached");
    } finally {
      real.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });
});