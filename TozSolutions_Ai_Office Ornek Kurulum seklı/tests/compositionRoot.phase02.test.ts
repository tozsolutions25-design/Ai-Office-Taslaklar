/**
 * PHASE 02 - the composition root.
 *
 * WHY THIS FILE EXISTS, and why it is not another happy-path test.
 *
 * Phase 00 established that `TozOrchestrator`, `GovernanceGate`, `MemoryService`,
 * `ExecutionCoordinator`, `AgentIngestor`, `ToolExecutionHost` and `ModelRouter`
 * were constructed NOWHERE in `src/`. Every governance test in this repository
 * builds its own gate, its own router and its own agent registry. That is not a
 * style preference - it is why C-1 survived 1,598 green tests: the seam between
 * the governance gate and the real router had never been crossed with both
 * objects real, except by one test whose fixture could not distinguish the
 * defective code from the fixed code (D-03).
 *
 * These tests therefore assert things about WIRING, not about components:
 *
 *   - that the subsystems Phase 00 listed as absent are reachable from one place,
 *   - that governance is on the real execution path by default, and that a
 *     runtime which removed it FAILS here,
 *   - that each claim `describe()` makes is a measurement rather than an
 *     assertion,
 *   - that exactly ONE file in `src/` may assemble the system, so the second
 *     assembly point that made this phase necessary cannot quietly reappear.
 *
 * METHOD (binding, carried from Phase 01):
 *
 *   1. failing test first,
 *   2. then the implementation,
 *   3. then mutation proof, one wiring decision at a time, on a copy of `dist/`,
 *   4. then regression.
 *
 * Every "the default is safe" claim below is paired with a POSITIVE CONTROL.
 * A runtime that refused everything would satisfy several of these assertions
 * on its own, so each refusal test has a neighbouring test that the SAME runtime
 * permits authorised work. A suite that cannot tell "secure" from "broken"
 * proves nothing.
 */

import assert from "node:assert/strict";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";

/** PHASE 06: the workspace every subject and store in this file acts in. */
const WS = workspaceRef("test-workspace");
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ManualClock, type Clock } from "../src/core/clock.js";
import { CapabilitySet } from "../src/capabilities/capability.js";
import { UNKNOWN_HEALTH } from "../src/health/index.js";
import { AuditLog, type AuditEvent } from "../src/audit/events.js";
import { err, ok, type Result } from "../src/core/result.js";

import { bootstrapRuntime, createRuntime, type Runtime } from "../src/orchestration/composition.js";
import { TozOrchestrator } from "../src/orchestration/authority.js";
import { AgentRegistry } from "../src/orchestration/agent/registry.js";
import { CapabilityRegistry } from "../src/orchestration/capabilities/registry.js";
import { AdapterRegistry, AgentExecutionError, UnavailableAgentAdapter } from "../src/orchestration/agent/adapter.js";
import { SpecialistPool } from "../src/orchestration/pool/specialistPool.js";
import { ModelRouter } from "../src/orchestration/model/modelRouter.js";
import { MemoryService } from "../src/orchestration/memory/service.js";
import { MemoryStore } from "../src/orchestration/memory/store.js";
import { RetrievalEngine } from "../src/orchestration/memory/retrieval.js";
import { DefaultWritePolicy } from "../src/orchestration/memory/policy.js";
import { LearningEventStore } from "../src/orchestration/memory/learning.js";
import { MemoryAccessPolicy, DisabledMemoryProvider } from "../src/orchestration/memory/memory.js";
import { TraceRecorder, ResourceTracker } from "../src/orchestration/observability/trace.js";
import { AgentIngestor, DeclaredAgentSource } from "../src/orchestration/agentsource/ingest.js";
import { ToolExecutionHost } from "../src/orchestration/tools/invoker.js";
import { ToolRegistry } from "../src/orchestration/tools/tool.js";
import { DriftGuard } from "../src/orchestration/policy/antiDrift.js";
import { SecurityDecisionLog } from "../src/orchestration/policy/security.js";
import { InMemoryFeedbackStore } from "../src/orchestration/feedback/feedback.js";
import { ProviderAdapterRegistry } from "../src/orchestration/provider/providerAdapterRegistry.js";
import { VerificationRunner } from "../src/orchestration/verification/verifier.js";
import {
  ApprovalResolverRule,
  CapabilityRule,
  GrantRule,
  GovernanceRecorder,
  KnownActorRule,
  PolicyEngine,
  ScopeRule,
  TrustFloorRule,
  createSecurityContext,
  type Grant,
  type SecurityContext,
} from "../src/orchestration/governance/index.js";
import {
  ExecutionCoordinator,
  OrchestratorTaskExecutor,
  TaskWorkerRegistry,
  sequential,
  task as makeTask,
  workflow,
  type WorkflowTask,
} from "../src/orchestration/workflow/index.js";
import { loadOrchestrationConfig } from "../src/orchestration/config/orchestrationConfig.js";
import { trustRank } from "../src/orchestration/agent/trust.js";
import type {
  AgentAdapter,
  AdapterAgentDescriptor,
  AgentExecutionRequest,
  AgentExecutionResult,
} from "../src/orchestration/agent/adapter.js";
import type { AgentRecordInput } from "../src/orchestration/agent/record.js";
import type { RegisteredAgent } from "../src/orchestration/agent/registry.js";
import type { OrchestrationResult } from "../src/orchestration/authority.js";
import { assertOk } from "./contracts/contracts.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
// The architectural checks below read `src/` as TEXT, because the property they
// assert is about source, not about any runtime object. The repository root is the
// working directory, which is the convention the two existing architecture suites
// (`governance.architecture`, `site.architecture`) already use, and `npm test` runs
// from the package root.
const PROJECT_ROOT = process.cwd();

/** The one capability the whole file exercises. */
const RESEARCH = "web_research";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * An agent backend that does real, deterministic, in-process work.
 *
 * Reports `providerId: null` and `modelId: null` rather than inventing a provider
 * name: no provider client ships in this repository, and a fabricated id would be
 * a fabricated integration. That also restricts it to agents declaring
 * `requiresModelRoute: false`, which is the honest pairing - an in-process agent
 * has no model behind it, so demanding a route for one would be asking for a
 * claim the system cannot make.
 */
class InProcessAdapter implements AgentAdapter {
  public readonly name = "in-process";
  public readonly calls: string[] = [];
  public readonly descriptor: AdapterAgentDescriptor;

  public constructor(options: { readonly failWith?: "timeout" } = {}) {
    this.descriptor = {
      agentId: "in-process-agent",
      name: "In-process agent",
      version: "1.0.0",
      capabilities: { supported: [RESEARCH], unsupported: [] },
    };
    if (options.failWith !== undefined) {
      this.failWith = options.failWith;
    }
  }

  public readonly failWith: "timeout" | undefined = undefined;

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(this.failWith === undefined);
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
    if (this.failWith !== undefined) {
      return Promise.resolve(
        err(new AgentExecutionError(`${agentId}@1.0.0`, this.failWith, `In-process agent failed: ${this.failWith}`)),
      );
    }
    return Promise.resolve(
      ok({
        taskId: request.taskId,
        output: `[${agentId}] ${request.objective}: ${request.input}`,
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
        providerId: null,
        modelId: null,
      }),
    );
  }
}

/** Registers an agent and walks it to `available`, the way onboarding does. */
function registerAvailable(runtime: Runtime, overrides: Partial<Omit<AgentRecordInput, "now">> = {}): void {
  const input: Omit<AgentRecordInput, "now"> = {
    agentId: "in-process-agent",
    version: "1.0.0",
    adapter: "in-process",
    status: "active",
    trustLevel: "standard",
    capabilities: CapabilitySet.supporting(RESEARCH),
    requiresModelRoute: false,
    ...overrides,
  };
  const registered = assertOk<RegisteredAgent>(runtime.agents.register(input), "agent registration");
  runtime.capabilities.index(registered.record);
  for (const step of ["verified", "registered", "available"] as const) {
    assertOk(runtime.agents.transition(input.agentId, input.version, step), `agent ${step}`);
  }
}

function grant(operation: Grant["operation"], overrides: Partial<Grant> = {}): Grant {
  return { operation, resources: [], allowList: [], capabilities: [], trustFloor: "standard", expiresAt: null, ...overrides };
}

/** An actor permitted to execute and to use the research capability. */
function authorised(): SecurityContext {
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
  });
}

/** An actor that holds no grant at all. Permits nothing, which is the point. */
function ungranted(): SecurityContext {
  return createSecurityContext({ actor: "stranger", trustLevel: "low", grants: [] });
}

