import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AgentRegistry,
  DuplicateAgentError,
  UnknownAgentError,
  AgentLifecycleError,
  allowedAgentTransitions,
  canTransitionAgent,
  type RegisteredAgent,
} from "../src/orchestration/agent/registry.js";
import { type AgentExecutionError, type AgentExecutionResult } from "../src/orchestration/agent/adapter.js";
import { agentKey, buildAgentRecord, isSelectableStatus, meetsTrustFloor, trustRank } from "../src/orchestration/agent/record.js";
import { CapabilityRegistry } from "../src/orchestration/capabilities/registry.js";
import { ManualClock } from "../src/core/clock.js";
import { ValidationError } from "../src/core/errors.js";
import { UNKNOWN_HEALTH } from "../src/health/health.js";
import { CapabilitySet } from "../src/capabilities/capability.js";
import { describeAgentAdapterContract, SAMPLE_DESCRIPTOR, assertErr, assertOk } from "./contracts/contracts.js";
import { LocalAgentAdapter } from "./helpers/localAgentAdapter.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function registry(): { agents: AgentRegistry; clock: ManualClock } {
  const clock = new ManualClock(NOW);
  return { agents: new AgentRegistry({ clock }), clock };
}

function registerAvailable(
  agents: AgentRegistry,
  overrides: Partial<Parameters<AgentRegistry["register"]>[0]> = {},
): RegisteredAgent {
  // `status: "active"` is the default the caller must opt into: a record is
  // never selectable without both a lifecycle of `available` AND an active
  // record status, so a test that means "available" says so.
  const result = assertOk<RegisteredAgent>(
    agents.register({
      agentId: "research-agent",
      version: "1.0.0",
      adapter: "local",
      status: "active",
      ...overrides,
    }),
    "registration must succeed",
  );
  for (const step of ["verified", "registered", "available"] as const) {
    assertOk(agents.transition("research-agent", "1.0.0", step), `lifecycle ${step}`);
  }
  return result;
}

describe("agent registry", () => {
  it("registers an agent and reports its lifecycle", () => {
    const { agents } = registry();
    const result = assertOk<RegisteredAgent>(
      agents.register({ agentId: "a1", version: "1.0.0", adapter: "local" }),
    );
    assert.equal(result.record.agentId, "a1");
    assert.equal(result.record.version, "1.0.0");
    assert.equal(result.lifecycle, "discovered");
    assert.equal(agents.size, 1);
  });

  it("looks an agent up by id and version", () => {
    const { agents } = registry();
    registerAvailable(agents);
    const found = agents.get("research-agent", "1.0.0");
    assert.ok(found);
    assert.equal(found.record.agentId, "research-agent");
    assert.equal(agents.has("research-agent", "1.0.0"), true);
  });

  it("rejects a duplicate id and version", () => {
    const { agents } = registry();
    registerAvailable(agents);
    const duplicate = agents.register({ agentId: "research-agent", version: "1.0.0", adapter: "local" });
    const error = assertErr(duplicate);
    assert.ok(error instanceof DuplicateAgentError);
    assert.equal(agents.size, 1, "a rejected duplicate must not change the size");
  });

  it("accepts a new version of the same agent as a separate entry", () => {
    const { agents } = registry();
    registerAvailable(agents);
    assertOk(agents.register({ agentId: "research-agent", version: "2.0.0", adapter: "local" }));
    assert.equal(agents.size, 2, "a version upgrade is a new record, not a replacement");
    assert.equal(agents.versionsOf("research-agent").length, 2);
  });

  it("rejects an invalid agent id", () => {
    const { agents } = registry();
    const result = agents.register({ agentId: "", version: "1.0.0", adapter: "local" });
    const error = assertErr(result);
    assert.ok(error instanceof ValidationError);
  });

  it("rejects an invalid version", () => {
    const { agents } = registry();
    assertErr(agents.register({ agentId: "a", version: "bad version!", adapter: "local" }));
  });

  it("requires an adapter identifier", () => {
    const { agents } = registry();
    assertErr(agents.register({ agentId: "a", version: "1.0.0", adapter: "" }));
  });

  it("rejects a measured latency declared alongside a latency class", () => {
    const { agents } = registry();
    // The class is derived from the measurement, so supplying both is a claim
    // that cannot be verified.
    const result = agents.register({
      agentId: "a",
      version: "1.0.0",
      adapter: "local",
      measuredLatencyMs: 120,
      latencyClass: "fast",
    });
    assertErr(result);
  });

  it("reports a missing agent rather than returning undefined", () => {
    const { agents } = registry();
    assert.equal(agents.get("ghost", "1.0.0"), null);
    const error = assertErr(agents.require("ghost", "1.0.0"));
    assert.ok(error instanceof UnknownAgentError);
  });
});

