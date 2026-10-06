/**
 * PHASE 07 EVIDENCE - defects found in the memory subsystem during the audit.
 *
 * Each of these is a defect that TYPECHECKS and that reads correctly, and each was
 * found by reading the code against its own stated intent rather than by a failing
 * test - which is the only way they could have been found, since none of them
 * produces a wrong answer on the path a caller actually uses.
 *
 * Fixes are test-first: each test here was written and observed FAILING before the
 * corresponding production change, and the reason it was worth fixing is written
 * above the test rather than in the commit message.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { InMemoryMemoryProvider } from "../src/orchestration/memory/memory.js";
import { MemoryStore } from "../src/orchestration/memory/store.js";
import { RetrievalEngine } from "../src/orchestration/memory/retrieval.js";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";
import type { MemoryProvenance } from "../src/orchestration/memory/model.js";
import * as policyModule from "../src/orchestration/memory/policy.js";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const CLOCK = new ManualClock(NOW);
const ACME = workspaceRef("acme");

function provenance(): MemoryProvenance {
  return {
    source: "agent",
    sourceRef: "agent:prober",
    taskId: null,
    traceId: null,
    observedAt: 0,
    verification: null,
    sourceReference: null,
  };
}

function store(): MemoryStore {
  return new MemoryStore({
    provider: new InMemoryMemoryProvider(),
    clock: CLOCK,
    workspace: ACME,
  });
}

function seed(target: MemoryStore, key: string): string {
  const outcome = target.store({
    scope: "task",
    key,
    type: "semantic",
    value: `value-${key}`,
    summary: `summary-${key}`,
    provenance: provenance(),
  });
  assert.equal(outcome.ok, true, `seeding ${key}`);
  if (!outcome.ok || outcome.value.kind !== "stored") {
    throw new Error(`seeding ${key} produced no stored item`);
  }
  return outcome.value.item.id;
}

describe("PHASE 07 EVIDENCE - audit defects", () => {
  /* -- D1: invalidate() wrote the KEY into the ID-keyed bucket ------------------ */

  it("D1: invalidate leaves no phantom record behind", () => {
    // `#bucket(scope)` is ID-keyed - every other writer does
    // `#bucket(scope).set(item.id, item)`. `invalidate` did `set(item.key, item)`, so
    // it wrote a SECOND entry into the ID map under the memory's KEY.
    //
    // It typechecks, it reads correctly (`#findById` matches on `item.id` across
    // VALUES, so the real record is still found), and it is invisible on the path a
    // caller uses - `get` and `listScope` both filter on status. It shows up only in
    // the two views that report on the store as a whole, and the phantom never leaves:
    const s = store();
    const id = seed(s, "k1");
    assert.equal(s.size(), 1);
    assert.equal(s.historyFor("task", "k1").length, 1);

    assert.equal(s.invalidate(id, "superseded by newer evidence").ok, true);

    assert.equal(s.historyFor("task", "k1").length, 1, "a key's history must not gain an entry from invalidating it");
    assert.equal(s.size(), 1, "one memory is still one memory after being invalidated");
  });

  it("D1: the phantom would compound every time a key is reused", async () => {
    // The reason this was worth fixing rather than documenting: the phantom's map key
    // is the memory KEY, so it survives the original memory's deletion and collides
    // with whatever is next written at that address. Each reuse adds one more entry to
    // `historyFor` and to `size()`, permanently.
    const s = store();
    const first = seed(s, "reused");
    assert.equal(s.invalidate(first, "withdrawn").ok, true);
    assert.equal(await s.delete("task", "reused"), true);
    seed(s, "reused");

    assert.equal(s.historyFor("task", "reused").length, 2, "two beliefs at one key is two records");
    assert.equal(s.size(), 2, "and nothing more");
  });

  it("D1: every status transition writes by id, so the two views agree", () => {
    // The general invariant behind the fix, asserted rather than assumed: after ANY
    // transition, `size()` equals `listScope(includeInactive)` equals the number of
    // distinct ids in the store.
    const s = store();
    const id = seed(s, "a");
    seed(s, "b");
    const transitions: readonly (() => unknown)[] = [
      () => s.setStatus(id, "stale"),
      () => s.markStale(id),
      () => s.invalidate(id, "why"),
      () => s.setStatus(id, "active"),
      () => s.setStatus(id, "deleted"),
    ];
    for (const transition of transitions) {
      transition();
      const all = s.listScope("task", { includeInactive: true });
      assert.equal(
        s.size(),
        all.length,
        `size() and listScope must agree after ${transition.toString().slice(0, 40)}`,
      );
      assert.equal(
        new Set(all.map((item) => item.id)).size,
        all.length,
        "no id may appear twice in one scope",
      );
    }
  });

  /* -- D2: the semantic strategy reported itself as run while doing nothing ------ */

  it("D2: with no embedding provider the semantic strategy reports itself unavailable", async () => {
    // `#semanticStrategies` computed a `queryVector` and DISCARDED it, then returned
    // `strategies: ["semantic"]` whenever a provider was configured and available. So
    // the engine claimed a strategy had run when no match had been produced - the exact
    // shape D-46 rejected for MCP ("a stub shaped like a client is a fabricated
    // capability"), and worse here, because the strategy name appears in the
    // explanation a reader uses to judge why a memory surfaced.
    const engine = new RetrievalEngine(store(), { clock: CLOCK });
    const result = await engine.retrieve({ text: "anything", scopes: ["task"], limit: 5 });

    assert.equal(
      result.explanation.strategies.includes("semantic"),
      false,
      "a strategy that did not run must not be reported",
    );
    assert.ok(
      result.explanation.reason.length > 0,
      "and the reason it did not run must be stated",
    );
  });

  it("D2: a provider that returns a vector still does not earn the semantic claim", async () => {
    // Pins the reason this is not fixed by "just populate matchedByKey": doing that
    // needs a vector INDEX, which is Phase 10 (Knowledge / RAG). Until then an engine
    // with a working provider must still report honestly, or `strategies` becomes a
    // claim about configuration rather than about work done.
    //
    // Seeded with one matching memory so `explanation.reason` is the SUCCESS string and
    // the reader is forced to look at `unavailableReason` - which is where the honest
    // answer already lives, and where a reader looking at an empty store would never
    // notice it missing.
    const s = store();
    seed(s, "hello");
    const embeddings = {
      name: "probe-provider",
      dimensions: 3,
      isAvailable: () => Promise.resolve(true),
      embed: () => Promise.resolve([[0.1, 0.2, 0.3]]),
    };
    const engine = new RetrievalEngine(s, { clock: CLOCK, embeddings });
    const result = await engine.retrieve({ text: "hello", scopes: ["task"], limit: 5 });

    assert.equal(
      result.explanation.strategies.includes("semantic"),
      false,
      "a computed-and-discarded vector is not a semantic search",
    );
    assert.match(
      result.unavailableReason ?? "",
      /semantic/i,
      "and the reason it did not run must name it",
    );
  });

  /* -- D3: minimumImportance documentation contradicted the code --------------- */

  it("D3: the documented default importance floor matches the code", () => {
    // The doc comment said "Default 0.3, which excludes `conversational` (0.3) only at
    // the boundary". The code default is 0.35, chosen deliberately so that
    // `conversational` is excluded ENTIRELY - there is a comment at the assignment
    // saying exactly that. So the code was right and the documentation understated the
    // floor, describing behaviour 0.35 does not have.
    const { DefaultWritePolicy } = policyModule;
    assert.equal(new DefaultWritePolicy().minimumImportance, 0.35);
  });
});
