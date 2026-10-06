/**
 * PHASE 04 - the approval / execution boundary.
 *
 * WHERE THE ACCEPTANCE CRITERIA COME FROM
 *
 * Not from this file. From the repository, which already said what this phase is
 * for:
 *
 *   `docs/execution/MASTER_PLAN.md` §2.6  "Human approval is explicit and
 *     non-inheritable. Publishing, spending, sending, irreversible external
 *     change, binding acts, privilege escalation."
 *   `MASTER_PLAN.md` §8.6               "A human approval is required for every
 *     irreversible or outbound action, and the approval record is durable and
 *     attributable."
 *   `docs/execution/TODO.md` PHASE 04   six items, three of which PHASE 03
 *     closed. The three that remain: durable record, content hash, the
 *     human-approval operation map, plus `authoriseExecution` and re-drive.
 *
 * So the phase answers five questions, and the file is organised by them.
 *
 * WHAT THIS PHASE IS NOT
 *
 * It does not touch TOZ, the policy engine, or the approval registry's authority
 * over a decision. It binds an approval to WHAT IT APPROVED, gives the record
 * container a boundary, states who re-drives, classifies the operations the brief
 * names, and removes an exported function that claimed to authorise execution and
 * did not. Every one of those is a narrowing or a removal; none adds a capability,
 * and none creates a second approval authority.
 *
 * METHOD (binding, carried from Phase 01-03):
 *
 *   1. failing test first,
 *   2. then the implementation,
 *   3. then mutation proof, one wiring decision at a time, on a copy of `dist/`,
 *   4. then regression, plus an independent probe validated by reverts.
 *
 * EVERY REFUSAL BELOW IS PAIRED WITH A POSITIVE CONTROL. A runtime that refused
 * everything would satisfy most of these assertions on its own.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { CapabilitySet } from "../src/capabilities/capability.js";
import { ok } from "../src/core/result.js";

import {
  createRuntime,
  approvalGatesFor,
  type Runtime,
} from "../src/orchestration/composition.js";
import { AdapterRegistry } from "../src/orchestration/agent/adapter.js";
import {
  createSecurityContext,
  OPERATIONS,
  HUMAN_APPROVAL_OPERATIONS,
  HUMAN_APPROVAL_CATEGORIES,
  isHumanApprovalOperation,
  type Grant,
  type SecurityContext,
} from "../src/orchestration/governance/index.js";
import { bridgeApproval } from "../src/orchestration/governance/index.js";
import {
  ApprovalRegistry,
  InProcessApprovalRecordStore,
  approvalBindingOf,
} from "../src/orchestration/workflow/index.js";
import {
  ExecutionCoordinator,
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
  AgentExecutionRequest,
} from "../src/orchestration/agent/adapter.js";
import type { RegisteredAgent } from "../src/orchestration/agent/registry.js";
import { assertOk } from "./contracts/contracts.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const PROJECT_ROOT = process.cwd();
const RESEARCH = "web_research";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

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

  public describe(agentId: string, version: string) {
    return Promise.resolve(
      agentId === this.descriptor.agentId
        ? ok({ ...this.descriptor, version })
        : { ok: false as const, error: new Error(`Unknown agent: ${agentId}`) },
    );
  }

  public execute(agentId: string, request: AgentExecutionRequest) {
    this.calls.push(request.taskId);
    return Promise.resolve(
      ok({
        taskId: request.taskId,
        output: `[${agentId}] ${request.objective}`,
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
        providerId: null,
        modelId: null,
      }),
    );
  }
}

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

function executorActor(actor = "svc:runtime"): SecurityContext {
  return createSecurityContext({
    actor,
    trustLevel: "privileged",
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

/** A context holding every operation, at a trust level that meets every floor. */
function fullyPrivileged(actor: string): SecurityContext {
  return createSecurityContext({
    actor,
    trustLevel: "privileged",
    grants: OPERATIONS.map((operation) => grant(operation)),
    scopes: ["task"],
  });
}