describe("agent lifecycle", () => {
  it("requires verification before an agent becomes available", () => {
    const { agents } = registry();
    agents.register({ agentId: "a", version: "1.0.0", adapter: "local" });
    // A freshly registered agent must never be selectable.
    const direct = assertErr<AgentLifecycleError>(agents.transition("a", "1.0.0", "available"));
    assert.equal(direct.from, "discovered");
    assert.equal(agents.get("a", "1.0.0")?.lifecycle, "discovered", "a refused transition must not change state");
  });

  it("walks the full lifecycle", () => {
    const { agents } = registry();
    registerAvailable(agents);
    assert.equal(agents.get("a", "x"), null);
    assert.equal(agents.get("research-agent", "1.0.0")?.lifecycle, "available");
  });

  it("declares its legal edges", () => {
    assert.ok(allowedAgentTransitions("discovered").includes("verified"));
    assert.equal(canTransitionAgent("discovered", "available"), false);
    assert.equal(canTransitionAgent("retired", "available"), false);
    assert.equal(canTransitionAgent("verified", "registered"), true);
    assert.equal(canTransitionAgent("registered", "available"), true);
  });

  it("refuses an illegal transition with a specific error", () => {
    const { agents } = registry();
    agents.register({ agentId: "a", version: "1.0.0", adapter: "local" });
    const error = assertErr<AgentLifecycleError>(agents.transition("a", "1.0.0", "available"));
    assert.ok(error instanceof AgentLifecycleError);
    assert.equal(error.from, "discovered");
    assert.equal(error.to, "available");
  });

  it("allows a draining agent to return to service", () => {
    const { agents } = registry();
    registerAvailable(agents);
    assertOk(agents.transition("research-agent", "1.0.0", "draining"));
    assertOk(agents.transition("research-agent", "1.0.0", "available"));
  });

  it("retires an agent and blocks further transitions", () => {
    const { agents } = registry();
    registerAvailable(agents);
    assertOk(agents.retire("research-agent", "1.0.0"));
    assert.equal(agents.selectable().length, 0);
    assertErr(agents.transition("research-agent", "1.0.0", "available"));
  });
});

describe("agent selectability", () => {
  it("lists only lifecycle-available and record-active agents", () => {
    const { agents } = registry();
    registerAvailable(agents);
    assert.equal(agents.selectable().length, 1);
    assertOk(agents.setStatus("research-agent", "1.0.0", "disabled"));
    assert.equal(agents.selectable().length, 0, "a disabled record is not selectable");
  });

  it("excludes an agent that is registered but not yet available", () => {
    const { agents } = registry();
    agents.register({ agentId: "a", version: "1.0.0", adapter: "local", status: "active" });
    assert.equal(agents.selectable().length, 0, "an active record is not enough without the lifecycle state");
  });

  it("excludes an unhealthy agent from the selectable set only via the pool, not the registry", () => {
    // The registry reports availability; health filtering belongs to the pool.
    // Keeping those separate means a registry can hold an unhealthy agent so an
    // operator can see it exists.
    const { agents } = registry();
    registerAvailable(agents);
    assertOk(agents.setHealth("research-agent", "1.0.0", { ...UNKNOWN_HEALTH, status: "unavailable", observedAt: NOW }));
    assert.equal(agents.selectable().length, 1);
  });

  it("classifies statuses", () => {
    assert.equal(isSelectableStatus("active"), true);
    assert.equal(isSelectableStatus("disabled"), false);
    assert.equal(isSelectableStatus("draining"), false);
  });
});

describe("agent record defaults", () => {
  it("leaves unmeasured facts unknown rather than guessing", () => {
    const record = buildAgentRecord({ agentId: "a", version: "1", adapter: "local", now: NOW });
    assert.equal(record.measuredLatencyMs, null);
    assert.equal(record.latencyClass, "unknown");
    assert.equal(record.costClass, "unknown");
    assert.equal(record.health.status, "unknown");
    assert.equal(record.health.observedAt, null);
    assert.equal(record.status, "disabled", "a new agent must not default to active");
  });

  it("reports an undeclared capability as unknown, not unsupported", () => {
    const record = buildAgentRecord({ agentId: "a", version: "1", adapter: "local", now: NOW });
    assert.equal(record.capabilities.isUnknown("web_research"), true);
    assert.equal(record.capabilities.isKnownUnsupported("web_research"), false);
  });

  it("orders trust levels", () => {
    assert.ok(trustRank("privileged") > trustRank("standard"));
    assert.ok(trustRank("standard") > trustRank("untrusted"));
    assert.equal(meetsTrustFloor("high", "standard"), true);
    assert.equal(meetsTrustFloor("low", "high"), false);
  });

  it("builds a version-scoped key", () => {
    assert.equal(agentKey("a", "1.0.0"), "a@1.0.0");
  });
});

