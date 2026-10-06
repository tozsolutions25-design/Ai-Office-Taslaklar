/**
 * PHASE 07 mutation harness - memory architecture.
 *
 * Method inherited from PHASE 01-06 unchanged, because the method is not where this
 * phase can fail:
 *
 *   - PATCH A COPY of dist/ (behavioural) or src/ (structural). The working tree is
 *     never mutated, so an interrupted run cannot leave a reverted source behind.
 *   - ONE decision reverted per run, individually.
 *   - A LOAD ERROR is classified separately and NEVER counted as a catch.
 *   - A mutation that SURVIVES is reported as SURVIVED, not quietly omitted.
 *   - Each mode has its own CONTROL, which must be green before any verdict is read.
 *
 * ## WHY THIS PHASE NEEDS A STRUCTURAL MODE
 *
 * One decision below - the authority's `operatingScope: "task"` - is not observable through
 * behaviour at all. A production memory subject is never constructed by a test, so a
 * behavioural suite passes whether the orchestrator operates at `task` or at `global`, and
 * a battery that only mutates `dist/` would report that live over-broad grant as covered.
 *
 * Two more began here and were PROMOTED to behavioural after surviving: see
 * `PROMOTED_TO_BEHAVIOURAL` below, which explains why surviving turned out to be the
 * harness telling the truth about its own mode. PHASE 06 already showed what happens when
 * a battery mutates `dist/` while the only detector reads `src/`: nine survivors, and a
 * false green if the structural control is missing.
 *
 * ## THE BAD MUTATION CONTROL
 *
 * `--bad-control` reverts a decision the battery does NOT assert is caught, and reports
 * whatever verdict comes back. A battery that has only ever printed CAUGHT has not
 * demonstrated it can print anything else, so "0 survivors" from such a harness is not
 * evidence of anything.
 *
 * Usage:
 *   node scripts/mutation-phase07.mjs
 *   node scripts/mutation-phase07.mjs --bad-control
 *   node scripts/mutation-phase07.mjs --selftest
 */

import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO = process.cwd();
const DIST = path.join(REPO, "dist");
const WORK = path.join(REPO, ".mutation-phase07");

function cleanScratch() {
  for (const name of readdirSync(REPO)) {
    if (name === ".mutation-phase07" || name.startsWith(".mutation-phase07-")) {
      rmSync(path.join(REPO, name), { recursive: true, force: true });
    }
  }
}

/**
 * Compiled suites whose assertions read SOURCE, so they detect a source mutation.
 *
 * The Phase 06 suite is here for the cross-phase claim it already makes (the partition
 * head includes the brand). The Phase 07 suite is here for the scope invariants it reads
 * out of `src/`: the documented breadth hierarchy, the single breadth function, and the
 * one production `operatingScope: "task"`.
 *
 * Leaving the Phase 07 suite out is not a neutral choice - it is what let S1, S2 and S3
 * all report SURVIVED on the first run, while `CONTROL` sat green at 1898.
 */
const STRUCTURAL_SUITES = [
  "tests/workspaceRegistryBoundaries.p06-evidence.test.js",
  "tests/memoryScopeModel.p07-evidence.test.js",
];

/* -------------------------------------------------------------------------- */
/* Behavioural mutations - revert one decision in dist/                        */
/* -------------------------------------------------------------------------- */

