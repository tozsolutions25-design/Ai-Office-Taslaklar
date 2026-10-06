/**
 * PHASE 07: the execution domain, dependencies, claims and idempotency.
 *
 * Areas covered here: A (job), B (task), C (workflow composition), D
 * (dependencies), AD (invalid transitions).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import {
  ApprovalError,
  ApprovalRegistry,
  CheckpointError,
  CheckpointStore,
  ClaimRegistry,
  DELIVERY_SEMANTICS,
  ExecutionCoordinator,
  IdempotencyLedger,
  JOB_STATES,
  JobStateError,
  approval,
  canTransitionJob,
  conditional,
  evaluateDependencies,
  flattenWorkflow,
  handoff,
  isTerminalJobState,
  parallel,
  readyTasks,
  retry,
  sequential,
  stepIdsOf,
  task as makeTask,
  unreachableTasks,
  verification,
  wait,
  workflow,
  type TaskExecutionPort,
  type TaskExecutionOutcome,
  type TaskRecord,
  type WorkflowTask,
} from "../src/orchestration/workflow/index.js";
import { InMemoryDurableStore } from "../src/state/inMemoryStore.js";
import { scopeOf } from "../src/state/durable.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** Succeeds unless the task id is named in `failWith`. */
function executor(failWith: Record<string, string> = {}): TaskExecutionPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    execute(request): Promise<TaskExecutionOutcome> {
      calls.push(request.taskId);
      const failure = failWith[request.taskId];
      if (failure !== undefined) {
        return Promise.resolve({
          succeeded: false,
          output: "",
          errorClass: "transient_provider_failure",
          error: failure,
          providerId: null,
          modelId: null,
          traceId: null,
          usage: null,
          cancelled: false,
        });
      }
      return Promise.resolve({
        succeeded: true,
        output: `did ${request.taskId}`,
        errorClass: null,
        error: null,
        providerId: "acme",
        modelId: "m1",
        traceId: "trace-1",
        usage: { inputTokens: 10, outputTokens: 5, latencyMs: 100, amount: 0.01, currency: "USD" },
        cancelled: false,
      });
    },
  };
}

function definition(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    taskId: "t1",
    jobId: "job-1",
    objective: "Do the thing",
    input: "in",
    requiredCapabilities: ["text_generation"],
    minimumTrust: "low",
    dependsOn: [],
    approvalRequired: false,
    limits: { timeoutMs: 1_000, maxAttempts: 1, queueTimeoutMs: null },
    checkpointable: false,
    priority: "normal",
    ...overrides,
  };
}

function coordinator(overrides: { failWith?: Record<string, string>; maxConcurrency?: number; backoffBaseMs?: number } = {}): {
  coordinator: ExecutionCoordinator;
  calls: string[];
  clock: ManualClock;
} {
  const clock = new ManualClock(NOW);
  const port = executor(overrides.failWith ?? {});
  return {
    coordinator: new ExecutionCoordinator({
      executor: port,
      clock,
      maxConcurrency: overrides.maxConcurrency ?? 4,
      backoffBaseMs: overrides.backoffBaseMs ?? 100,
    }),
    calls: port.calls,
    clock,
  };
}

function recordOf(task: WorkflowTask, state: TaskRecord["state"], dependsOn: readonly string[] = []): TaskRecord {
  return {
    task: { ...task, dependsOn },
    state,
    attempts: 0,
    executionId: null,
    claimToken: null,
    startedAt: null,
    finishedAt: null,
    resultRef: null,
    failure: null,
    latestCheckpoint: null,
    approval: null,
  };
}

function recordsOf(entries: readonly TaskRecord[]): Map<string, TaskRecord> {
  return new Map(entries.map((entry) => [entry.task.taskId, entry]));
}

/* -------------------------------------------------------------------------- */

