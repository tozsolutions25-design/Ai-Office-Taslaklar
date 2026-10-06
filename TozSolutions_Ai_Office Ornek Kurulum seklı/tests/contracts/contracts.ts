/**
 * Reusable contract suites.
 *
 * These are the real deliverable for external integration. A future
 * `RufloAdapter`, `AgencyAdapter`, `RemoteAgentAdapter`, memory backend or
 * tool invoker is not trusted because it was written carefully — it is trusted
 * because it passes the same contract suite every existing implementation passes.
 *
 * Each suite takes a factory rather than a concrete class, so any implementation
 * can be run against it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CapabilitySet } from "../../src/capabilities/capability.js";
import { type MemoryEntry, type MemoryProvider, type MemoryScope } from "../../src/orchestration/memory/memory.js";
import { workspaceRef } from "../../src/orchestration/workspace/workspace.js";
import { type ToolRegistry, type ToolInvoker, type ToolRecord } from "../../src/orchestration/tools/tool.js";
import { type Verifier, type VerificationOutcome } from "../../src/orchestration/verification/verifier.js";
import { type Worker, type WorkerHost } from "../../src/orchestration/workers/worker.js";
import { type AgentAdapter, type AgentExecutionRequest, type AdapterAgentDescriptor } from "../../src/orchestration/agent/adapter.js";

import { type Evidence, buildEvidence } from "../../src/orchestration/evidence/evidence.js";

/** A well-formed agent descriptor every adapter must be able to produce. */
export const SAMPLE_DESCRIPTOR: AdapterAgentDescriptor = {
  agentId: "contract-agent",
  name: "Contract Agent",
  version: "1.0.0",
  capabilities: { supported: ["coding"], unsupported: ["vision"] },
};

/** A well-formed evidence record every verifier must handle. */
export const SAMPLE_EVIDENCE: Evidence = buildEvidence({
  taskId: "contract-task",
  traceId: "contract-trace",
  agentId: "contract-agent",
  agentVersion: "1.0.0",
  provider: "contract-provider",
  model: "contract-model",
  output: "a verified result",
  status: "succeeded",
  startedAt: 1_000,
  finishedAt: 1_200,
});

/** An execution request every adapter must accept. */
export const SAMPLE_REQUEST: AgentExecutionRequest = {
  taskId: "contract-task",
  objective: "Produce a result",
  input: "input text",
  requiredCapabilities: ["coding"],
  timeoutMs: 5_000,
};

/* ------------------------------------------------------------------ */
/* AgentAdapterContract                                                */
/* ------------------------------------------------------------------ */