/** A runtime that can actually do work: an agent, a backend, and an identity. */
function runnableRuntime(overrides: Parameters<typeof createRuntime>[0] = {}): Runtime {
  const runtime = createRuntime({
    clock: new ManualClock(NOW),
    adapters: [new InProcessAdapter()],
    identity: { resolve: () => authorised(), serviceContext: authorised() },
    // PHASE 06: a runtime that can actually do work declares the workspace it
    // works in. Its identity source says WHO; this says WHERE; the composition root
    // reconciles the two and refuses if they disagree. Without it the runtime
    // composes no memory subsystem and every partitioned operation refuses - which
    // is correct, and not what these tests are for.
    workspace: WS,
    ...overrides,
  });
  registerAvailable(runtime);
  return runtime;
}

function workflowTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    taskId: "t1",
    jobId: "job-1",
    objective: "Research the answer",
    input: "the question",
    requiredCapabilities: [RESEARCH],
    minimumTrust: "low",
    dependsOn: [],
    approvalRequired: false,
    limits: { timeoutMs: 5_000, maxAttempts: 1, queueTimeoutMs: null },
    checkpointable: false,
    priority: "normal",
    ...overrides,
  };
}

function createJob(runtime: Runtime, jobId: string, task: WorkflowTask, name = "One research step"): void {
  assertOk<unknown>(
    runtime.coordinator.createJob({
      jobId,
      workflow: workflow("wf", name, sequential("root", [makeTask(task.taskId, task)])),
    }),
    `job creation for ${jobId}`,
  );
}

type OrchestrationEvent = Extract<AuditEvent, { kind: "orchestration_event" }>;

// PHASE 06: the audit read is workspace-scoped and mandatory, so this helper
// takes the scope it is reading on behalf of rather than reading everything.
/**
 * The `step` names of one workspace's orchestration events.
 *
 * PHASE 06: the scope is now a REQUIRED argument, and the default is the
 * unattributed partition rather than "everything". It used to be optional and
 * default to reading the whole log, which meant these tests silently read other
 * workspaces' events once the runtime started stamping them - they would have passed
 * on a workspace A trace while asserting something about workspace B.
 */
function orchestrationSteps(
  audit: { read(scope: { workspace: string | null; brand: string | null }): readonly AuditEvent[] },
  scope: { workspace: string | null; brand: string | null } = { workspace: null, brand: null },
): readonly string[] {
  return audit
    .read(scope)
    .filter((event): event is OrchestrationEvent => event.kind === "orchestration_event")
    .map((event) => event.step);
}

/* -------------------------------------------------------------------------- */

describe("PHASE 02 - the composition root exists and assembles the system", () => {
  it("constructs every subsystem Phase 00 recorded as absent from src/", () => {
    // The exact list from CURRENT_STATE.md section 7. This is the assertion that
    // the composition root did what the audit said was missing.
    //
    // `recordLearning` is switched on for THIS runtime only, because the learning
    // store is off by default; a separate test below asserts that it is. A suite in
    // which "composed" quietly meant "sometimes composed" would not be worth writing.
    //
    // AMENDED IN PHASE 06, and the amendment is REPORTED rather than quietly made.
    // This test declared a workspace-free runtime and asserted that the memory
    // store, the retrieval engine and the memory service were composed. PHASE 06
    // makes a memory store workspace-keyed, because a store with no partition has
    // to write into a shared one - which is the classification-D failure this phase
    // exists to remove. So the runtime below now DECLARES a workspace, which is the
    // precondition for composing partitioned subsystems at all.
    //
    // The alternative - composing them unconditionally and inventing a default
    // workspace - would have kept this test passing unchanged and shipped a
    // shared memory bucket, which is the defect. The new test immediately below
    // asserts the other half: with no workspace declared, they are NOT composed.
    const runtime = createRuntime({
      config: loadOrchestrationConfig({ memory: { recordLearning: true } }),
      workspace: workspaceRef("phase-02-workspace"),
    });
    // Every subsystem is checked with `instanceof`, so the expected value is a
    // constructor rather than a shape.
    type Constructor = abstract new (...args: never[]) => object;
    const expected: readonly (readonly [string, Constructor])[] = [
      ["agents", AgentRegistry],
      ["capabilities", CapabilityRegistry],
      ["adapters", AdapterRegistry],
      ["pool", SpecialistPool],
      ["modelRouter", ModelRouter],
      ["providerAdapters", ProviderAdapterRegistry],
      ["memoryStore", MemoryStore],
      ["retrieval", RetrievalEngine],
      ["writePolicy", DefaultWritePolicy],
      ["memoryPolicy", MemoryAccessPolicy],
      ["learning", LearningEventStore],
      ["memoryService", MemoryService],
      ["traces", TraceRecorder],
      ["resources", ResourceTracker],
      ["security", SecurityDecisionLog],
      ["drift", DriftGuard],
      ["feedback", InMemoryFeedbackStore],
      ["verification", VerificationRunner],
      ["ingestor", AgentIngestor],
      ["workers", TaskWorkerRegistry],
      ["policy", PolicyEngine],
      ["governanceRecorder", GovernanceRecorder],
      ["tools", ToolRegistry],
      ["toolHost", ToolExecutionHost],
      ["taskExecutor", OrchestratorTaskExecutor],
      ["coordinator", ExecutionCoordinator],
      ["orchestrator", TozOrchestrator],
    ];
    const missing = expected.filter(([key, ctor]) => !(runtime[key as keyof Runtime] instanceof ctor));
    assert.deepEqual(missing.map(([key]) => key), [], "the composition root must expose every subsystem");
  });

  it("composes NO partitioned memory subsystem when no workspace is declared", () => {
    // PHASE 06, and the counterpart to the amendment above.
    //
    // A memory store is workspace-keyed, so a store with no partition would have to
    // invent one, and the only value available to invent is "shared". The runtime
    // therefore composes no store, no retrieval engine and no memory service, and
    // says so - which is `TODO.md` PHASE 06 item 8, a startup assertion that is
    // never silent, expressed as an absent capability rather than a boot failure.
    //
    // The positive control matters as much as the assertion: the runtime is the
    // SAME one, differing only in whether a workspace was declared, so this cannot
    // be satisfied by a runtime that composes nothing at all.
    const without = createRuntime();
    assert.equal(without.memoryStore, null, "no workspace, no memory store");
    assert.equal(without.retrieval, null, "no workspace, no retrieval engine");
    assert.equal(without.memoryService, null, "no workspace, no memory service");
    assert.equal(without.describe().workspaceIsolation, "unasserted", "and it must SAY so");

    const with_ = createRuntime({ workspace: workspaceRef("phase-02-workspace") });
    assert.ok(with_.memoryStore !== null, "declaring a workspace composes the store");
    assert.ok(with_.retrieval !== null, "and the retrieval engine");
    assert.ok(with_.memoryService !== null, "and the memory service");
    assert.equal(with_.describe().workspaceIsolation, "partitioned");
  });

  it("constructs the real orchestrator rather than describing one", () => {
    assert.ok(createRuntime().orchestrator instanceof TozOrchestrator);
  });

  it("reuses the core registries instead of building a second set", () => {
    // One authority per concern. A second provider registry would mean two answers
    // to "which providers exist" - the exact failure `createCore` exists to prevent,
    // and the reason routing cannot be reasoned about today.
    const runtime = createRuntime();
    assert.equal(runtime.providers, runtime.core.providers, "the provider registry must be the core's");
    assert.equal(runtime.modelRegistry, runtime.core.models, "the model registry must be the core's");
    assert.equal(runtime.router, runtime.core.router, "the provider router must be the core's");
    assert.equal(runtime.audit, runtime.core.audit, "one audit history, not two");
    assert.equal(runtime.clock, runtime.core.clock, "one clock, or two notions of now");
  });

  it("starts with no agent backend beyond the honest unavailable one", () => {
    // The default runtime must not pretend it can execute. `UnavailableAgentAdapter`
    // answers with a classified configuration_error, which is the safe direction.
    const runtime = createRuntime();
    assert.deepEqual(runtime.adapters.names(), ["unavailable"]);
    assert.ok(runtime.adapters.get("unavailable") instanceof UnavailableAgentAdapter);
    assert.equal(runtime.describe().agentAdapters.includes("in-process"), false);
  });
});