describe("PHASE 07 A/B - job and task creation", () => {
  it("creates a job with a traceable identity", () => {
    const { coordinator: engine } = coordinator();
    const created = engine.createJob({
      jobId: "job-1",
      workflow: workflow("wf-1", "Simple", makeTask("s1", definition())),
      owner: "team-a",
      correlationId: "corr-1",
    });
    assert.equal(created.ok, true);
    const job = engine.job("job-1");
    assert.equal(job?.state, "queued");
    assert.equal(job?.workflowId, "wf-1");
    assert.equal(job?.owner, "team-a");
    assert.equal(job?.correlationId, "corr-1");
    assert.ok((job?.createdAt ?? 0) > 0, "a durable record is timestamped");
    assert.equal(job?.cancellation, null);
  });

  it("refuses a duplicate job id", () => {
    const { coordinator: engine } = coordinator();
    const wf = workflow("wf-1", "Simple", makeTask("s1", definition()));
    assert.equal(engine.createJob({ jobId: "job-1", workflow: wf }).ok, true);
    const second = engine.createJob({ jobId: "job-1", workflow: wf });
    assert.equal(second.ok, false, "two records for one job id would make every lookup ambiguous");
  });

  it("refuses a workflow with no executable task", () => {
    const { coordinator: engine } = coordinator();
    const created = engine.createJob({ jobId: "job-1", workflow: workflow("wf", "Empty", wait("s1", "external")) });
    assert.equal(created.ok, false);
  });

  it("refuses a repeated task id", () => {
    const { coordinator: engine } = coordinator();
    const created = engine.createJob({
      jobId: "job-1",
      workflow: workflow("wf", "Dupes", sequential("s1", [makeTask("t1", definition()), makeTask("t1", definition())])),
    });
    assert.equal(created.ok, false);
  });

  it("refuses a dependency the workflow does not contain", () => {
    // A missing prerequisite is a configuration fault, caught when the job is
    // built rather than discovered when a task mysteriously never runs.
    const { coordinator: engine } = coordinator();
    const created = engine.createJob({
      jobId: "job-1",
      workflow: workflow("wf", "Bad dep", makeTask("t1", definition({ dependsOn: ["ghost"] }))),
    });
    assert.equal(created.ok, false);
    assert.equal(created.error?.message.includes("ghost"), true);
  });

  it("applies the coordinator defaults to a task that states none", () => {
    const { coordinator: engine } = coordinator();
    engine.createJob({
      jobId: "job-1",
      workflow: workflow("wf", "Defaults", makeTask("t1", definition({ limits: { timeoutMs: null, maxAttempts: 0, queueTimeoutMs: null } }))),
    });
    const record = engine.task("job-1", "t1");
    assert.equal(record?.task.limits.maxAttempts, 3, "a stated 0 would be a task that may never be attempted");
    assert.equal(record?.task.limits.timeoutMs, 60_000);
  });

  it("does not let a task name a provider or a model", () => {
    // The guarantee is structural: there is no field on a task a provider could
    // be smuggled through.
    const record = definition();
    assert.equal(Object.hasOwn(record, "providerId"), false);
    assert.equal(Object.hasOwn(record, "modelId"), false);
    assert.equal(Object.hasOwn(record, "provider"), false);
  });
});

describe("PHASE 07 C - workflow composition", () => {
  it("composes sequentially and preserves order", () => {
    const composed = sequential("root", [
      makeTask("a", definition({ taskId: "a" })),
      makeTask("b", definition({ taskId: "b" })),
    ]);
    assert.deepEqual(
      flattenWorkflow(composed).map((step) => step.task.taskId),
      ["a", "b"],
    );
  });

  it("composes in parallel and keeps declaration order", () => {
    const composed = parallel("root", [
      makeTask("a", definition({ taskId: "a" })),
      makeTask("b", definition({ taskId: "b" })),
    ]);
    assert.equal(composed.maxConcurrency, 2);
    assert.deepEqual(
      flattenWorkflow(composed).map((step) => step.task.taskId),
      ["a", "b"],
      "the plan is reproducible, so it cannot depend on scheduling luck",
    );
  });

  it("refuses a parallel group that could run nothing", () => {
    assert.throws(
      () => parallel("root", [makeTask("a", definition())], { maxConcurrency: 0 }),
      /at least 1/,
      "a group that can run nothing deadlocks rather than failing",
    );
  });

  it("flattens both branches of a conditional", () => {
    const composed = conditional("root", "outcome == pass", [makeTask("yes", definition({ taskId: "yes" }))], [
      makeTask("no", definition({ taskId: "no" })),
    ]);
    assert.deepEqual(
      flattenWorkflow(composed).map((step) => step.task.taskId),
      ["yes", "no"],
      "the plan must contain both branches, because which one runs is a runtime decision",
    );
  });

  it("supports wait, retry, approval, verification and handoff primitives", () => {
    const composed = sequential("root", [
      approval("needs-ok", definition({ taskId: "gate", approvalRequired: true }), "Proceed?"),
      retry("try", makeTask("work", definition({ taskId: "work" })), { maxAttempts: 3 }),
      verification("verify", ["work"]),
      handoff("next", makeTask("after", definition({ taskId: "after" }))),
    ]);
    const ids = stepIdsOf(composed);
    for (const expected of ["needs-ok", "try", "verify", "next", "after"]) {
      assert.ok(ids.includes(expected), `${expected} must appear in the composed plan`);
    }
    assert.deepEqual(
      flattenWorkflow(composed).map((step) => step.task.taskId),
      ["gate", "work", "after"],
    );
  });

  it("refuses a retry step that allows no attempts", () => {
    assert.throws(() => retry("r", makeTask("a", definition()), { maxAttempts: 0 }), /at least 1/);
  });

  it("produces the same plan twice", () => {
    const composed = parallel("root", [
      makeTask("a", definition({ taskId: "a" })),
      makeTask("b", definition({ taskId: "b" })),
      makeTask("c", definition({ taskId: "c" })),
    ]);
    assert.deepEqual(
      flattenWorkflow(composed).map((s) => s.task.taskId),
      flattenWorkflow(composed).map((s) => s.task.taskId),
    );
  });
});

