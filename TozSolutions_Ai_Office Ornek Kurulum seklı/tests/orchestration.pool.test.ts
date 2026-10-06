import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UNKNOWN_HEALTH } from "../src/health/health.js";
import { CapabilitySet } from "../src/capabilities/capability.js";
import {
  SpecialistPool,
  assessCandidate,
  computeRank,
  type Candidate,
  type PoolContext,
  type SelectionRequest,
} from "../src/orchestration/pool/specialistPool.js";
import { type AgentRecord, buildAgentRecord } from "../src/orchestration/agent/record.js";
import { type MemoryScope } from "../src/orchestration/memory/memory.js";
import { assertErr, assertOk } from "./contracts/contracts.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function agent(overrides: Partial<Parameters<typeof buildAgentRecord>[0]> = {}): AgentRecord {
  return buildAgentRecord({
    agentId: "research-agent",
    version: "1.0.0",
    adapter: "local",
    status: "active",
    trustLevel: "standard",
    costClass: "standard",
    capabilities: CapabilitySet.supporting("web_research"),
    ...overrides,
    now: NOW,
  });
}

function candidate(record: AgentRecord, lifecycle = "available"): Candidate {
  return { agent: record, lifecycle };
}

function context(overrides: Partial<PoolContext> = {}): PoolContext {
  return {
    providerIds: () => ["acme"],
    availableTools: () => ["web_search"],
    grantedMemoryScopes: () => ["task", "agent"] as readonly MemoryScope[],
    ...overrides,
  };
}

function request(overrides: Partial<SelectionRequest> = {}): SelectionRequest {
  return {
    taskId: "t1",
    requiredCapabilities: ["web_research"],
    minimumTrust: "low",
    requireVerifiedCapabilities: true,
    ...overrides,
  };
}

function pool(records: readonly AgentRecord[]): SpecialistPool {
  const candidates = records.map((record) => candidate(record));
  return new SpecialistPool({ candidates: () => candidates });
}

describe("specialist pool: eligibility", () => {
  it("accepts an agent that satisfies every hard requirement", () => {
    const assessment = assessCandidate(agent(), "available", request(), context());
    assert.equal(assessment.eligible, true);
    assert.deepEqual(assessment.rejections, []);
    assert.match(assessment.rationale, /web_research/);
  });

  it("rejects an agent that has not reached the available lifecycle", () => {
    const assessment = assessCandidate(agent(), "registered", request(), context());
    assert.equal(assessment.eligible, false);
    assert.ok(assessment.rejections.includes("not_available"));
  });

  it("rejects a disabled agent", () => {
    const assessment = assessCandidate(agent({ status: "disabled" }), "available", request(), context());
    assert.ok(assessment.rejections.includes("agent_disabled"));
  });

  it("rejects a draining agent", () => {
    const assessment = assessCandidate(agent({ status: "draining" }), "available", request(), context());
    assert.ok(assessment.rejections.includes("agent_disabled"));
  });

  it("rejects an agent whose health is not routable", () => {
    const assessment = assessCandidate(
      agent({ health: { ...UNKNOWN_HEALTH, status: "unavailable", observedAt: NOW } }),
      "available",
      request(),
      context(),
    );
    assert.ok(assessment.rejections.includes("agent_health_not_routable"));
  });

  it("accepts a degraded agent, which is still routable", () => {
    const assessment = assessCandidate(
      agent({ health: { ...UNKNOWN_HEALTH, status: "degraded", observedAt: NOW } }),
      "available",
      request(),
      context(),
    );
    assert.equal(assessment.eligible, true, "a degraded agent is degraded, not unavailable");
  });

  it("rejects an agent below the trust floor", () => {
    const assessment = assessCandidate(agent({ trustLevel: "untrusted" }), "available", request(), context());
    assert.ok(assessment.rejections.includes("trust_below_floor"));
  });

  it("accepts an agent at or above the trust floor", () => {
    const assessment = assessCandidate(agent({ trustLevel: "high" }), "available", request({ minimumTrust: "high" }), context());
    assert.equal(assessment.eligible, true);
  });

  it("rejects an agent missing a required capability", () => {
    const assessment = assessCandidate(
      agent({ capabilities: CapabilitySet.of({ web_research: "unsupported" }) }),
      "available",
      request(),
      context(),
    );
    assert.ok(assessment.rejections.includes("capability_incompatible"));
  });

  it("admits a verified agent and withholds one that declared nothing", () => {
    // The agent declares web_research as supported, so this passes; an agent
    // that declares nothing at all must be withheld instead.
    const verified = assessCandidate(agent(), "available", request(), context());
    assert.equal(verified.eligible, true);
    const silent = assessCandidate(
      agent({ capabilities: CapabilitySet.unknown() }),
      "available",
      request(),
      context(),
    );
    assert.ok(silent.rejections.includes("capability_unverified"));
  });

  it("admits an unverified capability when the caller opts in", () => {
    const assessment = assessCandidate(
      agent({ capabilities: CapabilitySet.unknown() }),
      "available",
      request({ requireVerifiedCapabilities: false }),
      context(),
    );
    assert.equal(assessment.eligible, true, "opting in must admit an unverified candidate");
  });

  it("rejects an agent whose required tool is unavailable", () => {
    const assessment = assessCandidate(
      agent({ toolRequirements: ["web_search"] }),
      "available",
      request(),
      context({ availableTools: () => [] }),
    );
    assert.ok(assessment.rejections.includes("missing_tool"));
  });

  it("rejects an agent whose required provider is not registered", () => {
    const assessment = assessCandidate(
      agent({ providerRequirements: ["absent-provider"] }),
      "available",
      request(),
      context({ providerIds: () => ["acme"] }),
    );
    assert.ok(assessment.rejections.includes("missing_provider"));
  });

  it("rejects an agent needing a memory scope it was not granted", () => {
    const assessment = assessCandidate(
      agent({ memoryScopes: ["project"] }),
      "available",
      request(),
      context({ grantedMemoryScopes: () => ["task"] }),
    );
    assert.ok(assessment.rejections.includes("memory_scope_unavailable"));
  });

  it("collects every rejection reason, not just the first", () => {
    const assessment = assessCandidate(
      agent({ status: "disabled", trustLevel: "untrusted", toolRequirements: ["missing"] }),
      "registered",
      request(),
      context({ availableTools: () => [] }),
    );
    assert.ok(assessment.rejections.length >= 4, `expected several reasons, got ${assessment.rejections.join(",")}`);
  });
});

