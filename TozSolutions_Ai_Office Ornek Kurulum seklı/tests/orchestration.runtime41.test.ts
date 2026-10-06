/**
 * PHASE 04.1: workers, memory permissions, and the observability event inventory.
 *
 * The memory and observability sections are largely REGRESSION coverage for
 * defects found and fixed earlier. They are restated here so that a future
 * change which reopens any of them fails a test whose name says what broke.
 */

import assert from "node:assert/strict";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";

/** PHASE 06: the workspace every subject and store in this file acts in. */
const WS = workspaceRef("test-workspace");
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { AuditLog } from "../src/audit/events.js";
import { AgentRegistry, type RegisteredAgent } from "../src/orchestration/agent/registry.js";
import { AdapterRegistry } from "../src/orchestration/agent/adapter.js";
import { CapabilityRegistry } from "../src/orchestration/capabilities/registry.js";
import { SpecialistPool } from "../src/orchestration/pool/specialistPool.js";
import { ToolRegistry } from "../src/orchestration/tools/tool.js";
import { WorkerHost, type Worker, type WorkerRunRecord } from "../src/orchestration/workers/worker.js";
import {
  DisabledMemoryProvider,
  InMemoryMemoryProvider,
  MemoryAccessError,
  MemoryAccessPolicy,
  type MemoryGrant,
} from "../src/orchestration/memory/memory.js";
import {
  ORCHESTRATION_EVENT_KINDS,
  ResourceTracker,
  TraceRecorder,
  type OrchestrationEventKind,
} from "../src/orchestration/observability/trace.js";
import { VerificationRunner } from "../src/orchestration/verification/verifier.js";
import { InMemoryFeedbackStore } from "../src/orchestration/feedback/feedback.js";
import { DriftGuard } from "../src/orchestration/policy/antiDrift.js";
import { SecurityDecisionLog, PermissiveInputPolicy, PermissiveOutputPolicy } from "../src/orchestration/policy/security.js";
import { TozOrchestrator } from "../src/orchestration/authority.js";
import { AgentIngestor } from "../src/orchestration/index.js";
import { type ModelRoutingPort } from "../src/orchestration/model/modelRouter.js";
import { assertOk } from "./contracts/contracts.js";


/** PHASE 06: the workspace every subject and store in this file acts in. */
const CLOCK = new ManualClock(new Date("2026-01-01T00:00:00.000Z"));

/* ------------------------------------------------------------------ */
/* M. Workers                                                          */
/* ------------------------------------------------------------------ */

function worker(id: string, run: Worker["run"], intervalMs = 1_000): Worker {
  return { id, intervalMs, run };
}

describe("PHASE 04.1 M — foreground work", () => {
  it("runs a worker inline and returns its result", async () => {
    const host = new WorkerHost({ clock: CLOCK });
    assertOk(host.register(worker("inline", async () => ({ scanned: 2 }))));
    const record = assertOk<WorkerRunRecord>(await host.runOnce("inline"));
    assert.equal(record.outcome, "succeeded");
    assert.deepEqual(record.detail, { scanned: 2 });
  });

  it("returns the execution result to the caller, not to a queue", async () => {
    const host = new WorkerHost({ clock: CLOCK });
    assertOk(host.register(worker("inline", async () => ({ value: "done" }))));
    const record = assertOk<WorkerRunRecord>(await host.runOnce("inline"));
    // The record is the worker's whole output contract: the orchestrator, not
    // the worker, decides what happens next.
    assert.equal(record.detail["value"], "done");
  });
});