describe("PHASE 07 D - dependencies", () => {
  it("lets a task with no dependencies run", () => {
    const verdict = evaluateDependencies(definition({ taskId: "t1" }), new Map());
    assert.equal(verdict.mayRun, true);
  });

  it("waits for an incomplete dependency", () => {
    const records = recordsOf([recordOf(definition({ taskId: "a" }), "running")]);
    const verdict = evaluateDependencies(definition({ taskId: "b", dependsOn: ["a"] }), records);
    assert.equal(verdict.mayRun, false);
    assert.equal(verdict.permanentlyBlocked, false);
    assert.equal(verdict.statuses[0]?.condition, "waiting");
  });

  it("releases a task once its dependency completed", () => {
    const records = recordsOf([recordOf(definition({ taskId: "a" }), "completed")]);
    const verdict = evaluateDependencies(definition({ taskId: "b", dependsOn: ["a"] }), records);
    assert.equal(verdict.mayRun, true);
  });

  it("blocks permanently on a failed dependency", () => {
    const records = recordsOf([recordOf(definition({ taskId: "a" }), "failed")]);
    const verdict = evaluateDependencies(definition({ taskId: "b", dependsOn: ["a"] }), records);
    assert.equal(verdict.mayRun, false);
    assert.equal(verdict.permanentlyBlocked, true, "waiting cannot help, so the job must terminate rather than hang");
    assert.equal(verdict.statuses[0]?.condition, "failed");
  });

  it("distinguishes cancelled from failed", () => {
    const records = recordsOf([recordOf(definition({ taskId: "a" }), "cancelled")]);
    const verdict = evaluateDependencies(definition({ taskId: "b", dependsOn: ["a"] }), records);
    assert.equal(verdict.statuses[0]?.condition, "cancelled");
    assert.equal(verdict.permanentlyBlocked, true);
  });

  it("treats a skipped dependency as unavailable, never as satisfied", () => {
    // The subtle one. Treating "skipped" as satisfied would let a downstream
    // task run on work that was never done.
    const records = recordsOf([recordOf(definition({ taskId: "a" }), "skipped")]);
    const verdict = evaluateDependencies(definition({ taskId: "b", dependsOn: ["a"] }), records);
    assert.equal(verdict.mayRun, false);
    assert.equal(verdict.statuses[0]?.condition, "unavailable");
  });

  it("treats a missing dependency as unavailable, never as satisfied", () => {
    const verdict = evaluateDependencies(definition({ taskId: "b", dependsOn: ["ghost"] }), new Map());
    assert.equal(verdict.mayRun, false);
    assert.equal(verdict.statuses[0]?.condition, "unavailable");
    assert.match(verdict.statuses[0]?.detail ?? "", /never treated as satisfied/);
  });

  it("reports only runnable tasks as ready", () => {
    const records = [
      recordOf(definition({ taskId: "a" }), "completed"),
      recordOf(definition({ taskId: "b" }), "pending", ["a"]),
      recordOf(definition({ taskId: "c" }), "pending", ["b"]),
    ];
    assert.deepEqual(
      readyTasks(records).map((entry) => entry.task.taskId),
      ["b"],
    );
  });

  it("finds unreachable tasks transitively", () => {
    const records = [
      recordOf(definition({ taskId: "a" }), "failed"),
      recordOf(definition({ taskId: "b" }), "pending", ["a"]),
      recordOf(definition({ taskId: "c" }), "pending", ["b"]),
      recordOf(definition({ taskId: "d" }), "pending", ["c"]),
    ];
    assert.deepEqual(unreachableTasks(records), ["b", "c", "d"], "a five-task chain behind one failure skips all five");
  });
});