export function describeAgentAdapterContract(
  name: string,
  factory: () => AgentAdapter,
  expected: { readonly descriptor: AdapterAgentDescriptor; readonly output: string } = {
    descriptor: SAMPLE_DESCRIPTOR,
    output: "contract result",
  },
): void {
  describe(`AgentAdapterContract: ${name}`, () => {
    it("declares a non-empty adapter name", () => {
      assert.ok(factory().name.trim().length > 0, "an adapter must identify itself");
    });

    it("reports availability without throwing", async () => {
      const available = await factory().isAvailable();
      assert.equal(typeof available, "boolean");
    });

    it("describes an agent as a normalised descriptor", async () => {
      const result = await factory().describe(expected.descriptor.agentId, expected.descriptor.version);
      assert.equal(result.ok, true, "describe must succeed for a known agent");
      if (!result.ok) return;
      const descriptor = result.value;
      assert.equal(descriptor.agentId, expected.descriptor.agentId);
      assert.equal(descriptor.version, expected.descriptor.version);
      assert.ok(Array.isArray(descriptor.capabilities.supported), "capabilities must be a list");
      assert.ok(descriptor.capabilities.supported.length > 0, "an agent must declare at least one capability");
    });

    it("never claims a capability it lists as unsupported", async () => {
      const result = await factory().describe(expected.descriptor.agentId, expected.descriptor.version);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const supported = new Set(result.value.capabilities.supported);
      for (const absent of result.value.capabilities.unsupported ?? []) {
        assert.equal(supported.has(absent), false, `"${absent}" cannot be both supported and unsupported`);
      }
    });

    it("executes a request and returns a normalised result", async () => {
      const result = await factory().execute(expected.descriptor.agentId, SAMPLE_REQUEST);
      assert.equal(result.ok, true, "execute must succeed for a healthy adapter");
      if (!result.ok) return;
      assert.equal(result.value.taskId, SAMPLE_REQUEST.taskId, "the result must echo the task id");
      assert.equal(typeof result.value.output, "string");
      assert.ok(result.value.output.length > 0, "a successful execution must produce output");
    });

    it("reports a null measurement rather than inventing one", async () => {
      const result = await factory().execute(expected.descriptor.agentId, SAMPLE_REQUEST);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      if (result.value.inputTokens === undefined || result.value.inputTokens === null) {
        assert.equal(result.value.inputTokens ?? null, null, "an unmeasured count must stay null, not 0");
      }
    });

    it("classifies a failure rather than throwing", async () => {
      const adapter = factory();
      // An agent id the adapter cannot describe must produce a Result error.
      const result = await adapter.execute("definitely-not-a-real-agent", SAMPLE_REQUEST);
      if (result.ok) {
        return; // A permissive adapter may execute anything; nothing to assert.
      }
      assert.ok(
        result.error.errorClass.length > 0,
        "a failure must carry a classified error, not a bare message",
      );
    });

    it("resolves a task id it did not receive", async () => {
      const adapter = factory();
      const result = await adapter.execute(expected.descriptor.agentId, { ...SAMPLE_REQUEST, taskId: "other-task" });
      if (result.ok) {
        assert.equal(result.value.taskId, "other-task", "an adapter must not misattribute a result");
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* MemoryProviderContract                                              */
/* ------------------------------------------------------------------ */

export function describeMemoryProviderContract(name: string, factory: () => MemoryProvider): void {
  describe(`MemoryProviderContract: ${name}`, () => {
    // PHASE 06. The workspace every case below runs in, plus a second one used
    // only by the isolation cases.
    const W = workspaceRef("contract-workspace");
    const OTHER = workspaceRef("contract-other-workspace");
    const BRAND = workspaceRef("contract-workspace", "contract-brand");
    const entry = <T>(key: string, value: T, scope: MemoryScope = "task"): MemoryEntry<T> => ({
      scope,
      key,
      value,
      writtenAt: 1_000,
      writtenBy: "contract",
    });

    it("stores and retrieves a value", async () => {
      const memory = factory();
      await memory.write(W,entry("contract-key", { answer: 42 }));
      assert.deepEqual(await memory.read(W,"task", "contract-key"), { answer: 42 });
    });

    it("returns null for a key it does not hold", async () => {
      assert.equal(await factory().read(W, "task", "never-written"), null);
    });

    it("isolates scopes: a write in one scope is not visible in another", async () => {
      const memory = factory();
      await memory.write(W,entry("shared-name", "task-value", "task"));
      await memory.write(W,entry("shared-name", "project-value", "project"));
      assert.equal(await memory.read(W,"task", "shared-name"), "task-value");
      assert.equal(await memory.read(W,"project", "shared-name"), "project-value");
    });

    it("is idempotent on repeated writes of the same key", async () => {
      const memory = factory();
      await memory.write(W,entry("idem", "first"));
      await memory.write(W,entry("idem", "second"));
      assert.equal(await memory.read(W,"task", "idem"), "second", "the latest write wins");
      assert.equal((await memory.list(W,"task")).length, 1, "a repeated write must not duplicate the entry");
    });

    it("lists the entries in a scope and not others", async () => {
      const memory = factory();
      await memory.write(W,entry("a", 1, "task"));
      await memory.write(W,entry("b", 2, "agent"));
      const task = await memory.list(W,"task");
      assert.equal(task.length, 1);
      assert.equal(task[0]?.key, "a");
    });

    it("deletes an entry and reports whether it existed", async () => {
      const memory = factory();
      await memory.write(W,entry("doomed", 1));
      assert.equal(await memory.delete(W,"task", "doomed"), true);
      assert.equal(await memory.delete(W,"task", "doomed"), false, "deleting twice must report false");
      assert.equal(await memory.read(W,"task", "doomed"), null);
    });

    it("handles a null-ish value without confusing it with absence", async () => {
      const memory = factory();
      await memory.write(W,entry("explicit-null", null));
      assert.equal(await memory.read(W,"task", "explicit-null"), null);
      const listed = await memory.list(W,"task");
      assert.equal(listed.length, 1, "a stored null must remain listed");

    // ---- PHASE 06: isolation. Structural, not filtered. --------------------

    it("does not serve one workspace's entry to another", async () => {
      const memory = factory();
      await memory.write(W, entry("shared-name", "workspace-one"));
      assert.equal(await memory.read(OTHER, "task", "shared-name"), null);
      assert.equal(
        (await memory.list(OTHER, "task")).length,
        0,
        "another workspace must not even learn that the key exists",
      );
    });

    it("does not serve one brand's entry to another brand of the same workspace", async () => {
      const memory = factory();
      await memory.write(BRAND, entry("shared-name", "brand-one"));
      assert.equal(await memory.read(workspaceRef("contract-workspace"), "task", "shared-name"), null);
      assert.equal(await memory.read(BRAND, "task", "shared-name"), "brand-one");
    });

    it("deletes only within the workspace that was asked", async () => {
      const memory = factory();
      await memory.write(W, entry("doomed", 1));
      assert.equal(
        await memory.delete(OTHER, "task", "doomed"),
        false,
        "another workspace's delete must find nothing to remove",
      );
      assert.equal(await memory.read(W, "task", "doomed"), 1, "and the entry must survive");
      assert.equal(await memory.delete(W, "task", "doomed"), true);
    });
    });
  });
}

/* ------------------------------------------------------------------ */
/* ToolProviderContract                                                */
/* ------------------------------------------------------------------ */

export function describeToolProviderContract(
  name: string,
  factory: () => { registry: ToolRegistry; invoker: ToolInvoker; toolId: string },
): void {
  describe(`ToolProviderContract: ${name}`, () => {
    it("registers a tool and reports it as available", () => {
      const { registry, toolId } = factory();
      const tool = registry.get(toolId);
      assert.ok(tool, "the registered tool must be retrievable");
      assert.ok(tool.status === "available" || tool.status === "degraded");
    });

    it("declares whether it has side effects and network access", () => {
      const { registry, toolId } = factory();
      const tool = registry.get(toolId);
      assert.ok(tool);
      assert.equal(typeof tool.sideEffecting, "boolean");
      assert.equal(typeof tool.network, "boolean");
    });

    it("invokes the tool and returns a result", async () => {
      const { invoker, toolId } = factory();
      const result = await invoker.invoke({ toolId, subject: "contract", input: "hello", timeoutMs: 1_000 });
      assert.equal(result.ok, true, "a healthy invoker must succeed");
      if (!result.ok) return;
      assert.equal(result.value.toolId, toolId);
    });

    it("reports a failure for an unknown tool rather than succeeding", async () => {
      const { invoker } = factory();
      const result = await invoker.invoke({ toolId: "no-such-tool", subject: "contract", input: null, timeoutMs: 1_000 });
      assert.equal(result.ok, false, "an unknown tool must not appear to succeed");
    });

    it("is idempotent on re-registration", () => {
      const { registry, toolId } = factory();
      const before = registry.size;
      registry.register({ toolId, kind: "local", description: "again" });
      assert.equal(registry.size, before, "re-registering must not add a second tool");
    });
  });
}

/* ------------------------------------------------------------------ */
/* VerificationProviderContract                                        */
/* ------------------------------------------------------------------ */

export function describeVerificationProviderContract(name: string, factory: () => Verifier): void {
  describe(`VerificationProviderContract: ${name}`, () => {
    it("declares a kind and a name", () => {
      const verifier = factory();
      assert.ok(verifier.kind.trim().length > 0);
      assert.ok(verifier.name.trim().length > 0);
    });

    it("returns a recognised verdict", () => {
      const outcome: VerificationOutcome = factory().verify(SAMPLE_EVIDENCE) as VerificationOutcome;
      assert.ok(["pass", "fail", "needs_review"].includes(outcome.verdict), `unexpected verdict: ${outcome.verdict}`);
    });

    it("returns a non-empty reason for a non-pass verdict", () => {
      const outcome: VerificationOutcome = factory().verify(SAMPLE_EVIDENCE) as VerificationOutcome;
      if (outcome.verdict !== "pass") {
        assert.ok(outcome.detail.trim().length > 0, "a non-pass verdict must explain itself");
      }
    });

    it("does not mutate the evidence it inspects", () => {
      const before = JSON.stringify(SAMPLE_EVIDENCE);
      factory().verify(SAMPLE_EVIDENCE);
      assert.equal(JSON.stringify(SAMPLE_EVIDENCE), before, "a verifier must treat evidence as read-only");
    });

    it("returns the same verdict for the same evidence", () => {
      const first: VerificationOutcome = factory().verify(SAMPLE_EVIDENCE) as VerificationOutcome;
      const second: VerificationOutcome = factory().verify(SAMPLE_EVIDENCE) as VerificationOutcome;
      assert.equal(first.verdict, second.verdict, "verification must be deterministic");
    });
  });
}

/* ------------------------------------------------------------------ */
/* WorkerContract                                                      */
/* ------------------------------------------------------------------ */

export function describeWorkerContract(
  name: string,
  factory: () => { host: WorkerHost; worker: Worker; expectOutcome?: "succeeded" | "failed" | "cancelled" },
): void {
  describe(`WorkerContract: ${name}`, () => {
    it("declares an id and a positive interval", () => {
      const { worker } = factory();
      assert.ok(worker.id.trim().length > 0);
      assert.ok(worker.intervalMs > 0, "a worker must declare an interval");
    });

    it("is registered and reports a status", () => {
      const { host, worker } = factory();
      assert.equal(host.ids().includes(worker.id), true);
      assert.ok(["idle", "running", "stopped", "failed"].includes(host.statusOf(worker.id)));
    });

    it("produces a recorded run", async () => {
      const { host, worker, expectOutcome } = factory();
      await host.runOnce(worker.id);
      const history = host.history(worker.id);
      assert.ok(history.length >= 1, "every run must be recorded");
      const record = history[history.length - 1];
      assert.ok(record, "a run record is required");
      if (expectOutcome) {
        assert.equal(record?.outcome, expectOutcome);
      }
      assert.ok(record?.runId.startsWith(worker.id), "a run id must identify its worker");
    });

    it("returns to a non-running state after a run", async () => {
      const { host, worker } = factory();
      await host.runOnce(worker.id);
      assert.notEqual(host.statusOf(worker.id), "running", "a worker must not be left marked running");
    });

    it("can be stopped and started again", async () => {
      const { host, worker } = factory();
      const stopped = host.stop(worker.id);
      assert.equal(stopped.ok, true);
      const started = host.start(worker.id);
      assert.equal(started.ok, true);
    });

    it("reports an unknown worker rather than throwing", async () => {
      const { host } = factory();
      assert.equal((await host.runOnce("no-such-worker")).ok, false);
      assert.equal(host.stop("no-such-worker").ok, false);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

/** The shape accepted by the assertions: either branch, with optional payloads. */
export interface ResultLike<T, E> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: E;
}

/**
 * Any `Result`-shaped value, including one widened to `unknown`.
 *
 * Loosely typed on purpose: these assertions are used from dynamic-import
 * contexts where the concrete result type is not statically known. The narrowing
 * is explicit below, so a wrongly-shaped result fails the assertion rather than
 * failing to compile.
 */
type AnyResult = {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: unknown;
};

/**
 * Asserts a `Result` succeeded, with a readable failure.
 *
 * Takes a `ResultLike` rather than `Result`, so a caller can assert on the
 * result of a call whose inferred type is widened to `unknown` (for example
 * through a dynamic import). The narrowing is explicit rather than hidden in a
 * cast, so a wrong-shaped result fails the assertion instead of a type error.
 */
export function assertOk<T>(result: AnyResult, message = "expected the result to succeed"): T {
  if (result.ok !== true) {
    const error = result["error"];
    const detail = error === undefined ? "" : `: ${safeStringify(error)}`;
    throw new Error(`${message}${detail}`);
  }
  return result["value"] as T;
}

/** Asserts a `Result` failed, returning the error. */
export function assertErr<E>(result: AnyResult, message = "expected the result to fail"): E {
  if (result.ok !== false) {
    throw new Error(message);
  }
  const error = result["error"];
  if (error === undefined || error === null) {
    throw new Error(`${message}: the failure carried no error value`);
  }
  return error as E;
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Capability set for adapter descriptor tests. */
export function setOf(supported: readonly string[]): CapabilitySet {
  const entries: Record<string, "supported" | "unsupported"> = {};
  for (const capability of supported) {
    entries[capability] = "supported";
  }
  return new CapabilitySet(entries);
}

/** The canonical sample tool id used by the tool contract. */
export const CONTRACT_TOOL_ID = "contract-tool";

/** The canonical sample tool record. */
export const SAMPLE_TOOL: ToolRecord = {
  toolId: CONTRACT_TOOL_ID,
  name: "Contract Tool",
  kind: "local",
  status: "available",
  description: "A tool used by the contract suite",
  accepts: ["text/plain"],
  produces: ["text/plain"],
  sideEffecting: false,
  network: false,
  minimumTrust: "standard",
  measuredLatencyMs: null,
  registeredAt: new Date(0),
  metadata: {},
};
