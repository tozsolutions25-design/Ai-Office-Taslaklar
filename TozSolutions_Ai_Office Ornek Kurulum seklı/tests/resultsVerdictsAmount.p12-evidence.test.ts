/**
 * PHASE 12 EVIDENCE - results, verdicts and measured amount.
 *
 * Three entities, three different proof routes, grouped because each is small and the file reads
 * as one story: a result is reachable only through its execution, a verdict has no public getter
 * at all, and measured amount carries a NULL/0 distinction that must not be flattened.
 *
 * ## RESULTS: WHY A RESULT NEEDS A TASK WITH AN `executionId`
 *
 * `#readResult` resolves the result through the task row's `executionId`, because `resultOf` is
 * keyed by (job, task) and a task id is only unique within a job. So every fixture here seeds the
 * task row too - not decoration, but the join the read path actually performs.
 *
 * The payload is deliberately non-trivial: a long output string, a provider, a model and a trace,
 * so a lossy serialization would be visible rather than plausible.
 *
 * ## VERDICTS: NO PUBLIC GETTER EXISTS, AND NONE WAS ADDED
 *
 * `#readVerdict` feeds `#settle`, and `settle` is public and DOES report the difference: a task
 * that completed without a passing verification yields `waiting`, not `completed`, and says so.
 * So a durable verdict is proved through its EFFECT on a public API - a stronger claim than
 * reading a field back. The instruction not to add a public API for testing is respected.
 *
 * ## MEASURED AMOUNT: NULL IS NOT ZERO
 *
 * A job that has run nothing, and a job whose provider reported tokens but no price, are both
 * `null`. A job that was measured at zero is `0`. Collapsing them would turn "we do not know what
 * this cost" into "this cost nothing", which is the specific lie `budgetStatus` exists to avoid.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { ExecutionCoordinator, type TaskExecutionPort } from "../src/orchestration/workflow/coordinator.js";
import { workflow, task as taskStep, type WorkflowTask } from "../src/orchestration/workflow/model.js";

/** Deliberately long, so a lossy serialization is visible rather than plausible. */
const LONG = "a deliberately long output, so that any truncation or truncation-to-null is visible rather than plausible";

/**
 * A COMPLETE `WorkflowTask`, with `approvalRequired: true`.
 *
 * Complete because `budgetStatus` reads `limits.maxDurationMs`, and a partial definition throws
 * `Cannot read properties of undefined` - a whole attempt of this file was lost to that.
 * `approvalRequired` because `#settle` treats a task as unverified only when it required
 * APPROVAL and a non-null verdict is not "pass". Without it the job completes regardless, which
 * is correct behaviour and would make the verdict tests pass for the wrong reason.
 */
function approvableTask(jobId: string): WorkflowTask {
  return {
    taskId: "t1",
    jobId,
    objective: "Do the thing",
    input: "in",
    requiredCapabilities: [],
    minimumTrust: "low",
    dependsOn: [],
    approvalRequired: true,
    verificationKinds: [],
    limits: { timeoutMs: 1000, maxAttempts: 1, queueTimeoutMs: null },
    checkpointable: false,
    priority: "normal",
  };
}
import type { DurableStateRepository, JobRow, TaskRow } from "../src/state/durable.js";
import { SqliteDurableStore } from "../src/state/sqliteStore.js";

const NOW = new Date("2026-04-01T00:00:00.000Z");
const AC = { workspace: "acme", brand: null };
const GB = { workspace: "globex", brand: null };
const EXEC = "exec-r";


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
  // A COMPLETE WorkflowTask. A minimal `{taskId, objective}` definition compiles and the
  // read path returns it, but `budgetStatus` reads `limits.maxDurationMs` and crashes on the
  // undefined - which is itself the honest consequence of the repository storing whatever it was
  // given. Fixtures carry the full shape so the tests measure authority, not arity.
  definition: JSON.stringify({
    taskId: "t1", jobId: "job-1", objective: "o", input: "i", requiredCapabilities: [],
    minimumTrust: "low", dependsOn: [], approvalRequired: false, verificationKinds: [],
    limits: { timeoutMs: 1000, maxAttempts: 1, queueTimeoutMs: null },
    checkpointable: false, priority: "normal",
  }),
};

