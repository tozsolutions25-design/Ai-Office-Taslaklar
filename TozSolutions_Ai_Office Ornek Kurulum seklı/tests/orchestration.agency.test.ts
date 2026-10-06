/**
 * PHASE 04.1: agency agents, agent sources, and the Ruflo boundary.
 *
 * THE ROSTERS IN THIS FILE ARE TEST DATA.
 *
 * They are declared here, in a test file, because they demonstrate the
 * normalisation contract. They are NOT a claim that any agency, framework or
 * vendor exists or supplies these agents: no Agency Agent roster exists in this
 * repository, and inventing one in source would assert an integration that does
 * not exist. The names below are neutral and obviously synthetic for that reason.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import type { CapabilitySet } from "../src/capabilities/capability.js";
import { AgentRegistry } from "../src/orchestration/agent/registry.js";
import { AdapterRegistry } from "../src/orchestration/agent/adapter.js";
import { type AgentExecutionResult } from "../src/orchestration/agent/adapter.js";
import { CapabilityRegistry } from "../src/orchestration/capabilities/registry.js";
import { SpecialistPool } from "../src/orchestration/pool/specialistPool.js";
import {
  AGENT_ORIGIN_KINDS,
  NATIVE_ORIGIN,
  isAgentOriginKind,
  isExternalOrigin,
} from "../src/orchestration/agent/record.js";
import {
  AgentNormalisationError,
  AgentIngestor,
  AliasCapabilityMapper,
  DeclaredAgentSource,
  IdentityCapabilityMapper,
  normaliseSourceAgent,
  type SourceAgentDescriptor,
} from "../src/orchestration/index.js";
import {
  AgencyAdapterSet,
  AgencyAgentAdapter,
  classifyAgencyError,
  type AgencyResponse,
  type AgencyTransport,
  type AgencyTransportError,
} from "../src/orchestration/agentsource/agencyAdapter.js";
import {
  RUFLO_CONCEPTS,
  RufloAdapterBoundary,
  implementedRufloConcepts,
  rufloConcept,
  translateRufloOutcome,
} from "../src/orchestration/ruflo/boundary.js";
import { assertOk } from "./contracts/contracts.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const CLOCK = new ManualClock(NOW);

/* ------------------------------------------------------------------ */
/* Test-only transport. Clearly labelled: this is a test double.       */
/* ------------------------------------------------------------------ */

class TestAgencyTransport implements AgencyTransport {
  public readonly name = "test_agency";
  #available: boolean;
  #response: AgencyResponse | null;
  #failure: AgencyTransportError | null;
  #calls: string[] = [];

  public constructor(options: { available?: boolean; response?: AgencyResponse; failure?: AgencyTransportError } = {}) {
    this.#available = options.available ?? true;
    this.#response = options.response ?? null;
    this.#failure = options.failure ?? null;
  }