describe("PHASE 02 - governance is on the real execution path", () => {
  it("refuses a run whose caller cannot be identified", async () => {
    // PHASE 03 CHANGED THE PREMISE, NOT THE GUARANTEE.
    //
    // This used to run against `runnableRuntime()`, whose identity resolver
    // answers - and every request with no context of its own was refused, because
    // the resolver had no caller at all. B-08 gave it one, so that fixture can now
    // IDENTIFY an anonymous request; refusing it here would be asserting that a
    // runtime which knows exactly who is asking must still turn them away.
    //
    // So the fixture is a runtime whose own identity source answers null. The
    // guarantee is unchanged: a caller nobody can identify is refused, before any
    // provider is named.
    const runtime = runnableRuntime({ identity: { resolve: () => null } });
    const result = assertOk<OrchestrationResult>(await runtime.orchestrator.execute({
        taskId: "task-anonymous",
        objective: "Do the work",
        input: "x",
        requiredCapabilities: [RESEARCH],
        taskType: "research",
        // No `securityContext`. With a gate installed this MUST be a refusal.
      }),
      "a refusal is a Result, not a thrown error",
    );
    assert.equal(result.outcome, "failed");
    assert.equal(result.errorClass, "authorization_error");
    assert.match(result.reason, /security context/i);
    assert.equal(result.provider, null, "a refused run must not claim it reached a provider");
  });

  it("permits an authorised run, so the refusals above are enforcement and not breakage", async () => {
    const runtime = runnableRuntime();
    const result = assertOk<OrchestrationResult>(await runtime.orchestrator.execute({
        taskId: "task-authorised",
        objective: "Do the work",
        input: "x",
        requiredCapabilities: [RESEARCH],
        taskType: "research",
        securityContext: authorised(),
      }),
      "an authorised run must succeed",
    );
    assert.equal(result.outcome, "succeeded", result.reason);
    assert.equal(result.agents.length, 1);
  });

  it("refuses an identified caller that holds no grant", async () => {
    const runtime = runnableRuntime();
    const result = assertOk<OrchestrationResult>(await runtime.orchestrator.execute({
        taskId: "task-stranger",
        objective: "Do the work",
        input: "x",
        requiredCapabilities: [RESEARCH],
        taskType: "research",
        securityContext: ungranted(),
      }),
    );
    assert.equal(result.outcome, "failed");
    assert.equal(result.errorClass, "authorization_error");
    assert.match(result.reason, /workflow\.execute|not granted|No rule permitted/i);
  });

  it("reports governance as enforced on the path by default", () => {
    const description = createRuntime().describe();
    assert.equal(description.governance, "enforced");
    assert.equal(description.governanceOnExecutionPath, true);
  });

  it("reports an advisory deployment as advisory rather than as enforced", () => {
    const runtime = createRuntime({ config: loadOrchestrationConfig({ governance: { enforced: false } }) });
    const description = runtime.describe();
    assert.equal(description.governance, "advisory");
    assert.equal(
      description.governanceOnExecutionPath,
      false,
      "advisory governance must never be reported as being on the execution path",
    );
  });

  it("records the advisory downgrade in the one audit history", () => {
    // A control plane nobody can tell is advisory is precisely the failure this
    // avoids, so the downgrade has to be visible without reading the config.
    const runtime = createRuntime({ config: loadOrchestrationConfig({ governance: { enforced: false } }) });
    const startup = runtime.audit
      .read({ workspace: null, brand: null })
      .filter((event): event is Extract<AuditEvent, { kind: "orchestration_event" }> => event.kind === "orchestration_event")
      .find((event) => event.step === "runtime_started");
    assert.ok(startup !== undefined, "a runtime must record its own start");
    assert.equal(startup.metadata["governance"], "advisory");
    assert.equal(startup.metadata["governanceOnExecutionPath"], false);
    assert.equal(typeof startup.metadata["advisoryWarning"], "string");
  });

  it("runs an unauthorised task when governance is advisory, and says so", async () => {
    // The honest cost of the flag, asserted rather than assumed: advisory really
    // does mean the denial does not stop the work.
    const runtime = runnableRuntime({ config: loadOrchestrationConfig({ governance: { enforced: false } }) });
    const result = assertOk<OrchestrationResult>(await runtime.orchestrator.execute({
        taskId: "task-advisory",
        objective: "Do the work",
        input: "x",
        requiredCapabilities: [RESEARCH],
        taskType: "research",
        securityContext: ungranted(),
      }),
    );
    assert.equal(result.outcome, "succeeded", "advisory governance must not enforce");
  });

  it("holds exactly one policy engine, and answers from it", () => {
    const runtime = createRuntime();
    // A recorder carrying its own engine would produce a second verdict authority
    // whose decisions the gate never sees. Two engines can disagree, and then there
    // is no way to tell which one governed.
    assert.equal(runtime.governance.engine, runtime.policy);
  });

  it("records every governance decision it makes into the one history", async () => {
    const runtime = runnableRuntime();
    await runtime.orchestrator.execute({
      taskId: "task-recorded",
      objective: "Do the work",
      input: "x",
      requiredCapabilities: [RESEARCH],
      taskType: "research",
      securityContext: authorised(),
    });
    const steps = orchestrationSteps(runtime.audit, WS);
    assert.ok(steps.includes("governance_decided"), `a decision must be auditable; saw: ${steps.join(", ")}`);
  });

  it("makes no decision about a caller it could not identify", async () => {
    // The unidentified case is refused BEFORE the gate is consulted, so it must not
    // be rendered as though governance had ruled on it.
    //
    // PHASE 03: same premise change as the refusal test above. The default
    // `runnableRuntime()` resolver now answers, so it is replaced with one that
    // cannot identify anybody - which is the state this assertion is about.
    const runtime = runnableRuntime({ identity: { resolve: () => null } });
    await runtime.orchestrator.execute({
      taskId: "task-unidentified",
      objective: "Do the work",
      input: "x",
      requiredCapabilities: [RESEARCH],
      taskType: "research",
    });
    assert.equal(runtime.policy.decisions().length, 0, "an unidentified caller is refused, not decided about");
  });

  it("installs the reference rule set, and lets a deployment replace it", () => {
    // PHASE 03 added "approval": `governance.approvalRequired` used to be
    // configuration nothing read, and is now an `ApprovalRule` in this set. The
    // rest of the order is unchanged, and the custom-set half of the assertion is
    // untouched, so a deployment that supplies its own rules still replaces all
    // of it.
    assert.deepEqual(createRuntime().policy.ruleNames, [
      "known-actor",
      "grant",
      "trust-floor",
      "resource-allow-list",
      "capability",
      "scope",
      "approval-resolver",
      "approval",
    ]);
    const custom = createRuntime({ rules: [new KnownActorRule(() => true), new GrantRule()] });
    assert.deepEqual(custom.policy.ruleNames, ["known-actor", "grant"]);
  });

  it("exposes the reference rules it composes, so a caller need not re-declare them", () => {
    // These are exported so a deployment can build on them rather than reimplement
    // them; the engine must still hold only the rules it was given.
    for (const ctor of [KnownActorRule, GrantRule, TrustFloorRule, CapabilityRule, ScopeRule, ApprovalResolverRule]) {
      assert.equal(typeof ctor, "function");
    }
  });
});

