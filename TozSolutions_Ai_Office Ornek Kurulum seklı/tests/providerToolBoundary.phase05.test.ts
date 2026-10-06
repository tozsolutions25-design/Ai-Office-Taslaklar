/**
 * PHASE 05 - Provider / Tool Boundary.
 *
 * Written against the required behaviour, before the implementation, so the
 * evidence of failure is the tests failing rather than a description of them.
 *
 * THE DEFECT THIS PHASE WAS FORCED TO FIND. `authority.ts` turned an adapter's
 * self-reported tool call into run evidence like this:
 *
 *     for (const toolCall of execution.value.toolCalls ?? []) {
 *       collector.toolCall({ toolId: toolCall, durationMs: null, sideEffecting: false });
 *     }
 *
 * Three things are wrong with those three fields, and all three are the same
 * mistake - a caller asserting a fact the system owns:
 *
 *   1. `sideEffecting: false` is a LITERAL. A tool registered `sideEffecting: true`
 *      is recorded as harmless, so the one record that exists to say what a run did
 *      says the irreversible thing was not. The registry knows the answer; the
 *      adapter's silence was preferred over it.
 *   2. Nothing checks the call was ever ALLOWED. An adapter can name any tool,
 *      including one the agent never declared and one the caller is denied, and the
 *      claim becomes evidence. This is "caller-supplied fields become authoritative
 *      merely because they claim a state", which the project forbids everywhere else.
 *   3. Nothing is traced. All three `tool_*` event kinds existed and none could
 *      ever be emitted, because the one code path that produced tool evidence
 *      emitted no event.
 *
 * The fix is not a second tool authority. It is the opposite: the ONE registry and
 * the ONE `ToolExecutionHost` become the only thing that can turn a reported call
 * into evidence, and an unverified claim produces no evidence at all.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { CapabilitySet } from "../src/capabilities/capability.js";
import { ManualClock } from "../src/core/clock.js";
import { ROUTING_POLICIES } from "../src/routing/policy.js";
import { DefaultRouter } from "../src/routing/defaultRouter.js";
import { type RoutingCandidate } from "../src/routing/router.js";
import { type WorkloadRequirements } from "../src/workload/workload.js";
import { trustRank } from "../src/orchestration/agent/trust.js";
import {
  ToolRegistry,
  authorizeToolCall,
  type ToolCallApproval,
  type ToolPermission,
  type ToolRecordInput,
} from "../src/orchestration/tools/tool.js";
import { ToolExecutionHost, TextStatInvoker } from "../src/orchestration/tools/invoker.js";
import { type OrchestrationRequest, type OrchestrationResult, TozOrchestrator } from "../src/orchestration/authority.js";
import { SpecialistPool } from "../src/orchestration/pool/specialistPool.js";
import { DriftGuard } from "../src/orchestration/policy/antiDrift.js";
import { PermissiveInputPolicy, PermissiveOutputPolicy } from "../src/orchestration/policy/security.js";
import { LocalAgentAdapter } from "./helpers/localAgentAdapter.js";
import { RESEARCH_CAPABILITIES, buildHarness } from "./helpers/orchestrationHarness.js";
import { assertOk } from "./contracts/contracts.js";

// The repository root, not the compiled location: this suite reads SOURCE, because
// the claims it checks are about source structure. `process.cwd()` is the repo root
// when the suite runs, which is how every other source-scanning suite here resolves
// it - resolving from `import.meta.url` would point at `dist/`.
const PROJECT_ROOT = process.cwd();
const CLOCK = new ManualClock(new Date("2026-01-01T00:00:00.000Z"));

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                     */
/* -------------------------------------------------------------------------- */

function tool(input: ToolRecordInput): ToolRecordInput {
  return input;
}

/** A registry with one harmless tool and one that changes state it cannot undo. */
function registryWith(records: readonly ToolRecordInput[]): ToolRegistry {
  const registry = new ToolRegistry({ clock: CLOCK });
  for (const record of records) {
    assertOk(registry.register(tool(record)), `registering ${record.toolId}`);
  }
  return registry;
}

const READ_ONLY: ToolRecordInput = {
  toolId: "text_stat",
  kind: "local",
  description: "Counts words in a string",
  sideEffecting: false,
  minimumTrust: "low",
};

