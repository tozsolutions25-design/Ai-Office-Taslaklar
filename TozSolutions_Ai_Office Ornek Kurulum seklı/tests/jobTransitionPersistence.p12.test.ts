/**
 * PHASE 12 EVIDENCE - job-level transition history is durable.
 *
 * ## THE GAP THIS CLOSES
 *
 * `#transitions` in the coordinator holds a JOB's lifecycle history: `null -> queued` at creation,
 * then every state the coordinator moves it through. The only durable transition table,
 * `task_transitions`, is TASK-scoped, so a job's history had NO repository representation at all
 * and a restart discarded it silently. 12.5B's evidence attempt recorded this as an unprovable
 * gap rather than writing a test that asserted a cache was authoritative.
 *
 * `job_transitions` now carries it. The two tables stay distinct on purpose: a job transition has
 * no task id, and inventing one to share a table would make both histories unreadable.
 *
 * ## WHY SEQUENCE IS ALLOCATED IN THE REPOSITORY
 *
 * Checkpoint identity already had this lesson: a process counter restarts at 1, so a restarted job
 * would produce two "sequence 1" entries. The sequence here is a durable `MAX + 1` inside the
 * caller's transaction, and the restart test asserts 1, 2, 3 across a real close/reopen.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { ExecutionCoordinator, type TaskExecutionPort } from "../src/orchestration/workflow/coordinator.js";
import { workflow, task as taskStep, type WorkflowTask } from "../src/orchestration/workflow/model.js";
import { InMemoryDurableStore } from "../src/state/inMemoryStore.js";
import { SqliteDurableStore } from "../src/state/sqliteStore.js";
import type { DurableStateRepository } from "../src/state/durable.js";

const NOW = new Date("2026-04-01T00:00:00.000Z");
const AC = { workspace: "acme", brand: null };
const GB = { workspace: "globex", brand: null };

const definition = (o: Record<string, unknown> = {}): WorkflowTask =>
  ({
    taskId: "t1", jobId: "job-1", objective: "Do it", input: "in", requiredCapabilities: [],
    minimumTrust: "low", dependsOn: [], approvalRequired: false,
    limits: { timeoutMs: 1000, maxAttempts: 1, queueTimeoutMs: null },
    checkpointable: false, priority: "normal", ...o,
  });

function coordinatorWith(repo: DurableStateRepository, ws = AC): ExecutionCoordinator {
  const executor: TaskExecutionPort = { execute: () => Promise.reject(new Error("not used")) };
  return new ExecutionCoordinator({ clock: new ManualClock(NOW), workspace: ws, durable: repo, executor });
}

function tempDb(name: string): { file: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), `toz-p12-jobtr-${name}-`));
  return { file: path.join(dir, "state.db"), dir };
}

describe("PHASE 12 EVIDENCE - job transition persistence", () => {
  it("round-trips through BOTH implementations, with identical semantics", () => {
    const { dir } = tempDb("both");
    try {
      const stores: { name: string; repo: DurableStateRepository }[] = [
        { name: "InMemoryDurableStore", repo: new InMemoryDurableStore({ scope: AC }) },
        { name: "SqliteDurableStore", repo: SqliteDurableStore.open({ path: path.join(dir, "b.db"), workspace: AC }) },
      ];
      const observed: string[] = [];

      for (const { name, repo } of stores) {
        const first = repo.appendJobTransition({ jobId: "j", from: null, to: "queued", at: 1, reason: "created", waitingFor: null });
        const second = repo.appendJobTransition({ jobId: "j", from: "queued", to: "running", at: 2, reason: "started", waitingFor: null });
        const third = repo.appendJobTransition({ jobId: "j", from: "running", to: "waiting", at: 3, reason: "gate", waitingFor: "approval" });

        // Every field of the existing in-memory record survives, including the two that carry
        // meaning rather than data: `from` being null for CREATION, and `waitingFor` saying what
        // a `waiting` job waits for.
        assert.deepEqual(
          [first, second, third].map((r) => [r.sequence, r.from, r.to, r.at, r.reason, r.waitingFor]),
          [[1, null, "queued", 1, "created", null], [2, "queued", "running", 2, "started", null], [3, "running", "waiting", 3, "gate", "approval"]],
          `${name}: sequence, both states, the timestamp, the reason and waitingFor`,
        );
        assert.equal(repo.latestJobTransition("j")?.to, "waiting", `${name}: latest is the newest`);
        assert.equal(repo.listJobTransitions("nope").length, 0, `${name}: an unknown job has no history`);
        observed.push(name);
      }
      assert.deepEqual(observed, ["InMemoryDurableStore", "SqliteDurableStore"], "both were exercised");
      for (const { repo } of stores) repo.close();
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("keeps the sequence running across a REAL restart: 1, 2, then 3", () => {
    const { file, dir } = tempDb("restart");
    let a: SqliteDurableStore | null = null;
    let b: SqliteDurableStore | null = null;
    try {
      a = SqliteDurableStore.open({ path: file, workspace: AC });
      const coordinator = coordinatorWith(a);
      assert.equal(coordinator.createJob({ jobId: "job-r", workflow: workflow("wf", "one", taskStep("s1", definition({ jobId: "job-r" }))) }).ok, true);
      // The creation transition is `null -> queued`, written through the coordinator's real path.
      assert.equal(coordinator.transitionsOf("job-r").length, 1, "the creation transition exists");
      a.appendJobTransition({ jobId: "job-r", from: "queued", to: "running", at: 2, reason: "second", waitingFor: null });
      a.close();

      b = SqliteDurableStore.open({ path: file, workspace: AC });
      const fresh = coordinatorWith(b);
      const history = fresh.transitionsOf("job-r");
      assert.equal(history.length, 2, "both survived the restart, read through the PUBLIC path");
      assert.equal(history[0]?.from, null, "including the creation transition's null `from`");
      assert.equal(history[1]?.to, "running");

      b.appendJobTransition({ jobId: "job-r", from: "running", to: "completed", at: 3, reason: "third", waitingFor: null });
      assert.deepEqual(
        b.listJobTransitions("job-r").map((r) => r.sequence),
        [1, 2, 3],
        "and the post-restart sequence continues rather than restarting at 1",
      );
    } finally {
      a?.close();
      b?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("reads a POPULATED cache as empty-cache, and prefers durable state over a STALE cache", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "toz-p12-jobtr-auth-"));
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: path.join(dir, "a.db"), workspace: AC });
      // Durable state written straight through the repository.
      repo.appendJobTransition({ jobId: "job-e", from: null, to: "queued", at: 1, reason: "one", waitingFor: null });

      // EMPTY CACHE: a fresh coordinator that has read nothing.
      const fresh = coordinatorWith(repo);
      const empty = fresh.transitionsOf("job-e");
      assert.equal(empty.length, 1, "read from the repository, not from an empty cache");
      assert.equal(empty[0]?.reason, "one");

      // STALE CACHE: append durably WITHOUT clearing the cache the read above populated.
      repo.appendJobTransition({ jobId: "job-e", from: "queued", to: "running", at: 2, reason: "two", waitingFor: null });
      const afterStale = fresh.transitionsOf("job-e");
      assert.equal(afterStale.length, 2, "the appended transition is visible");
      assert.equal(afterStale[1]?.reason, "two", "and it is not hidden by the cached list");
    } finally {
      repo?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("isolates job histories between workspaces, in both directions", () => {
    const { file, dir } = tempDb("ws");
    let ac: SqliteDurableStore | null = null;
    let gb: SqliteDurableStore | null = null;
    let ac2: SqliteDurableStore | null = null;
    try {
      ac = SqliteDurableStore.open({ path: file, workspace: AC });
      ac.appendJobTransition({ jobId: "shared-job", from: null, to: "queued", at: 1, reason: "acme's own", waitingFor: null });
      ac.close();

      gb = SqliteDurableStore.open({ path: file, workspace: GB });
      const globex = coordinatorWith(gb, GB);
      assert.deepEqual(globex.transitionsOf("shared-job"), [], "globex sees none of acme's history");
      gb.appendJobTransition({ jobId: "shared-job", from: null, to: "queued", at: 9, reason: "globex's own", waitingFor: null });
      assert.equal(globex.transitionsOf("shared-job")[0]?.reason, "globex's own", "and its own is readable");
      gb.close();

      ac2 = SqliteDurableStore.open({ path: file, workspace: AC });
      const acme = coordinatorWith(ac2, AC);
      const history = acme.transitionsOf("shared-job");
      assert.equal(history.length, 1, "acme still sees exactly its own, not globex's");
      assert.equal(history[0]?.reason, "acme's own");
    } finally {
      ac?.close();
      gb?.close();
      ac2?.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("leaves no durable or cached trace when the append fails", () => {
    const { file, dir } = tempDb("fail");
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
        appendJobTransition: refuse, listJobTransitions: bound("listJobTransitions"), latestJobTransition: bound("latestJobTransition"),
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
        putBudget: bound("putBudget"), getBudget: bound("getBudget"),
      };

      const coordinator = coordinatorWith(failing);
      assert.throws(
        () => coordinator.createJob({ jobId: "job-f", workflow: workflow("wf", "one", taskStep("s1", definition({ jobId: "job-f" }))) }),
        /refused/,
        "the coordinator surfaces the repository's refusal",
      );
      assert.equal(real.listJobTransitions("job-f").length, 0, "and no transition is durable");
      assert.deepEqual(coordinator.transitionsOf("job-f"), [], "nor does one appear from the cache");
    } finally {
      real.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });

  it("rolls the append back with its transaction, in BOTH implementations", () => {
    // The in-memory store rolled back for real only after 12.4 made it snapshot; parity here is
    // what keeps that true. A store that committed anyway would make the coordinator believe a
    // transition happened when it did not.
    const dir = mkdtempSync(path.join(tmpdir(), "toz-p12-jobtr-tx-"));
    const stores: DurableStateRepository[] = [
      new InMemoryDurableStore({ scope: AC }),
      SqliteDurableStore.open({ path: path.join(dir, "t.db"), workspace: AC }),
    ];
    try {
      for (const repo of stores) {
        repo.transaction(() => {
          repo.appendJobTransition({ jobId: "tx", from: null, to: "queued", at: 1, reason: "committed", waitingFor: null });
        });
        assert.equal(repo.listJobTransitions("tx").length, 1, "the committed one survives");
        assert.throws(() => {
          repo.transaction(() => {
            repo.appendJobTransition({ jobId: "tx", from: "queued", to: "running", at: 2, reason: "rolled back", waitingFor: null });
            throw new Error("boom");
          });
        }, /boom/);
        assert.equal(repo.listJobTransitions("tx").length, 1, "the rolled-back append left nothing");
        assert.equal(repo.latestJobTransition("tx")?.reason, "committed");
      }
    } finally {
      for (const repo of stores) repo.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    }
  });
});