describe("PHASE 07 AD - state transitions are validated", () => {
  it("defines the full job lifecycle", () => {
    assert.deepEqual(
      [...JOB_STATES].sort(),
      ["cancelled", "completed", "failed", "paused", "queued", "retrying", "running", "waiting"],
    );
  });

  it("permits the documented happy path", () => {
    assert.equal(canTransitionJob("queued", "running"), true);
    assert.equal(canTransitionJob("running", "waiting"), true);
    assert.equal(canTransitionJob("waiting", "running"), true);
    assert.equal(canTransitionJob("running", "retrying"), true);
    assert.equal(canTransitionJob("retrying", "running"), true);
    assert.equal(canTransitionJob("running", "completed"), true);
  });

  it("refuses an illegal transition", () => {
    assert.equal(canTransitionJob("completed", "running"), false);
    assert.equal(canTransitionJob("queued", "completed"), false, "a job cannot skip straight to done");
  });

  it("treats every terminal state as having no way out", () => {
    for (const state of ["completed", "failed", "cancelled"] as const) {
      assert.equal(isTerminalJobState(state), true);
      for (const to of JOB_STATES) {
        assert.equal(
          canTransitionJob(state, to),
          false,
          `"${state}" must have no edge to "${to}" - this is the whole stale-result defence`,
        );
      }
    }
  });

  it("lets a pause be lifted, because a pause nobody can lift is a deadlock", () => {
    assert.equal(canTransitionJob("paused", "running"), true);
    assert.equal(canTransitionJob("paused", "cancelled"), true);
  });

  it("refuses to revive a cancelled job through the coordinator", () => {
    const { coordinator: engine } = coordinator();
    engine.createJob({ jobId: "job-1", workflow: workflow("wf", "One", makeTask("t1", definition())) });
    engine.cancelJob("job-1", "operator changed their mind");
    assert.equal(engine.job("job-1")?.state, "cancelled");
    const second = engine.cancelJob("job-1", "again");
    assert.equal(second.ok, false);
    assert.match(second.detail, /already cancelled/);
  });

  it("names a refused transition so the refusal is diagnosable", () => {
    const error = new JobStateError("job-1", "cancelled", "running");
    assert.match(error.message, /terminal/);
    assert.equal(error.from, "cancelled");
    assert.equal(error.to, "running");
  });

  it("refuses to move a cancelled job, and says a terminal job cannot be revived", () => {
    // The property that matters: a cancelled job is not merely protected from
    // moving, it has no legal edge to move along. `settle` on a cancelled job is
    // a no-op that reports the state rather than attempting anything.
    const { coordinator: engine } = coordinator();
    engine.createJob({ jobId: "job-1", workflow: workflow("wf", "One", makeTask("t1", definition())) });
    engine.cancelJob("job-1", "done");
    const before = engine.transitionsOf("job-1").length;

    const settled = engine.settle("job-1");
    assert.equal(settled.state, "cancelled");
    assert.equal(engine.job("job-1")?.state, "cancelled", "the state is unchanged");
    assert.equal(
      engine.transitionsOf("job-1").length,
      before,
      "no transition is even attempted, so there is nothing to record or refuse",
    );
  });

  it("refuses to run the tasks of a cancelled job", async () => {
    const { coordinator: engine, calls } = coordinator();
    engine.createJob({ jobId: "job-1", workflow: workflow("wf", "One", makeTask("t1", definition())) });
    engine.cancelJob("job-1", "operator cancelled");
    const results = await engine.runJob("job-1");
    assert.deepEqual(results, []);
    assert.deepEqual(calls, [], "a cancelled job executes nothing");
  });
});

