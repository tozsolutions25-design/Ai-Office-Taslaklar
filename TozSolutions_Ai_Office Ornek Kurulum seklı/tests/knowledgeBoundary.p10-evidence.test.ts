/**
 * PHASE 10 EVIDENCE - the knowledge boundary, and the port nothing consults.
 *
 * ## WHAT THIS PHASE FOUND, AND IT IS NOT WHAT THE TODO PREDICTED
 *
 * `TODO.md` PHASE 10 listed four items. Three were already true and are now pinned:
 *
 *   1. "`EmbeddingProvider` is a port with no implementation... do not ship a fake." TRUE.
 *   2. "`IngestionService` / `StaticKnowledgeIngestor` / `UnreachableKnowledgeIngestor` are
 *      boundary-only." TRUE — and they live in `memory/ingestion.ts`, not under
 *      `knowledge/`, which the TODO's phrasing did not say.
 *   4. "Retrieval relevance must remain a gate, not a ranking nicety." TRUE, and worth
 *      recording HOW: the gate is in `RetrievalScorer.score` (`retrieval.ts`), not in
 *      `RetrievalEngine.#passesFilters` as the item's phrasing implies. An audit that only
 *      read the filter would have concluded the gate was missing and "fixed" a system that
 *      was already correct. It was already tested too.
 *
 * Item 3 — "Decide the AnythingLLM / RAG relationship" — is where the work is, and the
 * decision was not the one the item expected. `KnowledgeProvider` is accepted by
 * `createRuntime`, threaded all the way into `Core`, and **never queried by anything in
 * `src/`**. So `createRuntime({ knowledge })` changes nothing observable: a deployment could
 * attach a full RAG backend and no run would consult it, and `describe()` said nothing either
 * way.
 *
 * That is the fabricated-capability shape `DECISIONS.md` D-53 names, and the honest position
 * is NOT to build the integration here: AnythingLLM is PHASE 13's external boundary, and
 * `TODO.md` says "keep it a port until real". So this phase makes the boundary HONEST — the
 * runtime reports what it holds and states that nothing consults it — and asserts the absence,
 * so that when Phase 13 wires a real backend, the assertion that changes is a deliberate act.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { ManualClock } from "../src/core/clock.js";
import { createRuntime } from "../src/orchestration/composition.js";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";
import { IngestionService, StaticKnowledgeIngestor, UnreachableKnowledgeIngestor } from "../src/orchestration/memory/ingestion.js";
import { InMemoryMemoryProvider } from "../src/orchestration/memory/memory.js";
import { DefaultWritePolicy } from "../src/orchestration/memory/policy.js";
import { MemoryStore } from "../src/orchestration/memory/store.js";
import { NullKnowledgeProvider } from "../src/knowledge/port.js";

const NOW = new Date("2026-04-01T00:00:00.000Z");
const WS = workspaceRef("phase-10-workspace");

const SRC_FILES: readonly string[] = (() => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".ts")) found.push(full);
    }
  };
  walk(path.join(process.cwd(), "src"));
  return found;
})();

/** Source with comments and strings removed, so an assertion about CODE ignores PROSE. */
function codeOf(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/`(?:[^`\\]|\\.)*`/g, '""')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

describe("PHASE 10 EVIDENCE - the knowledge boundary", () => {
  /* -- 1. ports stay ports -------------------------------------------------- */

  it("ships no knowledge or embedding implementation", () => {
    // "Keep it a port; do not ship a fake." The only permitted implementation is the honest
    // unavailable one — the Phase 05 `UnavailableAgentAdapter` precedent. A fake that
    // returned documents would be indistinguishable from an integration until the first
    // deployment needed it to be real.
    const implementors: string[] = [];
    for (const file of SRC_FILES) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/implements\s+(KnowledgeProvider|EmbeddingProvider|KnowledgeIngestor)\b/g)) {
        implementors.push(`${path.basename(file)}: ${match[1]}`);
      }
    }
    assert.deepEqual(
      implementors.sort(),
      ["ingestion.ts: KnowledgeIngestor", "ingestion.ts: KnowledgeIngestor", "port.ts: KnowledgeProvider"],
      "exactly three, and the two ingestors are TODO item 2's boundary-only pair: no embedding implementation at all, and no second knowledge provider",
    );
    assert.equal(
      implementors.some((entry) => entry.includes("EmbeddingProvider")),
      false,
      "an embedding provider has NO implementation - not even an unavailable one - because retrieval already reports that capability as missing on its own",
    );
  });

  it("answers `knowledge_unavailable` rather than pretending or throwing", async () => {
    const provider = new NullKnowledgeProvider();
    assert.equal(await provider.isAvailable(), false, "being unavailable is a normal state, not an error");
    const result = await provider.query({ text: "anything", topK: 5, workspace: "acme" });
    assert.equal(result.available, false);
    assert.deepEqual(result.documents, [], "and it invents nothing");
    assert.equal(result.reason, "knowledge_unavailable", "naming why");
  });

  /* -- 2. the ingestion classes are a boundary, and stay one ---------------- */

  it("exports three ingestion implementations that the composition root never composes", () => {
    // A boundary that the runtime quietly instantiates is an integration. Asserting that
    // `createRuntime` does NOT build one is what keeps "boundary-only" a fact rather than a
    // TODO's aspiration.
    assert.equal(typeof IngestionService, "function", "IngestionService exists");
    assert.equal(typeof StaticKnowledgeIngestor, "function", "StaticKnowledgeIngestor exists");
    assert.equal(typeof UnreachableKnowledgeIngestor, "function", "UnreachableKnowledgeIngestor exists");

    const composition = codeOf("src/orchestration/composition.ts");
    for (const forbidden of ["IngestionService", "StaticKnowledgeIngestor", "UnreachableKnowledgeIngestor"]) {
      assert.doesNotMatch(
        composition,
        new RegExp(forbidden),
        `the composition root must not construct ${forbidden}; an ingestion boundary is Phase 13's to wire`,
      );
    }
  });

  it("reports an unreachable ingestor as unreachable rather than ingesting nothing", async () => {
    const store = new MemoryStore({
      workspace: WS,
      provider: new InMemoryMemoryProvider(),
      clock: { nowMs: () => NOW.getTime(), now: () => NOW, sleep: async () => {} },
    });
    const service = new IngestionService({ store, policy: new DefaultWritePolicy(), clock: { nowMs: () => NOW.getTime(), now: () => NOW, sleep: async () => {} }, maximumContentLength: 500 });
    const report = await service.ingest(new UnreachableKnowledgeIngestor("github", "not configured"));
    // The shape the report actually has: no `status` field, so an unreachable source shows up
    // as a refusal carrying the source's own reason. A silent empty report would be
    // indistinguishable from "there was nothing to ingest".
    assert.equal(report.ingested.length, 0, "nothing is ingested");
    assert.match(report.refused[0]?.reason ?? "", /not configured/, "and carries the reason it gave");
  });

  /* -- 3. relevance is a gate, in the scorer, and it stays one -------------- */

  it("returns nothing for a query whose terms match nothing, however recent the item", async () => {
    // `TODO.md` item 4. The gate lives in `RetrievalScorer.score`, which returns `null` for a
    // non-matching item — NOT in `RetrievalEngine.#passesFilters`, which has no score floor at
    // all. An audit that read only the filter would have "fixed" a system that was already
    // correct, so this test is behavioural and says what a caller observes.
    const runtime = createRuntime({ clock: new ManualClock(NOW), workspace: WS });
    const store = runtime.memoryStore;
    const service = runtime.memoryService;
    assert.ok(store !== null, "a runtime that declares a workspace composes a memory store");
    assert.ok(service !== null, "and a memory service");
    const subject = {
      id: "agent:a",
      workspace: WS,
      operatingScope: "task" as const,
      trustLevel: "standard" as const,
    };
    runtime.memoryPolicy.grant({
      subject,
      scopes: ["task"],
      writableScopes: ["task"],
      minimumTrust: "untrusted",
      expiresAt: null,
    });
    const written = store.store({
      scope: "task",
      key: "fresh-irrelevant",
      type: "semantic",
      value: { text: "content" },
      summary: "entirely unrelated words about gardening",
      importance: 0.9,
      provenance: {
        source: "system",
        sourceRef: "test:1",
        sourceReference: "test:1",
        taskId: "t1",
        traceId: null,
        observedAt: NOW.getTime(),
        verification: null,
      },
    });
    assert.ok(written.ok, "the write must succeed");

    const miss = await service.recall(subject, { text: "quarterly revenue", scopes: ["task"], limit: 5 });
    assert.equal(
      miss.retrieval.hitCount,
      0,
      "a recent, important memory that matches no query term must NOT be returned",
    );

    const hit = await service.recall(subject, { text: "gardening", scopes: ["task"], limit: 5 });
    assert.equal(hit.retrieval.hitCount, 1, "and the same memory IS returned when it does match");
  });

  /* -- 4. the port nothing consults, reported honestly --------------------- */

  it("reports the knowledge layer's state rather than accepting one silently", () => {
    // The gap this phase closed. Before it, `createRuntime({ knowledge })` accepted a
    // provider, threaded it into `Core`, and `describe()` said nothing — so a deployment that
    // attached a backend had no way to learn that nothing consulted it.
    const bare = createRuntime({ clock: new ManualClock(NOW), workspace: WS });
    assert.equal(bare.describe().knowledge, "unattached");

    const attached = createRuntime({
      clock: new ManualClock(NOW),
      workspace: WS,
      knowledge: new NullKnowledgeProvider(),
    });
    assert.equal(
      attached.describe().knowledge,
      "attached-not-consulted",
      "and when one IS attached, the report must say that no path consults it",
    );
  });

  it("consults the knowledge provider NOWHERE, which is the thing Phase 13 will change", () => {
    // The honest counterpart to the report above. If this assertion ever fails, that is not a
    // regression — it means someone wired the integration, and this test should be replaced by
    // one asserting it is consulted correctly rather than deleted.
    for (const file of SRC_FILES) {
      if (file.endsWith(path.join("knowledge", "port.ts"))) continue;
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");
      lines.forEach((line, index) => {
        const text = line.trim();
        if (text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")) return;
        assert.doesNotMatch(
          text,
          /knowledge\.(query|isAvailable)\(/,
          `${path.basename(file)}:${index + 1} consults the knowledge provider; PHASE 10 asserts nothing does`,
        );
      });
    }
  });

  it("keeps the core free of any concrete knowledge import", () => {
    // `knowledge/port.ts` claims this as one of "two invariants this module exists to enforce"
    // — and nothing tested it. The claim is cheap to check and cheap to break by accident, so
    // it is checked from source, imports only.
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/^import[^;]*from\s+"([^"]*knowledge[^"]*)";/gm)) {
        const specifier = match[1];
        const allowed = specifier.endsWith("knowledge/port.js") || specifier.endsWith("knowledge/index.js");
        if (!allowed) offenders.push(`${path.basename(file)} -> ${specifier}`);
      }
    }
    assert.deepEqual(offenders, [], "only the knowledge PORT may be imported anywhere in src/");
  });

  it("asserts the port's own two invariants rather than only stating them", () => {
    // `port.ts` names them; this names them in a place that can fail. An invariant documented
    // in the module that depends on it is a comment.
    const port = readFileSync(path.join(process.cwd(), "src/knowledge/port.ts"), "utf8");
    assert.match(port, /BOUNDARY, not an integration/, "the module must still say what it is");
    assert.match(
      port,
      /NullKnowledgeProvider/,
      "and the honest unavailable implementation must still be named there",
    );
    // The behavioural half of invariant 2 is the first check in this file; this asserts the
    // declaration half exists, so the two cannot drift apart.
    assert.equal(typeof NullKnowledgeProvider.prototype.query, "function");
    assert.equal(typeof NullKnowledgeProvider.prototype.isAvailable, "function");
  });
});
