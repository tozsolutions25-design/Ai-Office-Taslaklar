/**
 * PHASE 06 EVIDENCE - cross-boundary negatives for every partitioned data plane.
 *
 * Companion to `workspaceIdentity.p06-evidence.test.ts`, which proves the IDENTITY
 * half (a workspace comes only from `provenance: "resolved"`), and to
 * `memoryScopeHonesty.p06-evidence.test.ts`, which proves memory at every scope.
 *
 * This file proves the ENFORCEMENT half at each store, in the negative direction: for
 * every data plane, two instances built with the SAME ids and DIFFERENT workspaces must
 * not see each other. The ids are deliberately identical across every pair - `job-1`,
 * `task-1`, `ui`, `agent-1`, `tool-1` - because a partition that only holds when the
 * ids differ is a partition a caller can defeat by choosing an id, and a caller always
 * chooses ids.
 *
 * Each test asserts BOTH directions. A store that returned nothing for everyone would
 * satisfy half of each assertion, so every negative is paired with a positive that the
 * owning workspace still reads its own entry. "Cannot read the other's" and "can read
 * its own" together are the actual claim; either alone proves nothing.
 *
 * The stores are constructed directly rather than driven through the composition root,
 * because the claim under test is about the STORE, and routing every case through a
 * runtime would test the wiring instead. `describe()` and the composition root have
 * their own coverage in `workspaceRegistryBoundaries.p06-evidence.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { AgentRegistry } from "../src/orchestration/agent/registry.js";
import { InMemoryFeedbackStore } from "../src/orchestration/feedback/feedback.js";
import { ToolRegistry } from "../src/orchestration/tools/tool.js";
import { ClaimRegistry } from "../src/orchestration/workflow/claims.js";
import { CheckpointStore, InProcessApprovalRecordStore } from "../src/orchestration/workflow/gates.js";
import { TaskQueue } from "../src/queue/queue.js";
import { StateStore } from "../src/state/store.js";
import { AuditLog } from "../src/audit/events.js";
import { ExecutionCoordinator, sequential, task, workflow, type WorkflowTask } from "../src/orchestration/workflow/index.js";
import { TraceRecorder } from "../src/orchestration/observability/trace.js";
import { workspaceRef, workspaceKey } from "../src/orchestration/workspace/workspace.js";
import { InMemoryDurableStore } from "../src/state/inMemoryStore.js";
import { scopeOf } from "../src/state/durable.js";

const CLOCK = new ManualClock(new Date("2026-03-01T00:00:00.000Z"));
const A = workspaceRef("acme");
const B = workspaceRef("acme", "brand-two");
const C = workspaceRef("globex");

/** The same ids in every workspace. A partition keyed on these ids is the whole test. */
const JOB = "job-1";
const TASK = "task-1";

/** A gate, as `InProcessApprovalRecordStore.put` stores it. */
function gate(gateId: string): never {
  return {
    gateId,
    jobId: JOB,
    taskId: TASK,
    question: "Publish acme's report?",
    decision: null,
    decidedBy: null,
    decidedAt: null,
    openedAt: 0,
    expiresAtMs: null,
    intent: { taskId: TASK, type: "research", description: "d", payload: {} },
  } as never;
}

/** One executable task, for the coordinator fixture. */
function oneTask(): WorkflowTask {
  return {
    taskId: TASK,
    jobId: JOB,
    objective: "Do the thing",
    input: "in",
    requiredCapabilities: ["text_generation"],
    minimumTrust: "low",
    dependsOn: [],
    approvalRequired: false,
    limits: { timeoutMs: 5_000, maxAttempts: 1, queueTimeoutMs: null },
    checkpointable: false,
    priority: "normal",
  };
}