describe("PHASE 07 T/U - claims, duplicate delivery, and idempotency", () => {
  it("grants a claim to the first worker", () => {
    const registry = new ClaimRegistry({ clock: new ManualClock(NOW) });
    const claimed = registry.claim("job-1", "t1", "worker-a");
    assert.equal(claimed.ok, true);
    assert.equal(claimed.claim?.workerId, "worker-a");
  });

  it("refuses a second claim while one is live", () => {
    const registry = new ClaimRegistry({ clock: new ManualClock(NOW) });
    registry.claim("job-1", "t1", "worker-a");
    const second = registry.claim("job-1", "t1", "worker-b");
    assert.equal(second.ok, false);
    assert.equal(second.ok === false ? second.reason : null, "already_claimed");
    assert.equal(second.ok === false ? second.heldBy : null, "worker-a");
  });

  it("releases an expired claim so a dead worker's task is recoverable", () => {
    const clock = new ManualClock(NOW);
    const registry = new ClaimRegistry({ clock, defaultTtlMs: 1_000 });
    registry.claim("job-1", "t1", "worker-a");
    clock.advance(1_001);
    assert.equal(registry.current("job-1", "t1"), null, "an expired claim is not a permanent loss");
    const again = registry.claim("job-1", "t1", "worker-b");
    assert.equal(again.ok, true);
    assert.equal(registry.claimCount("job-1", "t1"), 2, "at-least-once delivery, counted");
  });

  it("refuses a result presented with a stale token", () => {
    const clock = new ManualClock(NOW);
    const registry = new ClaimRegistry({ clock, defaultTtlMs: 1_000 });
    const first = registry.claim("job-1", "t1", "worker-a");
    assert.equal(first.ok, true);
    clock.advance(1_001);
    const check = registry.verify("job-1", "t1", first.ok === true ? first.claim.token : "");
    assert.equal(check.valid, false, "a worker that no longer holds the task cannot report for it");
  });

  it("refuses a token that is not the current one", () => {
    const registry = new ClaimRegistry({ clock: new ManualClock(NOW) });
    registry.claim("job-1", "t1", "worker-a");
    assert.equal(registry.verify("job-1", "t1", "claim-t1-999").valid, false);
  });

  it("releases every claim for a cancelled job", () => {
    const registry = new ClaimRegistry({ clock: new ManualClock(NOW) });
    registry.claim("job-1", "t1", "worker-a");
    registry.claim("job-1", "t2", "worker-a");
    registry.claim("job-2", "t3", "worker-b");
    assert.deepEqual(registry.releaseJob("job-1"), ["t1", "t2"]);
    assert.equal(registry.current("job-2", "t3") !== null, true, "another job's claim is untouched");
  });

  it("names its guarantee instead of claiming exactly-once", () => {
    // The honest label, asserted so a later change to "exactly once" becomes a
    // deliberate act that has to update this test.
    assert.equal(DELIVERY_SEMANTICS.scope, "durable-per-workspace");
    assert.equal(DELIVERY_SEMANTICS.claim, "effectively-once");
  });

  it("tells a duplicate to wait rather than inventing a result", () => {
    const ledger = new IdempotencyLedger({ clock: new ManualClock(NOW) });
    const begun = ledger.begin("k1", "t1");
    assert.equal(begun.ok, true);
    // PHASE 12.8. `begun.record` is null for a fresh claim, because nothing has run yet. The old
    // contract handed back a record with `outcome: "succeeded"` here - the same invented answer
    // the very next assertion refuses to give a duplicate.
    assert.equal(begun.ok === true ? begun.record : undefined, null, "a claim reports no outcome; there is none yet");
    const duplicate = ledger.begin("k1", "t1");
    assert.equal(duplicate.ok, false, "answering early would report a result that does not exist yet");
    assert.equal(duplicate.ok === false ? duplicate.reason : null, "in_progress");
  });

  it("replays a recorded outcome to a later duplicate", () => {
    const ledger = new IdempotencyLedger({ clock: new ManualClock(NOW) });
    ledger.begin("k1", "t1");
    ledger.complete("k1", "succeeded", "exec-1");
    const replay = ledger.begin("k1", "t1");
    assert.equal(replay.ok === true ? replay.replayed : null, true);
    // Discriminated on `replayed` as well as `ok`: a replay always carries the record, and a
    // fresh claim never does, so reading `.resultRef` without both checks is a null dereference.
    assert.equal(replay.ok === true && replay.replayed ? replay.record.resultRef : null, "exec-1");
  });

  it("bounds the ledger and says what it dropped", () => {
    const ledger = new IdempotencyLedger({ clock: new ManualClock(NOW), limit: 2 });
    for (const key of ["k1", "k2", "k3", "k4"]) {
      ledger.begin(key, "t");
      ledger.complete(key, "succeeded", null);
    }
    assert.equal(ledger.size, 2);
    assert.equal(ledger.droppedCount, 2, "silent truncation would be a lie about completeness");
  });

  it("lets a failed execution release its key for a real retry", () => {
    const ledger = new IdempotencyLedger({ clock: new ManualClock(NOW) });
    ledger.begin("k1", "t1");
    ledger.abandon("k1");
    assert.equal(ledger.inFlightCount(), 0);
    assert.equal(ledger.begin("k1", "t1").ok, true);
  });
});

