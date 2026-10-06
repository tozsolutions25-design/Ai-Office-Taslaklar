/**
 * PHASE 05: retrieval, ranking, the write policy, learning events, ingestion, and
 * the memory service, including orchestrator and agent integration.
 */

import assert from "node:assert/strict";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";

/** PHASE 06: the workspace every subject and store in this file acts in. */
const WS = workspaceRef("test-workspace");
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { AuditLog } from "../src/audit/events.js";
import { InMemoryMemoryProvider, MemoryAccessPolicy, type MemoryGrant } from "../src/orchestration/memory/memory.js";
import { MemoryStore } from "../src/orchestration/memory/store.js";
import {
  DEFAULT_RETRIEVAL_WEIGHTS,
  RetrievalEngine,
  RetrievalScorer,
  tokenise,
  type EmbeddingProvider,
} from "../src/orchestration/memory/retrieval.js";
import { DefaultWritePolicy, derivedConfidence, looksSensitive } from "../src/orchestration/memory/policy.js";
import { LearningEventStore, NullLearningEventSink } from "../src/orchestration/memory/learning.js";
import {
  IngestionService,
  StaticKnowledgeIngestor,
  UnreachableKnowledgeIngestor,
} from "../src/orchestration/memory/ingestion.js";
import { MemoryService } from "../src/orchestration/memory/service.js";
import { TraceRecorder } from "../src/orchestration/observability/trace.js";
import { buildMemoryItem, type MemoryDraft, type MemoryProvenance, type MemoryQuery } from "../src/orchestration/memory/model.js";
import { assertOk } from "./contracts/contracts.js";


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

function draft(overrides: Partial<MemoryDraft> = {}): MemoryDraft {
  return {
    scope: "task",
    key: "k",
    type: "semantic",
    value: { text: "content" },
    summary: "a summary",
    provenance: provenance(),
    ...overrides,
  };
}

/** A store plus engine, with a settable clock. */
function retrieval(clock = new ManualClock(NOW)) {
  const provider = new InMemoryMemoryProvider();
  const store = new MemoryStore({ workspace: WS, provider, clock });
  const engine = new RetrievalEngine(store, { clock });
  return { clock, store, engine };
}

function query(overrides: Partial<MemoryQuery> = {}): MemoryQuery {
  return { text: "", scopes: ["task"], limit: 10, ...overrides };
}

/* ------------------------------------------------------------------ */
/* Retrieval                                                           */
/* ------------------------------------------------------------------ */

describe("PHASE 05 — retrieval: filters", () => {
  it("returns nothing when the query names no scopes", async () => {
    const { engine } = retrieval();
    const result = await engine.retrieve(query({ scopes: [] }));
    assert.equal(result.items.length, 0);
    assert.match(result.explanation.reason, /named no scopes/);
  });

  it("refuses an unqualified query rather than widening it", async () => {
    const { store, engine } = retrieval();
    assertOk(store.store(draft({ scope: "global", summary: "global fact" })));
    const result = await engine.retrieve(query({ text: "global", scopes: [] }));
    assert.equal(result.hitCount, 0, "no scopes named means no search, not everything");
  });

  it("refuses a non-positive limit", async () => {
    const { engine } = retrieval();
    const result = await engine.retrieve(query({ limit: 0 }));
    assert.match(result.explanation.reason, /positive integer/);
  });

  it("searches only the scopes named", async () => {
    const { store, engine } = retrieval();
    assertOk(store.store(draft({ scope: "task", key: "a", summary: "alpha" })));
    assertOk(store.store(draft({ scope: "project", key: "b", summary: "alpha" })));
    const result = await engine.retrieve(query({ text: "alpha", scopes: ["task"], limit: 5 }));
    assert.equal(result.hitCount, 1);
  });

  it("excludes a memory below the confidence floor", async () => {
    const { store, engine } = retrieval();
    assertOk(store.store(draft({ key: "low", summary: "alpha", confidence: { level: "low", score: null, reasons: [] } })));
    assertOk(store.store(draft({ key: "high", summary: "alpha", confidence: { level: "high", score: null, reasons: [] } })));
    const result = await engine.retrieve(query({ text: "alpha", minimumConfidence: "high" }));
    assert.equal(result.hitCount, 1);
    assert.equal(result.items[0]?.key, "high");
  });

  it("excludes a memory below the importance floor", async () => {
    const { store, engine } = retrieval();
    assertOk(store.store(draft({ key: "trivial", summary: "alpha", importance: 0.1 })));
    assertOk(store.store(draft({ key: "important", summary: "alpha", importance: 0.9 })));
    const result = await engine.retrieve(query({ text: "alpha", minimumImportance: 0.5 }));
    assert.equal(result.items[0]?.key, "important");
  });

  it("excludes an expired memory", async () => {
    const { store, engine, clock } = retrieval();
    assertOk(store.store(draft({ key: "gone", summary: "alpha", expiresAt: START + 1_000 })));
    clock.advance(2_000);
    assertOk(store.store(draft({ key: "kept", summary: "alpha" })));
    const result = await engine.retrieve(query({ text: "alpha" }));
    assert.equal(result.hitCount, 1);
    assert.equal(result.items[0]?.key, "kept");
  });

  it("includes an expired memory when the caller asks", async () => {
    const { store, engine, clock } = retrieval();
    assertOk(store.store(draft({ key: "gone", summary: "alpha", expiresAt: START + 1_000 })));
    clock.advance(2_000);
    const result = await engine.retrieve(query({ text: "alpha", includeExpired: true }));
    assert.equal(result.hitCount, 1);
  });

  it("filters by type", async () => {
    const { store, engine } = retrieval();
    assertOk(store.store(draft({ key: "d", type: "decision", summary: "alpha" })));
    assertOk(store.store(draft({ key: "e", type: "episodic", summary: "alpha" })));
    const result = await engine.retrieve(query({ text: "alpha", types: ["decision"] }));
    assert.equal(result.items[0]?.key, "d");
  });

  it("filters by tag and by capability", async () => {
    const { store, engine } = retrieval();
    assertOk(store.store(draft({ key: "tagged", summary: "alpha", metadata: { tags: ["keep"], capabilities: ["research"], attributes: {} } })));
    assertOk(store.store(draft({ key: "plain", summary: "alpha" })));
    assert.equal((await engine.retrieve(query({ text: "alpha", tags: ["keep"] }))).items[0]?.key, "tagged");
    assert.equal((await engine.retrieve(query({ text: "alpha", capabilities: ["research"] }))).items[0]?.key, "tagged");
  });

  it("never returns a superseded, invalidated or deleted record", async () => {
    const { store, engine } = retrieval();
    const stored = assertOk<{ kind: "stored"; item: { id: string } }>(store.store(draft({ key: "old", summary: "alpha" })));
    assertOk(store.setStatus(stored.item.id, "invalidated"));
    assertOk(store.store(draft({ key: "new", summary: "alpha" })));
    const result = await engine.retrieve(query({ text: "alpha" }));
    assert.equal(result.hitCount, 1);
    assert.equal(result.items[0]?.key, "new");
  });
});

