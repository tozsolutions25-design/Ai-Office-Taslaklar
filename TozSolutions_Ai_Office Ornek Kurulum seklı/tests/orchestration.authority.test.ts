import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";

/** PHASE 06: the workspace every subject and store in this file acts in. */
const WS = workspaceRef("test-workspace");

/** The grant the resolved identity below holds, so a run is permitted at all. */
const RESEARCH_GRANT = {
  operation: "workflow.execute" as const,
  resources: [],
  allowList: [],
  capabilities: [],
  trustFloor: "low" as const,
  expiresAt: null,
};

import { CapabilitySet } from "../src/capabilities/capability.js";
import { DenyAllInputPolicy, DenyAllOutputPolicy, HeuristicInjectionInputPolicy } from "../src/orchestration/policy/security.js";
import { DriftGuard } from "../src/orchestration/policy/antiDrift.js";
import { UnavailableAgentAdapter } from "../src/orchestration/agent/adapter.js";
import { type OrchestrationRequest, type OrchestrationResult } from "../src/orchestration/authority.js";
import { type ExecutionPlan } from "../src/orchestration/task/plan.js";
import { type VerificationKind } from "../src/orchestration/verification/verifier.js";
import { buildEvidence, mergeEvidence } from "../src/orchestration/evidence/evidence.js";
import { createSecurityContext, withProvenance, type SecurityContext } from "../src/orchestration/governance/index.js";
import { LocalAgentAdapter } from "./helpers/localAgentAdapter.js";
import { FixedModelRouter, RESEARCH_CAPABILITIES, buildHarness } from "./helpers/orchestrationHarness.js";
import { assertOk } from "./contracts/contracts.js";

/** PHASE 06: the workspace every subject and store in this file acts in. */
/** Runs a task and returns the settled result, failing the test if it did not. */
async function run(
  harness: ReturnType<typeof buildHarness>,
  req: OrchestrationRequest,
): Promise<OrchestrationResult> {
  return assertOk<OrchestrationResult>(await harness.orchestrator.execute(req));
}

function request(overrides: Partial<OrchestrationRequest> = {}): OrchestrationRequest {
  return {
    taskId: "task-1",
    objective: "Research the answer",
    input: "the question",
    requiredCapabilities: RESEARCH_CAPABILITIES,
    taskType: "research",
    ...overrides,
  };
}

/**
 * PHASE 06. A RESOLVED identity carrying a workspace.
 *
 * A context built by `createSecurityContext` is always `"asserted"`, and a
 * workspace that is not resolved is refused - which is the whole of the
 * anti-forgery property. So a test that needs partitioned behaviour must say the
 * identity was resolved, exactly as the composition root does for a deployment.
 */
const RESOLVED_ACTOR = "user:kim";

function resolved(actor: string = RESOLVED_ACTOR): SecurityContext {
  return withProvenance(
    createSecurityContext({ actor, trustLevel: "standard", grants: [RESEARCH_GRANT], workspace: WS }),
    "resolved",
  );
}

function resolvedRequest(overrides: Partial<OrchestrationRequest> = {}): OrchestrationRequest {
  return { ...request(overrides), securityContext: resolved() };
}

function agentInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agentId: "research-agent",
    version: "1.0.0",
    adapter: "local",
    status: "active",
    trustLevel: "standard",
    capabilities: CapabilitySet.supporting(...RESEARCH_CAPABILITIES),
    ...overrides,
  };
}

function registerResearch(register: (input: never) => void, overrides: Record<string, unknown> = {}): void {
  (register as (input: Record<string, unknown>) => void)(agentInput(overrides));
}

function subtaskPlan(subtasks: number, terminalIsLast = true): ExecutionPlan {
  return {
    planId: "plan-1",
    rootTaskId: "task-1",
    objective: "Research the answer",
    topology: "parallel",
    subtasks: Array.from({ length: subtasks }, (_unused, index) => ({
      taskId: `task-1-${index + 1}`,
      parentTaskId: "task-1",
      objective: `Part ${index + 1}`,
      requiredCapabilities: RESEARCH_CAPABILITIES,
      input: "the question",
      expectedOutput: `Answer part ${index + 1}`,
      dependsOn: [],
      limits: { timeoutMs: 1_000, maxRetries: 1, maxChildren: 0 },
      verificationKinds: [] as VerificationKind[],
    })),
    limits: { timeoutMs: 5_000, maxRetries: 1, maxChildren: 0 },
    verificationKinds: [] as VerificationKind[],
    terminalTaskId: terminalIsLast ? `task-1-${subtasks}` : "task-1-1",
  };
}