const PUBLISHER: ToolRecordInput = {
  toolId: "web_publish",
  kind: "remote",
  description: "Publishes a page to the public internet",
  sideEffecting: true,
  network: true,
  minimumTrust: "high",
};

function host(registry: ToolRegistry, invokers: Record<string, TextStatInvoker> = {}): ToolExecutionHost {
  return new ToolExecutionHost({ registry, invokers: { text_stat: new TextStatInvoker(), ...invokers } });
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

/**
 * A harness whose agent DECLARES `declaredTools`, and whose adapter reports having
 * invoked `reported`.
 *
 * Both halves are needed: a declared tool the agent never used is not a call, and
 * an undeclared tool the agent "used" is the defect. The tools are registered in the
 * HARNESS's own registry - the same one the orchestrator holds - and the tool host
 * is built over that same registry, because two registries would be the defect this
 * phase exists to close.
 */
function toolHarness(options: {
  readonly declared?: readonly string[];
  readonly reported?: readonly string[];
  readonly records?: readonly ToolRecordInput[];
  readonly trustLevel?: string;
  readonly withToolHost?: boolean;
  readonly retire?: readonly string[];
}): ReturnType<typeof buildHarness> {
  const harness = buildHarness({
    adapter: new LocalAgentAdapter({
      descriptor: {
        agentId: "research-agent",
        name: "Research agent",
        version: "1.0.0",
        capabilities: { supported: [...RESEARCH_CAPABILITIES], unsupported: [] },
      },
      reportsToolCalls: options.reported ?? [],
    }),
    toolHost:
      options.withToolHost === false
        ? undefined
        : (registry: ToolRegistry) => new ToolExecutionHost({ registry, invokers: {} }),
  });
  for (const record of options.records ?? [READ_ONLY, PUBLISHER]) {
    assertOk(harness.tools.register(record), `registering ${record.toolId}`);
  }
  for (const toolId of options.retire ?? []) {
    assertOk(harness.tools.retire(toolId), `retiring ${toolId}`);
  }
  (harness.register as (input: Record<string, unknown>) => void)(
    agentInput({ toolRequirements: options.declared ?? [], trustLevel: options.trustLevel ?? "standard" }),
  );
  return harness;
}

async function run(h: ReturnType<typeof toolHarness>): Promise<OrchestrationResult> {
  return assertOk<OrchestrationResult>(await h.orchestrator.execute(request()));
}

function toolEvents(h: ReturnType<typeof toolHarness>): readonly string[] {
  return h.traces.events().map((event) => event.kind as string);
}

/* -------------------------------------------------------------------------- */
/* A. A reported tool call is evidence only when the ONE tool authority says so  */
/* -------------------------------------------------------------------------- */

describe("PHASE 05 A - a reported tool call is evidence only when verified", () => {
  it("records a declared, permitted, registered tool as evidence", async () => {
    const h = toolHarness({ declared: ["text_stat"], reported: ["text_stat"] });
    const result = await run(h);
    assert.equal(result.outcome, "succeeded", result.reason);
    const calls = result.evidence?.toolCalls ?? [];
    assert.equal(calls.length, 1, "the verified call must appear in the evidence");
    assert.equal(calls[0]?.toolId, "text_stat");
  });

  it("takes sideEffecting from the REGISTRY, not from the adapter's silence", async () => {
    // The adapter reports only a NAME. It cannot say whether the tool is
    // irreversible, and the previous code answered "it is not".
    const h = toolHarness({ declared: ["text_stat"], reported: ["text_stat"] });
    const result = await run(h);
    const call = result.evidence?.toolCalls[0];
    assert.ok(call, "a verified call must be recorded");
    assert.equal(call.sideEffecting, false, "text_stat is registered sideEffecting:false");
  });

  it("does not fabricate a duration for a call the host never performed", async () => {
    const h = toolHarness({ declared: ["text_stat"], reported: ["text_stat"] });
    const result = await run(h);
    assert.equal(result.evidence?.toolCalls[0]?.durationMs, null, "unmeasured is null, never 0");
  });

  it("REFUSES a call to a tool the agent never declared", async () => {
    const h = toolHarness({ declared: [], reported: ["text_stat"] });
    const result = await run(h);
    assert.equal(result.outcome, "failed", "an undeclared tool is not evidence of anything");
    assert.equal(result.errorClass, "configuration_error", result.reason);
    assert.equal((result.evidence?.toolCalls ?? []).length, 0, "no evidence may exist for a refused call");
  });

  it("an agent that declares a tool which does not exist is rejected before it runs", async () => {
    // The pool refuses the agent (`missing_tool`) rather than the tool authority
    // catching it later. Asserting the real mechanism matters: a test that claimed
    // the tool authority caught this would be passing for the wrong reason, and the
    // distinction is the difference between two controls and one.
    const h = toolHarness({ declared: ["ghost_tool"], reported: ["ghost_tool"] });
    const result = await run(h);
    assert.equal(result.outcome, "failed", result.reason);
    assert.match(result.reason, /missing_tool/, "the POOL refuses it, before the tool authority is asked");
    assert.equal((result.evidence?.toolCalls ?? []).length, 0);
    // Recorded as a limitation rather than fixed here: the pool's reason says
    // `missing_tool` and does not NAME the tool. An operator reading a run failure
    // learns that a declared tool is absent, not which one, and the fix belongs to
    // the pool's own message rather than to this phase.
  });

  it("REFUSES a side-effecting tool, because no approval exists for it", async () => {
    const h = toolHarness({ declared: ["web_publish"], reported: ["web_publish"], trustLevel: "privileged" });
    const result = await run(h);
    assert.equal(result.outcome, "failed", "an irreversible action with no approval must not be accepted");
    assert.match(result.reason, /approval/i);
  });

  it("REFUSES a tool whose trust floor the agent does not meet", async () => {
    const h = toolHarness({ declared: ["web_publish"], reported: ["web_publish"], trustLevel: "low" });
    const result = await run(h);
    assert.equal(result.outcome, "failed", result.reason);
  });

  it("REFUSES a retired tool", async () => {
    const h = toolHarness({ declared: ["text_stat"], reported: ["text_stat"], retire: ["text_stat"] });
    const result = await run(h);
    assert.equal(result.outcome, "failed", result.reason);
  });

  it("REFUSES every reported call when no tool authority is configured", async () => {
    const h = toolHarness({ declared: ["text_stat"], reported: ["text_stat"], withToolHost: false });
    const result = await run(h);
    assert.equal(result.outcome, "failed", "a claim no authority can check is not evidence");
    assert.equal((result.evidence?.toolCalls ?? []).length, 0);
    assert.match(result.reason, /no tool authority/i);
  });

  it("traces tool_invoked for a verified call and tool_refused for a refused one", async () => {
    const verified = toolHarness({ declared: ["text_stat"], reported: ["text_stat"] });
    await run(verified);
    assert.ok(toolEvents(verified).includes("tool_invoked"), "a verified call must be traceable");

    const refused = toolHarness({ declared: [], reported: ["text_stat"] });
    await run(refused);
    assert.ok(toolEvents(refused).includes("tool_refused"), "a refusal must be traceable");
  });

  it("records a side-effecting tool's refusal as refused, not as invoked", async () => {
    const h = toolHarness({ declared: ["web_publish"], reported: ["web_publish"], trustLevel: "privileged" });
    await run(h);
    const kinds = toolEvents(h);
    assert.ok(!kinds.includes("tool_invoked"), "nothing may claim an irreversible call happened");
    assert.ok(kinds.includes("tool_refused"));
  });

  it("refuses EVERY unverified call rather than only the first", async () => {
    const h = toolHarness({ declared: ["text_stat"], reported: ["text_stat", "ghost", "web_publish"] });
    const result = await run(h);
    assert.equal(result.outcome, "failed");
    assert.equal((result.evidence?.toolCalls ?? []).length, 0, "no partial evidence may survive a refusal");
  });
});

/* -------------------------------------------------------------------------- */
/* B. One tool authority                                                        */
/* -------------------------------------------------------------------------- */

describe("PHASE 05 B - there is exactly one tool authority", () => {
  it("verifies reported calls through the host, not through a local registry copy", () => {
    // Two registries would mean two answers to "which tools exist", and a tool
    // authorised by one would be invisible to the other.
    const registry = registryWith([READ_ONLY]);
    const toolHost = host(registry);
    assert.equal(toolHost.registry, registry, "the host must authorise against the same registry");
  });

  it("reports each tool from the registry rather than accepting a claimed flag", () => {
    const registry = registryWith([PUBLISHER]);
    const toolHost = host(registry);
    const permission: ToolPermission = { subject: "s", trustLevel: "privileged" };
    // Declared as empty, so the call is refused for being undeclared: the host
    // must not consult the claimant's own report when deciding what was claimed.
    const verified = toolHost.verifyReported([], permission, trustRank, ["web_publish"]);
    assert.equal(verified.refusals.length, 1, "an undeclared call is refused");
    assert.equal(verified.verified.length, 0);
  });

  it("returns the REGISTRY's sideEffecting value for a permitted call", () => {
    const registry = registryWith([READ_ONLY, PUBLISHER]);
    const toolHost = host(registry);
    // No side-effect approval is required by this permission, so the call is
    // permitted - and the record it returns must carry the registry's fact.
    const permission: ToolPermission = { subject: "s", trustLevel: "privileged" };
    const verified = toolHost.verifyReported(
      ["text_stat", "web_publish"],
      permission,
      trustRank,
      ["text_stat", "web_publish"],
    );
    assert.equal(
      verified.verified.length,
      2,
      verified.refusals.map((r: { reason: string }) => r.reason).join("; "),
    );
    assert.equal(verified.verified[1]?.sideEffecting, true, "web_publish is registered sideEffecting:true");
  });

  it("REFUSES a tool host built over a DIFFERENT registry", () => {
    // Two registries would mean two answers to "which tools exist", and a tool one of
    // them authorised would be invisible to the other. Refused at construction, where
    // the operator is looking, rather than on the first reported call.
    const h = toolHarness({ declared: ["text_stat"], reported: ["text_stat"] });
    const foreign = new ToolExecutionHost({ registry: registryWith([READ_ONLY]), invokers: {} });
    assert.throws(
      () =>
        new TozOrchestrator({
          agents: h.agents,
          capabilities: h.capabilities,
          pool: new SpecialistPool({ candidates: () => [] }),
          models: h.models,
          tools: h.tools,
          toolHost: foreign,
          verification: h.verification,
          memory: h.memory,
          feedback: h.feedback,
          traces: h.traces,
          resources: h.resources,
          drift: new DriftGuard(),
          security: h.security,
          inputPolicy: new PermissiveInputPolicy(),
          outputPolicy: new PermissiveOutputPolicy(),
          adapters: h.adapters,
          clock: h.clock,
        }),
      /ONE tool registry/,
      "a second registry would make the tool boundary unanswerable",
    );
  });

  it("the tool host is no longer dead code on the execution path", () => {
    const authority = readFileSync(path.join(PROJECT_ROOT, "src/orchestration/authority.ts"), "utf8");
    assert.match(authority, /verifyReported/, "the orchestrator must verify through the tool authority");
    // And the composition root must hand it the SAME host the orchestrator holds,
    // or the verification is against a registry nothing else can see.
    const composition = readFileSync(path.join(PROJECT_ROOT, "src/orchestration/composition.ts"), "utf8");
    assert.match(composition, /toolHost/, "the composition root must supply the tool authority");
  });

  it("the composed runtime hands the orchestrator the SAME host it exposes", async () => {
    const { createRuntime } = await import("../src/orchestration/composition.js");
    const runtime = createRuntime();
    assert.equal(
      runtime.toolHost.registry,
      runtime.tools,
      "one registry, or the runtime has two answers to which tools exist",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* C. B-13: the side-effect approval requirement is now satisfiable            */
/* -------------------------------------------------------------------------- */

describe("PHASE 05 C - a side-effecting tool's approval can actually be obtained", () => {
  const permission: ToolPermission = {
    subject: "subject-1",
    trustLevel: "privileged",
    requiresApprovalForSideEffects: true,
  };

  it("still refuses with no approval, fail closed", () => {
    const registry = registryWith([PUBLISHER]);
    const result = authorizeToolCall(registry, permission, "web_publish", trustRank);
    assert.equal(result.ok, false, "absence of an approval must not read as permission");
  });

  it("permits a call that carries an approval for THAT tool and THAT subject", () => {
    const registry = registryWith([PUBLISHER]);
    const approval: ToolCallApproval = {
      toolId: "web_publish",
      subject: "subject-1",
      approvedBy: "human-1",
      approvedAt: CLOCK.now(),
    };
    const result = authorizeToolCall(registry, permission, "web_publish", trustRank, approval);
    assert.equal(result.ok, true, "a granted approval must be honoured, or the setting is a dead end");
  });

  it("refuses an approval issued for a DIFFERENT tool", () => {
    const registry = registryWith([PUBLISHER, READ_ONLY]);
    const approval: ToolCallApproval = {
      toolId: "text_stat",
      subject: "subject-1",
      approvedBy: "human-1",
      approvedAt: CLOCK.now(),
    };
    assert.equal(authorizeToolCall(registry, permission, "web_publish", trustRank, approval).ok, false);
  });

  it("refuses an approval issued to a DIFFERENT subject", () => {
    const registry = registryWith([PUBLISHER]);
    const approval: ToolCallApproval = {
      toolId: "web_publish",
      subject: "someone-else",
      approvedBy: "human-1",
      approvedAt: CLOCK.now(),
    };
    assert.equal(authorizeToolCall(registry, permission, "web_publish", trustRank, approval).ok, false);
  });

  it("refuses an approval with no named approver", () => {
    const registry = registryWith([PUBLISHER]);
    const approval: ToolCallApproval = {
      toolId: "web_publish",
      subject: "subject-1",
      approvedBy: "",
      approvedAt: CLOCK.now(),
    };
    assert.equal(authorizeToolCall(registry, permission, "web_publish", trustRank, approval).ok, false);
  });

  it("refuses an approval with no timestamp", () => {
    const registry = registryWith([PUBLISHER]);
    const approval = {
      toolId: "web_publish",
      subject: "subject-1",
      approvedBy: "human-1",
    } as unknown as ToolCallApproval;
    assert.equal(authorizeToolCall(registry, permission, "web_publish", trustRank, approval).ok, false);
  });

  it("names the way to satisfy it, so the refusal is not a dead end", () => {
    const registry = registryWith([PUBLISHER]);
    const result = authorizeToolCall(registry, permission, "web_publish", trustRank);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error.message, /approval/i);
  });
});

/* -------------------------------------------------------------------------- */
/* D. B-09: the configured policy governs the PRIMARY choice too                */
/* -------------------------------------------------------------------------- */

describe("PHASE 05 D - primary selection honours the policy the deployment configured", () => {
  it("orders by a named policy and says which facts decided it", async () => {
    const pair = twoCandidates();
    const source = { candidates: () => pair };
    const byFacts = new DefaultRouter({ candidates: source });
    const byPolicy = new DefaultRouter({ candidates: source });

    const facts = await byFacts.select({ requirements: requirements(), workloadLabel: "w" });
    const policy = await byPolicy.select({
      requirements: requirements(),
      workloadLabel: "w",
      policy: "cost-sensitive",
    });

    assert.equal(facts.selected?.provider.providerId, "premium-provider", "verified-facts baseline");
    assert.equal(policy.selected?.provider.providerId, "cheap-provider", "the policy must actually decide");
    assert.ok(
      (policy.ordering?.decidingFacts ?? []).includes("cost_class"),
      `expected cost_class to decide, got ${JSON.stringify(policy.ordering?.decidingFacts)}`,
    );
    assert.equal(policy.ordering?.policy, "cost-sensitive");
  });

  it("keeps verified-facts when no policy is named, so no existing caller changes", async () => {
    const pair = twoCandidates();
    const router = new DefaultRouter({ candidates: { candidates: () => pair } });
    const decision = await router.select({ requirements: requirements(), workloadLabel: "w" });
    assert.equal(decision.selected?.provider.providerId, "premium-provider");
    assert.equal(decision.ordering, undefined, "an unnamed policy reports no ordering claim");
  });

  it("refuses an unknown policy name rather than silently using another", async () => {
    const pair = twoCandidates();
    const router = new DefaultRouter({ candidates: { candidates: () => pair } });
    await assert.rejects(
      () => router.select({ requirements: requirements(), workloadLabel: "w", policy: "no-such-policy" }),
      /Unknown routing policy/,
    );
  });

  it("a policy cannot make an ineligible candidate eligible", async () => {
    const pair = twoCandidates();
    const router = new DefaultRouter({ candidates: { candidates: () => pair } });
    const decision = await router.select({
      requirements: requirements({ minContextTokens: 9_000_000 }),
      workloadLabel: "w",
      policy: "cost-sensitive",
    });
    assert.equal(decision.selected, null, "the hard filter still decides eligibility");
  });

  it("a policy cannot reselect a candidate governance denied", async () => {
    const pair = twoCandidates();
    const router = new DefaultRouter({ candidates: { candidates: () => pair } });
    const decision = await router.select({
      requirements: requirements(),
      workloadLabel: "w",
      policy: "cost-sensitive",
      exclude: { providerIds: ["cheap-provider"], modelKeys: [], providerTypes: [] },
    });
    assert.equal(decision.selected?.provider.providerId, "premium-provider", "narrowing is not a preference");
  });

  it("explains an uninformative policy instead of pretending it ranked", async () => {
    const pair = twoCandidates();
    const router = new DefaultRouter({ candidates: { candidates: () => pair } });
    const decision = await router.select({
      requirements: requirements(),
      workloadLabel: "w",
      policy: "latency-sensitive",
    });
    // Neither provider has a recorded latency, so the policy cannot rank on it.
    assert.ok(
      (decision.ordering?.uninformedFacts ?? []).includes("latency"),
      `latency was never measured and must be reported uninformed: ${JSON.stringify(decision.ordering)}`,
    );
  });

  it("the shipped policies are the ones a caller can name", () => {
    assert.ok(Object.keys(ROUTING_POLICIES).includes("cost-sensitive"));
  });
});

/* -------------------------------------------------------------------------- */
/* E. Structural drift proofs                                                   */
/* -------------------------------------------------------------------------- */

describe("PHASE 05 E - the boundaries cannot erode silently", () => {
  it("no module asserts a tool's side-effecting flag as a literal in evidence", () => {
    // Comments are stripped first: the defect this forbids has to be *named* in a
    // comment, and a docblock is not an enforcement point.
    const offenders = walk("src")
      .filter((file) => !file.includes("/tools/"))
      .filter((file) => /sideEffecting:\s*false/.test(stripComments(readFileSync(path.join(PROJECT_ROOT, file), "utf8"))))
      .filter((file) => /toolCall\(/.test(readFileSync(path.join(PROJECT_ROOT, file), "utf8")));
    assert.deepEqual(offenders, [], "only the tool registry may state a tool's side effects");
  });

  it("every router is constructed in the composition root, never in a policy module", () => {
    const constructing = walk("src").filter((file) => /new (DefaultRouter|FallbackPlanner)\(/.test(readFileSync(path.join(PROJECT_ROOT, file), "utf8")));
    assert.deepEqual(
      constructing.map((f) => f.replace(/\\/g, "/")).sort(),
      ["src/core/composition.ts", "src/orchestration/model/modelRouter.ts"],
      "a second router or planner is a second routing authority",
    );
  });

  it("no governance module constructs a router or a tool host", () => {
    const governance = walk("src/orchestration/governance");
    const offenders = governance.filter((file) =>
      /new (DefaultRouter|FallbackPlanner|ToolExecutionHost)\(/.test(
        readFileSync(path.join(PROJECT_ROOT, file), "utf8"),
      ),
    );
    assert.deepEqual(offenders, [], "governance decides; it does not route or execute");
  });

  it("the runtime does not ship an MCP client", () => {
    const pkg = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8")) as {
      readonly dependencies?: Record<string, string>;
    };
    assert.deepEqual(pkg.dependencies ?? {}, {}, "no runtime dependency may be added");
    const offenders = walk("src").filter((file) => /McpClient|MCPClient|new McpServer/.test(readFileSync(path.join(PROJECT_ROOT, file), "utf8")));
    assert.deepEqual(offenders, [], "a stub shaped like MCP is a fabricated capability");
  });

  it("an ingested agency adapter is not composed as a runtime authority", () => {
    // Agency is a capability source. Composing it would make it a second system.
    const composition = readFileSync(path.join(PROJECT_ROOT, "src/orchestration/composition.ts"), "utf8");
    assert.ok(
      !/new AgencyAgentAdapter\(/.test(stripComments(composition)),
      "Agency must not be constructed by the composition root",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* F. Dead methods: decided, not left to rot                                    */
/* -------------------------------------------------------------------------- */

describe("PHASE 05 F - the unreachable methods are decided, and reported", () => {
  it("the runtime reports adapter AVAILABILITY, not merely a registered name", async () => {
    const { createRuntime } = await import("../src/orchestration/composition.js");
    const runtime = createRuntime();
    const probed = await runtime.probe();
    assert.ok(
      probed.agentAdapterAvailability.length > 0,
      "availability is a measurement; a name is not one",
    );
    const unavailable = probed.agentAdapterAvailability.find((entry) => entry.name === "unavailable");
    assert.ok(unavailable, "the shipped adapter must be reported");
    assert.equal(unavailable.available, false, "the default adapter reports itself unavailable");
  });

  it("reports a registered adapter that says it cannot run, rather than printing its name", async () => {
    const { createRuntime } = await import("../src/orchestration/composition.js");
    const { LocalAgentAdapter } = await import("./helpers/localAgentAdapter.js");
    const runtime = createRuntime({
      adapters: [
        new LocalAgentAdapter({
          name: "reporting-adapter",
          descriptor: {
            agentId: "a",
            name: "A",
            version: "1.0.0",
            capabilities: { supported: [], unsupported: [] },
          },
          failWith: "temporary_outage",
        }),
      ],
    });
    const probed = await runtime.probe();
    const entry = probed.agentAdapterAvailability.find((e) => e.name === "reporting-adapter");
    assert.ok(entry, "a supplied adapter must be probed");
    assert.equal(entry.available, false, "an adapter that fails on every call is not available");
  });

  it("reports that the agency adapter is not composed, rather than implying it is", async () => {
    const { createRuntime } = await import("../src/orchestration/composition.js");
    const described = createRuntime().describe();
    assert.equal(described.agencyAdapterComposed, false, "Agency is a source, not a composed authority");
  });

  it("reports the tool approval closure, so an operator sees it at boot", async () => {
    const { createRuntime } = await import("../src/orchestration/composition.js");
    const described = createRuntime().describe();
    assert.equal(described.toolApproval, "required-and-unobtained", "no flow issues a tool approval yet");
  });
});

/* -------------------------------------------------------------------------- */
/* helpers                                                                      */
/* -------------------------------------------------------------------------- */

function walk(dir: string): string[] {
  const base = path.join(PROJECT_ROOT, dir);
  const out: string[] = [];
  for (const name of readdirSync(base, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(full));
    else if (name.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Removes comments, so a docblock cannot be mistaken for code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function requirements(overrides: Partial<WorkloadRequirements> = {}): WorkloadRequirements {
  return {
    requiredCapabilities: [],
    minContextTokens: null,
    requiredTools: [],
    reliability: "standard",
    latencyPreference: "balanced",
    costPreference: "balanced",
    fallbackRequired: false,
    ...overrides,
  };
}

/**
 * Two eligible candidates that DISAGREE, and the disagreement is deliberate.
 *
 * `premium-provider` has the larger recorded context window, which is the term
 * `computeVerifiedFactsRank` weighs most heavily after capability count, so
 * verified-facts picks it. `cheap-provider` is free, which is the FIRST fact
 * `cost-sensitive` consults, so that policy picks the other one. A fixture where both
 * orderings agree would prove nothing about which mechanism ran.
 *
 * Neither has a recorded latency, so a `latency-sensitive` policy can rank on
 * nothing at all - which is what the `uninformedFacts` assertion is about.
 *
 * `lifecycleState` is `production_pool` because that is the only state
 * `isProductionEligible` accepts, and a fixture that quietly used a different one
 * would make every candidate ineligible and the whole suite pass for the wrong
 * reason.
 */
function twoCandidates(): readonly RoutingCandidate[] {
  const base = {
    enabled: true,
    approvalStatus: "approved" as const,
    capabilities: new CapabilitySet({}),
    freeTierStatus: "none" as const,
    latencyP50Ms: null,
    health: { status: "healthy" as const, latencyMs: null, checkedAt: null, detail: null },
  };
  return [
    {
      provider: {
        ...base,
        providerId: "premium-provider",
        type: "remote" as const,
        costClass: "premium" as const,
        contextLimitTokens: 900_000,
      },
      model: null,
      lifecycleState: "production_pool" as const,
    },
    {
      provider: {
        ...base,
        providerId: "cheap-provider",
        type: "remote" as const,
        costClass: "free" as const,
        contextLimitTokens: 4_000,
      },
      model: null,
      lifecycleState: "production_pool" as const,
    },
  ] as unknown as readonly RoutingCandidate[];
}
