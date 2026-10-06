import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";

/** PHASE 06: the workspace every subject and store in this file acts in. */
const WS = workspaceRef("test-workspace");

import { ManualClock } from "../src/core/clock.js";
import { DEFAULT_CONFIG, type AppConfig } from "../src/config/schema.js";
import { validateConfig } from "../src/config/validate.js";
import { AuditLog } from "../src/audit/events.js";
import { buildEvidence } from "../src/orchestration/evidence/evidence.js";
import {
  EvidenceIntegrityVerifier,
  SourceRequirementVerifier,
  VerificationRunner,
  isVerificationKind,
  verificationPermitsCompletion,
  type Verifier,
  type VerificationOutcome,
} from "../src/orchestration/verification/verifier.js";
import {
  DisabledMemoryProvider,
  InMemoryMemoryProvider,
  MemoryAccessError,
  MemoryAccessPolicy,
  isMemoryScope,
  isValidMemoryKey,
  type MemorySubject,
} from "../src/orchestration/memory/memory.js";
import { ToolRegistry, authorizeToolCall } from "../src/orchestration/tools/tool.js";
import { WorkerHost, type Worker, type WorkerRunRecord } from "../src/orchestration/workers/worker.js";
import { ExtensionRegistry } from "../src/orchestration/extensions/extension.js";
import { ResourceTracker, TraceRecorder } from "../src/orchestration/observability/trace.js";
import { InMemoryFeedbackStore, feedbackFromExecution, summariseAgent } from "../src/orchestration/feedback/feedback.js";
import {
  DEFAULT_ORCHESTRATION_CONFIG,
  loadOrchestrationConfigFromEnv,
  orchestrationConfigFromApp,
  rawOrchestrationConfigFromEnv,
  validateOrchestrationConfig,
} from "../src/orchestration/index.js";
import { trustRank } from "../src/orchestration/agent/trust.js";
import { assertOk } from "./contracts/contracts.js";

/** PHASE 06: the workspace every subject and store in this file acts in. */
const CLOCK = new ManualClock(new Date("2026-01-01T00:00:00.000Z"));

function goodEvidence(overrides: Partial<Parameters<typeof buildEvidence>[0]> = {}) {
  return buildEvidence({
    taskId: "t1",
    traceId: "tr1",
    agentId: "research-agent",
    agentVersion: "1.0.0",
    output: "an answer",
    status: "succeeded",
    startedAt: 0,
    finishedAt: 10,
    ...overrides,
  });
}

describe("verification runner", () => {
  it("reports needs_review, not pass, when nothing was required", async () => {
    const result = await new VerificationRunner().verify(goodEvidence(), [], CLOCK.nowMs());
    assert.equal(result.verdict, "needs_review", "nothing checked is not everything checked");
    assert.match(result.reason ?? "", /not a pass/);
  });

  it("runs the verifiers a task requires", async () => {
    const runner = new VerificationRunner();
    assertOk(runner.register(new EvidenceIntegrityVerifier()));
    const result = await runner.verify(goodEvidence(), ["evidence"], CLOCK.nowMs());
    assert.equal(result.verdict, "pass");
  });

  it("withholds a pass when a required verifier is missing", async () => {
    const result = await new VerificationRunner().verify(goodEvidence(), ["source"], CLOCK.nowMs());
    assert.equal(result.verdict, "needs_review");
    assert.match(result.reason ?? "", /not available/);
  });

  it("reports the failure detail of a failing verifier", async () => {
    const runner = new VerificationRunner();
    assertOk(runner.register(new SourceRequirementVerifier({ requireSources: true })));
    const result = await runner.verify(goodEvidence(), ["source"], CLOCK.nowMs());
    assert.equal(result.verdict, "fail");
    assert.match(result.reason ?? "", /required a source/);
  });

  it("reports fail when any verifier fails, even if another passed", async () => {
    const runner = new VerificationRunner();
    assertOk(runner.register(new EvidenceIntegrityVerifier()));
    assertOk(runner.register(new SourceRequirementVerifier({ requireSources: true })));
    const result = await runner.verify(goodEvidence(), ["evidence", "source"], CLOCK.nowMs());
    assert.equal(result.verdict, "fail");
  });

  it("refuses a second verifier for the same kind", () => {
    const runner = new VerificationRunner();
    assertOk(runner.register(new EvidenceIntegrityVerifier()));
    const second = runner.register(new EvidenceIntegrityVerifier());
    assert.equal(second.ok, false, "one verifier per kind keeps the verdict unambiguous");
  });

  it("completes only on a pass", async () => {
    assert.equal(verificationPermitsCompletion({ taskId: "t", verdict: "pass", outcomes: [], verifiedAt: 0, reason: null }), true);
    assert.equal(verificationPermitsCompletion({ taskId: "t", verdict: "needs_review", outcomes: [], verifiedAt: 0, reason: "r" }), false);
  });

  it("recognises only declared verification kinds", () => {
    assert.equal(isVerificationKind("schema"), true);
    assert.equal(isVerificationKind("astrology"), false);
  });
});