describe("PHASE 05 — retrieval: ranking", () => {
  it("prefers the item with fuller term coverage", async () => {
    const { store, engine } = retrieval();
    assertOk(store.store(draft({ key: "partial", summary: "alpha", value: { text: "only alpha here" } })));
    assertOk(store.store(draft({ key: "full", summary: "alpha beta gamma", value: { text: "alpha beta gamma" } })));
    const result = await engine.retrieve(query({ text: "alpha beta gamma" }));
    assert.equal(result.items[0]?.key, "full", "coverage of the query, not verbosity");
  });

  it("prefers an exact key hit over a partial match", async () => {
    // A key cannot contain spaces - the storage port refuses one - so the exact
    // key strategy is exercised with a single-word query, which is the only
    // shape a key can actually match.
    const { store, engine } = retrieval();
    assertOk(store.store(draft({ key: "alpha", summary: "alpha" })));
    assertOk(store.store(draft({ key: "other", summary: "alpha and other words" })));
    const result = await engine.retrieve(query({ text: "alpha" }));
    assert.equal(result.items[0]?.key, "alpha");
  });

  it("prefers a higher-confidence item when relevance ties", async () => {
    const { store, engine } = retrieval();
    assertOk(store.store(draft({ key: "weak", summary: "alpha", confidence: { level: "low", score: null, reasons: [] } })));
    assertOk(store.store(draft({ key: "strong", summary: "alpha", confidence: { level: "certain", score: null, reasons: [] } })));
    const result = await engine.retrieve(query({ text: "alpha" }));
    assert.equal(result.items[0]?.key, "strong");
  });

  it("prefers a more important item when relevance and confidence tie", async () => {
    const { store, engine } = retrieval();
    assertOk(store.store(draft({ key: "minor", summary: "alpha", importance: 0.2 })));
    assertOk(store.store(draft({ key: "major", summary: "alpha", importance: 0.95 })));
    assert.equal((await engine.retrieve(query({ text: "alpha" }))).items[0]?.key, "major");
  });

  it("prefers a more recent item when everything else ties", async () => {
    const { store, engine, clock } = retrieval();
    assertOk(store.store(draft({ key: "old", summary: "alpha" })));
    clock.advance(1_000);
    assertOk(store.store(draft({ key: "new", summary: "alpha" })));
    assert.equal((await engine.retrieve(query({ text: "alpha" }))).items[0]?.key, "new");
  });

  it("is deterministic: the same query returns the same order every time", async () => {
    const { store, engine } = retrieval();
    for (const key of ["c", "a", "b"]) {
      assertOk(store.store(draft({ key, summary: "alpha", importance: 0.5 })));
    }
    const first = (await engine.retrieve(query({ text: "alpha" }))).items.map((item) => item.key);
    for (let i = 0; i < 5; i += 1) {
      assert.deepEqual((await engine.retrieve(query({ text: "alpha" }))).items.map((item) => item.key), first);
    }
  });

  it("breaks an exact tie by id, not by insertion order", async () => {
    const { store, engine } = retrieval();
    assertOk(store.store(draft({ key: "z", summary: "alpha", importance: 0.5 })));
    assertOk(store.store(draft({ key: "a", summary: "alpha", importance: 0.5 })));
    const order = (await engine.retrieve(query({ text: "alpha" }))).items.map((item) => item.key);
    assert.deepEqual(order, ["a", "z"], "insertion order must not decide");
  });

  it("honours the limit", async () => {
    const { store, engine } = retrieval();
    for (let i = 0; i < 5; i += 1) {
      assertOk(store.store(draft({ key: `k${i}`, summary: "alpha" })));
    }
    assert.equal((await engine.retrieve(query({ text: "alpha", limit: 2 }))).hitCount, 2);
  });

  it("does not let recency outweigh relevance", async () => {
    const { store, engine, clock } = retrieval();
    assertOk(store.store(draft({ key: "fresh-irrelevant", summary: "unrelated words" })));
    clock.advance(1_000);
    assertOk(store.store(draft({ key: "stale-relevant", summary: "alpha" })));
    const result = await engine.retrieve(query({ text: "alpha" }));
    assert.equal(result.hitCount, 1);
    assert.equal(result.items[0]?.key, "stale-relevant");
  });

  it("exposes its weights so a deployment can see the ordering", () => {
    const scorer = new RetrievalScorer();
    assert.equal(scorer.weights.relevance, DEFAULT_RETRIEVAL_WEIGHTS.relevance);
    assert.ok(
      scorer.weights.relevance > scorer.weights.recency * 10,
      "relevance must dominate by construction, not by convention",
    );
  });

  it("returns no candidate rather than a zero score for an unrelated item", () => {
    const scorer = new RetrievalScorer();
    const item = buildMemoryItem(draft({ summary: "completely different words" }), START);
    assert.equal(scorer.score(item, query({ text: "alpha beta" }), START), null);
  });

  it("tokenises text without losing dotted capability names", () => {
    assert.ok(tokenise("check research.web today").includes("research.web"));
  });
});

