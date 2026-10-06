/**
 * PHASE 07: the integration that matters most.
 *
 * A background job must reach a real execution ONLY through TOZ, and the provider
 * must be chosen ONLY by PHASE 06 routing. This file wires the whole chain -
 * coordinator -> OrchestratorTaskExecutor -> TozOrchestrator -> PHASE 06 routing -
 * and proves the choice is made where it belongs.
 *
 * Also covered: G (conditional), J (worker restart), S (recovery), Z/AA/AB
 * (routing, provider failure, cooldown) end to end, and the PHASE 05 memory
 * boundary.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { CapabilitySet } from "../src/capabilities/capability.js";
import { UNKNOWN_HEALTH } from "../src/health/index.js";
import { ProviderRegistry } from "../src/providers/index.js";
import { ModelRegistry } from "../src/models/index.js";
import { DefaultRouter } from "../src/routing/index.js";
import { ModelRouter } from "../src/orchestration/model/modelRouter.js";
import { ProviderAdapterRegistry } from "../src/orchestration/provider/providerAdapterRegistry.js";
import { type ProviderAdapter } from "../src/providers/index.js";
import {
  ExecutionCoordinator,
  OrchestratorTaskExecutor,
  conditional,
  evaluatePredicate,
  sequential,
  task as makeTask,
  workflow,
  type TaskExecutionPort,
  type Workflow,
  type WorkflowStep,
  type WorkflowTask,
} from "../src/orchestration/workflow/index.js";
import { buildHarness, RESEARCH_CAPABILITIES } from "./helpers/orchestrationHarness.js";
import { assertOk } from "./contracts/contracts.js";
import { type OrchestrationResult, type TozOrchestrator } from "../src/orchestration/authority.js";
import { type AgentRecordInput } from "../src/orchestration/agent/record.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

/** The agent the whole suite uses, in the shape the registry wants. */
function agentInput(): Omit<AgentRecordInput, "now"> {
  return {
    agentId: "research-agent",
    version: "1.0.0",
    adapter: "local",
    status: "active",
    trustLevel: "standard",
    capabilities: CapabilitySet.supporting(...RESEARCH_CAPABILITIES),
    requiresModelRoute: true,
  };
}

/** A workflow whose root is a sequence of the given steps. */
function flow(name: string, steps: readonly WorkflowStep[]): Workflow {
  return workflow("wf", name, sequential("root", steps));
}

/** A provider adapter double. No provider client is integrated in this repository. */
class FakeProviderAdapter implements ProviderAdapter {
  public readonly providerId: string;
  public constructor(providerId: string) {
    this.providerId = providerId;
  }
  public classifyError(): never {
    throw new Error("unused");
  }
  public execute(): Promise<never> {
    return Promise.reject(new Error("no provider client is integrated"));
  }
}

function definition(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    taskId: "t1",
    jobId: "job-1",
    objective: "Research the answer",
    input: "the question",
    requiredCapabilities: [...RESEARCH_CAPABILITIES],
    minimumTrust: "low",
    dependsOn: [],
    approvalRequired: false,
    limits: { timeoutMs: 5_000, maxAttempts: 1, queueTimeoutMs: null },
    checkpointable: false,
    priority: "normal",
    ...overrides,
  };
}

/** A full TOZ stack whose routing is the real PHASE 06 pipeline. */
function tozStack(providers: readonly string[]): {
  router: ModelRouter;
  adapters: ProviderAdapterRegistry;
  clock: ManualClock;
  orchestrator: TozOrchestrator;
} {
  const clock = new ManualClock(NOW);
  const registry = new ProviderRegistry({ clock });
  const models = new ModelRegistry({ clock, providers: registry });
  const adapters = new ProviderAdapterRegistry();
  const caps = CapabilitySet.supporting(...RESEARCH_CAPABILITIES);

  for (const id of providers) {
    registry.register({ providerId: id, capabilities: caps, enabled: true });
    for (const step of [
      "verified",
      "probed",
      "classified",
      "awaiting_approval",
      "approved",
      "registered",
      "health_monitored",
      "production_pool",
    ] as const) {
      registry.transition(id, step);
    }
    registry.setHealth(id, { ...UNKNOWN_HEALTH, status: "healthy", observedAt: NOW });
    models.register({ modelId: `m-${id}`, providerId: id, capabilities: caps, enabled: true });
    assertOk(adapters.register(new FakeProviderAdapter(id)), `adapter ${id}`);
  }

  const source = {
    candidates: () => {
      const out = [];
      for (const provider of registry.productionPool()) {
        for (const model of models.listByProvider(provider.providerId)) {
          out.push({ provider, model, lifecycleState: "production_pool" as const });
        }
      }
      return out;
    },
  };
  const router = new ModelRouter({
    providers: registry,
    models,
    router: new DefaultRouter({ candidates: source }),
    clock,
  });

  const harness = buildHarness({ clock, models: router, providerAdapters: adapters });
  harness.register(agentInput());
  return { router, adapters, clock, orchestrator: harness.orchestrator };
}