describe("PHASE 02 - routing is one authority, on the fixed path", () => {
/**
 * Two providers that two DIFFERENT policies rank in different orders.
   *
   * `aaa-primary` declares a wider capability set and has never had its latency
   * measured. `zzz-secondary` declares less and HAS a recorded latency. So the
   * default `capability-first` policy prefers breadth and picks `aaa-primary`,
   * while `latency-sensitive` prefers the recorded latency and picks
   * `zzz-secondary`. A fixture on which both policies agree could not tell whether
   * the configured policy reached the router at all - which is the exact defect this
   * test was written to catch.
   */
function rankedPair(runtime: Runtime): void {
    const wide = CapabilitySet.supporting(RESEARCH, "vision");
    const narrow = CapabilitySet.supporting(RESEARCH);
    for (const [providerId, capabilities, latencyMs] of [
      ["aaa-primary", wide, null],
      ["zzz-secondary", narrow, 50],
    ] as const) {
      assertOk<unknown>(runtime.providers.register({ providerId, capabilities, enabled: true }), `register ${providerId}`);
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
        assertOk<unknown>(runtime.providers.transition(providerId, step), `provider ${providerId} ${step}`);
      }
      runtime.providers.setHealth(providerId, {
        ...UNKNOWN_HEALTH,
        status: "healthy",
        observedAt: NOW,
        ...(latencyMs === null ? {} : { latencyMs }),
      });
      assertOk<unknown>(
        runtime.modelRegistry.register({
          modelId: `m-${providerId}`,
          providerId,
          capabilities,
          enabled: true,
        }),
        `model m-${providerId}`,
      );
    }
  }

  /** A global routing restriction denying the named providers. */
  function denied(providerIds: readonly string[]): Map<string, { readonly deniedProviders: readonly string[]; readonly deniedModels: readonly string[]; readonly deniedProviderTypes: readonly string[]; readonly reason: string; readonly decidedBy: string }> {
    return new Map([
      [
        "*",
        {
          deniedProviders: providerIds,
          deniedModels: [],
          deniedProviderTypes: [],
          reason: "data residency",
          decidedBy: "governance",
        },
      ],
    ]);
  }

  it("uses the real ModelRouter over the core registries", async () => {
    const runtime = createRuntime();
    assert.ok(runtime.modelRouter instanceof ModelRouter);
    const route = await runtime.modelRouter.route({ taskId: "t", capabilities: [RESEARCH], minimumTrust: "low" });
    assert.equal(route.providerId, null, "with nothing registered there is no route, and none is invented");
    assert.match(route.reason, /No provider or model is registered/);
  });

  it("applies the configured routing policy to the fallback chain, and says so", async () => {
    // AMENDED IN PHASE 05, and the amendment is an UPGRADE rather than a relaxation.
    //
    // This test used to assert a limitation on purpose: `defaultPolicy` ordered the
    // FALLBACK chain only, the primary stayed on a verified-facts scorer with no
    // policy concept, and the test said so in as many words ("Phase 05's decision to
    // make"). PHASE 05 made that decision - `RoutingRequest.policy` now carries the
    // configured policy to the one router, which orders the primaries by it - so the
    // old assertion would now fail, and deleting it silently would have left the
    // suite claiming a narrower guarantee than the code makes.
    //
    // What did NOT change, and is still asserted: the default policy and the
    // default verified-facts ordering agree on this fixture, so a deployment sees no
    // behavioural difference unless it configured something else.
    const shipped = createRuntime();
    rankedPair(shipped);
    assert.equal(
      (await shipped.modelRouter.route({ taskId: "t", capabilities: [RESEARCH], minimumTrust: "low" })).providerId,
      "aaa-primary",
      "the default policy prefers the wider declared capability set",
    );
    assert.equal(
      shipped.modelRouter.plan({ taskId: "t", capabilities: [RESEARCH], minimumTrust: "low" }).hops[0]?.candidate.provider.providerId,
      "aaa-primary",
      "the default policy prefers the same candidate",
    );
    assert.equal(shipped.describe().selectionOrder, "policy", "a configured policy now orders the primary too");
    assert.equal(shipped.describe().fallbackPolicy, "capability-first");

    const latency = createRuntime({ config: loadOrchestrationConfig({ routing: { defaultPolicy: "latency-sensitive" } }) });
    rankedPair(latency);
    const chain = latency.modelRouter.plan({ taskId: "t", capabilities: [RESEARCH], minimumTrust: "low" });
    assert.equal(
      chain.hops[0]?.candidate.provider.providerId,
      "zzz-secondary",
      `the configured policy must order the chain; hops: ${chain.hops.map((hop) => hop.candidate.provider.providerId).join(", ")}`,
    );
    assert.equal(latency.modelRouter.policy, "latency-sensitive");
    assert.equal(latency.describe().fallbackPolicy, "latency-sensitive");
    // PHASE 05. The primary follows the SAME policy as the chain, and the decision
    // reports which recorded facts decided it. Before this, the deployment's setting
    // governed the second choice and not the first, which is the part nobody reads.
    const primary = await latency.modelRouter.route({ taskId: "t", capabilities: [RESEARCH], minimumTrust: "low" });
    assert.equal(primary.providerId, "zzz-secondary", "the configured policy must order the primary as well");
    assert.equal(latency.describe().selectionOrder, "policy");
  });

  it("refuses an unknown routing policy at construction, not silently at request time", () => {
    // `loadOrchestrationConfig` would accept any string; the composition root is
    // where the name is resolved, and it fails where the operator is looking.
    assert.throws(
      () => createRuntime({ config: loadOrchestrationConfig({ routing: { defaultPolicy: "nonsense-policy" } }) }),
      /Unknown routing policy/,
    );
  });

  it("routes to the second provider when governance denies the first", async () => {
    // The fixture D-03 said was missing: TWO eligible providers with the denied one
    // RANKING FIRST, so a router that re-derives its own candidate set is caught.
    const runtime = createRuntime({ restrictions: denied(["aaa-primary"]) });
    rankedPair(runtime);
    const route = await runtime.modelRouter.route({
      taskId: "t",
      capabilities: [RESEARCH],
      minimumTrust: "low",
      denied: runtime.governance.narrowRouting(authorised(), { taskId: "t" }),
    });
    assert.equal(route.providerId, "zzz-secondary");
  });

  it("reports no route at all when governance denies every candidate", async () => {
    const runtime = createRuntime({ restrictions: denied(["aaa-primary", "zzz-secondary"]) });
    rankedPair(runtime);
    const route = await runtime.modelRouter.route({
      taskId: "t",
      capabilities: [RESEARCH],
      minimumTrust: "low",
      denied: runtime.governance.narrowRouting(authorised(), { taskId: "t" }),
    });
    assert.equal(route.providerId, null);
    assert.match(route.reason, /denied every candidate/);
  });

  it("keeps the denied provider out of the reported fallback chain", async () => {
    const runtime = createRuntime({ restrictions: denied(["aaa-primary"]) });
    rankedPair(runtime);
    const chain = runtime.modelRouter.plan({
      taskId: "t",
      capabilities: [RESEARCH],
      minimumTrust: "low",
      denied: runtime.governance.narrowRouting(authorised(), { taskId: "t" }),
    });
    const named = chain.hops.map((hop) => hop.candidate.provider.providerId);
    assert.equal(named.includes("aaa-primary"), false, `a denied provider must not appear in the chain: ${named.join(", ")}`);
    assert.deepEqual(named, ["zzz-secondary"]);
  });

  it("gives governance no way to express a preference between two permitted candidates", () => {
    // Structural rather than behavioural: `RoutingRestriction` cannot express a
    // preference, so no future change can turn the control plane into a second router.
    const restriction = denied(["p"]).get("*");
    assert.ok(restriction !== undefined);
    for (const forbidden of ["preferred", "preferredProvider", "score", "rank", "order", "weight", "boost"]) {
      assert.equal(Object.hasOwn(restriction, forbidden), false);
    }
  });
});