describe("agent idempotency", () => {
  it("returns the existing record on a repeated registration", () => {
    const { agents } = registry();
    const first = assertOk<RegisteredAgent>(agents.registerOrGet({ agentId: "a", version: "1", adapter: "local" }));
    const second = assertOk<RegisteredAgent>(agents.registerOrGet({ agentId: "a", version: "1", adapter: "local" }));
    assert.equal(first.record.agentId, second.record.agentId);
    assert.equal(agents.size, 1);
  });

  it("still rejects a plain duplicate, so the strict path stays available", () => {
    const { agents } = registry();
    assertOk(agents.register({ agentId: "a", version: "1", adapter: "local" }));
    assertErr(agents.register({ agentId: "a", version: "1", adapter: "local" }));
  });
});

describe("capability registry", () => {
  it("indexes an agent by the capabilities it supports", () => {
    const { agents } = registry();
    const capabilities = new CapabilityRegistry();
    const result = assertOk<RegisteredAgent>(
      agents.register({
        agentId: "research-agent",
        version: "1.0.0",
        adapter: "local",
        capabilities: CapabilitySet.supporting("web_research", "source_verification"),
      }),
    );
    capabilities.index(result.record);
    assert.deepEqual(capabilities.supportersOf("web_research"), ["research-agent@1.0.0"]);
    assert.deepEqual(capabilities.supportersOf("entity_extraction"), []);
  });

  it("distinguishes declared-absent from undeclared", () => {
    const { agents } = registry();
    const capabilities = new CapabilityRegistry();
    const result = assertOk<RegisteredAgent>(
      agents.register({
        agentId: "visionless",
        version: "1.0.0",
        adapter: "local",
        capabilities: CapabilitySet.of({ vision: "unsupported" }),
      }),
    );
    capabilities.index(result.record);
    const report = capabilities.report("vision", 1);
    assert.equal(report.availability, "declared_absent");
    assert.deepEqual(report.supporters, []);
    assert.equal(report.opposers.length, 1);
  });

  it("reports an unverified capability rather than absent", () => {
    const { agents } = registry();
    const capabilities = new CapabilityRegistry();
    const result = assertOk<RegisteredAgent>(agents.register({ agentId: "a", version: "1", adapter: "local" }));
    capabilities.index(result.record);
    const report = capabilities.report("web_research", 1);
    assert.equal(report.availability, "unverified");
    assert.match(report.reason, /unverified/);
  });

  it("reports available when at least one agent supports it", () => {
    const { agents } = registry();
    const capabilities = new CapabilityRegistry();
    const first = assertOk<RegisteredAgent>(
      agents.register({ agentId: "a", version: "1", adapter: "local", capabilities: CapabilitySet.supporting("coding") }),
    );
    capabilities.index(first.record);
    const second = assertOk<RegisteredAgent>(
      agents.register({ agentId: "b", version: "1", adapter: "local", capabilities: CapabilitySet.supporting("coding") }),
    );
    capabilities.index(second.record);
    const report = capabilities.report("coding", 2);
    assert.equal(report.availability, "available");
    assert.equal(report.supporters.length, 2);
  });

  it("re-indexing replaces the previous index", () => {
    const capabilities = new CapabilityRegistry();
    // A refreshed record for the same agent, carrying different capabilities.
    const first = buildAgentRecord({
      agentId: "a",
      version: "1",
      adapter: "local",
      capabilities: CapabilitySet.supporting("coding"),
      now: NOW,
    });
    capabilities.index(first);
    const second = buildAgentRecord({
      agentId: "a",
      version: "1",
      adapter: "local",
      capabilities: CapabilitySet.supporting("research"),
      now: NOW,
    });
    capabilities.index(second);
    assert.deepEqual(capabilities.supportersOf("coding"), [], "the stale capability must be dropped");
    assert.deepEqual(capabilities.supportersOf("research"), ["a@1"]);
  });

  it("reuses the core matcher for a verdict", () => {
    const { agents } = registry();
    const capabilities = new CapabilityRegistry();
    const result = assertOk<RegisteredAgent>(agents.register({ agentId: "a", version: "1", adapter: "local" }));
    const verdict = capabilities.matchFor(result.record, ["web_research"]);
    assert.equal(verdict.verdict, "unknown", "an undeclared capability must stay unknown");
  });

  it("validates a capability name before registration", () => {
    assert.equal(CapabilityRegistry.assertValidName("web_research"), true);
    assert.equal(CapabilityRegistry.assertValidName("Telepathy"), false);
  });
});

