/**
 * PHASE 05: the memory model, store, and lifecycle.
 */

import assert from "node:assert/strict";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";

/** PHASE 06: the workspace every subject and store in this file acts in. */
const WS = workspaceRef("test-workspace");
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { InMemoryMemoryProvider, MEMORY_SCOPES } from "../src/orchestration/memory/memory.js";
import { MemoryStore, MemoryStoreError, type MemoryConflict, type StoreOutcome } from "../src/orchestration/memory/store.js";
import {
  ALL_MEMORY_SCOPES,
  CONFIDENCE_RANK,
  MEMORY_STATUSES,
  MEMORY_TYPES,
  SCOPE_BREADTH,
  MemoryModelError,
  buildMemoryItem,
  isBroaderScope,
  isMemoryType,
  type MemoryProvenance,
} from "../src/orchestration/memory/model.js";
import { assertErr, assertOk } from "./contracts/contracts.js";
import { type MemoryItem } from "../src/orchestration/memory/model.js";


/** PHASE 06: the workspace every subject and store in this file acts in. */
const NOW = new Date("2026-01-01T00:00:00.000Z");
const START = NOW.getTime();

function provenance(overrides: Partial<MemoryProvenance> = {}): MemoryProvenance {
  return {
    source: "system",
    sourceRef: "system",
    taskId: null,
    traceId: null,
    observedAt: START,
    verification: null,
    outcome: null,
    errorClass: null,
    sourceReference: null,
    ...overrides,
  };
}

function store(clock = new ManualClock(NOW)) {
  const provider = new InMemoryMemoryProvider();
  return { provider, clock, store: new MemoryStore({ workspace: WS, provider, clock }) };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    scope: "task" as const,
    key: "t1:fact",
    type: "semantic" as const,
    value: { claim: "the sky is blue" },
    summary: "The sky is blue",
    provenance: provenance(),
    ...overrides,
  };
}

describe("PHASE 05 — scope model", () => {
  it("keeps every PHASE 04 scope valid", () => {
    for (const scope of ["system", "project", "task", "team", "agent", "provider", "pattern", "knowledge"]) {
      assert.ok(ALL_MEMORY_SCOPES.includes(scope as never), `${scope} must remain a scope`);
    }
  });

  it("adds the PHASE 05 scopes", () => {
    for (const scope of ["conversation", "organization", "global"]) {
      assert.ok(ALL_MEMORY_SCOPES.includes(scope as never), `${scope} must be a scope`);
    }
  });

  it("has no duplicates", () => {
    assert.equal(new Set(ALL_MEMORY_SCOPES).size, ALL_MEMORY_SCOPES.length);
    assert.equal(new Set(MEMORY_SCOPES).size, MEMORY_SCOPES.length);
  });

  it("orders scopes from narrowest to widest", () => {
    assert.ok(isBroaderScope("global", "task"));
    assert.ok(isBroaderScope("project", "conversation"));
    assert.equal(isBrootherCheck(), false, "a scope is not broader than itself");
  });

  it("ranks every scope", () => {
    for (const scope of ALL_MEMORY_SCOPES) {
      assert.equal(typeof SCOPE_BREADTH[scope], "number", `${scope} must be ranked`);
    }
  });
});

function isBrootherCheck(): boolean {
  return isBroaderScope("task", "task");
}

describe("PHASE 05 — item model", () => {
  it("refuses to build an item with no provenance, by name", () => {
    // Provenance is the one field the model refuses to invent: a fabricated
    // origin is worse than a refusal, because the question would then have
    // an answer and the answer would be wrong.
    assert.throws(
      () => buildMemoryItem({ ...draft(), provenance: undefined as never }, START),
      /provenance is required/,
    );
  });

  it("names that refusal so a caller can catch it", () => {
    assert.throws(
      () => buildMemoryItem({ ...draft(), provenance: undefined as never }, START),
      MemoryModelError,
    );
  });

  it("derives a default confidence when the writer states none", () => {
    const item = buildMemoryItem(draft(), START);
    assert.equal(item.confidence.level, "medium");
    assert.equal(item.confidence.score, null, "an unquantified confidence stays null, not zero");
    assert.ok(item.confidence.reasons.length > 0, "a confidence must state why");
  });

  it("defaults sensitivity to restricted, not public", () => {
    const item = buildMemoryItem(draft(), START);
    assert.equal(item.sensitivity, "restricted", "an unclassified memory must be protected, not published");
  });

  it("ranks a decision above a conversational aside", () => {
    const decision = buildMemoryItem(draft({ type: "decision" }), START);
    const chat = buildMemoryItem(draft({ type: "conversational" }), START);
    assert.ok(decision.importance > chat.importance, "a reader that cannot tell them apart will treat a pleasantry as a fact");
  });

  it("records the writing subject as provenance, not as a participant list", () => {
    // A memory has one author, not a set: `provenance.sourceRef` is the fact,
    // and there is deliberately no `agents` field that could imply several.
    const item = buildMemoryItem(draft(), START);
    assert.equal(item.provenance.sourceRef, "system");
    assert.equal("agents" in item, false);
  });

  it("keeps importance and confidence separate", () => {
    const certain = buildMemoryItem(
      draft({ confidence: { level: "certain", score: null, reasons: ["measured"] }, importance: 0.2 }),
      START,
    );
    assert.equal(certain.confidence.level, "certain");
    assert.equal(certain.importance, 0.2, "being certain does not make something important");
  });

  it("recognises every declared type", () => {
    for (const type of MEMORY_TYPES) {
      assert.equal(isMemoryType(type), true);
    }
    assert.equal(isMemoryType("vibes"), false);
  });

  it("has no duplicate statuses or confidence levels", () => {
    assert.equal(new Set(MEMORY_STATUSES).size, MEMORY_STATUSES.length);
    assert.equal(new Set(Object.keys(CONFIDENCE_RANK)).size, Object.keys(CONFIDENCE_RANK).length);
  });
});