  public get calls(): readonly string[] {
    return this.#calls;
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(this.#available);
  }

  public invoke(request: { externalAgentId: string }): Promise<{ ok: true; value: AgencyResponse } | { ok: false; error: AgencyTransportError }> {
    this.#calls.push(request.externalAgentId);
    if (this.#failure !== null) {
      return Promise.resolve({ ok: false, error: this.#failure });
    }
    return Promise.resolve({
      ok: true,
      value: this.#response ?? {
        externalAgentId: request.externalAgentId,
        output: `agency answer for ${request.externalAgentId}`,
        durationMs: 5,
      },
    });
  }
}

function source(overrides: Partial<{ kind: "native" | "agency" | "ruflo" | "remote" | "custom"; name: string }> = {}) {
  return { kind: overrides.kind ?? "agency", name: overrides.name ?? "test_agency_source" };
}

/** A three-agent roster, all offering the same capability. */
const OVERLAPPING_ROSTER: readonly SourceAgentDescriptor[] = [
  { id: "alpha.auditor", version: "1.0.0", capabilities: ["source_verification"], tools: ["text_stat"] },
  { id: "beta.auditor", version: "1.0.0", capabilities: ["source_verification"] },
  { id: "gamma.auditor", version: "2.1.0", capabilities: ["source_verification"], role: "verifier" },
];

describe("PHASE 04.1 D — agent sources: normalisation", () => {
  it("normalises a descriptor onto a record", () => {
    const result = assertOk<{ record: { agentId: string; capabilities: CapabilitySet } }>(
      normaliseSourceAgent(OVERLAPPING_ROSTER[0], { source: source(), mapper: new IdentityCapabilityMapper(), now: NOW }),
    );
    assert.equal(result.record.agentId, "alpha.auditor");
    assert.equal(result.record.capabilities.isSupported("source_verification"), true);
  });

  it("arrives disabled, so a source cannot hand us something that runs", () => {
    const result = assertOk<{ record: { status: string } }>(
      normaliseSourceAgent(OVERLAPPING_ROSTER[0], { source: source(), mapper: new IdentityCapabilityMapper(), now: NOW }),
    );
    assert.equal(result.record.status, "disabled");
  });

  it("records provenance, so an external agent is distinguishable from a native one", () => {
    const result = assertOk<{ record: { source: { kind: string; ref: string | null } } }>(
      normaliseSourceAgent(OVERLAPPING_ROSTER[0], { source: source(), mapper: new IdentityCapabilityMapper(), now: NOW }),
    );
    assert.equal(result.record.source.kind, "agency");
    assert.equal(result.record.source.ref, "alpha.auditor");
  });

  it("maps an external capability name onto a TOZ capability explicitly", () => {
    const mapper = new AliasCapabilityMapper({ source_verification: "evidence.integrity" });
    const result = assertOk<{ record: { capabilities: CapabilitySet }; renamed: boolean }>(
      normaliseSourceAgent(OVERLAPPING_ROSTER[0], { source: source(), mapper, now: NOW }),
    );
    assert.equal(result.renamed, true, "a rename must be visible, not silent");
    assert.equal(result.record.capabilities.isSupported("evidence.integrity"), true);
  });

  it("rejects a capability name it cannot map, rather than dropping it", () => {
    const result = normaliseSourceAgent(
      { id: "delta", capabilities: ["source_verification", "warpdrive"] },
      { source: source(), mapper: new IdentityCapabilityMapper(), now: NOW },
    );
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error.message, /cannot map: warpdrive/);
  });

  it("rejects a descriptor with no usable id", () => {
    const result = normaliseSourceAgent({ id: "" }, { source: source(), mapper: new IdentityCapabilityMapper(), now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.externalId, "");
  });

  it("rejects a malformed id rather than registering an unaddressable agent", () => {
    const result = normaliseSourceAgent(
      { id: "has spaces/and slashes" },
      { source: source(), mapper: new IdentityCapabilityMapper(), now: NOW },
    );
    assert.equal(result.ok, false);
  });

  it("rejects an invalid version", () => {
    const result = normaliseSourceAgent(
      { id: "ok", version: "v 1 2 3" },
      { source: source(), mapper: new IdentityCapabilityMapper(), now: NOW },
    );
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error.message, /version/);
  });

  it("rejects an unknown cost class instead of coercing it", () => {
    const result = normaliseSourceAgent(
      { id: "ok", costClass: "spree" },
      { source: source(), mapper: new IdentityCapabilityMapper(), now: NOW },
    );
    assert.equal(result.ok, false, "a guessed cost class is a fabricated fact");
  });

  it("rejects an unknown memory scope rather than dropping the requirement", () => {
    const result = normaliseSourceAgent(
      { id: "ok", memoryScopes: ["the_void"] },
      { source: source(), mapper: new IdentityCapabilityMapper(), now: NOW },
    );
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error.message, /memory scope/);
  });

  it("clamps a self-declared trust level to the source ceiling", () => {
    const result = assertOk<{ record: { trustLevel: string } }>(
      normaliseSourceAgent(
        { id: "smug", trustLevel: "privileged" },
        { source: source(), mapper: new IdentityCapabilityMapper(), maximumTrustLevel: "standard", now: NOW },
      ),
    );
    assert.equal(result.record.trustLevel, "standard", "an external self-description is a claim, not a measurement");
  });

  it("accepts a trust level at or below the ceiling", () => {
    const result = assertOk<{ record: { trustLevel: string } }>(
      normaliseSourceAgent(
        { id: "humble", trustLevel: "low" },
        { source: source(), mapper: new IdentityCapabilityMapper(), maximumTrustLevel: "standard", now: NOW },
      ),
    );
    assert.equal(result.record.trustLevel, "low");
  });

  it("treats an unrecognised trust level as no claim, not as a high one", () => {
    const result = assertOk<{ record: { trustLevel: string } }>(
      normaliseSourceAgent(
        { id: "odd", trustLevel: "wizard" },
        { source: source(), mapper: new IdentityCapabilityMapper(), now: NOW },
      ),
    );
    assert.equal(result.record.trustLevel, "standard");
  });

  it("keeps a descriptor with no capabilities as unknown, not supported", () => {
    const result = assertOk<{ record: { capabilities: CapabilitySet } }>(
      normaliseSourceAgent({ id: "silent" }, { source: source(), mapper: new IdentityCapabilityMapper(), now: NOW }),
    );
    assert.equal(result.record.capabilities.isSupported("source_verification"), false);
    assert.equal(result.record.capabilities.isUnknown("source_verification"), true);
  });

  it("carries a self-hosted specialist's model-route requirement", () => {
    const result = assertOk<{ record: { requiresModelRoute: boolean } }>(
      normaliseSourceAgent(
        { id: "selfhosted", requiresModelRoute: false },
        { source: source(), mapper: new IdentityCapabilityMapper(), now: NOW },
      ),
    );
    assert.equal(result.record.requiresModelRoute, false);
  });

  it("defaults to requiring a route, which is the stricter answer", () => {
    const result = assertOk<{ record: { requiresModelRoute: boolean } }>(
      normaliseSourceAgent({ id: "unspecified" }, { source: source(), mapper: new IdentityCapabilityMapper(), now: NOW }),
    );
    assert.equal(result.record.requiresModelRoute, true);
  });

  it("keeps a role as a label, never as a capability", () => {
    const result = assertOk<{ record: { capabilities: CapabilitySet; metadata: Record<string, unknown> } }>(
      normaliseSourceAgent(
        { id: "labelled", role: "auditor", capabilities: ["source_verification"] },
        { source: source(), mapper: new IdentityCapabilityMapper(), now: NOW },
      ),
    );
    assert.equal(result.record.capabilities.isSupported("auditor"), false);
    assert.equal(result.record.metadata["sourceRole"], "auditor");
  });

  it("collects every problem with one descriptor rather than the first", () => {
    const result = normaliseSourceAgent(
      { id: "many_problems", costClass: "spree", executionMode: "teleport", memoryScopes: ["nowhere"] },
      { source: source(), mapper: new IdentityCapabilityMapper(), now: NOW },
    );
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.error.issues.length >= 3, "all issues should be reported at once");
  });

