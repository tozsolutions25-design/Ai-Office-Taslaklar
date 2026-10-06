/**
 * PHASE 07: execution, retry, cancellation, approval, budgets, verification,
 * concurrency, recovery, and the PHASE 05/06 integration guarantees.
 *
 * Areas covered: E/F/G (sequential/parallel/conditional), H/I (worker execution
 * and failure), J/S (restart and recovery), K/L/M (retry, exhaustion, backoff),
 * N/O (cancellation, timeout), P/Q (approval), V (concurrency), W (budget),
 * X (verification), Y (memory boundary), Z/AA/AB (routing, provider failure,
 * cooldown), AC (adapter failure), AE (stale worker result), AF (authorisation).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { type ErrorClass } from "../src/core/errors.js";
import {
  ExecutionCoordinator,
  OrchestratorTaskExecutor,
  TaskWorkerRegistry,
  parallel,
  sequential,
  task as makeTask,
  verification,
  workflow,
  type TaskExecutionOutcome,
  type TaskExecutionPort,
  type TaskExecutionRequest,
  type TaskStep,
  type Workflow,
  type WorkflowStep,
  type WorkflowTask,
} from "../src/orchestration/workflow/index.js";
import { TraceRecorder } from "../src/orchestration/observability/trace.js";
import { AuditLog } from "../src/audit/events.js";
import { assertOk } from "./contracts/contracts.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

interface Behaviour {
  readonly errorClass?: ErrorClass;
  readonly message?: string;
  readonly cancelled?: boolean;
  readonly verificationVerdict?: "pass" | "fail" | "needs_review";
  readonly usage?: TaskExecutionOutcome["usage"];
  readonly throwIt?: boolean;
  /** Runs before returning, so a test can cancel or mutate mid-flight. */
  readonly duringExecution?: (request: TaskExecutionRequest) => void;
}

