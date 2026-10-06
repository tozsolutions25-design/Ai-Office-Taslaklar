/**
 * PHASE 08 EVIDENCE - what an agent may reach, exercised rather than asserted from source.
 *
 * ## WHY THIS FILE IS BEHAVIOURAL WHERE THE OTHERS ARE STRUCTURAL
 *
 * `agentAuthority.p08-evidence.test.ts` reads source, because "nothing else can do this" has
 * no behavioural signature. The claims in THIS file are the opposite kind: each one is about
 * what a run actually does when an agent tries something, and all of them can be answered by
 * running the real composition root rather than by reading about it.
 *
 * Running them matters because four of these boundaries are enforced in four different
 * places - the registry's lifecycle table, the pool's filter, the governance rule set, and
 * the tool authority - and none of them is the one you would guess. An audit that only read
 * one of the four would report the system as more permissive than it is.
 *
 * The brief's Phase 08 scope names these boundaries explicitly: agent isolation, memory
 * access, tool access, trust/capability matching, and verification/evidence.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CapabilitySet, type Capability } from "../src/capabilities/capability.js";
import { ManualClock } from "../src/core/clock.js";
import { err, ok, type Result } from "../src/core/result.js";
import { createSecurityContext, type Grant, type SecurityContext } from "../src/orchestration/governance/context.js";
import { createRuntime, type Runtime } from "../src/orchestration/composition.js";
import type {
  AgentAdapter,
  AgentExecutionError,
  AgentExecutionRequest,
  AgentExecutionResult,
  AdapterAgentDescriptor,
} from "../src/orchestration/agent/adapter.js";
import type { AgentRecordInput } from "../src/orchestration/agent/record.js";
import { canTransitionAgent, type RegisteredAgent } from "../src/orchestration/agent/registry.js";
import type { WorkspaceRef } from "../src/orchestration/workspace/workspace.js";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";
import { assertOk } from "./contracts/contracts.js";

const NOW = new Date("2026-04-01T00:00:00.000Z");
const WS: WorkspaceRef = workspaceRef("phase-08-workspace");
const RESEARCH: Capability = "web_research";

/**
 * A backend that can be told to report a provider it was not routed to.
 *
 * Reporting `null` is the honest default and what `InProcessAdapter` in the Phase 02 suite
 * does. This variant exists so the route-accounting invariant can be exercised from the
 * outside: a self-hosted agent whose adapter claims a provider must leave that claim in the
 * trace, and an agent that was routed and then reports something else must leave the
 * MISMATCH in the trace.
 */
class ReportingAdapter implements AgentAdapter {
  public readonly name = "reporting";
  public readonly calls: string[] = [];
  public readonly descriptor: AdapterAgentDescriptor = {
    agentId: "reporting-agent",
    name: "Reporting agent",
    version: "1.0.0",
    capabilities: { supported: [RESEARCH], unsupported: [] },
  };

  public constructor(private readonly reported: { providerId?: string; modelId?: string } = {}) {}

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public describe(agentId: string, version: string): Promise<Result<AdapterAgentDescriptor, Error>> {
    return Promise.resolve(
      agentId === this.descriptor.agentId
        ? ok({ ...this.descriptor, version })
        : err(new Error(`Unknown agent: ${agentId}`)),
    );
  }

  public execute(agentId: string, request: AgentExecutionRequest): Promise<Result<AgentExecutionResult, AgentExecutionError>> {
    this.calls.push(request.taskId);
    return Promise.resolve(
      ok({
        agentId,
        version: "1.0.0",
        taskId: request.taskId,
        durationMs: 1,
        output: "done",
        ...this.reported,
      }),
    );
  }
}

function grant(operation: Grant["operation"], overrides: Partial<Grant> = {}): Grant {
  return { operation, resources: [], allowList: [], capabilities: [], trustFloor: "standard", expiresAt: null, ...overrides };
}

function authorised(overrides: Partial<Parameters<typeof createSecurityContext>[0]> = {}): SecurityContext {
  return createSecurityContext({
    actor: "operator",
    trustLevel: "standard",
    grants: [
      grant("workflow.execute"),
      grant("capability.execute", { capabilities: [RESEARCH] }),
      grant("memory.read"),
      grant("memory.write"),
      grant("memory.capture"),
    ],
    scopes: ["task"],
    ...overrides,
  });
}