describe("orchestrator: the happy path", () => {
  it("completes a single-subtask task and reports the output", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);

    const result = await run(harness, request());
    assert.equal(result.state, "completed");
    assert.equal(result.outcome, "succeeded");
    assert.match(result.output, /Research the answer/);
  });

  it("records every step it took", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    const result = await run(harness, request());
    assert.ok(result.steps.length > 0, "a result must be able to explain itself");
  });

  it("names the agent that ran", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    const result = await run(harness, request());
    assert.equal(result.agentId, "research-agent");
    assert.deepEqual(result.agents, ["research-agent@1.0.0"]);
  });

  it("routes through a provider and records it", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    const result = await run(harness, request());
    assert.equal(result.provider, "test-provider");
    assert.equal(result.model, "test-model");
  });

  it("chooses the smallest topology for one subtask", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    const result = await run(harness, request());
    assert.equal(result.topology, "single", "one agent must not be given a swarm");
  });

  it("records evidence naming the agent and the route", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    const result = await run(harness, request());
    assert.ok(result.evidence);
    assert.equal(result.evidence.agentId, "research-agent");
    assert.deepEqual(result.evidence.agents, ["research-agent@1.0.0"]);
    assert.equal(result.evidence.provider, "test-provider");
    assert.equal(result.evidence.status, "succeeded");
  });

  it("attributes resources to the agent that used them", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    await harness.orchestrator.execute(request());
    const usages = harness.resources.usages();
    assert.equal(usages.length, 1);
    assert.equal(usages[0]?.agentId, "research-agent");
    assert.equal(usages[0]?.inputTokens, 10, "measured tokens are recorded, not estimated");
  });

  it("records a feedback entry for the run", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    await harness.orchestrator.execute(request());
    assert.equal(harness.feedback.list().length, 1);
    assert.equal(harness.feedback.list()[0]?.outcome, "succeeded");
  });

  it("writes the outcome to memory under the task scope", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    const memoryPolicy = harness.memoryPolicy;
    assert.ok(memoryPolicy, "the harness supplies a policy by default");
    // PHASE 06. The grant is for the RESOLVED ACTOR, not for `task:task-1`.
    //
    // The old expectation was the identity-confusion bug written down as a fixture:
    // the subject was `task:${request.taskId}`, a caller-supplied string, so the
    // grant was reachable by anyone presenting that taskId. A subject is now the
    // verified identity, and a task may choose a memory KEY - `task-1:outcome` -
    // which is not an identity and grants nothing.
    memoryPolicy.grant({
      subject: { workspace: WS, id: RESOLVED_ACTOR, operatingScope: "project" },
      scopes: ["task"],
      writableScopes: ["task"],
      minimumTrust: "untrusted",
      expiresAt: null,
    });
    await harness.orchestrator.execute(resolvedRequest());
    const stored = await harness.memory.read<{ taskId: string }>(WS, "task", "task-1:outcome");
    assert.equal(stored?.taskId, "task-1");
  });

  it("a caller-chosen taskId cannot reach another subject's grants", async () => {
    // The defect PHASE 06 closes, asserted end to end through the orchestrator
    // rather than through a helper. A run whose `taskId` names someone else's task
    // must not be able to write under that task's grants.
    const harness = buildHarness();
    registerResearch(harness.register);
    const memoryPolicy = harness.memoryPolicy;
    assert.ok(memoryPolicy);
    // A grant that exists, for the actor.
    memoryPolicy.grant({
      subject: { workspace: WS, id: "user:victim", operatingScope: "task" },
      scopes: ["task"],
      writableScopes: ["task"],
      minimumTrust: "untrusted",
      expiresAt: null,
    });
    // A DIFFERENT actor presents the victim's taskId. Under the old model the
    // subject would have been `task:${taskId}` and matched the grant above.
    memoryPolicy.grant({
      subject: { workspace: WS, id: "user:attacker", operatingScope: "task" },
      scopes: ["task"],
      writableScopes: [],
      minimumTrust: "untrusted",
      expiresAt: null,
    });
    const result = assertOk<OrchestrationResult>(
      await harness.orchestrator.execute({
        ...resolvedRequest(),
        taskId: "victim:outcome",
        securityContext: resolved("user:attacker"),
      }),
    );
    assert.equal(
      (await harness.memory.read(WS, "task", "victim:outcome:outcome")),
      null,
      "choosing another run's taskId must not authorise a write under its grants",
    );
    void result;
  });
});