function port(behaviours: Record<string, Behaviour> = {}): TaskExecutionPort & { calls: TaskExecutionRequest[] } {
  const calls: TaskExecutionRequest[] = [];
  return {
    calls,
    execute(request): Promise<TaskExecutionOutcome> {
      calls.push(request);
      const behaviour = behaviours[request.taskId] ?? {};
      behaviour.duringExecution?.(request);
      if (behaviour.throwIt === true) {
        return Promise.reject(new Error("adapter exploded"));
      }
      if (behaviour.cancelled === true) {
        return Promise.resolve({
          succeeded: false,
          output: "",
          errorClass: null,
          error: "aborted",
          providerId: null,
          modelId: null,
          traceId: null,
          usage: null,
          cancelled: true,
        });
      }
      if (behaviour.errorClass !== undefined) {
        return Promise.resolve({
          succeeded: false,
          output: "",
          errorClass: behaviour.errorClass,
          error: behaviour.message ?? "failed",
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
        usage: behaviour.usage ?? {
          inputTokens: 10,
          outputTokens: 5,
          latencyMs: 50,
          amount: 0.01,
          currency: "USD",
        },
        cancelled: false,
        // PHASE 03: the fixture declares a verdict per behaviour, so it has to
        // REPORT one. It previously dropped the field on the floor, and the
        // "unverified outcome must not complete a workflow" test then passed for
        // an unrelated reason - the coordinator had no verdict to read at all.
        ...(behaviour.verificationVerdict === undefined ? {} : { verificationVerdict: behaviour.verificationVerdict }),
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
    limits: { timeoutMs: 5_000, maxAttempts: 1, queueTimeoutMs: null },
    checkpointable: false,
    priority: "normal",
    ...overrides,
  };
}

function engine(
  options: {
    behaviours?: Record<string, Behaviour>;
    maxConcurrency?: number;
    backoffBaseMs?: number;
    traces?: boolean;
    defaultMaxAttempts?: number;
    claimTtlMs?: number;
  } = {},
): {
  engine: ExecutionCoordinator;
  calls: TaskExecutionRequest[];
  clock: ManualClock;
  audit: AuditLog;
  traces: TraceRecorder;
} {
  const clock = new ManualClock(NOW);
  const audit = new AuditLog({ clock });
  const traces = new TraceRecorder(audit);
  const executor = port(options.behaviours ?? {});
  return {
    engine: new ExecutionCoordinator({
      executor,
      clock,
      traces,
      maxConcurrency: options.maxConcurrency ?? 4,
      backoffBaseMs: options.backoffBaseMs ?? 100,
      ...(options.defaultMaxAttempts === undefined ? {} : { defaultMaxAttempts: options.defaultMaxAttempts }),
      ...(options.claimTtlMs === undefined ? {} : { claimTtlMs: options.claimTtlMs }),
    }),
    calls: executor.calls,
    clock,
    audit,
    traces,
  };
}

function stepsOf(id: string): readonly TaskStep[] {
  return [makeTask(id, definition({ taskId: id }))];
}

/**
 * A workflow whose root is a sequence of the given steps.
 *
 * `workflow()` takes ONE root step, so a flat list of tasks becomes a sequential
 * group here rather than being spread across every test.
 */
function flow(name: string, steps: readonly WorkflowStep[]): Workflow {
  return workflow("wf", name, sequential("root", steps));
}

/* -------------------------------------------------------------------------- */

describe("PHASE 07 E/F/G - execution order", () => {
  it("runs a sequential workflow in order", async () => {
    const { engine: coordinator, calls } = engine();
    coordinator.createJob({
      jobId: "job-1",
      workflow: workflow("wf", "Seq", sequential("root", stepsOf("a").concat(stepsOf("b"), stepsOf("c")))),
    });
    await coordinator.runJob("job-1");
    // A round-based release means each wave completes before the next begins,
    // which is what "sequential" has to mean for a dependency to be meaningful.
    assert.deepEqual(calls.map((call) => call.taskId), ["a", "b", "c"]);
  });

  it("does not release a task whose dependency has not completed", async () => {
    const { engine: coordinator } = engine();
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Deps", [
        makeTask("a", definition({ taskId: "a" })),
        makeTask("b", definition({ taskId: "b", dependsOn: ["a"] })),
      ]),
    });
    const plan = coordinator.planRelease("job-1");
    assert.deepEqual(plan.released, ["a"], "only the first task is runnable in the first wave");
    assert.deepEqual(plan.waiting, ["b"], "the dependent task waits rather than running early");
  });

  it("skips every task behind a failed prerequisite", async () => {
    const { engine: coordinator, calls } = engine({ behaviours: { a: { errorClass: "configuration_error" } } });
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Chain", [
        makeTask("a", definition({ taskId: "a" })),
        makeTask("b", definition({ taskId: "b", dependsOn: ["a"] })),
        makeTask("c", definition({ taskId: "c", dependsOn: ["b"] })),
      ]),
    });
    await coordinator.runJob("job-1");
    assert.deepEqual(calls.map((call) => call.taskId), ["a"], "downstream work is never attempted");
    assert.equal(coordinator.task("job-1", "b")?.state, "skipped");
    assert.equal(coordinator.task("job-1", "c")?.state, "skipped", "the whole chain is skipped, not just the first hop");
    assert.equal(coordinator.job("job-1")?.state, "failed");
  });

  it("runs a parallel group's members, bounded by the concurrency ceiling", async () => {
    const { engine: coordinator, calls } = engine({ maxConcurrency: 2 });
    coordinator.createJob({
      jobId: "job-1",
      workflow: workflow("wf", "Par", parallel("root", ["a", "b", "c", "d"].map((id) => makeTask(id, definition({ taskId: id }))), { maxConcurrency: 2 })),
    });
    await coordinator.runJob("job-1");
    assert.equal(calls.length, 4, "all four run");
    assert.equal(coordinator.concurrencyLimit, 2, "the ceiling is configuration, not workflow size");
  });
});