describe("specialist pool: deterministic ranking", () => {
  it("prefers the agent that fully covers the required capabilities", () => {
    const full = agent({ capabilities: CapabilitySet.supporting("web_research", "source_verification") });
    const partial = agent({ agentId: "partial", capabilities: CapabilitySet.supporting("web_research") });
    const decision = pool([partial, full]).select(request({ requiredCapabilities: ["web_research", "source_verification"] }), context());
    assert.equal(decision.selectedAgent?.agentId, "research-agent");
  });

  it("prefers a higher-trust agent when capability coverage ties", () => {
    const low = agent({ agentId: "low", trustLevel: "low" });
    const high = agent({ agentId: "high", trustLevel: "high" });
    const decision = pool([low, high]).select(request(), context());
    assert.equal(decision.selectedAgent?.agentId, "high");
  });

  it("prefers a healthy agent over a degraded one", () => {
    const degraded = agent({ agentId: "degraded", health: { ...UNKNOWN_HEALTH, status: "degraded", observedAt: NOW } });
    const healthy = agent({ agentId: "healthy", health: { ...UNKNOWN_HEALTH, status: "healthy", observedAt: NOW } });
    const decision = pool([degraded, healthy]).select(request(), context());
    assert.equal(decision.selectedAgent?.agentId, "healthy");
  });

  it("prefers a measured low latency over an unmeasured agent", () => {
    const measured = agent({ agentId: "measured", measuredLatencyMs: 100 });
    const unmeasured = agent({ agentId: "unmeasured" });
    const decision = pool([measured, unmeasured]).select(request(), context());
    assert.equal(decision.selectedAgent?.agentId, "measured", "a recorded latency is a fact an absent one cannot claim");
  });

  it("does not prefer an unknown cost class as if it were cheap", () => {
    const unknown = agent({ agentId: "unknown-cost", costClass: "unknown" });
    const free = agent({ agentId: "free", costClass: "free" });
    const decision = pool([unknown, free]).select(request(), context());
    assert.equal(decision.selectedAgent?.agentId, "free");
  });

  it("is deterministic across repeated runs", () => {
    const a = agent({ agentId: "aaa" });
    const b = agent({ agentId: "bbb" });
    const first = pool([a, b]).select(request(), context()).selectedAgent?.agentId;
    for (let i = 0; i < 10; i += 1) {
      assert.equal(pool([a, b]).select(request(), context()).selectedAgent?.agentId, first);
    }
  });

  it("breaks a tie by agent key, not by insertion order", () => {
    const a = agent({ agentId: "aaa" });
    const b = agent({ agentId: "bbb" });
    const forward = pool([a, b]).select(request(), context()).selectedAgent?.agentId;
    const reverse = pool([b, a]).select(request(), context()).selectedAgent?.agentId;
    assert.equal(forward, reverse, "candidate order must not change the outcome");
  });

  it("computes a higher rank for better coverage", () => {
    const full = agent({ capabilities: CapabilitySet.supporting("web_research", "source_verification") });
    const partial = agent({ capabilities: CapabilitySet.supporting("web_research") });
    const fullRank = computeRank(full, { verdict: "compatible", gaps: [], satisfied: ["web_research", "source_verification"] });
    const partialRank = computeRank(partial, { verdict: "compatible", gaps: [], satisfied: ["web_research"] });
    assert.ok(fullRank > partialRank);
  });
});