describe("PHASE 06 EVIDENCE - cross-boundary negatives", () => {
  /* --------------------------------------------------------------- N-2 queue -- */

  it("N-2: two queues in two workspaces hold the same task id without collision", () => {
    const queueA = new TaskQueue({ clock: CLOCK, workspace: A });
    const queueB = new TaskQueue({ clock: CLOCK, workspace: B });

    // POSITIVE: each accepts the id.
    assert.equal(queueA.enqueue({ taskId: TASK, workload: "coding", input: "a" }).ok, true);
    assert.equal(queueB.enqueue({ taskId: TASK, workload: "coding", input: "b" }).ok, true);

    // The duplicate check is partitioned, which is the N-2 defect: it used to be
    // process-wide, so B's caller was refused an id A already held - a cross-tenant
    // denial of service, reported to a caller who had done nothing wrong.
    assert.equal(queueA.enqueue({ taskId: TASK, workload: "coding", input: "again" }).ok, false);
    assert.equal(queueB.enqueue({ taskId: TASK, workload: "coding", input: "again" }).ok, false);

    // Each reads its OWN value, so the two are not merely invisible to each other.
    assert.equal(queueA.get(TASK)?.input, "a");
    assert.equal(queueB.get(TASK)?.input, "b");
  });

  it("N-2: pruneCompleted returns task ids, never the partition prefix", () => {
    const queueA = new TaskQueue({ clock: CLOCK, workspace: A });
    queueA.enqueue({ taskId: TASK, workload: "coding", input: "a" });
    queueA.transition(TASK, "cancelled");
    // A key reaching a caller is both a wrong answer and a disclosure of the layout.
    assert.deepEqual([...queueA.pruneCompleted()], [TASK]);
  });

  /* ----------------------------------------------------------- state store -- */

  it("keeps one workspace's namespaced state out of another's", () => {
    const stateA = new StateStore({ clock: CLOCK, workspace: A });
    const stateB = new StateStore({ clock: CLOCK, workspace: B });

    stateA.set("ui", "selectedTab", { value: "acme-only" });

    // NEGATIVE
    assert.equal(stateB.get("ui", "selectedTab"), undefined, "state must not cross the partition");
    assert.equal(stateB.has("ui", "selectedTab"), false);
    assert.deepEqual(stateB.keys("ui"), [], "one workspace's keys must not be listed by another");
    // POSITIVE
    assert.deepEqual(stateA.get("ui", "selectedTab"), { value: "acme-only" });
    assert.deepEqual(stateA.keys("ui"), ["selectedTab"]);
  });

  it("does not bump another workspace's version when overwriting the same key", () => {
    // The defect this covers: `#entries` keyed by bare namespace meant B's `set`
    // overwrote A's value AND derived its version from A's, so A's next read saw B's
    // value at a bumped version - a cross-workspace write that looked like a normal
    // concurrent update, with a listener fired to A's subscribers.
    const stateA = new StateStore({ clock: CLOCK, workspace: A });
    const stateB = new StateStore({ clock: CLOCK, workspace: B });

    const first = stateA.set("ui", "k", "a-1");
    stateB.set("ui", "k", "b-1");
    const second = stateA.set("ui", "k", "a-2");

    assert.equal(second.version, first.version + 1, "A's version must count A's own writes only");
    assert.deepEqual(stateA.get("ui", "k"), "a-2");
    assert.deepEqual(stateB.get("ui", "k"), "b-1");
  });

  it("fires a state listener only for its own workspace", () => {
    const stateA = new StateStore({ clock: CLOCK, workspace: A });
    const stateB = new StateStore({ clock: CLOCK, workspace: B });
    const seenByA: unknown[] = [];
    stateA.subscribe("ui", (change) => seenByA.push(change.entry.value));

    stateB.set("ui", "k", "b-writes");
    assert.deepEqual(seenByA, [], "another workspace's write must not reach A's listener");

    stateA.set("ui", "k", "a-writes");
    assert.deepEqual(seenByA, ["a-writes"], "and A's own write must");
  });

  /* ----------------------------------------------------------------- claims -- */

  it("counts claims per workspace, so one workspace's claim cannot retire another's", () => {
    const claimsA = new ClaimRegistry({ clock: CLOCK, workspace: A });
    const claimsB = new ClaimRegistry({ clock: CLOCK, workspace: B });

    // NOTE the argument order: `claim(taskId, jobId, workerId)`, reversed relative to
    // `taskKey(jobId, taskId, ...)`. A test that got this backwards would still compile
    // and would still pass, because both are strings - which is exactly why the
    // assertions below read the RESULT rather than trusting the call shape.
    assert.equal(claimsA.claim(JOB, TASK, "worker-1").ok, true, "fixture claim in A");
    assert.equal(claimsA.claimCount(JOB, TASK), 1);

    // NEGATIVE: B has claimed nothing, so B's count is zero and B's claim is fresh.
    // Unpartitioned, B's first claim would have satisfied A's count of 1 and been
    // refused as a duplicate - a cross-tenant write A never made.
    assert.equal(claimsB.claimCount(JOB, TASK), 0, "one workspace's claim count must not be another's");
    assert.equal(claimsB.current(JOB, TASK), null, "one workspace's live claim must not be another's");
    assert.equal(claimsB.claim(JOB, TASK, "worker-2").ok, true, "B must be able to claim the same task id");

    // POSITIVE
    assert.equal(claimsA.current(JOB, TASK)?.workerId, "worker-1");
    assert.equal(claimsB.current(JOB, TASK)?.workerId, "worker-2");
  });

  /* ------------------------------------------------------------- checkpoints -- */

  it("keeps one workspace's checkpoint list out of another's", () => {
    const cpA = new CheckpointStore({ clock: CLOCK, repository: durableStore(A) });
    const cpB = new CheckpointStore({ clock: CLOCK, repository: durableStore(B) });

    cpA.write({
      jobId: JOB,
      taskId: TASK,
      executionId: "exec-a",
      progress: "0.5",
      dataRef: "ref://acme/partial",
      recoverable: true,
    });

    assert.equal(cpB.forTask(JOB, TASK).length, 0, "a resume point must not cross the partition");
    assert.equal(cpB.latest(JOB, TASK), null);
    assert.equal(cpB.count(JOB, TASK), 0);

    assert.equal(cpA.forTask(JOB, TASK).length, 1);
    assert.equal(cpA.latest(JOB, TASK)?.dataRef, "ref://acme/partial");
  });

  it("sequences checkpoints per workspace rather than over one shared counter", () => {
    const cpA = new CheckpointStore({ clock: CLOCK, repository: durableStore(A) });
    const cpB = new CheckpointStore({ clock: CLOCK, repository: durableStore(B) });
    const write = (store: CheckpointStore, ref: string) =>
      store.write({
        jobId: JOB,
        taskId: TASK,
        executionId: "exec",
        progress: "0.5",
        dataRef: ref,
        recoverable: true,
      });

    const a1 = write(cpA, "ref://a/1");
    const b1 = write(cpB, "ref://b/1");
    const a2 = write(cpA, "ref://a/2");

    assert.equal(a1.sequence, 1);
    assert.equal(b1.sequence, 1, "B's first checkpoint is B's first, not A's second");
    assert.equal(a2.sequence, 2, "and A's sequence counts only A's writes");
  });

  /* --------------------------------------------------------- gate 17: gates -- */

  it("gate 17: one workspace's approval gate is invisible to another", () => {
    const storeA = new InProcessApprovalRecordStore({ workspace: A });
    const storeB = new InProcessApprovalRecordStore({ workspace: B });
    storeA.put(gate("gate-1"));

    // NEGATIVE: `byTask` is the reverse index and is the only thing that can leak,
    // because a gate id is random and cannot collide on its own.
    assert.equal(storeB.byTask(JOB, TASK), null, "another workspace's gate must not be found by task");
    assert.deepEqual(storeB.all(), [], "and must not appear in the store's listing");

    // POSITIVE
    assert.equal(storeA.byTask(JOB, TASK)?.gateId, "gate-1");
    assert.equal(storeA.all().length, 1);
  });

  it("gate 17: the gate id itself is not a shared handle across workspaces", () => {
    // Even holding the other workspace's gate id - which a caller could have learned
    // from a log, an error message or a colleague - must not open that gate here.
    const storeA = new InProcessApprovalRecordStore({ workspace: A });
    const storeB = new InProcessApprovalRecordStore({ workspace: B });
    storeA.put(gate("gate-secret"));

    assert.equal(storeB.get("gate-secret"), null, "a gate must not be readable from another partition");
    assert.equal(storeB.byTask(JOB, TASK), null);
  });

  /* ----------------------------------------------------------------- agents -- */

  it("keeps agent registrations and their lifecycle per workspace", () => {
    const agentsA = new AgentRegistry({ clock: CLOCK, workspace: A });
    const agentsB = new AgentRegistry({ clock: CLOCK, workspace: B });
    const input = { agentId: "researcher", version: "1.0.0", adapter: "local", status: "active" as const };

    assert.equal(agentsA.register(input).ok, true);
    // The lifecycle is discovered -> verified -> registered -> available, so a test that
    // jumped straight to `available` was asserting an illegal transition rather than a
    // partition. Walking the legal path is the only way to reach `selectable()`.
    for (const state of ["verified", "registered", "available"] as const) {
      assert.equal(
        agentsA.transition("researcher", "1.0.0", state).ok,
        true,
        `fixture transition to ${state}`,
      );
    }

    // NEGATIVE
    assert.equal(agentsB.has("researcher", "1.0.0"), false, "an agent must not be visible across a partition");
    assert.equal(agentsB.get("researcher", "1.0.0"), null);
    assert.equal(agentsB.require("researcher", "1.0.0").ok, false);
    assert.deepEqual(agentsB.versionsOf("researcher"), []);
    assert.equal(agentsB.transition("researcher", "1.0.0", "verified").ok, false, "and cannot be transitioned");
    assert.deepEqual(agentsB.selectable(), [], "nor selected");

    // POSITIVE, and B may register its own agent under the same id.
    assert.equal(agentsA.get("researcher", "1.0.0")?.lifecycle, "available");
    assert.equal(agentsA.selectable().length, 1);
    assert.equal(agentsB.register({ ...input, adapter: "other" }).ok, true, "the same id in another partition");
  });

  /* ------------------------------------------------------------------ tools -- */

  it("keeps tool grants and side-effect declarations per workspace", () => {
    const toolsA = new ToolRegistry({ clock: CLOCK, workspace: A });
    const toolsB = new ToolRegistry({ clock: CLOCK, workspace: B });
    const record = {
      toolId: "web_publish",
      kind: "remote" as const,
      description: "Publishes a page",
      sideEffecting: true,
      minimumTrust: "high" as const,
    };

    const first = toolsA.register(record);
    assert.equal(first.ok, true);
    // Re-registration inside ONE partition is IDEMPOTENT by design and returns the
    // existing record unchanged - it is not a duplicate error. An earlier version of
    // this test asserted `false` here and was asserting a rule the registry never had;
    // the meaningful claim is that the returned record is the SAME one, i.e. the second
    // registration did not overwrite the first.
    const again = toolsA.register({ ...record, description: "changed", sideEffecting: false });
    assert.equal(again.ok, true, "re-registration is idempotent, not an error");
    if (again.ok && first.ok) {
      assert.equal(again.value, first.value, "and returns the existing record unchanged");
      assert.equal(again.value.description, "Publishes a page", "a re-registration must not rewrite the record");
      assert.equal(again.value.sideEffecting, true, "nor its declared risk");
    }

    // NEGATIVE. This is the check that matters most: a tool's side-effect class is what
    // PHASE 05's authority consults, so one workspace must not be able to reach
    // another's tool record and be judged against its declared risk.
    assert.equal(toolsB.has("web_publish"), false);
    assert.equal(toolsB.get("web_publish"), null);
    assert.deepEqual(toolsB.ids(), [], "the id list must not name another partition's tools");
    assert.deepEqual(toolsB.list(), []);
    assert.equal(toolsB.satisfiesAll(["web_publish"]).satisfied, false, "a required tool must read as absent");
    assert.deepEqual(toolsB.satisfiesAll(["web_publish"]).missing, ["web_publish"]);
    // And B may register its OWN tool under the same id - a partition, not a shared id.
    const ownInB = toolsB.register({ ...record, description: "globex's own publisher" });
    assert.equal(ownInB.ok, true);
    if (ownInB.ok) {
      assert.equal(ownInB.value.description, "globex's own publisher", "B's record is B's own, not A's");
    }

    // POSITIVE
    assert.equal(toolsA.get("web_publish")?.sideEffecting, true);
    assert.deepEqual(toolsA.ids(), ["web_publish"]);
    assert.equal(toolsA.satisfiesAll(["web_publish"]).satisfied, true);
  });

  /* --------------------------------------------------------------- feedback -- */

  it("keeps execution feedback per workspace, stamped by the store", () => {
    const feedbackA = new InMemoryFeedbackStore({ workspace: A });
    const feedbackB = new InMemoryFeedbackStore({ workspace: B });
    const draft = {
      traceId: "trace-1",
      taskId: TASK,
      taskType: "research",
      agentId: "researcher",
      provider: null,
      model: null,
      topology: "single",
      outcome: "succeeded" as const,
      verificationVerdict: null,
      errorClass: null,
      latencyMs: 10,
      retries: 0,
    };

    const recordA = feedbackA.append(draft);
    assert.equal(recordA.workspace?.workspace, A.workspace, "the store stamps the workspace, not the caller");
    assert.equal(recordA.workspace?.brand, A.brand);

    // NEGATIVE
    assert.deepEqual(feedbackB.list(), [], "feedback must not cross the partition");
    assert.deepEqual(feedbackB.forTask(TASK), [], "nor be findable by the task it describes");
    // POSITIVE
    assert.equal(feedbackA.forTask(TASK).length, 1);
    assert.equal(feedbackA.list()[0]?.workspace?.workspace, A.workspace);
  });

  it("bounds each workspace's feedback ring separately", () => {
    // The defect this covers: `#maxRecords` was one shared ring buffer, so a busy
    // workspace appending past the cap silently evicted a quiet workspace's history -
    // cross-tenant, and invisible, because the evicted workspace's own `droppedCount`
    // stayed zero.
    const feedbackA = new InMemoryFeedbackStore({ maxRecords: 2, workspace: A });
    const feedbackB = new InMemoryFeedbackStore({ maxRecords: 2, workspace: B });
    const draft = (taskId: string) => ({
      traceId: "t",
      taskId,
      taskType: "research",
      agentId: null,
      provider: null,
      model: null,
      topology: "single",
      outcome: "succeeded" as const,
      verificationVerdict: null,
      errorClass: null,
      latencyMs: null,
      retries: 0,
    });

    feedbackB.append(draft("b-1"));
    for (const id of ["a-1", "a-2", "a-3"]) feedbackA.append(draft(id));

    assert.equal(feedbackA.forTask("b-1").length, 0);
    assert.equal(feedbackB.forTask("b-1").length, 1, "B's record must survive A exceeding its own cap");
    assert.equal(feedbackB.droppedCount, 0, "and B must not be charged for A's eviction");
    assert.equal(feedbackA.droppedCount, 1, "A is charged only for its own");
  });

  /* ------------------------------------------------------------------ audit -- */

  it("stamps every event with its workspace and answers a scoped read only", () => {
    const logA = new AuditLog({ clock: CLOCK, workspace: A.workspace, brand: A.brand });
    const logB = new AuditLog({ clock: CLOCK, workspace: B.workspace, brand: B.brand });
    logA.append({ kind: "orchestration_event", step: "a-step", outcome: "ok" } as never);
    logB.append({ kind: "orchestration_event", step: "b-step", outcome: "ok" } as never);

    // NEGATIVE
    const inA = logA.read({ workspace: B.workspace, brand: B.brand });
    assert.deepEqual(inA, [], "a scoped read must not answer with another workspace's events");
    assert.deepEqual(logA.read({ workspace: null, brand: null }), [], "and not the unattributed partition");

    // POSITIVE
    const own = logA.read({ workspace: A.workspace, brand: A.brand });
    assert.equal(own.length, 1);
    assert.equal(own[0]?.workspace, A.workspace);
    assert.equal(own[0]?.brand, A.brand);
    assert.deepEqual(
      logB.read({ workspace: B.workspace, brand: B.brand }).map((e) => e.workspace),
      [B.workspace],
    );
  });

  it("separates the two brands of one workspace in the audit log", () => {
    const brandOne = new AuditLog({ clock: CLOCK, workspace: A.workspace, brand: "brand-one" });
    const brandTwo = new AuditLog({ clock: CLOCK, workspace: A.workspace, brand: "brand-two" });
    brandOne.append({ kind: "orchestration_event", step: "one", outcome: "ok" } as never);

    assert.deepEqual(brandTwo.read({ workspace: A.workspace, brand: "brand-two" }), []);
    assert.equal(brandOne.read({ workspace: A.workspace, brand: "brand-one" }).length, 1);
  });

  /* --------------------------------------------------------- N-4: execution -- */

  it("N-4: mints a different execution id per workspace and per brand", async () => {
    // The defect this covers: `executionId` was `exec-${workspace}/${jobId}-${taskId}-
    // ${attempt}`. It carried the workspace NAME but not the BRAND, so two brands of one
    // workspace minted the same id, and the bare `/` join meant job "b/c" under workspace
    // "a" collided with job "c" under workspace "a/b". `workspaceKey` closes both.
    //
    // Observed through the `task_started` audit event rather than by reaching into the
    // coordinator, because that is the surface a caller actually sees - and it also
    // proves the id reaches the history.
    const idsFor = async (workspace: typeof A) => {
      const audit = new AuditLog({ clock: CLOCK, workspace: workspace.workspace, brand: workspace.brand });
      const coordinator = new ExecutionCoordinator({
        executor: {
          execute: () =>
            Promise.resolve({
              succeeded: true,
              output: "done",
              errorClass: null,
              error: null,
              providerId: null,
              modelId: null,
              traceId: null,
              usage: null,
              cancelled: false,
            }),
        },
        clock: CLOCK,
        traces: new TraceRecorder(audit),
        workspace,
      });
      const created = coordinator.createJob({
        jobId: JOB,
        workflow: workflow("wf", "One", sequential("root", [task(TASK, oneTask())])),
      });
      assert.equal(created.ok, true, "fixture job");
      await coordinator.runJob(JOB);
      return audit
        .read({ workspace: workspace.workspace, brand: workspace.brand })
        .filter((event) => event.kind === "orchestration_event" && event.step === "task_started")
        .map((event) => {
          if (event.kind !== "orchestration_event") return "";
          // Narrowed, not coerced: `metadata` is `unknown`-shaped and a bare String()
          // would render an object as "[object Object]", which reads as a passing test
          // while comparing two identical meaningless strings.
          const value = event.metadata.executionId;
          return typeof value === "string" ? value : "";
        })
        .filter((id) => id.length > 0);
    };

    const inA = await idsFor(A);
    const inB = await idsFor(B);
    const inC = await idsFor(C);

    assert.equal(inA.length, 1, "one task, one task_started event");
    assert.equal(inB.length, 1);

    // Two brands of one workspace: the brand must reach the id.
    assert.notEqual(inA[0], inB[0], "two brands of one workspace must not share an execution id");
    // Different workspaces, same job and task ids.
    assert.notEqual(inA[0], inC[0], "two workspaces must not share an execution id");

    // And the id says which partition it belongs to, so a log line is self-describing.
    assert.ok(inA[0]?.includes(A.workspace), `A's execution id must name A: ${inA[0]}`);
    assert.ok(inC[0]?.includes(C.workspace), `C's execution id must name C: ${inC[0]}`);
  });

  it("N-4: a job id containing the separator still cannot re-spell another key", () => {
    // The delimiter ambiguity, proved on the key function.
    //
    // The obvious version of this test - workspace "a" + job "b/c" versus workspace "a/b"
    // + job "c" - is IMPOSSIBLE here, and that is the point: `workspaceRef` rejects any
    // identifier containing a separator, so the ambiguity cannot be reached through a
    // workspace name at all. The reachable route is through a JOB id, which is not
    // restricted that way, so that is the one asserted.
    assert.throws(
      () => workspaceRef("a/b"),
      /Workspace reference is invalid/,
      "a workspace id may not contain a separator, so it cannot be re-spelled",
    );
    const one = workspaceKey(workspaceRef("a"), "job", "b/c");
    const two = workspaceKey(workspaceRef("a"), "job", "b", "c");
    assert.notEqual(one, two, "one part holding a separator must differ from two parts");
    assert.notEqual(
      workspaceKey(workspaceRef("acme"), "x"),
      workspaceKey(workspaceRef("acme"), "brand", "x"),
      "a single part must differ from a pair of parts",
    );
  });

  /* ------------------------------------------------------- three-plane sweep -- */

  it("keeps three distinct workspaces apart on every plane at once", () => {
    // A single sweep, because the interesting failure is not "two stores differ" but
    // "some store was left out of the sweep and silently shared".
    const planes = {
      queue: [
        new TaskQueue({ clock: CLOCK, workspace: A }),
        new TaskQueue({ clock: CLOCK, workspace: B }),
        new TaskQueue({ clock: CLOCK, workspace: C }),
      ],
      state: [
        new StateStore({ clock: CLOCK, workspace: A }),
        new StateStore({ clock: CLOCK, workspace: B }),
        new StateStore({ clock: CLOCK, workspace: C }),
      ],
      agents: [
        new AgentRegistry({ clock: CLOCK, workspace: A }),
        new AgentRegistry({ clock: CLOCK, workspace: B }),
        new AgentRegistry({ clock: CLOCK, workspace: C }),
      ],
      tools: [
        new ToolRegistry({ clock: CLOCK, workspace: A }),
        new ToolRegistry({ clock: CLOCK, workspace: B }),
        new ToolRegistry({ clock: CLOCK, workspace: C }),
      ],
      claims: [
        new ClaimRegistry({ clock: CLOCK, workspace: A }),
        new ClaimRegistry({ clock: CLOCK, workspace: B }),
        new ClaimRegistry({ clock: CLOCK, workspace: C }),
      ],
      checkpoints: [
        new CheckpointStore({ clock: CLOCK, repository: durableStore(A) }),
        new CheckpointStore({ clock: CLOCK, repository: durableStore(B) }),
        new CheckpointStore({ clock: CLOCK, repository: durableStore(C) }),
      ],
      approvals: [
        new InProcessApprovalRecordStore({ workspace: A }),
        new InProcessApprovalRecordStore({ workspace: B }),
        new InProcessApprovalRecordStore({ workspace: C }),
      ],
      feedback: [
        new InMemoryFeedbackStore({ workspace: A }),
        new InMemoryFeedbackStore({ workspace: B }),
        new InMemoryFeedbackStore({ workspace: C }),
      ],
    };

    // Seed workspace A ONLY. Everything below asserts that B and C see nothing.
    planes.queue[0].enqueue({ taskId: TASK, workload: "coding", input: "a" });
    planes.state[0].set("ns", "k", "a");
    planes.agents[0].register({ agentId: "agent-1", version: "1.0.0", adapter: "local", status: "active" });
    planes.tools[0].register({
      toolId: "tool-1",
      kind: "local",
      description: "d",
      sideEffecting: false,
      minimumTrust: "low",
    });
    planes.claims[0].claim(JOB, TASK, "worker-1");
    planes.approvals[0].put(gate("gate-sweep"));
    planes.checkpoints[0].write({
      jobId: JOB,
      taskId: TASK,
      executionId: "e",
      progress: "1",
      dataRef: "r",
      recoverable: true,
    });
    planes.feedback[0].append({
      traceId: "t",
      taskId: TASK,
      taskType: "research",
      agentId: null,
      provider: null,
      model: null,
      topology: "single",
      outcome: "succeeded",
      verificationVerdict: null,
      errorClass: null,
      latencyMs: null,
      retries: 0,
    });

    const readBack: Record<string, (index: number) => unknown> = {
      queue: (i) => planes.queue[i].get(TASK)?.input,
      state: (i) => planes.state[i].get("ns", "k"),
      agents: (i) => planes.agents[i].get("agent-1", "1.0.0")?.record.agentId,
      tools: (i) => planes.tools[i].get("tool-1")?.toolId,
      claims: (i) => planes.claims[i].current(JOB, TASK)?.workerId,
      checkpoints: (i) => planes.checkpoints[i].latest(JOB, TASK)?.dataRef,
      approvals: (i) => planes.approvals[i].byTask(JOB, TASK)?.gateId,
      // `forTask` returns an array, so "absent" is `0` and not `undefined`. Normalised
      // here so the sweep can assert one uniform shape for every plane - a reader that
      // returned `0` for empty would otherwise read as a PASS for any plane whose
      // legitimate answer is falsy, which is the failure mode a sweep exists to catch.
      feedback: (i) => {
        const found = planes.feedback[i].forTask(TASK);
        return found.length === 0 ? undefined : found.length;
      },
    };

    for (const [plane, read] of Object.entries(readBack)) {
      assert.notEqual(read(0), undefined, `${plane}: A must read its own entry`);
      assert.equal(read(1), undefined, `${plane}: B must not read A's entry`);
      assert.equal(read(2), undefined, `${plane}: C must not read A's entry`);
    }
  });
});


/**
 * PHASE 12: the repository a `CheckpointStore`/`ClaimRegistry` is built over.
 *
 * Each call makes an INDEPENDENT store. That is the point: the pre-Phase-12 tests proved
 * workspace isolation by giving two stores two `workspace` options, and a store that carries
 * its partition inside the repository can be isolated the same way - if two stores pointed at
 * one repository they would share it, and the test would prove nothing.
 */
function durableStore(workspace: { workspace: string; brand: string | null } | null): InMemoryDurableStore {
  return new InMemoryDurableStore({ scope: scopeOf(workspace) });
}