function registerAgent(
  runtime: Runtime,
  overrides: Partial<Omit<AgentRecordInput, "now">> = {},
  promote = true,
): RegisteredAgent {
  const input: Omit<AgentRecordInput, "now"> = {
    agentId: "reporting-agent",
    version: "1.0.0",
    adapter: "reporting",
    status: "active",
    trustLevel: "standard",
    capabilities: CapabilitySet.supporting(RESEARCH),
    requiresModelRoute: false,
    ...overrides,
  };
  const registered = assertOk<RegisteredAgent>(runtime.agents.register(input), "agent registration");
  runtime.capabilities.index(registered.record);
  if (promote) {
    for (const step of ["verified", "registered", "available"] as const) {
      assertOk(runtime.agents.transition(input.agentId, input.version, step), `agent ${step}`);
    }
  }
  return registered;
}

function runtimeWith(adapter: AgentAdapter, context: SecurityContext = authorised()): Runtime {
  return createRuntime({
    clock: new ManualClock(NOW),
    adapters: [adapter],
    identity: { resolve: () => context, serviceContext: context },
    workspace: WS,
  });
}

describe("PHASE 08 EVIDENCE - agent reach, exercised", () => {
  /* -- isolation ------------------------------------------------------------- */

  it("will not find one workspace's agent from another", () => {
    const acme = createRuntime({ clock: new ManualClock(NOW), adapters: [new ReportingAdapter()], workspace: workspaceRef("acme") });
    registerAgent(acme);

    // A registry for the same workspace is a second instance; a registry for a DIFFERENT
    // workspace is the partition. The lookup is not filtered - it misses, because there is
    // no un-partitioned key to find it with.
    const globex = createRuntime({ clock: new ManualClock(NOW), adapters: [new ReportingAdapter()], workspace: workspaceRef("globex") });
    assert.equal(globex.agents.has("reporting-agent", "1.0.0"), false, "a cross-workspace agent must be ABSENT, not merely hidden");
    assert.equal(acme.agents.has("reporting-agent", "1.0.0"), true, "and present in its own");
  });

  /* -- lifecycle ------------------------------------------------------------- */

  it("refuses to skip the lifecycle, so an agent cannot be selected before it is verified", () => {
    const runtime = runtimeWith(new ReportingAdapter());
    // Registered but never promoted: status says active, lifecycle says `discovered`.
    // Both gates must hold, and this is the case where enforcing only one of them would
    // let an unverified agent run - the record looks perfectly selectable on every field.
    const record = registerAgent(runtime, { status: "active" }, false);
    assert.equal(record.lifecycle, "discovered");
    assert.equal(record.record.status, "active", "which is the whole point: status alone would permit it");
    assert.equal(
      canTransitionAgent(record.lifecycle, "available"),
      false,
      "and the shortcut edge must not exist",
    );

    const assessed = runtime.pool.assess(
      { taskId: "t1", requiredCapabilities: [RESEARCH], minimumTrust: "low" },
      { providerIds: () => [], availableTools: () => [], grantedMemoryScopes: () => ["task" as const] },
    );
    const candidate = assessed.find((a) => a.agentKey === "reporting-agent@1.0.0");
    assert.ok(candidate !== undefined);
    assert.equal(candidate.eligible, false, "an unverified agent must be ineligible");
    assert.ok(
      candidate.rejections.includes("not_available"),
      `expected not_available from the lifecycle gate, got ${JSON.stringify(candidate.rejections)}`,
    );
  });

  /* -- trust ----------------------------------------------------------------- */

  it("refuses an agent below the requested trust floor, and says which rule refused it", () => {
    const runtime = runtimeWith(new ReportingAdapter());
    registerAgent(runtime, { trustLevel: "low" });

    const context = {
      providerIds: () => [],
      availableTools: () => [],
      grantedMemoryScopes: () => ["task" as const],
    };
    const assessed = runtime.pool.assess(
      { taskId: "t1", requiredCapabilities: [RESEARCH], minimumTrust: "high" },
      context,
    );
    const candidate = assessed.find((a) => a.agentKey === "reporting-agent@1.0.0");
    assert.ok(candidate !== undefined, "the candidate must be assessed, not hidden");
    assert.equal(candidate.eligible, false);
    assert.ok(candidate.rejections.includes("trust_below_floor"), `expected trust_below_floor, got ${JSON.stringify(candidate.rejections)}`);
  });

  /* -- capability ------------------------------------------------------------ */

  it("refuses an agent that declares the required capability UNSUPPORTED", () => {
    const runtime = runtimeWith(new ReportingAdapter());
    registerAgent(runtime, { capabilities: CapabilitySet.of({ [RESEARCH]: "unsupported" }) });

    const assessed = runtime.pool.assess(
      { taskId: "t1", requiredCapabilities: [RESEARCH], minimumTrust: "low" },
      { providerIds: () => [], availableTools: () => [], grantedMemoryScopes: () => ["task" as const] },
    );
    const candidate = assessed.find((a) => a.agentKey === "reporting-agent@1.0.0");
    assert.ok(candidate !== undefined);
    assert.ok(
      candidate.rejections.includes("capability_incompatible"),
      `expected capability_incompatible, got ${JSON.stringify(candidate.rejections)}`,
    );
  });

  it("treats an UNDECLARED capability as unknown rather than unsupported, and says so", () => {
    // The distinction is a policy decision, not an accident, and it is the one most likely to
    // be "fixed" by someone who reads omission as refusal.
    //
    // `CapabilitySet.supporting(...)` sets everything it does not list to `unknown` - the
    // header says so explicitly. So an agent that supports only `code_execution` has NOT
    // refused `web_research`; it has never claimed it. The pool therefore does not reject it
    // unless the request demands verified capabilities, at which point `unknown` stops being
    // an acceptable answer.
    //
    // That is the fail-open direction, deliberately: a new adapter whose capability profile
    // is incomplete stays selectable rather than being unusable, and a deployment that
    // cannot tolerate that says so in the request.
    const runtime = runtimeWith(new ReportingAdapter());
    registerAgent(runtime, { capabilities: CapabilitySet.supporting("code_execution") });

    const context = { providerIds: () => [], availableTools: () => [], grantedMemoryScopes: () => ["task" as const] };
    const lenient = runtime.pool
      .assess({ taskId: "t1", requiredCapabilities: [RESEARCH], minimumTrust: "low" }, context)
      .find((a) => a.agentKey === "reporting-agent@1.0.0");
    assert.ok(lenient !== undefined);
    assert.equal(lenient.capabilityMatch.verdict, "unknown", "omission is unknown, not refusal");
    assert.equal(
      lenient.rejections.includes("capability_unverified"),
      false,
      "and an unverified capability does not disqualify unless the request asks for verification",
    );

    const strict = runtime.pool
      .assess(
        { taskId: "t1", requiredCapabilities: [RESEARCH], minimumTrust: "low", requireVerifiedCapabilities: true },
        context,
      )
      .find((a) => a.agentKey === "reporting-agent@1.0.0");
    assert.ok(strict !== undefined);
    assert.ok(
      strict.rejections.includes("capability_unverified"),
      `a request demanding verified capabilities must not accept unknown, got ${JSON.stringify(strict.rejections)}`,
    );
  });

  /* -- memory ---------------------------------------------------------------- */

  it("filters an agent's declared memory scopes against the ACTOR's grants, not its own", () => {
    // The distinction is load-bearing and easy to get backwards: an agent does not become a
    // memory subject. It declares which scopes it needs, and those are checked against the
    // scopes the VERIFIED ACTOR holds. An agent that declares `global` memory is refused
    // when the operator was granted only `task`.
    const runtime = runtimeWith(new ReportingAdapter());
    registerAgent(runtime, { memoryScopes: ["global"] });

    const assessed = runtime.pool.assess(
      { taskId: "t1", requiredCapabilities: [RESEARCH], minimumTrust: "low" },
      { providerIds: () => [], availableTools: () => [], grantedMemoryScopes: () => ["task" as const] },
    );
    const candidate = assessed.find((a) => a.agentKey === "reporting-agent@1.0.0");
    assert.ok(candidate !== undefined);
    assert.ok(
      candidate.rejections.includes("memory_scope_unavailable"),
      `an agent may not widen memory reach beyond the actor; got ${JSON.stringify(candidate.rejections)}`,
    );
  });

  /* -- tools ----------------------------------------------------------------- */

  it("refuses an agent whose declared tool the deployment does not have", () => {
    const runtime = runtimeWith(new ReportingAdapter());
    registerAgent(runtime, { toolRequirements: ["a_tool_that_does_not_exist"] });

    const assessed = runtime.pool.assess(
      { taskId: "t1", requiredCapabilities: [RESEARCH], minimumTrust: "low" },
      { providerIds: () => [], availableTools: () => [], grantedMemoryScopes: () => ["task" as const] },
    );
    const candidate = assessed.find((a) => a.agentKey === "reporting-agent@1.0.0");
    assert.ok(candidate !== undefined);
    assert.ok(
      candidate.rejections.includes("missing_tool"),
      `got ${JSON.stringify(candidate.rejections)}`,
    );
  });

  /* -- route accounting, end to end ------------------------------------------ */

  it("records a self-hosted adapter's reported provider instead of losing it", async () => {
    const adapter = new ReportingAdapter({ providerId: "an-external-provider", modelId: "an-external-model" });
    const runtime = runtimeWith(adapter);
    registerAgent(runtime);

    const result = await runtime.orchestrator.execute({
      taskId: "t1",
      objective: "do the thing",
      input: "go",
      requiredCapabilities: [RESEARCH],
      taskType: "single",
      securityContext: authorised(),
    });
    assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result.ok ? null : result.error)}`);

    const kinds = runtime.traces.events().map((event) => event.kind);
    assert.ok(kinds.includes("agent_reported_route"), `expected agent_reported_route in ${JSON.stringify(kinds)}`);
    const reported = runtime.traces.events().find((event) => event.kind === "agent_reported_route");
    // `provider` and `model` are lifted onto the event itself; everything else rides in
    // `metadata`, which is the shape an auditor actually reads.
    assert.equal(reported?.provider, "an-external-provider", "the provider must be recorded");
    assert.equal(reported?.model, "an-external-model");
    const meta = (reported?.metadata ?? {}) as Record<string, unknown>;
    assert.equal(meta["routedProvider"], null, "and marked as NOT routed by TOZ");
    assert.equal(meta["selfHosted"], true);
  });

  it("stays silent when the adapter's report agrees with the route TOZ chose", async () => {
    const adapter = new ReportingAdapter();
    const runtime = runtimeWith(adapter);
    registerAgent(runtime);

    const result = await runtime.orchestrator.execute({
      taskId: "t1",
      objective: "do the thing",
      input: "go",
      requiredCapabilities: [RESEARCH],
      taskType: "single",
      securityContext: authorised(),
    });
    assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result.ok ? null : result.error)}`);
    const kinds = runtime.traces.events().map((event) => event.kind);
    assert.equal(
      kinds.includes("agent_reported_route"),
      false,
      "an adapter that has nothing to say must not produce an event per subtask",
    );
  });

  it("will not run an agent the operator holds no grant to execute", async () => {
    const adapter = new ReportingAdapter();
    const stranger = createSecurityContext({ actor: "stranger", trustLevel: "low", grants: [] });
    const runtime = runtimeWith(adapter, stranger);
    registerAgent(runtime);

    const result = await runtime.orchestrator.execute({
      taskId: "t1",
      objective: "do the thing",
      input: "go",
      requiredCapabilities: [RESEARCH],
      taskType: "single",
      securityContext: stranger,
    });
    // The refusal lives in the RESULT, not in the `Result` wrapper: `execute` resolves, and
    // the run reports itself failed with an authorization error. Asserting `result.ok` here
    // was the first version of this test and it passed a refusing run - the wrapper says the
    // call succeeded because the call did; the refusal is what the call produced.
    assert.ok(result.ok, "execute resolves; the refusal is in the result");
    assert.equal(result.value.outcome, "failed");
    assert.equal(result.value.errorClass, "authorization_error");
    assert.equal(adapter.calls.length, 0, "and the adapter must never have been reached");
  });
});