describe("orchestrator: policy refusals", () => {
  it("refuses at the input policy and never executes", async () => {
    const harness = buildHarness({ inputPolicy: new DenyAllInputPolicy() });
    registerResearch(harness.register);
    const result = await run(harness, request());
    assert.equal(result.state, "failed");
    assert.equal(result.outcome, "failed");
    assert.equal(harness.adapter.callCount, 0, "a refused task must not reach an agent");
  });

  it("records the input refusal in the security log", async () => {
    const harness = buildHarness({ inputPolicy: new DenyAllInputPolicy() });
    registerResearch(harness.register);
    await harness.orchestrator.execute(request());
    assert.ok(harness.security.refusals().length > 0);
  });

  it("classifies an input refusal as a configuration error, with a reason", async () => {
    const harness = buildHarness({ inputPolicy: new DenyAllInputPolicy() });
    registerResearch(harness.register);
    const result = await run(harness, request());
    assert.equal(result.errorClass, "configuration_error");
    assert.match(result.reason, /refuses all work/);
  });

  it("lets a heuristic policy pass ordinary work through", async () => {
    const harness = buildHarness({ inputPolicy: new HeuristicInjectionInputPolicy() });
    registerResearch(harness.register);
    const result = await run(harness, request());
    assert.equal(result.state, "completed");
  });

  it("refuses at the output policy after the agent ran", async () => {
    const harness = buildHarness({ outputPolicy: new DenyAllOutputPolicy() });
    registerResearch(harness.register);
    const result = await run(harness, request());
    assert.equal(result.state, "failed");
    assert.equal(harness.adapter.callCount, 1, "the agent ran; its output was refused afterwards");
  });

  it("does not return the refused output", async () => {
    const harness = buildHarness({ outputPolicy: new DenyAllOutputPolicy() });
    registerResearch(harness.register);
    const result = await run(harness, request());
    assert.equal(result.output, "", "a refused output must not be handed back");
  });
});

describe("orchestrator: refusals for missing configuration", () => {
  it("fails when no agent is eligible", async () => {
    const harness = buildHarness();
    const result = await run(harness, request());
    assert.equal(result.state, "failed");
    assert.match(result.reason, /No eligible agent/);
  });

  it("fails when an agent is registered but never made available", async () => {
    const harness = buildHarness();
    assertOk(harness.agents.register({ agentId: "research-agent", version: "1.0.0", adapter: "local" }) as never);
    const result = await run(harness, request());
    assert.equal(result.state, "failed");
  });

  it("fails when the agent requires a capability it did not declare", async () => {
    const harness = buildHarness();
    registerResearch(harness.register, { capabilities: CapabilitySet.supporting("coding") });
    const result = await run(harness, request());
    assert.equal(result.state, "failed");
  });

  it("fails when the agent's adapter is not registered", async () => {
    const harness = buildHarness();
    registerResearch(harness.register, { adapter: "absent-adapter" });
    const result = await run(harness, request());
    assert.equal(result.state, "failed");
    assert.match(result.reason, /not registered/);
  });

  it("fails rather than executing when no provider can be routed", async () => {
    const harness = buildHarness({ models: new FixedModelRouter({ providerId: null, modelId: null }) });
    registerResearch(harness.register);
    const result = await run(harness, request());
    assert.equal(result.state, "failed");
    assert.equal(harness.adapter.callCount, 0, "no route means no execution, not an untracked one");
  });

  it("propagates the adapter's classified failure", async () => {
    const harness = buildHarness({
      adapter: new LocalAgentAdapter({
        descriptor: {
          agentId: "research-agent",
          name: "Research agent",
          version: "1.0.0",
          capabilities: { supported: [...RESEARCH_CAPABILITIES], unsupported: [] },
        },
        failWith: "timeout",
      }),
    });
    registerResearch(harness.register);
    const result = await run(harness, request());
    assert.equal(result.state, "failed");
    assert.equal(result.errorClass, "timeout");
  });

  it("keeps the unavailable adapter honest: it never reports success", async () => {
    const harness = buildHarness({ adapter: new UnavailableAgentAdapter() as never });
    registerResearch(harness.register);
    const result = await run(harness, request());
    assert.equal(result.outcome, "failed");
    assert.equal(result.errorClass, "configuration_error");
  });
});