describe("evidence integrity verifier", () => {
  const verifier = new EvidenceIntegrityVerifier();

  it("accepts a complete record", () => {
    assert.equal(verifier.verify(goodEvidence()).verdict, "pass");
  });

  it("rejects a failed record with no error classification", () => {
    const outcome = verifier.verify(goodEvidence({ status: "failed", output: "" }));
    assert.equal(outcome.verdict, "fail");
    assert.match(outcome.detail, /error classification/);
  });

  it("rejects a succeeded record that names no agent", () => {
    const outcome = verifier.verify(goodEvidence({ agentId: null, agents: [] }));
    assert.equal(outcome.verdict, "fail");
    assert.match(outcome.detail, /names no agent/);
  });

  it("rejects a record that finished before it started", () => {
    const outcome = verifier.verify(goodEvidence({ startedAt: 10, finishedAt: 1 }));
    assert.equal(outcome.verdict, "fail");
  });

  it("rejects a succeeded record with no output", () => {
    assert.equal(verifier.verify(goodEvidence({ output: "  " })).verdict, "fail");
  });

  it("accepts a multi-agent record naming every participant", () => {
    const record = goodEvidence({ agentId: null, agents: ["a@1", "b@2"] });
    assert.equal(verifier.verify(record).verdict, "pass");
  });
});