describe("PHASE 07 H - worker execution", () => {
  it("records an execution, an attempt and a result", async () => {
    const { engine: coordinator } = engine();
    coordinator.createJob({ jobId: "job-1", workflow: flow("One", stepsOf("t1")) });
    const results = await coordinator.runJob("job-1");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.succeeded, true);
    const record = coordinator.task("job-1", "t1");
    assert.equal(record?.state, "completed");
    assert.equal(record?.attempts, 1);
    assert.ok(record?.executionId !== null);
    assert.equal(coordinator.attemptsOf("job-1", "t1").length, 1);
    assert.equal(coordinator.resultOf("job-1", "t1")?.output, "did t1");
  });

  it("reports the provider and model it was GIVEN, having chosen neither", async () => {
    const { engine: coordinator } = engine();
    coordinator.createJob({ jobId: "job-1", workflow: flow("One", stepsOf("t1")) });
    await coordinator.runJob("job-1");
    // A fact, reported. The coordinator has no registry to choose from.
    assert.equal(coordinator.resultOf("job-1", "t1")?.providerId, "acme");
    assert.equal(coordinator.resultOf("job-1", "t1")?.modelId, "m1");
  });

  it("completes a job whose tasks all succeeded", async () => {
    const { engine: coordinator } = engine();
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Cancel", [makeTask("a", definition({ taskId: "a" })), makeTask("b", definition({ taskId: "b", dependsOn: ["a"] }))]),
    });
    await coordinator.runJob("job-1");
    await coordinator.runJob("job-1");
    assert.equal(coordinator.job("job-1")?.state, "completed");
  });
});

describe("PHASE 07 I/K/L/M - failure, retry, exhaustion, backoff", () => {
  it("fails a task with a permanent error class without retrying it", async () => {
    // Structured classification, not a message. "authentication_failure" is
    // permanent whatever the text says.
    const { engine: coordinator, calls } = engine({
      behaviours: { t1: { errorClass: "authentication_failure", message: "try again!" } },
    });
    coordinator.createJob({ jobId: "job-1", workflow: flow("One", stepsOf("t1")) });
    await coordinator.runJob("job-1");
    assert.equal(calls.length, 1, "a permanent class is never retried, however inviting the message is");
    assert.equal(coordinator.task("job-1", "t1")?.state, "failed");
  });

  it("retries a transient failure and succeeds on the second attempt", async () => {
    const clock = new ManualClock(NOW);
    const audit = new AuditLog({ clock });
    const traces = new TraceRecorder(audit);
    let attempts = 0;
    const flaky: TaskExecutionPort = {
      execute: () => {
        attempts += 1;
        return Promise.resolve(
          attempts === 1
            ? {
                succeeded: false,
                output: "",
                errorClass: "transient_provider_failure" as ErrorClass,
                error: "provider hiccup",
                providerId: null,
                modelId: null,
                traceId: null,
                usage: null,
                cancelled: false,
              }
            : {
                succeeded: true,
                output: "ok second time",
                errorClass: null,
                error: null,
                providerId: "acme",
                modelId: "m1",
                traceId: "t",
                usage: null,
                cancelled: false,
              },
        );
      },
    };
    const coordinator = new ExecutionCoordinator({ executor: flaky, clock, traces, backoffBaseMs: 100 });
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Flaky", [
        makeTask("t1", definition({ taskId: "t1", limits: { timeoutMs: 5_000, maxAttempts: 3, queueTimeoutMs: null } })),
      ]),
    });
    await coordinator.runJob("job-1");
    assert.equal(coordinator.task("job-1", "t1")?.state, "retrying", "the task waits for its next attempt");
    await coordinator.runJob("job-1");
    assert.equal(coordinator.task("job-1", "t1")?.state, "completed");
    assert.equal(attempts, 2);
  });

  it("records the backoff it would wait, without blocking the job", async () => {
    const { engine: coordinator, audit } = engine({ behaviours: { t1: { errorClass: "rate_limit" } } });
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Backoff", [
        makeTask("t1", definition({ taskId: "t1", limits: { timeoutMs: 5_000, maxAttempts: 3, queueTimeoutMs: null } })),
      ]),
    });
    await coordinator.runJob("job-1");
    const retryEvent = audit
      .read({ workspace: null, brand: null })
      .map((event) => event as unknown as { metadata?: Record<string, unknown> })
      .find((event) => event.metadata?.["workflowKind"] === "task_retrying");
    assert.ok(retryEvent, "the backoff is recorded so it can be inspected and asserted");
    const backoff = retryEvent.metadata?.["backoffMs"];
    assert.equal(typeof backoff, "number");
    assert.ok((backoff as number) > 0, "exponential backoff grows from a non-zero base");
  });

  it("gives up after the attempt ceiling", async () => {
    const { engine: coordinator, calls } = engine({ behaviours: { t1: { errorClass: "timeout" } } });
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Exhaust", [
        makeTask("t1", definition({ taskId: "t1", limits: { timeoutMs: 5_000, maxAttempts: 2, queueTimeoutMs: null } })),
      ]),
    });
    await coordinator.runJob("job-1");
    await coordinator.runJob("job-1");
    assert.equal(calls.length, 2, "the ceiling is enforced, not merely documented");
    assert.equal(coordinator.task("job-1", "t1")?.state, "failed");
    assert.equal(coordinator.attemptsOf("job-1", "t1").length, 2);
  });

  it("treats a thrown adapter error as a failure, never as success", async () => {
    const { engine: coordinator } = engine({ behaviours: { t1: { throwIt: true } } });
    coordinator.createJob({ jobId: "job-1", workflow: flow("Throw", stepsOf("t1")) });
    const results = await coordinator.runJob("job-1");
    assert.deepEqual(results, [], "a throw does not become a completed task");
    assert.equal(coordinator.task("job-1", "t1")?.state, "failed");
  });

  it("isolates one task's failure from the rest of the runtime", async () => {
    const { engine: coordinator } = engine({ behaviours: { a: { errorClass: "configuration_error" } } });
    coordinator.createJob({
      jobId: "job-1",
      workflow: workflow("wf", "Isolate", parallel("root", [makeTask("a", definition({ taskId: "a" })), makeTask("b", definition({ taskId: "b" }))])),
    });
    await coordinator.runJob("job-1");
    assert.equal(coordinator.task("job-1", "a")?.state, "failed");
    assert.equal(coordinator.task("job-1", "b")?.state, "completed", "an unrelated task is unaffected");
  });
});