describe("PHASE 07 P/Q - approval gates cannot be bypassed", () => {
  function registry(): ApprovalRegistry {
    return new ApprovalRegistry({ clock: new ManualClock(NOW) });
  }

  it("opens a gate that waits", () => {
    const gates = registry();
    const gate = gates.open({ jobId: "job-1", taskId: "t1", question: "Deploy to production?", intent: definition() });
    assert.equal(gate.state, "waiting");
    assert.equal(gate.decidedBy, null);
  });

  it("refuses an approval with no question", () => {
    assert.throws(() => registry().open({ jobId: "job-1", taskId: "t1", question: "  ", intent: definition() }), ApprovalError);
  });

  it("refuses a worker approving its own work", () => {
    const gates = registry();
    const gate = gates.open({ jobId: "job-1", taskId: "t1", question: "Proceed?", intent: definition() });
    assert.throws(
      () => gates.decide({ gateId: gate.gateId, decision: "approved", decidedBy: "worker-1", workerId: "worker-1" }),
      /may not approve its own work/,
    );
  });

  it("refuses the task approving itself", () => {
    const gates = registry();
    const gate = gates.open({ jobId: "job-1", taskId: "t1", question: "Proceed?", intent: definition() });
    assert.throws(
      () => gates.decide({ gateId: gate.gateId, decision: "approved", decidedBy: "t1", taskId: "t1" }),
      /may not approve itself/,
    );
  });

  it("refuses an anonymous approval", () => {
    const gates = registry();
    const gate = gates.open({ jobId: "job-1", taskId: "t1", question: "Proceed?", intent: definition() });
    assert.throws(() => gates.decide({ gateId: gate.gateId, decision: "approved", decidedBy: "  " }), /must name who/);
  });

  it("records who approved", () => {
    const gates = registry();
    const gate = gates.open({ jobId: "job-1", taskId: "t1", question: "Proceed?", intent: definition() });
    const decided = gates.decide({ gateId: gate.gateId, decision: "approved", decidedBy: "human:ana", reason: "reviewed" });
    assert.equal(decided.state, "approved");
    assert.equal(decided.decidedBy, "human:ana");
    assert.ok((decided.decidedAt ?? 0) > 0);
  });

  it("refuses to overturn a decided gate", () => {
    const gates = registry();
    const gate = gates.open({ jobId: "job-1", taskId: "t1", question: "Proceed?", intent: definition() });
    gates.decide({ gateId: gate.gateId, decision: "rejected", decidedBy: "human:ana" });
    assert.throws(
      () => gates.decide({ gateId: gate.gateId, decision: "approved", decidedBy: "human:bob" }),
      /decided gate is final/,
    );
  });

  it("refuses to approve an expired gate", () => {
    const clock = new ManualClock(NOW);
    const gates = new ApprovalRegistry({ clock });
    const gate = gates.open({ jobId: "job-1", taskId: "t1", question: "Proceed?", intent: definition(), expiresAtMs: NOW.getTime() + 100 });
    clock.advance(200);
    assert.throws(
      () => gates.decide({ gateId: gate.gateId, decision: "approved", decidedBy: "human:ana" }),
      /expired/,
    );
  });

  it("expires a gate whose deadline passed", () => {
    const clock = new ManualClock(NOW);
    const gates = new ApprovalRegistry({ clock });
    gates.open({ jobId: "job-1", taskId: "t1", question: "Proceed?", intent: definition(), expiresAtMs: NOW.getTime() + 100 });
    clock.advance(200);
    assert.equal(gates.expireDue().length, 1);
    assert.equal(gates.all()[0]?.state, "expired");
  });

  it("blocks release while waiting and allows it once approved", () => {
    const gates = registry();
    const gate = gates.open({ jobId: "job-1", taskId: "t1", question: "Proceed?", intent: definition() });
    // PHASE 01 (C-3): the third argument states whether approval is required.
    assert.equal(gates.mayRelease("job-1", "t1", true, definition()).allowed, false);
    gates.decide({ gateId: gate.gateId, decision: "approved", decidedBy: "human:ana" });
    assert.equal(gates.mayRelease("job-1", "t1", true, definition()).allowed, true);
  });

  it("blocks release after a rejection", () => {
    const gates = registry();
    const gate = gates.open({ jobId: "job-1", taskId: "t1", question: "Proceed?", intent: definition() });
    gates.decide({ gateId: gate.gateId, decision: "rejected", decidedBy: "human:ana" });
    const release = gates.mayRelease("job-1", "t1", true, definition());
    assert.equal(release.allowed, false);
    assert.match(release.detail, /rejected/);
  });
});