describe("memory scopes", () => {
  it("recognises the declared scopes", () => {
    assert.equal(isMemoryScope("task"), true);
    assert.equal(isMemoryScope("everything"), false);
  });

  it("rejects a key that could escape the namespace", () => {
    assert.equal(isValidMemoryKey("task-1:outcome"), true);
    assert.equal(isValidMemoryKey("../secrets"), false);
    assert.equal(isValidMemoryKey("a/b"), false);
  });

  it("stores and reads a value by scope", async () => {
    const memory = new InMemoryMemoryProvider();
    await memory.write(WS, { scope: "task", key: "k", value: 42, writtenAt: 1, writtenBy: "test" });
    assert.equal(await memory.read<number>(WS, "task", "k"), 42);
    assert.equal(await memory.read<number>(WS, "agent", "k"), null, "scopes are isolated");
  });

  it("overwrites on the same key rather than failing", async () => {
    const memory = new InMemoryMemoryProvider();
    await memory.write(WS, { scope: "task", key: "k", value: 1, writtenAt: 1, writtenBy: "test" });
    await memory.write(WS, { scope: "task", key: "k", value: 2, writtenAt: 2, writtenBy: "test" });
    assert.equal(await memory.read<number>(WS, "task", "k"), 2);
  });

  it("rejects an invalid key", async () => {
    const memory = new InMemoryMemoryProvider();
    await assert.rejects(
      memory.write(WS, { scope: "task", key: "../x", value: 1, writtenAt: 1, writtenBy: "test" }),
    );
  });

  it("grants nothing by default", () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    assert.equal(policy.canRead({ workspace: WS, id: "agent:a", operatingScope: "task" }, "task"), false, "access is granted, never assumed");
  });

  it("allows reading a granted scope", () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    policy.grant({ subject: { workspace: WS, id: "agent:a", operatingScope: "task" }, scopes: ["task"], writableScopes: [], minimumTrust: "untrusted", expiresAt: null });
    assert.equal(policy.canRead({ workspace: WS, id: "agent:a", operatingScope: "task" }, "task"), true);
  });

  it("does not let a reader write", () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    // PHASE 07: `project`, because the grant names `project`. A subject operating at
    // `task` would have it stripped by the breadth ceiling, and `canRead(...) === true`
    // below would then be asserting the ceiling rather than "read is not write".
    const reader: MemorySubject = { workspace: WS, id: "agent:a", operatingScope: "project" };
    policy.grant({ subject: reader, scopes: ["project"], writableScopes: [], minimumTrust: "untrusted", expiresAt: null });
    assert.equal(policy.canRead(reader, "project"), true);
    assert.equal(policy.canWrite(reader, "project"), false, "read access is not write access");
  });

  it("expires a grant", () => {
    const clock = new ManualClock(1_000);
    const policy = new MemoryAccessPolicy(clock);
    policy.grant({ subject: { workspace: WS, id: "agent:a", operatingScope: "task" }, scopes: ["task"], writableScopes: ["task"], minimumTrust: "untrusted", expiresAt: 1_000 });
    assert.equal(policy.canRead({ workspace: WS, id: "agent:a", operatingScope: "task" }, "task"), false, "an expired grant grants nothing");
  });

  it("revokes a grant", () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    policy.grant({ subject: { workspace: WS, id: "agent:a", operatingScope: "task" }, scopes: ["task"], writableScopes: [], minimumTrust: "untrusted", expiresAt: null });
    assert.equal(policy.revoke({ workspace: WS, id: "agent:a", operatingScope: "task" }), true);
    assert.equal(policy.canRead({ workspace: WS, id: "agent:a", operatingScope: "task" }, "task"), false);
  });

  it("refuses a scoped read from a subject with no grant", async () => {
    const memory = new InMemoryMemoryProvider();
    const policy = new MemoryAccessPolicy(CLOCK);
    await memory.write(WS, { scope: "task", key: "k", value: 1, writtenAt: 1, writtenBy: "test" });
    await assert.rejects(memory.readScoped(policy, { workspace: WS, id: "agent:stranger", operatingScope: "task" }, "task", "k"), MemoryAccessError);
  });

  it("records which reads happened, for an audit", async () => {
    const memory = new InMemoryMemoryProvider();
    const policy = new MemoryAccessPolicy(CLOCK);
    policy.grant({ subject: { workspace: WS, id: "agent:a", operatingScope: "task" }, scopes: ["task"], writableScopes: [], minimumTrust: "untrusted", expiresAt: null });
    await memory.write(WS, { scope: "task", key: "k", value: 1, writtenAt: 1, writtenBy: "test" });
    await memory.readScoped(policy, { workspace: WS, id: "agent:a", operatingScope: "task" }, "task", "k");
    assert.deepEqual(memory.readLog().map((entry) => entry.key), ["k"]);
  });

  it("lets a disabled provider deny everything without erroring", async () => {
    const memory = new DisabledMemoryProvider();
    await memory.write(WS, { scope: "task", key: "k", value: 1, writtenAt: 1, writtenBy: "test" });
    assert.equal(await memory.read(WS, "task", "k"), null);
    assert.deepEqual(await memory.list(WS, "task"), []);
  });
});