describe("PHASE 02 - memory is composed, and disabled means disabled", () => {
  it("composes the whole memory path", () => {
    const runtime = createRuntime({ workspace: WS });
    assert.ok(runtime.memoryService instanceof MemoryService);
    assert.equal(runtime.describe().memory, "in_memory");
  });

  it("composes the learning store only when configuration asks for it", () => {
    // Learning influences selection, so it must not switch itself on.
    assert.equal(createRuntime({ workspace: WS }).learning, null);
    const on = createRuntime({ workspace: WS, config: loadOrchestrationConfig({ memory: { recordLearning: true } }) });
    assert.ok(on.learning instanceof LearningEventStore);
    assert.equal(on.describe().learning, true);
  });

  it("recalls nothing by default rather than everything readable", () => {
    // The shipped default names no scope. A recall defaulting to all readable scopes
    // would hand every deployment a standing read grant nobody asked for.
    assert.deepEqual(createRuntime({ workspace: WS }).describe().recallScopes, []);
  });

  it("writes and reads back through the composed store", () => {
    const runtime = createRuntime({ workspace: WS });
    const service = runtime.memoryService;
    assert.ok(service !== null);
    runtime.memoryPolicy.grant({ subject: { workspace: WS, id: "system", operatingScope: "task" }, scopes: ["task"], writableScopes: ["task"], minimumTrust: "untrusted", expiresAt: null });
    const captured = service.capture({
      scope: "task",
      key: "lesson-1",
      type: "episodic",
      value: { answer: 42 },
      summary: "A verified lesson",
      subject: { workspace: WS, id: "system", operatingScope: "task" },
      importance: 0.9,
      verification: "pass",
    });
    assert.ok(captured.stored !== null, `a granted write must land: ${captured.evaluation.reason}`);
  });

  it("refuses a write from a subject with no grant", () => {
    const runtime = createRuntime({ workspace: WS });
    const service = runtime.memoryService;
    assert.ok(service !== null);
    const captured = service.capture({
      scope: "task",
      key: "lesson-2",
      type: "episodic",
      value: { answer: 1 },
      summary: "An ungranted lesson",
      subject: { workspace: WS, id: "stranger", operatingScope: "task" },
      importance: 0.9,
    });
    assert.equal(captured.stored, null, "no grant, no write");
  });

  it("applies the configured importance floor rather than a hard-coded one", () => {
    const strict = createRuntime({ workspace: WS, config: loadOrchestrationConfig({ memory: { minimumImportance: 0.95 } }) });
    assert.equal(strict.describe().memoryMinimumImportance, 0.95);
    assert.equal(strict.writePolicy.minimumImportance, 0.95);
  });

  it("gives the orchestrator a memory path it actually uses", async () => {
    // Three wiring decisions are only observable together, so they are asserted
    // through the orchestrator rather than through `describe()`:
    //
    //   - the `MemoryService` is on the orchestrator at all,
    //   - the `recallScopes` configuration reached it (empty means no recall, so a
    //     named scope is what makes recall observable),
    //   - the `MemoryAccessPolicy` is on the orchestrator, so a run writes nothing
    //     for a subject it holds no grant for.
    const runtime = runnableRuntime({ config: loadOrchestrationConfig({ memory: { recallScopes: ["task"] } }) });
    const taskId = "task-memory";

    // Recall: nothing stored yet, but the run must REPORT that it looked - which it
    // cannot do without the service and the configured scope.
    const empty = assertOk<OrchestrationResult>(
      await runtime.orchestrator.execute({
        taskId,
        objective: "Do the work",
        input: "x",
        requiredCapabilities: [RESEARCH],
        taskType: "research",
        // PHASE 06: no per-request `securityContext`. A context supplied on the
        // request is a CALLER ASSERTION - the identity resolver is not consulted, so it
        // is never `"resolved"`, and a workspace that is not resolved is refused. The
        // runtime's own resolver answers instead, which is the production path.
      }),
    );
    assert.equal(empty.outcome, "succeeded", empty.reason);
    assert.ok(
      empty.steps.some((step) => step.includes("recalled")),
      `the run must record that it recalled; steps: ${empty.steps.join(" | ")}`,
    );

    // A grant for the subject the orchestrator writes as - which is derived from the
    // task id, and this is the very derivation Phase 06 has to fix.
    runtime.memoryPolicy.grant({
      subject: { workspace: WS, id: `task:${taskId}`, operatingScope: "task" },
      scopes: ["task"],
      writableScopes: ["task"],
      minimumTrust: "untrusted",
      expiresAt: null,
    });
    runtime.memoryPolicy.grant({ subject: { workspace: WS, id: "system", operatingScope: "task" }, scopes: ["task"], writableScopes: ["task"], minimumTrust: "untrusted", expiresAt: null });

    const written = assertOk<OrchestrationResult>(
      await runtime.orchestrator.execute({
        taskId,
        objective: "Do the work again",
        input: "y",
        requiredCapabilities: [RESEARCH],
        taskType: "research",
        verificationKinds: ["evidence"],
      }),
    );
    assert.equal(written.outcome, "succeeded", written.reason);
    // The memory policy on the orchestrator is what lets the run write. Without it
    // the write would be refused, and the step would say so.
    assert.ok(
      written.steps.some((step) => step.includes("recorded outcome")),
      `the run must report its memory write; steps: ${written.steps.join(" | ")}`,
    );
  });

  it("writes no memory for a subject the access policy has not granted", async () => {
    const runtime = runnableRuntime();
    const result = assertOk<OrchestrationResult>(
      await runtime.orchestrator.execute({
        taskId: "task-ungranted-memory",
        objective: "Do the work",
        input: "x",
        requiredCapabilities: [RESEARCH],
        taskType: "research",
        verificationKinds: ["evidence"],
      }),
    );
    assert.equal(result.outcome, "succeeded", result.reason);
    assert.ok(
      result.steps.some((step) => step.includes("memory was not written")),
      `an ungranted subject must be refused, visibly; steps: ${result.steps.join(" | ")}`,
    );
  });

  it("disables memory completely when configured off", () => {
    const runtime = createRuntime({ workspace: WS, config: loadOrchestrationConfig({ memory: { enabled: false } }) });
    assert.ok(runtime.memory instanceof DisabledMemoryProvider, "disabled must be a provider that grants nothing");
    assert.equal(runtime.memoryService, null);
    assert.equal(runtime.describe().memory, "disabled");
  });

  it("records learning events only when configuration asks for them", () => {
    // Learning influences selection, so it must not switch itself on.
    assert.equal(createRuntime({ workspace: WS }).learning, null);
    const on = createRuntime({ workspace: WS, config: loadOrchestrationConfig({ memory: { recordLearning: true } }) });
    assert.ok(on.learning instanceof LearningEventStore);
  });
});

describe("PHASE 02 - one audit history", () => {
  it("writes orchestration events into the shared audit sink", async () => {
    const runtime = runnableRuntime();
    await runtime.orchestrator.execute({
      taskId: "task-audit",
      objective: "Do the work",
      input: "x",
      requiredCapabilities: [RESEARCH],
      taskType: "research",
      securityContext: authorised(),
    });
    assert.ok(orchestrationSteps(runtime.audit, WS).length > 0, "the run must leave a trace in the shared history");
  });

  it("accepts a caller-supplied audit sink and uses it for everything", () => {
    const audit = new AuditLog({ clock: new ManualClock(NOW) });
    const runtime = createRuntime({ audit, clock: new ManualClock(NOW) });
    assert.equal(runtime.audit, audit);
    // The runtime already recorded its own start, so the baseline is whatever it is.
    const before = audit.read({ workspace: null, brand: null }).length;
    assert.ok(before >= 1, "a runtime must record its own start in the caller's sink");
    runtime.traces.record(
      "orchestration_started",
      { traceId: "trace", taskId: "task", parentTaskId: null, teamId: null },
      {},
      NOW,
    );
    assert.equal(audit.read({ workspace: null, brand: null }).length, before + 1, "a trace must reach the caller's sink, not a private one");
  });

  it("measures the audit depth in the description rather than asserting it", () => {
    const audit = new AuditLog({ clock: new ManualClock(NOW) });
    const runtime = createRuntime({ audit, clock: new ManualClock(NOW) });
    assert.equal(runtime.describe().auditEvents, audit.read({ workspace: null, brand: null }).length);
    runtime.audit.append({ kind: "config_reloaded", environment: "test", changedFields: [] });
    assert.equal(runtime.describe().auditEvents, audit.read({ workspace: null, brand: null }).length);
    assert.notEqual(runtime.describe().auditEvents, 0);
  });
});

describe("PHASE 02 - agent lifecycle", () => {
  const roster = [
    { id: "external-1", name: "External", version: "1.0.0", capabilities: [RESEARCH], trustLevel: "standard" as const },
  ];

  it("does not promote an ingested external agent by default", async () => {
    const runtime = createRuntime();
    const report = await runtime.ingestor.ingest(new DeclaredAgentSource({ kind: "remote", name: "roster", descriptors: roster }));
    assert.equal(report.registered.length, 1, report.rejections.map((rejection) => rejection.reason).join("; "));
    assert.notEqual(
      runtime.agents.get("external-1", "1.0.0")?.lifecycle,
      "available",
      "promotion is a trust decision and does not ship on",
    );
  });

  it("promotes when configuration explicitly allows it", async () => {
    const runtime = createRuntime({ config: loadOrchestrationConfig({ agents: { autoPromote: true } }) });
    await runtime.ingestor.ingest(new DeclaredAgentSource({ kind: "remote", name: "roster", descriptors: roster }));
    assert.equal(runtime.agents.get("external-1", "1.0.0")?.lifecycle, "available");
  });

  it("refuses to run an agent that has not reached `available`", async () => {
    const adapter = new InProcessAdapter();
    const runtime = createRuntime({ clock: new ManualClock(NOW), adapters: [adapter], identity: { resolve: () => authorised() } });
    // Registered, never walked forward.
    assertOk(
      runtime.agents.register({
        agentId: "in-process-agent",
        version: "1.0.0",
        adapter: "in-process",
        status: "active",
        trustLevel: "standard",
        capabilities: CapabilitySet.supporting(RESEARCH),
        requiresModelRoute: false,
      }),
      "agent registration",
    );
    const result = assertOk<OrchestrationResult>(await runtime.orchestrator.execute({
        taskId: "task-not-available",
        objective: "Do the work",
        input: "x",
        requiredCapabilities: [RESEARCH],
        taskType: "research",
        securityContext: authorised(),
      }),
    );
    assert.equal(result.outcome, "failed");
    assert.deepEqual(adapter.calls, [], "an unavailable agent must never be invoked");
  });

  it("applies the configured trust ceiling to an external source", async () => {
    // The ceiling CLAMPS rather than rejecting, which is the right reading: a source
    // that claims more trust than it is allowed is held at the level it was allowed,
    // and the rejection cases stay reserved for descriptors that cannot be
    // normalised at all.
    const runtime = createRuntime({ config: loadOrchestrationConfig({ agents: { maximumExternalTrust: "untrusted" } }) });
    const report = await runtime.ingestor.ingest(
      new DeclaredAgentSource({
        kind: "remote",
        name: "roster",
        descriptors: [{ id: "external-1", name: "External", version: "1.0.0", capabilities: [RESEARCH], trustLevel: "high" }],
      }),
    );
    assert.equal(report.registered.length, 1, report.rejections.map((rejection) => rejection.reason).join("; "));
    const entry = runtime.agents.get("external-1", "1.0.0");
    assert.equal(entry?.record.trustLevel, "untrusted", "a source may not grant trust above the ceiling");
    assert.notEqual(entry?.record.trustLevel, "high");
  });
});