const MUTATIONS = [
  {
    id: "M1",
    defect: "the breadth ceiling refuses a scope broader than the operating scope",
    file: "src/orchestration/memory/memory.js",
    from: "SCOPE_BREADTH[scope] <= SCOPE_BREADTH[operatingScope]",
    to: "true",
  },
  {
    id: "M2",
    defect: "an absent trust level is treated as UNTRUSTED, not as unconstrained",
    file: "src/orchestration/memory/memory.js",
    from: 'subject.trustLevel ?? "untrusted"',
    to: 'subject.trustLevel ?? "privileged"',
  },
  {
    id: "M3",
    defect: "a grant below its minimum trust is refused",
    file: "src/orchestration/memory/memory.js",
    from: "if (!meetsTrustFloor(subject.trustLevel ?? ",
    to: "if (false && !meetsTrustFloor(subject.trustLevel ?? ",
  },
  {
    id: "M4",
    defect: "invalidate() writes by ID, into the ID-keyed bucket",
    file: "src/orchestration/memory/store.js",
    // The anchor reaches back into the D1 comment because `set(next.id, next)` appears
    // three times in this file (once per status writer) and only this one is the defect.
    // It also means the experiment fails LOUDLY if that code is ever rewritten: the
    // anchor stops matching and the run reports HARNESS_ERROR rather than quietly
    // mutating a different line.
    from:
      "        // reuse of a key added one more permanent entry.\n        this.#bucket(next.scope).set(next.id, next);",
    to: "        // reuse of a key added one more permanent entry.\n        this.#bucket(next.scope).set(next.key, next);",
  },
  {
    id: "M5",
    defect: "listScope hides an expired memory by default",
    file: "src/orchestration/memory/store.js",
    from: "!this.#isExpired(item, now)",
    to: "false",
  },
  {
    id: "M6",
    defect: "liveCount counts retrievable beliefs, not addresses",
    file: "src/orchestration/memory/store.js",
    from: "    liveCount() {\n        let total = 0;\n        for (const scope of this.#items.keys()) {\n            total += this.listScope(scope).length;\n        }\n        return total;",
    to: "    liveCount() {\n        let total = 0;\n        for (const index of this.#current.values()) {\n            total += index.size;\n        }\n        return total;",
  },
  {
    id: "M7",
    defect: "the write policy applies the per-scope importance ceiling",
    file: "src/orchestration/memory/policy.js",
    from: "importanceCeilingFor(candidate.scope)",
    to: "1",
  },
  {
    id: "M8",
    defect: "the breadth ceiling is normalised by the maximum breadth, so the floor is reachable",
    file: "src/orchestration/memory/policy.js",
    from: "1 - SCOPE_BREADTH[scope] / MAX_SCOPE_BREADTH",
    to: "1 - SCOPE_BREADTH[scope] / 20",
  },
  {
    id: "M9",
    defect: "importance_ceiling fires only when a ceiling actually clamped",
    file: "src/orchestration/memory/policy.js",
    from: "if (scoped < stated) {",
    to: "if (true) {",
  },
  {
    id: "M10",
    defect: "semantic retrieval reports itself UNAVAILABLE rather than claiming it ran",
    file: "src/orchestration/memory/retrieval.js",
    // Anchored on `void queryVector` so it hits the post-compute return - the exact line
    // that used to claim a semantic search had happened. `unavailableReason:
    // notImplemented` alone appears twice; the other one is the empty-text guard, where
    // reporting "no index" is correct.
    from: "            void queryVector;\n            return { strategies: [], matchedByKey, unavailableReason: notImplemented };",
    to: '            void queryVector;\n            return { strategies: ["semantic"], matchedByKey, unavailableReason: null };',
  },
  {
    id: "M11",
    defect: "the minimum importance floor is 0.35, excluding the whole `conversational` class",
    file: "src/orchestration/memory/policy.js",
    from: "options.minimumImportance ?? 0.35",
    to: "options.minimumImportance ?? 0",
  },
];

/* -------------------------------------------------------------------------- */
/* Structural mutations - revert one decision in src/                          */
/* -------------------------------------------------------------------------- */

const STRUCTURAL_MUTATIONS = [
  {
    id: "S1",
    defect: "the orchestrator's memory subject operates at `task`",
    file: "src/orchestration/authority.ts",
    from: 'return { id: actor, workspace: resolved.workspace, operatingScope: "task" };',
    to: 'return { id: actor, workspace: resolved.workspace, operatingScope: "global" };',
  },
];

/* -------------------------------------------------------------------------- */
/* Promotions from structural to behavioural                                    */
/* -------------------------------------------------------------------------- */

