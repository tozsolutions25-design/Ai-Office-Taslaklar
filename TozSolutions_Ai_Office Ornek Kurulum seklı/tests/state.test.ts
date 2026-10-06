import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { StateStore, assertStorable } from "../src/state/index.js";
import { NullKnowledgeProvider } from "../src/knowledge/index.js";
import { createCore } from "../src/index.js";

function store(): { store: StateStore; clock: ManualClock } {
  const clock = new ManualClock(new Date("2026-01-01T00:00:00.000Z"));
  return { store: new StateStore({ clock }), clock };
}

describe("state store", () => {
  it("stores and reads a value", () => {
    const { store: state } = store();
    state.set("tasks", "t1", { state: "queued" });
    assert.deepEqual(state.get("tasks", "t1"), { state: "queued" });
    assert.equal(state.has("tasks", "t1"), true);
  });

  it("versions successive writes", () => {
    const { store: state } = store();
    const first = state.set("tasks", "t1", "a");
    const second = state.set("tasks", "t1", "b");
    assert.equal(first.version, 1);
    assert.equal(second.version, 2);
    assert.equal(state.getEntry("tasks", "t1")?.version, 2);
  });

  it("keeps namespaces separate", () => {
    const { store: state } = store();
    state.set("tasks", "same-key", "task-value");
    state.set("providers", "same-key", "provider-value");
    assert.equal(state.get("tasks", "same-key"), "task-value");
    assert.equal(state.get("providers", "same-key"), "provider-value");
    assert.deepEqual([...state.namespaces()].sort(), ["providers", "tasks"]);
  });

  it("returns undefined for unknown keys", () => {
    const { store: state } = store();
    assert.equal(state.get("nothing", "here"), undefined);
  });

  it("notifies subscribers of a change", () => {
    const { store: state } = store();
    const seen: string[] = [];
    state.subscribe<{ state: string }>("tasks", (change) => {
      seen.push(change.entry.value.state);
    });
    state.set("tasks", "t1", { state: "queued" });
    state.set("tasks", "t1", { state: "running" });
    assert.deepEqual(seen, ["queued", "running"]);
  });

  it("stops notifying after unsubscribe", () => {
    const { store: state } = store();
    let count = 0;
    const off = state.subscribe("tasks", () => {
      count += 1;
    });
    state.set("tasks", "t1", 1);
    off();
    state.set("tasks", "t1", 2);
    assert.equal(count, 1);
  });

  it("deletes an entry", () => {
    const { store: state } = store();
    state.set("tasks", "t1", 1);
    assert.equal(state.delete("tasks", "t1"), true);
    assert.equal(state.delete("tasks", "t1"), false);
    assert.equal(state.has("tasks", "t1"), false);
  });

  it("applies a batch", () => {
    const { store: state } = store();
    state.batch([
      { namespace: "tasks", key: "a", value: 1 },
      { namespace: "tasks", key: "b", value: 2 },
    ]);
    assert.equal(state.size(), 2);
  });

  it("refuses to store a credential", () => {
    const { store: state } = store();
    assert.throws(() => state.set("config", "c", { apiKey: "sk-realsecret" }), /credentials or secrets/);
    assert.throws(() => state.set("config", "c", { auth: { bearer_token: "x" } }), /credentials or secrets/);
    assert.equal(state.has("config", "c"), false, "a rejected write must not land");
  });

  it("refuses a non-serialisable value", () => {
    assert.throws(() => assertStorable(() => undefined), /serialisable/);
    assert.throws(() => assertStorable(Symbol("x")), /serialisable/);
  });

  it("allows a non-secret auth reference", () => {
    const { store: state } = store();
    state.set("config", "c", { authEnvVarName: "ACME_API_KEY" });
    assert.deepEqual(state.get("config", "c"), { authEnvVarName: "ACME_API_KEY" });
  });
});

describe("knowledge boundary", () => {
  it("reports unavailable rather than failing when no knowledge layer is attached", async () => {
    const knowledge = new NullKnowledgeProvider();
    assert.equal(await knowledge.isAvailable(), false);
    const result = await knowledge.query({ text: "q", topK: 5, workspace: null });
    assert.equal(result.available, false);
    assert.equal(result.reason, "knowledge_unavailable");
    assert.deepEqual(result.documents, []);
  });
});

describe("composition root", () => {
  it("wires the core with empty registries and no providers", () => {
    const core = createCore();
    assert.equal(core.providers.size, 0);
    assert.equal(core.models.size, 0);
    assert.deepEqual(core.config.providers, {});
  });

  it("does not hardcode any provider", () => {
    const core = createCore();
    const serialised = JSON.stringify(core.config.providers);
    for (const name of ["openrouter", "nvidia", "ollama"]) {
      assert.equal(serialised.toLowerCase().includes(name), false, `${name} must not be a hardcoded provider`);
    }
  });

  it("wires a queue bounded by configuration", () => {
    const core = createCore();
    assert.equal(core.queue.capacity, core.config.queue.maxTasks);
  });

  it("wires physical concurrency separately from logical capacity", () => {
    const core = createCore();
    assert.equal(core.concurrency.globalLimit, core.config.concurrency.globalLimit);
    assert.ok(core.config.queue.logical.maxAgents > 0, "logical capacity must be represented");
  });

  it("selects no provider when none are registered", async () => {
    const core = createCore();
    const decision = await core.router.select({
      requirements: {
        requiredCapabilities: [],
        minContextTokens: null,
        requiredTools: [],
        reliability: "standard",
        latencyPreference: "balanced",
        costPreference: "balanced",
        fallbackRequired: false,
      },
    });
    assert.equal(decision.selected, null);
  });

  it("defaults to the unavailable knowledge provider", async () => {
    const core = createCore();
    assert.equal(core.knowledge.name, "none");
    assert.equal(await core.knowledge.isAvailable(), false);
  });
});