describe("PHASE 02 - tool execution", () => {
  it("shares one tool registry between the orchestrator and the tool host", () => {
    // A second registry would mean two answers to "which tools exist", and a tool
    // authorised by one would be invisible to the other.
    const runtime = createRuntime();
    assert.equal(runtime.toolHost.registry, runtime.tools);
  });

  it("passes the configured per-call ceiling to the host", () => {
    const runtime = createRuntime({ config: loadOrchestrationConfig({ tools: { defaultTimeoutMs: 1_234 } }) });
    assert.equal(runtime.describe().toolTimeoutMs, 1_234);
  });

  it("reports an empty invoker set honestly rather than implying tools can run", () => {
    const runtime = createRuntime();
    assert.equal(runtime.describe().tools, 0);
    assert.equal(runtime.describe().toolInvokers, 0);
  });

  it("refuses a tool call for which no invoker is registered", async () => {
    const runtime = createRuntime();
    assertOk<unknown>(runtime.tools.register({ toolId: "text-stats", kind: "local", description: "Local text statistics" }));
    const refused = await runtime.toolHost.invoke(
      { toolId: "text-stats", subject: "operator", input: "hello" },
      { subject: "operator", trustLevel: "standard" },
      trustRank,
    );
    assert.equal(refused.ok, false, "a registered tool with no invoker must not appear to run");
  });
});

describe("PHASE 02 - the workflow path is real", () => {
  it("runs a job through the coordinator, the task executor and the real orchestrator", async () => {
    const adapter = new InProcessAdapter();
    const runtime = createRuntime({
      clock: new ManualClock(NOW),
      adapters: [adapter],
      identity: { resolve: () => authorised(), serviceContext: authorised() },
    });
    registerAvailable(runtime);
    createJob(runtime, "job-1", workflowTask());
    const settled = await runtime.coordinator.runJob("job-1");
    assert.equal(settled.length, 1);
    assert.equal(runtime.coordinator.job("job-1")?.state, "completed");
    // The id is the PLAN's subtask id, not the workflow task id, so it is matched
    // rather than compared: what is under test is that the real agent backend was
    // invoked through the authority, not how subtasks are named.
    assert.equal(adapter.calls.length, 1, `the real agent backend must have been invoked once; saw ${adapter.calls.join(", ")}`);
    assert.match(adapter.calls[0] ?? "", /^t1/);
  });

  it("refuses the workflow path when no service identity is supplied", async () => {
    // PHASE 03 (B-08): the port now HAS a field for a caller, so "no service
    // identity" no longer means "no identity at all" - a runtime whose own
    // identity source can identify the job's caller may legitimately run it, and
    // the refusal below would then be wrong.
    //
    // What must never change is the half asserted here: with neither the declared
    // principal nor an identity source that can answer, the path refuses rather
    // than inventing somebody. The positive half - a job with no caller running
    // under a resolved identity - is asserted in
    // `governanceQaSeparation.phase03.test.ts`.
    const runtime = createRuntime({
      clock: new ManualClock(NOW),
      adapters: [new InProcessAdapter()],
      identity: { resolve: () => null },
    });
    registerAvailable(runtime);
    assert.equal(runtime.describe().workflowExecution, "refused");
    createJob(runtime, "job-1", workflowTask());
    await runtime.coordinator.runJob("job-1");
    assert.notEqual(runtime.coordinator.job("job-1")?.state, "completed");
  });

  it("reports the workflow path as wired when a service identity is supplied", () => {
    assert.equal(runnableRuntime().describe().workflowExecution, "wired");
  });

  it("blocks a task that declares approvalRequired with no gate", () => {
    // C-3, re-proved across the seam this phase created. A composition root is a new
    // way to reach the release path, so the guarantee is re-asserted here rather
    // than assumed to survive.
    const runtime = runnableRuntime();
    createJob(runtime, "job-approval", workflowTask({ approvalRequired: true }));
    const plan = runtime.coordinator.planRelease("job-approval");
    assert.deepEqual(plan.released, [], "a task requiring approval with no gate must not be released");
  });

  it("applies the configured workflow concurrency ceiling, and reports the one it is running under", () => {
    const runtime = createRuntime({ config: loadOrchestrationConfig({ workflow: { maxConcurrency: 7 } }) });
    assert.equal(runtime.describe().workflowMaxConcurrency, 7);
    // Measured from the coordinator, not echoed from configuration. A configured
    // ceiling that the running object never received would pass the first assertion
    // and fail this one, which is the entire point of asking twice.
    assert.equal(runtime.describe().coordinatorMaxConcurrency, 7);
    assert.equal(runtime.coordinator.maxConcurrency, 7);
  });

  it("tells the pool which providers are registered, so `missing_provider` is real", async () => {
    // `OrchestratorOptions.providerIds` exists so an agent that names a required
    // provider is rejected as `missing_provider` when that provider is absent - and
    // ACCEPTED when it is present. Both directions are asserted, because a wiring
    // line that always returns an empty list would satisfy the refusal half alone.
    const caps = CapabilitySet.supporting(RESEARCH);
    const build = (providerId: string): Runtime => {
      const runtime = createRuntime({
        clock: new ManualClock(NOW),
        adapters: [new InProcessAdapter()],
        identity: { resolve: () => authorised() },
      });
      assertOk<unknown>(
        runtime.agents.register({
          agentId: "pinned-agent",
          version: "1.0.0",
          adapter: "in-process",
          status: "active",
          trustLevel: "standard",
          capabilities: caps,
          requiresModelRoute: false,
          providerRequirements: [providerId],
        }),
        "pinned agent registration",
      );
      runtime.capabilities.index(runtime.agents.get("pinned-agent", "1.0.0")!.record);
      for (const step of ["verified", "registered", "available"] as const) {
        assertOk<unknown>(runtime.agents.transition("pinned-agent", "1.0.0", step), `agent ${step}`);
      }
      return runtime;
    };

    const absent = build("p-required");
    const refused = assertOk<OrchestrationResult>(
      await absent.orchestrator.execute({
        taskId: "task-pinned-absent",
        objective: "Do the work",
        input: "x",
        requiredCapabilities: [RESEARCH],
        taskType: "research",
        securityContext: authorised(),
      }),
    );
    assert.equal(refused.outcome, "failed", refused.reason);
    assert.match(refused.reason, /missing_provider/);

    const present = build("p-required");
    assertOk<unknown>(
      present.providers.register({ providerId: "p-required", capabilities: caps, enabled: true }),
      "provider registration",
    );
    const allowed = assertOk<OrchestrationResult>(
      await present.orchestrator.execute({
        taskId: "task-pinned-present",
        objective: "Do the work",
        input: "x",
        requiredCapabilities: [RESEARCH],
        taskType: "research",
        securityContext: authorised(),
      }),
    );
    assert.equal(allowed.outcome, "succeeded", allowed.reason);
  });

  it("refuses a provider-backed run when no adapter can serve the route", async () => {
    // The half of the composition root that stops a task being REPORTED as having
    // run on a provider that has nothing behind it. Two eligible providers, a real
    // route, and an empty `ProviderAdapterRegistry` - the failure must be explicit.
    //
    // The only available agent requires a model route, so the run cannot quietly
    // fall back to a self-hosted sibling and pass.
    const caps = CapabilitySet.supporting(RESEARCH);
    const runtime = createRuntime({
      clock: new ManualClock(NOW),
      adapters: [new InProcessAdapter()],
      identity: { resolve: () => authorised() },
    });
    assertOk<unknown>(
      runtime.agents.register({
        agentId: "routed-agent",
        version: "1.0.0",
        adapter: "in-process",
        status: "active",
        trustLevel: "standard",
        capabilities: caps,
        requiresModelRoute: true,
      }),
      "provider-backed agent registration",
    );
    runtime.capabilities.index(runtime.agents.get("routed-agent", "1.0.0")!.record);
    for (const step of ["verified", "registered", "available"] as const) {
      assertOk<unknown>(runtime.agents.transition("routed-agent", "1.0.0", step), `agent ${step}`);
    }
    for (const providerId of ["p-one", "p-two"]) {
      assertOk<unknown>(runtime.providers.register({ providerId, capabilities: caps, enabled: true }), providerId);
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
        assertOk<unknown>(runtime.providers.transition(providerId, step), `${providerId} ${step}`);
      }
      runtime.providers.setHealth(providerId, { ...UNKNOWN_HEALTH, status: "healthy", observedAt: NOW });
      assertOk<unknown>(
        runtime.modelRegistry.register({ modelId: `m-${providerId}`, providerId, capabilities: caps, enabled: true }),
        `model m-${providerId}`,
      );
    }
    assert.equal(runtime.providerAdapters.size, 0, "no provider adapter is integrated in this repository");

    const result = assertOk<OrchestrationResult>(
      await runtime.orchestrator.execute({
        taskId: "task-no-adapter",
        objective: "Do the work",
        input: "x",
        requiredCapabilities: [RESEARCH],
        taskType: "research",
        securityContext: authorised(),
      }),
    );
    assert.equal(result.outcome, "failed", result.reason);
    assert.match(result.reason, /no provider adapter is registered/i);
    assert.equal(result.provider, null, "a refused run must not claim a provider served it");
  });

  it("forbids approval gates when configuration forbids them", async () => {
    const runtime = runnableRuntime({ config: loadOrchestrationConfig({ workflow: { allowApprovalGates: false } }) });
    createJob(runtime, "job-no-gates", workflowTask({ approvalRequired: true }));
    const plan = runtime.coordinator.planRelease("job-no-gates");
    assert.deepEqual(plan.released, [], "a deployment that forbids gates must not have them silently granted");
  });
});

