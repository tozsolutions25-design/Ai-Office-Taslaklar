/**
 * PHASE 12 EVIDENCE - checkpoints and claims survive a REAL restart.
 *
 * ## WHAT "RESTART" MEANS HERE
 *
 * Not "clear the maps". Every case below builds lifecycle A, calls `close()`, and then builds
 * lifecycle B against the SAME database file. A store that merely forgot its in-memory state
 * would pass a map-clearing test; only a real close and reopen proves the rows are on disk.
 *
 * ## THE DEFECT THIS FILE EXISTS TO KEEP FIXED
 *
 * Checkpoint identity was `cp-${processCounter++}` and claim tokens were
 * `claim-${taskId}-${processCounter}`. Both restart at zero. The Phase 12 discovery probe measured
 * it: a fresh `CheckpointStore` wrote its first checkpoint as `cp-1` - the identity the
 * pre-restart store had already used.
 *
 * So the headline assertion below is not "the checkpoint is still there". It is that the
 * post-restart checkpoint has sequence 3 and a DIFFERENT id, which is the property that was
 * actually broken.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { SqliteDurableStore } from "../src/state/sqliteStore.js";
import { CheckpointStore } from "../src/orchestration/workflow/gates.js";
import { ClaimRegistry } from "../src/orchestration/workflow/claims.js";

const NOW = new Date("2026-04-01T00:00:00.000Z");
const AC = { workspace: "acme", brand: null };
const GB = { workspace: "globex", brand: null };

function dbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "toz-p12-restart-")), "state.db");
}

describe("PHASE 12 EVIDENCE - restart survival", () => {
  it("continues the checkpoint sequence across a restart and never reuses an id", () => {
    const file = dbPath();
    try {
      /* ---- lifecycle A ---- */
      const repoA = SqliteDurableStore.open({ path: file, workspace: AC });
      const clockA = new ManualClock(NOW);
      const cpA = new CheckpointStore({ clock: clockA, repository: repoA });
      const first = cpA.write({ jobId: "j1", taskId: "t1", executionId: "e1", progress: "1/3", dataRef: "s3://b/1", recoverable: true });
      const second = cpA.write({ jobId: "j1", taskId: "t1", executionId: "e1", progress: "2/3", dataRef: "s3://b/2", recoverable: true });
      assert.equal(first.sequence, 1);
      assert.equal(second.sequence, 2);
      repoA.close();

      /* ---- lifecycle B ---- */
      const repoB = SqliteDurableStore.open({ path: file, workspace: AC });
      const cpB = new CheckpointStore({ clock: new ManualClock(NOW), repository: repoB });
      const third = cpB.write({ jobId: "j1", taskId: "t1", executionId: "e2", progress: "3/3", dataRef: "s3://b/3", recoverable: true });

      // The sequence continues from durable state. It does NOT restart at 1.
      assert.equal(third.sequence, 3, "the post-restart checkpoint continues the sequence, which is what the counter could not do");

      // The identity is derived, so it cannot repeat. This is the assertion the old
      // `cp-${counter}` implementation would have failed: it would have produced "cp-1".
      assert.notEqual(third.checkpointId, first.checkpointId, "the new checkpoint must not reuse the first identity");
      assert.notEqual(third.checkpointId, second.checkpointId);
      assert.match(third.checkpointId, /^cp_[0-9a-z]{20}$/, "and it is the derived form, not a bare counter");

      assert.equal(cpB.latest("j1", "t1")?.checkpointId, third.checkpointId, "latest is the post-restart one");
      assert.equal(cpB.count("j1", "t1"), 3, "all three are readable");
      assert.equal(cpB.recoveryPlan("j1", "t1").action, "resume", "and recovery still reads a real checkpoint");
      repoB.close();
    } finally {
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("keeps one workspace's checkpoints invisible to another, in BOTH directions", () => {
    const file = dbPath();
    try {
      const repoA = SqliteDurableStore.open({ path: file, workspace: AC });
      new CheckpointStore({ clock: new ManualClock(NOW), repository: repoA }).write({
        jobId: "j1", taskId: "t1", executionId: "e1", progress: "1/1", dataRef: "s3://acme/secret",
      recoverable: true,
      });
      repoA.close();

      // globex opens the SAME file - a real second workspace, not a second database.
      const repoG = SqliteDurableStore.open({ path: file, workspace: GB });
      const cpG = new CheckpointStore({ clock: new ManualClock(NOW), repository: repoG });

      assert.equal(cpG.count("j1", "t1"), 0, "globex sees no checkpoints at all");
      assert.equal(cpG.latest("j1", "t1"), null, "and no latest");
      assert.equal(cpG.recoveryPlan("j1", "t1").action, "no_checkpoint", "so recovery must not offer to resume from another workspace's data");

      // And globex writing its own does not disturb acme's.
      cpG.write({ jobId: "j1", taskId: "t1", executionId: "eG", progress: "9/9", dataRef: "s3://globex/mine", recoverable: true });
      assert.equal(cpG.latest("j1", "t1")?.progress, "9/9", "globex has its own");
      repoG.close();

      const repoA2 = SqliteDurableStore.open({ path: file, workspace: AC });
      const cpA2 = new CheckpointStore({ clock: new ManualClock(NOW), repository: repoA2 });
      assert.equal(cpA2.latest("j1", "t1")?.progress, "1/1", "acme's own checkpoint is untouched by globex's write");
      assert.equal(cpA2.count("j1", "t1"), 1, "and there is still exactly one of it");
      repoA2.close();
    } finally {
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("preserves the existing validation, and does not weaken it during the migration", () => {
    const repo = SqliteDurableStore.open({ path: dbPath(), workspace: AC });
    const cp = new CheckpointStore({ clock: new ManualClock(NOW), repository: repo });
    try {
      assert.throws(
        () => cp.write({ jobId: "j1", taskId: "t1", executionId: "e1", progress: "1/1", dataRef: "   ", recoverable: true }),
        /dataRef is required/,
        "an empty dataRef still points at nothing",
      );
      assert.throws(
        () => cp.write({ jobId: "j1", taskId: "t1", executionId: "e1", progress: "1/1", dataRef: "s3://x", recoverable: false }),
        /must say why/,
        "a non-recoverable checkpoint still has to state its reason",
      );
      assert.equal(cp.count("j1", "t1"), 0, "and neither refusal left a row behind");
    } finally {
      repo.close();
    }
  });
});

describe("PHASE 12 EVIDENCE - claim lifecycle across a restart", () => {
  it("uses ONE parameter order, and the order is the majority one", () => {
    // `claim` used to be (taskId, jobId, workerId) while every other method was
    // (jobId, taskId, ...). Both orders are two strings, so a wrapper could not detect the
    // mistake - which is why there is no wrapper. The test pins the canonical order by using
    // only it, in a registry that reads back through `current` and `verify`.
    const repo = SqliteDurableStore.open({ path: dbPath(), workspace: AC });
    const registry = new ClaimRegistry({ clock: new ManualClock(NOW), repository: repo, workspace: AC });
    try {
      const claimed = registry.claim("j1", "t1", "worker-1");
      assert.equal(claimed.ok, true);
      assert.equal(claimed.ok && claimed.claim.jobId, "j1", "the first argument is the job");
      assert.equal(claimed.ok && claimed.claim.taskId, "t1", "the second is the task");
      // Read back through the OTHER methods, which have always taken (jobId, taskId).
      assert.equal(registry.current("j1", "t1")?.workerId, "worker-1", "and it is findable with the same order the reader uses");
      assert.equal(registry.verify("j1", "t1", claimed.ok ? claimed.claim.token : "").valid, true);
    } finally {
      repo.close();
    }
  });

  it("survives a restart with identity and expiry intact", () => {
    const file = dbPath();
    try {
      const repoA = SqliteDurableStore.open({ path: file, workspace: AC });
      const clockA = new ManualClock(NOW);
      const regA = new ClaimRegistry({ clock: clockA, repository: repoA, workspace: AC });
      const claimed = regA.claim("j1", "t1", "worker-7", { ttlMs: 30_000 });
      assert.equal(claimed.ok, true);
      repoA.close();

      // A NEW lifecycle. The claim was never released; the process simply ended.
      const repoB = SqliteDurableStore.open({ path: file, workspace: AC });
      const regB = new ClaimRegistry({ clock: new ManualClock(NOW), repository: repoB, workspace: AC });
      const current = regB.current("j1", "t1");
      assert.ok(current !== null, "the claim is still there after the restart");
      assert.equal(current.workerId, "worker-7", "with its worker");
      assert.equal(current.jobId, "j1", "its job");
      assert.equal(current.taskId, "t1", "and its task");
      assert.equal(current.expiresAt, claimed.ok ? claimed.claim.expiresAt : 0, "and its expiry, which is what makes it a lease rather than a flag");

      // A live claim must not be silently stealable.
      const stolen = regB.claim("j1", "t1", "worker-9");
      assert.equal(stolen.ok, false, "a live claim refuses a second worker");
      repoB.close();
    } finally {
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("detects an expired claim after a restart, releases it durably, and lets the task be reclaimed", () => {
    const file = dbPath();
    try {
      const repoA = SqliteDurableStore.open({ path: file, workspace: AC });
      const regA = new ClaimRegistry({ clock: new ManualClock(NOW), repository: repoA, workspace: AC });
      const claimed = regA.claim("j1", "t1", "worker-7", { ttlMs: 1_000 });
      assert.equal(claimed.ok, true);
      repoA.close();

      // A later process, past the lease.
      const repoB = SqliteDurableStore.open({ path: file, workspace: AC });
      const regB = new ClaimRegistry({ clock: new ManualClock(new Date(NOW.getTime() + 60_000)), repository: repoB, workspace: AC });

      assert.equal(regB.current("j1", "t1"), null, "an expired claim reads as no claim at all");
      // The release is PERSISTED, not just forgotten: a third lifecycle must see it gone.
      assert.equal(repoB.getClaim("j1", "t1"), null, "the durable row was released, so the next process starts clean");

      const re = regB.claim("j1", "t1", "worker-9");
      assert.equal(re.ok, true, "and the task is claimable again - which is the whole point of an expiry");
      assert.equal(re.ok && re.claim.workerId, "worker-9");
      repoB.close();
    } finally {
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("mints a different token after a restart, so a stale worker cannot pass verify", () => {
    const file = dbPath();
    try {
      const repoA = SqliteDurableStore.open({ path: file, workspace: AC });
      const regA = new ClaimRegistry({ clock: new ManualClock(NOW), repository: repoA, workspace: AC });
      const first = regA.claim("j1", "t1", "worker-7");
      repoA.close();
      // Release durably, so the second claim is a genuinely new one.
      const repoB = SqliteDurableStore.open({ path: file, workspace: AC });
      const regB = new ClaimRegistry({ clock: new ManualClock(NOW), repository: repoB, workspace: AC });
      regB.release("j1", "t1", first.ok ? first.claim.token : "");
      const second = regB.claim("j1", "t1", "worker-7");
      assert.equal(second.ok, true);
      assert.notEqual(
        second.ok ? second.claim.token : "",
        first.ok ? first.claim.token : "",
        "a counter-based token would repeat here, and verify() would then accept the stale one",
      );
      assert.equal(
        regB.verify("j1", "t1", first.ok ? first.claim.token : "").valid,
        false,
        "the old token is refused, which is the stale-result guard doing its job across a restart",
      );
      repoB.close();
    } finally {
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("keeps one workspace's claims invisible to the other, in both directions", () => {
    const file = dbPath();
    try {
      const repoA = SqliteDurableStore.open({ path: file, workspace: AC });
      new ClaimRegistry({ clock: new ManualClock(NOW), repository: repoA, workspace: AC }).claim("j1", "t1", "worker-acme");
      repoA.close();

      const repoG = SqliteDurableStore.open({ path: file, workspace: GB });
      const regG = new ClaimRegistry({ clock: new ManualClock(NOW), repository: repoG, workspace: GB });
      assert.equal(regG.current("j1", "t1"), null, "globex does not see acme's claim");
      const g = regG.claim("j1", "t1", "worker-globex");
      assert.equal(g.ok, true, "so globex may claim the same task id - the isolation is a partition, not a lock");
      repoG.close();

      const repoA2 = SqliteDurableStore.open({ path: file, workspace: AC });
      const regA2 = new ClaimRegistry({ clock: new ManualClock(NOW), repository: repoA2, workspace: AC });
      assert.equal(regA2.current("j1", "t1")?.workerId, "worker-acme", "acme still holds its own claim");
      repoA2.close();
    } finally {
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});