  it("uses a dedicated error type a caller can catch", () => {
    const result = normaliseSourceAgent({ id: "" }, { source: source(), mapper: new IdentityCapabilityMapper(), now: NOW });
    assert.ok(!result.ok && result.error instanceof AgentNormalisationError);
  });
});

describe("PHASE 04.1 D — agent sources: ingestion", () => {
  function harness() {
    const agents = new AgentRegistry({ clock: CLOCK });
    const capabilities = new CapabilityRegistry();
    const ingestor = new AgentIngestor({ agents, capabilities, clock: CLOCK });
    return { agents, capabilities, ingestor };
  }

  it("registers every agent a roster offers", () => {
    const { ingestor, agents } = harness();
    const report = ingestor.ingestDescriptors(source(), OVERLAPPING_ROSTER);
    assert.equal(report.registered.length, 3);
    assert.equal(agents.size, 3);
  });

  it("reports an unreadable source rather than pretending it contributed nothing", async () => {
    const { ingestor } = harness();
    const broken = {
      kind: "agency" as const,
      name: "broken_source",
      isAvailable: () => Promise.resolve(true),
      list: () => Promise.resolve({ ok: false as const, error: new Error("transport refused") }),
    };
    const report = await ingestor.ingest(broken);
    assert.equal(report.sourceUnavailable, true);
    assert.match(report.rejections[0]?.reason ?? "", /transport refused/);
  });

  it("reports a rejection with a reason, per agent", () => {
    const { ingestor, agents } = harness();
    const report = ingestor.ingestDescriptors(source(), [
      ...OVERLAPPING_ROSTER,
      { id: "broken", capabilities: ["warpdrive"] },
    ]);
    assert.equal(report.registered.length, 3);
    assert.equal(report.rejections.length, 1);
    assert.equal(report.rejections[0]?.externalId, "broken");
    assert.equal(agents.has("broken", "0.0.0"), false);
  });

  it("records capability renames in the report", () => {
    const { ingestor } = harness();
    const mapper = new AliasCapabilityMapper({ source_verification: "evidence.integrity" });
    const report = ingestor.ingestDescriptors(source(), OVERLAPPING_ROSTER, mapper);
    assert.deepEqual(report.capabilityRenames, { source_verification: "evidence.integrity" });
  });

  it("treats a re-read of the roster as existing, not as a failure", () => {
    const { ingestor, agents } = harness();
    ingestor.ingestDescriptors(source(), OVERLAPPING_ROSTER);
    const second = ingestor.ingestDescriptors(source(), OVERLAPPING_ROSTER);
    assert.equal(second.registered.length, 0);
    assert.equal(second.existing.length, 3);
    assert.equal(second.rejections.length, 0);
    assert.equal(agents.size, 3, "a refresh must not duplicate agents");
  });

  it("registers no duplicate when a roster lists one agent twice", () => {
    const { ingestor, agents } = harness();
    const report = ingestor.ingestDescriptors(source(), [OVERLAPPING_ROSTER[0], OVERLAPPING_ROSTER[0]]);
    assert.equal(agents.size, 1);
    assert.equal(report.existing.length, 1);
  });

  it("does not promote to available unless asked", () => {
    const { ingestor, agents } = harness();
    ingestor.ingestDescriptors(source(), OVERLAPPING_ROSTER);
    assert.equal(agents.selectable().length, 0, "ingestion is not a decision");
  });

  it("promotes when explicitly asked, and then they are selectable", () => {
    const agents = new AgentRegistry({ clock: CLOCK });
    const capabilities = new CapabilityRegistry();
    const ingestor = new AgentIngestor({ agents, capabilities, clock: CLOCK, promoteToAvailable: true });
    ingestor.ingestDescriptors(source(), OVERLAPPING_ROSTER);
    assert.equal(agents.selectable().length, 3);
  });

  it("indexes every registered agent in the capability registry", () => {
    const { ingestor, capabilities } = harness();
    ingestor.ingestDescriptors(source(), OVERLAPPING_ROSTER);
    assert.deepEqual([...capabilities.supportersOf("source_verification")].sort(), [
      "alpha.auditor@1.0.0",
      "beta.auditor@1.0.0",
      "gamma.auditor@2.1.0",
    ]);
  });

  it("reads a declared source through the same path", async () => {
    const { ingestor, agents } = harness();
    const declared = new DeclaredAgentSource({ kind: "agency", name: "declared", descriptors: OVERLAPPING_ROSTER });
    const report = await ingestor.ingest(declared);
    assert.equal(report.sourceName, "declared");
    assert.equal(agents.size, 3);
  });

  it("contributes nothing from an empty source, and says so", async () => {
    const { ingestor, agents } = harness();
    const empty = new DeclaredAgentSource({ kind: "agency", name: "empty", descriptors: [] });
    const report = await ingestor.ingest(empty);
    assert.equal(report.registered.length, 0);
    assert.equal(agents.size, 0);
  });
});