describe("PHASE 02 - describe() reports measurements, not claims", () => {
  it("counts what the registries actually hold", () => {
    const runtime = runnableRuntime();
    const description = runtime.describe();
    assert.equal(description.agents, runtime.agents.list().length);
    assert.equal(description.providers, runtime.providers.list().length);
    assert.equal(description.agentAdapters.includes("in-process"), true);
  });

  it("states the absences this build has rather than omitting them", () => {
    const description = createRuntime().describe();
    assert.equal(description.durableState, false);
    assert.equal(description.providerAdapters, 0);
  });

  it("states its workspace isolation mode, and it is measured rather than a constant", () => {
    // AMENDED IN PHASE 06. This used to assert `tenancy === "none"`, which was
    // `"none"` on every build forever - including one serving two customers. A
    // constant that cannot vary is not a measurement, and `TODO.md` PHASE 06
    // item 8 asked for a startup assertion that is never silent.
    //
    // The replacement asserts BOTH modes, so a runtime that reported
    // `"unasserted"` unconditionally would fail here rather than pass.
    const undeclared = createRuntime().describe();
    assert.equal(undeclared.workspaceIsolation, "unasserted", "no workspace declared");
    assert.equal(undeclared.workspace, null, "and it names no workspace");

    const declared = createRuntime({ workspace: workspaceRef("phase-02-workspace", "brand-x") }).describe();
    assert.equal(declared.workspaceIsolation, "partitioned", "a declared workspace is partitioned");
    assert.equal(declared.workspace, "phase-02-workspace");
    assert.equal(declared.brand, "brand-x");
    // The platform-scoped list is stated, so a reader knows which registries a
    // cross-workspace read CAN still reach. Each entry carries what it holds and
    // asserts it holds no customer data, so the list cannot be extended by naming a
    // registry and hoping.
    const shared = new Map(declared.platformScopedRegistries.map((entry) => [entry.name, entry]));
    for (const name of ["core.providers", "core.models", "capabilities", "verifiers", "providerAdapters"]) {
      assert.ok(shared.has(name), `${name} is deployment-scoped and must be listed as such`);
    }
    for (const entry of declared.platformScopedRegistries) {
      assert.equal(entry.customerData, false, `${entry.name} must assert it holds no customer data`);
      assert.ok(entry.holds.length > 0, `${entry.name} must say what it holds`);
    }
    for (const name of ["memory", "audit", "feedback", "agents", "tools", "queue", "jobs", "state"]) {
      assert.ok(
        !shared.has(name),
        `a customer-data registry (${name}) must never appear in the shared list`,
      );
    }
  });

  it("does not claim an identity resolver it was not given", () => {
    assert.equal(createRuntime().describe().identityResolver, "absent");
    assert.equal(createRuntime({ identity: { resolve: () => null } }).describe().identityResolver, "supplied");
  });

  it("reports the security policies configuration actually selected", () => {
    const runtime = createRuntime({ config: loadOrchestrationConfig({ security: { inputPolicy: "deny_all" } }) });
    assert.equal(runtime.describe().inputPolicy, "deny_all");
  });

  it("refuses everything when the input policy is deny_all, and that is visible", async () => {
    const runtime = runnableRuntime({ config: loadOrchestrationConfig({ security: { inputPolicy: "deny_all" } }) });
    const result = assertOk<OrchestrationResult>(await runtime.orchestrator.execute({
        taskId: "task-denied-input",
        objective: "Do the work",
        input: "x",
        requiredCapabilities: [RESEARCH],
        taskType: "research",
        securityContext: authorised(),
      }),
    );
    assert.equal(result.outcome, "failed");
    assert.equal(result.errorClass, "configuration_error");
  });
});

describe("PHASE 02 - bootstrap from a real environment", () => {
  it("refuses a configuration it rejected, naming the field", () => {
    const outcome = bootstrapRuntime({ env: { TOZ_ROUTING_POLICY: "no-such-policy" } });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.ok(
      outcome.error.issues.some((issue) => issue.field === "routing.defaultPolicy"),
      `the offending field must be named, not swallowed: ${JSON.stringify(outcome.error.issues)}`,
    );
  });

  it("starts on the shipped defaults with governance enforced", () => {
    const runtime = assertOk<Runtime>(bootstrapRuntime({ env: {} }), "an empty environment is the shipped default");
    assert.equal(runtime.describe().governance, "enforced");
    assert.equal(runtime.describe().workflowMaxConcurrency, 4);
    assert.equal(runtime.describe().workspaceIsolation, "unasserted", "the shipped default declares no workspace");
  });

  it("makes the previously inert environment variables real", () => {
    // D-07. Each of these validated correctly and changed nothing, because no
    // production code read them. They are read now, and the values below are what
    // the running system actually holds.
    const runtime = assertOk<Runtime>(
      bootstrapRuntime({
        env: {
          TOZ_GOVERNANCE_ENFORCED: "false",
          TOZ_MEMORY_RECALL_SCOPES: "task,project",
          TOZ_MEMORY_MIN_IMPORTANCE: "0.7",
          TOZ_WORKFLOW_MAX_CONCURRENCY: "7",
          TOZ_TOOL_TIMEOUT_MS: "1234",
          TOZ_AGENT_AUTO_PROMOTE: "true",
        },
      }),
      "bootstrap",
    );
    const description = runtime.describe();
    assert.equal(description.governance, "advisory");
    assert.deepEqual(description.recallScopes, ["task", "project"]);
    assert.equal(description.workflowMaxConcurrency, 7);
    assert.equal(description.toolTimeoutMs, 1_234);
    assert.equal(description.autoPromote, true);
    assert.equal(description.memoryMinimumImportance, 0.7);
  });

  it("uses the supplied clock so a runtime is testable and a deployment is not", () => {
    const clock = new ManualClock(NOW);
    const runtime = createRuntime({ clock });
    assert.equal(runtime.clock, clock);
    const production: Clock = createRuntime().clock;
    assert.notEqual(production, clock, "the default clock is not the caller's");
  });

  it("reads process.env when no environment is supplied", () => {
    const key = "TOZ_WORKFLOW_MAX_CONCURRENCY";
    const previous = process.env[key];
    process.env[key] = "9";
    try {
      const runtime = assertOk<Runtime>(bootstrapRuntime(), "bootstrap from the real process environment");
      assert.equal(runtime.describe().workflowMaxConcurrency, 9);
    } finally {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The runnable entry point                                                      */
/* -------------------------------------------------------------------------- */

describe("PHASE 02 - the runtime boots outside a test harness", () => {
  // Inside the orchestration tree on purpose: the PHASE 01 isolation test asserts that
  // `src/cli` - which is part of the core tree - may not depend on the orchestration
  // layer. Booting the runtime IS orchestration, so the entry point lives there.
  const cli = path.join(PROJECT_ROOT, "dist", "src", "orchestration", "cli", "bootstrap-runtime.js");

  it("has been built", () => {
    assert.ok(existsSync(cli), `expected the bootstrap CLI at ${cli}; run the build first`);
  });

  it("starts from the real process environment and reports what it composed", () => {
    const output = execFileSync(process.execPath, [cli], {
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "" },
    });
    assert.match(output, /Runtime: STARTED/);
    assert.match(output, /governance\s+enforced \(on the execution path\)/);
    assert.match(output, /identity resolver\s+absent/);
    assert.match(output, /cannot execute a task yet/);
  });

  it("states the absences rather than omitting them", () => {
    const output = execFileSync(process.execPath, [cli], {
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "" },
    });
    assert.match(output, /durable state\s+false/);
    // PHASE 06. Was `/tenancy\s+none/`, which asserted a CONSTANT. The replacement
    // asserts the measured isolation mode, which is the thing `TODO.md` PHASE 06
    // item 8 asked for: never silent.
    assert.match(output, /workspace isolation\s+unasserted/);
    assert.match(output, /no workspace declared/);
    assert.match(output, /no provider is integrated in this repository/);
  });

  it("emits the measurement as JSON when asked", () => {
    const output = execFileSync(process.execPath, [cli, "--json"], {
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "" },
    });
    const parsed = JSON.parse(output) as Record<string, unknown>;
    assert.equal(parsed["governance"], "enforced");
    assert.equal(parsed["durableState"], false);
    // PHASE 06: the measured isolation mode, replacing the `tenancy` constant.
    assert.equal(parsed["workspaceIsolation"], "unasserted");
    assert.equal(parsed["workspace"], null);
    assert.ok(
      Array.isArray(parsed["platformScopedRegistries"]),
      "the shared-registry list must be visible in the measurement",
    );
  });

  it("refuses a rejected configuration with a non-zero exit and names the field", () => {
    let exitCode = 0;
    let output = "";
    try {
      output = execFileSync(process.execPath, [cli], {
        encoding: "utf8",
        env: { PATH: process.env["PATH"] ?? "", TOZ_ROUTING_POLICY: "nonsense-policy" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const asError = error as { status: number; stderr: Buffer };
      exitCode = asError.status;
      output = asError.stderr.toString();
    }
    assert.equal(exitCode, 1, "a rejected configuration must not start a runtime");
    assert.match(output, /Runtime: NOT STARTED/);
    assert.match(output, /routing\.defaultPolicy/);
  });

  it("prints no secret-shaped value", () => {
    const output = execFileSync(process.execPath, [cli], {
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "", TOZ_OPENAI_API_KEY: "sk-should-never-be-printed" },
    });
    assert.equal(/sk-should-never-be-printed/.test(output), false);
  });
});

/* -------------------------------------------------------------------------- */
/* Architecture: the property this phase exists to make permanent               */
/* -------------------------------------------------------------------------- */

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(absolute));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      found.push(absolute);
    }
  }
  return found;
}