describe("orchestrator: anti-drift", () => {
  it("refuses a plan that exceeds its limits", async () => {
    const harness = buildHarness({ drift: new DriftGuard({ maxSubtasks: 1 }) });
    registerResearch(harness.register);
    const result = await run(harness, request({ plan: subtaskPlan(3) }));
    assert.equal(result.state, "failed");
    assert.match(result.reason, /anti-drift/i);
  });

  it("does not execute anything when it refuses for drift", async () => {
    const harness = buildHarness({ drift: new DriftGuard({ maxSubtasks: 1 }) });
    registerResearch(harness.register);
    await harness.orchestrator.execute(request({ plan: subtaskPlan(3) }));
    assert.equal(harness.adapter.callCount, 0);
  });
});

describe("orchestrator: multi-agent plans", () => {
  it("runs every subtask of a plan, not just the first", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    const result = await run(harness, request({ plan: subtaskPlan(3) }));
    assert.equal(result.state, "completed");
    assert.equal(harness.adapter.callCount, 3, "three subtasks means three executions");
    assert.equal(result.team?.outcomes.length, 3);
    assert.deepEqual(result.team?.succeeded, ["task-1-1", "task-1-2", "task-1-3"]);
  });

  it("returns the terminal subtask's output, not a concatenation", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    const result = await run(harness, request({ plan: subtaskPlan(2) }));
    assert.match(result.output, /Part 2/);
    assert.doesNotMatch(result.output, /Part 1/);
  });

  it("chooses a concurrent topology for independent subtasks", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    const result = await run(harness, request({ plan: subtaskPlan(3) }));
    assert.equal(result.topology, "parallel");
  });

  it("merges evidence from every subtask", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    const result = await run(harness, request({ plan: subtaskPlan(2) }));
    assert.ok(result.evidence);
    assert.deepEqual(result.evidence.agents, ["research-agent@1.0.0"]);
    assert.equal(result.evidence.cost.inputTokens, 20, "token cost is summed across subtasks");
  });

  it("fails the task when one subtask fails, and names the failure", async () => {
    const failing = new LocalAgentAdapter({
      descriptor: {
        agentId: "research-agent",
        name: "Research agent",
        version: "1.0.0",
        capabilities: { supported: [...RESEARCH_CAPABILITIES], unsupported: [] },
      },
      failWith: "temporary_outage",
    });
    const harness = buildHarness({ adapter: failing });
    registerResearch(harness.register);
    const result = await run(harness, request({ plan: subtaskPlan(2) }));
    assert.equal(result.state, "failed");
    assert.equal(result.errorClass, "temporary_outage");
  });

  it("attaches resources to each subtask separately", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    await harness.orchestrator.execute(request({ plan: subtaskPlan(3) }));
    assert.equal(harness.resources.usages().length, 3, "one record per subtask, not one per task");
  });
});

describe("orchestrator: verification", () => {
  it("passes a verified task and records the verdict", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    const result = await run(harness, request({ verificationKinds: ["evidence"] }));
    assert.equal(result.state, "completed");
    assert.equal(result.verification?.verdict, "pass");
  });

  it("fails a task whose verifier fails", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    const result = await run(harness, request({ verificationKinds: ["source"] }));
    // No source verifier is registered, so the verdict cannot be a pass.
    assert.notEqual(result.state, "completed");
    assert.equal(result.verification?.verdict, "needs_review");
  });

  it("escalates when verification cannot decide", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    const result = await run(harness, request({ verificationKinds: ["source"] }));
    assert.equal(result.state, "escalated");
    assert.equal(result.outcome, "escalated");
  });

  it("escalates an unrecognised verification kind instead of ignoring it", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    const result = await run(harness, request({ verificationKinds: ["astrology"] }));
    assert.equal(result.state, "escalated");
    assert.match(result.reason, /astrology/);
  });

  it("completes without verification when none is required, and says so", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    const result = await run(harness, request());
    assert.equal(result.state, "completed");
    assert.match(result.reason, /no verification required/);
  });
});

describe("orchestrator: cancellation", () => {
  it("does not report success when the caller aborts", async () => {
    const controller = new AbortController();
    const harness = buildHarness();
    registerResearch(harness.register);
    controller.abort();
    const result = await run(harness, request({ signal: controller.signal }));
    assert.notEqual(result.outcome, "succeeded");
  });
});