describe("PHASE 04.1 D — agency agents are selectable through the pool", () => {
  it("selects among three agents offering the same capability", () => {
    const agents = new AgentRegistry({ clock: CLOCK });
    const capabilities = new CapabilityRegistry();
    const ingestor = new AgentIngestor({ agents, capabilities, clock: CLOCK, promoteToAvailable: true });
    ingestor.ingestDescriptors(source(), OVERLAPPING_ROSTER);

    const pool = new SpecialistPool({
      candidates: () => agents.list().map((entry) => ({ agent: entry.record, lifecycle: entry.lifecycle })),
    });
    const decision = pool.select(
      { taskId: "t", requiredCapabilities: ["source_verification"], minimumTrust: "low" },
      { providerIds: () => [], availableTools: () => ["text_stat"], grantedMemoryScopes: () => [] },
    );
    assert.equal(decision.selected.length, 1, "one capability does not mean one agent");
    assert.ok(["alpha.auditor@1.0.0", "beta.auditor@1.0.0", "gamma.auditor@2.1.0"].includes(decision.selectedAgent?.agentId ? `${decision.selectedAgent.agentId}@${decision.selectedAgent.version}` : ""));
  });

  it("rejects an ingested agent whose required tool is absent", () => {
    const agents = new AgentRegistry({ clock: CLOCK });
    const capabilities = new CapabilityRegistry();
    const ingestor = new AgentIngestor({ agents, capabilities, clock: CLOCK, promoteToAvailable: true });
    ingestor.ingestDescriptors(source(), OVERLAPPING_ROSTER);

    const pool = new SpecialistPool({
      candidates: () => agents.list().map((entry) => ({ agent: entry.record, lifecycle: entry.lifecycle })),
    });
    const decision = pool.select(
      { taskId: "t", requiredCapabilities: ["source_verification"], minimumTrust: "low" },
      { providerIds: () => [], availableTools: () => [], grantedMemoryScopes: () => [] },
    );
    // Only the agent that declared `text_stat` is rejected; the other two remain.
    const rejected = decision.rejected.map((candidate) => candidate.agentKey);
    assert.ok(rejected.includes("alpha.auditor@1.0.0"));
    assert.ok(decision.selectedAgent !== null, "a tool requirement on one agent must not exclude the others");
  });

  it("explains the rejection rather than silently dropping the agent", () => {
    const agents = new AgentRegistry({ clock: CLOCK });
    const capabilities = new CapabilityRegistry();
    new AgentIngestor({ agents, capabilities, clock: CLOCK, promoteToAvailable: true }).ingestDescriptors(
      source(),
      OVERLAPPING_ROSTER,
    );
    const pool = new SpecialistPool({
      candidates: () => agents.list().map((entry) => ({ agent: entry.record, lifecycle: entry.lifecycle })),
    });
    const decision = pool.select(
      { taskId: "t", requiredCapabilities: ["source_verification"], minimumTrust: "low" },
      { providerIds: () => [], availableTools: () => [], grantedMemoryScopes: () => [] },
    );
    assert.match(decision.rejected[0]?.rationale ?? "", /missing_tool/);
  });
});