describe("PHASE 04.1 M — background and long-running work", () => {
  it("bounds a long run with a timeout", async () => {
    const host = new WorkerHost({ clock: CLOCK, defaultTimeoutMs: 5 });
    assertOk(
      host.register(
        worker("slow", (signal) => new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })),
      ),
    );
    const result = await host.runOnce("slow");
    assert.equal(result.ok, false);
    assert.equal(host.history("slow")[0]?.outcome, "cancelled");
  });

  it("cancels a running worker without deregistering it", async () => {
    const host = new WorkerHost({ clock: CLOCK, defaultTimeoutMs: 5_000 });
    assertOk(
      host.register(
        worker("long", (signal) => new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })),
      ),
    );
    const running = host.runOnce("long");
    assert.equal(host.cancel("long"), true);
    await running;
    assert.equal(host.ids().includes("long"), true, "cancelling is not deregistering");
    assert.equal(host.isRunning("long"), false);
  });

  it("stops a worker and reports it stopped", async () => {
    const host = new WorkerHost({ clock: CLOCK });
    assertOk(host.register(worker("x", async () => ({}))));
    assertOk(host.start("x"));
    assertOk(host.stop("x"));
    assert.equal(host.statusOf("x"), "stopped");
  });

  it("stops every worker at once", () => {
    const host = new WorkerHost({ clock: CLOCK });
    assertOk(host.register(worker("a", async () => ({}))));
    assertOk(host.register(worker("b", async () => ({}))));
    host.stopAll();
    assert.equal(host.statusOf("a"), "stopped");
    assert.equal(host.statusOf("b"), "stopped");
  });
});

describe("PHASE 04.1 M — scheduled work", () => {
  it("carries the interval a scheduler would need, as a hint", async () => {
    const host = new WorkerHost({ clock: CLOCK });
    assertOk(host.register(worker("hourly", async () => ({}), 3_600_000)));
    const record = assertOk<WorkerRunRecord>(await host.runOnce("hourly"));
    assert.equal(record.outcome, "succeeded");
    assert.ok(host.ids().includes("hourly"));
  });

  it("is not a scheduler: it does not run on its own", async () => {
    const host = new WorkerHost({ clock: CLOCK });
    assertOk(host.register(worker("ticker", async () => ({}), 1)));
    // Nothing runs until a caller asks. A worker host that self-started would
    // be an execution path with no orchestrator behind it.
    assert.equal(host.history().length, 0);
  });
});

describe("PHASE 04.1 M — worker failure and retry", () => {
  it("records a failure and honours the attempt ceiling", async () => {
    const host = new WorkerHost({ clock: CLOCK, maxAttempts: 2 });
    let attempts = 0;
    assertOk(
      host.register(
        worker("flaky", async () => {
          attempts += 1;
          throw new Error("down");
        }),
      ),
    );
    const result = await host.runOnce("flaky");
    assert.equal(result.ok, false);
    assert.equal(attempts, 2);
    assert.equal(host.statusOf("flaky"), "failed");
  });

  it("can be restarted after a failure", async () => {
    const host = new WorkerHost({ clock: CLOCK, maxAttempts: 1 });
    let failing = true;
    assertOk(
      host.register(
        worker("probe", async () => {
          if (failing) throw new Error("down");
          return { ok: true };
        }),
      ),
    );
    await host.runOnce("probe");
    failing = false;
    assertOk(host.start("probe"));
    assert.equal(assertOk<WorkerRunRecord>(await host.runOnce("probe")).outcome, "succeeded");
  });

  it("records every run in history", async () => {
    const host = new WorkerHost({ clock: CLOCK });
    assertOk(host.register(worker("a", async () => ({}))));
    await host.runOnce("a");
    await host.runOnce("a");
    assert.equal(host.history("a").length, 2);
  });
});

describe("PHASE 04.1 M — a worker is not a second orchestrator", () => {
  it("receives only an abort signal, so it has no way to start work", () => {
    const registered: Worker = { id: "probe", intervalMs: 1_000, run: async () => ({}) };
    assert.deepEqual(Object.keys(registered).sort(), ["id", "intervalMs", "run"]);
  });

  it("cannot reach the orchestrator: nothing in the host holds one", async () => {
    const models: ModelRoutingPort = { route: async () => ({ providerId: null, modelId: null, decision: null, reason: "none" }) };
    const orchestrator = new TozOrchestrator({
      agents: new AgentRegistry({ clock: CLOCK }),
      capabilities: new CapabilityRegistry(),
      pool: new SpecialistPool({ candidates: () => [] }),
      models,
      tools: new ToolRegistry({ clock: CLOCK }),
      verification: new VerificationRunner(),
      memory: new DisabledMemoryProvider(),
      feedback: new InMemoryFeedbackStore(),
      traces: new TraceRecorder(),
      resources: new ResourceTracker(),
      drift: new DriftGuard(),
      security: new SecurityDecisionLog(),
      inputPolicy: new PermissiveInputPolicy(),
      outputPolicy: new PermissiveOutputPolicy(),
      adapters: new AdapterRegistry(),
      clock: CLOCK,
    });
    // The orchestrator exists and is reachable from this scope; the worker host
    // is constructed with no reference to it and takes no collaborators.
    assert.notEqual(orchestrator, null);
    const host = new WorkerHost({ clock: CLOCK });
    assert.deepEqual(Object.keys(host), [], "the host holds no collaborators at all");
  });

  it("does not implement the orchestrator's interface", () => {
    const host = new WorkerHost({ clock: CLOCK }) as unknown as Record<string, unknown>;
    assert.equal(host["execute"], undefined, "a worker host cannot execute a task");
    assert.equal(host["runPlan"], undefined);
  });
});

