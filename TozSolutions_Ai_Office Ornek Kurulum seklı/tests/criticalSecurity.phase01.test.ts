/**
 * PHASE 01: the four critical authorization defects found by the Phase 00
 * takeover audit.
 *
 * WHY THIS FILE IS SEPARATE
 *
 * `tests/workflow.jobscope.test.ts` was created for exactly this reason during
 * PHASE 10: a cross-job approval bypass was found by probing, and the tests
 * written to close it are written to FAIL on the old code. That file's only job
 * is to be a mutation target.
 *
 * This file is the same idea applied to four defects found the same way. Every
 * test here was written against the DEFECTIVE behaviour and observed to fail
 * before any fix was made. None of them is a restatement of an existing
 * assertion; each one is a case the existing suite does not cover.
 *
 * THE FOUR DEFECTS
 *
 *   C-1  Governance's denied-provider list was computed and then discarded.
 *        `ModelRouter` applied `applyRoutingRestriction` to a local array, used
 *        it only for a length check, and then handed the router a request with
 *        no candidates in it - so the router re-derived the full, unrestricted
 *        set. A banned provider was selected, and appeared in the fallback
 *        chain.
 *
 *   C-2  The executor could approve its own work. `assertDecidable` refuses
 *        self-approval only when the CALLER volunteers `workerId`, and
 *        `ExecutionCoordinator.decideApproval` never supplied `taskId` at all.
 *
 *   C-3  `approvalRequired: true` was not an enforcement precondition. A task
 *        declaring it was released and executed when no gate had been opened,
 *        because `mayRelease` treats "no gate" as "no approval needed".
 *
 *   C-4  An empty capability list disabled capability enforcement, at two
 *        independent layers: `authorizeSubtask` iterated a caller-supplied list
 *        that may be empty, and `CapabilityRule` abstained when a grant named no
 *        capabilities.
 *
 * THE COMMON ROOT CAUSE (D-05 in docs/execution/DECISIONS.md)
 *
 * An absent value was treated as "there is nothing to enforce" rather than
 * "nothing is permitted". These tests all assert the opposite direction. They
 * are written against the fail-CLOSED direction the rest of this codebase
 * already uses for memory recall, memory scopes and tool grants.
 *
 * HOW TO USE THIS FILE AS A MUTATION TARGET
 *
 * Revert any one fix and the matching describe block must fail. If it does not,
 * the fix is not actually load-bearing and the test is decorative. That check
 * was performed for all four before Phase 01 was marked PASS.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { CapabilitySet, type Capability } from "../src/capabilities/capability.js";
import { UNKNOWN_HEALTH } from "../src/health/index.js";
import { ProviderRegistry } from "../src/providers/index.js";
import { ModelRegistry } from "../src/models/index.js";
import { DefaultRouter, RegistryCandidateSource } from "../src/routing/index.js";
import { ModelRouter } from "../src/orchestration/model/modelRouter.js";
import { AgentRegistry, type RegisteredAgent } from "../src/orchestration/agent/registry.js";
import type { AgentRecord } from "../src/orchestration/agent/record.js";
import {
  CapabilityRule,
  GrantRule,
  KnownActorRule,
  PolicyEngine,
  TrustFloorRule,
  createSecurityContext,
  decide,
  type SecurityContext,
} from "../src/orchestration/governance/index.js";
import { authorizeSubtask } from "../src/orchestration/governance/enforcement.js";
import type { OrchestratorGovernancePort } from "../src/orchestration/governance/gate.js";
import {
  ApprovalRegistry,
  ExecutionCoordinator,
  approval as approvalStep,
  task as makeTask,
  workflow as makeWorkflow,
  type TaskExecutionOutcome,
  type TaskExecutionPort,
  type WorkflowTask,
} from "../src/orchestration/workflow/index.js";
import { assertOk } from "./contracts/contracts.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

/**
 * PHASE 04: the execution intent an approval in this file is bound to.
 *
 * A literal rather than a call to `wfTask`, because the approval blocks that
 * reference it are declared above that helper, and a literal states plainly that
 * the SAME content is described on both sides of every comparison - which is the
 * property the PHASE 04 binding depends on.
 */