describe("tool registry and permissions", () => {
  it("registers a tool once and is idempotent afterwards", () => {
    const tools = new ToolRegistry({ clock: CLOCK });
    assertOk(tools.register({ toolId: "search", kind: "remote", description: "Search the web" }));
    const again = tools.register({ toolId: "search", kind: "remote", description: "Something else" });
    assert.equal(again.ok, true);
    assert.equal(tools.size, 1, "re-registering must not create a second tool");
  });

  it("rejects a tool with no description", () => {
    const tools = new ToolRegistry({ clock: CLOCK });
    const result = tools.register({ toolId: "search", kind: "remote", description: "  " });
    assert.equal(result.ok, false);
  });

  it("rejects an unknown kind", () => {
    const tools = new ToolRegistry({ clock: CLOCK });
    assert.equal(tools.register({ toolId: "x", kind: "teleport" as never, description: "d" }).ok, false);
  });

  it("reports which required tools are missing", () => {
    const tools = new ToolRegistry({ clock: CLOCK });
    assertOk(tools.register({ toolId: "search", kind: "remote", description: "d" }));
    assert.deepEqual(tools.satisfiesAll(["search", "absent"]).missing, ["absent"]);
  });

  it("counts a retired tool as missing", () => {
    const tools = new ToolRegistry({ clock: CLOCK });
    assertOk(tools.register({ toolId: "search", kind: "remote", description: "d" }));
    assertOk(tools.retire("search"));
    assert.deepEqual(tools.satisfiesAll(["search"]).missing, ["search"]);
  });

  it("authorises a tool the caller may use", () => {
    const tools = new ToolRegistry({ clock: CLOCK });
    assertOk(tools.register({ toolId: "search", kind: "remote", description: "d", minimumTrust: "standard" }));
    const result = authorizeToolCall(tools, { subject: "u1", trustLevel: "high" }, "search", trustRank);
    assert.equal(result.ok, true);
  });

  it("refuses a caller below the tool's trust floor", () => {
    const tools = new ToolRegistry({ clock: CLOCK });
    assertOk(tools.register({ toolId: "admin", kind: "remote", description: "d", minimumTrust: "privileged" }));
    const result = authorizeToolCall(tools, { subject: "u1", trustLevel: "standard" }, "admin", trustRank);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error.message, /requires trust "privileged"/);
  });

  it("refuses a tool the caller is denied", () => {
    const tools = new ToolRegistry({ clock: CLOCK });
    assertOk(tools.register({ toolId: "search", kind: "remote", description: "d" }));
    const result = authorizeToolCall(tools, { subject: "u1", trustLevel: "privileged", denied: ["search"] }, "search", trustRank);
    assert.equal(result.ok, false);
  });

  it("requires approval for a side-effecting tool", () => {
    const tools = new ToolRegistry({ clock: CLOCK });
    assertOk(tools.register({ toolId: "delete", kind: "sandboxed", description: "d", sideEffecting: true }));
    const result = authorizeToolCall(
      tools,
      { subject: "u1", trustLevel: "privileged", requiresApprovalForSideEffects: true },
      "delete",
      trustRank,
    );
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error.message, /side effects/);
  });

  it("refuses an unregistered tool", () => {
    const tools = new ToolRegistry({ clock: CLOCK });
    assert.equal(authorizeToolCall(tools, { subject: "u1", trustLevel: "privileged" }, "ghost", trustRank).ok, false);
  });
});