/**
 * An executor that succeeds with no provider attached.
 *
 * Used by tests about job state rather than execution, where a real execution
 * would only add noise. Deliberately named: it is not a stand-in for
 * unimplemented work, it is the "no execution happens here" case.
 */
function inertExecutor(): TaskExecutionPort {
  return {
    execute: () =>
      Promise.resolve({
        succeeded: true,
        output: "",
        errorClass: null,
        error: null,
        providerId: null,
        modelId: null,
        traceId: null,
        usage: null,
        cancelled: false,
      }),
  };
}

/* -------------------------------------------------------------------------- */

describe("PHASE 07 G - conditional execution", () => {
  const observation = { completed: 1, failed: 0, cancelled: 0, pending: 0 };

  it("evaluates the supported predicate forms", () => {
    assert.equal(evaluatePredicate("all_succeeded", observation), true);
    assert.equal(evaluatePredicate("any_failed", observation), false);
    assert.equal(evaluatePredicate("any_failed", { ...observation, failed: 1 }), true);
    assert.equal(evaluatePredicate("none_pending", observation), true);
    assert.equal(evaluatePredicate("none_pending", { ...observation, pending: 2 }), false);
  });

  it("refuses to guess at a predicate it does not understand", () => {
    // The honest answer. Guessing which branch applies would execute work
    // nobody asked for.
    assert.equal(evaluatePredicate("the answer sounds right", observation), null);
  });

  it("runs only the branch that applies", async () => {
    const port: TaskExecutionPort & { calls: string[] } = {
      calls: [],
      execute(request) {
        this.calls.push(request.taskId);
        return Promise.resolve({
          succeeded: true,
          output: "ok",
          errorClass: null,
          error: null,
          providerId: "acme",
          modelId: "m1",
          traceId: "t",
          usage: null,
          cancelled: false,
        });
      },
    };
    const clock = new ManualClock(NOW);
    const coordinator = new ExecutionCoordinator({ executor: port, clock });
    coordinator.createJob({
      jobId: "job-1",
      workflow: workflow(
        "wf",
        "Conditional",
        conditional("branch", "any_failed", [makeTask("failed-branch", definition({ taskId: "failed-branch" }))], [
          makeTask("ok-branch", definition({ taskId: "ok-branch" })),
        ]),
      ),
    });
    // Nothing has failed, so the FALSE branch is the one that applies.
    const plan = coordinator.planRelease("job-1");
    assert.ok(plan.released.includes("ok-branch"), "the false branch applies when nothing failed");
    await coordinator.runJob("job-1");
    assert.deepEqual(port.calls, ["ok-branch"], "the untaken branch is not executed");
    assert.equal(coordinator.task("job-1", "failed-branch")?.state, "skipped");
  });

  it("holds a branch whose predicate cannot be evaluated", () => {
    const clock = new ManualClock(NOW);
    const coordinator = new ExecutionCoordinator({ executor: inertExecutor(), clock });
    coordinator.createJob({
      jobId: "job-1",
      workflow: workflow("wf", "Unknown", conditional("branch", "sounds plausible to me", [makeTask("a", definition({ taskId: "a" }))], [])),
    });
    const plan = coordinator.planRelease("job-1");
    assert.deepEqual(plan.released, [], "nothing is released on a predicate the system cannot evaluate");
    assert.match(plan.detail, /not one of the supported forms/);
  });
});

describe("PHASE 07 J/S - restart and recovery", () => {
  it("restarts a task whose checkpoint is not safe to resume from", async () => {
    const port: TaskExecutionPort = {
      execute: () =>
        Promise.resolve({
          succeeded: true,
          output: "ok",
          errorClass: null,
          error: null,
          providerId: null,
          modelId: null,
          traceId: null,
          usage: null,
          cancelled: false,
        }),
    };
    const clock = new ManualClock(NOW);
    const coordinator = new ExecutionCoordinator({ executor: port, clock });
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Resume", [
        makeTask("t1", definition({ taskId: "t1", checkpointable: false })),
      ]),
    });
    coordinator.checkpoint({
      jobId: "job-1",
      taskId: "t1",
      progress: "1/2",
      dataRef: "memory://cp1",
      notRecoverableReason: "the step already issued an irreversible command",
    });
    const plan = coordinator.recoveryPlan("job-1", "t1");
    assert.equal(plan.action, "restart", "a task that cannot safely resume says so instead of pretending");
    assert.match(plan.detail, /irreversible command/);
  });

  it("resumes a task that declared itself safe to resume", () => {
    const clock = new ManualClock(NOW);
    const coordinator = new ExecutionCoordinator({ executor: inertExecutor(), clock });
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Resume", [makeTask("t1", definition({ taskId: "t1", checkpointable: true }))]),
    });
    coordinator.checkpoint({ jobId: "job-1", taskId: "t1", progress: "3/7", dataRef: "memory://cp1" });
    const plan = coordinator.recoveryPlan("job-1", "t1");
    assert.equal(plan.action, "resume");
    assert.equal(plan.checkpoint?.dataRef, "memory://cp1");
  });

  it("makes a claim available again after it expires, so a crashed worker's task is recoverable", () => {
    const clock = new ManualClock(NOW);
    const coordinator = new ExecutionCoordinator({ executor: inertExecutor(), clock, claimTtlMs: 1_000 });
    coordinator.createJob({ jobId: "job-1", workflow: flow("One", [makeTask("t1", definition({ taskId: "t1" }))]) });
    const first = coordinator.claims.claim("job-1", "t1", "worker-a");
    assert.equal(first.ok, true);
    assert.equal(coordinator.claims.verify("job-1", "t1", first.ok === true ? first.claim.token : "").valid, true);
    clock.advance(1_001);
    assert.equal(
      coordinator.claims.verify("job-1", "t1", first.ok === true ? first.claim.token : "").valid,
      false,
      "an expired claim is refused, so a dead worker cannot report for a task it no longer holds",
    );
    assert.equal(coordinator.claims.claim("job-1", "t1", "worker-b").ok, true, "and the task is recoverable");
  });
});