describe("PHASE 05 — store: creation", () => {
  it("stores an item", () => {
    const { store: memory } = store();
    const outcome = assertOk<StoreOutcome>(memory.store(draft()));
    assert.equal(outcome.kind, "stored");
    assert.ok(memory.get("task", "t1:fact") !== null);
  });

  it("refuses an item with no provenance", () => {
    const { store: memory } = store();
    const result = memory.store({ ...draft(), provenance: { source: "system", sourceRef: "" } as MemoryProvenance });
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error.message, /provenance/);
  });

  it("refuses an item with no summary", () => {
    const { store: memory } = store();
    const result = memory.store(draft({ summary: "   " }));
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error.message, /summary/);
  });

  it("treats the same claim as unchanged rather than a new version", () => {
    const { store: memory } = store();
    assertOk(memory.store(draft()));
    const second = assertOk<StoreOutcome>(memory.store(draft()));
    assert.equal(second.kind, "unchanged", "storing the same belief twice must not inflate the store");
  });

  it("ignores key order when comparing claims", () => {
    const { store: memory } = store();
    assertOk(memory.store(draft({ value: { a: 1, b: 2 } })));
    const second = assertOk<StoreOutcome>(memory.store(draft({ value: { b: 2, a: 1 } })));
    assert.equal(second.kind, "unchanged");
  });

  it("persists through the provider it was given", async () => {
    const { store: memory, provider } = store();
    assertOk(memory.store(draft()));
    const entries = await provider.list(WS, "task");
    assert.ok(entries.some((entry) => entry.key.startsWith("memory.item:")), "the item must reach the port");
  });

  it("rehydrates from a durable provider in a fresh store", async () => {
    const provider = new InMemoryMemoryProvider();
    const first = new MemoryStore({ workspace: WS, provider, clock: new ManualClock(NOW) });
    assertOk(first.store(draft()));

    const second = new MemoryStore({ workspace: WS, provider, clock: new ManualClock(NOW) });
    assert.equal(await second.load(), 1);
    assert.ok(second.get("task", "t1:fact") !== null, "a new process must see what a previous one wrote");
  });

  it("counts items per scope", () => {
    const { store: memory } = store();
    assertOk(memory.store(draft()));
    assertOk(memory.store(draft({ key: "t1:other", scope: "project" })));
    assert.equal(memory.size(), 2);
    assert.equal(memory.activeCount("task"), 1);
  });
});