describe("specialist pool: selection", () => {
  it("selects one agent by default", () => {
    const decision = pool([agent()]).select(request(), context());
    assert.equal(decision.selected.length, 1);
    assert.ok(decision.selectedAgent);
  });

  it("selects several when explicitly asked", () => {
    const decision = pool([agent({ agentId: "a" }), agent({ agentId: "b" })]).select(request(), context(), 2);
    assert.equal(decision.selected.length, 2);
  });

  it("explains why nothing was selected", () => {
    const decision = pool([agent({ status: "disabled" })]).select(request(), context());
    assert.equal(decision.selectedAgent, null);
    assert.match(decision.reason, /No eligible agent/);
    assert.match(decision.reason, /agent_disabled/);
  });

  it("explains an empty candidate set", () => {
    const decision = new SpecialistPool({ candidates: () => [] }).select(request(), context());
    assert.equal(decision.selectedAgent, null);
    assert.match(decision.reason, /No agents are registered/);
  });

  it("reports every rejected candidate with a reason", () => {
    const decision = pool([agent({ agentId: "bad", status: "disabled" })]).select(request(), context());
    assert.equal(decision.rejected.length, 1);
    assert.ok(decision.rejected[0]?.rationale);
  });

  it("records the selection rationale so a caller can explain itself", () => {
    const decision = pool([agent()]).select(request(), context());
    assert.match(decision.reason, /Selected research-agent@1\.0\.0/);
    assert.match(decision.reason, /deterministic rank/);
  });

  it("rejects a non-positive limit", () => {
    const decision = pool([agent()]).select(request(), context(), 0);
    assert.equal(decision.selectedAgent, null);
    assert.match(decision.reason, /positive integer/);
  });

  it("refuses a limit above the configured maximum, so a swarm cannot be requested by accident", () => {
    const bounded = new SpecialistPool({
      candidates: () => [candidate(agent())],
      maximumSelectedAgents: 2,
    });
    const decision = bounded.select(request(), context(), 10);
    assert.equal(decision.selectedAgent, null);
    assert.match(decision.reason, /exceeds the configured maximum/);
  });

  it("refuses a trust floor above the configured maximum", () => {
    const bounded = new SpecialistPool({
      candidates: () => [candidate(agent({ trustLevel: "privileged" }))],
      maximumTrustFloor: "standard",
    });
    const decision = bounded.select(request({ minimumTrust: "privileged" }), context());
    assert.equal(decision.selectedAgent, null);
    assert.match(decision.reason, /exceeds the configured maximum/);
  });

  it("never selects an ineligible agent even when asked for many", () => {
    const decision = pool([agent({ status: "disabled" })]).select(request(), context(), 5);
    assert.equal(decision.selected.length, 0, "a larger limit must not bypass eligibility");
  });

  it("assesses without selecting, for an explainable preview", () => {
    const assessed = pool([agent(), agent({ agentId: "other" })]).assess(request(), context());
    assert.equal(assessed.length, 2);
    assert.ok(assessed.every((candidate) => candidate.rationale.length > 0));
  });
});

describe("pool never selects an unverified capability by default", () => {
  it("withholds every agent when none declares the capability", () => {
    const decision = pool([agent({ capabilities: CapabilitySet.unknown() })]).select(request(), context());
    assert.equal(decision.selectedAgent, null);
    assert.ok(decision.rejected[0]?.rejections.includes("capability_unverified"));
  });

  it("still selects when at least one agent verifies it", () => {
    const silent = agent({ agentId: "silent", capabilities: CapabilitySet.unknown() });
    const verified = agent({ agentId: "verified", capabilities: CapabilitySet.supporting("web_research") });
    const decision = pool([silent, verified]).select(request(), context());
    assert.equal(decision.selectedAgent?.agentId, "verified");
    assert.equal(decision.rejected.length, 1);
  });
});

describe("pool is not a second registry", () => {
  it("holds no agents of its own: removing the source empties the pool", () => {
    const records = [agent()];
    const specialist = new SpecialistPool({ candidates: () => records.map((record) => candidate(record)) });
    assert.equal(specialist.select(request(), context()).selected.length, 1);
    records.length = 0;
    assert.equal(specialist.select(request(), context()).selected.length, 0);
  });
});

describe("assert helpers", () => {
  it("assertOk returns the value and throws with a readable message on failure", () => {
    const value = assertOk<number>({ ok: true, value: 7 });
    assert.equal(value, 7);
    assert.throws(() => assertOk({ ok: false, error: new Error("boom") }), /boom/);
  });

  it("assertErr returns the error and throws on success", () => {
    const error = assertErr<Error>({ ok: false, error: new Error("nope") });
    assert.equal(error.message, "nope");
    assert.throws(() => assertErr({ ok: true, value: 1 }), /expected the result to fail/);
  });

  it("rejects a failure that carries no error value", () => {
    assert.throws(() => assertErr({ ok: false }), /carried no error value/);
  });
});