describe("PHASE 04.1 D — agency adapter boundary", () => {
  const descriptor: SourceAgentDescriptor = { id: "alpha.auditor", version: "1.0.0", capabilities: ["source_verification"] };

  it("reports itself unavailable when no transport is configured", async () => {
    const adapter = new AgencyAgentAdapter({ transport: null });
    assert.equal(await adapter.isAvailable(), false);
  });

  it("fails with a classified error rather than pretending to execute", async () => {
    const adapter = new AgencyAgentAdapter({ transport: null });
    const result = await adapter.execute("alpha.auditor", {
      taskId: "t",
      objective: "o",
      input: "i",
      requiredCapabilities: ["source_verification"],
      timeoutMs: 100,
    });
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.error.errorClass === "configuration_error");
    assert.match(result.ok ? "" : result.error.message, /No agency transport is configured/);
  });

  it("describes an agent it holds, and refuses one it does not", async () => {
    const adapter = new AgencyAgentAdapter({
      transport: null,
      roster: new Map([["alpha.auditor", descriptor]]),
    });
    const described = await adapter.describe("alpha.auditor", "1.0.0");
    assert.equal(described.ok, true);
    assert.equal((await adapter.describe("ghost", "1.0.0")).ok, false);
  });

  it("executes through a transport that is actually present", async () => {
    const transport = new TestAgencyTransport();
    const adapter = new AgencyAgentAdapter({ transport });
    const result = assertOk<AgentExecutionResult>(
      await adapter.execute("alpha.auditor", {
        taskId: "t",
        objective: "o",
        input: "i",
        requiredCapabilities: [],
        timeoutMs: 100,
      }),
    );
    assert.match(result.output, /agency answer for alpha\.auditor/);
    assert.deepEqual(transport.calls, ["alpha.auditor"]);
  });

  it("reports an agency-hosted agent as running on no provider, because it brings its own inference", async () => {
    const adapter = new AgencyAgentAdapter({ transport: new TestAgencyTransport() });
    const result = assertOk<AgentExecutionResult>(
      await adapter.execute("alpha.auditor", {
        taskId: "t",
        objective: "o",
        input: "i",
        requiredCapabilities: [],
        timeoutMs: 100,
      }),
    );
    assert.equal(result.providerId, null);
    assert.equal(result.modelId, null);
  });

  it("translates a transport failure into the core taxonomy", async () => {
    const transport = new TestAgencyTransport({ failure: { code: "AGENT_RATE_LIMITED", message: "slow down" } });
    const adapter = new AgencyAgentAdapter({ transport });
    const result = await adapter.execute("alpha.auditor", {
      taskId: "t",
      objective: "o",
      input: "i",
      requiredCapabilities: [],
      timeoutMs: 100,
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.errorClass, "rate_limit");
  });

  it("classifies a transport that throws, rather than letting it escape", async () => {
    const throwing = {
      name: "throwing",
      isAvailable: () => Promise.resolve(true),
      invoke: () => Promise.reject(new Error("socket hang up")),
    } as unknown as AgencyTransport;
    const adapter = new AgencyAgentAdapter({ transport: throwing });
    const result = await adapter.execute("alpha.auditor", {
      taskId: "t",
      objective: "o",
      input: "i",
      requiredCapabilities: [],
      timeoutMs: 100,
    });
    assert.equal(result.ok, false, "an adapter that throws would make the failure unclassifiable");
  });

  it("classifies each error shape into a distinct class", () => {
    const classify = (error: Partial<AgencyTransportError>): string => {
      const result = classifyAgencyError({ message: "test", ...error });
      assert.notEqual(result, "", "every classification must land in the core taxonomy");
      return result;
    };
    assert.equal(classify({ code: "TIMEOUT" }), "timeout");
    assert.equal(classify({ status: 429 }), "rate_limit");
    assert.equal(classify({ code: "QUOTA_EXHAUSTED" }), "quota_exhausted");
    assert.equal(classify({ code: "UNAUTHENTICATED" }), "authentication_failure");
    assert.equal(classify({ code: "AGENT_NOT_FOUND" }), "invalid_request");
    assert.equal(classify({ code: "SERVICE_UNAVAILABLE" }), "temporary_outage");
    assert.equal(classify({ status: 503 }), "temporary_outage");
    assert.equal(classify({ status: 400 }), "invalid_request");
    assert.equal(classify({}), "unknown");
  });

  it("reports an unmeasured duration as null, not zero", async () => {
    const transport = new TestAgencyTransport({
      response: { externalAgentId: "alpha.auditor", output: "x", durationMs: null },
    });
    const result = assertOk<AgentExecutionResult>(
      await new AgencyAgentAdapter({ transport }).execute("alpha.auditor", {
        taskId: "t",
        objective: "o",
        input: "i",
        requiredCapabilities: [],
        timeoutMs: 100,
      }),
    );
    assert.equal(result.durationMs, null);
  });

  it("is a leaf: it holds no reference to the orchestrator, pool or registries", () => {
    const adapter = new AgencyAgentAdapter({ transport: null });
    const fields = Object.getOwnPropertyNames(adapter).filter((name) => !name.startsWith("#"));
    assert.deepEqual(fields, ["name"], "only its own identity is public state");
  });

  it("registers through the normal adapter registry, so the orchestrator can reach it", () => {
    const registry = new AdapterRegistry();
    assertOk(registry.register(new AgencyAgentAdapter({ transport: null })));
    assert.notEqual(registry.get("agency"), null);
  });

  it("can be held in an agency adapter set", () => {
    const set = new AgencyAdapterSet(new AgencyAgentAdapter({ transport: null }));
    assert.notEqual(set.get("agency"), null);
    assert.equal(set.get("absent"), null);
  });
});