const APPROVAL_INTENT = {
  objective: "do the irreversible thing",
  input: "in",
  requiredCapabilities: ["text_generation"],
  minimumTrust: "standard",
} as const;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const okPort: TaskExecutionPort = {
  execute(): Promise<TaskExecutionOutcome> {
    return Promise.resolve({
      succeeded: true,
      output: "ran",
      errorClass: null,
      error: null,
      providerId: null,
      modelId: null,
      traceId: null,
      usage: { inputTokens: 1, outputTokens: 1, latencyMs: 1, amount: 1, currency: "USD" },
      cancelled: false,
    });
  },
};

function coordinator(): ExecutionCoordinator {
  return new ExecutionCoordinator({ executor: okPort, clock: new ManualClock(NOW) });
}

function wfTask(jobId: string, taskId: string, overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    taskId,
    jobId,
    objective: "do the irreversible thing",
    input: "in",
    requiredCapabilities: ["text_generation"],
    minimumTrust: "standard",
    dependsOn: [],
    approvalRequired: false,
    limits: { timeoutMs: 1_000, maxAttempts: 1, queueTimeoutMs: null },
    checkpointable: false,
    verificationKinds: [],
    priority: "normal",
    ...overrides,
  };
}

/** Two eligible providers. Identical on every ranked fact. */
function routingFixture(): {
  readonly providers: ProviderRegistry;
  readonly models: ModelRegistry;
  readonly router: ModelRouter;
} {
  const clock = new ManualClock(NOW);
  const providers = new ProviderRegistry({ clock });
  const models = new ModelRegistry({ clock, providers });

  // Distinct provider types, so a type-based denial can discriminate between
  // them. Otherwise `deniedProviderTypes` would exclude both and prove nothing.
  const TYPES: Record<string, "managed" | "self_hosted"> = {
    "aaa-banned": "managed",
    "zzz-allowed": "self_hosted",
  };

  for (const providerId of ["aaa-banned", "zzz-allowed"]) {
    providers.register({
      providerId,
      type: TYPES[providerId] ?? "unknown",
      capabilities: CapabilitySet.supporting("text_generation"),
      contextLimitTokens: null,
      costClass: "standard",
      latencyP50Ms: null,
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
      providers.transition(providerId, step);
    }
    providers.setHealth(providerId, { ...UNKNOWN_HEALTH, status: "healthy", observedAt: NOW });
    models.register({
      modelId: `${providerId}-m`,
      providerId,
      capabilities: CapabilitySet.supporting("text_generation"),
      enabled: true,
    });
  }

  const router = new ModelRouter({
    providers,
    models,
    router: new DefaultRouter({
      candidates: new RegistryCandidateSource({
        providers: () => providers.list(),
        modelsByProvider: (providerId) => models.listByProvider(providerId),
        lifecycleOf: (providerId) => providers.lifecycleOf(providerId)?.state ?? "discovered",
      }),
    }),
    clock,
  });

  return { providers, models, router };
}

const banAaa = {
  deniedProviders: ["aaa-banned"],
  deniedModels: [],
  deniedProviderTypes: [],
  reason: "not sanctioned for this actor",
  decidedBy: "policy:provider-sanctions",
};

/**
 * A gate with a fixed verdict, recording what it was asked about.
 *
 * The decision is built with the real `decide()` factory rather than a
 * hand-written literal, so the test cannot drift from the production decision
 * shape - and so no type assertion is needed to bridge the two.
 */
function fixedGate(seen: string[], verdict: "ALLOW" | "DENY"): OrchestratorGovernancePort {
  return {
    authorize(request): ReturnType<OrchestratorGovernancePort["authorize"]> {
      seen.push(request.capability ?? "(none)");
      const permitted = verdict === "ALLOW";
      const decision = decide({
        verdict,
        operation: request.operation,
        actor: request.context.actor,
        resource: request.resource ?? null,
        capability: request.capability ?? null,
        reasonCode: permitted ? "permission_granted" : "capability_not_permitted",
        reason: permitted ? "permitted by test gate" : "denied by test gate",
        policy: "test",
        jobId: request.jobId ?? null,
        taskId: request.taskId ?? null,
        executionId: request.executionId ?? null,
        trustLevel: request.context.trustLevel,
        evaluatedRules: [`test-${verdict.toLowerCase()}`],
        at: NOW.getTime(),
      });
      return {
        permitted,
        errorClass: permitted ? null : "authorization_error",
        awaitingApproval: false,
        decision,
        reason: decision.reason,
      };
    },
  };
}

/** A gate that denies everything, and records what it was asked about. */
function denyingGate(seen: string[]): OrchestratorGovernancePort {
  return fixedGate(seen, "DENY");
}

/** A gate that permits everything, and records what it was asked about. */
function permittingGate(seen: string[]): OrchestratorGovernancePort {
  return fixedGate(seen, "ALLOW");
}

function contextFor(capabilities: readonly Capability[]): SecurityContext {
  return createSecurityContext({
    actor: "agent-1",
    trustLevel: "standard",
    grants: [
      {
        operation: "capability.execute",
        resources: [],
        allowList: [],
        capabilities,
        trustFloor: "standard",
        expiresAt: null,
      },
    ],
  });
}

/** Registers an agent and returns the real `AgentRecord`, not a stand-in. */
function agentWith(capabilities: CapabilitySet): AgentRecord {
  const agents = new AgentRegistry({ clock: new ManualClock(NOW) });
  const registered = assertOk<RegisteredAgent>(
    agents.register({
      agentId: "researcher-1",
      version: "1.0.0",
      adapter: "local",
      capabilities,
    }),
    "agent registration",
  );
  return registered.record;
}

/* -------------------------------------------------------------------------- */
/* C-1 — a denied provider must never be selectable                           */
/* -------------------------------------------------------------------------- */

describe("PHASE 01 C-1: governance's denied providers actually reach the router", () => {
  // The fixture is built so the answer cannot be accidental.
  //
  // D-03 recorded that the PHASE 10 mutation test for this guarantee was caught
  // only by a case the DEFECTIVE code also passed for a different reason: a
  // registry containing only the banned provider, where `ModelRouter` returned
  // `null` from a length pre-check rather than because the router honoured the
  // restriction. The case that exposes the real defect - two eligible providers,
  // the denied one ranking first - was the case that fixture avoided.
  //
  // So this fixture registers BOTH providers as eligible and equal on every
  // ranked fact, leaving providerId ascending as the only tiebreak. That makes
  // "aaa-banned" the selection both with and without governance, so any assertion
  // that the denied provider is not selected is attributable to the restriction
  // and to nothing else.

  it("never selects a denied provider when another eligible provider exists", async () => {
    const { router } = routingFixture();

    // Precondition: without governance, the router really does pick the provider
    // that governance is about to deny. If this ever stops being true the fixture
    // has gone stale and the assertions below would pass for the wrong reason.
    const baseline = await router.route({ taskId: "t1", capabilities: ["text_generation"] });
    assert.equal(
      baseline.providerId,
      "aaa-banned",
      "fixture precondition: the denied provider wins when nothing narrows the set",
    );

    const narrowed = await router.route({
      taskId: "t1",
      capabilities: ["text_generation"],
      denied: banAaa,
    });

    assert.notEqual(
      narrowed.providerId,
      "aaa-banned",
      "a denied provider must not be selectable while another eligible provider exists",
    );
    assert.equal(
      narrowed.providerId,
      "zzz-allowed",
      "the route must be the surviving candidate, not merely 'not the banned one'",
    );
  });

  it("keeps a denied provider out of the fallback chain, not only out of the route", async () => {
    const { router } = routingFixture();

    const unrestricted = router.plan({ taskId: "t1", capabilities: ["text_generation"] });
    assert.deepEqual(
      unrestricted.hops.map((hop) => hop.candidate.provider.providerId),
      ["aaa-banned", "zzz-allowed"],
      "fixture precondition: both providers are reachable before governance narrows",
    );

    const chain = router.plan({
      taskId: "t1",
      capabilities: ["text_generation"],
      denied: banAaa,
    });

    assert.deepEqual(
      chain.hops.map((hop) => hop.candidate.provider.providerId),
      ["zzz-allowed"],
      "fallback must never widen past a governance denial - a banned provider must not be a fallback hop",
    );
  });

  it("denies by provider type and by model key as well as by provider id", async () => {
    const { router } = routingFixture();

    const baseline = await router.route({ taskId: "t1", capabilities: ["text_generation"] });
    assert.equal(baseline.providerId, "aaa-banned", "fixture precondition");

    // By provider type. "aaa-banned" is the only `managed` provider, so this
    // discriminates rather than excluding everything.
    const byType = await router.route({
      taskId: "t1",
      capabilities: ["text_generation"],
      denied: {
        deniedProviders: [],
        deniedModels: [],
        deniedProviderTypes: ["managed"],
        reason: "type sanctioned",
        decidedBy: "policy:type-sanctions",
      },
    });
    assert.equal(
      byType.providerId,
      "zzz-allowed",
      "a denial expressed as a provider type must reach the router too",
    );

    // By provider/model key.
    const byModel = await router.route({
      taskId: "t1",
      capabilities: ["text_generation"],
      denied: {
        deniedProviders: [],
        deniedModels: ["aaa-banned/aaa-banned-m"],
        deniedProviderTypes: [],
        reason: "model sanctioned",
        decidedBy: "policy:model-sanctions",
      },
    });
    assert.equal(
      byModel.providerId,
      "zzz-allowed",
      "a denial expressed as a provider/model key must reach the router too",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* C-2 — the executor cannot approve its own work                             */
/* -------------------------------------------------------------------------- */

describe("PHASE 01 C-2: an approval cannot be granted by the party being approved", () => {
  it("refuses self-approval without the caller volunteering an identity", () => {
    const gates = new ApprovalRegistry({ clock: new ManualClock(NOW) });
    const gate = gates.open({ jobId: "job-1", taskId: "t1", question: "Proceed?", intent: APPROVAL_INTENT });

    // The gate KNOWS its own taskId. The comparison must use what the gate
    // recorded, not an optional argument the caller may omit.
    assert.throws(
      () => gates.decide({ gateId: gate.gateId, decision: "approved", decidedBy: "t1" }),
      /may not approve itself/,
      'a gate must refuse a decision made in the name of the task under approval, without the caller passing taskId',
    );
  });

  it("refuses the deciding party being the task, through the coordinator", () => {
    const c = coordinator();
    c.createJob({
      jobId: "job-1",
      workflow: makeWorkflow("wf", "w", makeTask("t1", wfTask("job-1", "t1", { approvalRequired: true }))),
    });
    const gate = c.openApproval({ jobId: "job-1", taskId: "t1", question: "Proceed?" });

    assert.throws(
      () => c.decideApproval({ gateId: gate.gateId, decision: "approved", decidedBy: "t1" }),
      /may not approve itself/,
      "the coordinator must not be able to approve a task in the name of that task",
    );
  });

  it("refuses the worker holding the live claim, even when no workerId is passed", () => {
    const c = coordinator();
    c.createJob({
      jobId: "job-2",
      workflow: makeWorkflow("wf", "w", makeTask("t1", wfTask("job-2", "t1", { approvalRequired: true }))),
    });
    const gate = c.openApproval({ jobId: "job-2", taskId: "t1", question: "Proceed?" });

    // A worker is mid-execution and holds the claim. Its identity is on the
    // CLAIM, which the coordinator owns - so the caller cannot hide it by
    // omitting an argument.
    const claimed = c.claims.claim("job-2", "t1", "worker-7");
    assert.equal(claimed.ok, true, "fixture precondition: worker-7 holds the live claim");

    assert.throws(
      () => c.decideApproval({ gateId: gate.gateId, decision: "approved", decidedBy: "worker-7" }),
      /may not approve its own work/,
      "a worker executing the task must not be able to approve it by omitting workerId",
    );
  });

  it("still permits an unrelated approver", () => {
    // The counterpart assertion. A fix that refuses everything would also pass
    // the three tests above, so the positive case is asserted here.
    const c = coordinator();
    c.createJob({
      jobId: "job-3",
      workflow: makeWorkflow("wf", "w", makeTask("t1", wfTask("job-3", "t1", { approvalRequired: true }))),
    });
    const gate = c.openApproval({ jobId: "job-3", taskId: "t1", question: "Proceed?" });

    const decided = c.decideApproval({
      gateId: gate.gateId,
      decision: "approved",
      decidedBy: "human:ana",
    });

    assert.equal(decided.state, "approved", "an unrelated human approver must still be able to approve");
    assert.equal(decided.decidedBy, "human:ana", "the approver is recorded by name");
  });
});

/* -------------------------------------------------------------------------- */
/* C-3 — declaring that approval is required must actually require it         */
/* -------------------------------------------------------------------------- */

describe("PHASE 01 C-3: 'no gate' must never read as 'permission'", () => {
  it("refuses to release a task that declares approvalRequired with no gate open", () => {
    const c = coordinator();
    c.createJob({
      jobId: "job-9",
      workflow: makeWorkflow("wf", "w", makeTask("t1", wfTask("job-9", "t1", { approvalRequired: true }))),
    });

    // openApproval is deliberately NEVER called. The declaration alone must be
    // enough to hold the task, because the previous behaviour was that the
    // declaration was inert until something else remembered to open a gate.
    const plan = c.planRelease("job-9");

    assert.deepEqual(
      plan.released,
      [],
      'a task declaring approvalRequired must not be released while no gate is open',
    );
    assert.deepEqual(plan.waiting, ["t1"], "it must be reported as waiting, not silently dropped");
  });

  it("refuses to execute a task that declares approvalRequired with no gate open", async () => {
    const c = coordinator();
    c.createJob({
      jobId: "job-10",
      workflow: makeWorkflow("wf", "w", makeTask("t1", wfTask("job-10", "t1", { approvalRequired: true }))),
    });

    // executeTask is a public entry point. If it does not carry the same
    // precondition as planRelease, a direct call is a bypass of the planner.
    // Before the fix this returned an ExecutionResult - the task really ran.
    assert.equal(
      await c.executeTask("job-10", "t1"),
      null,
      "a direct executeTask must apply the same approval precondition the planner does",
    );
  });

  // The two assertions the fix makes expressible. They could not be written before
  // the fix, because the parameter that carries the requirement did not exist; a
  // test that only fails to compile is weaker evidence than one that fails on an
  // assertion. The coordinator-level assertions above are the pre-fix evidence.

  it("blocks at the registry when approval is required and no gate exists", () => {
    const gates = new ApprovalRegistry({ clock: new ManualClock(NOW) });

    const verdict = gates.mayRelease("job-1", "t1", true, APPROVAL_INTENT);

    assert.equal(
      verdict.allowed,
      false,
      "mayRelease must be told whether approval is required, and must block when it is and no gate exists",
    );
    assert.match(
      verdict.detail,
      /no approval gate is open/i,
      "the refusal must name the missing gate, so an operator can see what is blocking the task",
    );
  });

  it("still permits a task that never declared approvalRequired", () => {
    const gates = new ApprovalRegistry({ clock: new ManualClock(NOW) });

    assert.equal(
      gates.mayRelease("job-1", "t1", false, APPROVAL_INTENT).allowed,
      true,
      "a task that declares no approval requirement and has no gate must still run - the fix must not block everything",
    );
  });

  it("opens the gate an approval step declares, and keeps its question", () => {
    const c = coordinator();
    c.createJob({
      jobId: "job-11",
      workflow: makeWorkflow(
        "wf",
        "w",
        approvalStep("s1", wfTask("job-11", "t1"), "May we publish this to production?"),
      ),
    });

    const gate = c.approvals.forTask("job-11", "t1");

    assert.ok(gate !== null, "an approval step must open its gate when the job is created");
    assert.equal(
      gate?.question ?? null,
      "May we publish this to production?",
      "the question declared in the workflow must reach the gate, rather than being dropped during flattening",
    );

    assert.deepEqual(
      c.planRelease("job-11").released,
      [],
      "the newly opened gate is un-approved, so the task must still be waiting",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* C-4 — an empty DECLARED list must not switch enforcement off                */
/* -------------------------------------------------------------------------- */

// A CORRECTION TO THE PHASE 00 FINDING, RECORDED HERE BECAUSE IT CHANGES WHAT
// THIS BLOCK ASSERTS.
//
// Phase 00 reported C-4 as "an empty capability list disables enforcement at two
// layers", and one of those layers was `CapabilityRule` abstaining when a grant
// names no capabilities. Writing the test for it exposed that this is NOT an
// oversight:
//
//   `Grant.capabilities` is documented as - "Capabilities this grant permits.
//   Empty means 'no capability restriction'."
//
// and `Grant.resources` uses the same convention deliberately - "Empty means
// 'this operation, any resource', which is only ever produced deliberately by a
// role definition". `delegate()` propagates it faithfully: a child of a blanket
// grant is itself blanket, which is correct rather than an escalation, because
// the child is never broader than its parent.
//
// So an empty grant list is a POLICY choice about what a role definition means,
// applied coherently across grants. Flipping it to deny would silently redefine
// that documented path, so it is not decided here. It is escalated as B-07 in
// docs/execution/BLOCKERS.md.
//
// What IS a defect is the enforcement TRIGGER. `authorizeSubtask` decided whether
// to authorize anything from `subtask.requiredCapabilities`, which is
// plan-author-supplied data. So under a NARROW grant, a subtask declaring no
// capabilities skipped the check entirely and the narrow grant was never
// consulted. Policy is not caller-controlled; the decision to consult it was.
// That is the half this block tests, and it is the half that is fixed.
describe("PHASE 01 C-4: capability enforcement is driven by the agent, not the plan", () => {
  it("still denies a capability that is absent from the grant", () => {
    const engine = new PolicyEngine({
      rules: [new KnownActorRule(() => true), new GrantRule(), new CapabilityRule(), new TrustFloorRule()],
    });

    const decision = engine.check({
      context: contextFor(["text_generation"]),
      operation: "capability.execute",
      resource: { kind: "capability", id: "research" },
      capability: "research",
    });

    assert.equal(decision.verdict, "DENY", "a capability outside the grant stays denied");
  });

  it("still permits a capability that is inside the list", () => {
    const engine = new PolicyEngine({
      rules: [new KnownActorRule(() => true), new GrantRule(), new CapabilityRule(), new TrustFloorRule()],
    });

    const decision = engine.check({
      context: contextFor(["research"]),
      operation: "capability.execute",
      resource: { kind: "capability", id: "research" },
      capability: "research",
    });

    assert.equal(decision.verdict, "ALLOW", "an explicitly granted capability is still permitted");
  });

  it("authorizes the agent's declared capabilities even when the subtask declares none", () => {
    const seen: string[] = [];

    const outcome = authorizeSubtask(
      denyingGate(seen),
      { taskId: "t1", securityContext: contextFor(["research"]) },
      agentWith(CapabilitySet.supporting("research")),
      {
        taskId: "t1",
        parentTaskId: "root",
        objective: "look something up",
        // The subtask declares nothing. That is what a plan author writes, and it
        // must not be able to switch capability enforcement off.
        requiredCapabilities: [],
        input: "in",
        expectedOutput: "an answer",
        dependsOn: [],
        limits: { timeoutMs: 1_000, maxRetries: 0, maxChildren: 0 },
        verificationKinds: [],
      },
    );

    assert.deepEqual(
      seen,
      ["research"],
      "the agent's own registered capabilities must be authorized, not only the subtask's caller-supplied list",
    );
    assert.notEqual(
      outcome,
      null,
      "a gate that denies the agent's declared capability must produce a refusal",
    );
  });

  it("still authorizes a capability the subtask declares that the agent does not", () => {
    // The union must be a union. A subtask may require MORE than the agent's
    // record declares - that is the planner asking for something - and the fix
    // must not quietly narrow enforcement down to the agent record alone.
    //
    // A PERMITTING gate is used so the full set is observable. A denying gate
    // short-circuits on the first refusal by design (nothing is exercised once one
    // is refused), so it can only ever show the first capability asked about.
    const seen: string[] = [];

    authorizeSubtask(
      permittingGate(seen),
      { taskId: "t1", securityContext: contextFor(["research"]) },
      agentWith(CapabilitySet.supporting("research")),
      {
        taskId: "t1",
        parentTaskId: "root",
        objective: "look something up and then write it up",
        requiredCapabilities: ["structured_output"],
        input: "in",
        expectedOutput: "an answer",
        dependsOn: [],
        limits: { timeoutMs: 1_000, maxRetries: 0, maxChildren: 0 },
        verificationKinds: [],
      },
    );

    assert.deepEqual(
      seen,
      ["structured_output", "research"],
      "both the subtask's declared capability and the agent's own must be authorized",
    );
  });

  it("still permits a subtask whose agent and task declare nothing", () => {
    // The counterpart assertion, for the same reason as C-2's positive case.
    // An agent that can do nothing capability-bearing, on a task that needs
    // nothing, has nothing to authorize - refusing would be noise, not safety.
    const seen: string[] = [];
    const outcome = authorizeSubtask(
      denyingGate(seen),
      { taskId: "t1", securityContext: contextFor(["research"]) },
      agentWith(CapabilitySet.unknown()),
      {
        taskId: "t1",
        parentTaskId: "root",
        objective: "do nothing capability-bearing",
        requiredCapabilities: [],
        input: "in",
        expectedOutput: "nothing",
        dependsOn: [],
        limits: { timeoutMs: 1_000, maxRetries: 0, maxChildren: 0 },
        verificationKinds: [],
      },
    );

    assert.deepEqual(seen, [], "nothing is declared on either side, so there is nothing to authorize");
    assert.equal(outcome, null, "and therefore nothing to refuse");
  });
});