describe("PHASE 05 — store: conflict handling", () => {
  it("retains both sides of a contradiction rather than overwriting", () => {
    const { store: memory } = store();
    assertOk<StoreOutcome>(memory.store(draft({ value: { claim: "A" } })));
    const conflict = assertOk<{ kind: "conflict"; conflict: MemoryConflict }>(memory.store(draft({ value: { claim: "B" } })));
    assert.equal(conflict.kind, "conflict");
  });

  it("keeps both records, with only the newer one current", () => {
    const { store: memory } = store();
    assertOk<StoreOutcome>(memory.store(draft({ value: { claim: "A" } })));
    assertOk(memory.store(draft({ value: { claim: "B" } })));
    const all = memory.listScope("task", { includeInactive: true });
    assert.equal(all.length, 2, "one key, two records: the belief changed and the history did not");
    assert.equal(memory.get("task", "t1:fact")?.status, "active", "a read sees the current belief");
    assert.equal(memory.liveCount(), 1, "one key holds one live belief");
  });

  it("keeps the superseded claim reachable on the record", () => {
    const { store: memory } = store();
    assertOk<StoreOutcome>(memory.store(draft({ value: { claim: "A" } })));
    const conflict = assertOk<{ kind: "conflict"; conflict: MemoryConflict }>(memory.store(draft({ value: { claim: "B" } })));
    assert.equal(conflict.conflict.existing.value !== undefined, true, "a belief that was withdrawn is still evidence");
    assert.match(conflict.conflict.reason, /already holds/);
  });

  it("links the replacement to what it replaced", () => {
    const { store: memory } = store();
    assertOk<StoreOutcome>(memory.store(draft({ value: { claim: "A" } })));
    assertOk(memory.store(draft({ value: { claim: "B" } })));
    const current = memory.get("task", "t1:fact");
    assert.ok((current?.supersedes.length ?? 0) > 0, "the chain of belief changes must be readable");
  });

  it("refuses the write outright when supersession is disabled", () => {
    const provider = new InMemoryMemoryProvider();
    const memory = new MemoryStore({ workspace: WS, provider, clock: new ManualClock(NOW), supersedeOnConflict: false });
    assertOk<StoreOutcome>(memory.store(draft({ value: { claim: "A" } })));
    const result = memory.store(draft({ value: { claim: "B" } }));
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error.message, /conflicts/);
  });
});

describe("PHASE 05 — store: correction and invalidation", () => {
  it("corrects a memory, keeping the address", () => {
    const { store: memory } = store();
    const stored = assertOk<{ kind: "stored"; item: MemoryItem }>(memory.store(draft({ value: { claim: "A" } })));
    const corrected = assertOk<MemoryItem>(memory.correct(stored.item.id, draft({ value: { claim: "B" }, summary: "Corrected" })));
    assert.equal(corrected.key, "t1:fact");
  });

  it("marks the original superseded rather than destroying it", () => {
    const { store: memory } = store();
    const stored = assertOk<{ kind: "stored"; item: MemoryItem }>(memory.store(draft()));
    assertOk(memory.correct(stored.item.id, draft({ summary: "Corrected" })));
    const history = memory.listScope("task", { includeInactive: true });
    assert.ok(history.some((item) => item.status === "superseded"), "history must survive a correction");
  });

  it("records the correction in the supersedes chain", () => {
    const { store: memory } = store();
    const stored = assertOk<{ kind: "stored"; item: MemoryItem }>(memory.store(draft()));
    const corrected = assertOk<MemoryItem>(memory.correct(stored.item.id, draft()));
    assert.ok(corrected.supersedes.includes(stored.item.id));
  });

  it("stops returning an invalidated memory", () => {
    const { store: memory } = store();
    const stored = assertOk<{ kind: "stored"; item: MemoryItem }>(memory.store(draft()));
    assertOk(memory.invalidate(stored.item.id, "the source retracted it"));
    assert.equal(memory.get("task", "t1:fact"), null);
  });

  it("keeps an invalidated memory on the record, with the reason", () => {
    const { store: memory } = store();
    const stored = assertOk<{ kind: "stored"; item: MemoryItem }>(memory.store(draft()));
    assertOk(memory.invalidate(stored.item.id, "the source retracted it"));
    const history = memory.listScope("task", { includeInactive: true });
    assert.ok(history.some((item) => item.status === "invalidated" && item.summary.includes("retracted")));
  });

  it("marks stale without withdrawing", () => {
    const { store: memory } = store();
    const stored = assertOk<{ kind: "stored"; item: MemoryItem }>(memory.store(draft()));
    assertOk(memory.markStale(stored.item.id));
    const history = memory.listScope("task", { includeInactive: true });
    assert.ok(history.some((item) => item.status === "stale"), "stale is a distinct state from withdrawn");
  });

  it("releases the key on deletion, so it may be written again", () => {
    const clock = new ManualClock(NOW);
    const { store: memory } = store(clock);
    const stored = assertOk<{ kind: "stored"; item: MemoryItem }>(memory.store(draft()));
    assertOk(memory.setStatus(stored.item.id, "deleted"));
    const again = assertOk<StoreOutcome>(memory.store(draft({ value: { claim: "B" } })));
    assert.equal(again.kind, "stored");
  });

  it("refuses to correct something that does not exist", () => {
    const { store: memory } = store();
    const result = memory.correct("nope", draft());
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error.message, /Unknown memory/);
  });

  it("reports a missing memory as a value, not a throw", () => {
    const { store: memory } = store();
    assert.equal(memory.setStatus("nope", "stale").ok, false);
  });
});