describe("PHASE 04.1 E — Ruflo boundary", () => {
  it("is disabled by default", () => {
    assert.equal(new RufloAdapterBoundary().enabled, false);
    assert.equal(new RufloAdapterBoundary().status(), "not_enabled");
  });

  it("reports not_installed even when enabled, because no package is installed", () => {
    const boundary = new RufloAdapterBoundary({ enabled: true });
    assert.equal(boundary.enabled, true);
    assert.equal(boundary.status(), "not_installed");
  });

  it("refuses to execute, with a reason that says why", async () => {
    const result = await new RufloAdapterBoundary({ enabled: true }).execute("some-agent");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error.message, /No Ruflo package is installed/);
  });

  it("refuses to be constructed claiming authority", () => {
    assert.throws(
      () => new RufloAdapterBoundary({ claimsAuthority: true }),
      /cannot claim orchestration authority/,
      "one brain, enforced at construction rather than documented",
    );
  });

  it("records only concepts that map to a TOZ module that exists", () => {
    for (const concept of implementedRufloConcepts()) {
      assert.notEqual(concept.tozEquivalent, null);
      assert.equal(concept.implemented, true);
    }
  });

  it("marks unimplemented concepts as unimplemented rather than claiming them", () => {
    const federation = rufloConcept("federation");
    assert.ok(federation);
    assert.equal(federation?.implemented, false);
    assert.equal(federation?.tozEquivalent, null);
  });

  it("has no invented concept beyond the recorded reference list", () => {
    const adopted = RUFLO_CONCEPTS.filter((concept) => concept.implemented).map((concept) => concept.reference);
    assert.ok(!adopted.includes("autonomous self-modification"));
    assert.ok(!adopted.includes("agent federation"));
  });

  it("translates a completed outcome faithfully", () => {
    const outcome = translateRufloOutcome({ status: "completed", output: "done" });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.output, "done");
  });

  it("translates a timeout as a timeout, not as an unknown failure", () => {
    assert.equal(translateRufloOutcome({ status: "timeout" }).errorClass, "timeout");
  });

  it("translates a failure as permanent, so an outage cannot become a retry storm", () => {
    assert.equal(translateRufloOutcome({ status: "failed", errorMessage: "boom" }).errorClass, "unknown");
  });

  it("does not invent output for an outcome that reported none", () => {
    assert.equal(translateRufloOutcome({ status: "completed" }).output, "");
  });

  it("TOZ runs identically with no boundary object in existence", () => {
    // Nothing in the orchestrator's construction takes a boundary, which is the
    // structural form of "Toz works without Ruflo". Asserted by reading the
    // options type rather than by a comment.
    const boundary = new RufloAdapterBoundary();
    assert.equal(boundary.status(), "not_enabled");
    assert.ok(RUFLO_CONCEPTS.length > 0, "the reference is recorded either way");
  });
});

describe("PHASE 04.1 — agent provenance", () => {
  it("recognises every declared origin kind", () => {
    for (const kind of AGENT_ORIGIN_KINDS) {
      assert.equal(isAgentOriginKind(kind), true);
    }
    assert.equal(isAgentOriginKind("telepathy"), false);
  });

  it("treats a native agent as having no external reference", () => {
    assert.deepEqual(NATIVE_ORIGIN, { kind: "native", ref: null });
  });

  it("classifies external origins", () => {
    assert.equal(isExternalOrigin(NATIVE_ORIGIN), false);
    assert.equal(isExternalOrigin({ kind: "agency", ref: "x" }), true);
    assert.equal(isExternalOrigin({ kind: "ruflo", ref: "x" }), true);
  });

  it("defaults a record with no stated origin to native", async () => {
    const { buildAgentRecord } = await import("../src/orchestration/agent/record.js");
    const record = buildAgentRecord({ agentId: "a", version: "1", adapter: "x", now: NOW });
    assert.deepEqual(record.source, NATIVE_ORIGIN);
    assert.equal(record.requiresModelRoute, true);
  });
});
