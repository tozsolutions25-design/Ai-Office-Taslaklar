/**
 * PHASE 12 EVIDENCE - the coordinator's job/task maps are caches, not authorities.
 *
 * ## THE INVARIANT UNDER TEST
 *
 *     repository.write(...)  THEN  cache
 *     repository.read(...)        is the answer, always
 *
 * `#jobs` and `#tasks` used to be the stores. They are now `#readJob`/`#readTask` caches behind
 * `DurableStateRepository`, and the whole point of this file is that the change is real rather
 * than declared.
 *
 * ## WHY THESE TESTS ARE SHAPED THE WAY THEY ARE
 *
 * Every assertion here is deliberately hostile to the "cache" claim:
 *
 *  - the restart test throws away the FIRST coordinator entirely, so nothing can be answered
 *    from an object that still exists;
 *  - the empty-cache test reads through the ordinary public path with the map proven empty;
 *  - the stale-cache test mutates durable state THROUGH THE REPOSITORY behind the coordinator's
 *    back, and does NOT clear the cache first - clearing it would let a cache-authoritative
 *    implementation pass;
 *  - the write-failure test makes the repository refuse, because the ordering only matters when
 *    the repository can refuse.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { ExecutionCoordinator } from "../src/orchestration/workflow/coordinator.js";
import { workflow, task, type WorkflowTask } from "../src/orchestration/workflow/model.js";
import type { TaskExecutionPort } from "../src/orchestration/workflow/coordinator.js";
import { SqliteDurableStore } from "../src/state/sqliteStore.js";
import type { DurableStateRepository } from "../src/state/durable.js";

const NOW = new Date("2026-04-01T00:00:00.000Z");
const AC = { workspace: "acme", brand: null };
const GB = { workspace: "globex", brand: null };

function dbFile(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "toz-p12-5a-")), "state.db");
}

const definition = (overrides: Record<string, unknown> = {}): WorkflowTask => ({
  taskId: "t1",
  jobId: "job-1",
  objective: "Do the thing",
  input: "in",
  requiredCapabilities: [],
  minimumTrust: "low",
  dependsOn: [],
  approvalRequired: false,
  limits: { timeoutMs: 1_000, maxAttempts: 1, queueTimeoutMs: null },
  checkpointable: false,
  priority: "normal",
  ...overrides,
});

function coordinatorWith(repo: DurableStateRepository, workspace: { workspace: string; brand: string | null } = AC): ExecutionCoordinator {
    // A port that is never asked to do anything here: every case in this file is about durable
  // state, and a stub is enough. It must be present because the coordinator requires one.
  const executor: TaskExecutionPort = {
    execute: () => Promise.reject(new Error("this test never executes a task")),
  };
  return new ExecutionCoordinator({ clock: new ManualClock(NOW), workspace, durable: repo, executor });
}
function createJob(coordinator: ExecutionCoordinator, jobId = "job-1", taskId = "t1") {
  return coordinator.createJob({
    jobId,
    workflow: workflow("wf-1", "One task", task("s1", definition({ jobId, taskId }))),
  });
}

describe("PHASE 12 EVIDENCE - coordinator cache authority", () => {
  it("rehydrates from the repository after a real restart", () => {
    const file = dbFile();
    // Opened in the try so the finally can close whatever exists: a store left open holds a
    // Windows lock and the cleanup then fails with EPERM, masking whatever the test really did.
    let repoA: SqliteDurableStore | null = null;
    let repoB: SqliteDurableStore | null = null;
    try {
      /* ---- lifecycle A ---- */
      repoA = SqliteDurableStore.open({ path: file, workspace: AC });
      const a = coordinatorWith(repoA);
      const created = createJob(a);
      assert.equal(created.ok, true, `the job is created: ${JSON.stringify(created.ok ? null : created.error)}`);
      repoA.close();
      // `a` is deliberately still in scope and deliberately never consulted again. Anything it
      // could answer would make this test pass without the database being read at all.

      /* ---- lifecycle B ---- */
      repoB = SqliteDurableStore.open({ path: file, workspace: AC });
      const b = coordinatorWith(repoB);

      const job = b.job("job-1");
      assert.ok(job !== null, "the job survived the restart, read through the public path");
      assert.equal(job.state, "queued", "with its durable state");

      const record = b.task("job-1", "t1");
      assert.ok(record !== null, "and so did its task");
      assert.equal(record.task.taskId, "t1", "with the right identity");
      assert.equal(record.state, "ready", "and a real state, not an empty default");
      assert.equal(b.tasksOf("job-1").length, 1);
      repoB.close();
    } finally {
      repoA?.close();
      repoB?.close();
      rmSync(path.dirname(file), { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("returns durable state when the cache is empty, and repopulates the cache", () => {
    const repo = SqliteDurableStore.open({ path: dbFile(), workspace: AC });
    try {
      // Durable rows written DIRECTLY, so no coordinator cache can possibly hold them.
      repo.putJob({
        jobId: "job-1", workflowId: "wf", label: "written by hand", state: "running",
        priority: "normal", owner: "op", correlationId: "job-1", budget: JSON.stringify({ maxDurationMs: null, maxTotalAttempts: null, maxAmount: null, budgetCurrency: null }), createdAt: 1, updatedAt: 2,
      });
      repo.putTask({
        jobId: "job-1", taskId: "t1", state: "running", attempts: 2, executionId: "exec-9",
        claimToken: null, startedAt: 5, finishedAt: null, resultRef: null, failure: null,
        failureClass: null, retryable: null, redriveSafe: false,
        definition: JSON.stringify(definition()),
      });

      const coordinator = coordinatorWith(repo);
      // Nothing has been read, so the cache is empty by construction.
      assert.equal(coordinator.job("job-1")?.label, "written by hand", "the job came from the repository");
      assert.equal(coordinator.task("job-1", "t1")?.attempts, 2, "and the task's attempt count, which nothing could have guessed");
      assert.equal(coordinator.task("job-1", "t1")?.executionId, "exec-9");

      // A second read must agree, and the cache is now populated - which is the point of a cache.
      assert.equal(coordinator.task("job-1", "t1")?.executionId, "exec-9", "and reading again is stable");
    } finally {
      repo.close();
    }
  });

  it("prefers durable state over a POPULATED but STALE cache", () => {
    const repo = SqliteDurableStore.open({ path: dbFile(), workspace: AC });
    try {
      const coordinator = coordinatorWith(repo);
      createJob(coordinator);
      // Populate the cache through the ordinary path.
      assert.equal(coordinator.job("job-1")?.state, "queued", "the cache now holds `queued`");

      // Change durable state BEHIND the coordinator's back. The cache is NOT cleared - clearing
      // it would let a cache-authoritative implementation pass, which is the whole trap.
      const row = repo.getJob("job-1");
      assert.ok(row !== null, "the row exists to change");
      repo.putJob({ ...row, state: "completed", updatedAt: 999 });

      assert.equal(
        coordinator.job("job-1")?.state,
        "completed",
        "the repository wins, and the stale `queued` in the map is not returned",
      );
      assert.equal(coordinator.job("job-1")?.updatedAt, 999, "and the cache was refreshed from the answer");

      const taskRow = repo.getTask("job-1", "t1");
      assert.ok(taskRow !== null, "the task row exists too");
      repo.putTask({ ...taskRow, state: "completed", finishedAt: 999 });
      assert.equal(coordinator.task("job-1", "t1")?.state, "completed", "same for a task");
    } finally {
      repo.close();
    }
  });

  it("leaves the cache unmutated when the repository refuses the write", () => {
    const file = dbFile();
    // Declared OUTSIDE the try so the finally can close it. A store left open holds a Windows
    // file lock, and the cleanup then fails with EPERM - which masks whatever the test actually
    // did. Closing in the finally is what makes a failure in here reportable at all.
    let repoB: SqliteDurableStore | null = null;
      const real = SqliteDurableStore.open({ path: file, workspace: AC });
    try {
      // A double that reads normally and REFUSES writes. A closed store would have been simpler
      // and would have proved nothing: with the repository gone, every read throws too, so there
      // is no way to ask whether the cache was updated. This one keeps reads working, so the
      // question can actually be asked.
      // A toggle, so the store works for the first job and refuses the second. A double that
      // refuses from the start would fail the FIRST createJob and prove nothing about the
      // ordering - the property under test is what the cache holds AFTER a refusal, which needs
      // a successful write beforehand to be distinguishable from it.

      // An EXPLICIT delegating double rather than a Proxy or an `Object.create` chain.
//
// Both of those were tried and both are wrong here for a reason worth recording. A Proxy's
// `Reflect.get` is typed `any`, which this repository's lint rules reject - correctly, since the
// `any` would hide the very shape mismatch the double creates. `Object.create(real)` typechecks
// but throws "Receiver must be an instance of SqliteDurableStore" on the first read, because a
// derived object does not inherit another object's PRIVATE fields.
//
// So every method is bound to the real instance explicitly. One cast, confined to the helper,
// and named for what it is.
      const refuseWrite = (): never => {
        throw new Error("the repository refused this write");
      };
      const bound = <K extends keyof DurableStateRepository>(key: K): DurableStateRepository[K] =>
        (real[key] as unknown as (...args: unknown[]) => unknown).bind(real) as DurableStateRepository[K];
      const makeDouble = (refuse: boolean): DurableStateRepository => ({
        scope: real.scope,
        schemaVersion: () => real.schemaVersion(),
        close: () => real.close(),
        transaction: bound("transaction"),
        putJob: refuse ? refuseWrite : bound("putJob"),
        getJob: bound("getJob"),
        listJobs: bound("listJobs"),
        deleteJob: bound("deleteJob"),
        putTask: refuse ? refuseWrite : bound("putTask"),
        getTask: bound("getTask"),
        listTasks: bound("listTasks"),
        putTaskTransition: refuse ? refuseWrite : bound("putTaskTransition"),
        appendJobTransition: refuse ? refuseWrite : bound("appendJobTransition"),
        listJobTransitions: bound("listJobTransitions"),
        latestJobTransition: bound("latestJobTransition"),
        listTaskTransitions: bound("listTaskTransitions"),
        putExecution: bound("putExecution"),
        getExecution: bound("getExecution"),
        listExecutions: bound("listExecutions"),
        putAttempt: bound("putAttempt"),
        listAttempts: bound("listAttempts"),
        latestAttempt: bound("latestAttempt"),
        appendCheckpoint: bound("appendCheckpoint"),
        listCheckpoints: bound("listCheckpoints"),
        latestCheckpoint: bound("latestCheckpoint"),
        nextCheckpointSequence: bound("nextCheckpointSequence"),
        putClaim: bound("putClaim"),
        getClaim: bound("getClaim"),
        releaseClaim: bound("releaseClaim"),
        listClaims: bound("listClaims"),
        beginIdempotent: bound("beginIdempotent"),
        completeIdempotent: bound("completeIdempotent"),
        abandonIdempotent: bound("abandonIdempotent"),
        getIdempotent: bound("getIdempotent"),
        listIdempotent: bound("listIdempotent"),
        putResult: bound("putResult"),
        getResult: bound("getResult"),
        putVerdict: bound("putVerdict"),
        getVerdict: bound("getVerdict"),
        putApproval: bound("putApproval"),
        getApproval: bound("getApproval"),
        listApprovals: bound("listApprovals"),
        putBudget: bound("putBudget"),
        getBudget: bound("getBudget"),
      });
      let refusing = makeDouble(false);
      const coordinator = coordinatorWith(refusing);
      assert.equal(createJob(coordinator).ok, true, "the first job is written before the store starts refusing");
      refusing = makeDouble(true);
      const coordinator2 = coordinatorWith(refusing);

      assert.throws(
        () => createJob(coordinator2, "job-2", "t2"),
        /refused this write/,
        "the second createJob fails at the repository",
      );
      assert.equal(
        coordinator2.job("job-2"),
        null,
        "and no cached job appears for it - a map holding an unpersisted job would be an authority",
      );
      assert.equal(coordinator2.task("job-2", "t2"), null, "nor a cached task");

      // The durable answer, from a completely separate lifecycle.
      repoB = SqliteDurableStore.open({ path: file, workspace: AC });
      assert.equal(repoB.getJob("job-2"), null, "job-2 was never persisted");
      assert.equal(repoB.getTask("job-2", "t2"), null, "nor its task");
      assert.ok(repoB.getJob("job-1") !== null, "and the job that succeeded is intact");
    } finally {
      repoB?.close();
      real.close();
      rmSync(path.dirname(file), { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("keeps workspace A and workspace B apart through the coordinator's read path", () => {
    const file = dbFile();
    try {
      const repoA = SqliteDurableStore.open({ path: file, workspace: AC });
      const acme = coordinatorWith(repoA, AC);
      assert.equal(createJob(acme, "job-1", "t1").ok, true);
      repoA.close();

      // globex opens the SAME database and builds its OWN coordinator.
      const repoG = SqliteDurableStore.open({ path: file, workspace: GB });
      const globex = coordinatorWith(repoG, GB);
      assert.equal(globex.job("job-1"), null, "globex cannot read acme's job through the public path");
      assert.equal(globex.task("job-1", "t1"), null, "nor its task");
      assert.deepEqual(globex.tasksOf("job-1"), [], "and its task list is empty, not merely filtered later");

      // globex writes the SAME ids; acme must then see only its own.
      assert.equal(createJob(globex, "job-1", "t1").ok, true, "globex may use the same ids");
      assert.equal(globex.task("job-1", "t1")?.task.objective, "Do the thing", "and see its own");
      repoG.close();

      const repoA2 = SqliteDurableStore.open({ path: file, workspace: AC });
      const acmeAgain = coordinatorWith(repoA2, AC);
      assert.equal(acmeAgain.job("job-1")?.state, "queued", "acme still sees its own job");
      assert.equal(
        acmeAgain.task("job-1", "t1")?.state,
        "ready",
        "and its own task state, untouched by globex writing the same ids",
      );
      repoA2.close();
    } finally {
      rmSync(path.dirname(file), { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("records the task's creation as a transition in the same transaction as the task", () => {
    const repo = SqliteDurableStore.open({ path: dbFile(), workspace: AC });
    try {
      const coordinator = coordinatorWith(repo);
      createJob(coordinator);
      const history = repo.listTaskTransitions("job-1", "t1");
      assert.equal(history.length, 1, "creating a task records how it came to exist");
      assert.equal(history[0]?.from, null);
      assert.equal(history[0]?.to, "ready");
      // The two must agree, because they were written in one transaction. A task row with no
      // transition, or a transition with no task row, is the inconsistency this forbids.
      assert.equal(repo.getTask("job-1", "t1")?.state, history[0]?.to, "task state and transition history agree");
    } finally {
      repo.close();
    }
  });
});