/* ------------------------------------------------------------------ */
/* H. Memory: read and write permissions                                */
/* ------------------------------------------------------------------ */

function grant(overrides: Partial<MemoryGrant> = {}): MemoryGrant {
  return { subject: { workspace: WS, id: "agent:a", operatingScope: "task" }, scopes: ["task"], writableScopes: [], minimumTrust: "untrusted", expiresAt: null, ...overrides };
}

describe("PHASE 04.1 H — memory permissions", () => {
  it("allows a read for a granted scope", async () => {
    const memory = new InMemoryMemoryProvider();
    const policy = new MemoryAccessPolicy(CLOCK);
    policy.grant(grant());
    await memory.write(WS, { scope: "task", key: "k", value: 1, writtenAt: 1, writtenBy: "seed" });
    assert.equal(await memory.readScoped<number>(policy, { workspace: WS, id: "agent:a", operatingScope: "task" }, "task", "k"), 1);
  });

  it("denies a read for a scope that was not granted", async () => {
    const memory = new InMemoryMemoryProvider();
    const policy = new MemoryAccessPolicy(CLOCK);
    policy.grant(grant({ scopes: ["task"] }));
    await assert.rejects(memory.readScoped(policy, { workspace: WS, id: "agent:a", operatingScope: "task" }, "project", "k"), MemoryAccessError);
  });

  it("allows a write for a granted writable scope", async () => {
    const memory = new InMemoryMemoryProvider();
    const policy = new MemoryAccessPolicy(CLOCK);
    policy.grant(grant({ writableScopes: ["task"] }));
    await memory.writeScoped(policy, { workspace: WS, id: "agent:a", operatingScope: "task" }, { scope: "task", key: "k", value: 1, writtenAt: 1, writtenBy: "" });
    assert.equal(await memory.read<number>(WS, "task", "k"), 1);
  });

  it("denies a write for a scope that is only readable", async () => {
    const memory = new InMemoryMemoryProvider();
    const policy = new MemoryAccessPolicy(CLOCK);
    // Readable, not writable: the case that used to be allowed by accident.
    policy.grant(grant({ scopes: ["project"], writableScopes: [] }));
    await assert.rejects(
      memory.writeScoped(policy, { workspace: WS, id: "agent:a", operatingScope: "task" }, { scope: "project", key: "k", value: 1, writtenAt: 1, writtenBy: "" }),
      MemoryAccessError,
    );
  });

  it("never uses read permission to authorise a write", async () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    policy.grant(grant({ scopes: ["task"], writableScopes: [] }));
    assert.equal(policy.canRead({ workspace: WS, id: "agent:a", operatingScope: "task" }, "task"), true);
    assert.equal(policy.canWrite({ workspace: WS, id: "agent:a", operatingScope: "task" }, "task"), false);
  });

  it("grants nothing to an unknown subject", () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    policy.grant(grant());
    assert.equal(policy.canRead({ workspace: WS, id: "agent:stranger", operatingScope: "task" }, "task"), false);
    assert.equal(policy.canWrite({ workspace: WS, id: "agent:stranger", operatingScope: "task" }, "task"), false);
  });

  it("classifies a policy failure as a memory access error, not a crash", async () => {
    const memory = new InMemoryMemoryProvider();
    const policy = new MemoryAccessPolicy(CLOCK);
    await assert.rejects(
      memory.readScoped(policy, { workspace: WS, id: "agent:a", operatingScope: "task" }, "task", "k"),
      (error: unknown) => error instanceof MemoryAccessError && /agent:a/.test((error as Error).message),
    );
  });

  it("treats an expired grant as no grant", () => {
    const clock = new ManualClock(1_000);
    const policy = new MemoryAccessPolicy(clock);
    policy.grant(grant({ writableScopes: ["task"], expiresAt: 1_000 }));
    assert.equal(policy.canWrite({ workspace: WS, id: "agent:a", operatingScope: "task" }, "task"), false);
  });

  it("revokes access on request", () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    policy.grant(grant({ writableScopes: ["task"] }));
    assert.equal(policy.revoke({ workspace: WS, id: "agent:a", operatingScope: "task" }), true);
    assert.equal(policy.canWrite({ workspace: WS, id: "agent:a", operatingScope: "task" }, "task"), false);
  });

  it("keeps scopes isolated from one another", async () => {
    const memory = new InMemoryMemoryProvider();
    await memory.write(WS, { scope: "task", key: "k", value: 1, writtenAt: 1, writtenBy: "seed" });
    assert.equal(await memory.read(WS, "agent", "k"), null);
  });
});

