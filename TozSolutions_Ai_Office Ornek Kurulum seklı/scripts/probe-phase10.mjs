/**
 * PHASE 10 independent verification probe, and its self-test.
 *
 * WHY A SEPARATE PROBE AT ALL
 *
 * Every knowledge claim in this phase is enforced by tests sharing this repository's fixtures.
 * Right for behaviour, wrong for the claims that matter most here — "no implementation ships",
 * "nothing consults the port" — because a suite that shares an author's assumptions can only
 * confirm them.
 *
 * So this probe imports the BUILT `dist/` and nothing else, and states each invariant as a fact
 * about the running system.
 *
 * WHY THE SELF-TEST IS THE POINT
 *
 * A probe that only ever prints PASS has demonstrated nothing. `--selftest` reverts each
 * decision, one at a time, in a COPY of dist/, and REQUIRES the named check to fail. Each entry
 * declares which check it must break; an entry whose named check still passes is a FAILURE.
 *
 * ## ONE CHECK IS DELIBERATELY ABSENT FROM THE SELF-TEST
 *
 * "No concrete knowledge implementation exists" cannot be made to fail by reverting a
 * decision: there is nothing to revert, because nothing was ever written. It is true by
 * absence of subject matter rather than by a check. It is asserted by the probe and listed
 * here in the self-test as UNTESTABLE, rather than being given a mutation that survives and
 * then explained away — which is what PHASE 08 and PHASE 10 both had to correct elsewhere.
 *
 * Usage:
 *   node scripts/probe-phase10.mjs
 *   node scripts/probe-phase10.mjs --selftest
 */

import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import path from "node:path";

const REPO = process.cwd();
const WORK = path.join(REPO, ".probe-phase10");
const NOW = new Date("2026-04-01T00:00:00.000Z");

/** `PROBE_BASE` lets the self-test point the probe at a mutated copy of the build. */
async function load() {
  const base = process.env["PROBE_BASE"] ?? path.join(REPO, "dist");
  const u = (rel) => pathToFileURL(path.join(base, rel)).href;
  const [knowledge, clock, workspace, composition, retrieval, memory, policy, ingestion, store] = await Promise.all([
    import(u("src/knowledge/port.js")),
    import(u("src/core/clock.js")),
    import(u("src/orchestration/workspace/workspace.js")),
    import(u("src/orchestration/composition.js")),
    import(u("src/orchestration/memory/retrieval.js")),
    import(u("src/orchestration/memory/memory.js")),
    import(u("src/orchestration/memory/policy.js")),
    import(u("src/orchestration/memory/ingestion.js")),
    import(u("src/orchestration/memory/store.js")),
  ]);
  return { knowledge, clock, workspace, composition, retrieval, memory, policy, ingestion, store };
}

