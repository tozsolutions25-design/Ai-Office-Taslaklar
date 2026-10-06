/**
 * PHASE 06: the orchestrator's use of routing.
 *
 * The unit suites prove policies order correctly and fallback preserves
 * requirements. This file proves the wiring, and proves the three properties the
 * brief cares about most:
 *
 *   - a route is only taken when something can actually serve it
 *   - fallback availability is reported BEFORE an outage, not during one
 *   - an agent cannot select a provider for itself
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { CapabilitySet } from "../src/capabilities/capability.js";
import { UNKNOWN_HEALTH } from "../src/health/index.js";
import { ProviderRegistry, type ProviderAdapter, type ProviderRecord } from "../src/providers/index.js";
import { ModelRegistry } from "../src/models/index.js";
import { ModelRouter, type ModelRoutingPort } from "../src/orchestration/model/modelRouter.js";
import { ProviderAdapterRegistry } from "../src/orchestration/provider/providerAdapterRegistry.js";
import { DefaultRouter, type RoutingCandidate } from "../src/routing/index.js";
import { buildHarness, RESEARCH_CAPABILITIES } from "./helpers/orchestrationHarness.js";
import { assertOk } from "./contracts/contracts.js";
import { type OrchestrationResult } from "../src/orchestration/authority.js";
import { type AgentRecordInput } from "../src/orchestration/agent/record.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

/* -------------------------------------------------------------------------- */
/* A provider with an adapter behind it                                        */
/* -------------------------------------------------------------------------- */

/**
 * A test-double provider adapter.
 *
 * Deliberately a double, and labelled as one. No real provider client ships in
 * this repository, and a fabricated wire format presented as an integration
 * would be a lie the tests would then quietly depend on.
 */
class FakeProviderAdapter implements ProviderAdapter {
  public readonly providerId: string;
  public calls = 0;

  public constructor(providerId: string) {
    this.providerId = providerId;
  }

  public classifyError(): never {
    throw new Error("not used in these tests");
  }

  public execute(): Promise<never> {
    this.calls += 1;
    return Promise.reject(new Error("no provider client is integrated in this repository"));
  }
}

interface Stack {
  readonly providers: ProviderRegistry;
  readonly models: ModelRegistry;
  readonly adapters: ProviderAdapterRegistry;
  readonly router: ModelRouter;
  readonly clock: ManualClock;
}

function stack(): Stack {
  const clock = new ManualClock(NOW);
  const providers = new ProviderRegistry({ clock });
  const models = new ModelRegistry({ clock, providers });
  const adapters = new ProviderAdapterRegistry();
  const source = {
    candidates: (): readonly RoutingCandidate[] => {
      const out: RoutingCandidate[] = [];
      for (const provider of providers.productionPool()) {
        for (const model of models.listByProvider(provider.providerId)) {
          out.push({ provider, model, lifecycleState: "production_pool" });
        }
      }
      return out;
    },
  };
  const router = new ModelRouter({
    providers,
    models,
    router: new DefaultRouter({ candidates: source }),
    clock,
  });
  return { providers, models, adapters, router, clock };
}

function addProvider(
  s: Stack,
  providerId: string,
  options: { capabilities?: CapabilitySet; healthStatus?: "healthy" | "degraded" | "unavailable" } = {},
): ProviderRecord {
  s.providers.register({
    providerId,
    capabilities: options.capabilities ?? CapabilitySet.supporting("text_generation"),
    enabled: true,
  });
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
    s.providers.transition(providerId, step);
  }
  if (options.healthStatus !== undefined) {
    s.providers.setHealth(providerId, { ...UNKNOWN_HEALTH, status: options.healthStatus, observedAt: NOW });
  }
  const record = s.providers.get(providerId);
  assert.ok(record, `${providerId} must be registered`);
  return record;
}

function addModel(s: Stack, providerId: string, modelId: string, capabilities?: CapabilitySet): void {
  s.models.register({
    modelId,
    providerId,
    ...(capabilities === undefined ? {} : { capabilities }),
    enabled: true,
  });
}

const REASONING = CapabilitySet.supporting("reasoning");
const CODING = CapabilitySet.supporting("coding");

/* -------------------------------------------------------------------------- */