describe("AgentAdapterContract: local adapter", () => {
  describeAgentAdapterContract("local", () => new LocalAgentAdapter({ descriptor: SAMPLE_DESCRIPTOR, known: [SAMPLE_DESCRIPTOR.agentId] }), {
    descriptor: SAMPLE_DESCRIPTOR,
    output: "a real transformation of the input",
  });

  it("produces output derived from the input, not a fixed string", async () => {
    const adapter = new LocalAgentAdapter({ descriptor: SAMPLE_DESCRIPTOR });
    const result = await adapter.execute("contract-agent", {
      taskId: "t",
      objective: "Summarise",
      input: "the input text",
      requiredCapabilities: ["coding"],
      timeoutMs: 100,
    });
    const outcome = assertOk<AgentExecutionResult>(result);
    assert.ok(outcome.output.includes("the input text"), "output must reflect the input");
    assert.ok(outcome.output.includes("Summarise"));
  });

  it("classifies a configured failure rather than throwing", async () => {
    const adapter = new LocalAgentAdapter({ descriptor: SAMPLE_DESCRIPTOR, failWith: "rate_limit" });
    const result = await adapter.execute("contract-agent", {
      taskId: "t",
      objective: "o",
      input: "i",
      requiredCapabilities: [],
      timeoutMs: 100,
    });
    const error = assertErr<AgentExecutionError>(result);
    assert.equal(error.errorClass, "rate_limit");
    assert.equal(error.errorClass, "rate_limit", "the adapter must translate its own failure into the core taxonomy");
    assert.equal(error.agentKey, "contract-agent@1.0.0", "a failure must name the agent it came from");
  });

  it("reports an unavailable adapter when it is configured to fail", async () => {
    const adapter = new LocalAgentAdapter({ descriptor: SAMPLE_DESCRIPTOR, failWith: "timeout" });
    assert.equal(await adapter.isAvailable(), false);
  });

  it("counts its calls, so a test can prove work was actually done", async () => {
    const adapter = new LocalAgentAdapter({ descriptor: SAMPLE_DESCRIPTOR });
    const before = adapter.callCount;
    await adapter.execute("contract-agent", {
      taskId: "t",
      objective: "o",
      input: "i",
      requiredCapabilities: [],
      timeoutMs: 100,
    });
    assert.equal(adapter.callCount, before + 1);
  });
});

describe("UnavailableAgentAdapter", () => {
  it("reports no availability, which is the real state of the system", async () => {
    const { UnavailableAgentAdapter } = await import("../src/orchestration/agent/adapter.js");
    const adapter = new UnavailableAgentAdapter();
    assert.equal(await adapter.isAvailable(), false);
  });

  it("returns a classified error rather than a fake success", async () => {
    const { UnavailableAgentAdapter } = await import("../src/orchestration/agent/adapter.js");
    const adapter = new UnavailableAgentAdapter();
    const result = await adapter.execute("anything", {
      taskId: "t",
      objective: "o",
      input: "i",
      requiredCapabilities: [],
      timeoutMs: 100,
    });
    const error = assertErr<AgentExecutionError>(result);
    assert.equal(error.errorClass, "configuration_error");
  });

  it("refuses to describe an agent", async () => {
    const { UnavailableAgentAdapter } = await import("../src/orchestration/agent/adapter.js");
    const result = await new UnavailableAgentAdapter().describe("a", "1");
    assert.equal(result.ok, false);
  });
});

describe("AdapterRegistry", () => {
  it("registers an adapter by name", async () => {
    const { AdapterRegistry } = await import("../src/orchestration/agent/adapter.js");
    const registry = new AdapterRegistry();
    const adapter = new LocalAgentAdapter({ descriptor: SAMPLE_DESCRIPTOR, name: "local" });
    assertOk(registry.register(adapter));
    assert.equal(registry.get("local"), adapter);
    assert.equal(registry.has("local"), true);
    assert.equal(registry.size, 1);
  });

  it("rejects a duplicate adapter name", async () => {
    const { AdapterRegistry } = await import("../src/orchestration/agent/adapter.js");
    const registry = new AdapterRegistry();
    assertOk(registry.register(new LocalAgentAdapter({ descriptor: SAMPLE_DESCRIPTOR, name: "local" })));
    assertErr(registry.register(new LocalAgentAdapter({ descriptor: SAMPLE_DESCRIPTOR, name: "local" })));
  });

  it("rejects an adapter with an empty name", async () => {
    const { AdapterRegistry } = await import("../src/orchestration/agent/adapter.js");
    const registry = new AdapterRegistry();
    assertErr(registry.register(new LocalAgentAdapter({ descriptor: SAMPLE_DESCRIPTOR, name: "" })));
  });

  it("returns null for an unregistered adapter", async () => {
    const { AdapterRegistry } = await import("../src/orchestration/agent/adapter.js");
    assert.equal(new AdapterRegistry().get("ruflo"), null);
  });
});
