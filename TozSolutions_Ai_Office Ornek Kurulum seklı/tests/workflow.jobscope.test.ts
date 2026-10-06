/**
 * PHASE 10: job-scoped identity.
 *
 * WHY THIS FILE EXISTS
 *
 * Every job-scoped store in PHASE 07 was keyed by `taskId` ALONE. A `taskId` is
 * unique only WITHIN a job, so two jobs containing a task called "step-1" - an
 * entirely ordinary thing to write - collided. Last write won.
 *
 * Most of that is data corruption. One of it was a security hole, and it was
 * found by probing rather than reading, so it is worth stating precisely:
 *
 *   `ApprovalRegistry` kept one gate per taskId. Approving job A's task released
 *   job B's identically-named task while job B's own gate sat un-approved.
 *
 * It failed OPEN when the approved job's gate survived the last write, and failed
 * CLOSED in the opposite order. Both were verified against the pre-fix build, and
 * both are asserted against below.
 *
 * These tests are written to fail on the old code. That is their only job.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ExecutionCoordinator, type TaskExecutionPort, type TaskExecutionOutcome } from "../src/orchestration/workflow/coordinator.js";
import { ApprovalRegistry, CheckpointStore } from "../src/orchestration/workflow/gates.js";
import { ClaimRegistry } from "../src/orchestration/workflow/claims.js";
import { task, type WorkflowTask } from "../src/orchestration/workflow/model.js";
import { ManualClock } from "../src/core/clock.js";
import { InMemoryDurableStore } from "../src/state/inMemoryStore.js";
import { scopeOf } from "../src/state/durable.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");



const okPort: TaskExecutionPort = {
  execute(): Promise<TaskExecutionOutcome> {
    return Promise.resolve({
      succeeded: true,
      output: "ran",
      errorClass: null,
      error: null,
      providerId: null,
      modelId: null,
      traceId: null,
      usage: { inputTokens: 1, outputTokens: 1, latencyMs: 1, amount: 1, currency: "USD" },
      cancelled: false,
    });
  },
};

function wfTask(jobId: string, taskId: string): WorkflowTask {
  return {
    taskId,
    jobId,
    objective: "part",
    input: "in",
    requiredCapabilities: [],
    minimumTrust: "standard",
    dependsOn: [],
    approvalRequired: false,
    limits: { timeoutMs: 1_000, maxAttempts: 1, queueTimeoutMs: null },
    checkpointable: false,
    verificationKinds: [],
    priority: "normal",
  };
}

describe("PHASE 10: an approval in one job cannot release another job's task", () => {
  const build = (openOrder: readonly string[]) => {
    const c = new ExecutionCoordinator({ executor: okPort });
    for (const jobId of ["A", "B"]) {
      c.createJob({ jobId, workflow: { workflowId: `w${jobId}`, name: "w", root: task("shared", wfTask(jobId, "shared")) } });
    }
    const gates: Record<string, { gateId: string }> = {};
    for (const jobId of openOrder) {
      gates[jobId] = c.openApproval({ jobId, taskId: "shared", question: `approve ${jobId}` });
    }
    // Only A is ever approved. Nobody approves B.
    c.decideApproval({ gateId: gates["A"]?.gateId ?? "", decision: "approved", decidedBy: "human:ana" });
    return c;
  };

  for (const order of [["B", "A"], ["A", "B"]] as const) {
    it(`refuses the un-approved job regardless of gate open order (${order.join(",")})`, () => {
      const c = build(order);

      const planA = c.planRelease("A");
      const planB = c.planRelease("B");

      assert.equal(planA.released.length, 1, "the job that WAS approved must run");
      assert.deepEqual(planB.released, [], "the job nobody approved must not run, whatever the open order");
    });
  }

  it("keeps the two gates distinct objects", () => {
    const gates = new ApprovalRegistry({ clock: new ManualClock(NOW) });
    const a = gates.open({ jobId: "A", taskId: "shared", question: "approve A?", intent: wfTask("A", "shared") });
    const b = gates.open({ jobId: "B", taskId: "shared", question: "approve B?", intent: wfTask("B", "shared") });

    assert.notEqual(a.gateId, b.gateId, "two jobs get two gates");
    assert.equal(gates.forTask("A", "shared")?.gateId, a.gateId, "A's task resolves to A's gate");
    assert.equal(gates.forTask("B", "shared")?.gateId, b.gateId, "B's task resolves to B's gate");

    gates.decide({ gateId: a.gateId, decision: "approved", decidedBy: "human:ana" });
    // PHASE 01 (C-3): `mayRelease` now takes whether approval is required. Both
    // tasks here have a gate, so `true` preserves exactly what was being tested -
    // that the gates are job-scoped.
    assert.equal(gates.mayRelease("A", "shared", true, wfTask("A", "shared")).allowed, true, "A is approved");
    assert.equal(gates.mayRelease("B", "shared", true, wfTask("B", "shared")).allowed, false, "B was never approved, so B is still blocked");
  });
});

describe("PHASE 10: execution records are job-scoped", () => {
  it("does not merge attempt history across jobs with the same task id", async () => {
    const c = new ExecutionCoordinator({ executor: okPort });
    c.createJob({ jobId: "A", workflow: { workflowId: "wA", name: "w", root: task("shared", wfTask("A", "shared")) } });
    c.createJob({ jobId: "B", workflow: { workflowId: "wB", name: "w", root: task("shared", wfTask("B", "shared")) } });

    await c.executeTask("A", "shared");
    await c.executeTask("B", "shared");

    assert.equal(c.attemptsOf("A", "shared").length, 1, "job A recorded one attempt");
    assert.equal(c.attemptsOf("B", "shared").length, 1, "job B recorded one attempt, not A's");
  });

  it("gives each job a distinct execution id", async () => {
    const c = new ExecutionCoordinator({ executor: okPort });
    c.createJob({ jobId: "A", workflow: { workflowId: "wA", name: "w", root: task("shared", wfTask("A", "shared")) } });
    c.createJob({ jobId: "B", workflow: { workflowId: "wB", name: "w", root: task("shared", wfTask("B", "shared")) } });

    await c.executeTask("A", "shared");
    await c.executeTask("B", "shared");

    const a = c.executionOf("A", "shared");
    const b = c.executionOf("B", "shared");
    assert.notEqual(a?.executionId, b?.executionId, "two jobs' executions cannot share an id");
    assert.equal(a?.jobId, "A");
    assert.equal(b?.jobId, "B");
  });

  it("resolves a result to the job that produced it", async () => {
    let n = 0;
    const port: TaskExecutionPort = {
      execute(): Promise<TaskExecutionOutcome> {
        n += 1;
        return Promise.resolve({
          succeeded: true, output: `output-${n}`, errorClass: null, error: null,
          providerId: null, modelId: null, traceId: null,
          usage: { inputTokens: 1, outputTokens: 1, latencyMs: 1, amount: 1, currency: "USD" },
          cancelled: false,
        });
      },
    };
    const c = new ExecutionCoordinator({ executor: port });
    c.createJob({ jobId: "A", workflow: { workflowId: "wA", name: "w", root: task("shared", wfTask("A", "shared")) } });
    c.createJob({ jobId: "B", workflow: { workflowId: "wB", name: "w", root: task("shared", wfTask("B", "shared")) } });

    await c.executeTask("A", "shared");
    await c.executeTask("B", "shared");

    assert.equal(c.resultOf("A", "shared")?.output, "output-1", "job A keeps its own result");
    assert.equal(c.resultOf("B", "shared")?.output, "output-2", "job B keeps its own result");
  });
});

describe("PHASE 10: claims and checkpoints are job-scoped", () => {
  it("does not let one job's claim refuse another job's claim", () => {
    const registry = new ClaimRegistry({ clock: new ManualClock(NOW) });
    const a = registry.claim("A", "shared", "worker-a");
    const b = registry.claim("B", "shared", "worker-b");

    assert.equal(a.ok, true, "job A's task is claimable");
    assert.equal(b.ok, true, "job B's identically-named task is independently claimable");
    assert.equal(registry.current("A", "shared")?.workerId, "worker-a");
    assert.equal(registry.current("B", "shared")?.workerId, "worker-b");
  });

  it("cancels only the cancelled job's claims", () => {
    const registry = new ClaimRegistry({ clock: new ManualClock(NOW) });
    registry.claim("A", "t1", "worker-a");
    registry.claim("B", "t1", "worker-b");

    registry.releaseJob("A");

    assert.equal(registry.current("A", "t1"), null, "A's claim was released");
    assert.notEqual(registry.current("B", "t1"), null, "B's claim is untouched by A's cancellation");
  });

  it("does not interleave checkpoints from two jobs", () => {
    const store = new CheckpointStore({ clock: new ManualClock(NOW), repository: durableStore(null) });
    store.write({ jobId: "A", taskId: "t1", executionId: "e1", progress: "1/2", dataRef: "s3://a", recoverable: true });
    store.write({ jobId: "B", taskId: "t1", executionId: "e2", progress: "1/9", dataRef: "s3://b", recoverable: true });

    assert.equal(store.count("A", "t1"), 1, "job A has one checkpoint");
    assert.equal(store.count("B", "t1"), 1, "job B has one, not two");
    assert.equal(store.latest("B", "t1")?.dataRef, "s3://b", "job B resumes from its own data");
  });
});


/**
 * PHASE 12: the repository a `CheckpointStore`/`ClaimRegistry` is built over.
 *
 * Each call makes an INDEPENDENT store. That is the point: the pre-Phase-12 tests proved
 * workspace isolation by giving two stores two `workspace` options, and a store that carries
 * its partition inside the repository can be isolated the same way - if two stores pointed at
 * one repository they would share it, and the test would prove nothing.
 */
function durableStore(workspace: { workspace: string; brand: string | null } | null): InMemoryDurableStore {
  return new InMemoryDurableStore({ scope: scopeOf(workspace) });
}