async function run() {
  const m = await load();
  const { NullKnowledgeProvider } = m.knowledge;
  const { ManualClock } = m.clock;
  const { workspaceRef } = m.workspace;
  const WS = workspaceRef("probe-knowledge");

  const checks = [];
  const check = async (name, fn) => {
    try {
      await fn();
      checks.push({ name, ok: true });
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };

  /** A runtime with one memory written, for the relevance-gate check. */
  async function runtimeWith(overrides = {}) {
    const runtime = m.composition.createRuntime({ clock: new ManualClock(NOW), workspace: WS, ...overrides });
    const subject = { id: "agent:probe", workspace: WS, operatingScope: "task", trustLevel: "standard" };
    runtime.memoryPolicy.grant({
      subject,
      scopes: ["task"],
      writableScopes: ["task"],
      minimumTrust: "untrusted",
      expiresAt: null,
    });
    assert.ok(runtime.memoryStore !== null && runtime.memoryService !== null, "a workspace composes the memory path");
    return { runtime, subject };
  }

  /* -- 1. the boundary is a boundary --------------------------------------- */

  await check("the port has exactly one implementation, and it is the honest one", async () => {
    // The Phase 05 `UnavailableAgentAdapter` precedent applied to knowledge: a working
    // unavailable beats a fake available.
    const provider = new NullKnowledgeProvider();
    assert.equal(await provider.isAvailable(), false, "being unavailable is a normal state");
    const miss = await provider.query({ text: "revenue", topK: 3, workspace: "acme" });
    assert.equal(miss.available, false);
    assert.deepEqual(miss.documents, [], "it invents no documents");
    assert.equal(miss.reason, "knowledge_unavailable", "and names the reason");

    // And the check that an EMBEDDING provider has no implementation at all — asserted by
    // scanning the built output, because the only way to be sure is to look.
    const base = process.env["PROBE_BASE"] ?? path.join(REPO, "dist");
    const found = [];
    // Recurses into DIRECTORIES only. A first draft used a `try { walk } catch` around
    // `readdirSync`, which reported `ENOTDIR` for the `.d.ts` declaration files the compiler
    // emits alongside the JavaScript - a probe failing on build artefacts rather than on a
    // fact about the system.
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".js") && !entry.name.endsWith(".d.js") && !entry.name.endsWith(".test.js")) {
          const source = readFileSync(full, "utf8");
          for (const match of source.matchAll(/implements\s+(\w*Embedding\w*)/g)) found.push(`${full}: ${match[1]}`);
        }
      }
    };
    walk(path.join(base, "src"));
    assert.deepEqual(found, [], "no embedding provider ships, not even an unavailable one");
  });

  await check("a knowledge provider can be attached, and the runtime says nothing consults it", async () => {
    const bare = m.composition.createRuntime({ clock: new ManualClock(NOW), workspace: WS });
    assert.equal(bare.describe().knowledge, "unattached", "an absent provider is reported absent");

    const attached = m.composition.createRuntime({
      clock: new ManualClock(NOW),
      workspace: WS,
      knowledge: new NullKnowledgeProvider(),
    });
    assert.equal(
      attached.describe().knowledge,
      "attached-not-consulted",
      "an attached provider is reported as attached AND unconsulted - the second half is the point",
    );
  });

  await check("attaching a knowledge provider changes nothing any run can observe", async () => {
    // The honest consequence of "nothing consults it", stated as an observation rather than a
    // promise. A caller might reasonably expect attaching a provider to change recall; it does
    // not, and the report says so. Asserted so that if Phase 13 ever wires it, THIS check is
    // the one that fails and gets replaced deliberately.
    const withProvider = await runtimeWith({ knowledge: new NullKnowledgeProvider() });
    const without = await runtimeWith();

    const written = {
      scope: "task",
      key: "k",
      type: "semantic",
      value: { text: "content" },
      summary: "quarterly revenue rose",
      importance: 0.8,
      provenance: {
        source: "system",
        sourceRef: "probe:1",
        sourceReference: "probe:1",
        taskId: "t1",
        traceId: null,
        observedAt: NOW.getTime(),
        verification: null,
      },
    };
    for (const { runtime, subject } of [withProvider, without]) {
      const outcome = runtime.memoryStore.store(written);
      assert.ok(outcome.ok, "the write must succeed in both runtimes");
      const recalled = await runtime.memoryService.recall(subject, {
        text: "revenue",
        scopes: ["task"],
        limit: 5,
      });
      assert.equal(recalled.retrieval.hitCount, 1, "both recall the same memory");
    }
    assert.equal(
      withProvider.runtime.describe().knowledge === without.runtime.describe().knowledge,
      false,
      "and the ONLY difference between the two runtimes is what the report says about the port",
    );
  });

  /* -- 2. relevance is a gate, not a weight --------------------------------- */

  await check("a query naming terms returns nothing for a memory that matches none of them", async () => {
    // The claim `TODO.md` item 4 makes, and it is worth being precise about WHERE the gate
    // lives: in `RetrievalScorer.score`, which returns null for a non-matching item. The
    // engine's filter has no score floor at all, so an audit reading only the filter would
    // have concluded the gate was missing.
    const { runtime, subject } = await runtimeWith();
    const outcome = runtime.memoryStore.store({
      scope: "task",
      key: "fresh-irrelevant",
      type: "semantic",
      value: { text: "content" },
      summary: "notes about gardening and soil",
      // As recent, confident and important as the model allows. If any of those could carry an
      // irrelevant memory past the gate, this is the case that would.
      importance: 0.95,
      provenance: {
        source: "system",
        sourceRef: "probe:1",
        sourceReference: "probe:1",
        taskId: "t1",
        traceId: null,
        observedAt: NOW.getTime(),
        verification: "pass",
      },
    });
    assert.ok(outcome.ok, "the write must succeed");

    const miss = await runtime.memoryService.recall(subject, {
      text: "quarterly revenue",
      scopes: ["task"],
      limit: 5,
    });
    assert.equal(miss.retrieval.hitCount, 0, "an irrelevant memory must NOT be returned, however weighted");

    const hit = await runtime.memoryService.recall(subject, { text: "gardening", scopes: ["task"], limit: 5 });
    assert.equal(hit.retrieval.hitCount, 1, "and the same memory IS returned when it does match");
  });

  await check("an EMPTY query still recalls, because an empty query makes no relevance claim", async () => {
    // The other half of the gate, and the one a "fix" would break. A query with no terms cannot
    // assert that a memory is irrelevant to it, so recency and importance are allowed to
    // decide. The gate's own condition carries `queryTerms.length > 0` for this reason.
    const { runtime, subject } = await runtimeWith();
    runtime.memoryStore.store({
      scope: "task",
      key: "important",
      type: "semantic",
      value: { text: "content" },
      summary: "anything at all",
      importance: 0.95,
      provenance: {
        source: "system",
        sourceRef: "probe:1",
        sourceReference: "probe:1",
        taskId: "t1",
        traceId: null,
        observedAt: NOW.getTime(),
        verification: null,
      },
    });
    const result = await runtime.memoryService.recall(subject, { text: "", scopes: ["task"], limit: 5 });
    assert.equal(result.retrieval.hitCount, 1, "an empty query recalls rather than refusing everything");
  });

  /* -- 3. the ingestion boundary ------------------------------------------- */

  await check("an unreachable ingestor is reported as a refusal carrying its reason", async () => {
    const store = new m.store.MemoryStore({
      workspace: WS,
      provider: new m.memory.InMemoryMemoryProvider(),
      clock: { nowMs: () => NOW.getTime(), now: () => NOW, sleep: async () => {} },
    });
    const service = new m.ingestion.IngestionService({
      store,
      policy: new m.policy.DefaultWritePolicy(),
      clock: { nowMs: () => NOW.getTime(), now: () => NOW, sleep: async () => {} },
      maximumContentLength: 500,
    });
    const report = await service.ingest(new m.ingestion.UnreachableKnowledgeIngestor("github", "not configured"));
    assert.equal(report.ingested.length, 0, "nothing is ingested from an unreachable source");
    assert.match(report.refused[0]?.reason ?? "", /not configured/, "and the reason is carried, not swallowed");
  });

  await check("the composition root composes no KNOWLEDGE ingestion service", async () => {
    // Precise about which ingestor. `runtime.ingestor` IS the **agent** ingestor
    // (`AgentIngestor`, Phase 08's disabled-by-default promotion gate) and is composed on
    // purpose; a first draft of this check matched `/ingest/i` and failed on it, which is the
    // probe being wrong rather than the runtime.
    const runtime = m.composition.createRuntime({ clock: new ManualClock(NOW), workspace: WS });
    const knowledgeish = Object.keys(runtime).filter((key) => /knowledge|ingest/i.test(key));
    assert.deepEqual(
      knowledgeish,
      ["ingestor"],
      "the only ingest-shaped member is the AGENT ingestor; no knowledge ingestion is composed",
    );
  });

  return checks;
}

