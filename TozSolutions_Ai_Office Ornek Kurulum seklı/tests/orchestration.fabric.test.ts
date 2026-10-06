/**
 * PHASE 04.1: team runtime retry and escalation, provider adapter boundary, tool
 * execution, learning signals, evidence provenance, model QA, configuration, and
 * the regression suite for the PHASE 04 defects.
 *
 * Uses readFileSync in one place, to assert a module-level import constraint that
 * the type system cannot express: that learning must never reach memory.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { CapabilitySet } from "../src/capabilities/capability.js";
import { UNKNOWN_HEALTH } from "../src/health/health.js";
import { type ErrorClass } from "../src/core/errors.js";
import { type ProviderAdapter, type ProviderRequest, type ProviderResponse } from "../src/providers/provider.js";
import { AgentRegistry, type RegisteredAgent } from "../src/orchestration/agent/registry.js";
import { CapabilityRegistry } from "../src/orchestration/capabilities/registry.js";
import { SpecialistPool, assessCandidate, computeRank } from "../src/orchestration/pool/specialistPool.js";
import { ProviderAdapterRegistry } from "../src/orchestration/provider/providerAdapterRegistry.js";
import { ToolRegistry, type ToolInvocationResult } from "../src/orchestration/tools/tool.js";
import { TextStatInvoker, ToolExecutionHost, type ToolCallEvidence } from "../src/orchestration/tools/invoker.js";
import { trustRank } from "../src/orchestration/agent/trust.js";
import { buildEvidence, mergeEvidence, provenanceOf } from "../src/orchestration/evidence/evidence.js";
import {
  ConsistencyQAVerifier,
  EvidenceIntegrityVerifier,
  VerificationRunner,
} from "../src/orchestration/verification/verifier.js";
import { FeedbackLearningSource, signalWeight } from "../src/orchestration/feedback/learningSignal.js";
import { InMemoryFeedbackStore, type FeedbackRecord, type FeedbackRecordInput } from "../src/orchestration/feedback/feedback.js";
import {
  TeamPlan,
  TeamRuntime,
  isEscalatingFailure,
  isRetryableSubtaskFailure,
  type SubtaskExecutor,
  type Team,
  type TeamResult,
} from "../src/orchestration/team/team.js";
import { type ExecutionPlan, type SubTask } from "../src/orchestration/task/plan.js";
import {
  DEFAULT_ORCHESTRATION_CONFIG,
  loadOrchestrationConfigFromEnv,
  orchestrationConfigFromApp,
  rawOrchestrationConfigFromEnv,
  validateOrchestrationConfig,
} from "../src/orchestration/index.js";
import { validateConfig } from "../src/config/validate.js";
import { type AppConfig } from "../src/config/schema.js";
import { assertOk } from "./contracts/contracts.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const CLOCK = new ManualClock(NOW);

function subtask(id: string, dependsOn: readonly string[] = [], maxRetries = 0): SubTask {
  return {
    taskId: id,
    parentTaskId: "root",
    objective: `Do ${id}`,
    requiredCapabilities: [],
    input: "in",
    expectedOutput: `out ${id}`,
    dependsOn,
    limits: { timeoutMs: 200, maxRetries, maxChildren: 0 },
    verificationKinds: [],
  };
}

function plan(subtasks: readonly SubTask[]): ExecutionPlan {
  return {
    planId: "plan-1",
    rootTaskId: "root",
    objective: "Objective",
    topology: "parallel",
    subtasks,
    limits: { timeoutMs: 5_000, maxRetries: 1, maxChildren: 0 },
    verificationKinds: [],
    terminalTaskId: subtasks[subtasks.length - 1]?.taskId ?? null,
  };
}

async function runPlan(subtasks: readonly SubTask[], executor: SubtaskExecutor, maxConcurrency = 4): Promise<TeamResult> {
  const execution = plan(subtasks);
  const team = assertOk<Team>(TeamPlan.choose(execution));
  return assertOk<TeamResult>(await new TeamRuntime({ executor, maxConcurrency }).run(team, execution, { traceId: "tr" }));
}

const failWith = (errorClass: ErrorClass) => ({ ok: false as const, error: { errorClass, message: `failed: ${errorClass}` } });
const alwaysFail = (errorClass: ErrorClass): SubtaskExecutor => async () => failWith(errorClass);
const succeed = (task: SubTask) => ({ ok: true as const, value: `out ${task.taskId}` });
const alwaysSucceed: SubtaskExecutor = async (task) => succeed(task);

/* ------------------------------------------------------------------ */
/* G. Team / swarm                                                     */
/* ------------------------------------------------------------------ */

describe("PHASE 04.1 G — team runtime executes every subtask", () => {
  it("runs a one-step plan", async () => {
    const executed: string[] = [];
    const result = await runPlan([subtask("a")], async (task) => {
      executed.push(task.taskId);
      return succeed(task);
    });
    assert.deepEqual(executed, ["a"]);
    assert.equal(result.status, "succeeded");
  });

  it("runs a two-step plan", async () => {
    const executed: string[] = [];
    const result = await runPlan([subtask("a"), subtask("b")], async (task) => {
      executed.push(task.taskId);
      return succeed(task);
    });
    assert.equal(executed.length, 2, "REGRESSION: a two-step plan must not run one step");
    assert.equal(result.outcomes.length, 2);
  });

  it("runs a five-step plan", async () => {
    const executed: string[] = [];
    const tasks = ["a", "b", "c", "d", "e"].map((id) => subtask(id));
    const result = await runPlan(tasks, async (task) => {
      executed.push(task.taskId);
      return succeed(task);
    });
    assert.equal(executed.length, 5, "REGRESSION: this is the defect that started PHASE 04.1");
    assert.equal(result.succeeded.length, 5);
    assert.equal(result.status, "succeeded");
  });

  it("runs independent subtasks concurrently when the topology allows it", async () => {
    let active = 0;
    let peak = 0;
    const tasks = ["a", "b", "c", "d"].map((id) => subtask(id));
    await runPlan(
      tasks,
      async (task) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return succeed(task);
      },
      4,
    );
    assert.ok(peak > 1, `expected concurrency, peak was ${peak}`);
  });

  it("respects dependency order", async () => {
    const executed: string[] = [];
    const result = await runPlan([subtask("a"), subtask("b", ["a"]), subtask("c", ["b"])], async (task) => {
      executed.push(task.taskId);
      return succeed(task);
    }, 1);
    assert.deepEqual(executed, ["a", "b", "c"]);
    assert.equal(result.status, "succeeded");
  });

  it("reports a fully successful multi-agent plan as succeeded", async () => {
    const result = await runPlan([subtask("a"), subtask("b"), subtask("c")], alwaysSucceed);
    assert.equal(result.status, "succeeded");
    assert.equal(result.reason, 'All 3 subtask(s) completed under topology "parallel"');
  });
});