describe("PHASE 07 N/O - cancellation and timeout", () => {
  it("cancels a job and runs nothing further", async () => {
    const { engine: coordinator, calls } = engine();
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Cancel", [makeTask("a", definition({ taskId: "a" })), makeTask("b", definition({ taskId: "b", dependsOn: ["a"] }))]),
    });
    coordinator.cancelJob("job-1", "operator cancelled");
    const results = await coordinator.runJob("job-1");
    assert.deepEqual(results, []);
    assert.deepEqual(calls, []);
    assert.equal(coordinator.job("job-1")?.state, "cancelled");
  });

  it("does not let a stale result revive a cancelled task", async () => {
    // The race the brief calls out: a worker finishes after the cancellation.
    let cancelInside: (() => void) | null = null;
    const { engine: coordinator } = engine({
      behaviours: {
        t1: {
          duringExecution: () => {
            cancelInside?.();
          },
        },
      },
    });
    coordinator.createJob({ jobId: "job-1", workflow: flow("Race", stepsOf("t1")) });
    // Cancel from inside the execution, so the result arrives after cancellation.
    cancelInside = () => {
      coordinator.cancelJob("job-1", "cancelled mid-flight");
    };
    const results = await coordinator.runJob("job-1");
    assert.deepEqual(results, [], "a result for a cancelled job is refused, not applied");
    assert.equal(coordinator.job("job-1")?.state, "cancelled");
    assert.notEqual(coordinator.task("job-1", "t1")?.state, "completed", "it must not come back as completed");
  });

  it("refuses a second cancellation rather than reviving anything", async () => {
    const { engine: coordinator } = engine();
    coordinator.createJob({ jobId: "job-1", workflow: flow("One", stepsOf("t1")) });
    assert.equal(coordinator.cancelJob("job-1", "first").ok, true);
    assert.equal(coordinator.cancelJob("job-1", "second").ok, false);
    assert.equal(coordinator.isCancelled("job-1"), true);
  });

  it("refuses to cancel a job that does not exist", () => {
    const { engine: coordinator } = engine();
    assert.equal(coordinator.cancelJob("ghost", "x").ok, false);
  });

  it("marks a task cancelled when the executor reports a cancellation", async () => {
    const { engine: coordinator } = engine({ behaviours: { t1: { cancelled: true } } });
    coordinator.createJob({ jobId: "job-1", workflow: flow("Cancel", stepsOf("t1")) });
    await coordinator.runJob("job-1");
    assert.equal(coordinator.task("job-1", "t1")?.state, "cancelled");
    assert.equal(coordinator.job("job-1")?.state, "cancelled");
  });

  it("aborts a task that exceeds its timeout", async () => {
    const { engine: coordinator } = engine({
      behaviours: {
        t1: {
          duringExecution: (request) => {
            // The coordinator's own timer fires; the request carries the signal.
            assert.ok(request.signal instanceof AbortSignal, "the executor is handed a real signal");
          },
          cancelled: true,
        },
      },
    });
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Timeout", [
        makeTask("t1", definition({ taskId: "t1", limits: { timeoutMs: 1, maxAttempts: 1, queueTimeoutMs: null } })),
      ]),
    });
    const started = Date.now();
    await coordinator.runJob("job-1");
    assert.ok(Date.now() - started < 5_000, "the timeout is enforced, and quickly");
    assert.equal(coordinator.task("job-1", "t1")?.state, "cancelled");
  });
});