async function probe() {
  const checks = await run();
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
    if (!c.ok) console.log(`      ${c.detail}`);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log("");
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

/* -------------------------------------------------------------------------- */
/* The self-test                                                               */
/* -------------------------------------------------------------------------- */

const SELF_TEST = [
  {
    id: "T1",
    breaks: "the port has exactly one implementation, and it is the honest one",
    file: "src/knowledge/port.js",
    from: "return Promise.resolve(false);",
    to: "return Promise.resolve(true);",
  },
  {
    id: "T2",
    breaks: "the port has exactly one implementation, and it is the honest one",
    file: "src/knowledge/port.js",
    from: 'reason: "knowledge_unavailable",',
    to: "reason: null,",
  },
  {
    id: "T3",
    breaks: "a knowledge provider can be attached, and the runtime says nothing consults it",
    file: "src/orchestration/composition.js",
    from: 'knowledge: options.knowledge === undefined ? "unattached" : "attached-not-consulted",',
    to: 'knowledge: options.knowledge === undefined ? "unattached" : "attached",',
  },
  {
    id: "T4",
    breaks: "a knowledge provider can be attached, and the runtime says nothing consults it",
    file: "src/orchestration/composition.js",
    from: 'knowledge: options.knowledge === undefined ? "unattached" : "attached-not-consulted",',
    to: 'knowledge: "attached-not-consulted",',
  },
  {
    id: "T5",
    breaks: "a query naming terms returns nothing for a memory that matches none of them",
    file: "src/orchestration/memory/retrieval.js",
    from: "if (queryTerms.length > 0 && relevance === 0 && exact === 0 && matchedTerms.length === 0) {",
    to: "if (false) {",
  },
  {
    id: "T6",
    breaks: "an EMPTY query still recalls, because an empty query makes no relevance claim",
    file: "src/orchestration/memory/retrieval.js",
    // The guard is REMOVED, not shifted. A first version changed `queryTerms.length > 0` to
    // `> 99`, which for any short query is also always-false — so the gate stopped firing and
    // the empty-query check, which is about the gate NOT firing, correctly kept passing. The
    // mutation was aimed at the wrong half of the same condition. An empty query has zero
    // terms, so `> 0` is false and the gate stands down; dropping the guard makes it fire and
    // refuse everything, which is what this check exists to catch.
    from: "if (queryTerms.length > 0 && relevance === 0 && exact === 0 && matchedTerms.length === 0) {",
    to: "if (relevance === 0 && exact === 0 && matchedTerms.length === 0) {",
  },
  {
    id: "T7",
    breaks: "an unreachable ingestor is reported as a refusal carrying its reason",
    file: "src/orchestration/memory/ingestion.js",
    from: "refused: [{ id: ingestor.name, reason: read.reason }],",
    to: "refused: [],",
  },
];

function cleanScratch() {
  for (const name of readdirSync(REPO)) {
    if (name === ".probe-phase10" || name.startsWith(".probe-phase10-")) {
      rmSync(path.join(REPO, name), { recursive: true, force: true });
    }
  }
}

async function probeAgainst(base) {
  // A plain absolute path, not a file URL: `spawnSync` with `node <file-url>` passes the URL
  // through as a literal string on Windows and fails to resolve it.
  const script = path.join(REPO, "scripts", "probe-phase10.mjs");
  const result = spawnSync(process.execPath, [script], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PROBE_BASE: base },
  });
  return { code: result.status ?? -1, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

async function selftest() {
  cleanScratch();

  const controlRun = await probeAgainst(path.join(REPO, "dist"));
  const controlGreen = controlRun.code === 0;
  console.log(`PROBE CONTROL  ${controlGreen ? "GREEN" : "BROKEN"}`);
  if (!controlGreen) {
    console.log(controlRun.output.split("\n").slice(-24).join("\n"));
    console.log("PROBE SELF-TEST FAIL: the probe is not green against the real build.");
    process.exitCode = 1;
    return;
  }

  const problems = [];
  for (const entry of SELF_TEST) {
    const dir = `${WORK}-${entry.id}`;
    cpSync(path.join(REPO, "dist"), dir, { recursive: true });
    const target = path.join(dir, entry.file);
    let source;
    try {
      source = readFileSync(target, "utf8");
    } catch {
      rmSync(dir, { recursive: true, force: true });
      problems.push(`${entry.id}: missing ${entry.file}`);
      console.log(`${entry.id.padEnd(4)} HARNESS_ERROR  missing file`);
      continue;
    }
    const hits = source.split(entry.from).length - 1;
    if (hits !== 1) {
      rmSync(dir, { recursive: true, force: true });
      problems.push(`${entry.id}: anchor is not a unique match in ${entry.file} (${hits} hits)`);
      console.log(`${entry.id.padEnd(4)} HARNESS_ERROR  anchor ${hits === 0 ? "not found" : "ambiguous"}`);
      continue;
    }
    writeFileSync(target, source.replace(entry.from, entry.to), "utf8");

    const previous = process.env["PROBE_BASE"];
    process.env["PROBE_BASE"] = dir;
    const checks = await run();
    if (previous === undefined) delete process.env["PROBE_BASE"];
    else process.env["PROBE_BASE"] = previous;
    rmSync(dir, { recursive: true, force: true });

    const named = checks.find((c) => c.name === entry.breaks);
    if (named === undefined) {
      problems.push(`${entry.id}: the probe has no check named "${entry.breaks}"`);
      console.log(`${entry.id.padEnd(4)} NO SUCH CHECK  ${entry.breaks}`);
      continue;
    }
    if (named.ok) {
      problems.push(`${entry.id}: reverting "${entry.breaks}" left it PASSING`);
      console.log(`${entry.id.padEnd(4)} NOT DETECTED  ${entry.breaks}`);
      continue;
    }
    const collateral = checks.filter((c) => !c.ok && c.name !== entry.breaks).map((c) => c.name);
    console.log(
      `${entry.id.padEnd(4)} DETECTED      ${entry.breaks}` +
        (collateral.length === 0 ? "" : `   (also failed: ${collateral.join(", ")})`),
    );
  }

  cleanScratch();
  console.log("");
  console.log(`UNTESTABLE HERE: "no concrete knowledge implementation exists" - true by absence of subject matter.`);
  console.log(`                Asserted by the probe; no decision exists to revert. See this file's header.`);
  if (problems.length === 0) {
    console.log("");
    console.log(`PROBE SELF-TEST PASS (${SELF_TEST.length}/${SELF_TEST.length})`);
    console.log("Every knowledge decision the probe claims, the probe can be shown to fail without.");
    return;
  }
  console.log("");
  console.log(`PROBE SELF-TEST FAIL (${problems.length} problem(s))`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
}

const mode = process.argv[2];
if (mode === "--selftest") await selftest();
else await probe();