describe("PHASE 05 — retrieval: explanations", () => {
  it("explains why each result was returned", async () => {
    const { store, engine } = retrieval();
    assertOk(store.store(draft({ key: "k", summary: "the deployment checklist" })));
    const result = await engine.retrieve(query({ text: "deployment", taskId: "t1" }));
    assert.ok(result.ranked.length > 0);
    const why = result.ranked[0]?.explanation;
    assert.ok(why);
    assert.match(why.reason, /deployment/);
    assert.match(why.reason, /t1/, "the explanation names the task it was retrieved for");
    assert.ok(why.strategies.length > 0);
    assert.ok(why.contributions.length > 0, "a score with no stated terms is not an explanation");
  });

  it("reports hit and examined counts a reader can trust", async () => {
    const { store, engine } = retrieval();
    assertOk(store.store(draft({ key: "a", summary: "alpha" })));
    assertOk(store.store(draft({ key: "b", summary: "beta" })));
    const result = await engine.retrieve(query({ text: "alpha" }));
    assert.equal(result.examinedCount, 2);
    assert.equal(result.hitCount, 1);
  });

  it("reports a miss as a miss, with a reason", async () => {
    const { engine } = retrieval();
    const result = await engine.retrieve(query({ text: "nothing" }));
    assert.equal(result.hitCount, 0);
    assert.match(result.explanation.reason, /No memory/);
  });

  it("measures its own latency rather than reporting zero", async () => {
    const { store, engine } = retrieval();
    assertOk(store.store(draft({ key: "a", summary: "alpha" })));
    const result = await engine.retrieve(query({ text: "alpha" }));
    assert.equal(typeof result.durationMs, "number");
  });
});

