/**
 * PHASE 04.1 at the orchestrator level.
 *
 * The tests below drive the real `TozOrchestrator` through the paths PHASE 04.1
 * changed: a self-hosted specialist that needs no provider route, the gate that
 * refuses a route with no adapter behind it, a routed model recorded in the
 * trace, and the audit kinds those produce.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CapabilitySet } from "../src/capabilities/capability.js";
import { AgencyAgentAdapter } from "../src/orchestration/agentsource/agencyAdapter.js";
import { ProviderAdapterRegistry } from "../src/orchestration/provider/providerAdapterRegistry.js";
import { type ProviderAdapter, type ProviderRequest, type ProviderResponse } from "../src/providers/provider.js";
import { type ErrorClass } from "../src/core/errors.js";
import { type OrchestrationRequest, type OrchestrationResult } from "../src/orchestration/authority.js";
import type { AgentOrigin } from "../src/orchestration/agent/record.js";
import { FixedModelRouter, RESEARCH_CAPABILITIES, buildHarness } from "./helpers/orchestrationHarness.js";
import { assertOk } from "./contracts/contracts.js";

/** A test double, labelled as such. Not a provider client. */
class TestProviderAdapter implements ProviderAdapter {
  public readonly providerId = "test-provider";
  public calls = 0;

  public classifyError(): ErrorClass {
    return "unknown";
  }

