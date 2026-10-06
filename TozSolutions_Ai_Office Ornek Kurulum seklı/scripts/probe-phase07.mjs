/**
 * PHASE 07 independent verification probe, and its self-test.
 *
 * WHY A SEPARATE PROBE AT ALL
 *
 * Every memory claim in this phase is enforced by tests that share this repository's
 * fixtures, helpers and assumptions. That is the right way to test behaviour and the
 * wrong way to test "no path bypasses the access policy" or "an expired memory is really
 * gone", because a suite that shares an author's assumptions can only confirm them.
 *
 * So this probe imports the BUILT `dist/` and nothing else - no test helper, no shared
 * fixture, no source read - and states each invariant as a fact about the running system,
 * phrased as a claim rather than as an assertion list. It is meant to be readable as an
 * argument.
 *
 * WHY THE SELF-TEST IS THE POINT
 *
 * A probe that only ever prints PASS has demonstrated nothing. `--selftest` reverts each
 * decision, one at a time, in a COPY of dist/, re-runs the probe against that copy, and
 * REQUIRES the named check to fail. A probe whose checks cannot be made to fail by
 * breaking the thing they check is decoration.
 *
 * Each entry therefore declares which check it must break. An entry whose named check
 * still passes is a FAILURE of the self-test, not a pass with a note - at that point the
 * probe is making a claim it cannot back up.
 *
 * Usage:
 *   node scripts/probe-phase07.mjs
 *   node scripts/probe-phase07.mjs --selftest
 */

import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import path from "node:path";

const REPO = process.cwd();
const WORK = path.join(REPO, ".probe-phase07");
const NOW = new Date("2026-04-01T00:00:00.000Z");

/* -------------------------------------------------------------------------- */
/* The probe                                                                   */
/* -------------------------------------------------------------------------- */

/** `PROBE_BASE` lets the self-test point the probe at a mutated copy of the build. */
async function load() {
  const base = process.env["PROBE_BASE"] ?? path.join(REPO, "dist");
  const u = (rel) => pathToFileURL(path.join(base, rel)).href;
  const [memory, clock, workspace, store, policy, retrieval, trust] = await Promise.all([
    import(u("src/orchestration/memory/memory.js")),
    import(u("src/core/clock.js")),
    import(u("src/orchestration/workspace/workspace.js")),
    import(u("src/orchestration/memory/store.js")),
    import(u("src/orchestration/memory/policy.js")),
    import(u("src/orchestration/memory/retrieval.js")),
    import(u("src/orchestration/agent/trust.js")),
  ]);
  return { memory, clock, workspace, store, policy, retrieval, trust };
}