describe("PHASE 07 R/S - checkpoints and recovery", () => {
  function store(): CheckpointStore {
    return new CheckpointStore({ clock: new ManualClock(NOW), repository: durableStore(null) });
  }

  it("numbers checkpoints per task", () => {
    const checkpoints = store();
    checkpoints.write({ jobId: "j", taskId: "t1", executionId: "e1", progress: "1/3", dataRef: "s3://a", recoverable: true });
    const second = checkpoints.write({ jobId: "j", taskId: "t1", executionId: "e1", progress: "2/3", dataRef: "s3://b", recoverable: true });
    assert.equal(second.sequence, 2);
  });

  it("refuses a checkpoint that points at nothing", () => {
    assert.throws(
      () => store().write({ jobId: "j", taskId: "t1", executionId: "e1", progress: "1/3", dataRef: "  ", recoverable: true }),
      CheckpointError,
    );
  });

  it("refuses a non-recoverable checkpoint that does not say why", () => {
    assert.throws(
      () => store().write({ jobId: "j", taskId: "t1", executionId: "e1", progress: "1/3", dataRef: "s3://a", recoverable: false }),
      /must say why/,
    );
  });

  it("resumes from a recoverable checkpoint", () => {
    const checkpoints = store();
    checkpoints.write({ jobId: "j", taskId: "t1", executionId: "e1", progress: "2/3", dataRef: "s3://a", recoverable: true });
    const plan = checkpoints.recoveryPlan("j", "t1");
    assert.equal(plan.action, "resume");
    assert.equal(plan.checkpoint?.dataRef, "s3://a");
  });

  it("restarts, with a stated reason, when recovery is not safe", () => {
    // The honesty property: a task that cannot safely resume says so, and the
    // coordinator restarts it instead of pretending to continue.
    const checkpoints = store();
    checkpoints.write({
      jobId: "j",
      taskId: "t1",
      executionId: "e1",
      progress: "2/3",
      dataRef: "s3://a",
      recoverable: false,
      notRecoverableReason: "the step already charged a card",
    });
    const plan = checkpoints.recoveryPlan("j", "t1");
    assert.equal(plan.action, "restart");
    assert.match(plan.detail, /already charged a card/);
  });

  it("reports no checkpoint rather than inventing one", () => {
    assert.equal(store().recoveryPlan("j", "t1").action, "no_checkpoint");
  });

  it("keeps checkpoints per task separate", () => {
    const checkpoints = store();
    checkpoints.write({ jobId: "j", taskId: "t1", executionId: "e1", progress: "1/2", dataRef: "s3://a", recoverable: true });
    checkpoints.write({ jobId: "j", taskId: "t2", executionId: "e2", progress: "1/2", dataRef: "s3://b", recoverable: true });
    assert.equal(checkpoints.count("j", "t1"), 1);
    assert.equal(checkpoints.latest("j", "t1")?.dataRef, "s3://a");
    assert.equal(checkpoints.latest("j", "t2")?.dataRef, "s3://b");
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
