/**
 * PHASE 03 - governance and QA separation.
 *
 * WHY THIS FILE EXISTS
 *
 * Phase 02 composed the system. Composing it exposed the next problem rather
 * than hiding it: the runtime had no answer to "who is asking?". Three things
 * were true at once, and each one is a live defect:
 *
 *   1. `RuntimeOptions.identity.resolve` was documented as the runtime's identity
 *      source - "returning null means this caller could not be identified, and
 *      the gate then DEFAULT-DENIES" - and `GovernanceGate.resolve()` had no
 *      caller anywhere in `src/`. The resolver was dead code, so identity on the
 *      execution path was caller-asserted only. (B-08)
 *
 *   2. `OrchestratorExecutionPort.execute` had no field for a caller, so a
 *      background task reached the orchestrator as whatever single principal the
 *      runtime declared at composition time, or was refused. The job's own
 *      submitter was invisible. (B-08)
 *
 *   3. `ApprovalGate.decidedBy` was a free-text string, and the only identities
 *      `assertDecidable` refused were the gate's own `taskId` and a `workerId`
 *      that production sets to the literal `"coordinator"`. The executor could
 *      approve its own work simply by naming someone else - C-2's fix held
 *      against the honest caller and not against a dishonest one. (B-05)
 *
 * B-05 AND B-08 ARE ONE DECISION. The reason is mechanical: the identity a
 * background task runs AS is exactly the identity whose work an approval would
 * be accepting. Without (2) nobody knows who executed; without knowing who
 * executed, rule (3) has nothing to compare `decidedBy` against. Answering
 * either blocker alone leaves the other unusable.
 *
 * WHAT "QA CANNOT APPROVE ITS OWN WORK" MEANS HERE
 *
 * The party whose work is under approval cannot decide the gate for that work,
 * where "the party" is every identity the COORDINATOR ITSELF holds about the
 * execution: the job's caller, the runtime's declared principal, and the live
 * claim's worker. None of them is read from a caller argument. It also means a
 * verification verdict is not an approval: a passing check never releases a
 * gate, and no module other than `ApprovalRegistry.decide` ever moves a gate to
 * a decided state.
 *
 * METHOD (binding, carried from Phase 01 and Phase 02):
 *
 *   1. failing test first,
 *   2. then the implementation,
 *   3. then mutation proof, one wiring decision at a time, on a copy of `dist/`,
 *   4. then regression.
 *
 * EVERY REFUSAL BELOW IS PAIRED WITH A POSITIVE CONTROL. A runtime that refused
 * everything would satisfy most of these assertions on its own, so each refusal
 * has a neighbouring test proving the same runtime permits an authorised party.
 * A suite that cannot tell "secure" from "broken" proves nothing.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { CapabilitySet } from "../src/capabilities/capability.js";
import { err, ok, type Result } from "../src/core/result.js";

import { createRuntime, type Runtime } from "../src/orchestration/composition.js";
import { AdapterRegistry } from "../src/orchestration/agent/adapter.js";
import {
  createSecurityContext,
  delegate,
  type Grant,
  type SecurityContext,
} from "../src/orchestration/governance/index.js";
import { ApprovalRegistry } from "../src/orchestration/workflow/gates.js";
import { EvidenceIntegrityVerifier, VerificationRunner } from "../src/orchestration/verification/verifier.js";
import {
  ExecutionCoordinator,
  OrchestratorTaskExecutor,
  approval,
  sequential,
  task as makeTask,
  workflow,
  type TaskExecutionOutcome,
  type WorkflowTask,
} from "../src/orchestration/workflow/index.js";
import { loadOrchestrationConfig } from "../src/orchestration/config/orchestrationConfig.js";
import type {
  AgentAdapter,
  AdapterAgentDescriptor,
  AgentExecutionError,
  AgentExecutionRequest,
  AgentExecutionResult,
} from "../src/orchestration/agent/adapter.js";
import type { RegisteredAgent } from "../src/orchestration/agent/registry.js";
import type { Evidence } from "../src/orchestration/evidence/evidence.js";
import type { OrchestrationResult } from "../src/orchestration/authority.js";
import { assertOk } from "./contracts/contracts.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const PROJECT_ROOT = process.cwd();

/** The one capability this file exercises. */
const RESEARCH = "web_research";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A deterministic in-process agent backend, for the reason Phase 02 uses one:
 * it reports `providerId: null` rather than inventing a provider name, so
 * nothing in a workflow test is a fabricated integration.
 */
class InProcessAdapter implements AgentAdapter {
  public readonly name = "in-process";
  public readonly calls: string[] = [];
  public readonly descriptor: AdapterAgentDescriptor;