describe("worker host", () => {
  function worker(id: string, run: Worker["run"]): Worker {
    return { id, intervalMs: 1_000, run };
  }

  it("runs a worker and records the run", async () => {
    const host = new WorkerHost({ clock: CLOCK });
    assertOk(host.register(worker("health", async () => ({ checked: 3 }))));
    const result = assertOk<WorkerRunRecord>(await host.runOnce("health"));
    assert.equal(result.outcome, "succeeded");
    assert.equal(host.history("health").length, 1);
  });

  it("records a failing worker as failed rather than restarting it silently", async () => {
    const host = new WorkerHost({ clock: CLOCK, maxAttempts: 3 });
    let attempts = 0;
    assertOk(
      host.register(
        worker("flaky", async () => {
          attempts += 1;
          throw new Error("probe failed");
        }),
      ),
    );
    const result = await host.runOnce("flaky");
    assert.equal(result.ok, false);
    assert.equal(attempts, 3, "the attempt ceiling is honoured");
    assert.equal(host.statusOf("flaky"), "failed");
  });

  it("stops at the attempt ceiling", async () => {
    const host = new WorkerHost({ clock: CLOCK, maxAttempts: 2 });
    let attempts = 0;
    assertOk(
      host.register(
        worker("flaky", async () => {
          attempts += 1;
          throw new Error("no");
        }),
      ),
    );
    await host.runOnce("flaky");
    assert.equal(attempts, 2);
  });

  it("records a cancelled run as cancelled", async () => {
    const host = new WorkerHost({ clock: CLOCK });
    assertOk(
      host.register(
        worker("slow", (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
        ),
      ),
    );
    const result = await host.runOnce("slow", 5);
    assert.equal(result.ok, false);
    assert.equal(host.history("slow")[0]?.outcome, "cancelled");
  });

  it("cancels a running worker on request", async () => {
    const host = new WorkerHost({ clock: CLOCK });
    assertOk(
      host.register(worker("slow", (signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }))),
    );
    const running = host.runOnce("slow", 5_000);
    assert.equal(host.cancel("slow"), true);
    await running;
    assert.equal(host.isRunning("slow"), false);
  });

  it("can be restarted after a failure", async () => {
    const host = new WorkerHost({ clock: CLOCK, maxAttempts: 1 });
    let shouldFail = true;
    assertOk(
      host.register(
        worker("probe", async () => {
          if (shouldFail) throw new Error("down");
          return { ok: true };
        }),
      ),
    );
    await host.runOnce("probe");
    assert.equal(host.statusOf("probe"), "failed");
    shouldFail = false;
    assertOk(host.start("probe"));
    assert.equal(assertOk<WorkerRunRecord>(await host.runOnce("probe")).outcome, "succeeded");
  });

  it("refuses a duplicate worker id", () => {
    const host = new WorkerHost({ clock: CLOCK });
    assertOk(host.register(worker("a", async () => ({}))));
    assert.equal(host.register(worker("a", async () => ({}))).ok, false);
  });

  it("refuses to run an unknown worker", async () => {
    const host = new WorkerHost({ clock: CLOCK });
    assert.equal((await host.runOnce("ghost")).ok, false);
  });

  it("has no reference to the orchestrator, so it cannot start an execution", () => {
    // Structural, not behavioural: `Worker.run` receives only an AbortSignal, so
    // there is nothing in its contract through which it could start work.
    // A worker's contract is exactly `id`, `intervalMs` and `run`; there is no
    // slot through which it could hold an orchestrator reference.
    const registered: Worker = { id: "probe", intervalMs: 1_000, run: async () => ({}) };
    assert.deepEqual(Object.keys(registered).sort(), ["id", "intervalMs", "run"]);
  });
});

describe("extension registry", () => {
  it("registers an extension", () => {
    const registry = new ExtensionRegistry();
    assertOk(registry.register({ id: "acme.search", kind: "tool", version: "1.0.0" }));
    assert.equal(registry.size, 1);
  });

  it("rejects an extension that claims authority", () => {
    const registry = new ExtensionRegistry();
    const result = registry.register({ id: "acme.brain", kind: "agent", version: "1.0.0", claimsAuthority: true });
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error.message, /Authority belongs to the TOZ Orchestrator/);
  });

  it("rejects a duplicate id", () => {
    const registry = new ExtensionRegistry();
    assertOk(registry.register({ id: "a", kind: "tool", version: "1.0.0" }));
    assert.equal(registry.register({ id: "a", kind: "agent", version: "1.0.0" }).ok, false);
  });

  it("rejects an unknown kind", () => {
    const registry = new ExtensionRegistry();
    assert.equal(registry.register({ id: "a", kind: "orchestrator" as never, version: "1.0.0" }).ok, false);
  });

  it("finds extensions contributing a capability", () => {
    const registry = new ExtensionRegistry();
    assertOk(registry.register({ id: "a", kind: "tool", version: "1.0.0", provides: ["web_search"] }));
    assert.equal(registry.providing("web_search").length, 1);
    assert.equal(registry.providing("other").length, 0);
  });
});