  public execute(_request: ProviderRequest): Promise<ProviderResponse> {
    this.calls += 1;
    return Promise.resolve({ text: "t", providerId: this.providerId, modelId: "test-model", latencyMs: 1, raw: {} });
  }
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

async function run(harness: ReturnType<typeof buildHarness>, req: OrchestrationRequest): Promise<OrchestrationResult> {
  return assertOk<OrchestrationResult>(await harness.orchestrator.execute(req));
}

interface AgentOptions {
  readonly requiresModelRoute?: boolean;
  readonly adapter?: string;
  readonly origin?: AgentOrigin;
}

function registerAgent(
  register: (input: never) => void,
  options: AgentOptions = {},
): void {
  (register as (input: Record<string, unknown>) => void)({
    agentId: "research-agent",
    version: "1.0.0",
    adapter: options.adapter ?? "local",
    status: "active",
    trustLevel: "standard",
    capabilities: CapabilitySet.supporting(...RESEARCH_CAPABILITIES),
    requiresModelRoute: options.requiresModelRoute ?? true,
    source: options.origin ?? { kind: "native", ref: null },
  });
}

describe("PHASE 04.1 — a self-hosted specialist runs without a provider route", () => {
  it("completes when the agent declares requiresModelRoute: false", async () => {
    const harness = buildHarness();
    registerAgent(harness.register, { requiresModelRoute: false });
    const result = await run(harness, request());
    assert.equal(result.state, "completed");
  });

  it("does not request a route it does not need", async () => {
    const router = new FixedModelRouter({ providerId: null, modelId: null });
    const harness = buildHarness({ models: router });
    registerAgent(harness.register, { requiresModelRoute: false });
    const result = await run(harness, request());
    assert.equal(result.state, "completed", "an unroutable provider must not block a self-hosted specialist");
    assert.deepEqual(router.requests, [], "no routing should have been attempted");
  });

  it("records no provider, because it ran on none", async () => {
    const harness = buildHarness();
    registerAgent(harness.register, { requiresModelRoute: false });
    const result = await run(harness, request());
    assert.equal(result.provider, null);
    assert.equal(result.model, null);
    assert.equal(result.evidence?.provider, null, "evidence must not borrow a provider it did not use");
  });

  it("traces the decision that no route was needed", async () => {
    const harness = buildHarness();
    registerAgent(harness.register, { requiresModelRoute: false });
    await run(harness, request());
    const routed = harness.traces.byKind("model_routed");
    assert.equal(routed.length, 1);
    assert.equal(routed[0]?.provider, null);
    const reason = routed[0]?.metadata["reason"];
    assert.equal(typeof reason, "string");
    assert.match(String(reason), /self-hosted/);
  });

  it("still requires a route for a model-backed agent", async () => {
    const harness = buildHarness({ models: new FixedModelRouter({ providerId: null, modelId: null }) });
    registerAgent(harness.register, { requiresModelRoute: true });
    const result = await run(harness, request());
    assert.equal(result.state, "failed", "REGRESSION: a model-backed agent must not run unrouted");
  });
});

describe("PHASE 04.1 — the model route is gated on an adapter existing", () => {
  it("fails rather than recording a provider with nothing behind it", async () => {
    const harness = buildHarness({ providerAdapters: new ProviderAdapterRegistry() });
    registerAgent(harness.register, { requiresModelRoute: true });
    const result = await run(harness, request());
    assert.equal(result.state, "failed");
    assert.match(result.reason, /no provider adapter is registered/);
  });

  it("does not execute the agent when the route has no adapter", async () => {
    const harness = buildHarness({ providerAdapters: new ProviderAdapterRegistry() });
    registerAgent(harness.register, { requiresModelRoute: true });
    await run(harness, request());
    assert.equal(harness.adapter.callCount, 0, "an unservable route must not be reported as work done");
  });

  it("records the provider only once a route with an adapter exists", async () => {
    const providerAdapters = new ProviderAdapterRegistry();
    assertOk(providerAdapters.register(new TestProviderAdapter()));
    const harness = buildHarness({ providerAdapters });
    registerAgent(harness.register, { requiresModelRoute: true });
    const result = await run(harness, request());
    assert.equal(result.state, "completed");
    assert.equal(result.provider, "test-provider");
  });

  it("traces the route with its reason", async () => {
    const providerAdapters = new ProviderAdapterRegistry();
    assertOk(providerAdapters.register(new TestProviderAdapter()));
    const harness = buildHarness({ providerAdapters });
    registerAgent(harness.register, { requiresModelRoute: true });
    await run(harness, request());
    const routed = harness.traces.byKind("model_routed");
    assert.equal(routed[0]?.provider, "test-provider");
    assert.equal(routed[0]?.model, "test-model");
  });

  it("leaves the gate off when no registry is supplied", async () => {
    // A deployment with no provider involved supplies no registry, and the
    // orchestrator must not invent a check that fails every run.
    const harness = buildHarness();
    registerAgent(harness.register, { requiresModelRoute: true });
    const result = await run(harness, request());
    assert.equal(result.state, "completed");
  });
});

describe("PHASE 04.1 — an agency-sourced agent executes through the agency adapter", () => {
  it("completes an orchestrated run with no agency transport, honestly", async () => {
    // The honest state: the boundary is wired, no agency is connected.
    const harness = buildHarness({ extraAdapters: [new AgencyAgentAdapter({ transport: null })] });
    registerAgent(harness.register, {
      adapter: "agency",
      requiresModelRoute: false,
      origin: { kind: "agency", ref: "alpha.auditor" },
    });
    const result = await run(harness, request());
    assert.equal(result.state, "failed", "no agency is connected, so it must not report success");
    assert.equal(result.errorClass, "configuration_error");
  });

  it("names the agent that was attempted", async () => {
    const harness = buildHarness({ extraAdapters: [new AgencyAgentAdapter({ transport: null })] });
    registerAgent(harness.register, {
      adapter: "agency",
      requiresModelRoute: false,
      origin: { kind: "agency", ref: "alpha.auditor" },
    });
    const result = await run(harness, request());
    assert.deepEqual(result.agents, ["research-agent@1.0.0"]);
  });
});

describe("PHASE 04.1 — provenance survives to the evidence record", () => {
  it("carries the agent key and attempt into provenance", async () => {
    const harness = buildHarness();
    registerAgent(harness.register, { origin: { kind: "agency", ref: "alpha.auditor" } });
    const result = await run(harness, request());
    const provenance = result.evidence?.provenance;
    assert.ok(provenance);
    assert.equal(provenance.agentKey, "research-agent@1.0.0");
    assert.equal(provenance.attempt, 1);
    assert.ok(provenance.sequence >= 1, "a record must be orderable within its trace");
  });

  it("keeps the subtask identity distinct from the task identity", async () => {
    const harness = buildHarness();
    registerAgent(harness.register);
    const result = await run(harness, request());
    const evidence = result.evidence;
    assert.ok(evidence);
    // A record is about the subtask that ran, and reaches the task through its
    // parent. Collapsing the two would make "which step produced this?" and
    // "which task was this?" the same question.
    assert.equal(evidence.taskId, "task-1-1");
    assert.equal(evidence.parentTaskId, "task-1");
    assert.equal(evidence.provenance.subtaskId, "task-1-1");
    assert.equal(result.taskId, "task-1");
  });
});

describe("PHASE 04.1 — audit history uses correct event kinds", () => {
  it("records the run as orchestration events, not task transitions", async () => {
    const harness = buildHarness();
    registerAgent(harness.register, { requiresModelRoute: false });
    await run(harness, request());
    const kinds = new Set(harness.audit.read({ workspace: null, brand: null }).map((event) => event.kind));
    assert.equal(kinds.has("task_transition"), false, "REGRESSION: milestones must not claim a state change");
    assert.equal(kinds.has("orchestration_event"), true);
  });

  it("records selection, routing, evidence and completion as distinct steps", async () => {
    const harness = buildHarness();
    registerAgent(harness.register, { requiresModelRoute: false });
    await run(harness, request());
    const steps = harness.audit
      .read({ workspace: null, brand: null })
      .map((event) => (event as { step?: string }).step)
      .filter((step): step is string => typeof step === "string");
    for (const step of ["agent_selected", "model_routed", "evidence_recorded", "verification_completed", "task_completed"]) {
      assert.ok(steps.includes(step), `expected a ${step} event in the shared history`);
    }
  });

  it("correlates every event to the trace", async () => {
    const harness = buildHarness();
    registerAgent(harness.register, { requiresModelRoute: false });
    await run(harness, request());
    const events = harness.audit.read({ workspace: null, brand: null });
    assert.ok(events.every((event) => event.correlationId === "trace-1"));
  });
});

describe("PHASE 04.1 — an ingested agency roster is orchestrated end to end", () => {
  it("selects and runs a roster-sourced specialist", async () => {
    const { AgentIngestor } = await import("../src/orchestration/index.js");
    const harness = buildHarness({ extraAdapters: [new AgencyAgentAdapter({ transport: null })] });
    const ingestor = new AgentIngestor({
      agents: harness.agents,
      capabilities: harness.capabilities,
      clock: harness.clock,
      promoteToAvailable: true,
    });
    const report = ingestor.ingestDescriptors(
      { kind: "agency", name: "agency" },
      [
        {
          id: "research-agent",
          version: "1.0.0",
          capabilities: [...RESEARCH_CAPABILITIES],
          requiresModelRoute: false,
        },
      ],
    );
    assert.equal(report.registered.length, 1);
    // The record's adapter is the source's name, so the roster must name the
    // adapter that can actually run it.
    const promoted = harness.agents.get("research-agent", "1.0.0");
    assert.ok(promoted, "the roster agent must be in the registry");
    assert.equal(promoted.record.adapter, "agency");
    assert.equal(promoted.record.source.kind, "agency");

    const result = await run(harness, request());
    assert.equal(result.errorClass, "configuration_error", "the agency adapter reports no transport, honestly");
  });
});