describe("orchestrator: state and traceability", () => {
  it("advances the task through the declared state machine", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    await harness.orchestrator.execute(request());
    assert.equal(harness.orchestrator.stateOf("task-1"), "completed");
  });

  it("knows which tasks it has seen", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    await harness.orchestrator.execute(request());
    assert.deepEqual(harness.orchestrator.knownTaskIds(), ["task-1"]);
  });

  it("traces the selection and the completion", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    await harness.orchestrator.execute(request());
    const kinds = harness.traces.byTrace("trace-1").map((event) => event.kind);
    assert.ok(kinds.includes("agent_selected"));
    assert.ok(kinds.includes("task_completed"));
  });

  it("mirrors orchestration events into the shared audit stream under their own kind", async () => {
    const harness = buildHarness();
    registerResearch(harness.register);
    await run(harness, request());
    const mirrored = harness.audit.read({ workspace: null, brand: null }).filter((event) => event.kind === "orchestration_event");
    assert.ok(mirrored.length > 0, "orchestration events belong in the one shared history");
    const steps = mirrored.map((event) => (event as { step: string }).step);
    assert.ok(steps.includes("agent_selected"), "the audit records which agent was selected");
    assert.ok(steps.includes("task_completed"));
    assert.equal(
      harness.audit.read({ workspace: null, brand: null }).filter((event) => event.kind === "task_transition").length,
      0,
      "orchestration milestones must not be recorded as task state changes",
    );
  });
});

describe("evidence merging", () => {
  const first = buildEvidence({
    taskId: "a",
    traceId: "tr",
    agentId: "one",
    agentVersion: "1.0.0",
    output: "one",
    cost: { inputTokens: 5, outputTokens: 7 },
    status: "succeeded",
    startedAt: 10,
    finishedAt: 20,
  });
  const second = buildEvidence({
    taskId: "b",
    traceId: "tr",
    parentTaskId: "a",
    agentId: "two",
    agentVersion: "2.0.0",
    output: "two",
    cost: { inputTokens: 3, outputTokens: 1 },
    status: "succeeded",
    startedAt: 15,
    finishedAt: 30,
  });

  it("refuses to merge nothing", () => {
    assert.throws(() => mergeEvidence([], { taskId: "t", traceId: "tr", output: "", finishedAt: 0 }), /at least one/);
  });

  it("sums token cost across records", () => {
    const merged = mergeEvidence([first, second], { taskId: "t", traceId: "tr", output: "two", finishedAt: 30 });
    assert.equal(merged.cost.inputTokens, 8);
    assert.equal(merged.cost.outputTokens, 8);
  });

  it("keeps a null measurement null rather than treating it as zero", () => {
    const unmeasured = buildEvidence({
      taskId: "a",
      traceId: "tr",
      output: "x",
      status: "succeeded",
      startedAt: 0,
      finishedAt: 1,
    });
    const merged = mergeEvidence([first, unmeasured], { taskId: "t", traceId: "tr", output: "x", finishedAt: 2 });
    assert.equal(merged.cost.amount, null);
  });

  it("names no single producing agent when more than one took part", () => {
    const merged = mergeEvidence([first, second], { taskId: "t", traceId: "tr", output: "two", finishedAt: 30 });
    assert.deepEqual(merged.agents, ["one@1.0.0", "two@2.0.0"]);
    assert.equal(merged.agentId, null, "a multi-agent task has no single producing agent");
  });

  it("keeps every source and tool call", () => {
    const withSources = buildEvidence({
      taskId: "a",
      traceId: "tr",
      output: "x",
      sources: [{ reference: "https://example.test", excerpt: "e", retrievedAt: 1 }],
      toolCalls: [{ toolId: "search", durationMs: 5, sideEffecting: false }],
      status: "succeeded",
      startedAt: 0,
      finishedAt: 1,
    });
    const merged = mergeEvidence([withSources, second], { taskId: "t", traceId: "tr", output: "x", finishedAt: 2 });
    assert.equal(merged.sources.length, 1);
    assert.equal(merged.toolCalls.length, 1);
  });

  it("reports partial when only some records succeeded", () => {
    const failed = buildEvidence({
      taskId: "b",
      traceId: "tr",
      output: "",
      status: "failed",
      errorClass: "timeout",
      startedAt: 0,
      finishedAt: 1,
    });
    const merged = mergeEvidence([first, failed], { taskId: "t", traceId: "tr", output: "one", finishedAt: 2 });
    assert.equal(merged.status, "partial");
    assert.equal(merged.errorClass, "timeout");
  });

  it("returns a single record unchanged when there is only one", () => {
    const merged = mergeEvidence([first], { taskId: "t", traceId: "tr", output: "one", finishedAt: 20 });
    assert.deepEqual(merged.agents, ["one@1.0.0"]);
  });
});