/* ------------------------------------------------------------------ */
/* N. Observability                                                    */
/* ------------------------------------------------------------------ */

describe("PHASE 04.1 N — event kinds", () => {
  it("declares a kind for every milestone the orchestrator records", () => {
    const required: OrchestrationEventKind[] = [
      "agent_selected",
      "agent_rejected",
      "model_routed",
      "team_formed",
      "subtask_started",
      "subtask_retried",
      "subtask_completed",
      "subtask_failed",
      "subtask_skipped",
      "subtask_escalated",
      "tool_invoked",
      "tool_refused",
      // PHASE 11: `"tool_failed"` was REMOVED from this list, and the removal is the point.
      //
      // This test's own premise is "a kind for every milestone the orchestrator RECORDS" — and
      // `tool_failed` was not one. `ToolExecutionHost.invoke` has zero callers in `src/`, so an
      // agent cannot execute a tool at all; it can only report having done so, and
      // `#verifyReportedTools` verifies that report afterwards. A refusal of a reported call is
      // already recorded as `tool_refused`.
      //
      // So the assertion contradicted the sentence it was written to support: it required a
      // kind for a milestone that does not exist, which is how `tool_failed` survived four
      // phases as a name nobody could produce. `knowledge_ingested` went the same way for the
      // same reason — nothing composes a knowledge ingestor (PHASE 10 item 2).
      //
      // The stronger replacement is in `tests/observabilityVocabulary.p11-evidence.test.ts`:
      // it checks that every declared kind is EMITTED somewhere, which is the property this
      // list was a hand-maintained approximation of.
      "memory_read",
      "memory_written",
      "memory_write_refused",
      "evidence_recorded",
      "verification_completed",
      "task_escalated",
      "task_completed",
      "task_cancelled",
    ];
    for (const kind of required) {
      assert.ok(ORCHESTRATION_EVENT_KINDS.includes(kind), `missing event kind: ${kind}`);
    }
  });

  it("keeps every kind unique", () => {
    assert.equal(new Set(ORCHESTRATION_EVENT_KINDS).size, ORCHESTRATION_EVENT_KINDS.length);
  });

  it("writes each event into the shared audit sink under its own kind", () => {
    const audit = new AuditLog({ clock: CLOCK });
    const recorder = new TraceRecorder(audit);
    const context = { traceId: "tr", taskId: "t", parentTaskId: null, teamId: null };
    for (const kind of ORCHESTRATION_EVENT_KINDS) {
      recorder.record(kind, context, { agentId: "a@1" }, CLOCK.now());
    }
    const mirrored = audit.read({ workspace: null, brand: null }).filter((event) => event.kind === "orchestration_event");
    assert.equal(mirrored.length, ORCHESTRATION_EVENT_KINDS.length);
    const steps = mirrored.map((event) => (event as { step: string }).step);
    assert.equal(new Set(steps).size, ORCHESTRATION_EVENT_KINDS.length, "no milestone may be flattened into another");
  });

  it("never writes a milestone as a task transition", () => {
    const audit = new AuditLog({ clock: CLOCK });
    const recorder = new TraceRecorder(audit);
    recorder.record("task_completed", { traceId: "tr", taskId: "t", parentTaskId: null, teamId: null }, {}, CLOCK.now());
    assert.equal(
      audit.read({ workspace: null, brand: null }).some((event) => event.kind === "task_transition"),
      false,
      "REGRESSION: this is the PHASE 04 defect that recorded every milestone as a transition to running",
    );
  });

  it("attributes provider and model on the event itself", () => {
    const audit = new AuditLog({ clock: CLOCK });
    const recorder = new TraceRecorder(audit);
    recorder.record(
      "model_routed",
      { traceId: "tr", taskId: "t", parentTaskId: null, teamId: "team-1" },
      { provider: "p", model: "m", agentId: "a@1" },
      CLOCK.now(),
    );
    const event = audit.read({ workspace: null, brand: null })[0];
    assert.equal(event?.kind, "orchestration_event");
    assert.equal((event as { providerId: string | null }).providerId, "p");
    assert.equal((event as { modelId: string | null }).modelId, "m");
    assert.equal((event as { teamId: string | null }).teamId, "team-1");
  });

  it("attributes cost and resources to the task, agent and provider", () => {
    const tracker = new ResourceTracker();
    tracker.record({
      taskId: "t",
      agentId: "a",
      provider: "p",
      model: "m",
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 20,
      toolCallCount: 2,
      retryCount: 1,
      agentCount: 1,
      amount: null,
      currency: null,
    });
    const usage = tracker.usages()[0];
    assert.equal(usage?.taskId, "t");
    assert.equal(usage?.agentId, "a");
    assert.equal(usage?.provider, "p");
    assert.equal(usage?.retryCount, 1);
    assert.equal(usage?.amount, null, "no price is invented when a provider reports none");
  });

  it("groups events by trace, task and kind", () => {
    const recorder = new TraceRecorder();
    const context = { traceId: "tr", taskId: "t", parentTaskId: null, teamId: null };
    recorder.record("agent_selected", context, {}, CLOCK.now());
    recorder.record("task_completed", context, {}, CLOCK.now());
    assert.equal(recorder.byTrace("tr").length, 2);
    assert.equal(recorder.byTask("t").length, 2);
    assert.equal(recorder.byKind("agent_selected").length, 1);
  });
});