describe("PHASE 04.1 G — retry, which the plan declared and the runtime ignored", () => {
  it("retries a transient failure within the plan's budget", async () => {
    let attempts = 0;
    const result = await runPlan([subtask("a", [], 2)], async (task) => {
      attempts += 1;
      if (attempts < 3) {
        return { ok: false as const, error: { errorClass: "transient_provider_failure", message: "flaky" } };
      }
      return succeed(task);
    });
    assert.equal(attempts, 3, "two retries plus the first attempt");
    assert.equal(result.status, "succeeded", "a retried subtask can still succeed");
  });

  it("reports the attempt count on the outcome", async () => {
    let attempts = 0;
    const result = await runPlan([subtask("a", [], 1)], async (task) => {
      attempts += 1;
      if (attempts === 1) {
        return { ok: false as const, error: { errorClass: "timeout", message: "slow" } };
      }
      return succeed(task);
    });
    assert.equal(result.outcomes[0]?.attempts, 2);
  });

  it("never exceeds the declared retry budget", async () => {
    let attempts = 0;
    await runPlan([subtask("a", [], 1)], async () => {
      attempts += 1;
      return { ok: false as const, error: { errorClass: "temporary_outage", message: "down" } };
    });
    assert.equal(attempts, 2, "one retry, not two");
  });

  it("does not retry when the plan allows no retries", async () => {
    let attempts = 0;
    await runPlan([subtask("a", [], 0)], async () => {
      attempts += 1;
      return { ok: false as const, error: { errorClass: "timeout", message: "slow" } };
    });
    assert.equal(attempts, 1);
  });

  it("does not retry a permanent failure", async () => {
    let attempts = 0;
    await runPlan([subtask("a", [], 3)], async () => {
      attempts += 1;
      return { ok: false as const, error: { errorClass: "invalid_request", message: "bad" } };
    });
    assert.equal(attempts, 1, "retrying a permanent refusal is three times the cost for the same answer");
  });

  it("retries a rate limit, which is transient and worth waiting out", async () => {
    let attempts = 0;
    const result = await runPlan([subtask("a", [], 1)], async (task) => {
      attempts += 1;
      if (attempts === 1) {
        return { ok: false as const, error: { errorClass: "rate_limit", message: "slow down" } };
      }
      return succeed(task);
    });
    assert.equal(attempts, 2);
    assert.equal(result.status, "succeeded");
  });

  it("classifies retryable and escalating failures distinctly", () => {
    assert.equal(isRetryableSubtaskFailure("timeout"), true);
    assert.equal(isRetryableSubtaskFailure("rate_limit"), true);
    assert.equal(isRetryableSubtaskFailure("temporary_outage"), true);
    assert.equal(isRetryableSubtaskFailure("invalid_request"), false);
    assert.equal(isEscalatingFailure("authentication_failure"), true);
    assert.equal(isEscalatingFailure("quota_exhausted"), true);
    assert.equal(isEscalatingFailure("invalid_model"), true);
    assert.equal(isEscalatingFailure("timeout"), false, "a timeout is not a reason to wake a human");
  });

  it("emits a retry event, so a retry is observable", async () => {
    const events: string[] = [];
    const execution = plan([subtask("a", [], 1)]);
    const team = assertOk<Team>(TeamPlan.choose(execution));
    let attempts = 0;
    await new TeamRuntime({
      executor: async (task) => {
        attempts += 1;
        return attempts === 1
          ? { ok: false as const, error: { errorClass: "timeout", message: "slow" } }
          : succeed(task);
      },
      onEvent: (event) => events.push(event.kind),
    }).run(team, execution, { traceId: "tr" });
    assert.ok(events.includes("subtask_retried"), "a silent retry is indistinguishable from a slow call");
  });

  it("reports the attempt number on each event", async () => {
    const attempts: Array<{ kind: string; attempt: number }> = [];
    const execution = plan([subtask("a", [], 2)]);
    const team = assertOk<Team>(TeamPlan.choose(execution));
    await new TeamRuntime({
      executor: alwaysFail("timeout"),
      onEvent: (event) => attempts.push({ kind: event.kind, attempt: event.attempt }),
    }).run(team, execution, { traceId: "tr" });
    // One start plus one event per retry, and the terminal failure repeats the
    // attempt it ended on - so the attempts are visible on every event, not
    // only on the ones that started something.
    assert.deepEqual(
      attempts.map((event) => `${event.kind}:${event.attempt}`),
      [
        "subtask_started:1",
        "subtask_retried:2",
        "subtask_retried:3",
        "subtask_failed:3",
      ],
    );
  });
});