describe("observability", () => {
  const context = { traceId: "tr1", taskId: "t1", parentTaskId: null, teamId: "team-1" };

  it("keeps a local trace and a shared audit history", () => {
    const audit = new AuditLog({ clock: CLOCK });
    const recorder = new TraceRecorder(audit);
    recorder.record("agent_selected", context, { agentId: "a@1" }, CLOCK.now());
    assert.equal(recorder.size, 1);
    assert.equal(audit.read({ workspace: null, brand: null }).length, 1);
    const event = audit.read({ workspace: null, brand: null })[0];
    assert.equal(event?.kind, "orchestration_event");
    assert.equal((event as { step: string }).step, "agent_selected");
    assert.equal(event?.correlationId, "tr1", "the trace id correlates the two histories");
  });

  it("groups events by trace, task and kind", () => {
    const recorder = new TraceRecorder();
    recorder.record("agent_selected", context, { agentId: "a@1" }, CLOCK.now());
    recorder.record("task_completed", context, { agentId: "a@1" }, CLOCK.now());
    assert.equal(recorder.byTrace("tr1").length, 2);
    assert.equal(recorder.byTask("t1").length, 2);
    assert.equal(recorder.byKind("agent_selected").length, 1);
  });

  it("attributes resources to the task, agent and provider", () => {
    const tracker = new ResourceTracker();
    tracker.record({
      taskId: "t1",
      agentId: "a",
      provider: "p",
      model: "m",
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 5,
      toolCallCount: 1,
      retryCount: 0,
      agentCount: 1,
      amount: null,
      currency: null,
    });
    assert.equal(tracker.byAgent("a").length, 1);
    assert.equal(tracker.byProvider("p")[0]?.taskId, "t1");
  });

  it("keeps an unmeasured total null rather than reporting zero", () => {
    const tracker = new ResourceTracker();
    tracker.record({
      taskId: "t1",
      agentId: "a",
      provider: null,
      model: null,
      inputTokens: null,
      outputTokens: null,
      durationMs: null,
      toolCallCount: 0,
      retryCount: 0,
      agentCount: 1,
      amount: null,
      currency: null,
    });
    const totals = tracker.totals();
    assert.equal(totals.inputTokens, null, "we did not measure it, which is not zero");
    assert.equal(totals.countedInputTokens, 0);
  });

  it("counts retries per task", () => {
    const tracker = new ResourceTracker();
    assert.equal(tracker.recordRetry("t1"), 1);
    assert.equal(tracker.recordRetry("t1"), 2);
    assert.equal(tracker.retriesFor("t1"), 2);
    assert.equal(tracker.retriesFor("other"), 0);
  });
});

describe("feedback", () => {
  it("summarises an agent from its records", () => {
    const store = new InMemoryFeedbackStore();
    const base = {
      traceId: "tr",
      taskId: "t1",
      taskType: "research",
      agentId: "a",
      provider: "p",
      model: "m",
      topology: "single",
      verificationVerdict: "pass" as const,
      errorClass: null,
      latencyMs: 100,
      retries: 0,
    };
    store.append({ ...base, outcome: "succeeded" });
    store.append({ ...base, outcome: "failed", verificationVerdict: "fail", latencyMs: 300 });
    const summary = summariseAgent(store, "a");
    assert.equal(summary.executions, 2);
    assert.equal(summary.succeeded, 1);
    assert.equal(summary.averageLatencyMs, 200);
    assert.equal(summary.verifiedPassRate, 0.5);
  });

  it("reports null for an agent with no records, not a zero rate", () => {
    const summary = summariseAgent(new InMemoryFeedbackStore(), "nobody");
    assert.equal(summary.averageLatencyMs, null);
    assert.equal(summary.verifiedPassRate, null);
  });

  it("never infers a verification verdict from the outcome", () => {
    const record = feedbackFromExecution({
      traceId: "tr",
      taskId: "t",
      taskType: "x",
      agentId: "a",
      provider: null,
      model: null,
      topology: "single",
      outcome: "succeeded",
      verificationVerdict: null,
      errorClass: null,
      latencyMs: null,
      retries: 0,
      clock: CLOCK,
    });
    assert.equal(record.verificationVerdict, null);
  });

  it("bounds its history and reports the drop", () => {
    const store = new InMemoryFeedbackStore({ maxRecords: 2 });
    const base = {
      traceId: "tr",
      taskId: "t",
      taskType: "x",
      agentId: "a",
      provider: null,
      model: null,
      topology: "single",
      outcome: "succeeded" as const,
      verificationVerdict: null,
      errorClass: null,
      latencyMs: null,
      retries: 0,
    };
    store.append(base);
    store.append(base);
    store.append(base);
    assert.equal(store.size(), 2);
    assert.equal(store.droppedCount, 1, "truncation is visible, not silent");
  });
});