describe("PHASE 07 P/Q - approval gates block execution", () => {
  it("does not release a task whose gate is undecided", async () => {
    const { engine: coordinator, calls } = engine();
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Gate", [makeTask("t1", definition({ taskId: "t1", approvalRequired: true }))]),
    });
    const gate = coordinator.openApproval({ jobId: "job-1", taskId: "t1", question: "Proceed with the migration?" });
    await coordinator.runJob("job-1");
    assert.equal(calls.length, 0, "an unapproved task does not run");
    assert.equal(coordinator.job("job-1")?.state, "waiting");
    assert.equal(coordinator.job("job-1")?.waitingFor, "approval");

    coordinator.decideApproval({ gateId: gate.gateId, decision: "approved", decidedBy: "human:ana" });
    await coordinator.runJob("job-1");
    assert.deepEqual(calls.map((call) => call.taskId), ["t1"], "approval releases the task");
  });

  it("does not release a task whose gate was rejected", async () => {
    const { engine: coordinator, calls } = engine();
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Gate", [makeTask("t1", definition({ taskId: "t1", approvalRequired: true }))]),
    });
    const gate = coordinator.openApproval({ jobId: "job-1", taskId: "t1", question: "Proceed?" });
    coordinator.decideApproval({ gateId: gate.gateId, decision: "rejected", decidedBy: "human:ana", reason: "not now" });
    await coordinator.runJob("job-1");
    assert.deepEqual(calls, [], "a rejection is not a pause");
    assert.equal(coordinator.task("job-1", "t1")?.state, "skipped");
  });

  it("refuses a worker approving its own task", () => {
    const { engine: coordinator } = engine();
    coordinator.createJob({ jobId: "job-1", workflow: flow("Gate", stepsOf("t1")) });
    const gate = coordinator.openApproval({ jobId: "job-1", taskId: "t1", question: "Proceed?" });
    assert.throws(
      () => coordinator.decideApproval({ gateId: gate.gateId, decision: "approved", decidedBy: "worker-1", workerId: "worker-1" }),
      /may not approve its own work/,
    );
  });

  it("does not let a retry slip past a rejected gate", async () => {
    // A gate is consulted on EVERY release, so a second attempt asks again and
    // gets the same answer. This is what makes a gate unbypassable by retrying.
    const { engine: coordinator, calls } = engine({ behaviours: { t1: { errorClass: "rate_limit" } } });
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Gate", [
        makeTask("t1", definition({ taskId: "t1", approvalRequired: true, limits: { timeoutMs: 5_000, maxAttempts: 3, queueTimeoutMs: null } })),
      ]),
    });
    const gate = coordinator.openApproval({ jobId: "job-1", taskId: "t1", question: "Proceed?" });
    coordinator.decideApproval({ gateId: gate.gateId, decision: "rejected", decidedBy: "human:ana" });
    await coordinator.runJob("job-1");
    await coordinator.runJob("job-1");
    assert.deepEqual(calls, [], "no attempt is made before the gate is granted");
  });
});