describe("PHASE 04.1 G — escalation", () => {
  it("escalates an authentication failure rather than retrying it", async () => {
    const result = await runPlan([subtask("a", [], 3)], alwaysFail("authentication_failure"));
    assert.equal(result.status, "escalated");
    assert.deepEqual(result.escalated, ["a"]);
  });

  it("escalates an exhausted quota", async () => {
    const result = await runPlan([subtask("a")], alwaysFail("quota_exhausted"));
    assert.equal(result.status, "escalated");
  });

  it("does not escalate a configuration failure, which PHASE 04 reports as failed", async () => {
    const result = await runPlan([subtask("a")], alwaysFail("configuration_error"));
    assert.equal(result.status, "failed", "REGRESSION: a configuration refusal must stay a failure");
  });

  it("emits a distinct escalation event", async () => {
    const events: string[] = [];
    const execution = plan([subtask("a")]);
    const team = assertOk<Team>(TeamPlan.choose(execution));
    await new TeamRuntime({
      executor: alwaysFail("authentication_failure"),
      onEvent: (event) => events.push(event.kind),
    }).run(team, execution, { traceId: "tr" });
    assert.ok(events.includes("subtask_escalated"));
    assert.ok(!events.includes("subtask_failed"));
  });

  it("skips the dependents of an escalated subtask", async () => {
    const executed: string[] = [];
    const result = await runPlan([subtask("a"), subtask("b", ["a"])], async (task) => {
      executed.push(task.taskId);
      return failWith("authentication_failure");
    });
    assert.deepEqual([...new Set(executed)], ["a"]);
    assert.equal(result.outcomes.find((outcome) => outcome.taskId === "b")?.status, "skipped");
  });

  it("reports the reason on the escalated outcome", async () => {
    const result = await runPlan([subtask("a")], alwaysFail("authentication_failure"));
    assert.match(result.outcomes[0]?.message ?? "", /authentication_failure/);
  });
});

/* ------------------------------------------------------------------ */
/* F. Provider / model                                                  */
/* ------------------------------------------------------------------ */

/** A test double. Labelled as such; it is not a provider client. */
class TestProviderAdapter implements ProviderAdapter {
  public readonly providerId: string;
  public calls = 0;

  public constructor(providerId: string) {
    this.providerId = providerId;
  }

  public classifyError(): ErrorClass {
    return "unknown";
  }

  public execute(_request: ProviderRequest): Promise<ProviderResponse> {
    this.calls += 1;
    return Promise.resolve({
      text: "text",
      providerId: this.providerId,
      modelId: "m",
      latencyMs: 1,
      raw: {},
    });
  }
}

describe("PHASE 04.1 F — provider adapter registry", () => {
  it("registers an adapter", () => {
    const registry = new ProviderAdapterRegistry();
    assertOk(registry.register(new TestProviderAdapter("acme")));
    assert.equal(registry.has("acme"), true);
  });

  it("rejects a duplicate rather than replacing, so past decisions keep their meaning", () => {
    const registry = new ProviderAdapterRegistry();
    assertOk(registry.register(new TestProviderAdapter("acme")));
    const second = registry.register(new TestProviderAdapter("acme"));
    assert.equal(second.ok, false);
  });

  it("rejects a malformed provider id", () => {
    const registry = new ProviderAdapterRegistry();
    assert.equal(registry.register(new TestProviderAdapter("has space")).ok, false);
  });

  it("reports an unknown provider with a reason", () => {
    const registry = new ProviderAdapterRegistry();
    const required = registry.require("ghost");
    assert.equal(required.ok, false);
    assert.match(required.ok ? "" : required.error.message, /No provider adapter is registered/);
  });

  it("contains no provider client, because none is integrated", () => {
    const registry = new ProviderAdapterRegistry();
    assert.deepEqual(registry.ids(), [], "the registry ships empty; no credential is ever required");
  });
});

/* ------------------------------------------------------------------ */
/* L. MCP / tools                                                       */
/* ------------------------------------------------------------------ */

function toolRegistry(): ToolRegistry {
  const registry = new ToolRegistry({ clock: CLOCK });
  assertOk(registry.register({ toolId: "text_stat", kind: "local", description: "Measures text" }));
  assertOk(
    registry.register({
      toolId: "shell_exec",
      kind: "sandboxed",
      description: "Runs a command",
      sideEffecting: true,
      minimumTrust: "privileged",
    }),
  );
  return registry;
}

const caller = { subject: "agent:a", trustLevel: "high" as const };