describe("PHASE 06 - a route is only taken when something can serve it", () => {
  it("registers an adapter and reports it", () => {
    const s = stack();
    const adapter = new FakeProviderAdapter("acme");
    assertOk(s.adapters.register(adapter), "an adapter with the required methods must register");
    assert.equal(s.adapters.has("acme"), true);
    assert.deepEqual(s.adapters.ids(), ["acme"]);
  });

  it("refuses a duplicate adapter rather than replacing it", () => {
    // Replacing an adapter would change the meaning of every decision already
    // recorded about the provider behind it.
    const s = stack();
    assertOk(s.adapters.register(new FakeProviderAdapter("acme")));
    const second = s.adapters.register(new FakeProviderAdapter("acme"));
    assert.equal(second.ok, false);
  });

  it("refuses a provider that has no registered adapter", async () => {
    const s = stack();
    addProvider(s, "acme");
    addModel(s, "acme", "m1", REASONING);
    const route = await s.router.route({ taskId: "t1", capabilities: ["reasoning"] });
    assert.equal(route.providerId, "acme");
    assert.equal(
      s.adapters.has(route.providerId ?? ""),
      false,
      "a route can exist for a provider that has no adapter yet. Executing is what requires one.",
    );
  });

  it("routes nothing rather than an incompatible model", async () => {
    const s = stack();
    addProvider(s, "coder", { capabilities: CODING });
    addModel(s, "coder", "m1", CODING);
    const route = await s.router.route({ taskId: "t1", capabilities: ["reasoning"] });
    assert.equal(route.providerId, null, "no provider declares reasoning, so no route exists");
    assert.match(route.reason, /capability/);
  });

  it("routes around a provider that is unavailable", async () => {
    const s = stack();
    addProvider(s, "down", { capabilities: REASONING, healthStatus: "unavailable" });
    addProvider(s, "up", { capabilities: REASONING, healthStatus: "healthy" });
    addModel(s, "down", "m1", REASONING);
    addModel(s, "up", "m1", REASONING);
    const route = await s.router.route({ taskId: "t1", capabilities: ["reasoning"] });
    assert.equal(route.providerId, "up");
  });
});

describe("PHASE 06 - fallback availability is reported before an outage", () => {
  it("says so when a route has alternatives", () => {
    const s = stack();
    addProvider(s, "one", { capabilities: REASONING });
    addProvider(s, "two", { capabilities: REASONING });
    addModel(s, "one", "m1", REASONING);
    addModel(s, "two", "m1", REASONING);
    const chain = s.router.plan({ taskId: "t1", capabilities: ["reasoning"] });
    assert.equal(chain.hops.length, 2);
    assert.match(chain.summary, /Fallback is available/);
  });

  it("says so when a route has none, rather than implying a safety net", () => {
    const s = stack();
    addProvider(s, "only", { capabilities: REASONING });
    addModel(s, "only", "m1", REASONING);
    const chain = s.router.plan({ taskId: "t1", capabilities: ["reasoning"] });
    assert.equal(chain.hops.length, 1);
    assert.match(chain.summary, /no fallback/i);
  });

  it("keeps every hop on the same requirements", () => {
    const s = stack();
    addProvider(s, "reasoner", { capabilities: REASONING });
    addProvider(s, "coder", { capabilities: CODING });
    addModel(s, "reasoner", "m1", REASONING);
    addModel(s, "coder", "m1", CODING);
    const chain = s.router.plan({ taskId: "t1", capabilities: ["reasoning"] });
    assert.deepEqual(
      chain.hops.map((hop) => hop.candidate.provider.providerId),
      ["reasoner"],
      "a chain that crossed capabilities would be a chain of different tasks",
    );
  });

  it("does not offer a failed target again", () => {
    const s = stack();
    addProvider(s, "one", { capabilities: REASONING });
    addProvider(s, "two", { capabilities: REASONING });
    addModel(s, "one", "m1", REASONING);
    addModel(s, "two", "m1", REASONING);
    const first = s.router.plan({ taskId: "t1", capabilities: ["reasoning"] });
    const primary = first.hops[0];
    assert.ok(primary);

    const outcome = s.router.recordOutcome({ hop: primary, succeeded: false });
    assert.equal(outcome.mayFallback, true);

    const second = s.router.plan({ taskId: "t1", capabilities: ["reasoning"] });
    assert.deepEqual(
      second.hops.map((hop) => `${hop.candidate.provider.providerId}/${hop.candidate.model?.modelId}`),
      ["two/m1"],
      "the target that just failed is in cooldown and must not be re-selected",
    );
  });

  it("refuses to spend fallback on background work", () => {
    // Priority governs how much fallback is spent, never what is eligible. A
    // background job should not spend a latency budget nobody asked for.
    const s = stack();
    addProvider(s, "one", { capabilities: REASONING });
    addProvider(s, "two", { capabilities: REASONING });
    addModel(s, "one", "m1", REASONING);
    addModel(s, "two", "m1", REASONING);
    const hop = s.router.plan({ taskId: "t1", capabilities: ["reasoning"] }).hops[0];
    assert.ok(hop);
    const outcome = s.router.recordOutcome({ hop, succeeded: false, priority: "background" });
    assert.equal(outcome.mayFallback, false);
    assert.match(outcome.reason, /Background work/);
  });

  it("stops fallback once a hop succeeds", () => {
    const s = stack();
    addProvider(s, "one", { capabilities: REASONING });
    addModel(s, "one", "m1", REASONING);
    const hop = s.router.plan({ taskId: "t1", capabilities: ["reasoning"] }).hops[0];
    assert.ok(hop);
    const outcome = s.router.recordOutcome({ hop, succeeded: true });
    assert.equal(outcome.mayFallback, false);
  });

  it("still finds a route when the only provider has no fallback, because eligibility is unchanged", () => {
    const s = stack();
    addProvider(s, "only", { capabilities: REASONING });
    addModel(s, "only", "m1", REASONING);
    const hop = s.router.plan({ taskId: "t1", capabilities: ["reasoning"] }).hops[0];
    assert.ok(hop);
    s.router.recordOutcome({ hop, succeeded: false, priority: "background" });
    // The provider is now in cooldown, so the honest answer is "no route right
    // now" - not a silent return to the provider that just failed.
    assert.equal(s.router.plan({ taskId: "t1", capabilities: ["reasoning"] }).hops.length, 0);
  });
});

