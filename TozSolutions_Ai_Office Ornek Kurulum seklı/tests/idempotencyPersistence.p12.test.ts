/**
 * PHASE 12.8 - DURABLE IDEMPOTENCY EVIDENCE.
 *
 * ## WHAT WAS ACTUALLY BROKEN
 *
 * `IdempotencyLedger` kept two process-local structures: a `Map` of finished records and a `Set`
 * of in-flight keys. A restart emptied both, so after it the ledger could not tell a key that had
 * already run from a key it had never seen, and a duplicate delivery would be free to run again.
 * `DurableStateRepository.idempotency_records` exists for exactly this, and the coordinator never
 * called it.
 *
 * ## HOW EVERY CLAIM BELOW IS PROVEN
 *
 * Two rules, applied without exception:
 *
 *   1. NO PROCESS-LOCAL MAP IS EVIDENCE. A record only counts once it has been read back from a
 *      `SqliteDurableStore` that was CLOSED and REOPENED, or from a coordinator constructed with
 *      an empty mirror. Asserting against the same object that just wrote the row would prove that
 *      a `Map` works.
 *   2. EVERY READ GOES THROUGH THE PUBLIC SURFACE. `coordinator.idempotency` and the repository's
 *      own `getIdempotent` / `listIdempotent`. No getter was added to make a test possible.
 *
 * `AC` and `GB` are the same database file reached through two different workspace scopes, which
 * is the only honest way to show isolation: two stores would prove nothing.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { ERROR_CLASSES } from "../src/core/errors.js";
import { ExecutionCoordinator, type TaskExecutionPort } from "../src/orchestration/workflow/coordinator.js";
import { DELIVERY_SEMANTICS, type IdempotencyLedger } from "../src/orchestration/workflow/claims.js";
import { task as taskStep, workflow, type WorkflowTask } from "../src/orchestration/workflow/model.js";
import type { DurableStateRepository } from "../src/state/durable.js";
import { SqliteDurableStore } from "../src/state/sqliteStore.js";

const NOW = new Date("2026-04-01T00:00:00.000Z").getTime();
const AC = { workspace: "acme", brand: null };
const GB = { workspace: "globex", brand: null };

function dbFile(name: string): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "toz-idem-")), `${name}.db`);
}

/**
 * A repository that behaves exactly like `real` except that the named methods throw.
 *
 * Methods are delegated with `this` bound to `real`, which matters: the SQLite store keeps its
 * prepared statements in a private field. A hand-written object literal - or a spread of the
 * instance, `{ ...real }` - loses both the prototype methods and the private field, and fails as
 * `this.getJob is not a function` instead of as the refusal this exists to cause. An earlier
 * attempt at exactly this double produced that error and was nearly mistaken for a product bug.
 */