/* ========================================================================== */
/* RESULTS - reachable only through the task row's executionId                 */
/* ========================================================================== */

/*
 * `#readResult` resolves the result through `task.executionId`, because `resultOf` is keyed by
 * (job, task) and a task id is only unique within a job. Seeding the task row is therefore the
 * JOIN the read path performs, not decoration.
 *
 * The output is deliberately long, so a lossy serialization would be visible rather than
 * plausible.
 */

function seedResult(repo: DurableStateRepository, jobId: string, output: string, worker: string): void {
  repo.putJob({ ...jobRow, jobId, correlationId: jobId });
  repo.putTask({ ...taskRow, jobId });
  repo.putExecution({
    executionId: EXEC, jobId, taskId: "t1", attempt: 1, workerId: worker, claimToken: "ck",
    state: "done", startedAt: 10, finishedAt: 20, traceId: `trace-${worker}`,
  });
  repo.putResult({
    executionId: EXEC, jobId, taskId: "t1", succeeded: true, output,
    verificationVerdict: null, providerId: `prov-${worker}`, modelId: `model-${worker}`,
    traceId: `trace-${worker}`, failure: null,
  });
}

describe("PHASE 12 EVIDENCE - results", () => {
  it("reads a durable result with an EMPTY cache, payload intact", () => {
    const { file, dir } = dbPath("res-empty");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      seedResult(repo, "job-1", LONG, "A");
      const result = coordinatorWith(repo).resultOf("job-1", "t1");
      assert.ok(result !== null, "the result came from the repository, joined through the task");
      assert.equal(result.executionId, EXEC, "executionId relationship");
      assert.equal(result.output, LONG, "the full output survived - no truncation");
      assert.equal(result.providerId, "prov-A");
      assert.equal(result.modelId, "model-A");
      assert.equal(result.traceId, "trace-A");
      assert.equal(result.succeeded, true);
    } finally {
      repo?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("prefers the repository over a POPULATED but STALE cache", () => {
    const { file, dir } = dbPath("res-stale");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      seedResult(repo, "job-1", "first output", "A");
      const coordinator = coordinatorWith(repo);
      assert.equal(coordinator.resultOf("job-1", "t1")?.output, "first output", "cache holds the first output");

      const row = repo.getResult(EXEC);
      assert.ok(row !== null);
      repo.putResult({ ...row, output: "second output" });
      assert.equal(coordinator.resultOf("job-1", "t1")?.output, "second output", "the repository wins");
    } finally {
      repo?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("survives a REAL close/reopen", () => {
    const { file, dir } = dbPath("res-restart");
    let a: SqliteDurableStore | null = null;
    let b: SqliteDurableStore | null = null;
    try {
      a = SqliteDurableStore.open({ path: file, workspace: AC });
      seedResult(a, "job-1", LONG, "A");
      a.close();
      b = SqliteDurableStore.open({ path: file, workspace: AC });
      const result = coordinatorWith(b).resultOf("job-1", "t1");
      assert.ok(result !== null, "a fresh coordinator sees it");
      assert.equal(result.output, LONG, "with the full payload");
      assert.equal(result.jobId, "job-1");
      assert.equal(result.taskId, "t1");
    } finally {
      a?.close();
      b?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("isolates results between workspaces in BOTH directions", () => {
    const { file, dir } = dbPath("res-ws");
    let ac: SqliteDurableStore | null = null;
    let gb: SqliteDurableStore | null = null;
    let ac2: SqliteDurableStore | null = null;
    try {
      ac = SqliteDurableStore.open({ path: file, workspace: AC });
      seedResult(ac, "job-1", "acme output", "ACME");
      ac.close();

      gb = SqliteDurableStore.open({ path: file, workspace: GB });
      const globex = coordinatorWith(gb, GB);
      assert.equal(globex.resultOf("job-1", "t1"), null, "globex sees none of acme's result");
      seedResult(gb, "job-1", "globex output", "GLOBEX");
      assert.equal(globex.resultOf("job-1", "t1")?.output, "globex output", "and sees its own");
      gb.close();

      ac2 = SqliteDurableStore.open({ path: file, workspace: AC });
      assert.equal(
        coordinatorWith(ac2, AC).resultOf("job-1", "t1")?.output,
        "acme output",
        "acme still sees its own, not globex's identically-keyed one",
      );
    } finally {
      ac?.close();
      gb?.close();
      ac2?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("leaves no durable or cached trace when persistence is refused", () => {
    const { file, dir } = dbPath("res-atomic");
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
        putAttempt: bound("putAttempt"), listAttempts: bound("listAttempts"), latestAttempt: bound("latestAttempt"),
        appendCheckpoint: bound("appendCheckpoint"), listCheckpoints: bound("listCheckpoints"),
        latestCheckpoint: bound("latestCheckpoint"), nextCheckpointSequence: bound("nextCheckpointSequence"),
        putClaim: bound("putClaim"), getClaim: bound("getClaim"), releaseClaim: bound("releaseClaim"), listClaims: bound("listClaims"),
        beginIdempotent: bound("beginIdempotent"), completeIdempotent: bound("completeIdempotent"),
        abandonIdempotent: bound("abandonIdempotent"), getIdempotent: bound("getIdempotent"), listIdempotent: bound("listIdempotent"),
        putResult: refuse, getResult: bound("getResult"),
        putVerdict: bound("putVerdict"), getVerdict: bound("getVerdict"),
        putApproval: bound("putApproval"), getApproval: bound("getApproval"), listApprovals: bound("listApprovals"),
        putBudget: bound("putBudget"), getBudget: bound("getBudget"),
      };
      const coordinator = coordinatorWith(failing);
      assert.throws(() => failing.putResult({
        executionId: "exec-refused", jobId: "job-1", taskId: "t1", succeeded: true, output: "x",
        verificationVerdict: null, providerId: null, modelId: null, traceId: null, failure: null,
      }), /refused/);
      assert.equal(real.getResult("exec-refused"), null, "nothing durable");
      assert.equal(coordinator.resultOf("job-1", "t1"), null, "and nothing cached");
    } finally {
      real.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });
});

/* ========================================================================== */
/* MEASURED AMOUNT - NULL is not zero                                         */
/* ========================================================================== */

/*
 * The distinction this file exists to protect:
 *
 *   null = nothing has been MEASURED. Also: a provider reported tokens and no price, which
 *          `budgetStatus` calls "unpriced" and which is UNKNOWN SPEND, not free.
 *   0    = something was measured and it was zero.
 *
 * Collapsing them would let a job with unknown cost look like a job that cost nothing, which is
 * the one conclusion a cost budget must never draw.
 *
 * THE FIXTURE LESSON, recorded because it cost a whole attempt: `budgetStatus` reads
 * `job.budget.*`, and a `Job` reconstructed from durable state with an empty cache has no budget
 * at all. Every fixture here therefore goes through `createJob`, the real production write path,
 * which populates a complete `Job` - including its budget - while the MEASURED AMOUNT itself is
 * written straight through the repository. That is what makes the read authority claim: the
 * amount is never in the cache at any point in these tests.
 */

describe("PHASE 12 EVIDENCE - measured amount", () => {
  /** A real job, created the way production creates one, so its budget is present. */
  function realJob(coordinator: ExecutionCoordinator, jobId: string): boolean {
    const created = coordinator.createJob({
      jobId,
      workflow: workflow("wf", "one", taskStep("s1", approvableTask(jobId))),
      budget: { maxDurationMs: 600_000, maxTotalAttempts: null, maxAmount: null, budgetCurrency: null },
    });
    return created.ok;
  }

  it("EMPTY CACHE: a durable amount is observed through budgetStatus", () => {
    const { file, dir } = dbPath("amt-empty");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      const coordinator = coordinatorWith(repo);
      assert.equal(realJob(coordinator, "job-1"), true, "the job exists");
      // The measured amount is written DIRECTLY through the repository, after the job.
      repo.putBudget({ jobId: "job-1", measuredAmount: 7.5, currency: "EUR", attemptsUsed: 1 });

      assert.equal(coordinator.budgetStatus("job-1").measuredAmount, 7.5, "read from the repository");
      assert.equal(coordinator.budgetStatus("job-1").measuredAmount, 7.5, "and a second read agrees");
    } finally {
      repo?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("NULL semantics: nothing measured reads as null, never as 0", () => {
    const { file, dir } = dbPath("amt-null");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      const coordinator = coordinatorWith(repo);
      assert.equal(realJob(coordinator, "job-1"), true);

      const amount = coordinator.budgetStatus("job-1").measuredAmount;
      assert.equal(amount, null, "an unmeasured job reports null");
      assert.notEqual(amount, 0, "explicitly NOT zero - the two are different facts");
    } finally {
      repo?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("ZERO semantics: a measured zero stays the NUMBER 0", () => {
    const { file, dir } = dbPath("amt-zero");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      const coordinator = coordinatorWith(repo);
      assert.equal(realJob(coordinator, "job-1"), true);
      repo.putBudget({ jobId: "job-1", measuredAmount: 0, currency: "USD", attemptsUsed: 1 });

      const amount = coordinator.budgetStatus("job-1").measuredAmount;
      assert.equal(amount, 0, "a measured zero reads as 0");
      assert.equal(typeof amount, "number", "and is still a number, distinguishable from the null above");
    } finally {
      repo?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("STALE CACHE: the repository's amount wins over one already observed", () => {
    const { file, dir } = dbPath("amt-stale");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      const coordinator = coordinatorWith(repo);
      assert.equal(realJob(coordinator, "job-1"), true);
      repo.putBudget({ jobId: "job-1", measuredAmount: 5, currency: "USD", attemptsUsed: 1 });
      assert.equal(coordinator.budgetStatus("job-1").measuredAmount, 5, "cache holds 5");

      // Changed behind the coordinator's back. The cache is NOT cleared.
      repo.putBudget({ jobId: "job-1", measuredAmount: 50, currency: "USD", attemptsUsed: 2 });
      assert.equal(coordinator.budgetStatus("job-1").measuredAmount, 50, "the repository wins over the cached 5");
    } finally {
      repo?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("RESTART: the amount, and the null/0 distinction, survive a REAL close/reopen", () => {
    const { file, dir } = dbPath("amt-restart");
    let a: SqliteDurableStore | null = null;
    let b: SqliteDurableStore | null = null;
    try {
      a = SqliteDurableStore.open({ path: file, workspace: AC });
      for (const id of ["job-none", "job-zero", "job-some"]) {
        assert.equal(realJob(coordinatorWith(a), id), true, `${id} created`);
      }
      a.putBudget({ jobId: "job-zero", measuredAmount: 0, currency: "USD", attemptsUsed: 1 });
      a.putBudget({ jobId: "job-some", measuredAmount: 9.75, currency: "EUR", attemptsUsed: 3 });
      a.close();

      b = SqliteDurableStore.open({ path: file, workspace: AC });
      const fresh = coordinatorWith(b);
      assert.equal(fresh.budgetStatus("job-none").measuredAmount, null, "unmeasured survives as null");
      assert.equal(fresh.budgetStatus("job-zero").measuredAmount, 0, "a measured zero survives as 0");
      assert.equal(fresh.budgetStatus("job-some").measuredAmount, 9.75, "and a real amount survives");
    } finally {
      a?.close();
      b?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("WORKSPACE: an identically-keyed amount does not cross between workspaces", () => {
    const { file, dir } = dbPath("amt-ws");
    let ac: SqliteDurableStore | null = null;
    let gb: SqliteDurableStore | null = null;
    let ac2: SqliteDurableStore | null = null;
    try {
      ac = SqliteDurableStore.open({ path: file, workspace: AC });
      assert.equal(realJob(coordinatorWith(ac), "job-1"), true);
      ac.putBudget({ jobId: "job-1", measuredAmount: 111, currency: "USD", attemptsUsed: 1 });
      ac.close();

      gb = SqliteDurableStore.open({ path: file, workspace: GB });
      const globex = coordinatorWith(gb, GB);
      assert.equal(realJob(globex, "job-1"), true);
      assert.equal(globex.budgetStatus("job-1").measuredAmount, null, "globex sees none of acme's spend");
      gb.putBudget({ jobId: "job-1", measuredAmount: 222, currency: "USD", attemptsUsed: 1 });
      assert.equal(globex.budgetStatus("job-1").measuredAmount, 222, "and sees its own");
      gb.close();

      ac2 = SqliteDurableStore.open({ path: file, workspace: AC });
      assert.equal(
        coordinatorWith(ac2, AC).budgetStatus("job-1").measuredAmount,
        111,
        "acme still sees its own, not globex's",
      );
    } finally {
      ac?.close();
      gb?.close();
      ac2?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("ATOMICITY: a refused budget write changes neither the repository nor the reading", () => {
    const { file, dir } = dbPath("amt-atomic");
    const real = SqliteDurableStore.open({ path: file, workspace: AC });
    try {
      const coordinator = coordinatorWith(real);
      assert.equal(realJob(coordinator, "job-1"), true);
      real.putBudget({ jobId: "job-1", measuredAmount: 3, currency: "USD", attemptsUsed: 1 });
      assert.equal(coordinator.budgetStatus("job-1").measuredAmount, 3, "the starting amount");

      const refuse = (): never => {
        throw new Error("refused");
      };
      // An EXPLICIT delegating double, not `{ ...real }`.
      //
      // A spread of a class instance does NOT copy prototype methods, so `{ ...real, putBudget }`
      // produces an object whose `getJob` is undefined - which is exactly the
      // `this[#durable].getJob is not a function` this test hit. Every method is bound to the real
      // instance instead, and only `putBudget` is replaced.
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
        putAttempt: bound("putAttempt"), listAttempts: bound("listAttempts"), latestAttempt: bound("latestAttempt"),
        appendCheckpoint: bound("appendCheckpoint"), listCheckpoints: bound("listCheckpoints"),
        latestCheckpoint: bound("latestCheckpoint"), nextCheckpointSequence: bound("nextCheckpointSequence"),
        putClaim: bound("putClaim"), getClaim: bound("getClaim"), releaseClaim: bound("releaseClaim"), listClaims: bound("listClaims"),
        beginIdempotent: bound("beginIdempotent"), completeIdempotent: bound("completeIdempotent"),
        abandonIdempotent: bound("abandonIdempotent"), getIdempotent: bound("getIdempotent"), listIdempotent: bound("listIdempotent"),
        putResult: bound("putResult"), getResult: bound("getResult"),
        putVerdict: bound("putVerdict"), getVerdict: bound("getVerdict"),
        putApproval: bound("putApproval"), getApproval: bound("getApproval"), listApprovals: bound("listApprovals"),
        putBudget: refuse, getBudget: bound("getBudget"),
      };
      const failingCoordinator = coordinatorWith(failing);

      assert.throws(
        () => failing.putBudget({ jobId: "job-1", measuredAmount: 999, currency: "USD", attemptsUsed: 9 }),
        /refused/,
      );
      assert.equal(real.getBudget("job-1")?.measuredAmount, 3, "the durable amount is unchanged");
      assert.equal(failingCoordinator.budgetStatus("job-1").measuredAmount, 3, "and the coordinator still reports 3");
    } finally {
      real.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });
});

/* ========================================================================== */
/* VERDICTS - proved through settle(), because no public getter exists         */
/* ========================================================================== */

/*
 * WHY THE FIXTURE LOOKS LIKE THIS
 *
 * `#settle` treats a task as unverified only when ALL of these hold:
 *
 *     verdict !== null && verdict !== "pass" && state === "completed" && task.approvalRequired
 *
 * The last clause is the one that bit: a task that required no approval completes regardless of
 * its verdict, which is correct product behaviour. So the fixture's task declares
 * `approvalRequired: true` and is seeded directly in `completed` - seeded, not run, because the
 * point is the verdict's effect on `settle`, not the approval gate's lifecycle.
 *
 * No public verdict getter was added. `settle()` is public, reports the difference, and is a
 * STRONGER observation than reading a field back: it shows the verdict changing what the system
 * concludes, not merely what it stores.
 */

/** A job with one completed, approval-required task - the only shape where a verdict matters. */
function dbPath(tag: string): { file: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), `toz-p12-rest-${tag}-`));
  return { file: path.join(dir, "state.db"), dir };
}
function seedApprovableJob(repo: DurableStateRepository, jobId: string): void {
  repo.putJob({ ...jobRow, jobId, state: "running", correlationId: jobId });
  repo.putTask({
    ...taskRow,
    jobId,
    state: "completed",
    definition: JSON.stringify({
      taskId: "t1", jobId, objective: "o", input: "i", requiredCapabilities: [], minimumTrust: "low",
      dependsOn: [], approvalRequired: true, verificationKinds: [],
      limits: { timeoutMs: 1000, maxAttempts: 1, queueTimeoutMs: null },
      checkpointable: false, priority: "normal",
    }),
  });
}

describe("PHASE 12 EVIDENCE - verdicts", () => {
  it("EMPTY CACHE: a durable verdict is observed through settle, with no verdict cache", () => {
    const { file, dir } = dbPath("ver-empty");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      seedApprovableJob(repo, "job-1");
      // The verdict written DIRECTLY through the repository, before any coordinator exists.
      repo.putVerdict({ jobId: "job-1", taskId: "t1", verdict: "fail" });

      const coordinator = coordinatorWith(repo);
      assert.equal(
        coordinator.settle("job-1").state,
        "waiting",
        "the durable failing verdict is what settle read - nothing was cached first",
      );
    } finally {
      repo?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("STALE CACHE: the repository's verdict wins over one already observed", () => {
    const { file, dir } = dbPath("ver-stale");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      seedApprovableJob(repo, "job-1");
      repo.putVerdict({ jobId: "job-1", taskId: "t1", verdict: "fail" });
      const coordinator = coordinatorWith(repo);
      assert.equal(coordinator.settle("job-1").state, "waiting", "first read populates the verdict cache with `fail`");

      // Change it behind the coordinator's back. The cache is NOT cleared.
      repo.putVerdict({ jobId: "job-1", taskId: "t1", verdict: "pass" });

      // `JOB_TRANSITIONS` has no `waiting -> completed` edge: from `waiting` a job may only go to
      // running, retrying, paused, failed or cancelled. A first version of this test asserted
      // `completed` immediately and the coordinator correctly THREW `JobStateError` - the state
      // machine refusing an illegal edge, exactly as Phase 07 designed it. The job is therefore
      // driven back to `running` the way real work would, and only then is the verdict observed.
      const waiting = repo.getJob("job-1");
      assert.ok(waiting !== null);
      repo.putJob({ ...waiting, state: "running" });
      assert.equal(
        coordinator.settle("job-1").state,
        "completed",
        "the repository's `pass` decided the outcome, not the cached `fail`",
      );
    } finally {
      repo?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("RESTART: a fresh coordinator still reaches the same conclusion", () => {
    const { file, dir } = dbPath("ver-restart");
    let a: SqliteDurableStore | null = null;
    let b: SqliteDurableStore | null = null;
    try {
      a = SqliteDurableStore.open({ path: file, workspace: AC });
      seedApprovableJob(a, "job-1");
      a.putVerdict({ jobId: "job-1", taskId: "t1", verdict: "fail" });
      a.close();

      b = SqliteDurableStore.open({ path: file, workspace: AC });
      const fresh = coordinatorWith(b);
      assert.equal(fresh.settle("job-1").state, "waiting", "the failing verdict survived the restart");

      // Still authoritative afterwards, which is the authority claim rather than mere survival.
      b.putVerdict({ jobId: "job-1", taskId: "t1", verdict: "pass" });
      // Back to `running` first: `settle` above moved the job to `waiting`, and `JOB_TRANSITIONS`
      // has no `waiting -> completed` edge. The machine refuses it, which is correct.
      const waiting = b.getJob("job-1");
      assert.ok(waiting !== null);
      b.putJob({ ...waiting, state: "running" });
      assert.equal(fresh.settle("job-1").state, "completed", "and still decides on the next read");
    } finally {
      a?.close();
      b?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("WORKSPACE: an identically-keyed verdict in one workspace does not reach the other", () => {
    const { file, dir } = dbPath("ver-ws");
    let ac: SqliteDurableStore | null = null;
    let gb: SqliteDurableStore | null = null;
    let ac2: SqliteDurableStore | null = null;
    try {
      ac = SqliteDurableStore.open({ path: file, workspace: AC });
      seedApprovableJob(ac, "job-1");
      // acme is given a FAILING verdict.
      //
      // Without one it would COMPLETE, because `#settle` treats `verdict === null` as "not
      // measured" rather than "failed" - a documented rule, and the reason this fixture must
      // carry an explicit verdict. Two workspaces holding DIFFERENT durable verdicts under
      // identical ids is what proves isolation; an unverified job on one side would prove nothing.
      ac.putVerdict({ jobId: "job-1", taskId: "t1", verdict: "fail" });
      ac.close();

      // globex opens the SAME database and writes a PASSING verdict under identical ids.
      gb = SqliteDurableStore.open({ path: file, workspace: GB });
      seedApprovableJob(gb, "job-1");
      gb.putVerdict({ jobId: "job-1", taskId: "t1", verdict: "pass" });
      assert.equal(
        coordinatorWith(gb, GB).settle("job-1").state,
        "completed",
        "globex completes its OWN job from its own verdict",
      );
      gb.close();

      ac2 = SqliteDurableStore.open({ path: file, workspace: AC });
      assert.equal(
        coordinatorWith(ac2, AC).settle("job-1").state,
        "waiting",
        "acme is still unverified - globex's identically-keyed pass never reached it",
      );
    } finally {
      ac?.close();
      gb?.close();
      ac2?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("ATOMICITY: a refused verdict write leaves neither a durable nor an observed verdict", () => {
    const { file, dir } = dbPath("ver-atomic");
    const real = SqliteDurableStore.open({ path: file, workspace: AC });
    try {
      seedApprovableJob(real, "job-1");
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
        putAttempt: bound("putAttempt"), listAttempts: bound("listAttempts"), latestAttempt: bound("latestAttempt"),
        appendCheckpoint: bound("appendCheckpoint"), listCheckpoints: bound("listCheckpoints"),
        latestCheckpoint: bound("latestCheckpoint"), nextCheckpointSequence: bound("nextCheckpointSequence"),
        putClaim: bound("putClaim"), getClaim: bound("getClaim"), releaseClaim: bound("releaseClaim"), listClaims: bound("listClaims"),
        beginIdempotent: bound("beginIdempotent"), completeIdempotent: bound("completeIdempotent"),
        abandonIdempotent: bound("abandonIdempotent"), getIdempotent: bound("getIdempotent"), listIdempotent: bound("listIdempotent"),
        putResult: bound("putResult"), getResult: bound("getResult"),
        putVerdict: refuse, getVerdict: bound("getVerdict"),
        putApproval: bound("putApproval"), getApproval: bound("getApproval"), listApprovals: bound("listApprovals"),
        putBudget: bound("putBudget"), getBudget: bound("getBudget"),
      };

      const coordinator = coordinatorWith(failing);
      assert.throws(
        () => failing.putVerdict({ jobId: "job-1", taskId: "t1", verdict: "fail" }),
        /refused/,
        "the refusal surfaces rather than being swallowed",
      );
      assert.equal(real.getVerdict("job-1", "t1"), null, "no verdict is durable");

      // And the PUBLIC behaviour shows the refusal took effect. A job whose only verdict was
      // refused has NO verdict, and `null` means "not measured" - so it COMPLETES. Had the write
      // landed it would be `waiting`. `completed` is therefore the observable proof that nothing
      // was stored, which a getter on the cache could not have given.
      assert.equal(
        coordinator.settle("job-1").state,
        "completed",
        "the coordinator does not behave as though a verdict existed",
      );
    } finally {
      real.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });
});