describe("PHASE 04.1 L — tool execution", () => {
  it("authorises a tool the agent declared and policy permits", () => {
    const host = new ToolExecutionHost({ registry: toolRegistry(), invokers: { text_stat: new TextStatInvoker() } });
    const authorised = host.authorisedToolIds(["text_stat"], caller, trustRank);
    assert.deepEqual(authorised, ["text_stat"]);
  });

  it("does not grant an undeclared tool, even when it is available and permitted", () => {
    const host = new ToolExecutionHost({ registry: toolRegistry(), invokers: { text_stat: new TextStatInvoker() } });
    // The agent never declared `text_stat`, so it is not offered at all.
    assert.deepEqual(host.authorisedToolIds([], caller, trustRank), [], "tools are not granted by default");
    assert.deepEqual(host.authorisedToolIds(["shell_exec"], caller, trustRank), []);
  });

  it("refuses a tool the caller lacks trust for", () => {
    const host = new ToolExecutionHost({ registry: toolRegistry(), invokers: {} });
    const result = host.invoke({ toolId: "shell_exec", subject: "x", input: null }, { subject: "u", trustLevel: "low" }, trustRank);
    return result.then((decision) => {
      assert.equal(decision.ok, false);
      assert.equal(decision.ok ? null : decision.error.reason.match(/requires trust "privileged"/) !== null, true);
    });
  });

  it("refuses a tool the caller is explicitly denied", async () => {
    const host = new ToolExecutionHost({ registry: toolRegistry(), invokers: { text_stat: new TextStatInvoker() } });
    const result = await host.invoke(
      { toolId: "text_stat", subject: "x", input: { text: "hi" } },
      { subject: "u", trustLevel: "privileged", denied: ["text_stat"] },
      trustRank,
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.refused, true, "a refusal is distinguishable from a failure");
  });

  it("refuses a side-effecting tool that needs approval", async () => {
    const host = new ToolExecutionHost({ registry: toolRegistry(), invokers: {} });
    const result = await host.invoke(
      { toolId: "shell_exec", subject: "x", input: null },
      { subject: "u", trustLevel: "privileged", requiresApprovalForSideEffects: true },
      trustRank,
    );
    assert.equal(result.ok, false);
  });

  it("executes an authorised tool and returns evidence of the call", async () => {
    const host = new ToolExecutionHost({ registry: toolRegistry(), invokers: { text_stat: new TextStatInvoker() } });
    const evidence = assertOk<ToolCallEvidence>(
      await host.invoke({ toolId: "text_stat", subject: "x", input: { text: "one two three" } }, caller, trustRank),
    );
    assert.equal(evidence.call.toolId, "text_stat");
    assert.equal(evidence.call.sideEffecting, false);
    assert.deepEqual(evidence.output, { characters: 13, words: 3, lines: 1 });
  });

  it("records the tool's own side-effect declaration in the evidence", async () => {
    const registry = toolRegistry();
    const invoker = {
      name: "sandboxed",
      invoke: () =>
        Promise.resolve(
          { ok: true as const, value: { toolId: "shell_exec", output: null, durationMs: 2, sideEffects: ["wrote /tmp/x"] } },
        ),
    };
    const host = new ToolExecutionHost({ registry, invokers: { shell_exec: invoker } });
    const evidence = assertOk<ToolCallEvidence>(
      await host.invoke({ toolId: "shell_exec", subject: "x", input: null }, { subject: "u", trustLevel: "privileged" }, trustRank),
    );
    assert.equal(evidence.call.sideEffecting, true);
    assert.deepEqual(evidence.sideEffects, ["wrote /tmp/x"]);
  });

  it("reports a registered tool with no invoker as a configuration failure", async () => {
    const host = new ToolExecutionHost({ registry: toolRegistry(), invokers: {} });
    const result = await host.invoke({ toolId: "text_stat", subject: "x", input: { text: "hi" } }, caller, trustRank);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error.reason, /has no invoker/);
  });

  it("reports a failing invoker without throwing", async () => {
    const invoker = {
      name: "broken",
      invoke: () => Promise.reject(new Error("exploded")),
    };
    const host = new ToolExecutionHost({ registry: toolRegistry(), invokers: { text_stat: invoker } });
    const result = await host.invoke({ toolId: "text_stat", subject: "x", input: { text: "hi" } }, caller, trustRank);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error.reason, /exploded/);
  });

  it("reports an invoker that returns a validation error", async () => {
    const host = new ToolExecutionHost({ registry: toolRegistry(), invokers: { text_stat: new TextStatInvoker() } });
    const result = await host.invoke({ toolId: "text_stat", subject: "x", input: { wrong: true } }, caller, trustRank);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error.reason, /requires an object with a string "text"/);
  });

  it("rejects input the reference invoker cannot use", async () => {
    const result = await new TextStatInvoker().invoke({
      toolId: "text_stat",
      subject: "u",
      input: null,
      timeoutMs: 10,
    });
    assert.equal(result.ok, false);
  });

  it("counts nothing as a side effect that declares none", async () => {
    const result = assertOk<ToolInvocationResult>(
      await new TextStatInvoker().invoke({ toolId: "text_stat", subject: "u", input: { text: "" }, timeoutMs: 10 }),
    );
    assert.deepEqual(result.sideEffects, []);
    assert.deepEqual(result.output, { characters: 0, words: 0, lines: 0 });
  });
});

/* ------------------------------------------------------------------ */
/* I. Learning                                                          */
/* ------------------------------------------------------------------ */

function feedbackRecord(overrides: Partial<FeedbackRecord>): FeedbackRecordInput {
  return {
    traceId: "tr",
    taskId: "t",
    taskType: "research",
    agentId: "a",
    agentVersion: null,
    provider: null,
    model: null,
    topology: "single",
    outcome: "succeeded",
    verificationVerdict: null,
    errorClass: null,
    latencyMs: 10,
    inputTokens: null,
    outputTokens: null,
    retries: 0,
    humanCorrection: null,
    ...overrides,
  };
}