/* ------------------------------------------------------------------ */
/* A. Ingestion does not bypass the registry                            */
/* ------------------------------------------------------------------ */

describe("PHASE 04.1 — ingestion is not a decision", () => {
  it("registers agents that only the lifecycle can promote", () => {
    const agents = new AgentRegistry({ clock: CLOCK });
    const capabilities = new CapabilityRegistry();
    new AgentIngestor({ agents, capabilities, clock: CLOCK }).ingestDescriptors(
      { kind: "agency", name: "agency" },
      [{ id: "imported", capabilities: ["source_verification"] }],
    );
    assert.equal(agents.size, 1);
    assert.equal(agents.selectable().length, 0, "an imported agent must not be selectable on arrival");
  });

  it("makes the imported agent selectable once the lifecycle advances it", () => {
    const agents = new AgentRegistry({ clock: CLOCK });
    const capabilities = new CapabilityRegistry();
    const ingestor = new AgentIngestor({ agents, capabilities, clock: CLOCK, promoteToAvailable: true });
    ingestor.ingestDescriptors({ kind: "agency", name: "agency" }, [{ id: "imported", capabilities: ["source_verification"] }]);
    assert.equal(agents.selectable().length, 1);
  });

  it("keeps the source's adapter name, so the roster must name a real adapter", () => {
    const agents = new AgentRegistry({ clock: CLOCK });
    const capabilities = new CapabilityRegistry();
    new AgentIngestor({ agents, capabilities, clock: CLOCK }).ingestDescriptors(
      { kind: "agency", name: "not_installed" },
      [{ id: "imported", capabilities: ["source_verification"] }],
    );
    const record = assertOk<RegisteredAgent>(agents.require("imported", "0.0.0")).record;
    assert.equal(record.adapter, "not_installed");
  });
});