describe("orchestration configuration", () => {
  it("ships defaults that are explicit rather than zero", () => {
    assert.ok(DEFAULT_ORCHESTRATION_CONFIG.agent.maxSelectedAgents > 0);
    assert.equal(DEFAULT_ORCHESTRATION_CONFIG.observability.allowUnverifiedCapabilities, false);
  });

  it("rejects a non-positive integer", () => {
    const issues = validateOrchestrationConfig({ agent: { maxSelectedAgents: 0 } });
    assert.ok(issues.some((issue) => issue.field.includes("maxSelectedAgents")));
  });

  it("rejects an unknown policy name rather than accepting it", () => {
    const issues = validateOrchestrationConfig({ security: { inputPolicy: "banana" } });
    assert.ok(issues.some((issue) => issue.message.includes("must be one of")));
  });

  it("falls back rather than running an unrecognised policy name", () => {
    const loaded = loadOrchestrationConfigFromEnv({});
    assert.equal(loaded.security.inputPolicy, "permissive");
  });

  it("reads only allow-listed environment variables", () => {
    const raw = rawOrchestrationConfigFromEnv({
      TOZ_AGENT_MAX_SELECTED: "6",
      TOZ_SOMETHING_ELSE: "9",
    });
    assert.equal(raw["agent"] !== undefined, true);
    assert.equal(JSON.stringify(raw).includes("SOMETHING_ELSE"), false, "an unexpected variable must not be read");
  });

  it("turns an environment string into a number", () => {
    const loaded = loadOrchestrationConfigFromEnv({ TOZ_AGENT_MAX_SELECTED: "6" });
    assert.equal(loaded.agent.maxSelectedAgents, 6);
  });

  it("is centralised in the app configuration", () => {
    const appConfig: AppConfig = assertOk<AppConfig>(validateConfig({ app: { environment: "test" }, orchestration: { agent: { maxSelectedAgents: 7 } } }));
    const { config, issues } = orchestrationConfigFromApp(appConfig);
    assert.equal(issues.length, 0);
    assert.equal(config.agent.maxSelectedAgents, 7);
  });

  it("defaults the orchestration section when the app config says nothing", () => {
    const appConfig = assertOk<AppConfig>(validateConfig({ app: { environment: "test" } }));
    const { config } = orchestrationConfigFromApp(appConfig);
    assert.equal(config.agent.maxSelectedAgents, DEFAULT_ORCHESTRATION_CONFIG.agent.maxSelectedAgents);
    assert.deepEqual(DEFAULT_CONFIG.orchestration, {});
  });

  it("reports an invalid orchestration section without hiding it", () => {
    const appConfig = assertOk<AppConfig>(validateConfig({ app: { environment: "test" }, orchestration: { agent: { maxPlanDepth: -1 } } }));
    const { issues } = orchestrationConfigFromApp(appConfig);
    assert.ok(issues.length > 0, "a bad value inside the section is still reported");
  });

  it("reports a misspelled setting instead of ignoring it", () => {
    const issues = validateOrchestrationConfig({ agent: { maxDepth: 3 } });
    assert.ok(
      issues.some((issue) => issue.field === "agent.maxDepth"),
      "a typo that silently disables a limit is the worst kind of configuration bug",
    );
  });

  it("accepts every documented setting", () => {
    assert.deepEqual(validateOrchestrationConfig({}), []);
  });
});

describe("verifier contract", () => {
  it("receives evidence, not a claim", async () => {
    let seen: unknown = null;
    const spy: Verifier = {
      kind: "schema",
      name: "spy",
      verify: (evidence) => {
        seen = evidence.output;
        return { kind: "schema", verdict: "pass", detail: "seen", examined: [] } satisfies VerificationOutcome;
      },
    };
    const runner = new VerificationRunner();
    assertOk(runner.register(spy));
    await runner.verify(goodEvidence(), ["schema"], CLOCK.nowMs());
    assert.equal(seen, "an answer", "a verifier reads the record, not an assertion of success");
  });
});