function refusing(
  real: DurableStateRepository,
  denied: readonly (keyof DurableStateRepository)[],
): DurableStateRepository {
  const block = new Set<string>(denied.map(String));
  return new Proxy(real, {
    get: (target, prop) => {
      if (typeof prop === "string" && block.has(prop)) {
        return () => {
          throw new Error(`refused: ${prop}`);
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

function coordinatorWith(repo: DurableStateRepository, executor?: TaskExecutionPort): ExecutionCoordinator {
  const port: TaskExecutionPort = executor ?? { execute: () => Promise.reject(new Error("not used")) };
  return new ExecutionCoordinator({ clock: new ManualClock(NOW), workspace: repo.scope, durable: repo, executor: port });
}

/** A complete task definition. `limits` is read by the budget path, so a partial one would crash there. */
function definition(jobId: string, taskId: string): WorkflowTask {
  return {
    taskId,
    jobId,
    objective: "Do the thing",
    input: "in",
    requiredCapabilities: [],
    minimumTrust: "low",
    dependsOn: [],
    approvalRequired: false,
    verificationKinds: [],
    limits: { timeoutMs: 1_000, maxAttempts: 2, queueTimeoutMs: null },
    checkpointable: false,
    priority: "normal",
  };
}

/** Seeds a real job through the real `createJob`, so the task exists durably before anything runs. */
function seedJob(coordinator: ExecutionCoordinator, jobId = "job-1", taskId = "t1"): void {
  const created = coordinator.createJob({
    jobId,
    workflow: workflow("wf-1", "One task", taskStep("s1", definition(jobId, taskId))),
  });
  assert.equal(created.ok, true, "the fixture job must be real, not a hand-built row");
}

/** The single durable row, read back through the repository rather than from any local structure. */
function onlyRow(repo: DurableStateRepository): { readonly key: string; readonly state: string; readonly outcome: string | null; readonly resultRef: string | null; readonly replays: number } {
  const rows = repo.listIdempotent();
  assert.equal(rows.length, 1, `expected exactly one durable idempotency record, saw ${rows.length}`);
  const row = rows[0];
  assert.ok(row !== undefined, "the record must exist");
  return row;
}

/* ========================================================================== */
/* 1. EMPTY CACHE + 8. COMPLETION PERSISTENCE                                */
/* ========================================================================== */

describe("PHASE 12.8 EVIDENCE - idempotency", () => {
  it("EMPTY CACHE: a completed record is read from the repository by a coordinator that never saw it", () => {
    const file = dbFile("empty-cache");
    let writer: SqliteDurableStore | null = null;
    let reader: SqliteDurableStore | null = null;
    try {
      writer = SqliteDurableStore.open({ path: file, workspace: AC });
      writer.beginIdempotent("k1", "t1", NOW);
      writer.completeIdempotent("k1", "succeeded", "exec-1", NOW);

      // A second coordinator over the same file, with its own ledger and an empty mirror. If the
      // answer came from a process-local structure this would be null.
      reader = SqliteDurableStore.open({ path: file, workspace: AC });
      const seen = coordinatorWith(reader).idempotency.get("k1");
      assert.ok(seen !== null, "the record came from durable state, not from a map this process filled");
      assert.equal(seen.outcome, "succeeded");
      assert.equal(seen.resultRef, "exec-1", "completion is persisted, with the reference it produced");
      assert.equal(seen.replays, 0);
    } finally {
      writer?.close();
      reader?.close();
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("COMPLETION: the durable row carries the outcome and survives a real close/reopen", () => {
    const file = dbFile("completion");
    let a: SqliteDurableStore | null = null;
    let b: SqliteDurableStore | null = null;
    try {
      a = SqliteDurableStore.open({ path: file, workspace: AC });
      const ledger = coordinatorWith(a).idempotency;
      const begun = ledger.begin("k1", "t1");
      assert.equal(begun.ok, true);
      const done = ledger.complete("k1", "succeeded", "exec-9");
      assert.ok(done !== null, "the completion was accepted");
      a.close();
      a = null;

      b = SqliteDurableStore.open({ path: file, workspace: AC });
      const row = onlyRow(b);
      assert.equal(row.state, "succeeded", "the finished attempt is durable, not just remembered");
      assert.equal(row.outcome, "succeeded");
      assert.equal(row.resultRef, "exec-9");
      assert.equal(coordinatorWith(b).idempotency.inFlightCount(), 0, "a finished key is no longer in flight");
    } finally {
      a?.close();
      b?.close();
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  /* ======================================================================== */
  /* 2, 4, 11. SAME ATTEMPT, IN_PROGRESS, NO SECOND EXECUTABLE OPERATION     */
  /* ======================================================================== */

  it("SAME ATTEMPT + SAME KEY: a duplicate is refused, and nothing is left claiming success", () => {
    const file = dbFile("same-attempt");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      const ledger = coordinatorWith(repo).idempotency;

      const first = ledger.begin("k1", "t1");
      assert.equal(first.ok, true);
      assert.equal(first.ok === true ? first.record : undefined, null, "a fresh claim reports no outcome");

      const duplicate = ledger.begin("k1", "t1");
      assert.equal(duplicate.ok, false, "at-most-once: the second begin must not create work");
      assert.equal(duplicate.ok === false ? duplicate.reason : null, "in_progress");

      // At-most-once BEFORE execution starts: the durable row is in_progress and carries no
      // outcome. A ledger that had "answered" the duplicate would have to invent one here.
      const row = onlyRow(repo);
      assert.equal(row.state, "in_progress");
      assert.equal(row.outcome, null, "an unfinished attempt has no outcome to report");
      assert.equal(row.resultRef, null);
      assert.equal(ledger.inFlightCount(), 1);
    } finally {
      repo?.close();
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("NO DUPLICATE OPERATION: executeTask runs the port once, and a repeat of the same attempt replays", async () => {
    const file = dbFile("no-duplicate");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      let invocations = 0;
      const executor: TaskExecutionPort = {
        execute: () => {
          invocations += 1;
          return Promise.resolve({
            succeeded: true,
            output: "done",
            errorClass: null,
            error: null,
            providerId: "prov-1",
            modelId: "m1",
            traceId: "trace-1",
            usage: { inputTokens: 1, outputTokens: 1, latencyMs: 5, amount: null, currency: null },
            cancelled: false,
          });
        },
      };
      const coordinator = coordinatorWith(repo, executor);
      seedJob(coordinator);

      const result = await coordinator.executeTask("job-1", "t1");
      assert.ok(result !== null, "the first attempt really ran");
      assert.equal(invocations, 1, "the port ran exactly once");

      // Read the key the coordinator actually used, from durable state.
      const row = onlyRow(repo);
      assert.equal(row.state, "succeeded", "the attempt is recorded as finished");

      // Same attempt, same key, again.
      const replay = coordinator.idempotency.begin(row.key, "t1");
      assert.equal(replay.ok, true);
      assert.equal(replay.ok === true ? replay.replayed : null, true, "a finished attempt replays");
      // Discriminated on `replayed`, not just `ok`: a replay always carries a record and a fresh
      // claim never does, so `.resultRef` without both checks is a null dereference.
      assert.ok(replay.ok === true && replay.replayed, "the replay must carry a record");
      assert.equal(replay.record.resultRef, onlyRow(repo).resultRef, "and it replays the durable reference");
      assert.equal(invocations, 1, "the replay did NOT run the work a second time");
      assert.equal(onlyRow(repo).replays, 1, "the replay is counted durably, not in a local counter");
    } finally {
      repo?.close();
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  /* ======================================================================== */
  /* 3. DIFFERENT ATTEMPT IS A RETRY, NOT A DUPLICATE                        */
  /* ======================================================================== */

  it("DIFFERENT ATTEMPT: a retry is a different key and is not blocked by the previous attempt", async () => {
    const file = dbFile("different-attempt");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      const ledger = coordinatorWith(repo).idempotency;

      // Attempt 1 begins and FAILS. Attempt 2 must be free to run.
      ledger.begin("attempt-1", "t1");
      ledger.complete("attempt-1", "failed", null);

      const retry = ledger.begin("attempt-2", "t1");
      assert.equal(retry.ok, true, "a retry is a different attempt, so it may execute again");
      assert.equal(retry.ok === true ? retry.replayed : null, false, "and it is not a replay of the first");

      const rows = repo.listIdempotent();
      assert.equal(rows.length, 2, "two attempts are two records; collapsing them would lose the retry");

      // Even while attempt 1 is still in flight, attempt 2 is unaffected: the refusal is scoped
      // to one key, not to the task.
      ledger.begin("attempt-3", "t1");
      const fourth = ledger.begin("attempt-4", "t1");
      assert.equal(fourth.ok, true, "an in-flight sibling attempt must not block a later one");
      assert.equal(repo.listIdempotent().length, 4);
    } finally {
      repo?.close();
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("ATTEMPT IDENTITY: the coordinator derives a DISTINCT durable key per attempt, from the real path", async () => {
    // The sibling test above uses hand-written keys, which proves the LEDGER keeps distinct keys
    // apart but says nothing about whether the COORDINATOR derives them distinctly. Only this one
    // goes through `executeTask`, so it is the only one that fails if the attempt is dropped from
    // the key derivation - which is the exact mutation that would let a retry replay a failure.
    const file = dbFile("attempt-identity");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      let invocations = 0;
      const executor: TaskExecutionPort = {
        execute: () => {
          invocations += 1;
          const succeeded = invocations > 1;
          return Promise.resolve({
            succeeded,
            output: succeeded ? "second try" : "first try failed",
            errorClass: succeeded ? null : ERROR_CLASSES[0],
            error: succeeded ? null : "boom",
            providerId: "prov-1",
            modelId: "m1",
            traceId: `trace-${invocations}`,
            usage: { inputTokens: 1, outputTokens: 1, latencyMs: 5, amount: null, currency: null },
            cancelled: false,
          });
        },
      };
      const coordinator = coordinatorWith(repo, executor);
      seedJob(coordinator);

      await coordinator.executeTask("job-1", "t1");
      await coordinator.executeTask("job-1", "t1");

      const rows = repo.listIdempotent();
      assert.equal(invocations, 2, "the task really ran twice");
      assert.equal(rows.length, 2, "two attempts must be two durable records, not one collapsed key");
      assert.notEqual(rows[0]?.key, rows[1]?.key, "the attempt is part of the derived key");
      assert.equal(rows[0]?.state, "failed", "attempt 1 is recorded as failed");
      assert.equal(rows[1]?.state, "succeeded", "and attempt 2 as succeeded - the retry was not blocked");
    } finally {
      repo?.close();
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  /* ======================================================================== */
  /* 5, 12. RESTART, AND WHAT RESTART MUST NOT INVENT                        */
  /* ======================================================================== */

  it("RESTART: an in_progress record survives close/reopen, still in_progress", () => {
    const file = dbFile("restart");
    let a: SqliteDurableStore | null = null;
    let b: SqliteDurableStore | null = null;
    try {
      a = SqliteDurableStore.open({ path: file, workspace: AC });
      coordinatorWith(a).idempotency.begin("k1", "t1");
      a.close();
      a = null;

      b = SqliteDurableStore.open({ path: file, workspace: AC });
      const row = onlyRow(b);
      assert.equal(row.state, "in_progress", "the attempt was still running when the process ended");
      assert.equal(row.outcome, null, "restart must NOT invent success");
      assert.equal(row.resultRef, null, "restart must NOT invent a result reference");

      // And the semantics are unchanged: a fresh coordinator still refuses the duplicate.
      const duplicate = coordinatorWith(b).idempotency.begin("k1", "t1");
      assert.equal(duplicate.ok, false, "the duplicate is still told to wait, across the restart");
      assert.equal(duplicate.ok === false ? duplicate.reason : null, "in_progress");
      assert.equal(coordinatorWith(b).idempotency.inFlightCount(), 1);
    } finally {
      a?.close();
      b?.close();
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("NO EXACTLY-ONCE CLAIM: the stated scope is durable-per-workspace, and still not exactly-once", () => {
    assert.equal(DELIVERY_SEMANTICS.scope, "durable-per-workspace");
    assert.equal(DELIVERY_SEMANTICS.claim, "effectively-once");
    // The label is the whole point. An unresolved attempt is reported as unresolved, which is
    // the condition an exactly-once claim would have to paper over.
    const file = dbFile("claim");
    let a: SqliteDurableStore | null = null;
    let b: SqliteDurableStore | null = null;
    try {
      a = SqliteDurableStore.open({ path: file, workspace: AC });
      coordinatorWith(a).idempotency.begin("k1", "t1");
      a.close();
      a = null;
      b = SqliteDurableStore.open({ path: file, workspace: AC });
      assert.equal(onlyRow(b).state, "in_progress", "an unresolved attempt stays unresolved after a restart");
    } finally {
      a?.close();
      b?.close();
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  /* ======================================================================== */
  /* 6. WORKSPACE ISOLATION                                                   */
  /* ======================================================================== */

  it("WORKSPACE: the same key in two workspaces does not collide", () => {
    const file = dbFile("workspace");
    let ac: SqliteDurableStore | null = null;
    let gb: SqliteDurableStore | null = null;
    let acAgain: SqliteDurableStore | null = null;
    try {
      // ONE database file, TWO scopes. Two files would prove nothing about isolation.
      ac = SqliteDurableStore.open({ path: file, workspace: AC });
      gb = SqliteDurableStore.open({ path: file, workspace: GB });

      ac.beginIdempotent("shared-key", "t1", NOW);
      const inGlobex = gb.beginIdempotent("shared-key", "t1", NOW);
      assert.equal(inGlobex.ok, true, "acme's in-flight claim must not refuse globex");
      assert.equal(inGlobex.ok === true ? inGlobex.replayed : null, false, "and globex is not replaying acme's work");

      assert.equal(ac.listIdempotent().length, 1);
      assert.equal(gb.listIdempotent().length, 1);
      assert.equal(gb.getIdempotent("shared-key")?.state, "in_progress", "globex has its own record");

      acAgain = SqliteDurableStore.open({ path: file, workspace: AC });
      assert.equal(acAgain.listIdempotent().length, 1, "reopening acme still sees only acme's record");
      assert.equal(acAgain.getIdempotent("shared-key")?.state, "in_progress");
    } finally {
      ac?.close();
      gb?.close();
      acAgain?.close();
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  /* ======================================================================== */
  /* 7. STALE CACHE                                                           */
  /* ======================================================================== */

  it("STALE CACHE: a populated mirror loses to durable state written by another process", () => {
    const file = dbFile("stale-cache");
    let mirrorSide: SqliteDurableStore | null = null;
    let otherProcess: SqliteDurableStore | null = null;
    try {
      mirrorSide = SqliteDurableStore.open({ path: file, workspace: AC });
      mirrorSide.beginIdempotent("k1", "t1", NOW);
      mirrorSide.completeIdempotent("k1", "succeeded", "exec-first", NOW);

      const ledger: IdempotencyLedger = coordinatorWith(mirrorSide).idempotency;
      assert.equal(ledger.get("k1")?.resultRef, "exec-first", "the mirror is now populated");

      // Another process finishes the same key differently. The mirror is NOT told.
      otherProcess = SqliteDurableStore.open({ path: file, workspace: AC });
      otherProcess.completeIdempotent("k1", "failed", "exec-other", NOW);

      const seen = ledger.get("k1");
      assert.ok(seen !== null);
      assert.equal(seen.outcome, "failed", "the repository wins over the value already cached");
      assert.equal(seen.resultRef, "exec-other");
    } finally {
      mirrorSide?.close();
      otherProcess?.close();
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  /* ======================================================================== */
  /* 9. ABANDON / FAILURE                                                     */
  /* ======================================================================== */

  it("ABANDON: an in_progress key is released and reusable, but a COMPLETED record is never deleted", () => {
    const file = dbFile("abandon");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      const ledger = coordinatorWith(repo).idempotency;

      ledger.begin("in-flight", "t1");
      assert.equal(ledger.abandon("in-flight"), true, "a key whose execution failed is freed");
      assert.equal(repo.getIdempotent("in-flight"), null, "and the durable row is gone");
      assert.equal(ledger.begin("in-flight", "t1").ok, true, "so the same key can be genuinely retried");

      // The guard that the Map version did not need: abandoning a FINISHED attempt would delete
      // the only record a later duplicate replays from, turning suppression into re-execution.
      ledger.complete("in-flight", "succeeded", "exec-done");
      assert.equal(ledger.abandon("in-flight"), false, "a completed record is not abandoned");
      assert.equal(repo.getIdempotent("in-flight")?.resultRef, "exec-done", "and the evidence survives");
      assert.equal(ledger.abandon("never-begun"), false, "nor is a key that was never begun");
    } finally {
      repo?.close();
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("FAILURE: a failed attempt is durable as `failed`, and replays as failed rather than re-running", () => {
    const file = dbFile("failure");
    let repo: SqliteDurableStore | null = null;
    try {
      repo = SqliteDurableStore.open({ path: file, workspace: AC });
      const ledger = coordinatorWith(repo).idempotency;
      ledger.begin("k1", "t1");
      ledger.complete("k1", "failed", null);

      assert.equal(onlyRow(repo).state, "failed");
      const replay = ledger.begin("k1", "t1");
      assert.equal(replay.ok === true ? replay.replayed : null, true);
      assert.equal(replay.ok === true && replay.replayed ? replay.record.outcome : null, "failed", "a failure is replayed as a failure");
    } finally {
      repo?.close();
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  /* ======================================================================== */
  /* 10. ATOMICITY                                                            */
  /* ======================================================================== */

  it("ATOMICITY: a refused completion leaves neither a durable nor an observed completion", () => {
    const file = dbFile("atomicity");
    let real: SqliteDurableStore | null = null;
    try {
      real = SqliteDurableStore.open({ path: file, workspace: AC });
      const ledger = coordinatorWith(real).idempotency;
      ledger.begin("k1", "t1");

      const broken = coordinatorWith(refusing(real, ["completeIdempotent"])).idempotency;
      assert.throws(() => broken.complete("k1", "succeeded", "exec-x"), /refused/, "the refusal reaches the caller");

      // The mirror must not have been updated, and durable state must still be in_progress.
      assert.equal(ledger.get("k1"), null, "an unfinished attempt has no record to observe");
      const row = onlyRow(real);
      assert.equal(row.state, "in_progress", "a refused write must not half-apply");
      assert.equal(row.resultRef, null);
      assert.equal(ledger.inFlightCount(), 1);
    } finally {
      real?.close();
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("ATOMICITY: a refused begin leaves no durable record, so nothing claims the key", () => {
    const file = dbFile("atomicity-begin");
    let real: SqliteDurableStore | null = null;
    try {
      real = SqliteDurableStore.open({ path: file, workspace: AC });
      const broken = coordinatorWith(refusing(real, ["beginIdempotent"])).idempotency;
      assert.throws(() => broken.begin("k1", "t1"), /refused/);
      assert.equal(real.listIdempotent().length, 0, "a refused begin created nothing to be confused for a claim");

      // And the key is still free, rather than stuck in a state only this process remembers.
      assert.equal(coordinatorWith(real).idempotency.begin("k1", "t1").ok, true);
    } finally {
      real?.close();
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});