describe("PHASE 04.1 I — learning signals", () => {
  it("produces nothing unless enabled", () => {
    const store = new InMemoryFeedbackStore();
    for (let i = 0; i < 10; i += 1) store.append(feedbackRecord({}));
    const source = new FeedbackLearningSource(store);
    assert.equal(source.signalFor("a"), null);
  });

  it("produces a signal once enabled and past the sample threshold", () => {
    const store = new InMemoryFeedbackStore();
    for (let i = 0; i < 5; i += 1) store.append(feedbackRecord({ verificationVerdict: "pass" }));
    const source = new FeedbackLearningSource(store, { enabled: true });
    const signal = source.signalFor("a");
    assert.equal(signal?.samples, 5);
    assert.equal(signal?.successRate, 1);
  });

  it("produces nothing below the sample threshold, because one run is not a signal", () => {
    const store = new InMemoryFeedbackStore();
    store.append(feedbackRecord({}));
    store.append(feedbackRecord({}));
    const source = new FeedbackLearningSource(store, { enabled: true, minimumSamples: 5 });
    assert.equal(source.signalFor("a"), null);
  });

  it("produces nothing for an agent with no history", () => {
    const source = new FeedbackLearningSource(new InMemoryFeedbackStore(), { enabled: true });
    assert.equal(source.signalFor("nobody"), null);
  });

  it("reports a null verified rate when nothing was verified", () => {
    const store = new InMemoryFeedbackStore();
    for (let i = 0; i < 6; i += 1) store.append(feedbackRecord({}));
    const signal = new FeedbackLearningSource(store, { enabled: true }).signalFor("a");
    assert.equal(signal?.verifiedPassRate, null, "unverified is not the same as failed");
  });

  it("never reads memory: the module does not import it", () => {
    // Structural, and enforced by reading the source rather than by a comment.
    // A learning signal derived from a memory read would be a claim about the
    // world mistaken for a claim about our own performance, and the cheapest
    // way to guarantee that never happens is for the file to be unable to.
    const source = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "orchestration", "feedback", "learningSignal.ts"),
      "utf8",
    );
    assert.equal(
      /from\s+"[^"]*memory[^"]*"/.test(source),
      false,
      "learningSignal.ts must not import the memory module",
    );
    assert.match(source, /from "\.\/feedback\.js"/, "it reads outcome records, and only those");
  });

  it("weights a signal so that it can only break a tie", () => {
    const strong = { agentId: "a", samples: 100, successRate: 1, verifiedPassRate: 1 };
    const weak = { agentId: "b", samples: 100, successRate: 0, verifiedPassRate: 0 };
    assert.ok(signalWeight(strong) > signalWeight(weak));
    assert.equal(signalWeight(null), 0, "no signal contributes nothing rather than a default");
  });

  it("is smaller than any difference between recorded facts", () => {
    const agent = {
      agentId: "a",
      name: "a",
      version: "1",
      status: "active" as const,
      type: "specialist" as const,
      capabilities: CapabilitySet.supporting("source_verification"),
      specializations: [],
      providerRequirements: [],
      toolRequirements: [],
      memoryScopes: [],
      trustLevel: "standard" as const,
      costClass: "standard" as const,
      latencyClass: "standard" as const,
      measuredLatencyMs: null,
      executionMode: "in_process" as const,
      inputContract: { description: "", accepts: [], produces: [], strict: false },
      outputContract: { description: "", accepts: [], produces: [], strict: false },
      verificationRequirements: [],
      health: UNKNOWN_HEALTH,
      adapter: "x",
      source: { kind: "native" as const, ref: null },
      requiresModelRoute: true,
      createdAt: NOW,
      updatedAt: NOW,
      metadata: {},
    };
    const match = { verdict: "compatible" as const, gaps: [], satisfied: ["source_verification"] };
    const withSignal = computeRank(agent, match, { agentId: "a", samples: 99, successRate: 1, verifiedPassRate: 1 });
    const without = computeRank(agent, match);
    // A trust-class step is 10,000; the learning term must be far below it.
    assert.ok(withSignal - without < 1_000, "a signal must not be able to outweigh a recorded fact");
  });

  it("can never make an ineligible agent eligible", () => {
    const disabled = {
      agentId: "a",
      name: "a",
      version: "1",
      status: "disabled" as const,
      type: "specialist" as const,
      capabilities: CapabilitySet.supporting("source_verification"),
      specializations: [],
      providerRequirements: [],
      toolRequirements: [],
      memoryScopes: [],
      trustLevel: "privileged" as const,
      costClass: "free" as const,
      latencyClass: "realtime" as const,
      measuredLatencyMs: 0,
      executionMode: "in_process" as const,
      inputContract: { description: "", accepts: [], produces: [], strict: false },
      outputContract: { description: "", accepts: [], produces: [], strict: false },
      verificationRequirements: [],
      health: { ...UNKNOWN_HEALTH, status: "healthy" as const, observedAt: NOW },
      adapter: "x",
      source: { kind: "native" as const, ref: null },
      requiresModelRoute: true,
      createdAt: NOW,
      updatedAt: NOW,
      metadata: {},
    };
    const assessment = assessCandidate(
      disabled,
      "available",
      {
        taskId: "t",
        requiredCapabilities: ["source_verification"],
        minimumTrust: "low",
        learningSignals: new Map([
          [
            "a@1",
            { agentId: "a", samples: 500, successRate: 1, verifiedPassRate: 1 },
          ],
        ]),
      },
      { providerIds: () => [], availableTools: () => [], grantedMemoryScopes: () => [] },
    );
    assert.equal(assessment.eligible, false, "a perfect record does not resurrect a disabled agent");
    assert.ok(assessment.rejections.includes("agent_disabled"));
  });
});

/* ------------------------------------------------------------------ */
/* J. Evidence provenance                                               */
/* ------------------------------------------------------------------ */

describe("PHASE 04.1 J — evidence provenance", () => {
  it("identifies the trace, task, agent and attempt", () => {
    const evidence = buildEvidence({
      taskId: "sub-1",
      traceId: "tr-1",
      agentId: "a",
      agentVersion: "1.0.0",
      output: "x",
      status: "succeeded",
      attempt: 2,
      sequence: 7,
      startedAt: 1,
      finishedAt: 2,
    });
    const provenance = provenanceOf(evidence);
    assert.equal(provenance.traceId, "tr-1");
    assert.equal(provenance.subtaskId, "sub-1");
    assert.equal(provenance.agentKey, "a@1.0.0");
    assert.equal(provenance.attempt, 2);
    assert.equal(provenance.sequence, 7);
  });

  it("defaults to the first attempt and sequence zero", () => {
    const provenance = provenanceOf(
      buildEvidence({ taskId: "t", traceId: "tr", output: "x", status: "succeeded", startedAt: 0, finishedAt: 1 }),
    );
    assert.equal(provenance.attempt, 1);
    assert.equal(provenance.sequence, 0);
  });

  it("distinguishes two attempts of one subtask", () => {
    const base = { taskId: "sub-1", traceId: "tr", output: "x", status: "succeeded" as const, startedAt: 0, finishedAt: 1 };
    const first = buildEvidence({ ...base, attempt: 1, sequence: 1 });
    const second = buildEvidence({ ...base, attempt: 2, sequence: 2 });
    assert.notDeepEqual(provenanceOf(first), provenanceOf(second));
  });

  it("keeps the merged record's sequence at the highest seen", () => {
    const a = buildEvidence({ taskId: "a", traceId: "tr", output: "x", status: "succeeded", sequence: 1, startedAt: 0, finishedAt: 1 });
    const b = buildEvidence({ taskId: "b", traceId: "tr", output: "y", status: "succeeded", sequence: 5, startedAt: 1, finishedAt: 2 });
    const merged = mergeEvidence([a, b], { taskId: "t", traceId: "tr", output: "y", finishedAt: 3 });
    assert.equal(merged.provenance.sequence, 5);
  });

  it("never attributes a merged record to a subtask that did not run", () => {
    const merged = mergeEvidence(
      [
        buildEvidence({ taskId: "a", traceId: "tr", output: "x", status: "succeeded", startedAt: 0, finishedAt: 1 }),
        buildEvidence({ taskId: "b", traceId: "tr", output: "y", status: "succeeded", startedAt: 1, finishedAt: 2 }),
      ],
      { taskId: "task", traceId: "tr", output: "y", finishedAt: 3 },
    );
    assert.equal(merged.provenance.subtaskId, "task", "the merged record is the task's, not a subtask's");
  });
});

/* ------------------------------------------------------------------ */
/* K. Model QA                                                          */
/* ------------------------------------------------------------------ */