  public constructor() {
    this.descriptor = {
      agentId: "in-process-agent",
      name: "In-process agent",
      version: "1.0.0",
      capabilities: { supported: [RESEARCH], unsupported: [] },
    };
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public describe(agentId: string, version: string): Promise<Result<AdapterAgentDescriptor, Error>> {
    return Promise.resolve(
      agentId === this.descriptor.agentId ? ok({ ...this.descriptor, version }) : err(new Error(`Unknown agent: ${agentId}`)),
    );
  }

  public execute(agentId: string, request: AgentExecutionRequest): Promise<Result<AgentExecutionResult, AgentExecutionError>> {
    this.calls.push(request.taskId);
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
function registerAvailable(runtime: Runtime): void {
  const input = {
    agentId: "in-process-agent",
    version: "1.0.0",
    adapter: "in-process",
    status: "active",
    trustLevel: "standard",
    capabilities: CapabilitySet.supporting(RESEARCH),
    requiresModelRoute: false,
  } as const;
  const registered = assertOk<RegisteredAgent>(runtime.agents.register(input), "agent registration");
  runtime.capabilities.index(registered.record);
  for (const step of ["verified", "registered", "available"] as const) {
    assertOk(runtime.agents.transition(input.agentId, input.version, step), `agent ${step}`);
  }
}

function grant(operation: Grant["operation"], overrides: Partial<Grant> = {}): Grant {
  return { operation, resources: [], allowList: [], capabilities: [], trustFloor: "standard", expiresAt: null, ...overrides };
}

/** An actor permitted to execute this file's work. */
function executorActor(actor = "svc:runtime"): SecurityContext {
  return createSecurityContext({
    actor,
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
function ungranted(actor = "svc:runtime"): SecurityContext {
  return createSecurityContext({ actor, trustLevel: "standard", grants: [] });
}

/** A runtime with a real backend, an available agent, and counted identity seams. */
function runtimeWith(options: {
  readonly service?: SecurityContext | null;
  readonly resolve?: () => SecurityContext | null;
  readonly config?: ReturnType<typeof loadOrchestrationConfig>;
}): { runtime: Runtime; adapter: InProcessAdapter; resolvedCalls: () => number } {
  const adapter = new InProcessAdapter();
  let resolved = 0;
  const resolve = options.resolve;
  const runtime = createRuntime({
    clock: new ManualClock(NOW),
    adapters: [adapter],
    ...(options.config === undefined ? {} : { config: options.config }),
    identity: {
      resolve: (): SecurityContext | null => {
        resolved += 1;
        return resolve === undefined ? null : resolve();
      },
      ...(options.service === undefined ? {} : { serviceContext: options.service }),
    },
  });
  registerAvailable(runtime);
  assert.equal(runtime.adapters instanceof AdapterRegistry, true);
  return { runtime, adapter, resolvedCalls: () => resolved };
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

function createGatedJob(runtime: Runtime, jobId: string, caller?: SecurityContext): void {
  assertOk<unknown>(
    runtime.coordinator.createJob({
      jobId,
      workflow: workflow("wf", "Gated research", sequential("root", [approval("gate", workflowTask(), "Publish this externally?")])),
      ...(caller === undefined ? {} : { caller }),
    }),
    `job creation for ${jobId}`,
  );
}

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** Comments removed, so a guarantee asserted in prose is not counted as code. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, "");
}

function codeOf(relative: string): string {
  return stripComments(readFileSync(path.join(PROJECT_ROOT, relative), "utf8"));
}

/* -------------------------------------------------------------------------- */

describe("PHASE 03 - identity provenance is established before authorization", () => {
  it("consults the runtime's identity resolver when a request carries no context", async () => {
    // B-08, first half. `identity.resolve` was documented as the runtime's
    // identity source and had no caller: `GovernanceGate.resolve()` was never
    // invoked from anywhere in `src/`, so a request with no context was refused
    // as unidentified without the runtime ever being asked who it was.
    const { runtime, adapter, resolvedCalls } = runtimeWith({ resolve: () => executorActor() });
    const result = assertOk<OrchestrationResult>(
      await runtime.orchestrator.execute({
        taskId: "task-resolved",
        objective: "Do the work",
        input: "x",
        requiredCapabilities: [RESEARCH],
        taskType: "research",
      }),
    );
    assert.ok(result.outcome === "succeeded", `the resolved identity must be able to run: ${result.reason}`);
    assert.ok(resolvedCalls() > 0, "the runtime's identity resolver must have been consulted");
    assert.equal(adapter.calls.length, 1);
  });

  it("does not consult the resolver when the caller supplied its own context", async () => {
    // Control for the test above: a resolver that fired on every request would
    // make the first test meaningless, because the run would be authorised under
    // whatever the caller asserted and the resolver would be decorative.
    const { runtime, adapter, resolvedCalls } = runtimeWith({ resolve: () => ungranted("svc:ignored") });
    const result = assertOk<OrchestrationResult>(
      await runtime.orchestrator.execute({
        taskId: "task-supplied",
        objective: "Do the work",
        input: "x",
        requiredCapabilities: [RESEARCH],
        taskType: "research",
        securityContext: executorActor("human:ana"),
      }),
    );
    assert.equal(result.outcome, "succeeded", result.reason);
    assert.equal(resolvedCalls(), 0, "a supplied context must not be replaced behind the caller's back");
    assert.equal(adapter.calls.length, 1);
  });

  it("refuses when the resolver cannot identify the caller", async () => {
    // Control in the other direction: the resolver is not a default actor. A
    // resolver that answers null must leave the run refused rather than
    // substituting somebody.
    const { runtime, adapter } = runtimeWith({ resolve: () => null });
    const result = await runtime.orchestrator.execute({
      taskId: "task-unidentified",
      objective: "Do the work",
      input: "x",
      requiredCapabilities: [RESEARCH],
      taskType: "research",
    });
    // A refusal comes back as a SETTLED result rather than a thrown error, so
    // "not authorised" is asserted on the outcome and on the reason, not on the
    // wrapper. Asserting `result.ok === false` here would be asserting a shape
    // this orchestrator does not produce.
    assert.equal(result.ok, true, "a refusal is reported as a result, not an exception");
    const outcome = result.ok ? result.value.outcome : "error";
    assert.notEqual(outcome, "succeeded", "an unidentified caller must not be authorised");
    assert.match(
      result.ok ? result.value.reason : "",
      /could not be identified/,
      "the refusal must say the caller could not be identified, rather than failing for an unrelated reason",
    );
    assert.equal(adapter.calls.length, 0, "a refused run must not reach an agent backend");
  });

  it("labels how each identity was established", () => {
    // Provenance answers "how do we know who this is?". Without it a context
    // the runtime resolved and a context a caller typed are indistinguishable at
    // the point of decision - the same absent-value conflation as C-2 through
    // C-4, one layer up.
    //
    // The parent holds the operation it is about to delegate, because `delegate`
    // refuses to derive authority the parent does not have - so a fixture that
    // delegated from a grant-less context would be testing that refusal instead.
    const asserted = createSecurityContext({
      actor: "human:ana",
      trustLevel: "standard",
      grants: [grant("workflow.execute")],
    });
    assert.equal(asserted.provenance, "asserted", "a context a caller constructs is an assertion");

    const outcome = delegate(asserted, { to: "agent:one", operations: ["workflow.execute"], at: NOW.getTime() });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok === true ? outcome.context.provenance : null, "delegated", "a derived context is derived");

    // And the composed identity source must mark its own output, so a deployment
    // can tell an established identity from an asserted one without reading the
    // call site.
    const { runtime } = runtimeWith({ resolve: () => executorActor() });
    const resolved = runtime.governance.resolve({ taskId: "t1", jobId: null, traceId: "trace-1" });
    assert.notEqual(resolved, null, "a resolver that answers must be reachable from the gate");
    assert.equal((resolved as SecurityContext).provenance, "resolved", "the runtime's own resolver must mark its output as established");
    const decision = runtime.governance.authorize({
      context: resolved as SecurityContext,
      operation: "workflow.execute",
      resource: { kind: "job", id: "t1" },
    });
    assert.equal(decision.permitted, true, decision.reason);
  });

  it("cannot be told how it was established", () => {
    // The independent probe for this phase found that `createSecurityContext`
    // accepted `provenance` as an input and stamped whatever it was given, so a
    // caller could build a context declaring itself `"resolved"` - the exact
    // claim `withProvenance`'s own docblock says would be recording a claim
    // rather than a resolution. The field is gone from the input, so the check
    // here is behavioural: whatever the caller hands over, a root context is
    // always an assertion.
    const claimed = createSecurityContext({
      actor: "human:ana",
      trustLevel: "standard",
      // Written through the type system's back on purpose: the point is that no
      // spelling of the input reaches the result.
      ...( { provenance: "resolved" } as Record<string, unknown> ),
    });
    assert.equal(claimed.provenance, "asserted", "only the runtime's identity source may establish an identity");

    // And the runtime's own output still is established, so removing the input
    // did not remove the thing the field existed to describe.
    const { runtime } = runtimeWith({ resolve: () => executorActor() });
    const resolved = runtime.governance.resolve({ taskId: "t1", jobId: null, traceId: "trace-1" });
    assert.equal(resolved?.provenance, "resolved");
  });
});

describe("PHASE 03 - a background task carries the identity it runs as (B-08)", () => {
  it("runs a job under the identity it was submitted with, not the service principal", async () => {
    // The composed runtime today gives every background task one static
    // `serviceContext`, so a job submitted by a named actor executes as somebody
    // else - and where that somebody holds no grant, the job is refused for a
    // reason that has nothing to do with what was asked.
    const { runtime, adapter } = runtimeWith({ service: ungranted("svc:ungranted") });
    assertOk<unknown>(
      runtime.coordinator.createJob({
        jobId: "job-caller",
        workflow: workflow("wf", "Research", sequential("root", [makeTask("t1", workflowTask())])),
        caller: executorActor("human:ana"),
      }),
      "job creation",
    );
    const settled = await runtime.coordinator.runJob("job-caller");
    assert.equal(settled.length, 1, "the job must have run");
    assert.equal(runtime.coordinator.job("job-caller")?.state, "completed");
    assert.equal(adapter.calls.length, 1, `the backend must have been invoked; saw ${adapter.calls.join(", ")}`);
  });

  it("falls back to the declared service principal when the job declares none", () => {
    // Control: the service principal is the answer to "what runs when nobody
    // said who asked", and it must still be honoured - while NOT being borrowed
    // onto a job that never named it.
    const { runtime } = runtimeWith({ service: executorActor("svc:runtime") });
    assertOk<unknown>(
      runtime.coordinator.createJob({
        jobId: "job-no-caller",
        workflow: workflow("wf", "Research", sequential("root", [makeTask("t1", workflowTask())])),
      }),
      "job creation",
    );
    assert.equal(
      runtime.coordinator.job("job-no-caller")?.caller?.actor ?? null,
      null,
      "a job that declared no caller must record none rather than borrowing the principal",
    );
    assert.equal(runtime.describe().workflowExecution, "wired");
  });

  it("refuses a job with neither a caller nor a service principal", async () => {
    // Control in the other direction: no identity is not some identity.
    const { runtime, adapter } = runtimeWith({ service: null });
    assertOk<unknown>(
      runtime.coordinator.createJob({
        jobId: "job-nobody",
        workflow: workflow("wf", "Research", sequential("root", [makeTask("t1", workflowTask())])),
      }),
      "job creation",
    );
    await runtime.coordinator.runJob("job-nobody");
    assert.notEqual(runtime.coordinator.job("job-nobody")?.state, "completed");
    assert.equal(adapter.calls.length, 0, "a run with no identity must not reach an agent backend");
  });

  it("runs a job that named no caller as the runtime's declared principal", async () => {
    // The FALLBACK half of B-08, and the only thing that proves `serviceContext` is
    // used rather than merely reported. The test above asserts
    // `workflowExecution: "wired"`, which is a REPORT; this is the behaviour behind
    // it.
    //
    // It was added because the PHASE 02 mutation battery found the gap rather than
    // because it was planned: replacing the bridge's service principal with `null`
    // survived the whole suite, which is only possible if no test ever ran a job
    // that relies on it. A wiring decision nothing can distinguish is untested
    // code, which is the thing this project is trying to stop having.
    const { runtime, adapter } = runtimeWith({ service: executorActor("svc:runtime") });
    createPlainJob(runtime, "job-service-principal");
    await runtime.coordinator.runJob("job-service-principal");
    assert.equal(
      adapter.calls.length,
      1,
      "a job that named no caller must run as the principal the runtime declared",
    );
    assert.equal(runtime.coordinator.job("job-service-principal")?.state, "completed");
  });

  it("runs a job that declared no caller under the identity the runtime resolves", async () => {
    // The positive half of the refusal above, and the reason B-08 needed BOTH
    // halves: identity now has two sources, so "the job named nobody" must not
    // mean "nobody can run it" when the runtime's own identity source can say who
    // is asking. Without this test, the refusal would be satisfiable by a runtime
    // that identified nothing, ever.
    const { runtime, adapter } = runtimeWith({ service: null, resolve: () => executorActor() });
    assertOk<unknown>(
      runtime.coordinator.createJob({
        jobId: "job-resolved-caller",
        workflow: workflow("wf", "Research", sequential("root", [makeTask("t1", workflowTask())])),
      }),
      "job creation",
    );
    await runtime.coordinator.runJob("job-resolved-caller");
    assert.equal(
      runtime.coordinator.job("job-resolved-caller")?.state,
      "completed",
      "a job with no caller of its own must still run when the runtime can identify it",
    );
    assert.equal(adapter.calls.length, 1);
    // The job still records that it declared nobody - resolution happens at the
    // boundary, not by writing an identity back onto the job.
    assert.equal(runtime.coordinator.job("job-resolved-caller")?.caller, null);
  });
});

describe("PHASE 03 - the approver is derived from records, never asserted (B-05)", () => {
  it("refuses an approval decided by the identity the job runs as", () => {
    // The heart of B-05. `decidedBy` is a string the caller supplies, so the
    // executor-cannot-approve rule was satisfiable by writing a different name.
    // With the caller travelling on the job, the coordinator holds the executing
    // identity itself and compares against that.
    const { runtime } = runtimeWith({ service: executorActor("svc:runtime") });
    createGatedJob(runtime, "job-self", executorActor("human:ana"));
    const gate = runtime.coordinator.openApproval({ jobId: "job-self", taskId: "t1", question: "Publish?" });
    assert.throws(
      () => runtime.coordinator.decideApproval({ gateId: gate.gateId, decision: "approved", decidedBy: "human:ana" }),
      /may not approve/,
      "the identity the job executes as must not decide its own approval",
    );
  });

  it("refuses an approval decided by the runtime's declared service principal", () => {
    // The same rule for a job that declared no caller: such a job runs as the
    // runtime's principal, and that principal is the executor too.
    const { runtime } = runtimeWith({ service: executorActor("svc:runtime") });
    createGatedJob(runtime, "job-service");
    const gate = runtime.coordinator.openApproval({ jobId: "job-service", taskId: "t1", question: "Publish?" });
    assert.throws(
      () => runtime.coordinator.decideApproval({ gateId: gate.gateId, decision: "approved", decidedBy: "svc:runtime" }),
      /may not approve/,
      "the runtime's own principal must not approve work it executes",
    );
  });

  it("still refuses the executing worker", () => {
    // Control: the PHASE 01 (C-2) rule is unchanged.
    const { runtime } = runtimeWith({ service: executorActor("svc:runtime") });
    createGatedJob(runtime, "job-worker");
    const gate = runtime.coordinator.openApproval({ jobId: "job-worker", taskId: "t1", question: "Publish?" });
    assert.throws(
      () =>
        runtime.coordinator.decideApproval({ gateId: gate.gateId, decision: "approved", decidedBy: "worker-1", workerId: "worker-1" }),
      /may not approve its own work/,
    );
  });

  it("permits a party that is neither the executor nor the task", () => {
    // Control: a runtime that refused every approval would satisfy the three
    // refusals above on its own and would be useless.
    const { runtime } = runtimeWith({ service: executorActor("svc:runtime") });
    createGatedJob(runtime, "job-human", executorActor("human:ana"));
    const gate = runtime.coordinator.openApproval({ jobId: "job-human", taskId: "t1", question: "Publish?" });
    const decided = runtime.coordinator.decideApproval({
      gateId: gate.gateId,
      decision: "approved",
      decidedBy: "human:reviewer",
      reason: "Checked the sources",
    });
    assert.equal(decided.state, "approved");
    assert.equal(decided.decidedBy, "human:reviewer");
    const release = runtime.coordinator.planRelease("job-human");
    assert.deepEqual(release.released, ["t1"], "an approval by an independent party releases the task");
  });

  it("derives the refused identities from its own records, not a caller argument", () => {
    // `decideApproval` used to fall back to a caller-supplied `workerId` when no
    // claim existed. The parties that may not approve are read from the job and
    // the claim, so supplying them changes nothing.
    const { runtime } = runtimeWith({ service: executorActor("svc:runtime") });
    createGatedJob(runtime, "job-derived", executorActor("human:ana"));
    const gate = runtime.coordinator.openApproval({ jobId: "job-derived", taskId: "t1", question: "Publish?" });
    assert.throws(
      () =>
        runtime.coordinator.decideApproval({
          gateId: gate.gateId,
          decision: "approved",
          decidedBy: "human:ana",
          workerId: "nobody-at-all",
        }),
      /may not approve/,
    );
  });
});

describe("PHASE 03 - an approved job can actually finish", () => {
  it("completes a job whose approval was granted by an independent party", async () => {
    // `settle()` reports "completed and verified where required", but the verdict
    // it conditions on was never received: `#verdicts` was written `null` on
    // every success and `TaskExecutionOutcome` had no field to carry one. So a
    // task that declared `approvalRequired`, was properly approved, ran and
    // completed left its job waiting forever for a verification nobody had
    // performed. The approval path was unusable end to end.
    const { runtime, adapter } = runtimeWith({ service: executorActor("svc:runtime") });
    createGatedJob(runtime, "job-approved", executorActor("agent:researcher"));
    const gate = runtime.coordinator.openApproval({ jobId: "job-approved", taskId: "t1", question: "Publish?" });
    runtime.coordinator.decideApproval({ gateId: gate.gateId, decision: "approved", decidedBy: "human:reviewer" });
    await runtime.coordinator.runJob("job-approved");
    assert.equal(adapter.calls.length, 1, "the approved task must have executed");
    assert.equal(runtime.coordinator.task("job-approved", "t1")?.state, "completed");
    assert.equal(
      runtime.coordinator.job("job-approved")?.state,
      "completed",
      "an approved, executed, verified task must not leave its job waiting",
    );
  });

  it("still withholds completion when the reported verdict is not a pass", async () => {
    // The mirror of the test above. Wiring the verdict through would be a
    // failure if it also switched the check off, so both directions are asserted
    // and the same coordinator is used for each.
    const notPassing = {
      succeeded: true,
      output: "done",
      errorClass: null,
      error: null,
      providerId: null,
      modelId: null,
      traceId: "trace-1",
      usage: null,
      cancelled: false,
      verificationVerdict: "needs_review",
    } as unknown as TaskExecutionOutcome;
    const coordinator = new ExecutionCoordinator({
      executor: { execute: async (): Promise<TaskExecutionOutcome> => notPassing },
      clock: new ManualClock(NOW),
    });
    createGatedJobOn(coordinator, "job-unverified");
    const gate = coordinator.openApproval({ jobId: "job-unverified", taskId: "t1", question: "Publish?" });
    coordinator.decideApproval({ gateId: gate.gateId, decision: "approved", decidedBy: "human:reviewer" });
    await coordinator.runJob("job-unverified");
    assert.equal(coordinator.task("job-unverified", "t1")?.state, "completed");
    assert.equal(coordinator.job("job-unverified")?.state, "waiting", "a verdict that is not a pass must not complete the job");
    assert.match(coordinator.settle("job-unverified").detail, /did not verify/);
  });

  it("carries the reported verdict out of the production executor", async () => {
    // The adapter is the last hop before the coordinator records a verdict, and
    // it is the one hop the tests above do NOT cover: they inject their own
    // outcome directly, and a run that requested no verification reports `null`
    // whether or not the adapter forwards anything. So a field-drop there is
    // invisible everywhere else and is asserted here on its own.
    const adapter = new OrchestratorTaskExecutor({
      execute: async () => ({
        succeeded: true,
        output: "looks fine",
        providerId: "acme",
        modelId: "m1",
        traceId: "t",
        verificationVerdict: "needs_review",
        errorClass: null,
        reason: "completed",
        cost: null,
      }),
    });
    const outcome = await adapter.execute(
      {
        jobId: "job-1",
        taskId: "t1",
        objective: "o",
        input: "i",
        requiredCapabilities: [RESEARCH],
        minimumTrust: "low",
        attempt: 1,
        signal: new AbortController().signal,
        resumeFrom: null,
      },
      { traceId: "t", taskId: "job-1", parentTaskId: null, teamId: null },
    );
    assert.equal(outcome.verificationVerdict, "needs_review", "the verdict must reach the coordinator, not stop here");
    assert.equal(outcome.succeeded, false, "execution is still not verification");
  });
});

function createGatedJobOn(coordinator: ExecutionCoordinator, jobId: string): void {
  assertOk<unknown>(
    coordinator.createJob({
      jobId,
      workflow: workflow("wf", "Gated research", sequential("root", [approval("gate", workflowTask(), "Publish this externally?")])),
      caller: executorActor("agent:researcher"),
    }),
    `job creation for ${jobId}`,
  );
}

/**
 * A runtime whose GOVERNANCE CONFIGURATION names `workflow.execute` as always
 * needing a human.
 *
 * The important property of this fixture: the workflow does NOT declare
 * `approvalRequired` and has no `approval()` step. The requirement comes from
 * configuration alone, which is exactly the shape that was unsatisfiable - the
 * rule fired, nothing could ever satisfy it, and every job using the setting
 * failed permanently (B-10).
 */
function runtimeRequiringApprovalOnExecute(): ReturnType<typeof runtimeWith> {
  return runtimeWith({
    service: executorActor("svc:runtime"),
    config: loadOrchestrationConfig({ governance: { approvalRequired: ["workflow.execute"] } }),
  });
}

function createPlainJob(runtime: Runtime, jobId: string, caller?: SecurityContext): void {
  assertOk<unknown>(
    runtime.coordinator.createJob({
      jobId,
      workflow: workflow("wf", "Research", sequential("root", [makeTask("t1", workflowTask())])),
      ...(caller === undefined ? {} : { caller }),
    }),
    `job creation for ${jobId}`,
  );
}

describe("PHASE 03 - a configured approval is answerable (B-10, C7.3a/C7.3c/C7.4b)", () => {
  it("opens ONE real gate on the existing authority and holds the task", async () => {
    // C7.4b. `bridgeApproval` is the function written to turn exactly this verdict
    // into an open gate, and it had no call sites anywhere in `src/` - so a
    // governance-configured approval could not be satisfied by anything, and every
    // job using the setting failed permanently with `approval_required`.
    //
    // The gate it opens is the PHASE 07 `ApprovalRegistry` the coordinator already
    // owns. Not a new one: `coordinator.approvals.all().length === 1` below is the
    // assertion that there is no second approval authority.
    const { runtime, adapter } = runtimeRequiringApprovalOnExecute();
    createPlainJob(runtime, "job-configured", executorActor("agent:researcher"));

    await runtime.coordinator.runJob("job-configured");

    assert.equal(adapter.calls.length, 0, "nothing may run before a human has decided");
    const gate = runtime.coordinator.approvals.forTask("job-configured", "t1");
    assert.notEqual(gate, null, "governance must have opened a gate a human can actually answer");
    assert.equal(gate?.state, "waiting");
    assert.equal(
      runtime.coordinator.approvals.all().length,
      1,
      "exactly one gate: a second registry would be a second approval authority",
    );
    assert.equal(
      runtime.coordinator.task("job-configured", "t1")?.state,
      "waiting_approval",
      "the task is HELD, which is a different fact from having failed",
    );
    assert.equal(runtime.coordinator.job("job-configured")?.state, "waiting");
    assert.equal(
      runtime.coordinator.task("job-configured", "t1")?.failure,
      null,
      "waiting on a human is not a failure, and must not consume an attempt as one",
    );
  });

  it("refuses to let the identity the job runs as answer its own governance gate", async () => {
    // The B-05 mechanism, re-proved across the NEW seam. The gate this opens is
    // decided through the coordinator, which derives the executing identities from
    // its own records, so neither the job's caller nor the runtime's service
    // principal can approve - whatever the gate was opened by.
    const { runtime, adapter } = runtimeRequiringApprovalOnExecute();
    createPlainJob(runtime, "job-self-approved", executorActor("human:ana"));
    await runtime.coordinator.runJob("job-self-approved");
    const gate = runtime.coordinator.approvals.forTask("job-self-approved", "t1");
    assert.notEqual(gate, null);

    assert.throws(
      () =>
        runtime.coordinator.decideApproval({
          gateId: (gate as { gateId: string }).gateId,
          decision: "approved",
          decidedBy: "human:ana",
        }),
      /may not approve/,
      "the identity the job executes as must not approve the work governance held",
    );
    assert.throws(
      () =>
        runtime.coordinator.decideApproval({
          gateId: (gate as { gateId: string }).gateId,
          decision: "approved",
          decidedBy: "svc:runtime",
        }),
      /may not approve/,
      "and neither may the runtime's own declared principal",
    );
    assert.equal(adapter.calls.length, 0, "a refused approval must not have run anything");
  });

  it("runs the work, and completes the job, once an independent party has approved", async () => {
    // C7.3a and C7.3c together, end to end. The recorded decision has to feed back
    // into GOVERNANCE, not merely unblock the coordinator: the orchestrator's
    // `workflow.execute` check runs again on the re-drive, and a rule that still
    // said "approval required" would refuse the work a human had just approved.
    const { runtime, adapter } = runtimeRequiringApprovalOnExecute();
    createPlainJob(runtime, "job-approved-configured", executorActor("agent:researcher"));
    await runtime.coordinator.runJob("job-approved-configured");
    const gate = runtime.coordinator.approvals.forTask("job-approved-configured", "t1");
    assert.notEqual(gate, null, "precondition: the gate is open");

    const decided = runtime.coordinator.decideApproval({
      gateId: (gate as { gateId: string }).gateId,
      decision: "approved",
      decidedBy: "human:reviewer",
      reason: "Checked the sources and the recipient",
    });
    assert.equal(decided.state, "approved");

    await runtime.coordinator.runJob("job-approved-configured");
    assert.equal(adapter.calls.length, 1, `an approved task must run; saw ${adapter.calls.join(", ")}`);
    assert.equal(runtime.coordinator.task("job-approved-configured", "t1")?.state, "completed");
    assert.equal(
      runtime.coordinator.job("job-approved-configured")?.state,
      "completed",
      "the whole point: a configured approval that a human granted must not leave the job stuck",
    );
  });

  it("does not run work whose gate was rejected", async () => {
    // The mirror. A rule that observed "an approval exists" rather than "an
    // approval was GRANTED" would pass this, so the negative direction is asserted
    // on the same runtime and the same configuration.
    const { runtime, adapter } = runtimeRequiringApprovalOnExecute();
    createPlainJob(runtime, "job-rejected", executorActor("agent:researcher"));
    await runtime.coordinator.runJob("job-rejected");
    const gate = runtime.coordinator.approvals.forTask("job-rejected", "t1");
    assert.notEqual(gate, null);

    runtime.coordinator.decideApproval({
      gateId: (gate as { gateId: string }).gateId,
      decision: "rejected",
      decidedBy: "human:reviewer",
      reason: "Wrong recipient",
    });
    await runtime.coordinator.runJob("job-rejected");
    assert.equal(adapter.calls.length, 0, "a rejected gate must not release the work");
    assert.notEqual(runtime.coordinator.job("job-rejected")?.state, "completed");
  });

  it("does not let one job's approval answer another job's identically-named task", async () => {
    // The PHASE 10 cross-job approval bypass, re-proved through the new path. Two
    // jobs each containing a task called "t1" is ordinary and nothing forbids it,
    // so an approval lookup that keyed on the task name alone would let one job's
    // decision release another job's work.
    const { runtime, adapter } = runtimeRequiringApprovalOnExecute();
    createPlainJob(runtime, "job-a", executorActor("agent:researcher"));
    createPlainJob(runtime, "job-b", executorActor("agent:researcher"));
    await runtime.coordinator.runJob("job-a");
    await runtime.coordinator.runJob("job-b");

    const gateA = runtime.coordinator.approvals.forTask("job-a", "t1");
    const gateB = runtime.coordinator.approvals.forTask("job-b", "t1");
    assert.notEqual(gateA, null);
    assert.notEqual(gateB, null);
    assert.notEqual(
      (gateA as { gateId: string }).gateId,
      (gateB as { gateId: string }).gateId,
      "precondition: the two jobs hold separate gates",
    );

    runtime.coordinator.decideApproval({
      gateId: (gateA as { gateId: string }).gateId,
      decision: "approved",
      decidedBy: "human:reviewer",
    });
    await runtime.coordinator.runJob("job-a");
    await runtime.coordinator.runJob("job-b");
    assert.equal(adapter.calls.length, 1, "only the approved job's task may run");
    assert.equal(runtime.coordinator.task("job-b", "t1")?.state, "waiting_approval");
  });

  it("is not satisfied by the caller's own claim of approval", async () => {
    // The D-23 hole, re-proved now that the rule consults something. It consults a
    // RECORD; `approvalState` is a field on the very context being checked, and a
    // rule that read it would be satisfied by the party it is checking.
    const { runtime, adapter } = runtimeRequiringApprovalOnExecute();
    createPlainJob(
      runtime,
      "job-asserted",
      createSecurityContext({
        actor: "human:ana",
        trustLevel: "standard",
        grants: [grant("workflow.execute"), grant("capability.execute", { capabilities: [RESEARCH] })],
        scopes: ["task"],
        approvalState: "approved",
        approvalId: "gate-fabricated",
      }),
    );
    await runtime.coordinator.runJob("job-asserted");
    assert.equal(adapter.calls.length, 0, "a self-asserted approval must not release the work");
    const gate = runtime.coordinator.approvals.forTask("job-asserted", "t1");
    assert.equal(gate?.state, "waiting", "the real gate is still waiting, and is the only thing that counts");
    assert.notEqual(gate?.gateId, "gate-fabricated", "no gate the caller named was ever created");
  });

  it("reaches bridgeApproval from exactly one place, and the composition root is it", () => {
    // Structural, because the property is "the dead function is now live, and only
    // the seam that is allowed to touch both subsystems calls it". `integration.ts`
    // defines it and `index.ts` re-exports it; neither is a call site.
    const callers = sourceFiles(path.join(PROJECT_ROOT, "src"))
      .filter((file) => !file.endsWith(path.join("orchestration", "governance", "integration.ts")))
      .filter((file) => /\bbridgeApproval\s*\(/.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => path.relative(PROJECT_ROOT, file).replace(/\\/g, "/"));
    assert.deepEqual(
      callers,
      ["src/orchestration/composition.ts"],
      "the seam between the two subsystems is the only place allowed to bridge them",
    );
  });

  it("gives governance no verb through which it could decide an approval", async () => {
    // Read as source, with comments stripped, for the same reason the PHASE 07 port
    // is: a guarantee asserted only in prose is not a guarantee. The observer is
    // read-only, so a rule that consults it can never produce the answer it reads.
    const source = codeOf("src/orchestration/governance/policy.ts");
    const start = source.indexOf("export interface ApprovalGateObserver");
    assert.notEqual(start, -1, "the observer port must exist for this check to mean anything");
    const block = source.slice(start, source.indexOf("}", start) + 1);
    assert.equal(
      /\bdecide\b|openApproval|\bexpire\b|setState|decided\s*=/.test(block),
      false,
      "governance's view of an approval may read it, never write it",
    );

    // And behaviourally: a gate the registry has not decided is still `waiting` to
    // governance, which is the whole of the guarantee.
    const { runtime } = runtimeRequiringApprovalOnExecute();
    createPlainJob(runtime, "job-observer-readonly", executorActor("agent:researcher"));
    await runtime.coordinator.runJob("job-observer-readonly");
    assert.equal(runtime.coordinator.approvals.all().every((gate) => gate.decidedBy === null), true);
  });

  it("reports how the approval authority is wired", () => {
    // Measurement, not claim: `describe()` is only worth reading if every field in
    // it is measured. This one answers "is a configured approval answerable here?".
    const { runtime } = runtimeRequiringApprovalOnExecute();
    assert.equal(runtime.describe().approvalBridge, "wired");
    assert.equal(runtime.describe().approvalAuthority, "workflow-registry");
  });
});

describe("PHASE 03 - governance is the sole approval policy authority", () => {
  it("requires an approval for an operation configuration names", () => {
    // `governance.approvalRequired` ships as ["approval.resolve",
    // "admin.configure"], is validated, is settable through
    // `TOZ_GOVERNANCE_APPROVAL_REQUIRED`, and was read by NOTHING:
    // `ApprovalRule` existed and was never constructed. A configuration that
    // says "this operation always needs a human" and changes nothing is the
    // fail-open shape C-1 through C-4 all had.
    const { runtime } = runtimeWith({ service: executorActor("svc:runtime") });
    const context = createSecurityContext({
      actor: "human:ana",
      trustLevel: "privileged",
      grants: [grant("approval.resolve")],
    });
    const outcome = runtime.governance.authorize({
      context,
      operation: "approval.resolve",
      resource: { kind: "job", id: "job-1" },
      taskId: "t1",
    });
    assert.equal(outcome.permitted, false, "an operation named by configuration must not be permitted outright");
    assert.equal(outcome.awaitingApproval, true, "and it must be BLOCKED, not denied");
    assert.equal(outcome.errorClass, "approval_required");
  });

  it("leaves an operation configuration does not name alone", () => {
    // Control: the rule must not veto operations it has no business examining.
    const { runtime } = runtimeWith({ service: executorActor("svc:runtime") });
    const context = createSecurityContext({
      actor: "human:ana",
      trustLevel: "privileged",
      grants: [grant("workflow.execute")],
    });
    const outcome = runtime.governance.authorize({ context, operation: "workflow.execute", resource: { kind: "job", id: "job-1" } });
    assert.equal(outcome.permitted, true, outcome.reason);
  });

  it("does not let a caller approve its own operation by writing a field", () => {
    // The independent probe for this phase. `ApprovalRule` used to return
    // `null` when `request.context.approvalState === "approved"` - a field on the
    // context the caller constructed - so the one way to satisfy the rule was to
    // assert that you had satisfied it. Nothing in this repository set
    // `"approved"` by any other route, which made the rule's only satisfiable
    // path caller-attested.
    //
    // A rule may consult a record it cannot write. It must not consult a field
    // the party under check wrote for itself.
    const { runtime } = runtimeWith({ service: executorActor("svc:runtime") });
    const selfApproved = createSecurityContext({
      actor: "human:ana",
      trustLevel: "privileged",
      grants: [grant("approval.resolve")],
      approvalState: "approved",
      approvalId: "gate-claimed",
    });
    const outcome = runtime.governance.authorize({
      context: selfApproved,
      operation: "approval.resolve",
      resource: { kind: "job", id: "job-1" },
      taskId: "t1",
    });
    assert.equal(outcome.permitted, false, "a claim of approval on the context being checked is not an approval");
    assert.equal(outcome.awaitingApproval, true, "and the answer is still BLOCKED rather than denied");
    assert.equal(outcome.errorClass, "approval_required");
  });

  it("keeps the dead caller-writable approvalState field explicitly inert", () => {
    // The instruction for this pass was to remove or explicitly de-authorize
    // `SecurityContext.approvalState`. It is de-authorized, and the
    // de-authorization is TESTED rather than asserted in a docblock, because the
    // field's whole purpose was to be a trap: it is the one property on a security
    // context that reads like an authority and is not.
    //
    // Read as source, comments stripped, so a promise in prose is not counted as
    // the mechanism. `context.ts` may of course SET it (it is a field) and `delegate`
    // may RESET it; what must not exist is a READ that could grant anything.
    const offenders = sourceFiles(path.join(PROJECT_ROOT, "src", "orchestration", "governance"))
      .filter((file) => /\bcontext\.approvalState\b|\.approvalState\s*===|\.approvalState\s*!==/.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => path.relative(PROJECT_ROOT, file).replace(/\\/g, "/"));
    assert.deepEqual(offenders, [], "no governance rule may read the context's own claim of approval");

    // And the whole repository agrees: the only production references are the
    // constructor that sets it and `delegate`, which clears it.
    const elsewhere = sourceFiles(path.join(PROJECT_ROOT, "src"))
      .filter((file) => /\bcontext\.approvalState\b/.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => path.relative(PROJECT_ROOT, file).replace(/\\/g, "/"));
    assert.deepEqual(elsewhere, [], "no production code may treat a context's approvalState as an approval");
  });

  it("keeps governance out of the approval gate's decision", () => {
    // Governance may REQUIRE an approval and may OPEN a gate. It may not RECORD
    // one. If it could there would be two approval authorities and "who approved
    // this?" would have two answers.
    //
    // Read as source, with comments stripped: both times "ApprovalRegistry"
    // appears in this directory it is prose explaining the division of labour, and
    // counting prose as code would be a test that passes for the wrong reason.
    const offenders = sourceFiles(path.join(PROJECT_ROOT, "src", "orchestration", "governance")).filter((file) =>
      stripComments(readFileSync(file, "utf8")).includes("ApprovalRegistry"),
    );
    assert.deepEqual(
      offenders.map((file) => path.relative(PROJECT_ROOT, file).replace(/\\/g, "/")),
      [],
      "governance must require approvals, never decide them",
    );

    // The one view governance DOES hold of the approval subsystem. It can ask for
    // a gate and read one; the port has no verb through which it could decide, so
    // this is structural rather than a rule someone has to remember.
    const source = codeOf("src/orchestration/governance/integration.ts");
    const start = source.indexOf("export interface ApprovalGatePort");
    assert.notEqual(start, -1, "the approval port governance holds must still exist");
    const block = source.slice(start, source.indexOf("}", start) + 1);
    assert.equal(
      /\bdecide\b|decidedBy|decision\b/.test(block),
      false,
      "governance's view of the gate may open it and read it, never decide it",
    );
  });

  it("keeps the coordinator out of authorization", () => {
    // The mirror: the coordinator owns job state and the approval gate, and must
    // not be able to ask permission - that would make it a second policy
    // authority rather than the sole job-state authority.
    const source = codeOf("src/orchestration/workflow/coordinator.ts");
    assert.equal(/\.authorize\(/.test(source), false, "the coordinator must not call an authorization port");
    assert.equal(source.includes("PolicyEngine"), false, "the coordinator must not hold a policy engine");
  });
});

describe("PHASE 03 - QA cannot authorize or approve its own work", () => {
  it("does not release a waiting gate because a verification passed", async () => {
    // Execution is not verification, and verification is not approval. The three
    // are separate: `VerificationRunner` returns a verdict, `ApprovalRegistry`
    // records a decision, and neither can produce the other's answer.
    const registry = new ApprovalRegistry({ clock: new ManualClock(NOW) });
    const gate = registry.open({ jobId: "job-1", taskId: "t1", question: "Publish this?", intent: workflowTask() });

    const runner = new VerificationRunner();
    assertOk<unknown>(runner.register(new EvidenceIntegrityVerifier()), "verifier registration");
    // Only the fields `EvidenceIntegrityVerifier` reads are set; the rest of the
    // record is irrelevant to whether a check passes, and a fixture that had to
    // invent provider, cost and provenance values would be inventing facts.
    const evidence = {
      traceId: "trace-1",
      taskId: "t1",
      startedAt: NOW.getTime(),
      finishedAt: NOW.getTime() + 10,
      status: "succeeded",
      output: "a result",
      errorClass: null,
      agents: ["in-process-agent@1.0.0"],
      sources: [],
    } as unknown as Evidence;
    const verdict = await runner.verify(evidence, ["evidence"], NOW.getTime());
    assert.equal(verdict.verdict, "pass", "the check must genuinely have passed for this to prove anything");

    const release = registry.mayRelease("job-1", "t1", true, workflowTask());
    assert.equal(release.allowed, false, "a passing verification must not release an approval gate");
    assert.equal(gate.state, "waiting");
  });

  it("lets nothing but ApprovalRegistry.decide move a gate to a decided state", () => {
    // Structural, read as source rather than behaviour, because the property is
    // "there is no other writer" and no single run can show that.
    const source = codeOf("src/orchestration/workflow/gates.ts");
    assert.equal(source.includes("VerificationRunner"), false, "the gate must not know verification exists");
    assert.equal(source.includes("verificationVerdict"), false, "the gate must not read a verdict");
    assert.equal((source.match(/state:\s*input\.decision/g) ?? []).length, 1, "exactly one place may write a decided state");
  });

  it("hands out a gate record nobody can rewrite", () => {
    // The behavioural half of the test above, and the case the source scan
    // cannot see: the registry is not the only writer while `get`, `forTask` and
    // `all` return the LIVE stored object. The independent probe for this phase
    // flipped `record.state` on the returned record and `mayRelease` then
    // reported the gate as "granted by null" - no decision, no decider, no
    // timestamp, and a task released without anything having decided it.
    const registry = new ApprovalRegistry({ clock: new ManualClock(NOW) });
    const gate = registry.open({ jobId: "job-1", taskId: "t1", question: "Publish this?", intent: workflowTask() });
    assert.equal(Object.isFrozen(gate), true, "a gate leaves the registry frozen");

    assert.throws(() => {
      (gate as unknown as { state: string }).state = "approved";
    }, TypeError, "writing to a returned gate must be impossible, not merely undocumented");
    assert.equal(registry.get(gate.gateId)?.state, "waiting", "and the stored gate is untouched");

    const decided = registry.decide({ gateId: gate.gateId, decision: "approved", decidedBy: "human:reviewer" });
    assert.equal(registry.forTask("job-1", "t1")?.state, "approved", "the decision itself still lands");
    assert.equal(decided.decidedBy, "human:reviewer");

    assert.throws(() => {
      (decided as unknown as { state: string }).state = "rejected";
    }, TypeError, "a decided gate cannot be overturned by whoever is holding it");
    assert.equal(
      registry.mayRelease("job-1", "t1", true, workflowTask()).allowed,
      true,
      "the release path still reads the decision the registry recorded",
    );
  });

  it("keeps QA and approval as separate subsystems by import", () => {
    assert.equal(codeOf("src/orchestration/workflow/gates.ts").includes("verification/verifier"), false, "gates must not import the verifier");
    const verifier = codeOf("src/orchestration/verification/verifier.ts");
    assert.equal(verifier.includes("ApprovalRegistry"), false, "a verifier must not hold an approval registry");
    assert.equal(verifier.includes("governance/"), false, "a verifier must not authorize");
  });
});

describe("PHASE 03 - one authority per concern", () => {
  it("constructs the approval rule and the policy engine in the composition root only", () => {
    const files = sourceFiles(path.join(PROJECT_ROOT, "src"));
    for (const name of ["PolicyEngine", "ApprovalRule", "ApprovalResolverRule", "GovernanceGate", "TozOrchestrator"]) {
      const unexpected = files
        .filter((file) => new RegExp(`new ${name}\\b`).test(readFileSync(file, "utf8")))
        .map((file) => path.relative(PROJECT_ROOT, file).replace(/\\/g, "/"))
        .filter((entry) => !entry.endsWith("orchestration/composition.ts"));
      assert.deepEqual(unexpected, [], `${name} must be assembled in exactly one place; also found in ${unexpected.join(", ")}`);
    }
  });

  it("keeps the workflow layer out of the governance layer", () => {
    // Two rules, and the second is the one that matters at run time.
    //
    // 1. SOURCE. `workflow/` may name exactly ONE governance module:
    //    `governance/context.js`, and only as a type. That is the frozen identity
    //    value object PHASE 08 defined, and the job has to be able to transport
    //    it, because the identity a background task runs AS is the identity an
    //    approval would be accepting. Everything that DECIDES - `policy`,
    //    `enforcement`, `gate`, `integration`, `recorder` - is unreachable. The
    //    earlier spelling of this check looked for the literal string
    //    "orchestration/governance", which a relative import such as
    //    "../governance/policy.js" would have satisfied without being seen; this
    //    one reads the import specifiers.
    const declaredOffenders = sourceFiles(path.join(PROJECT_ROOT, "src", "orchestration", "workflow")).filter((file) => {
      const specifiers = [...readFileSync(file, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");
      return specifiers.some((spec) => spec.includes("governance/") && !spec.endsWith("governance/context.js"));
    });
    assert.deepEqual(
      declaredOffenders.map((file) => path.relative(PROJECT_ROOT, file).replace(/\\/g, "/")),
      [],
      "the workflow layer may transport an identity type, never a policy",
    );

    // 2. EMITTED. A type-only import is erased, so no workflow module loads a
    //    governance module when it runs. Asserted on the built output because
    //    that is where "declared type-only, emitted as a real import" would show
    //    up - and a source scan cannot see it.
    const emittedDir = path.join(PROJECT_ROOT, "dist", "src", "orchestration", "workflow");
    const emitted = readdirSync(emittedDir).filter((name) => name.endsWith(".js"));
    assert.ok(emitted.length > 0, "the workflow layer must have been built for this check to mean anything");
    const runtimeOffenders = emitted.filter((name) => readFileSync(path.join(emittedDir, name), "utf8").includes("governance/"));
    assert.deepEqual(runtimeOffenders, [], "no workflow module may load governance at run time");
  });

  it("keeps governance free of the workflow layer at import time", () => {
    // The mirror, read through import specifiers for the same reason: governance
    // must not depend on job state, whatever the relative path spells it.
    const offenders = sourceFiles(path.join(PROJECT_ROOT, "src", "orchestration", "governance")).filter((file) => {
      const specifiers = [...readFileSync(file, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");
      return specifiers.some((spec) => spec.includes("workflow/"));
    });
    assert.deepEqual(
      offenders.map((file) => path.relative(PROJECT_ROOT, file).replace(/\\/g, "/")),
      [],
      "policy must not depend on job state",
    );
  });

  it("reports the identity seams it is actually running under", () => {
    const described = runtimeWith({ service: executorActor("svc:runtime"), resolve: () => executorActor() });
    const report = described.runtime.describe();
    assert.equal(report.identityResolver, "supplied");
    assert.equal(report.serviceContext, "supplied");
    assert.equal(report.workflowExecution, "wired");

    const silent = runtimeWith({ service: null, resolve: () => null });
    assert.equal(silent.runtime.describe().identityResolver, "supplied");
    assert.equal(silent.runtime.describe().serviceContext, "absent");
    assert.equal(silent.runtime.describe().workflowExecution, "refused");
  });
});