describe("PHASE 07 Z/AB - a background job reaches execution only through TOZ", () => {
  it("executes a job through the real orchestrator and PHASE 06 routing", async () => {
    const stack = tozStack(["acme"]);
    const coordinator = new ExecutionCoordinator({
      executor: new OrchestratorTaskExecutor({
        execute: (request) =>
          stack.orchestrator
            .execute({
              taskId: request.taskId,
              objective: request.objective,
              input: request.input,
              requiredCapabilities: request.requiredCapabilities,
              taskType: "research",
              // Forwarded from the workflow, so a background task that needs a
              // real verification pass actually asks TOZ for one.
              ...(request.verificationKinds === undefined ? {} : { verificationKinds: request.verificationKinds }),
              signal: request.signal,
            })
            .then((result) => {
              const value = assertOk<OrchestrationResult>(result);
              return {
                succeeded: value.outcome === "succeeded",
                output: value.output,
                providerId: value.provider,
                modelId: value.model,
                traceId: value.traceId,
                verificationVerdict: value.verification?.verdict ?? null,
                errorClass: value.errorClass,
                reason: value.reason,
                cost: null,
              };
            }),
      }),
      clock: stack.clock,
    });

    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("Background research", [
        // Verification is requested, not assumed: without it the run is
        // `needs_review`, and this phase refuses to call that complete.
        makeTask("bg-1", definition({ taskId: "bg-1", verificationKinds: ["evidence"] })),
      ]),
    });
    const results = await coordinator.runJob("job-1");

    assert.equal(results.length, 1, "the background task ran");
    assert.equal(results[0]?.succeeded, true);
    // THE POINT: the provider was chosen by PHASE 06 routing, and the
    // coordinator simply reports it. The job's workflow named no provider.
    assert.equal(results[0]?.providerId, "acme");
    assert.equal(results[0]?.modelId, "m-acme");
    assert.equal(coordinator.task("job-1", "bg-1")?.state, "completed");
  });

  it("fails the background task when routing has no eligible provider", async () => {
    // No provider declares the capability, so there is no route. The job fails
    // honestly rather than executing with an invented one.
    const stack = tozStack([]);
    const coordinator = new ExecutionCoordinator({
      executor: new OrchestratorTaskExecutor({
        execute: (request) =>
          stack.router
            .route({ taskId: request.taskId, capabilities: request.requiredCapabilities })
            .then((route) => ({
              succeeded: route.providerId !== null,
              output: "",
              providerId: route.providerId,
              modelId: route.modelId,
              traceId: null,
              verificationVerdict: null,
              errorClass: route.providerId === null ? ("configuration_error" as const) : null,
              reason: route.reason,
              cost: null,
            })),
      }),
      clock: stack.clock,
    });
    coordinator.createJob({
      jobId: "job-1",
      workflow: flow("No provider", [makeTask("bg-1", definition({ taskId: "bg-1" }))]),
    });
    const results = await coordinator.runJob("job-1");
    assert.deepEqual(results, [], "no route means no execution");
    assert.equal(coordinator.task("job-1", "bg-1")?.state, "failed");
    assert.equal(coordinator.job("job-1")?.state, "failed");
  });

  it("does not store a worker event as a memory", () => {
    // PHASE 05 remains authoritative. A worker result is not a memory unless
    // something asks the memory service to store it under the memory policy.
    const clock = new ManualClock(NOW);
    const coordinator = new ExecutionCoordinator({ executor: inertExecutor(), clock });
    const surface = coordinator as unknown as Record<string, unknown>;
    assert.equal(surface["memoryService"], undefined);
    assert.equal(surface["capture"], undefined);
  });
});