describe("PHASE 04.1 K — model QA (consistency)", () => {
  const verifier = new ConsistencyQAVerifier();

  it("passes an output with no unsupported citation", () => {
    const outcome = verifier.verify(
      buildEvidence({
        taskId: "t",
        traceId: "tr",
        agentId: "a",
        output: "The answer is 42.",
        sources: [{ reference: "https://example.test/doc", excerpt: "42", retrievedAt: 1 }],
        status: "succeeded",
        startedAt: 0,
        finishedAt: 1,
      }),
    );
    assert.equal(outcome.verdict, "pass");
  });

  it("fails an output that cites a source the evidence does not hold", () => {
    const outcome = verifier.verify(
      buildEvidence({
        taskId: "t",
        traceId: "tr",
        agentId: "a",
        output: "Per https://fabricated.test/x the answer is 42.",
        sources: [{ reference: "https://example.test/doc", excerpt: "42", retrievedAt: 1 }],
        status: "succeeded",
        startedAt: 0,
        finishedAt: 1,
      }),
    );
    assert.equal(outcome.verdict, "fail");
    assert.match(outcome.detail, /fabricated\.test/);
  });

  it("fails an output that cites anything while the evidence records no source", () => {
    const outcome = verifier.verify(
      buildEvidence({
        taskId: "t",
        traceId: "tr",
        agentId: "a",
        output: "See https://example.test/x for details.",
        status: "succeeded",
        startedAt: 0,
        finishedAt: 1,
      }),
    );
    assert.equal(outcome.verdict, "fail");
  });

  it("fails an empty output rather than passing it", () => {
    const outcome = verifier.verify(
      buildEvidence({ taskId: "t", traceId: "tr", agentId: "a", output: "   ", status: "succeeded", startedAt: 0, finishedAt: 1 }),
    );
    assert.equal(outcome.verdict, "fail");
  });

  it("notes hedged language, because a hedge is not a verified claim", () => {
    const outcome = verifier.verify(
      buildEvidence({
        taskId: "t",
        traceId: "tr",
        agentId: "a",
        output: "This may be 42.",
        status: "succeeded",
        startedAt: 0,
        finishedAt: 1,
      }),
    );
    assert.match(outcome.detail, /hedged language/);
  });

  it("runs as a verification kind, so it can gate completion", async () => {
    const runner = new VerificationRunner();
    assertOk(runner.register(verifier));
    const result = await runner.verify(
      buildEvidence({
        taskId: "t",
        traceId: "tr",
        agentId: "a",
        output: "The answer is 42.",
        sources: [{ reference: "https://example.test/doc", excerpt: "42", retrievedAt: 1 }],
        status: "succeeded",
        startedAt: 0,
        finishedAt: 1,
      }),
      ["consistency"],
      0,
    );
    assert.equal(result.verdict, "pass");
  });

  it("does not displace the integrity verifier", () => {
    assert.equal(new EvidenceIntegrityVerifier().kind, "evidence");
    assert.equal(verifier.kind, "consistency");
  });
});

/* ------------------------------------------------------------------ */
/* N. Configuration                                                     */
/* ------------------------------------------------------------------ */