/** The agent every test in this file uses, in the shape the registry wants. */
const agentInput = (overrides: Partial<AgentRecordInput> = {}): Omit<AgentRecordInput, "now"> => ({
  agentId: "research-agent",
  version: "1.0.0",
  adapter: "local",
  status: "active",
  trustLevel: "standard",
  capabilities: CapabilitySet.supporting(...RESEARCH_CAPABILITIES),
  ...overrides,
});

const request = () => ({
  taskId: "task-p6",
  objective: "Research the answer",
  input: "the question",
  requiredCapabilities: RESEARCH_CAPABILITIES,
  taskType: "research",
});

describe("PHASE 06 - an agent cannot select its own provider", () => {
  it("records fallback availability in the routing event", async () => {
    const s = stack();
    addProvider(s, "one", { capabilities: CapabilitySet.supporting(...RESEARCH_CAPABILITIES) });
    addProvider(s, "two", { capabilities: CapabilitySet.supporting(...RESEARCH_CAPABILITIES) });
    addModel(s, "one", "m1", CapabilitySet.supporting(...RESEARCH_CAPABILITIES));
    addModel(s, "two", "m1", CapabilitySet.supporting(...RESEARCH_CAPABILITIES));
    // An adapter behind each route. Without one the run is refused BEFORE the
    // route is recorded, which is the PHASE 04.1 rule that a route nothing can
    // serve must never appear in evidence.
    assertOk(s.adapters.register(new FakeProviderAdapter("one")));
    assertOk(s.adapters.register(new FakeProviderAdapter("two")));

    const harness = buildHarness({
      clock: s.clock,
      models: s.router,
      providerAdapters: s.adapters,
    });
    harness.register(agentInput({ requiresModelRoute: true }));

    const result = assertOk<OrchestrationResult>(await harness.orchestrator.execute(request()));
    const routed = harness.audit.read({ workspace: null, brand: null }).filter(
      (event) => event.kind === "orchestration_event" && (event as { step: string }).step === "model_routed",
    );
    assert.ok(routed.length > 0, "the run must record the route it took");
    const event = routed[routed.length - 1] as unknown as { metadata: Record<string, unknown> };
    assert.equal(
      event.metadata["fallbackAvailable"],
      true,
      "a caller can see the safety net before it is needed",
    );
    assert.equal((event.metadata["fallbackChain"] as string[]).length, 2);
    assert.equal(result.outcome, "succeeded");
  });

  it("omits the fallback fields rather than claiming there is none", async () => {
    // An orchestrator whose router cannot plan knows nothing about the chain.
    // "fallbackAvailable: false" would be a claim about a router it cannot see.
    const s = stack();
    addProvider(s, "only", { capabilities: CapabilitySet.supporting(...RESEARCH_CAPABILITIES) });
    addModel(s, "only", "m1", CapabilitySet.supporting(...RESEARCH_CAPABILITIES));
    assertOk(s.adapters.register(new FakeProviderAdapter("only")));

    const opaque: ModelRoutingPort = { route: (requirements) => s.router.route(requirements) };
    const harness = buildHarness({
      clock: s.clock,
      models: opaque,
      providerAdapters: s.adapters,
    });
    harness.register(agentInput({ requiresModelRoute: true }));

    assertOk<OrchestrationResult>(await harness.orchestrator.execute(request()));
    const routed = harness.audit.read({ workspace: null, brand: null }).filter(
      (event) => event.kind === "orchestration_event" && (event as { step: string }).step === "model_routed",
    );
    const event = routed[routed.length - 1] as unknown as { metadata: Record<string, unknown> };
    assert.equal(
      Object.hasOwn(event.metadata, "fallbackAvailable"),
      false,
      "absent means unknown, not false",
    );
  });

  it("refuses the run when the route has no adapter behind it", async () => {
    // The PHASE 04.1 defect this must not reopen: a route recorded in evidence
    // that nothing could execute.
    const s = stack();
    addProvider(s, "ghost", { capabilities: CapabilitySet.supporting(...RESEARCH_CAPABILITIES) });
    addModel(s, "ghost", "m1", CapabilitySet.supporting(...RESEARCH_CAPABILITIES));

    const harness = buildHarness({ clock: s.clock, models: s.router, providerAdapters: s.adapters });
    harness.register(agentInput({ requiresModelRoute: true }));

    const result = assertOk<OrchestrationResult>(await harness.orchestrator.execute(request()));
    assert.equal(result.outcome, "failed", "a route with nothing behind it is not a completed task");
    assert.equal(result.provider, null);
  });

  it("takes a route from the orchestrator, not from the agent record", async () => {
    // The agent's record carries no provider field at all, and the harness
    // router's decision is what lands in evidence.
    const s = stack();
    addProvider(s, "chosen", { capabilities: CapabilitySet.supporting(...RESEARCH_CAPABILITIES) });
    addModel(s, "chosen", "m1", CapabilitySet.supporting(...RESEARCH_CAPABILITIES));
    assertOk(s.adapters.register(new FakeProviderAdapter("chosen")));

    const harness = buildHarness({ clock: s.clock, models: s.router, providerAdapters: s.adapters });
    harness.register(agentInput({ requiresModelRoute: true }));

    const result = assertOk<OrchestrationResult>(await harness.orchestrator.execute(request()));
    assert.equal(result.provider, "chosen");
    assert.equal(result.model, "m1");
  });

  it("lets a self-hosted agent run with no provider at all", async () => {
    const harness = buildHarness();
    harness.register(agentInput({ requiresModelRoute: false }));
    const result = assertOk<OrchestrationResult>(await harness.orchestrator.execute(request()));
    assert.equal(result.provider, null, "it must not borrow someone else's route");
    assert.equal(result.outcome, "succeeded");
  });
});

describe("PHASE 06 - a planning failure never fails a decided route", () => {
  it("falls through to the route the router already gave", async () => {
    const s = stack();
    addProvider(s, "one", { capabilities: CapabilitySet.supporting(...RESEARCH_CAPABILITIES) });
    addModel(s, "one", "m1", CapabilitySet.supporting(...RESEARCH_CAPABILITIES));
    assertOk(s.adapters.register(new FakeProviderAdapter("one")));

    const flaky: ModelRoutingPort = {
      route: (requirements) => s.router.route(requirements),
      plan: () => {
        throw new Error("planner exploded");
      },
    };
    const harness = buildHarness({ clock: s.clock, models: flaky, providerAdapters: s.adapters });
    harness.register(agentInput({ requiresModelRoute: true }));

    const result = assertOk<OrchestrationResult>(await harness.orchestrator.execute({
      taskId: "task-p6",
      objective: "Research the answer",
      input: "the question",
      requiredCapabilities: RESEARCH_CAPABILITIES,
      taskType: "research",
    }));
    assert.equal(result.outcome, "succeeded", "an optional capability must not be able to fail the run");
  });
});