/*
 * S2 and S3 began life as STRUCTURAL mutations - "is SCOPE_BREADTH derived from
 * MEMORY_SCOPES, and is MEMORY_SCOPES declared narrowest-first?" - and both SURVIVED even
 * with the Phase 07 suite in the structural list.
 *
 * The reason is a property of the structural mode, not a gap in the suite: structural runs
 * load the compiled suite from `dist/`, whose IMPORTS also come from `dist/`. A source
 * mutation is therefore invisible to those imports, and only assertions that READ FILES
 * FROM DISK can see it. `memoryScopeModel` asserts the dense 0..n ranking through the
 * imported `SCOPE_BREADTH`, so it was reading unmutated code and correctly reported green.
 *
 * Both invariants are genuinely behavioural - the compiled model exports them - so the
 * honest experiment mutates the COMPILED model, where the suite's own imports see it. What
 * is genuinely structural, and stays in the structural list, is the actor's operating
 * scope: nothing outside the orchestrator observes it, so only a source read can catch it.
 */
const PROMOTED_TO_BEHAVIOURAL = [
  {
    id: "S2",
    defect: "SCOPE_BREADTH is DERIVED from MEMORY_SCOPES rather than a second hand-written table",
    file: "src/orchestration/memory/memory.js",
    from: "Object.fromEntries(MEMORY_SCOPES.map((scope, index) => [scope, index]))",
    to: "Object.fromEntries(MEMORY_SCOPES.map((scope) => [scope, MEMORY_SCOPES.indexOf(scope)]).map(([s, i]) => [s, i * 3]))",
  },
  {
    id: "S3",
    defect: "MEMORY_SCOPES is declared in BREADTH order, narrowest first",
    file: "src/orchestration/memory/memory.js",
    from: 'export const MEMORY_SCOPES = [\n    "conversation",',
    to: 'export const MEMORY_SCOPES = [\n    "system",\n    "conversation",',
  },
];

/**
 * The deliberate BAD control. Removing the BRAND from the Phase 06 partition head would
 * merge two brands - which Phase 06 asserts against, so this one is expected to be
 * CAUGHT. Either verdict is acceptable; a HARNESS_ERROR is not, because that would mean
 * the control did not run.
 */
const BAD_CONTROL = {
  id: "BAD",
  defect: "the composite key includes the brand in its partition head",
  file: "src/orchestration/workspace/workspace.js",
  from: '${workspace.brand === null ? "-" : `${workspace.brand.length}:${workspace.brand}`}',
  to: '"-"',
};

/* -------------------------------------------------------------------------- */
/* Runner                                                                      */
/* -------------------------------------------------------------------------- */

function listTests(variantDir) {
  const testsDir = path.join(variantDir, "tests");
  return readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.js"))
    .map((name) => path.join(testsDir, name));
}