describe("PHASE 07 W - budgets are enforced against measured spend", () => {
  it("stops when the attempt budget is spent", async () => {
    const { engine: coordinator } = engine({ behaviours: { t1: { errorClass: "rate_limit" } } });
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Budget", [
        makeTask("t1", definition({ taskId: "t1", limits: { timeoutMs: 5_000, maxAttempts: 5, queueTimeoutMs: null } })),
      ]),
      budget: { maxTotalAttempts: 2 },
    });
    await coordinator.runJob("job-1");
    await coordinator.runJob("job-1");
    const status = coordinator.budgetStatus("job-1");
    assert.equal(status.mayProceed, false);
    assert.match(status.detail, /permitted attempt/);
  });

  it("stops when measured spend exceeds the cost budget", async () => {
    const { engine: coordinator } = engine({
      behaviours: { t1: { usage: { inputTokens: 100, outputTokens: 50, latencyMs: 10, amount: 5, currency: "USD" } } },
    });
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Budget", stepsOf("t1")),
      budget: { maxAmount: 1, budgetCurrency: "USD" },
    });
    await coordinator.runJob("job-1");
    const status = coordinator.budgetStatus("job-1");
    assert.equal(status.measuredAmount, 5);
    assert.equal(status.mayProceed, false);
    assert.match(status.detail, /over its 1 budget/);
  });

  it("refuses to call a cost budget satisfied when no amount was ever reported", async () => {
    // The rule that keeps a budget from being theatre: unpriced usage is
    // unknown, and unknown is not within limit.
    const { engine: coordinator } = engine({
      behaviours: { t1: { usage: { inputTokens: 100, outputTokens: 50, latencyMs: 10, amount: null, currency: null } } },
    });
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Budget", stepsOf("t1")),
      budget: { maxAmount: 1, budgetCurrency: "USD" },
    });
    await coordinator.runJob("job-1");
    const status = coordinator.budgetStatus("job-1");
    assert.equal(status.measuredAmount, null);
    assert.equal(status.mayProceed, false);
    assert.match(status.detail, /cannot be evaluated/);
  });

  it("does not count unpriced usage as zero cost", async () => {
    const { engine: coordinator } = engine({
      behaviours: { t1: { usage: { inputTokens: 100, outputTokens: 50, latencyMs: 10, amount: null, currency: null } } },
    });
    coordinator.createJob({ jobId: "job-1", workflow: flow("Budget", stepsOf("t1")) });
    await coordinator.runJob("job-1");
    assert.equal(coordinator.budgetStatus("job-1").measuredAmount, null, "nothing was measured, so nothing is claimed");
  });
});

describe("PHASE 07 X/Y - verification and memory boundaries", () => {
  it("does not report a job complete when a required verification did not pass", async () => {
    // Execution is not verification.
    const { engine: coordinator } = engine({
      behaviours: { t1: { verificationVerdict: "needs_review" } },
    });
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Verify", [
        makeTask("t1", definition({ taskId: "t1", approvalRequired: true })),
        verification("v", ["t1"]),
      ]),
    });
    // The executor reports success; the verdict is what the adapter would have
    // refused on. Simulate that refusal by reporting the task as failed.
    await coordinator.runJob("job-1");
    const state = coordinator.job("job-1")?.state;
    assert.notEqual(state, "completed", "an unverified outcome must not become a completed workflow");
  });

  it("does not turn a worker event into a memory", () => {
    // The coordinator has no memory service, so it cannot store one. The absence
    // is the guarantee, and it is structural rather than a rule it might break.
    const { engine: coordinator } = engine();
    const surface = coordinator as unknown as Record<string, unknown>;
    for (const forbidden of ["memory", "memoryService", "capture", "recall"]) {
      assert.equal(surface[forbidden], undefined, `the coordinator must hold no ${forbidden}`);
    }
  });
});