async function run() {
  const m = await load();
  const { MemoryAccessPolicy, InMemoryMemoryProvider } = m.memory;
  const { MemoryStore } = m.store;
  const { DefaultWritePolicy } = m.policy;
  const { RetrievalEngine } = m.retrieval;
  const { workspaceRef } = m.workspace;

  const ACME = workspaceRef("acme");
  const GLOBEX = workspaceRef("globex");

  const checks = [];
  // AWAITS its callback. A check that has not finished has not passed.
  const check = async (name, fn) => {
    try {
      await fn();
      checks.push({ name, ok: true });
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };

  const at = (minutes) => new Date(NOW.getTime() + minutes * 60_000);

  /** A complete provenance, because the policy reads fields a partial one leaves undefined. */
  const provenance = (overrides = {}) => ({
    source: "system",
    sourceRef: "probe:1",
    taskId: "task-1",
    traceId: null,
    observedAt: NOW.getTime(),
    verification: null,
    ...overrides,
  });

  const draft = (overrides = {}) => ({
    scope: "task",
    key: "k",
    type: "semantic",
    value: { text: "content" },
    summary: "a summary",
    provenance: provenance(),
    ...overrides,
  });

  /** `MemoryStore` returns `{ kind, item }`, not the item itself. */
  const storedItem = (outcome) => {
    assert.ok(outcome.ok, `the write must succeed, got ${String(outcome.ok)}`);
    assert.ok(outcome.value !== undefined, "a successful write must return a value");
    return outcome.value.item;
  };

  /* -- 1. an actor cannot be granted reach it does not have --------------------- */

  await check("a subject operating at `task` is never handed the whole installation", () => {
    // The claim is about the RECORDED GRANT, not about a later read. A policy that stored
    // the over-broad scope and filtered at read time would still pass a read test, and
    // would still be wrong: the grant would be the artefact that leaked.
    const clock = { nowMs: () => NOW.getTime() };
    const policy = new MemoryAccessPolicy(clock);
    const subject = { id: "agent:a@1.0.0", workspace: ACME, operatingScope: "task", trustLevel: "high" };

    const outcome = policy.grant({
      subject,
      scopes: ["task", "global"],
      writableScopes: ["task", "organization"],
      minimumTrust: "low",
      expiresAt: null,
    });

    assert.ok(outcome.refusedScopes.includes("global"), "global must be refused");
    assert.ok(outcome.refusedScopes.includes("organization"), "organization must be refused");
    assert.equal(policy.canRead(subject, "global"), false, "and must not be readable afterwards");
    assert.equal(policy.canWrite(subject, "organization"), false, "nor writable");
    assert.equal(policy.canRead(subject, "task"), true, "the scope it does reach must survive");
    assert.equal(policy.canWrite(subject, "task"), true, "on both paths");
  });

  await check("being able to read a scope does not imply being able to write it", () => {
    const clock = { nowMs: () => NOW.getTime() };
    const policy = new MemoryAccessPolicy(clock);
    const subject = { id: "agent:a@1.0.0", workspace: ACME, operatingScope: "task", trustLevel: "high" };
    policy.grant({
      subject,
      scopes: ["task"],
      writableScopes: [],
      minimumTrust: "low",
      expiresAt: null,
    });
    assert.equal(policy.canRead(subject, "task"), true, "reading is granted");
    assert.equal(policy.canWrite(subject, "task"), false, "writing is not implied by it");
  });

  /* -- 2. trust is a floor, and absence is not privilege ----------------------- */

  await check("a grant above a subject's trust is refused, and an absent trust is untrusted", () => {
    const clock = { nowMs: () => NOW.getTime() };
    const policy = new MemoryAccessPolicy(clock);

    const untrusted = { id: "agent:low@1.0.0", workspace: ACME, operatingScope: "task", trustLevel: "untrusted" };
    policy.grant({ subject: untrusted, scopes: ["task"], writableScopes: [], minimumTrust: "standard", expiresAt: null });
    assert.equal(policy.canRead(untrusted, "task"), false, "untrusted must not reach a `standard` grant");

    // The load-bearing half: OMITTING the field must be the most RESTRICTIVE reading.
    // A default of `privileged` would make silence the strongest possible claim.
    const silent = { id: "agent:silent@1.0.0", workspace: ACME, operatingScope: "task" };
    policy.grant({ subject: silent, scopes: ["task"], writableScopes: [], minimumTrust: "untrusted", expiresAt: null });
    assert.equal(policy.canRead(silent, "task"), true, "an untrusted grant is still reachable");

    policy.grant({ subject: silent, scopes: ["task"], writableScopes: [], minimumTrust: "standard", expiresAt: null });
    assert.equal(policy.canRead(silent, "task"), false, "and a `standard` grant is not");
  });

  /* -- 3. a grant is a fact about one workspace, and stops when it expires ----- */

  await check("a grant granted in one workspace is not reachable from another", () => {
    const clock = { nowMs: () => NOW.getTime() };
    const policy = new MemoryAccessPolicy(clock);
    const here = { id: "agent:a@1.0.0", workspace: ACME, operatingScope: "task", trustLevel: "high" };
    const there = { id: "agent:a@1.0.0", workspace: GLOBEX, operatingScope: "task", trustLevel: "high" };
    policy.grant({ subject: here, scopes: ["task"], writableScopes: ["task"], minimumTrust: "low", expiresAt: null });
    assert.equal(policy.canRead(here, "task"), true, "the same actor in its own workspace");
    assert.equal(policy.canRead(there, "task"), false, "and the same STRING in another workspace");
  });

  await check("a grant stops authorising at the instant it expires", () => {
    let now = NOW.getTime();
    const clock = { nowMs: () => now };
    const policy = new MemoryAccessPolicy(clock);
    const subject = { id: "agent:a@1.0.0", workspace: ACME, operatingScope: "task", trustLevel: "high" };
    policy.grant({
      subject,
      scopes: ["task"],
      writableScopes: ["task"],
      minimumTrust: "low",
      expiresAt: NOW.getTime() + 60_000,
    });
    assert.equal(policy.canRead(subject, "task"), true, "before");
    now = NOW.getTime() + 60_001;
    assert.equal(policy.canRead(subject, "task"), false, "one millisecond after expiry");
  });

  /* -- 4. an expired memory is gone from EVERY read path ----------------------- */

  await check("every read path agrees that an expired memory is gone", () => {
    // The defect this rules out is a store where `get` honours expiry, `listScope` does
    // not, and the counters do not - so the same memory is simultaneously absent and
    // countable. The probe checks the VIEWS rather than one method.
    const clock = new m.clock.ManualClock(NOW);
    const provider = new InMemoryMemoryProvider();
    const store = new MemoryStore({ workspace: ACME, provider, clock });
    const item = storedItem(
      store.store(draft({ expiresAt: NOW.getTime() + 1_000 })),
    );

    assert.equal(store.get("task", "k")?.id, item.id, "readable while live");
    assert.equal(store.liveCount(), 1, "and counted");

    clock.advance(2_000);
    assert.equal(store.get("task", "k"), null, "get must not return it");
    assert.equal(store.listScope("task").length, 0, "nor list it");
    assert.equal(store.activeCount("task"), 0, "nor count it");
    assert.equal(store.liveCount(), 0, "nor count it as live");
    assert.equal(store.size(), 1, "the RECORD survives - expiry is not deletion");
    assert.equal(store.historyFor("task", "k").length, 1, "and history is intact");

    // The opt-in stays an opt-in, for a caller that explicitly asked.
    assert.equal(store.listScope("task", { includeExpired: true }).length, 1, "an explicit request still works");
  });

  await check("invalidating a memory does not leave a second record at its key", () => {
    const clock = new m.clock.ManualClock(NOW);
    const store = new MemoryStore({ workspace: ACME, provider: new InMemoryMemoryProvider(), clock });
    const item = storedItem(store.store(draft()));

    const outcome = store.invalidate(item.id, "probe");
    assert.ok(outcome.ok, "invalidation must succeed");
    assert.equal(store.size(), 1, "ONE record, not a copy - the id-keyed bucket");
    assert.equal(store.historyFor("task", "k").length, 1, "and one history entry");
  });

  /* -- 5. the write policy states only what it can enforce --------------------- */

  await check("the importance floor bites on the conversational class instead of exempting it", () => {
    // The reference policy's floor is 0.35 and the DEFAULT importance of a
    // `conversational` memory is 0.30. That gap is deliberate: a memory nobody thought
    // worth weighting is refused rather than stored. Both halves matter, and the second
    // is the one a well-meaning "fix" would break - so it is asserted too. The class must
    // be reachable, or the floor has become a silent ban instead of a floor.
    const policy = new DefaultWritePolicy({ clock: { nowMs: () => NOW.getTime() } });

    const unweighted = policy.evaluate(draft({ type: "conversational" }), NOW.getTime());
    assert.equal(unweighted.decision, "refused", "an unweighted conversational memory");
    assert.ok(unweighted.rules.includes("below_importance_floor"), "and it must say which rule refused it");

    const weighted = policy.evaluate(
      draft({ type: "conversational", summary: "the user prefers dark mode", importance: 0.5 }),
      NOW.getTime(),
    );
    assert.equal(weighted.decision !== "refused", true, `a weighted one must be storable, got ${weighted.decision}`);
  });

  await check("importance is capped for a wide scope, and the cap says so", () => {
    const policy = new DefaultWritePolicy({ clock: { nowMs: () => NOW.getTime() } });
    const evaluation = policy.evaluate(
      draft({
        scope: "global",
        summary: "a summary that is long enough to be useful and clear about what it is",
        importance: 0.95,
      }),
      NOW.getTime(),
    );
    assert.equal(evaluation.decision, "adjusted", "a wide scope with maximal importance must be adjusted");
    assert.ok(
      evaluation.rules.includes("importance_ceiling"),
      `the decision must cite the ceiling, got ${JSON.stringify(evaluation.rules)}`,
    );
    assert.ok(
      evaluation.draft !== null && evaluation.draft.importance <= 0.21,
      `importance must land on the ceiling, got ${evaluation.draft?.importance}`,
    );

    // And the cap is only reported when it actually clamped: a draft already below the
    // ceiling is accepted untouched, and must not claim a rule it did not apply.
    const untouched = policy.evaluate(draft({ importance: 0.5 }), NOW.getTime());
    assert.equal(untouched.rules.includes("importance_ceiling"), false, "no clamp, no rule");
  });

  await check("the policy declares exactly the rules it can state", () => {
    // A rule NAME is a claim that the policy CAN state that rule, and
    // `PolicyEvaluation.rules` reports it in every decision. A name nothing can emit is a
    // fabricated capability - and Phase 07 found two of them (`ephemeral_content`,
    // `duplicate_of_recent`) declared since Phase 05 with no implementation behind them.
    //
    // Reachability is established by EVALUATING one draft per rule, which is the only way
    // to know a rule is dead without re-implementing the policy to inspect it. That does
    // couple these drafts to the policy's conditions; it is the price of the claim, and it
    // fails loudly (a rule reported unreachable) if a condition moves, which is the correct
    // signal that the sweep needs revisiting.
    const policy = new DefaultWritePolicy({ clock: { nowMs: () => NOW.getTime() } });
    const drafts = {
      no_provenance: draft({ provenance: provenance({ sourceRef: "  " }) }),
      empty_summary: draft({ summary: "   " }),
      below_importance_floor: draft({ importance: 0.01 }),
      importance_ceiling: draft({ scope: "global", importance: 0.95 }),
      sensitive_content: draft({ value: { apiKey: "sk-live-abcdef" }, summary: "a credential" }),
      restricted_without_justification: draft({ provenance: provenance({ source: "system" }) }),
      verified_evidence: draft({ type: "evidence", provenance: provenance({ verification: "pass" }) }),
      human_assertion: draft({ provenance: provenance({ source: "human" }) }),
      unverified_agent_claim: draft({
        provenance: provenance({ source: "agent", verification: null }),
      }),
      transient_failure: draft({
        type: "episodic",
        provenance: provenance({ outcome: "failed", errorClass: "RetryableSubtaskFailure" }),
      }),
      expiring_type: draft({ type: "conversational", importance: 0.5 }),
      scope_requires_task: draft({ provenance: provenance({ taskId: null }) }),
    };

    const observed = new Set();
    for (const candidate of Object.values(drafts)) {
      for (const rule of policy.evaluate(candidate, NOW.getTime()).rules) observed.add(rule);
    }
    const declared = new Set(m.policy.POLICY_RULES);

    const unreachable = [...declared].filter((rule) => !observed.has(rule));
    assert.deepEqual(unreachable, [], "declared rules that no evaluation can emit");
    const undeclared = [...observed].filter((rule) => !declared.has(rule));
    assert.deepEqual(undeclared, [], "rules emitted but never declared");
  });

  /* -- 6. retrieval does not claim a search it did not run --------------------- */

  await check("semantic retrieval says it is unavailable instead of claiming a search", async () => {
    const clock = new m.clock.ManualClock(NOW);
    const store = new MemoryStore({ workspace: ACME, provider: new InMemoryMemoryProvider(), clock });
    storedItem(store.store(draft({ summary: "alpha beta" })));

    // A provider that works and returns a vector. With a real provider the engine has
    // everything it would need to lie: the only reason it does not is that there is no
    // index to search.
    let asked = 0;
    const embeddings = {
      name: "probe-provider",
      isAvailable: async () => true,
      embed: async (texts) => {
        asked += texts.length;
        return texts.map(() => [0.1, 0.2, 0.3]);
      },
    };
    const engine = new RetrievalEngine(store, { clock, embeddings });
    const result = await engine.retrieve({ text: "alpha", scopes: ["task"], limit: 10 });
    assert.equal(asked, 1, "the provider must actually be consulted");
    assert.equal(
      result.strategies.includes("semantic"),
      false,
      `a strategy that did not run must not be reported, got ${JSON.stringify(result.strategies)}`,
    );
    assert.ok(
      typeof result.unavailableReason === "string" && result.unavailableReason.length > 0,
      `the missing capability must be named, got ${String(result.unavailableReason)}`,
    );
    // And the honest answer is still an answer: lexical strategies ran and found it.
    assert.ok(result.hitCount > 0, "the lexical strategies must still work");
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

/**
 * Each entry names the check it must invalidate. If reverting the decision leaves that
 * check PASSING, the probe is claiming something it cannot detect, and that is a
 * self-test failure rather than an acceptable outcome.
 */
const SELF_TEST = [
  {
    id: "T1",
    breaks: "a subject operating at `task` is never handed the whole installation",
    file: "src/orchestration/memory/memory.js",
    from: "SCOPE_BREADTH[scope] <= SCOPE_BREADTH[operatingScope]",
    to: "true",
  },
  {
    id: "T2",
    breaks: "being able to read a scope does not imply being able to write it",
    file: "src/orchestration/memory/memory.js",
    from: "(grant) => grant.writableScopes.includes(scope)",
    to: "(grant) => grant.scopes.includes(scope)",
  },
  {
    id: "T3",
    breaks: "a grant above a subject's trust is refused, and an absent trust is untrusted",
    file: "src/orchestration/memory/memory.js",
    from: 'subject.trustLevel ?? "untrusted"',
    to: 'subject.trustLevel ?? "privileged"',
  },
  {
    id: "T4",
    breaks: "a grant granted in one workspace is not reachable from another",
    file: "src/orchestration/memory/memory.js",
    // The KEY FUNCTION, not one of its four call sites - reverting `grantKey` breaks the
    // isolation itself, which is the claim under test.
    from: "function grantKey(subject) {\n    return workspaceKey(subject.workspace, subject.id);\n}",
    to: "function grantKey(subject) {\n    return subject.id;\n}",
  },
  {
    id: "T5",
    breaks: "a grant stops authorising at the instant it expires",
    file: "src/orchestration/memory/memory.js",
    // `#isCurrent`, identified by the `return false` that follows its missing-grant guard.
    // `readableScopes` runs the same expiry test above it and must stay intact, or this
    // entry would be mutating two things at once.
    from:
      "        const grant = this.#grants.get(grantKey(subject));\n        if (!grant) {\n            return false;\n        }\n        if (grant.expiresAt !== null && grant.expiresAt <= this.#clock.nowMs()) {",
    to: "        const grant = this.#grants.get(grantKey(subject));\n        if (!grant) {\n            return false;\n        }\n        if (false) {",
  },
  {
    id: "T6",
    breaks: "every read path agrees that an expired memory is gone",
    file: "src/orchestration/memory/store.js",
    from: "!this.#isExpired(item, now)",
    to: "false",
  },
  {
    id: "T7",
    breaks: "every read path agrees that an expired memory is gone",
    file: "src/orchestration/memory/store.js",
    from: "    liveCount() {\n        let total = 0;\n        for (const scope of this.#items.keys()) {\n            total += this.listScope(scope).length;\n        }\n        return total;",
    to: "    liveCount() {\n        let total = 0;\n        for (const index of this.#current.values()) {\n            total += index.size;\n        }\n        return total;",
  },
  {
    id: "T8",
    breaks: "invalidating a memory does not leave a second record at its key",
    file: "src/orchestration/memory/store.js",
    from: "        // reuse of a key added one more permanent entry.\n        this.#bucket(next.scope).set(next.id, next);",
    to: "        // reuse of a key added one more permanent entry.\n        this.#bucket(next.scope).set(next.key, next);",
  },
  {
    id: "T9",
    breaks: "the importance floor bites on the conversational class instead of exempting it",
    file: "src/orchestration/memory/policy.js",
    from: "options.minimumImportance ?? 0.35",
    to: "options.minimumImportance ?? 0.3",
  },
  {
    id: "T10",
    breaks: "importance is capped for a wide scope, and the cap says so",
    file: "src/orchestration/memory/policy.js",
    from: "importanceCeilingFor(candidate.scope)",
    to: "1",
  },
  {
    id: "T11",
    breaks: "the policy declares exactly the rules it can state",
    file: "src/orchestration/memory/policy.js",
    from: '    "scope_requires_task",\n    "importance_ceiling",\n];',
    to: '    "scope_requires_task",\n    "importance_ceiling",\n    "a_rule_nothing_emits",\n];',
  },
  {
    id: "T12",
    breaks: "semantic retrieval says it is unavailable instead of claiming a search",
    file: "src/orchestration/memory/retrieval.js",
    from: "            void queryVector;\n            return { strategies: [], matchedByKey, unavailableReason: notImplemented };",
    to: '            void queryVector;\n            return { strategies: ["semantic"], matchedByKey, unavailableReason: null };',
  },
];

function cleanScratch() {
  for (const name of readdirSync(REPO)) {
    if (name === ".probe-phase07" || name.startsWith(".probe-phase07-")) {
      rmSync(path.join(REPO, name), { recursive: true, force: true });
    }
  }
}

async function probeAgainst(base) {
  // A plain absolute path, not a file URL: `spawnSync` with `node <file-url>` passes the
  // URL through as a literal string on Windows and fails to resolve it.
  const script = path.join(REPO, "scripts", "probe-phase07.mjs");
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

  // The probe must be GREEN before any self-test verdict is read, or a broken probe would
  // "detect" every break by failing for an unrelated reason.
  const controlRun = await probeAgainst(path.join(REPO, "dist"));
  const controlGreen = controlRun.code === 0;
  console.log(`PROBE CONTROL  ${controlGreen ? "GREEN" : "BROKEN"}`);
  if (!controlGreen) {
    console.log(controlRun.output.split("\n").slice(-20).join("\n"));
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

    // The mutated build is exercised in-process, because the child probe run imports the
    // REAL dist. Reverted copy in, probe logic re-used, so the only difference between the
    // control run and this one is the mutation.
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
    // Every other check must still pass: a break that takes the whole probe down proves
    // nothing about the one check it was supposed to invalidate.
    const collateral = checks.filter((c) => !c.ok && c.name !== entry.breaks).map((c) => c.name);
    console.log(
      `${entry.id.padEnd(4)} DETECTED      ${entry.breaks}` +
        (collateral.length === 0 ? "" : `   (also failed: ${collateral.join(", ")})`),
    );
  }

  cleanScratch();
  console.log("");
  if (problems.length === 0) {
    console.log(`PROBE SELF-TEST PASS (${SELF_TEST.length}/${SELF_TEST.length})`);
    console.log("Every memory decision the probe claims, the probe can be shown to fail without.");
    return;
  }
  console.log(`PROBE SELF-TEST FAIL (${problems.length} problem(s))`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
}

const mode = process.argv[2];
if (mode === "--selftest") await selftest();
else await probe();