/**
 * Source with its comments removed.
 *
 * Necessary, not cosmetic: the composition root's own documentation NAMES the
 * things it deliberately does not do ("no `node:fs`", "no `workspace_id`"). A scan
 * that counted prose would fail on the very file that states the rule, and the
 * obvious "fix" - deleting the explanation - would make the codebase worse and the
 * test greener. The property under test is about CODE.
 */
function codeOf(relativePath: string): string {
  return readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

const COMPOSITION_ROOT = "src/orchestration/composition.ts";

describe("PHASE 02 - there is exactly one place that assembles the system", () => {
  /** The classes Phase 00 found constructed nowhere in `src/`. */
  const COMPOSED_CLASSES = [
    "TozOrchestrator",
    "GovernanceGate",
    "PolicyEngine",
    "GovernanceRecorder",
    "ModelRouter",
    "SpecialistPool",
    "AgentRegistry",
    "CapabilityRegistry",
    "ProviderAdapterRegistry",
    "ToolRegistry",
    "ToolExecutionHost",
    "MemoryStore",
    "RetrievalEngine",
    "DefaultWritePolicy",
    "LearningEventStore",
    "MemoryService",
    "MemoryAccessPolicy",
    "InMemoryMemoryProvider",
    "TraceRecorder",
    "ResourceTracker",
    "SecurityDecisionLog",
    "DriftGuard",
    "InMemoryFeedbackStore",
    "VerificationRunner",
    "EvidenceIntegrityVerifier",
    "AgentIngestor",
    "ExecutionCoordinator",
    "OrchestratorTaskExecutor",
  ] as const;

  it("constructs each composed class in the composition root and nowhere else", () => {
    const files = sourceFiles(path.join(PROJECT_ROOT, "src"));
    const offenders: string[] = [];
    for (const name of COMPOSED_CLASSES) {
      const sites = files
        .filter((file) => new RegExp(`new ${name}\\b`).test(readFileSync(file, "utf8")))
        .map((file) => path.relative(PROJECT_ROOT, file).replace(/\\/g, "/"));
      const unexpected = sites.filter((entry) => entry !== COMPOSITION_ROOT);
      if (unexpected.length > 0) {
        offenders.push(`${name} is also constructed in ${unexpected.join(", ")}`);
      }
    }
    assert.deepEqual(offenders, [], `only the composition root may assemble the system:\n${offenders.join("\n")}`);
  });

  it("keeps the composition root free of tenancy, which is Phase 06's decision", () => {
    const source = codeOf(COMPOSITION_ROOT);
    for (const forbidden of ["workspaceId", "workspace_id", "tenantId", "tenant_id", "brandId", "brand_id", "orgId"]) {
      assert.equal(source.includes(forbidden), false, `the composition root must not pre-empt Phase 06 with "${forbidden}"`);
    }
  });

  it("no longer forbids the tenancy identifiers Phase 06 has now introduced", () => {
    // PHASE 06 SATISFIED the constraint above, so the constraint itself is retired -
    // and retiring it is only honest if it is replaced by something stronger than
    // "the string does not appear here".
    //
    // What replaces it is the assertion the whole phase turns on: a workspace is
    // only ever obtained from a RESOLVED identity, and every partitionable store is
    // keyed on it. A composition root that could read a workspace out of the
    // environment, a filename or a request field would fail the tests in
    // `workspaceIsolation.phase06.test.ts`, not this one.
    //
    // What this test now checks is that the retired list is retired for the RIGHT
    // reason - the identifiers exist as part of the partition - rather than having
    // been renamed into a shape that would pass the old check by accident.
    const source = codeOf(COMPOSITION_ROOT);
    assert.match(source, /workspace/, "the workspace identifier is now part of the runtime");
    // And the ambient-inference bans stay, because they are the actual hazard.
    for (const forbidden of ["process.cwd()", "__dirname", "import.meta.dirname"]) {
      assert.equal(
        source.includes(forbidden),
        false,
        `a workspace must never be inferred from ${forbidden}; the repository already forbids process.env reads here`,
      );
    }
  });

  it("composes no persistence, network or external system, which are later phases", () => {
    const source = codeOf(COMPOSITION_ROOT);
    for (const forbidden of ["node:fs", "node:sqlite", "node:net", "node:http", "fetch("]) {
      assert.equal(source.includes(forbidden), false, `Phase 02 must not add "${forbidden}"; it adds wiring only`);
    }
    // `process.env` is allowed in exactly one place - `bootstrapRuntime`, which is
    // the seam a future service or CLI calls. A second reader would mean
    // configuration coming from two sources with no precedence between them.
    const reads = source.split("process.env").length - 1;
    assert.equal(reads, 1, `the environment may be read in bootstrapRuntime only; found ${reads} reads`);
    assert.match(source, /function bootstrapRuntime[\s\S]*process\.env/);
  });

  it("exempts no registry from the single-assembly rule it states", () => {
    // `AdapterRegistry` is deliberately NOT in the list above, because
    // `AgencyAdapterSet` owns a private one to hold exactly one agency adapter -
    // a leaf component's private storage, not a second assembly of the system. What
    // must hold is that the orchestrator sees ONE registry, and it is this one.
    const runtime = runnableRuntime();
    assert.ok(runtime.adapters instanceof AdapterRegistry);
    assert.deepEqual(runtime.adapters.names(), ["in-process"]);
    // And the agency component's own registry is not reachable from the runtime at
    // all: a deployment cannot reach it to add an adapter through the back door.
    assert.equal((runtime as unknown as Record<string, unknown>)["agencyAdapters"], undefined);
  });

  it("does not import the composition root from the core", () => {
    // The dependency direction is one-way: `core <- orchestration`. A core that

/** PHASE 06: the workspace every subject and store in this file acts in. */
    // imported the composition root would make every consumer pull the whole
    // orchestration graph, which is exactly what `createCore` exists to avoid.
    const offenders = sourceFiles(path.join(PROJECT_ROOT, "src", "core")).filter((file) =>
      readFileSync(file, "utf8").includes("orchestration/composition"),
    );
    assert.deepEqual(offenders, [], "the core must not depend on the composition root");
  });

  it("exports the composition root from the orchestration entry point", async () => {
    const barrel = await import("../src/orchestration/index.js");
    assert.equal(typeof barrel.createRuntime, "function");
    assert.equal(typeof barrel.bootstrapRuntime, "function");
  });
});