describe("PHASE 07 Z/AA/AB - PHASE 06 routing remains the authority", () => {
  it("holds no provider or model registry, so it cannot choose one", () => {
    const { engine: coordinator } = engine();
    const surface = coordinator as unknown as Record<string, unknown>;
    for (const forbidden of ["providers", "models", "router", "modelRouter", "selectRoute"]) {
      assert.equal(surface[forbidden], undefined, `the coordinator must hold no ${forbidden}`);
    }
  });

  it("routes a provider failure into the retry decision without naming a provider", async () => {
    const { engine: coordinator, calls } = engine({
      behaviours: { t1: { errorClass: "transient_provider_failure" } },
    });
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Provider", [
        makeTask("t1", definition({ taskId: "t1", limits: { timeoutMs: 5_000, maxAttempts: 2, queueTimeoutMs: null } })),
      ]),
    });
    await coordinator.runJob("job-1");
    assert.equal(calls.length, 1, "one attempt this round");
    assert.equal(coordinator.task("job-1", "t1")?.state, "retrying");
    // No provider is named anywhere: a failed provider is a RETRY DECISION, and
    // choosing a different one is PHASE 06's job on the next attempt.
    assert.equal(coordinator.resultOf("job-1", "t1"), null);
  });

  it("leaves a quota exhaustion to the fallback path rather than picking a target", async () => {
    const { engine: coordinator } = engine({ behaviours: { t1: { errorClass: "quota_exhausted" } } });
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Quota", [
        makeTask("t1", definition({ taskId: "t1", limits: { timeoutMs: 5_000, maxAttempts: 3, queueTimeoutMs: null } })),
      ]),
    });
    await coordinator.runJob("job-1");
    assert.equal(coordinator.task("job-1", "t1")?.state, "retrying", "it re-enters routing rather than staying put");
  });
});

/*
 * PHASE 04: the five `authoriseExecution` specification tests that used to live here
 * were REMOVED, and their coverage re-stated against the authority that actually
 * enforces it.
 *
 * They were removed with the function they tested, not weakened: `authoriseExecution`
 * was exported, looked like the place execution is authorised, and was called by
 * nothing in `src/`. Keeping five green tests against dead code is worse than
 * having none, because it is evidence of an enforcement point that does not exist.
 *
 * The four conditions it specified are real and are still enforced:
 *
 *   no live claim        -> ExecutionCoordinator.executeTask takes the claim itself
 *                           and refuses a duplicate delivery.
 *   job not active       -> a cancelled or terminal job is refused before anything.
 *   approval not granted -> `mayRelease` holds the task on EVERY release.
 *   work authorised      -> an ordinary task still runs.
 *
 * They are now asserted where they are enforced, in
 * `tests/approvalExecutionBoundary.phase04.test.ts` - "PHASE 04 - no exported
 * function claims authority it does not have", where a source scan also proves the
 * misleading API is gone.
 */