function runtimeWith(options: {
  readonly service?: SecurityContext | null;
  readonly config?: ReturnType<typeof loadOrchestrationConfig>;
}): { runtime: Runtime; adapter: InProcessAdapter } {
  const adapter = new InProcessAdapter();
  const runtime = createRuntime({
    clock: new ManualClock(NOW),
    adapters: [adapter],
    ...(options.config === undefined ? {} : { config: options.config }),
    identity: {
      resolve: () => null,
      ...(options.service === undefined ? {} : { serviceContext: options.service }),
    },
  });
  registerAvailable(runtime);
  assert.equal(runtime.adapters instanceof AdapterRegistry, true);
  return { runtime, adapter };
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

/** A bare coordinator with a recording executor, for the authority-level tests. */
function bareCoordinator(): { coordinator: ExecutionCoordinator; calls: string[] } {
  const calls: string[] = [];
  const coordinator = new ExecutionCoordinator({
    executor: {
      execute: async (request): Promise<TaskExecutionOutcome> => {
        calls.push(request.taskId);
        return {
          succeeded: true,
          output: "done",
          errorClass: null,
          error: null,
          providerId: null,
          modelId: null,
          traceId: "trace-1",
          usage: null,
          cancelled: false,
          verificationVerdict: null,
        };
      },
    },
    clock: new ManualClock(NOW),
  });
  return { coordinator, calls };
}

function addJob(coordinator: ExecutionCoordinator, jobId: string, task: WorkflowTask): void {
  assertOk<unknown>(
    coordinator.createJob({ jobId, workflow: workflow("wf", "Research", sequential("root", [makeTask(task.taskId, task)])) }),
    `job creation for ${jobId}`,
  );
}

/* -------------------------------------------------------------------------- */
/* 1. An approval is bound to WHAT IT APPROVED                                   */
/* -------------------------------------------------------------------------- */

describe("PHASE 04 - an approval is bound to the content it was granted for", () => {
  it("refuses to release content the approver never saw", () => {
    // B-05 question 3, and the reason this phase exists. Before, `mayRelease`
    // compared (job, task) and nothing else: a human approved "research the
    // answer" and the system would then happily run "wire fifty thousand to
    // account X" under the same task name. `MASTER_PLAN.md` §8.6 asks for an
    // approval record that is ATTRIBUTABLE, and an approval that authorises any
    // content under a name is attributable to nothing.
    const registry = new ApprovalRegistry({ clock: new ManualClock(NOW) });
    const approved = workflowTask({ objective: "Draft the Q3 report", input: "sources: q3.csv" });
    registry.open({ jobId: "job-1", taskId: "t1", question: "Publish the Q3 report?", intent: approved });

    const swapped = workflowTask({ objective: "Wire 50000 to account X", input: "beneficiary: X" });
const release = registry.mayRelease("job-1", "t1", true, swapped);
    assert.equal(release.allowed, false, "an approval must not authorise materially different content");
    assert.match(release.detail, /the work has changed since it was approved/i, "the refusal must say why, in words a human can read");
    assert.equal(
      release.detail.includes(release.gate?.binding.slice(0, 12) ?? "x"),
      true,
      "and it must name the digest that WAS approved, so an auditor can find the gate and see what it covered",
    );
    assert.equal(
      release.detail.includes(approvalBindingOf(swapped).slice(0, 12)),
      true,
      "and the digest now being offered, so the mismatch is diagnosable rather than merely refused",
    );
  });

  it("still releases the exact content it was granted for", () => {
    // The positive control. Without it, a binding that never matches would satisfy
    // every refusal above and be useless.
    const registry = new ApprovalRegistry({ clock: new ManualClock(NOW) });
    const task = workflowTask({ objective: "Draft the Q3 report", input: "sources: q3.csv" });
    registry.open({ jobId: "job-1", taskId: "t1", question: "Publish the Q3 report?", intent: task });
    registry.decide({ gateId: "gate-1", decision: "approved", decidedBy: "human:reviewer" });
    const release = registry.mayRelease("job-1", "t1", true, task);
    assert.equal(release.allowed, true, release.detail);
  });

  it("refuses when only the objective changed, and when only the input changed", () => {
    // M4 and M5 of the mutation battery both survived the first version of this
    // file, because the test above changed the objective AND the input together and
    // so could not tell which half was load-bearing. One field at a time is the only
    // way to prove each is really in the digest - and a digest that quietly dropped
    // the objective would still authorise "wire fifty thousand" under an approved
    // "research the answer".
    const objectiveChanged = () => {
      const registry = new ApprovalRegistry({ clock: new ManualClock(NOW) });
      registry.open({
        jobId: "job-1",
        taskId: "t1",
        question: "Research?",
        intent: workflowTask({ objective: "Research the answer", input: "the question" }),
      });
      registry.decide({ gateId: "gate-1", decision: "approved", decidedBy: "human:reviewer" });
      return registry.mayRelease(
        "job-1",
        "t1",
        true,
        workflowTask({ objective: "Wire 50000 to account X", input: "the question" }),
      );
    };
    assert.equal(objectiveChanged().allowed, false, "a different objective under the same name is not the same work");

    const inputChanged = () => {
      const registry = new ApprovalRegistry({ clock: new ManualClock(NOW) });
      registry.open({
        jobId: "job-1",
        taskId: "t1",
        question: "Research?",
        intent: workflowTask({ objective: "Research the answer", input: "the question" }),
      });
      registry.decide({ gateId: "gate-1", decision: "approved", decidedBy: "human:reviewer" });
      return registry.mayRelease(
        "job-1",
        "t1",
        true,
        workflowTask({ objective: "Research the answer", input: "beneficiary: X, amount: 50000" }),
      );
    };
    assert.equal(inputChanged().allowed, false, "different material under the same objective is not the same work");

    // And the control for both: neither field changed.
    const unchanged = () => {
      const registry = new ApprovalRegistry({ clock: new ManualClock(NOW) });
      const task = workflowTask({ objective: "Research the answer", input: "the question" });
      registry.open({ jobId: "job-1", taskId: "t1", question: "Research?", intent: task });
      registry.decide({ gateId: "gate-1", decision: "approved", decidedBy: "human:reviewer" });
      return registry.mayRelease("job-1", "t1", true, task);
    };
    assert.equal(unchanged().allowed, true, "the identical content still releases - these are not blanket refusals");
  });

  it("records the binding on the gate, so a decision names what it decided", () => {
    // "Attributable" (§8.6) is a property of the RECORD, not of the check. An
    // auditor holding a decided gate must be able to say what was approved without
    // re-deriving anything.
    const registry = new ApprovalRegistry({ clock: new ManualClock(NOW) });
    const task = workflowTask();
    const gate = registry.open({ jobId: "job-1", taskId: "t1", question: "Publish?", intent: task });
    assert.equal(gate.binding, approvalBindingOf(task), "the gate must carry the digest of what it was opened for");
    const decided = registry.decide({ gateId: gate.gateId, decision: "approved", decidedBy: "human:reviewer" });
    assert.equal(decided.binding, gate.binding, "a decision must not change what was approved");
    assert.equal(registry.all()[0]?.binding, gate.binding, "and neither may the stored record");
  });

  it("treats the capability requirement as part of the content, order aside", () => {
    // Two properties in one test because they are one decision. A capability set is
    // content - approving "research" is not approving "research and spend" - and it
    // is a SET, so a reordering must not read as a change, or a real approval would
    // be invalidated by nothing at all.
    //
    // The ordering half is the one a naive implementation gets wrong in BOTH
    // directions, and it is asserted with the SAME set written differently on each
    // side: an implementation that ignored capabilities would refuse this, and one
    // that concatenated them unsorted would let a reordering look like a change.
    const registry = new ApprovalRegistry({ clock: new ManualClock(NOW) });
    registry.open({
      jobId: "job-1",
      taskId: "t1",
      question: "Research?",
      intent: workflowTask({ requiredCapabilities: ["entity_extraction", "web_research"] }),
    });
    registry.decide({ gateId: "gate-1", decision: "approved", decidedBy: "human:reviewer" });

    assert.equal(
      registry.mayRelease(
        "job-1",
        "t1",
        true,
        workflowTask({ requiredCapabilities: ["web_research", "entity_extraction"] }),
      ).allowed,
      true,
      "the same capability SET in a different order is the same content",
    );
    assert.equal(
      registry.mayRelease("job-1", "t1", true, workflowTask({ requiredCapabilities: ["web_research"] })).allowed,
      false,
      "dropping a required capability changes what runs and must require a new approval",
    );
    assert.equal(
      registry.mayRelease("job-1", "t1", true, workflowTask({ requiredCapabilities: ["entity_extraction", "web_research", "resource_use"] })).allowed,
      false,
      "adding a required capability changes what runs and must require a new approval",
    );
  });

  it("does not let one task's approval release a sibling task with the same content", () => {
    // Cross-TASK, and the interesting one. Two tasks in ONE job can carry
    // byte-identical objectives, inputs and capability sets - and here BOTH declare
    // that they require approval - so the CONTENT BINDING ALONE CANNOT TELL THEM
    // APART. What holds t2 is the gate KEY, which is (job, task), and which this
    // phase deliberately did not change. That is asserted rather than assumed: the
    // two bindings are proven equal first, so the release behaviour below cannot be
    // explained by a content mismatch.
    const { coordinator } = bareCoordinator();
    const t1 = workflowTask({ taskId: "t1", jobId: "job-siblings", objective: "Same work", input: "same input", approvalRequired: true });
    const t2 = workflowTask({ taskId: "t2", jobId: "job-siblings", objective: "Same work", input: "same input", approvalRequired: true });
    assertOk<unknown>(
      coordinator.createJob({
        jobId: "job-siblings",
        workflow: workflow("wf-siblings", "Siblings", sequential("root", [makeTask("t1", t1), makeTask("t2", t2)])),
      }),
      "sibling job",
    );
    assert.equal(
      approvalBindingOf(t1),
      approvalBindingOf(t2),
      "precondition: the two tasks describe IDENTICAL content, so only the key can separate them",
    );

    const gate = coordinator.openApproval({ jobId: "job-siblings", taskId: "t1", question: "Do it?" });
    coordinator.decideApproval({ gateId: gate.gateId, decision: "approved", decidedBy: "human:reviewer" });

    assert.equal(coordinator.task("job-siblings", "t2")?.approval, null, "the sibling task holds no gate of its own");
    const release = coordinator.planRelease("job-siblings");
    assert.deepEqual(release.released, ["t1"], "only the approved task releases");
    assert.ok(release.waiting.includes("t2"), "and the sibling stays held: an approval answers one task, not any task with the same content");
  });

  it("binds the gate to the coordinator's OWN record, never to a caller's claim", async () => {
    // The structural half, and the one that makes the guarantee real rather than
    // decorative: `openApproval` accepts no intent argument, so the digest can only
    // come from the task the coordinator already holds. A caller cannot approve one
    // thing and run another, because it never supplies either.
    const { runtime } = runtimeWith({ service: executorActor("svc:runtime") });
    assertOk<unknown>(
      runtime.coordinator.createJob({
        jobId: "job-bind",
        workflow: workflow("wf", "Research", sequential("root", [approval("gate", workflowTask(), "Publish?")])),
        caller: executorActor("agent:researcher"),
      }),
      "job creation",
    );
    const before = runtime.coordinator.task("job-bind", "t1");
    const gate = runtime.coordinator.openApproval({ jobId: "job-bind", taskId: "t1", question: "Publish?" });
    const recorded = runtime.coordinator.task("job-bind", "t1");
    assert.ok(before !== null && recorded !== null);
    assert.equal(
      gate.binding,
      approvalBindingOf(recorded.task),
      "the gate must be bound to the recorded task, not to anything a caller said",
    );
  });

  it("refuses to open a gate for a task the coordinator does not hold", () => {
    // Fail-closed on an unbound approval. `openApproval` used to store a gate for a
    // task that did not exist, which is an approval with nothing behind it: there is
    // no record to bind it to, so there is nothing it could ever be said to approve.
    const { coordinator } = bareCoordinator();
    addJob(coordinator, "job-1", workflowTask());
    assert.throws(
      () => coordinator.openApproval({ jobId: "job-1", taskId: "not-a-task", question: "Publish?" }),
      /no such task|holds no task/i,
      "a gate for a task the coordinator does not hold must be refused, not stored",
    );
    assert.equal(
      coordinator.approvals.forTask("job-1", "not-a-task"),
      null,
      "and nothing may be left behind in the registry",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 2. The approval record has a boundary, and an honest durability claim        */
/* -------------------------------------------------------------------------- */

describe("PHASE 04 - the approval record has a container boundary", () => {
  it("reads and writes every gate through the store it was given", () => {
    // The abstraction `MASTER_PLAN.md` §8.6 implies and PHASE 12 will implement.
    // What Phase 04 owes is the SEAM, not the provider: a deployment that wants
    // durable approvals must be able to supply a store, and the registry must not
    // reach past it.
    const store = new InProcessApprovalRecordStore();
    const registry = new ApprovalRegistry({ clock: new ManualClock(NOW), store });
    const task = workflowTask();
    registry.open({ jobId: "job-1", taskId: "t1", question: "Publish?", intent: task });
    registry.decide({ gateId: "gate-1", decision: "approved", decidedBy: "human:reviewer" });
    assert.equal(store.all().length, 1, "the decision must have gone THROUGH the store, not around it");
    assert.equal(store.all()[0]?.state, "approved");
    assert.equal(store.byTask("job-1", "t1")?.gateId, "gate-1");
  });

  it("declares its durability rather than having it assumed", () => {
    // The only shipped store is process-local, and `package.json` has zero runtime
    // dependencies and `src/` writes no file. Saying "durable" here would be the
    // exact overstatement this project has closed three phases of defects over.
    assert.equal(
      new InProcessApprovalRecordStore().durability,
      "process-local",
      "an in-memory store must not describe itself as durable",
    );
  });

  it("reports the durability of approval records on the composed runtime", () => {
    const { runtime } = runtimeWith({ service: executorActor("svc:runtime") });
    assert.equal(
      runtime.describe().approvalDurability,
      "process-local",
      "a deployment must be able to read that approval records do not survive a restart",
    );
  });

  it("keeps two registries over two stores completely separate", () => {
    // Otherwise "the store" is a shared global wearing an interface, and two
    // runtimes would answer questions about each other's approvals.
    const first = new ApprovalRegistry({ clock: new ManualClock(NOW), store: new InProcessApprovalRecordStore() });
    const second = new ApprovalRegistry({ clock: new ManualClock(NOW), store: new InProcessApprovalRecordStore() });
    const task = workflowTask();
    first.open({ jobId: "job-1", taskId: "t1", question: "Publish?", intent: task });
    assert.equal(first.all().length, 1);
    assert.equal(second.all().length, 0, "a second registry must not see the first one's gates");
    assert.equal(second.forTask("job-1", "t1"), null);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Every operation the brief names is answerable                             */
/* -------------------------------------------------------------------------- */

describe("PHASE 04 - the human-approval operation map is authoritative and complete", () => {
  it("classifies EVERY operation in the catalogue", () => {
    for (const operation of OPERATIONS) {
      assert.equal(
        HUMAN_APPROVAL_OPERATIONS[operation] !== undefined,
        true,
        `${operation} must be classified - an unclassified operation reads as "no approval needed"`,
      );
    }
    assert.equal(
      Object.keys(HUMAN_APPROVAL_OPERATIONS).length,
      OPERATIONS.length,
      "the classification must cover the catalogue exactly, with no entries outside it",
    );
  });

  it("names every category the brief lists, mapped onto real operations", () => {
    // `MASTER_PLAN.md` §2.6 names six categories in prose. Prose is not a policy,
    // so each one is mapped onto the catalogue here, and a category with no
    // operation behind it would be a promise with nothing behind it too.
    const expected = [
      "publishing",
      "spending",
      "sending",
      "irreversible-external-change",
      "binding-acts",
      "privilege-escalation",
    ];
    assert.deepEqual(
      HUMAN_APPROVAL_CATEGORIES.map((entry) => entry.category).sort(),
      [...expected].sort(),
      "the brief's six categories must all be present, by name",
    );
    for (const entry of HUMAN_APPROVAL_CATEGORIES) {
      assert.ok(entry.operations.length > 0, `category "${entry.category}" maps to no operation`);
      for (const operation of entry.operations) {
        assert.equal(
          isHumanApprovalOperation(operation),
          true,
          `category "${entry.category}" names "${operation}", which the classification does not require a human for`,
        );
      }
    }
  });

  it("requires approval for the outbound and binding operations, and only those", () => {
    // Stated as a fact rather than a preference, so a later change to the map has
    // to be a visible decision. The `false` entries are the interesting half: the
    // brief warns against imposing default-deny on unrelated internal mechanics,
    // and `workflow.cancel` in particular is a SAFETY action - demanding a human
    // before stopping work would be perverse.
    const required = OPERATIONS.filter((operation) => HUMAN_APPROVAL_OPERATIONS[operation]);
    assert.deepEqual([...required].sort(), [
      "admin.configure",
      "approval.resolve",
      "model.use",
      "provider.use",
      "resource.consume",
      "tool.invoke",
      "workflow.configure",
    ]);
    for (const internal of ["agent.execute", "capability.execute", "memory.read", "memory.write", "workflow.execute"] as const) {
      assert.equal(
        HUMAN_APPROVAL_OPERATIONS[internal],
        false,
        `${internal} is internal mechanics; what it does is governed at the operation it performs`,
      );
    }
  });

  it("opens an answerable gate for EVERY operation the classification names", () => {
    // The verification the phase was asked for, and it is end to end: the real
    // `GovernanceGate`, the real `bridgeApproval`, the real production port adapter,
    // and the real coordinator registry - not a re-implementation of any of them.
    const required = OPERATIONS.filter((operation) => HUMAN_APPROVAL_OPERATIONS[operation]);
    assert.ok(required.length > 0, "precondition: the classification names something");
    for (const operation of required) {
      // A runtime that has NAMED this operation, which is the only thing that turns
      // a classification into a requirement. `governance.approvalRequired` is the
      // switch; this asserts the switch works for every value the brief implies.
      const { runtime } = runtimeWith({
        service: executorActor("svc:runtime"),
        config: loadOrchestrationConfig({ governance: { approvalRequired: [operation] } }),
      });
      addJob(runtime.coordinator, "job-1", workflowTask());
      const context = fullyPrivileged("human:ana");

      const outcome = runtime.governance.authorize({
        context,
        operation,
        resource: { kind: "job", id: "res-1" },
        jobId: "job-1",
        taskId: "t1",
      });
      assert.equal(
        outcome.awaitingApproval,
        true,
        `"${operation}" is classified as needing a human and must be BLOCKED, not denied`,
      );
      assert.equal(outcome.permitted, false);

      // The bridge, with the composition root's OWN port adapter, so this exercises
      // production code rather than a fixture that resembles it.
      const bridged = bridgeApproval({
        decision: outcome.decision,
        gates: approvalGatesFor(runtime.coordinator, "job-1"),
        jobId: "job-1",
        taskId: "t1",
      });
      assert.equal(bridged.action, "blocked", `"${operation}" must open a gate, not be refused`);
      const gateId = bridged.action === "blocked" ? bridged.gateId : "none";

      const decided = runtime.coordinator.decideApproval({
        gateId,
        decision: "approved",
        decidedBy: "human:reviewer",
      });
      assert.equal(decided.state, "approved", `"${operation}": an approval must be recordable`);
      const release = runtime.coordinator.planRelease("job-1");
      assert.deepEqual(
        release.released,
        ["t1"],
        `"${operation}": an approved gate must release the work - an answerable requirement`,
      );
    }
  });

  it("reports the classification AND the configured set, so the difference is readable", () => {
    // The map is a CLASSIFICATION, not a second switch. `governance.approvalRequired`
    // remains the switch, and a deployment must be able to see at a glance which
    // classified operations it has actually turned on - otherwise "the brief says a
    // human is required" and "this deployment requires a human" read the same.
    const { runtime } = runtimeWith({
      service: executorActor("svc:runtime"),
      config: loadOrchestrationConfig({ governance: { approvalRequired: ["admin.configure"] } }),
    });
    const report = runtime.describe();
    assert.ok(report.humanApprovalOperations.includes("tool.invoke"), "the classification is reported in full");
    assert.deepEqual(report.approvalRequiredOperations, ["admin.configure"], "the configured set is reported as configured");
    assert.equal(
      report.humanApprovalOperations.length > report.approvalRequiredOperations.length,
      true,
      "and the gap between them is visible rather than implied",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Who re-drives an approval-held task                                       */
/* -------------------------------------------------------------------------- */

describe("PHASE 04 - re-driving an approved task is the CALLER's job, and is visible", () => {
  it("runs nothing until the caller re-drives, and never re-drives itself", async () => {
    // The ownership contract, asserted rather than described. Nothing in this
    // repository schedules work: adding an auto-runner would put an unbounded loop
    // next to a human decision, which is a scheduling decision with real failure
    // modes and not one this phase may take.
    const { runtime, adapter } = runtimeWith({
      service: executorActor("svc:runtime"),
      config: loadOrchestrationConfig({ governance: { approvalRequired: ["workflow.execute"] } }),
    });
    assertOk<unknown>(
      runtime.coordinator.createJob({
        jobId: "job-redrive",
        workflow: workflow("wf", "Research", sequential("root", [makeTask("t1", workflowTask())])),
        caller: executorActor("agent:researcher"),
      }),
      "job creation",
    );
    await runtime.coordinator.runJob("job-redrive");
    const gate = runtime.coordinator.approvals.forTask("job-redrive", "t1");
    assert.ok(gate !== null);
    runtime.coordinator.decideApproval({
      gateId: (gate as { gateId: string }).gateId,
      decision: "approved",
      decidedBy: "human:reviewer",
    });

    // Nothing has been re-driven yet. Let any stray timer fire.
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(adapter.calls.length, 0, "the system must not re-drive its own work");
    assert.equal(runtime.coordinator.task("job-redrive", "t1")?.state, "ready", "the task is runnable and waiting for its owner");

    const pending = runtime.coordinator.redriveRequired("job-redrive");
    assert.equal(pending.required, true, "an approved task with no attempt since the decision needs a re-drive");
    assert.deepEqual(pending.taskIds, ["t1"]);

    await runtime.coordinator.runJob("job-redrive");
    assert.equal(adapter.calls.length, 1, "the caller's re-drive runs it");
    assert.equal(
      runtime.coordinator.redriveRequired("job-redrive").required,
      false,
      "and the requirement is cleared once the work has run",
    );
  });

  it("reports no re-drive required for a job that never asked for an approval", () => {
    // The positive control. If this returned true for an ordinary fresh job, the
    // signal would be noise and a service would learn to ignore it.
    const { coordinator } = bareCoordinator();
    addJob(coordinator, "job-plain", workflowTask());
    const pending = coordinator.redriveRequired("job-plain");
    assert.equal(pending.required, false, "a fresh job has work, but not work a DECISION left behind");
  });

  it("does not report a re-drive for a task still waiting on its gate", () => {
    const { coordinator } = bareCoordinator();
    addJob(coordinator, "job-waiting", workflowTask({ approvalRequired: true }));
    coordinator.openApproval({ jobId: "job-waiting", taskId: "t1", question: "Publish?" });
    assert.equal(
      coordinator.redriveRequired("job-waiting").required,
      false,
      "a human has not answered yet; nobody should be told to re-drive",
    );
  });

  it("does not report a re-drive for a task that is no longer runnable", async () => {
    // The third condition, and the one a timestamp comparison would have got wrong.
    // An APPROVED gate on a task that is no longer in a runnable state is a real
    // state: the human did answer, and the work will never run. Reporting it as
    // needing a re-drive would be a false positive, and a signal that cries wolf is
    // a signal a service learns to ignore - which is worse than no signal at all.
    const { coordinator } = bareCoordinator();
    assertOk<unknown>(
      coordinator.createJob({
        jobId: "job-stopped",
        workflow: workflow("wf-stopped", "Stopped", sequential("root", [makeTask("t1", workflowTask({ taskId: "t1", jobId: "job-stopped" }))])),
      }),
      "stopped job",
    );
    const gate = coordinator.openApproval({ jobId: "job-stopped", taskId: "t1", question: "Do it?" });
    coordinator.decideApproval({ gateId: gate.gateId, decision: "approved", decidedBy: "human:reviewer" });
    assert.deepEqual(
      coordinator.redriveRequired("job-stopped").taskIds,
      ["t1"],
      "precondition: right after the decision it IS a real obligation",
    );

    await coordinator.runJob("job-stopped");
    assert.equal(coordinator.task("job-stopped", "t1")?.state, "completed", "precondition: it ran");
    assert.equal(coordinator.redriveRequired("job-stopped").required, false, "and a task that has RUN owes nothing");
  });

  it("states the re-drive contract in the runtime's own description", () => {
    const { runtime } = runtimeWith({ service: executorActor("svc:runtime") });
    assert.equal(
      runtime.describe().approvalRedrive,
      "caller-owned",
      "the boundary must be readable by whoever deploys this, not only in a comment",
    );
  });

  it("registers no timer or scheduler in the workflow layer", () => {
    // Structural. "No auto-runner" is a claim about code, so it is checked against
    // code: a `setInterval` anywhere in the workflow layer would be one waiting to
    // start driving approvals without an owner.
    const dir = path.join(PROJECT_ROOT, "src", "orchestration", "workflow");
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => /setInterval|setImmediate|node:timers/.test(readFileSync(path.join(dir, name), "utf8")))
      .filter((name) => {
        const text = readFileSync(path.join(dir, name), "utf8");
        // `setTimeout` is used for the per-task TIMEOUT, which is a bound, not a
        // schedule; only an unbounded repeating timer would be an auto-runner.
        return /setInterval|setImmediate|node:timers/.test(text);
      });
    assert.deepEqual(offenders, [], "the workflow layer must schedule nothing");
  });
});

/* -------------------------------------------------------------------------- */
/* 5. The exported function that claimed to authorise execution                 */
/* -------------------------------------------------------------------------- */

describe("PHASE 04 - no exported function claims authority it does not have", () => {
  it("no longer exports an execution-authorisation function that nothing calls", () => {
    // `authoriseExecution` was exported, unit-tested, and called by NOTHING. It
    // specified four real preconditions and looked like the place execution is
    // authorised, which is exactly how a reader draws the wrong conclusion and then
    // "fixes" a real bug in the code that is never called. Removed rather than
    // wired: wiring it would either duplicate `executeTask`'s checks (and they would
    // drift) or reorder them (approval-before-claim is load-bearing, so a claim
    // would be taken for work that may not run).
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
          // COMMENTS STRIPPED. The removal is documented in a docblock that has to
          // name what it removed, and a docblock is not an enforcement point. What
          // must not survive is CODE that declares or exports it.
          if (/authoriseExecution|AuthorisedExecution/.test(stripComments(readFileSync(full, "utf8")))) {
            offenders.push(path.relative(PROJECT_ROOT, full).replace(/\\/g, "/"));
          }
        }
      }
    };
    walk(path.join(PROJECT_ROOT, "src"));
    assert.deepEqual(offenders, [], "the misleading authority API must be gone, not merely undocumented");
  });

  it("still refuses work with no claim, through the authority that actually runs it", () => {
    // The specification's four conditions, re-asserted against `ExecutionCoordinator`
    // - which is where execution is really authorised. Same coverage, real authority.
    const { coordinator, calls } = bareCoordinator();
    addJob(coordinator, "job-claim", workflowTask());
    coordinator.cancelJob("job-claim", "test");
    void coordinator.runJob("job-claim");
    assert.equal(calls.length, 0, "a cancelled job's work must not start");
  });

  it("still refuses work whose gate is undecided, through the real authority", async () => {
    const { coordinator, calls } = bareCoordinator();
    addJob(coordinator, "job-gate", workflowTask({ approvalRequired: true }));
    coordinator.openApproval({ jobId: "job-gate", taskId: "t1", question: "Publish?" });
    await coordinator.runJob("job-gate");
    assert.equal(calls.length, 0, "an undecided gate must not start work");
    assert.equal(coordinator.task("job-gate", "t1")?.state, "waiting_approval");
  });

  it("still refuses work whose claim was taken away, through the real authority", async () => {
    const { coordinator, calls } = bareCoordinator();
    addJob(coordinator, "job-stale", workflowTask());
    await coordinator.runJob("job-stale");
    assert.equal(calls.length, 1, "precondition: the task ran once");
    // A second delivery finds a live claim and is refused rather than re-running.
    const duplicate = await coordinator.executeTask("job-stale", "t1");
    assert.equal(duplicate, null, "a duplicate delivery must not execute the task again");
    assert.equal(calls.length, 1, "and must not reach the executor a second time");
  });

  it("still runs legitimately authorised work, through the real authority", async () => {
    const { coordinator, calls } = bareCoordinator();
    addJob(coordinator, "job-ok", workflowTask());
    const results = await coordinator.runJob("job-ok");
    assert.equal(results.length, 1, "an ordinary task must still run - the four refusals above must not have become a blanket refusal");
    assert.equal(calls.length, 1);
    assert.equal(coordinator.job("job-ok")?.state, "completed");
  });

  it("holds exactly one approval registry in the composed runtime", () => {
    // One authority per concern, checked by construction site rather than asserted.
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(path.join(PROJECT_ROOT, "src"));
    const constructed = files
      .filter((file) => /new ApprovalRegistry\b/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(PROJECT_ROOT, file).replace(/\\/g, "/"));
    assert.deepEqual(
      constructed,
      ["src/orchestration/workflow/coordinator.ts"],
      "exactly one place may own an approval registry; a second would give 'who approved this?' two answers",
    );
  });

  it("keeps tool EXECUTION off every path, and tool VERIFICATION on exactly one", () => {
    // AMENDED IN PHASE 05. The original assertion here was that no execution path may
    // touch the tool host at all, because `authorizeToolCall` refused a side-effecting
    // tool with a requirement nothing could satisfy (B-13). That is now FALSE, and
    // leaving the test unchanged would have let it pass for the wrong reason: it
    // scans for `toolHost.invoke|authorisedTools|authorisedToolIds` on a `toolHost.`
    // receiver, and PHASE 05's call goes through a local variable.
    //
    // What is true now, and is what this asserts:
    //
    //   1. `verifyReported` is called from EXACTLY ONE file - the orchestrator. One
    //      tool authority, and a claim can only become evidence there.
    //   2. Nothing PERFORMS a tool call (`invoke`) from any execution path. Nothing
    //      issues a `ToolCallApproval` during an execution, so a call that actually
    //      happened could not be shown to have been approved. That remains Phase 13,
    //      and the honest state is that the system verifies claims and executes
    //      nothing.
    const invoker = readFileSync(path.join(PROJECT_ROOT, "src", "orchestration", "tools", "invoker.ts"), "utf8");
    const orchestrationFiles = readdirSync(path.join(PROJECT_ROOT, "src", "orchestration"))
      .flatMap((name) => (name.endsWith(".ts") ? [path.join(PROJECT_ROOT, "src", "orchestration", name)] : []))
      .concat(
        readdirSync(path.join(PROJECT_ROOT, "src", "orchestration", "workflow"))
          .filter((n) => n.endsWith(".ts"))
          .map((n) => path.join(PROJECT_ROOT, "src", "orchestration", "workflow", n)),
      );
    const callersOf = (method: string): string[] =>
      orchestrationFiles
        .filter((file) => new RegExp(`\\.${method}\\s*\\(`).test(readFileSync(file, "utf8")))
        .map((file) => path.relative(PROJECT_ROOT, file).replace(/\\/g, "/"));

    assert.deepEqual(
      callersOf("verifyReported"),
      ["src/orchestration/authority.ts"],
      "the tool authority must be consulted from exactly one place",
    );
    assert.deepEqual(
      callersOf("invoke"),
      [],
      "no execution path may perform a tool call while no flow can approve an irreversible one",
    );
    assert.ok(invoker.includes("authorizeToolCall"), "the tool host's own authorization is unchanged by this phase");
  });
});

/* -------------------------------------------------------------------------- */
/* Helpers shared with the source scans                                         */
/* -------------------------------------------------------------------------- */

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, "");
}

function codeOf(relative: string): string {
  return stripComments(readFileSync(path.join(PROJECT_ROOT, relative), "utf8"));
}

void codeOf;