function runSuite(variantDir, cwd = REPO, only = null) {
  const target = only ?? listTests(variantDir);
  if (target.length === 0) {
    throw new Error(`No compiled tests found in ${path.join(variantDir, "tests")}`);
  }
  const result = spawnSync(process.execPath, ["--test", ...target], {
    cwd,
    encoding: "utf8",
    maxBuffer: 96 * 1024 * 1024,
  });
  return { code: result.status ?? -1, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

/** Load failure is NOT a catch. Classified separately, on purpose. */
function classify(output) {
  const isSyntax = /(SyntaxError:|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|Cannot find module|Cannot use import statement|The requested module|TypeError: .* is not a function)/.test(
    output,
  );
  const passMatch = output.match(/(?:^|\n)\s*(?:ℹ|#)\s*pass\s+(\d+)/);
  const failMatch = output.match(/(?:^|\n)\s*(?:ℹ|#)\s*fail\s+(\d+)/);
  return {
    isSyntax,
    pass: passMatch === null ? null : Number(passMatch[1]),
    fail: failMatch === null ? null : Number(failMatch[1]),
  };
}

/**
 * Stages an unmutated copy to mutate FROM, and returns its path.
 *
 * The two modes need different layouts:
 *   - behavioural copies `dist/` flat, so `mutation.file` is `src/...` inside it;
 *   - structural copies `src/` INTO `<stage>/src`, because
 *     `workspaceRegistryBoundaries.p06-evidence.test.ts` resolves its reads from
 *     `process.cwd()`, which the structural runner points at the mutated copy. A copy
 *     that flattened `src` to the top would resolve to nothing, and every structural
 *     mutation would then be reported "caught" by a suite that read no files at all.
 *
 * Staging once per mode, not once per mutation, keeps the harness honest about cost.
 */
function stageDist() {
  const dir = `${WORK}-stage-dist`;
  rmSync(dir, { recursive: true, force: true });
  cpSync(DIST, dir, { recursive: true });
  return dir;
}

function stageSrc() {
  const dir = `${WORK}-stage-src`;
  rmSync(dir, { recursive: true, force: true });
  cpSync(path.join(REPO, "src"), path.join(dir, "src"), { recursive: true });
  return dir;
}

/**
 * Reports whether `mutation.from` is present exactly once in `mutation.file` inside the
 * staged base. Separate from `applyAndRun` because the self-test needs the answer without
 * running a suite - an earlier attempt folded this into a fake no-op run, which reported
 * HARNESS_ERROR for every mutation and so proved nothing.
 */
function checkAnchor(mutation, base) {
  let source;
  try {
    source = readFileSync(path.join(base, mutation.file), "utf8");
  } catch {
    return "missing";
  }
  const hits = source.split(mutation.from).length - 1;
  return hits === 0 ? "absent" : hits === 1 ? "unique" : `ambiguous (${hits} hits)`;
}

/** Applies one mutation to a fresh copy of `base`, runs it, then discards the copy. */
function applyAndRun(mutation, base, run) {
  const dir = `${WORK}-${mutation.id}`;
  rmSync(dir, { recursive: true, force: true });
  cpSync(base, dir, { recursive: true });
  const target = path.join(dir, mutation.file);
  let source;
  try {
    source = readFileSync(target, "utf8");
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return { verdict: "HARNESS_ERROR", detail: `missing ${mutation.file}` };
  }
  const hits = source.split(mutation.from).length - 1;
  if (hits === 0) {
    rmSync(dir, { recursive: true, force: true });
    return { verdict: "HARNESS_ERROR", detail: `anchor not found in ${mutation.file}` };
  }
  if (hits !== 1) {
    rmSync(dir, { recursive: true, force: true });
    return { verdict: "HARNESS_ERROR", detail: `anchor is not unique in ${mutation.file} (${hits} hits)` };
  }
  writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");
  const { output } = run(dir);
  rmSync(dir, { recursive: true, force: true });
  const c = classify(output);
  if (c.isSyntax) {
    return { verdict: "HARNESS_ERROR", detail: "the mutant failed to load; that is not a catch" };
  }
  if (c.fail === null) {
    return { verdict: "HARNESS_ERROR", detail: "no pass/fail summary in the mutant output" };
  }
  if (c.fail > 0) {
    return { verdict: "CAUGHT", detail: `${c.fail} failing test(s)` };
  }
  return { verdict: "SURVIVED", detail: "nothing failed" };
}

const runBehavioural = (dir) => runSuite(dir);

/** Runs the structural suites with the mutated copy as cwd, so they read THAT `src`. */
const runStructural = (dir) =>
  runSuite(dir, dir, STRUCTURAL_SUITES.map((s) => path.join(DIST, s)));

function controls() {
  // Behavioural control: the whole suite, unmutated.
  const bDir = stageDist();
  const b = classify(runSuite(bDir).output);
  rmSync(bDir, { recursive: true, force: true });
  const bGreen = b.fail === 0 && !b.isSyntax && b.fail !== null;
  console.log(`CONTROL              ${bGreen ? "GREEN" : "BROKEN"}  pass=${b.pass} fail=${b.fail}`);

  // Structural control: the structural suites against an UNMUTATED source copy, run
  // with that copy as cwd. Without it, a run that failed for an unrelated reason would
  // report every structural mutation as "caught" - the worst kind of false green.
  const sDir = stageSrc();
  const s = classify(runStructural(sDir).output);
  rmSync(sDir, { recursive: true, force: true });
  const sGreen = s.fail === 0 && !s.isSyntax && s.fail !== null;
  console.log(`STRUCTURAL CONTROL   ${sGreen ? "GREEN" : "BROKEN"}  pass=${s.pass} fail=${s.fail}`);

  return { behavioural: bGreen, structural: sGreen };
}

function battery() {
  cleanScratch();
  const controlsOk = controls();
  if (!controlsOk.behavioural || !controlsOk.structural) {
    console.log("A control is not green; every mutation below would be uninterpretable. Stopping.");
    process.exit(1);
  }

  const distBase = stageDist();
  const srcBase = stageSrc();
  const behavioural = [...MUTATIONS, ...PROMOTED_TO_BEHAVIOURAL];
  const results = [];
  for (const mutation of behavioural) {
    const outcome = applyAndRun(mutation, distBase, runBehavioural);
    results.push({ ...mutation, ...outcome });
    console.log(`${mutation.id.padEnd(5)} ${outcome.verdict.padEnd(13)} ${outcome.detail}`);
  }
  for (const mutation of STRUCTURAL_MUTATIONS) {
    const outcome = applyAndRun(mutation, srcBase, runStructural);
    results.push({ ...mutation, ...outcome });
    console.log(`${mutation.id.padEnd(5)} ${outcome.verdict.padEnd(13)} ${outcome.detail}  [structural]`);
  }
  for (const base of [distBase, srcBase]) rmSync(base, { recursive: true, force: true });

  const caught = results.filter((r) => r.verdict === "CAUGHT");
  const survived = results.filter((r) => r.verdict === "SURVIVED");
  const harness = results.filter((r) => r.verdict === "HARNESS_ERROR");
  const total = behavioural.length + STRUCTURAL_MUTATIONS.length;

  rmSync(WORK, { recursive: true, force: true });

  console.log("");
  console.log(
    `CAUGHT ${caught.length}/${total}  (behavioural ${behavioural.length}, structural ${STRUCTURAL_MUTATIONS.length})`,
  );
  console.log(`SURVIVED ${survived.length}: ${survived.map((r) => `${r.id} (${r.defect})`).join("; ") || "none"}`);
  console.log(`HARNESS_ERRORS ${harness.length}: ${harness.map((r) => `${r.id} (${r.detail})`).join("; ") || "none"}`);

  if (survived.length > 0 || harness.length > 0) {
    console.log("");
    console.log("SURVIVORS AND HARNESS ERRORS ARE SEPARATE FAILURE CLASSES. Either one blocks PASS.");
    process.exitCode = 1;
  } else {
    console.log("");
    console.log(`PHASE 07 mutation battery: ${caught.length}/${total} caught, 0 survivors, 0 harness errors.`);
  }
}

function badControl() {
  cleanScratch();
  const controlsOk = controls();
  if (!controlsOk.behavioural) process.exit(1);
  const base = stageDist();
  const outcome = applyAndRun(BAD_CONTROL, base, runBehavioural);
  rmSync(base, { recursive: true, force: true });
  rmSync(WORK, { recursive: true, force: true });
  // Belt and braces: the scratch patterns are siblings of WORK (`WORK + "-stage-dist"`),
  // so removing WORK alone leaves a staged copy of the whole build in the repo. The first
  // version of this mode did exactly that, and the leftover directory is untracked build
  // output sitting next to the source it was copied from.
  cleanScratch();
  console.log("");
  console.log(`BAD CONTROL (${BAD_CONTROL.defect})`);
  console.log(`  verdict: ${outcome.verdict}  ${outcome.detail}`);
  if (outcome.verdict === "HARNESS_ERROR") {
    console.log("FAIL: the bad control did not run, so its verdict proves nothing.");
    process.exitCode = 1;
  } else {
    console.log(
      outcome.verdict === "CAUGHT"
        ? "OK: caught. The harness demonstrably detects a real isolation defect."
        : "OK: survived, which is the expected outcome for a defect no suite claims. The harness can therefore print SURVIVED, so '0 survivors' above means something.",
    );
  }
}

function selftest() {
  cleanScratch();
  const failures = [];
  const classifyChecks = [
    ["a SyntaxError is a load failure", classify("SyntaxError: Unexpected token").isSyntax === true],
    ["a missing module is a load failure", classify("Cannot find module 'x'").isSyntax === true],
    ["a green run reads as zero failures", classify("ℹ pass 1898\nℹ fail 0").fail === 0],
    ["a failing run reads as its count", classify("ℹ pass 1800\nℹ fail 98").fail === 98],
    ["output with no summary invents nothing", classify("something happened").fail === null],
  ];
  for (const [label, ok] of classifyChecks) {
    if (!ok) failures.push(`classify(): ${label}`);
  }

  // A broken anchor must be HARNESS_ERROR in BOTH modes.
  const brokenB = applyAndRun(
    { id: "X", file: MUTATIONS[0].file, from: "this anchor is not present in any built file", to: "x" },
    stageDist(),
    runBehavioural,
  );
  if (brokenB.verdict !== "HARNESS_ERROR") failures.push(`behavioural: broken anchor gave ${brokenB.verdict}`);

  const brokenS = applyAndRun(
    { id: "Y", file: STRUCTURAL_MUTATIONS[0].file, from: "this anchor is not present in any source file", to: "x" },
    stageSrc(),
    runStructural,
  );
  if (brokenS.verdict !== "HARNESS_ERROR") failures.push(`structural: broken anchor gave ${brokenS.verdict}`);

  // An ambiguous anchor is not a controlled experiment either.
  const ambiguous = applyAndRun(
    { id: "Z", file: MUTATIONS[0].file, from: "return", to: "x" },
    stageDist(),
    runBehavioural,
  );
  if (ambiguous.verdict !== "HARNESS_ERROR") failures.push(`ambiguous anchor gave ${ambiguous.verdict}`);

  // A MUTATION WHOSE ANCHOR NO LONGER EXISTS must be a harness error. Phase 07 found this
  // the hard way: the first battery run reported 5 harness errors from stale anchors.
  // That was the harness working correctly, but it also means every anchor below has to be
  // re-checked against the real source before a verdict is believed - otherwise a stale
  // anchor silently removes a mutation from the battery.
  for (const mutation of [...MUTATIONS, ...PROMOTED_TO_BEHAVIOURAL, ...STRUCTURAL_MUTATIONS, BAD_CONTROL]) {
    const verdict = checkAnchor(mutation, mutation.file.endsWith(".ts") ? stageSrc() : stageDist());
    if (verdict !== "unique") failures.push(`${mutation.id}: anchor is ${verdict} in the real source`);
  }

  const controlsOk = controls();
  if (!controlsOk.behavioural) failures.push("the behavioural control is not green");
  if (!controlsOk.structural) failures.push("the structural control is not green");

  cleanScratch();
  // 5 classifier cases + 3 anchor-application cases + 1 per mutation/control anchor
  // + 2 controls. Counted, not asserted.
  const anchorChecks = MUTATIONS.length + PROMOTED_TO_BEHAVIOURAL.length + STRUCTURAL_MUTATIONS.length + 1;
  const checks = classifyChecks.length + 3 + anchorChecks + 2;
  console.log("");
  if (failures.length === 0) {
    console.log(`HARNESS SELF-TEST PASS (${checks}/${checks} checks)`);
    console.log("The classifier separates green, red, load-failure and unclassified output; a mutation");
    console.log("that cannot be applied cleanly is a harness error in BOTH modes; and both controls are");
    console.log("green before any verdict is read.");
    return;
  }
  console.log(`HARNESS SELF-TEST FAIL (${failures.length}/${checks} problem(s))`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}

const mode = process.argv[2];
if (mode === "--bad-control") badControl();
else if (mode === "--selftest") selftest();
else if (mode === undefined) battery();
else {
  console.error(`unknown mode: ${mode}`);
  process.exit(2);
}