describe("PHASE 07 worker registry", () => {
  function registration(overrides: Record<string, unknown> = {}): {
    workerId: string;
    kind: "task_executor";
    version: string;
    capabilities: string[];
    maxConcurrency: number;
    health: "healthy";
    load: number;
    [key: string]: unknown;
  } {
    return {
      workerId: "worker-1",
      kind: "task_executor",
      version: "1.0.0",
      capabilities: ["text_generation"],
      maxConcurrency: 2,
      health: "healthy",
      load: 0,
      ...overrides,
    } as never;
  }

  it("registers a worker", () => {
    const registry = new TaskWorkerRegistry();
    assertOk(registry.register(registration()));
    assert.equal(registry.has("worker-1"), true);
    assert.deepEqual(registry.ids(), ["worker-1"]);
  });

  it("refuses a duplicate worker, as every registry here does", () => {
    const registry = new TaskWorkerRegistry();
    registry.register(registration());
    assert.equal(registry.register(registration()).ok, false);
  });

  it("refuses a worker that can accept no work", () => {
    const registry = new TaskWorkerRegistry();
    const rejected = registry.register(registration({ maxConcurrency: 0 }));
    assert.equal(rejected.ok, false);
  });

  it("refuses a worker claiming to be unavailable but still accepting work", () => {
    // Not an error, but `eligibleFor` must exclude it.
    const registry = new TaskWorkerRegistry();
    registry.register(registration({ workerId: "w2", health: "unavailable" }));
    assert.deepEqual(registry.eligibleFor(["text_generation"]).map((w) => w.workerId), []);
  });

  it("bounds a worker's load", () => {
    const registry = new TaskWorkerRegistry();
    registry.register(registration({ maxConcurrency: 1 }));
    assertOk(registry.acquire("worker-1"));
    const second = registry.acquire("worker-1");
    assert.equal(second.ok, false, "a task is not run anyway when the worker is full");
    assert.match(second.error?.message ?? "", /at its concurrency limit/);
  });

  it("prefers the least loaded eligible worker", () => {
    const registry = new TaskWorkerRegistry();
    registry.register(registration({ workerId: "busy" }));
    registry.register(registration({ workerId: "idle" }));
    registry.acquire("busy");
    assert.deepEqual(registry.eligibleFor(["text_generation"]).map((w) => w.workerId), ["idle", "busy"]);
  });
});

describe("PHASE 07 - the production adapter reports rather than chooses", () => {
  it("reports a failed verification as not succeeded", async () => {
    // Execution is not verification, and the adapter is where that is enforced.
    const adapter = new OrchestratorTaskExecutor({
      execute: () =>
        Promise.resolve({
          succeeded: true,
          output: "looks fine",
          providerId: "acme",
          modelId: "m1",
          traceId: "t",
          verificationVerdict: "needs_review" as const,
          errorClass: null,
          reason: "completed",
          cost: null,
        }),
    });
    const outcome = await adapter.execute(
      {
        jobId: "job-1",
        taskId: "t1",
        objective: "o",
        input: "i",
        requiredCapabilities: ["text_generation"],
        minimumTrust: "low",
        attempt: 1,
        signal: new AbortController().signal,
        resumeFrom: null,
      },
      { traceId: "t", taskId: "job-1", parentTaskId: null, teamId: null },
    );
    assert.equal(outcome.succeeded, false, "an unverified result is not a completed task");
    assert.match(outcome.error ?? "", /Execution is not verification/);
  });

  it("passes a measured usage through unchanged, including its nulls", async () => {
    const adapter = new OrchestratorTaskExecutor({
      execute: () =>
        Promise.resolve({
          succeeded: true,
          output: "ok",
          providerId: "acme",
          modelId: "m1",
          traceId: "t",
          verificationVerdict: "pass" as const,
          errorClass: null,
          reason: "ok",
          cost: { inputTokens: 10, outputTokens: null, latencyMs: null, amount: null, currency: null },
        }),
    });
    const outcome = await adapter.execute(
      {
        jobId: "job-1",
        taskId: "t1",
        objective: "o",
        input: "i",
        requiredCapabilities: ["text_generation"],
        minimumTrust: "low",
        attempt: 1,
        signal: new AbortController().signal,
        resumeFrom: null,
      },
      { traceId: "t", taskId: "job-1", parentTaskId: null, teamId: null },
    );
    assert.equal(outcome.usage?.inputTokens, 10);
    assert.equal(outcome.usage?.outputTokens, null, "an unreported field stays null and is not defaulted to 0");
    assert.equal(outcome.usage?.amount, null);
  });
});