describe("PHASE 05 — retrieval: embeddings are a port, not a vendor", () => {
  class TestEmbeddings implements EmbeddingProvider {
    public readonly name = "test";
    public readonly dimensions = 3;
    /** PHASE 07 (D2): so a test can prove the provider was ACTUALLY consulted. */
    public calls = 0;
    #available: boolean;
    #failWith: string | null = null;

    public constructor(available = true) {
      this.#available = available;
    }

    public isAvailable(): Promise<boolean> {
      this.calls += 1;
      return Promise.resolve(this.#available);
    }

    public embed(texts: readonly string[]): Promise<readonly number[][]> {
      if (this.#failWith !== null) {
        return Promise.reject(new Error(this.#failWith));
      }
      return Promise.resolve(texts.map(() => [1, 0, 0]));
    }
  }

  it("reports semantic search as unavailable when no provider is configured", async () => {
    const { store, engine } = retrieval();
    assertOk(store.store(draft({ key: "a", summary: "alpha" })));
    const result = await engine.retrieve(query({ text: "alpha" }));
    assert.match(result.unavailableReason ?? "", /no embedding provider/);
  });

  it("still retrieves without one, degrading rather than pretending", async () => {
    const { store, engine } = retrieval();
    assertOk(store.store(draft({ key: "a", summary: "alpha" })));
    const result = await engine.retrieve(query({ text: "alpha" }));
    assert.equal(result.hitCount, 1, "the other strategies still work");
  });

  it("consults a provider when one is supplied, and reports it honestly", async () => {
    // PHASE 07 (D2). This test USED to assert `result.strategies.includes("semantic")`
    // with the title "uses a provider when one is supplied". That asserted the defect:
    // `#semanticStrategies` computed a query vector, DISCARDED it, and returned
    // `"semantic"` as a strategy that had run. The intent of the test - that a supplied
    // provider is actually consulted - is kept and made true; the assertion that it
    // produced a semantic result is corrected, because it did not.
    //
    // `DECISIONS.md` D-46 already rejected exactly this shape for MCP ("a stub shaped
    // like a client is a fabricated capability"). Here it was worse: `strategies` is
    // what a reader uses to judge WHY a memory surfaced.
    const embeddings = new TestEmbeddings();
    const provider = new InMemoryMemoryProvider();
    const store = new MemoryStore({ workspace: WS, provider, clock: new ManualClock(NOW) });
    const engine = new RetrievalEngine(store, { clock: new ManualClock(NOW), embeddings });
    assertOk(store.store(draft({ key: "a", summary: "alpha" })));
    const result = await engine.retrieve(query({ text: "alpha" }));

    // The provider WAS consulted - that is what this test was for.
    assert.equal(embeddings.calls, 1, "the supplied provider must actually be asked");
    // And because consulting it produces no match - there is no vector index - the
    // engine says so rather than claiming a strategy that did not run.
    assert.equal(
      result.strategies.includes("semantic"),
      false,
      "a computed-and-discarded vector is not a semantic search",
    );
    assert.match(result.unavailableReason ?? "", /semantic/i, "and the reason must name it");
  });

  it("reports a provider that is unavailable", async () => {
    const provider = new InMemoryMemoryProvider();
    const store = new MemoryStore({ workspace: WS, provider, clock: new ManualClock(NOW) });
    const engine = new RetrievalEngine(store, { clock: new ManualClock(NOW), embeddings: new TestEmbeddings(false) });
    assertOk(store.store(draft({ key: "a", summary: "alpha" })));
    const result = await engine.retrieve(query({ text: "alpha" }));
    assert.match(result.unavailableReason ?? "", /unavailable/);
  });

  it("reports a provider that throws, rather than failing the retrieval", async () => {
    const provider = new InMemoryMemoryProvider();
    const store = new MemoryStore({ workspace: WS, provider, clock: new ManualClock(NOW) });
    const engine = new RetrievalEngine(store, {
      clock: new ManualClock(NOW),
      embeddings: { name: "bad", dimensions: 1, isAvailable: () => Promise.resolve(true), embed: () => Promise.reject(new Error("down")) },
    });
    assertOk(store.store(draft({ key: "a", summary: "alpha" })));
    const result = await engine.retrieve(query({ text: "alpha" }));
    assert.match(result.unavailableReason ?? "", /embedding failed/);
    assert.equal(result.hitCount, 1, "a broken embedding backend must not break memory");
  });
});

/* ------------------------------------------------------------------ */
/* Write policy                                                        */
/* ------------------------------------------------------------------ */

describe("PHASE 05 — write policy", () => {
  const policy = new DefaultWritePolicy();

  it("refuses a candidate with no provenance", () => {
    const result = policy.evaluate({ ...draft(), provenance: { source: "system", sourceRef: "" } as MemoryProvenance }, START);
    assert.equal(result.decision, "refused");
    assert.ok(result.rules.includes("no_provenance"));
  });

  it("refuses a candidate with no summary", () => {
    const result = policy.evaluate(draft({ summary: "" }), START);
    assert.ok(result.rules.includes("empty_summary"));
  });

  it("refuses anything below the importance floor", () => {
    const result = policy.evaluate(draft({ type: "conversational", importance: 0.1 }), START);
    assert.equal(result.decision, "refused");
    assert.match(result.reason, /transcript archive/);
  });

  it("is the rule that stops a store becoming an archive", () => {
    const chat = policy.evaluate(draft({ type: "conversational" }), START);
    const decision = policy.evaluate(draft({ type: "decision" }), START);
    assert.equal(chat.decision, "refused");
    assert.notEqual(decision.decision, "refused");
  });

  it("refuses credential-shaped content that no human asserted", () => {
    const result = policy.evaluate(
      draft({ value: { password: "hunter2" }, sensitivity: "internal" }),
      START,
    );
    assert.equal(result.decision, "refused");
    assert.ok(result.rules.includes("sensitive_content"));
  });

  it("keeps credential-shaped content a person deliberately supplied", () => {
    const result = policy.evaluate(
      draft({ value: { password: "hunter2" }, sensitivity: "restricted", provenance: provenance({ source: "human" }) }),
      START,
    );
    assert.notEqual(result.decision, "refused", "a person may decide to store a secret; a machine may not");
  });

  it("gives a conversational memory a short life", () => {
    const result = policy.evaluate(draft({ type: "conversational", importance: 0.5 }), START);
    assert.ok(result.draft?.expiresAt !== null && result.draft?.expiresAt !== undefined, "a thread is about the present");
  });

  it("never expires a fact, which is superseded rather than timed out", () => {
    const result = policy.evaluate(draft({ type: "semantic" }), START);
    assert.equal(result.draft?.expiresAt, null);
  });

  it("derives confidence from provenance rather than from a stated field", () => {
    const low = derivedConfidence(draft({ provenance: provenance({ source: "agent", verification: null }) }));
    const high = derivedConfidence(draft({ provenance: provenance({ source: "human" }) }));
    assert.equal(low.level, "low");
    assert.equal(high.level, "high");
  });

  it("demotes an unverified agent claim even when the writer states confidence", () => {
    const result = policy.evaluate(
      draft({
        provenance: provenance({ source: "agent", verification: null }),
        confidence: { level: "certain", score: 1, reasons: ["trust me"] },
      }),
      START,
    );
    assert.equal(result.draft?.confidence?.level, "low", "an agent's word about its own work is a claim, not a measurement");
  });

  it("keeps a permanent failure as a lesson and a transient one as noise", () => {
    const permanent = policy.evaluate(
      draft({ type: "episodic", importance: 0.6, provenance: provenance({ outcome: "failed", errorClass: "invalid_request" }) }),
      START,
    );
    const transient = policy.evaluate(
      draft({ type: "episodic", importance: 0.6, provenance: provenance({ outcome: "failed", errorClass: "timeout" }) }),
      START,
    );
    assert.equal(permanent.draft?.confidence?.level, "medium");
    assert.equal(transient.draft?.confidence?.level, "low");
    assert.ok((transient.draft?.expiresAt ?? 0) > 0, "environmental noise should not become a durable belief");
  });

  it("states which rules fired, on every decision", () => {
    const accepted = policy.evaluate(draft(), START);
    const refused = policy.evaluate(draft({ summary: "" }), START);
    assert.ok(accepted.rules.length > 0);
    assert.ok(refused.rules.length > 0);
    assert.ok(accepted.reason.includes("rules:"));
  });

  it("reports a refused candidate's reason in words", () => {
    const result = policy.evaluate(draft({ importance: 0.05 }), START);
    assert.match(result.reason, /Importance/);
  });

  it("bounds a stated importance to the ceiling", () => {
    // PHASE 07: this asserted `importance: 99` clamps to exactly 1 - the POLICY
    // ceiling. It is still bounded, but by the tighter of the two ceilings now in play:
    // the policy's and the SCOPE's. `task` is breadth 1 of 0..10, so its scope ceiling
    // is 0.9.
    //
    // Both are asserted separately below, because "bounded" is now the conjunction of
    // two rules and a test that only saw one of them would pass if the other were
    // removed.
    const result = policy.evaluate(draft({ importance: 99 }), START);
    assert.equal(result.draft?.importance, 0.9, "bounded by the scope ceiling for `task`");
    assert.ok(result.rules.includes("importance_ceiling"), "and the rule that did it is reported");
  });

  it("applies the policy ceiling when it is the tighter of the two", () => {
    const tight = new DefaultWritePolicy({ importanceCeiling: 0.5 });
    const result = tight.evaluate(draft({ importance: 99 }), START);
    assert.equal(result.draft?.importance, 0.5, "the policy ceiling wins when it is lower than the scope's 0.9");
    assert.ok(result.rules.includes("importance_ceiling"));
  });

  it("refuses everything when the policy ceiling is below the floor", () => {
    // The interaction between the two rules, pinned because it is reachable by
    // configuration and surprising otherwise: a ceiling of 0.25 bounds every candidate
    // to 0.25, which is below the 0.35 floor, so nothing is ever stored. That is
    // coherent - "remember nothing" - but it presents as a policy that rejects every
    // write rather than as a ceiling, so it is asserted rather than left to be
    // discovered in production.
    const unusable = new DefaultWritePolicy({ importanceCeiling: 0.25 });
    const result = unusable.evaluate(draft({ importance: 99 }), START);
    assert.equal(result.draft, null, "nothing clears a ceiling below the floor");
    assert.equal(result.decision, "refused");
    assert.ok(result.rules.includes("below_importance_floor"), "and it says which rule refused");
  });

  it("does not report importance_ceiling when nothing was clamped", () => {
    // The rule used to be pushed unconditionally, so it appeared in every decision's
    // rule list as though a constraint had been applied when no comparison had taken
    // place. A rule that always fires is noise in an audit trail.
    const result = policy.evaluate(draft({ scope: "conversation", importance: 0.5 }), START);
    assert.equal(result.rules.includes("importance_ceiling"), false, "nothing was clamped, so nothing is reported");
  });

  it("clamps a wide scope's importance to its floor, and says why it exists", () => {
    // `global` is breadth 10, so its ceiling computes to 0.0 and the 0.2 floor applies.
    // The floor is not decoration: a memory with importance 0 is never retrieved, so a
    // scope whose memories could all reach 0 would be a scope you paid to store and can
    // never read back.
    const result = policy.evaluate(draft({ scope: "global", importance: 1, type: "semantic" }), START);
    assert.equal(result.draft?.importance, 0.2, "the widest scope clamps at the floor");
    assert.ok(result.rules.includes("importance_ceiling"));
  });

  it("treats a non-finite importance as none", () => {
    const result = policy.evaluate(draft({ importance: Number.NaN }), START);
    assert.equal(typeof result.draft?.importance, "number");
  });

  it("flags a task-scoped memory with no task", () => {
    const result = policy.evaluate(draft({ scope: "task" }), START);
    assert.ok(result.rules.includes("scope_requires_task"), "a task memory with no task is unreachable in practice");
  });

  it("detects sensitive content by key, not by prose", () => {
    assert.equal(looksSensitive(draft({ value: { note: "the password policy is documented" } })), false);
    assert.equal(looksSensitive(draft({ value: { password: "x" }, sensitivity: "internal" })), true);
  });
});

/* ------------------------------------------------------------------ */
/* Learning                                                            */
/* ------------------------------------------------------------------ */

describe("PHASE 05 — learning events", () => {
  function store() {
    const clock = new ManualClock(NOW);
    return { clock, learning: new LearningEventStore({ clock }) };
  }

  it("records an event", () => {
    const { learning } = store();
    const event = learning.record({ kind: "task_succeeded", subject: "agent:a" });
    assert.equal(event.kind, "task_succeeded");
    assert.equal(learning.size(), 1);
  });

  it("never claims a policy acted on it", () => {
    const { learning } = store();
    assert.equal(learning.record({ kind: "task_succeeded", subject: "a" }).appliedPolicy, false);
  });

  it("reports a low confidence while evidence is thin", () => {
    const { learning } = store();
    assert.equal(learning.record({ kind: "task_failed", subject: "a" }).confidence.level, "low");
  });

  it("raises confidence as comparable events accumulate", () => {
    const { learning } = store();
    for (let i = 0; i < 3; i += 1) learning.record({ kind: "task_succeeded", subject: "a" });
    assert.equal(learning.record({ kind: "task_succeeded", subject: "a" }).confidence.level, "medium");
  });

  it("counts samples per subject and kind", () => {
    const { learning } = store();
    learning.record({ kind: "task_succeeded", subject: "a" });
    learning.record({ kind: "task_failed", subject: "a" });
    learning.record({ kind: "task_succeeded", subject: "a" });
    assert.equal(learning.sampleSizeFor("task_succeeded", "a"), 2);
    assert.equal(learning.sampleSizeFor("task_failed", "a"), 1);
  });

  it("filters by kind, subject and task", () => {
    const { learning } = store();
    learning.record({ kind: "task_succeeded", subject: "a", taskId: "t1" });
    learning.record({ kind: "task_failed", subject: "b", taskId: "t2" });
    assert.equal(learning.list({ kind: "task_failed" }).length, 1);
    assert.equal(learning.list({ subject: "a" }).length, 1);
    assert.equal(learning.forTask("t2").length, 1);
  });

  it("summarises a subject from its records", () => {
    const { learning } = store();
    learning.record({ kind: "task_succeeded", subject: "a" });
    learning.record({ kind: "task_failed", subject: "a" });
    learning.record({ kind: "output_corrected", subject: "a" });
    learning.record({ kind: "verification_result", subject: "a", detail: { verdict: "pass" } });
    const summary = learning.summarise("a");
    assert.equal(summary.total, 4);
    assert.equal(summary.succeeded, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.corrected, 1);
    assert.equal(summary.verifiedPass, 1);
  });

  it("bounds its history and reports the drop", () => {
    const learning = new LearningEventStore({ maxEvents: 2 });
    for (let i = 0; i < 4; i += 1) learning.record({ kind: "task_succeeded", subject: "a" });
    assert.equal(learning.size(), 2);
    assert.equal(learning.droppedCount, 2, "a truncated history is never mistaken for a complete one");
  });

  it("can be switched off entirely, without a caller branching", () => {
    assert.equal(new NullLearningEventSink().record({ kind: "task_succeeded", subject: "a" }), null);
  });

  it("covers every declared event kind", () => {
    const { learning } = store();
    const kinds = [
      "task_succeeded", "task_failed", "output_corrected", "user_correction", "preference_repeated",
      "agent_performance", "tool_performance", "routing_outcome", "verification_result", "model_result",
      "workflow_result", "memory_useful", "memory_not_useful",
    ] as const;
    for (const kind of kinds) learning.record({ kind, subject: "a" });
    assert.equal(learning.size(), kinds.length);
  });
});

/* ------------------------------------------------------------------ */
/* Ingestion                                                           */
/* ------------------------------------------------------------------ */

describe("PHASE 05 — knowledge ingestion", () => {
  function service(clock = new ManualClock(NOW)) {
    const provider = new InMemoryMemoryProvider();
    const store = new MemoryStore({ workspace: WS, provider, clock });
    const policy = new DefaultWritePolicy();
    return {
      clock,
      store,
      service: new IngestionService({ store, policy, clock, maximumContentLength: 500 }),
    };
  }

  it("ingests material a caller already holds", async () => {
    const { service: ingestion } = service();
    const report = await ingestion.ingest(
      new StaticKnowledgeIngestor({
        name: "docs",
        items: [{ id: "d1", title: "Architecture", content: "the layers", reference: null, topic: "arch", sourceRef: "docs" }],
      }),
    );
    assert.equal(report.ingested.length, 1);
    assert.equal(report.refused.length, 0);
  });

  it("reports an unreachable source rather than throwing", async () => {
    const { service: ingestion } = service();
    const report = await ingestion.ingest(new UnreachableKnowledgeIngestor("github", "not configured"));
    assert.equal(report.ingested.length, 0);
    assert.match(report.refused[0]?.reason ?? "", /not configured/);
  });

  it("refuses empty content", () => {
    const { service: ingestion } = service();
    const report = ingestion.ingestItems(
      [{ id: "d1", title: "Empty", content: "   ", reference: null, topic: "t", sourceRef: "s" }],
      "s",
    );
    assert.match(report.refused[0]?.reason ?? "", /Empty content/);
  });

  it("refuses material too large to retrieve usefully", () => {
    const { service: ingestion } = service();
    const report = ingestion.ingestItems(
      [{ id: "big", title: "Big", content: "x".repeat(600), reference: null, topic: "t", sourceRef: "s" }],
      "s",
    );
    assert.match(report.refused[0]?.reason ?? "", /above the 500 limit/);
  });

  it("refuses metadata carrying a credential-shaped key", () => {
    const { service: ingestion } = service();
    const report = ingestion.ingestItems(
      [{ id: "d1", title: "T", content: "c", reference: null, topic: "t", sourceRef: "s", metadata: { attributes: { apiKey: "x" } } }],
      "s",
    );
    assert.match(report.refused[0]?.reason ?? "", /credential-shaped/);
  });

  it("skips an item already held under the same id", () => {
    const { service: ingestion } = service();
    const item = { id: "d1", title: "T", content: "c", reference: null as string | null, topic: "t", sourceRef: "s" };
    ingestion.ingestItems([item], "s");
    const second = ingestion.ingestItems([item], "s");
    assert.deepEqual(second.skipped, ["d1"]);
  });

  it("gives verified material higher confidence than unverified", () => {
    const { service: ingestion } = service();
    const report = ingestion.ingestItems(
      [
        { id: "v", title: "V", content: "c", reference: null, topic: "t", sourceRef: "s", verification: "pass" },
        { id: "u", title: "U", content: "c", reference: null, topic: "t", sourceRef: "u" },
      ],
      "s",
    );
    // Matched by title: a `KnowledgeItem.id` is the memory id, which carries the
    // scope and a sequence, not the connector's own identifier.
    const verified = report.ingested.find((item) => item.topic === "t" && item.content === "c" && item.confidence.level === "high");
    const unverified = report.ingested.find((item) => item.confidence.level === "medium");
    assert.equal(report.ingested.length, 2);
    assert.equal(verified?.provenance.verification, "pass");
    assert.equal(unverified?.provenance.verification, null);
  });

  it("stores ingested material as internal, never public", () => {
    const { service: ingestion, store } = service();
    ingestion.ingestItems(
      [{ id: "d1", title: "T", content: "c", reference: null, topic: "t", sourceRef: "s" }],
      "s",
    );
    const stored = store.listScope("knowledge")[0];
    assert.equal(stored?.sensitivity, "internal", "a connected source is a reason to trust its origin, not to publish");
  });

  it("lands knowledge in the scope the caller chose", () => {
    const provider = new InMemoryMemoryProvider();
    const store = new MemoryStore({ workspace: WS, provider, clock: new ManualClock(NOW) });
    const ingestion = new IngestionService({
      store,
      policy: new DefaultWritePolicy(),
      clock: new ManualClock(NOW),
      scopeFor: (topic) => (topic === "team" ? "project" : "knowledge"),
    });
    ingestion.ingestItems(
      [{ id: "d1", title: "T", content: "c", reference: null, topic: "team", sourceRef: "s" }],
      "s",
    );
    assert.equal(store.listScope("project").length, 1);
  });
});

/* ------------------------------------------------------------------ */
/* The service                                                         */
/* ------------------------------------------------------------------ */

/**
 * A service with grants already issued.
 *
 * The grants are explicit because nothing is granted by default: a helper that
 * quietly granted everything would hide the very rule these tests exist to
 * check. `grantSystem` is the one the orchestrator needs.
 */
function service(options: { learning?: boolean; access?: boolean; traces?: boolean; grantSystem?: boolean } = {}) {
  const clock = new ManualClock(NOW);
  const provider = new InMemoryMemoryProvider();
  const store = new MemoryStore({ workspace: WS, provider, clock });
  const engine = new RetrievalEngine(store, { clock });
  const policy = new DefaultWritePolicy();
  const learning = new LearningEventStore({ clock });
  const access = new MemoryAccessPolicy(clock);
  const audit = new AuditLog({ clock });
  const traces = new TraceRecorder(audit);
  const memory = new MemoryService({
    store,
    retrieval: engine,
    policy,
    learning,
    ...(options.access === false ? {} : { access }),
    ...(options.traces === false ? {} : { traces }),
    recordLearning: options.learning ?? false,
  });
  if (options.grantSystem !== false && options.access !== false) {
    // The orchestrator writes as `system`, and nothing is granted by default, so a
    // deployment that wants memory must say so here. That is the rule under test.
    access.grant({
      // PHASE 07: `knowledge` - the widest of the four scopes granted below, and the
      // breadth ceiling the phase added would otherwise refuse three of them.
      subject: { workspace: WS, id: "system", operatingScope: "knowledge" },
      scopes: ["task", "project", "agent", "knowledge"],
      writableScopes: ["task", "project", "agent", "knowledge"],
      minimumTrust: "untrusted",
      expiresAt: null,
    });
  }
  return { clock, store, engine, learning, access, audit, traces, memory };
}
function grant(policy: MemoryAccessPolicy, overrides: Partial<MemoryGrant> = {}): void {
  policy.grant({
    // PHASE 07: `project`, because this helper's default grant is `["task","project"]`
    // and the new breadth ceiling would otherwise strip `project` from every test that
    // uses it - silently changing what they assert rather than failing them.
    subject: { workspace: WS, id: "agent:a", operatingScope: "project" },
    scopes: ["task", "project"],
    writableScopes: ["task"],
    minimumTrust: "untrusted",
    expiresAt: null,
    ...overrides,
  });
}

describe("PHASE 05 — service: capture", () => {
  it("stores an acceptable candidate", () => {
    const { memory } = service();
    const result = memory.capture({
      scope: "task",
      key: "k1",
      type: "semantic",
      value: { fact: "x" },
      summary: "A fact",
      subject: { workspace: WS, id: "system", operatingScope: "task" },
      taskId: "t1",
    });
    assert.notEqual(result.item, null);
    assert.equal(result.evaluation.decision !== "refused", true);
  });

  it("refuses a write to a scope the subject was not granted", () => {
    const { memory, access } = service();
    grant(access, { scopes: ["task"], writableScopes: [] });
    const result = memory.capture({
      scope: "task",
      key: "k1",
      type: "semantic",
      value: {},
      summary: "A fact",
      subject: { workspace: WS, id: "agent:a", operatingScope: "task" },
    });
    assert.equal(result.item, null);
    assert.match(result.evaluation.reason, /not granted/);
  });

  it("allows a write to a writable scope", () => {
    const { memory, access } = service();
    grant(access);
    const result = memory.capture({
      scope: "task",
      key: "k1",
      type: "semantic",
      value: {},
      summary: "A fact",
      subject: { workspace: WS, id: "agent:a", operatingScope: "task" },
    });
    assert.notEqual(result.item, null);
  });

  it("reports a policy refusal rather than silently dropping it", () => {
    const { memory } = service();
    const result = memory.capture({
      scope: "task",
      key: "trivial",
      type: "conversational",
      value: {},
      summary: "chatter",
      subject: { workspace: WS, id: "system", operatingScope: "task" },
      importance: 0.05,
    });
    assert.equal(result.item, null);
    assert.match(result.evaluation.reason, /Importance/);
  });

  it("records a learning event when a capture supersedes a belief", () => {
    const { memory, learning } = service({ learning: true });
    memory.capture({ scope: "task", key: "k", type: "semantic", value: { v: 1 }, summary: "one", subject: { workspace: WS, id: "system", operatingScope: "task" } });
    memory.capture({ scope: "task", key: "k", type: "semantic", value: { v: 2 }, summary: "two", subject: { workspace: WS, id: "system", operatingScope: "task" } });
    assert.ok(learning.list().length > 0, "the system changed its mind, and that is worth recording");
  });
});

describe("PHASE 05 — service: recall and scope isolation", () => {
  it("returns nothing for a query with no readable scope", async () => {
    const { memory, access } = service();
    grant(access, { scopes: [], writableScopes: [] });
    const result = await memory.recall({ workspace: WS, id: "agent:a", operatingScope: "task" }, { text: "x", scopes: ["task"], limit: 5 });
    assert.equal(result.retrieval.hitCount, 0);
    assert.deepEqual(result.refusedScopes, ["task"]);
  });

  it("names the scopes it refused, rather than dropping them silently", async () => {
    const { memory, access, store } = service();
    grant(access, { scopes: ["task"], writableScopes: [] });
    assertOk(store.store(draft({ scope: "global", key: "g", summary: "a global rule" })));
    const result = await memory.recall({ workspace: WS, id: "agent:a", operatingScope: "task" }, { text: "global", scopes: ["task", "global"], limit: 5 });
    assert.deepEqual(result.refusedScopes, ["global"], "the caller should see that it could not read it");
    assert.equal(result.retrieval.hitCount, 0);
  });

  it("searches only the intersection of query and grant", async () => {
    const { memory, access, store } = service();
    grant(access, { scopes: ["task"], writableScopes: [] });
    assertOk(store.store(draft({ scope: "task", key: "t", summary: "alpha" })));
    assertOk(store.store(draft({ scope: "project", key: "p", summary: "alpha" })));
    const result = await memory.recall({ workspace: WS, id: "agent:a", operatingScope: "task" }, { text: "alpha", scopes: ["task", "project"], limit: 5 });
    assert.equal(result.retrieval.hitCount, 1);
    assert.deepEqual(result.searchedScopes, ["task"]);
  });

  it("does not let a caller widen its own access by naming a scope", async () => {
    const { memory, access, store } = service();
    grant(access, { scopes: ["task"], writableScopes: [] });
    assertOk(store.store(draft({ scope: "global", key: "g", summary: "alpha" })));
    const result = await memory.recall({ workspace: WS, id: "agent:a", operatingScope: "task" }, { text: "alpha", scopes: ["global"], limit: 5 });
    assert.equal(result.retrieval.hitCount, 0, "naming a scope does not grant it");
  });

  it("builds a query from the subject's readable scopes", () => {
    const { memory, access } = service();
    grant(access, { scopes: ["task", "project"], writableScopes: [] });
    const built = memory.queryFor({ workspace: WS, id: "agent:a", operatingScope: "task" }, { text: "x", limit: 3 });
    assert.deepEqual([...built.scopes].sort(), ["project", "task"]);
  });

  it("gives an agent the same authorisation as the orchestrator", async () => {
    const { memory, access, store } = service();
    grant(access, { scopes: ["task"], writableScopes: [] });
    assertOk(store.store(draft({ scope: "task", key: "t", summary: "alpha" })));
    const viaAgent = await memory.recallForAgent({ workspace: WS, id: "agent:a", operatingScope: "task" }, { text: "alpha", scopes: ["global"], limit: 5 });
    assert.equal(viaAgent.retrieval.hitCount, 0, "an agent path must not be a way around the policy");
  });
});

describe("PHASE 05 — service: correction and invalidation", () => {
  it("corrects a memory and keeps the original marked", () => {
    const { memory, store } = service();
    const captured = memory.capture({
      scope: "task", key: "k", type: "semantic", value: { v: 1 }, summary: "one", subject: { workspace: WS, id: "system", operatingScope: "task" },
    });
    assert.ok(captured.item);
    const id = captured.item.id;
    const corrected = memory.correct(id, {
      subject: { workspace: WS, id: "system", operatingScope: "task" },
      type: "semantic",
      value: { v: 2 },
      summary: "two",
      provenance: provenance(),
    });
    assert.equal(corrected.ok, true);
    assert.ok(store.listScope("task", { includeInactive: true }).some((item) => item.status === "superseded"));
  });

  it("refuses a correction from a subject that may not write", () => {
    const { memory, access } = service();
    grant(access, { scopes: ["task"], writableScopes: [] });
    const captured = memory.capture({
      scope: "task", key: "k", type: "semantic", value: { v: 1 }, summary: "one", subject: { workspace: WS, id: "system", operatingScope: "task" },
    });
    assert.ok(captured.item);
    const result = memory.correct(captured.item.id, {
      subject: { workspace: WS, id: "agent:a", operatingScope: "task" },
      type: "semantic",
      value: { v: 2 },
      summary: "two",
      provenance: provenance(),
    });
    assert.equal(result.ok, false);
  });

  it("stops returning an invalidated memory", () => {
    const { memory, store } = service();
    const captured = memory.capture({
      scope: "task", key: "k", type: "semantic", value: {}, summary: "s", subject: { workspace: WS, id: "system", operatingScope: "task" },
    });
    assert.ok(captured.item);
    assert.equal(memory.invalidate(captured.item.id, "retracted", { workspace: WS, id: "system", operatingScope: "task" }).ok, true);
    assert.equal(store.get("task", "k"), null);
  });

  it("reports an unknown memory rather than throwing", () => {
    const { memory } = service();
    assert.equal(memory.invalidate("nope", "x", { workspace: WS, id: "system", operatingScope: "task" }).ok, false);
    assert.equal(memory.correct("nope", { subject: { workspace: WS, id: "system", operatingScope: "task" }, type: "semantic", value: {}, summary: "s", provenance: provenance() }).ok, false);
  });
});

describe("PHASE 05 — service: learning and observability", () => {
  it("records nothing until learning is switched on", () => {
    const { memory, learning } = service();
    assert.equal(memory.learn({ kind: "task_succeeded", subject: "a" }), false);
    assert.equal(learning.size(), 0);
  });

  it("records the events an outcome implies", () => {
    const { memory, learning } = service({ learning: true });
    memory.learnFromOutcome({
      taskId: "t1", traceId: "tr", agents: ["a@1"], succeeded: true,
      verificationVerdict: "pass", errorClass: null, escalated: false,
    });
    assert.equal(learning.list({ kind: "task_succeeded" }).length, 1);
    assert.equal(learning.list({ kind: "verification_result" }).length, 1);
  });

  it("never marks a learning event as having changed policy", () => {
    const { memory, learning } = service({ learning: true });
    memory.learnFromOutcome({
      taskId: "t1", traceId: "tr", agents: ["a@1"], succeeded: true,
      verificationVerdict: "pass", errorClass: null, escalated: false,
    });
    assert.ok(learning.list().every((event) => event.appliedPolicy === false));
  });

  it("records a memory read into the shared audit history", async () => {
    const { memory, access, store, audit } = service();
    grant(access);
    assertOk(store.store(draft({ scope: "task", key: "k", summary: "alpha" })));
    await memory.recall({ workspace: WS, id: "agent:a", operatingScope: "task" }, { text: "alpha", scopes: ["task"], limit: 5 });
    const events = audit.read({ workspace: null, brand: null }).filter((event) => event.kind === "orchestration_event");
    assert.ok(events.some((event) => (event as { step: string }).step === "memory_read"));
  });

  it("records a memory write into the shared audit history", () => {
    const { memory, audit } = service();
    memory.capture({ scope: "task", key: "k", type: "semantic", value: {}, summary: "s", subject: { workspace: WS, id: "system", operatingScope: "task" } });
    const events = audit.read({ workspace: null, brand: null }).filter((event) => event.kind === "orchestration_event");
    assert.ok(events.some((event) => (event as { step: string }).step === "memory_written"));
  });

  it("records a refused write, with its reason", () => {
    const { memory, access, audit } = service();
    grant(access, { scopes: ["task"], writableScopes: [] });
    memory.capture({ scope: "task", key: "k", type: "semantic", value: {}, summary: "s", subject: { workspace: WS, id: "agent:a", operatingScope: "task" } });
    const events = audit.read({ workspace: null, brand: null }).filter((event) => event.kind === "orchestration_event");
    assert.ok(events.some((event) => (event as { step: string }).step === "memory_write_refused"));
  });

  it("counts reads, writes and refusals", async () => {
    const { memory, access, store } = service();
    grant(access);
    memory.capture({ scope: "task", key: "k", type: "semantic", value: {}, summary: "s", subject: { workspace: WS, id: "agent:a", operatingScope: "task" } });
    await memory.recall({ workspace: WS, id: "agent:a", operatingScope: "task" }, { text: "s", scopes: ["task"], limit: 5 });
    assertOk(store.store(draft({ scope: "task", key: "k2", summary: "s" })));
    const metrics = memory.metrics();
    assert.equal(metrics.writes, 1);
    assert.equal(metrics.reads, 1);
    assert.ok(metrics.stored >= 1);
  });
});

describe("PHASE 05 - the agent capability path", () => {
  // An agent reaches memory through `queryFor`/`recallForAgent`, never by being
  // handed the store. These are the only doors, so they are the ones that matter.

  it("builds an agent query from the scopes that subject may actually read", () => {
    const { memory, access } = service();
    // PHASE 07: `operatingScope: "project"` - the grant names `project`, so a subject
    // operating at `task` would have it stripped by the breadth ceiling and this test
    // would then be asserting the CEILING rather than what it is about, which is
    // `queryFor` reflecting the grant instead of every scope.
    grant(access, { subject: { workspace: WS, id: "agent:a", operatingScope: "project" }, scopes: ["task", "project"] });
    const query = memory.queryFor({ workspace: WS, id: "agent:a", operatingScope: "project" }, { text: "the outage", limit: 3 });
    assert.deepEqual(query.scopes, ["task", "project"], "an agent sees its own grant, not every scope");
    assert.equal(query.limit, 3);
  });

  it("drops a scope the agent named but was never granted", () => {
    const { memory, access } = service();
    grant(access, { subject: { workspace: WS, id: "agent:a", operatingScope: "task" }, scopes: ["task"] });
    const query = memory.queryFor({ workspace: WS, id: "agent:a", operatingScope: "task" }, {
      text: "the outage",
      limit: 3,
      scopes: ["task", "global"],
    });
    // A requested scope is an ASK, not a grant. Honouring it here would be the
    // entire vulnerability, and it would be invisible in every other layer.
    assert.deepEqual(query.scopes, ["task"]);
  });

  it("gives an ungranted agent no scopes at all", () => {
    const { memory } = service();
    assert.deepEqual(
      memory.queryFor({ workspace: WS, id: "stranger", operatingScope: "task" }, { text: "anything", limit: 3 }).scopes,
      [],
      "nothing is readable by default",
    );
  });

  it("records a read that came through the capability path", async () => {
    const { memory, access, audit } = service();
    grant(access, { subject: { workspace: WS, id: "agent:a", operatingScope: "task" }, scopes: ["task", "project"] });
    await memory.recallForAgent({ workspace: WS, id: "agent:a", operatingScope: "task" }, { text: "outage", scopes: ["task"], limit: 3 });
    const events = audit.read({ workspace: null, brand: null }).filter((event) => event.kind === "orchestration_event");
    assert.ok(
      events.some((event) => (event as { step: string }).step === "memory_read"),
      "a read through the agent door is auditable, the same as any other",
    );
  });

  it("refuses an agent recall outright when the subject has no grant", async () => {
    const { memory } = service();
    const result = await memory.recallForAgent(
      { workspace: WS, id: "stranger", operatingScope: "task" },
      { text: "outage", scopes: ["task"], limit: 3 },
    );
    assert.equal(result.retrieval.items.length, 0);
    assert.equal(result.searchedScopes.length, 0);
  });
});

describe("PHASE 05 — the service is not a second orchestrator", () => {
  it("exposes no execution entry point", () => {
    const { memory } = service();
    const surface = memory as unknown as Record<string, unknown>;
    assert.equal(surface["execute"], undefined, "memory cannot run a task");
    assert.equal(surface["orchestrate"], undefined);
    assert.equal(surface["selectAgent"], undefined);
    assert.equal(surface["advanceState"], undefined);
  });

  it("holds no reference to the orchestrator, pool or router", () => {
    const { memory } = service();
    const fields = Object.getOwnPropertyNames(memory).filter((name) => name.startsWith("#"));
    assert.equal(fields.length, 0, "a memory service with no public state has nothing to reach the authority through");
  });
});