describe("PHASE 04.1 N — configuration", () => {
  it("ships every PHASE 04.1 feature switched off", () => {
    assert.deepEqual(DEFAULT_ORCHESTRATION_CONFIG.agents.enabledSources, []);
    assert.equal(DEFAULT_ORCHESTRATION_CONFIG.agents.autoPromote, false);
    assert.equal(DEFAULT_ORCHESTRATION_CONFIG.ruflo.enabled, false);
    assert.equal(DEFAULT_ORCHESTRATION_CONFIG.learning.enabled, false);
    // PHASE 08: `tools.grantUndeclaredTools` used to be asserted here as `false`.
    //
    // The field is GONE, and this assertion was changed rather than deleted, so the change
    // is visible rather than silent. It was declared as "When false, an agent may call only
    // the tools it declared" and read NOWHERE - the boundary it named is unconditional in
    // `ToolExecutionHost.verifyReported`. Shipping the switch would have let anyone who can
    // edit an environment variable widen an authority boundary, with no approval, no audit
    // and no operator identity to attribute it to, while B-05 (whose string may assert what)
    // is still open. `DECISIONS.md` D-53: a declared-but-unreachable name is removed or
    // implemented. `tests/agentSurface.p08-evidence.test.ts` now asserts it stays gone.
    assert.equal(
      "grantUndeclaredTools" in DEFAULT_ORCHESTRATION_CONFIG.tools,
      false,
      "the declared-tool boundary is not a configuration switch",
    );
  });

  it("accepts an empty configuration", () => {
    assert.deepEqual(validateOrchestrationConfig({}), []);
  });

  it("accepts every documented PHASE 04.1 setting", () => {
    assert.deepEqual(
      validateOrchestrationConfig({
        agents: { enabledSources: ["agency"], maximumExternalTrust: "low", autoPromote: true },
        ruflo: { enabled: true },
        // PHASE 08: `grantUndeclaredTools: true` removed from this list with the field.
        tools: { defaultTimeoutMs: 5_000 },
        learning: { enabled: true, minimumSamples: 10 },
      }),
      [],
    );
  });

  it("rejects a misspelled PHASE 04.1 setting rather than ignoring it", () => {
    const issues = validateOrchestrationConfig({ ruflo: { enable: true } });
    assert.ok(issues.some((issue) => issue.field === "ruflo.enable"));
  });

  it("rejects an unrecognised trust ceiling", () => {
    const issues = validateOrchestrationConfig({ agents: { maximumExternalTrust: "wizard" } });
    assert.ok(issues.some((issue) => issue.field.includes("maximumExternalTrust")));
  });

  it("rejects a source list that is not strings", () => {
    const issues = validateOrchestrationConfig({ agents: { enabledSources: [1, 2] } });
    assert.ok(issues.some((issue) => issue.field.includes("enabledSources")));
  });

  it("rejects a learning threshold of one, which would be superstition", () => {
    const issues = validateOrchestrationConfig({ learning: { enabled: true, minimumSamples: 1 } });
    assert.ok(issues.some((issue) => issue.field === "learning.minimumSamples"));
  });

  it("reads the PHASE 04.1 settings from the environment allow-list", () => {
    const loaded = loadOrchestrationConfigFromEnv({
      TOZ_AGENT_SOURCES: "alpha, beta",
      TOZ_RUFLO_ENABLED: "true",
      TOZ_TOOL_TIMEOUT_MS: "9000",
      TOZ_LEARNING_ENABLED: "true",
      TOZ_LEARNING_MIN_SAMPLES: "20",
    });
    assert.deepEqual(loaded.agents.enabledSources, ["alpha", "beta"]);
    assert.equal(loaded.ruflo.enabled, true);
    assert.equal(loaded.tools.defaultTimeoutMs, 9_000);
    assert.equal(loaded.learning.enabled, true);
    assert.equal(loaded.learning.minimumSamples, 20);
  });

  it("reads the PHASE 05 memory settings from the environment allow-list", () => {
    const loaded = loadOrchestrationConfigFromEnv({
      TOZ_MEMORY_RECALL_SCOPES: "project, knowledge",
      TOZ_MEMORY_RECALL_LIMIT: "7",
      TOZ_MEMORY_MIN_IMPORTANCE: "0.5",
      TOZ_MEMORY_RECORD_LEARNING: "true",
    });
    // Naming a scope is what permits the orchestrator to read it, so this list is
    // an authority grant made in configuration and is held to the same standard.
    assert.deepEqual(loaded.memory.recallScopes, ["project", "knowledge"]);
    assert.equal(loaded.memory.recallLimit, 7);
    assert.equal(loaded.memory.minimumImportance, 0.5);
    assert.equal(loaded.memory.recordLearning, true);
  });

  it("recalls from nothing until a scope is named", () => {
    // The dangerous default is "everything readable". An unset list therefore has
    // to mean NO recall, and a test that asserted a sensible-looking default here
    // would be asserting the leak.
    const loaded = loadOrchestrationConfigFromEnv({});
    assert.deepEqual(loaded.memory.recallScopes, []);
  });

  it("rejects a recall scope that is not a real scope", () => {
    // A typo in an authority grant must fail loudly, not silently recall nothing
    // while looking configured.
    const issues = validateOrchestrationConfig({ memory: { recallScopes: ["nowhere"] } });
    assert.ok(
      issues.some((issue) => issue.field === "memory.recallScopes"),
      `a scope that does not exist must be reported. Issues: ${JSON.stringify(issues)}`,
    );
  });

  it("reads the PHASE 06 routing settings from the environment allow-list", () => {
    const loaded = loadOrchestrationConfigFromEnv({
      TOZ_ROUTING_POLICY: "latency-sensitive",
      TOZ_ROUTING_MAX_FALLBACK_HOPS: "2",
      TOZ_ROUTING_FALLBACK_COOLDOWN_MS: "30000",
      TOZ_ROUTING_ALLOW_UNPROTECTED: "false",
    });
    assert.equal(loaded.routing.defaultPolicy, "latency-sensitive");
    assert.equal(loaded.routing.maxFallbackHops, 2);
    assert.equal(loaded.routing.fallbackCooldownMs, 30_000);
    assert.equal(loaded.routing.allowUnprotectedRoutes, false);
  });

  it("bounds fallback and enables the loop guard by default", () => {
    // Both are on by default deliberately. An unbounded chain spends a latency
    // budget nobody agreed to, and without cooldown a failed target is
    // re-selected and the system loops until something else breaks.
    const loaded = loadOrchestrationConfigFromEnv({});
    assert.equal(loaded.routing.defaultPolicy, "capability-first");
    assert.ok(loaded.routing.maxFallbackHops >= 1);
    assert.ok(loaded.routing.maxFallbackHops <= 10, "a default chain should be short");
    assert.ok(loaded.routing.fallbackCooldownMs > 0, "the loop guard is a default, not an opt-in");
  });

  it("rejects a routing policy that does not exist", () => {
    // The failure this prevents: a typo surviving to runtime, where it would
    // look like "routing is broken" on every request rather than "the config
    // named a policy that does not exist".
    const issues = validateOrchestrationConfig({ routing: { defaultPolicy: "cheapest-please" } });
    assert.ok(
      issues.some((issue) => issue.field === "routing.defaultPolicy"),
      `a policy that does not exist must be named. Issues: ${JSON.stringify(issues)}`,
    );
  });

  it("rejects a fallback chain that could never route anything", () => {
    const issues = validateOrchestrationConfig({ routing: { maxFallbackHops: 0 } });
    assert.ok(issues.some((issue) => issue.field === "routing.maxFallbackHops"));
  });

  it("names the policies it will accept", () => {
    const issues = validateOrchestrationConfig({ routing: { defaultPolicy: "nope" } });
    const issue = issues.find((entry) => entry.field === "routing.defaultPolicy");
    assert.match(issue?.message ?? "", /capability-first/);
    assert.match(issue?.message ?? "", /latency-sensitive/);
  });

  it("accepts the routing section as a known section", () => {
    // Regression, found by running the validation CLI rather than by a unit test.
    // The unit tests only asserted that a BAD policy was reported, so they passed
    // while the section itself was rejected as an unknown setting - which made
    // every routing value unreachable in a real deployment.
    const issues = validateOrchestrationConfig({ routing: { defaultPolicy: "cost-sensitive" } });
    assert.deepEqual(issues, [], `a valid routing section must produce no issues. Got: ${JSON.stringify(issues)}`);
  });

  it("reports a bad policy without also complaining the section is unknown", () => {
    const issues = validateOrchestrationConfig({ routing: { defaultPolicy: "nope" } });
    assert.equal(issues.length, 1, "exactly one problem: the policy, not the section");
    assert.equal(issues[0]?.field, "routing.defaultPolicy");
  });

  it("still rejects a genuinely unknown setting inside the routing section", () => {
    const issues = validateOrchestrationConfig({ routing: { nonsense: 1 } });
    assert.ok(issues.some((issue) => issue.field === "routing.nonsense"));
  });

  it("reads the PHASE 08 governance settings from the environment allow-list", () => {
    const loaded = loadOrchestrationConfigFromEnv({
      TOZ_GOVERNANCE_ENFORCED: "false",
      TOZ_GOVERNANCE_BLOCK_ON_UNKNOWN_COST: "true",
      TOZ_GOVERNANCE_APPROVAL_REQUIRED: "approval.resolve, admin.configure",
      TOZ_GOVERNANCE_DEFER_TO_SUBSYSTEM: "memory.read",
      TOZ_GOVERNANCE_MAX_CONCURRENT: "8",
      TOZ_GOVERNANCE_MAX_ATTEMPTS_PER_ACTOR: "5",
    });
    assert.equal(loaded.governance.enforced, false, "a deployment may make governance advisory, but it must say so");
    assert.equal(loaded.governance.blockOnUnknownCost, true);
    assert.deepEqual(loaded.governance.approvalRequired, ["approval.resolve", "admin.configure"]);
    assert.deepEqual(loaded.governance.deferToSubsystem, ["memory.read"]);
    assert.equal(loaded.governance.maxConcurrent, 8);
    assert.equal(loaded.governance.maxAttemptsPerActor, 5);
  });

  it("ships governance enforced, with a cost budget that cannot be read as zero", () => {
    // A control plane that ships advisory is not a control plane, and an unknown
    // cost read as zero makes a budget that can never fail.
    const loaded = loadOrchestrationConfigFromEnv({});
    assert.equal(loaded.governance.enforced, true);
    assert.equal(loaded.governance.blockOnUnknownCost, true);
  });

  it("rejects a governance operation that does not exist", () => {
    // A permission spelled "tools.invoke" in configuration and "tool.invoke" in
    // the catalogue is two permissions with a typo between them.
    const issues = validateOrchestrationConfig({ governance: { approvalRequired: ["tools.invoke"] } });
    assert.ok(
      issues.some((issue) => issue.field === "governance.approvalRequired"),
      `an unknown operation must be named. Issues: ${JSON.stringify(issues)}`,
    );
  });

  it("rejects a governance limit of zero, which is not the same as no limit", () => {
    const issues = validateOrchestrationConfig({ governance: { maxConcurrent: 0 } });
    assert.ok(
      issues.some((issue) => issue.field === "governance.maxConcurrent"),
      "0 is a limit nothing can satisfy; `null` is the absence of a limit",
    );
  });

  it("rejects an unknown key inside the governance section", () => {
    const issues = validateOrchestrationConfig({ governance: { enforeced: true } });
    assert.ok(
      issues.some((issue) => issue.field === "governance.enforeced"),
      "a misspelled setting must be reported, not silently ignored",
    );
  });

  it("accepts every orchestration section as a known section", () => {
    // Regression, and the reason it exists: `workflow` was briefly dropped from
    // the allow-list while PHASE 08 was being added, which made the entire section
    // unconfigurable. Nothing failed, because every earlier test asserted that a
    // BAD value was reported - never that a GOOD one was accepted.
    //
    // So: for every section, a valid value must produce NO issues at all.
    for (const section of ["agent", "memory", "worker", "observability", "security", "agents", "ruflo", "tools", "learning", "routing", "workflow", "governance"]) {
      const issues = validateOrchestrationConfig({ [section]: {} });
      assert.deepEqual(
        issues,
        [],
        `an empty "${section}" section must be valid. Issues: ${JSON.stringify(issues)}`,
      );
    }
  });

  it("reads no variable outside the allow-list", () => {
    const raw = rawOrchestrationConfigFromEnv({ TOZ_RUFLO_API_KEY: "secret", TOZ_ANYTHING: "x" });
    assert.equal(JSON.stringify(raw).includes("secret"), false, "no secret is read by the orchestration config");
  });

  it("stays centralised in the app configuration", () => {
    const appConfig = assertOk<AppConfig>(
      validateConfig({ app: { environment: "test" }, orchestration: { ruflo: { enabled: true } } }),
    );
    const { config, issues } = orchestrationConfigFromApp(appConfig);
    assert.deepEqual(issues, []);
    assert.equal(config.ruflo.enabled, true);
  });

  it("keeps the core free of orchestration-specific validation", () => {
    // The app config carries the section verbatim; the core must not grow a
    // notion of a Ruflo switch, or provider/framework knowledge would leak into
    // the layer that must not know about providers or frameworks.
    const appConfig = assertOk<AppConfig>(validateConfig({ app: { environment: "test" }, orchestration: { ruflo: { enabled: "yes" } } }));
    const { issues } = orchestrationConfigFromApp(appConfig);
    assert.ok(issues.length > 0, "an invalid value is still reported, by the layer that understands it");
  });
});