describe("PHASE 05 — store: expiry and retention", () => {
  it("hides an expired memory from a read", () => {
    const clock = new ManualClock(NOW);
    const { store: memory } = store(clock);
    assertOk(memory.store(draft({ expiresAt: START + 1_000 })));
    clock.advance(2_000);
    assert.equal(memory.get("task", "t1:fact"), null);
  });

  it("returns an expired memory when explicitly asked", () => {
    const clock = new ManualClock(NOW);
    const { store: memory } = store(clock);
    assertOk(memory.store(draft({ expiresAt: START + 1_000 })));
    clock.advance(2_000);
    assert.notEqual(memory.get("task", "t1:fact", { includeExpired: true }), null);
  });

  it("lists what is due for purge", () => {
    const clock = new ManualClock(NOW);
    const { store: memory } = store(clock);
    assertOk(memory.store(draft({ expiresAt: START + 1_000 })));
    clock.advance(2_000);
    assert.equal(memory.expired().length, 1);
  });

  it("purges expired memories and reports what went", async () => {
    const clock = new ManualClock(NOW);
    const { store: memory } = store(clock);
    assertOk(memory.store(draft({ expiresAt: START + 1_000 })));
    clock.advance(2_000);
    const purged = await memory.purgeExpired();
    assert.equal(purged.length, 1);
    assert.equal(memory.get("task", "t1:fact", { includeExpired: true }), null, "retention is explicit, not a silent forgetting");
  });

  it("never expires a memory with no expiry", () => {
    const clock = new ManualClock(NOW);
    const { store: memory } = store(clock);
    assertOk(memory.store(draft()));
    clock.advance(10_000_000_000);
    assert.notEqual(memory.get("task", "t1:fact"), null);
  });
});

describe("PHASE 05 — store: scope isolation", () => {
  it("keeps the same key in two scopes separate", () => {
    const { store: memory } = store();
    assertOk(memory.store(draft({ scope: "task", value: { claim: "task" } })));
    assertOk(memory.store(draft({ scope: "project", value: { claim: "project" } })));
    assert.equal(memory.size(), 2);
    assert.ok(memory.get("task", "t1:fact") !== null);
    assert.ok(memory.get("project", "t1:fact") !== null);
  });

  it("does not let a project memory appear in a task scope", () => {
    const { store: memory } = store();
    assertOk(memory.store(draft({ scope: "project" })));
    assert.equal(memory.get("task", "t1:fact"), null);
  });

  it("reports the scopes that hold anything", () => {
    const { store: memory } = store();
    assertOk(memory.store(draft({ scope: "project" })));
    assertOk(memory.store(draft({ scope: "knowledge", key: "k" })));
    assert.deepEqual([...memory.scopes()].sort(), ["knowledge", "project"]);
  });
});

describe("PHASE 05 — store errors", () => {
  it("uses a named error type a caller can catch", () => {
    const { store: memory } = store();
    const result = memory.store(draft({ summary: "" }));
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.error instanceof MemoryStoreError);
  });

  it("returns a Result rather than throwing for a refused write", () => {
    const { store: memory } = store();
    assert.doesNotThrow(() => memory.store(draft({ summary: "" })));
  });

  it("refuses a key the storage port could never accept", () => {
    // The port rejects this key, so accepting it into the index would create a
    // memory that reads back in this process and has vanished in the next one.
    const { store: memory } = store();
    const rejected = memory.store(draft({ key: "t1:alpha beta" }));
    assert.equal(rejected.ok, false);
    assert.ok(!rejected.ok && /1-200 characters/.test(rejected.error.message));
    assert.equal(memory.size(), 0, "a refused key must leave nothing behind");
  });

  it("keeps a rejected write readable rather than losing it in an unhandled rejection", async () => {
    // `store()` is synchronous, so a write the port rejects has no call site to
    // be thrown to. Letting it escape failed an unrelated test, three frames from
    // its cause; it has to be observable instead.
    const rejecting = new MemoryStore({
      workspace: WS,
      clock: new ManualClock(NOW),
      provider: {
        name: "rejecting",
        write: () => Promise.reject(new Error("disk is full")),
        read: () => Promise.resolve(null),
        list: () => Promise.resolve([]),
        delete: () => Promise.resolve(true),
      },
    });
    assertOk(rejecting.store(draft()));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rejecting.persistenceFailures().length, 1);
    assert.match(rejecting.persistenceFailures()[0]?.reason ?? "", /disk is full/);
  });

  it("keeps the same-claim check conservative: a different type is a conflict", () => {
    const { store: memory } = store();
    assertOk(memory.store(draft({ type: "semantic" })));
    const result = assertOk<StoreOutcome>(memory.store(draft({ type: "episodic" })));
    assert.equal(result.kind, "conflict", "a changed type is a changed claim");
  });

  it("treats a failed assertion through assertErr, not a throw", () => {
    const { store: memory } = store();
    const error = assertErr<MemoryStoreError>(memory.store(draft({ summary: "" })));
    assert.ok(error instanceof MemoryStoreError);
  });
});