/* ------------------------------------------------------------------ */
/* O. Regression: registry and pool behaviour after the 04.1 changes   */
/* ------------------------------------------------------------------ */

describe("PHASE 04.1 O — registry and pool regression", () => {
  it("still selects exactly one agent by default", () => {
    const pool = new SpecialistPool({ candidates: () => [] });
    const decision = pool.select(
      { taskId: "t", requiredCapabilities: [], minimumTrust: "low" },
      { providerIds: () => [], availableTools: () => [], grantedMemoryScopes: () => [] },
    );
    assert.equal(decision.selected.length, 0);
  });

  it("still records provenance as native for a directly registered agent", () => {
    const agents = new AgentRegistry({ clock: CLOCK });
    const registered = assertOk<RegisteredAgent>(agents.register({ agentId: "a", version: "1", adapter: "x" }));
    assert.deepEqual(registered.record.source, { kind: "native", ref: null });
  });

  it("still refuses a duplicate agent version", () => {
    const agents = new AgentRegistry({ clock: CLOCK });
    assertOk(agents.register({ agentId: "a", version: "1", adapter: "x" }));
    assert.equal(agents.register({ agentId: "a", version: "1", adapter: "x" }).ok, false);
  });

  it("still indexes capabilities from a directly registered agent", () => {
    const agents = new AgentRegistry({ clock: CLOCK });
    const capabilities = new CapabilityRegistry();
    const registered = assertOk<RegisteredAgent>(agents.register({ agentId: "a", version: "1", adapter: "x", capabilities: CapabilitySet.supporting("coding") }));
    capabilities.index(registered.record);
    assert.deepEqual(capabilities.supportersOf("coding"), ["a@1"]);
  });
});
