/**
 * PHASE 10 mutation harness - knowledge / RAG boundary.
 *
 * Method inherited from PHASE 01-09 unchanged: patch a COPY (behavioural `dist/`, structural
 * `src/`), one decision per run, a load error is never counted as a catch, a survivor is
 * reported, each mode has its own control that must be green first, and `--selftest`
 * re-checks every anchor against the real source.
 *
 * ## WHAT IS WORTH MUTATING HERE
 *
 * This is the smallest phase so far, and honestly so: three of `TODO.md`'s four items were
 * ALREADY TRUE and are now pinned rather than built. The one real gap was that a
 * `KnowledgeProvider` could be attached and never consulted, invisibly.
 *
 * So the battery is small and mostly behavioural, which is unusual for this repository and is
 * the shape of this subsystem rather than a weakness of the battery. The two structural
 * mutations exist because two of the claims are about what EXISTS (no concrete knowledge
 * import anywhere; the ingestion boundary is never constructed), and those are not observable
 * by calling anything.
 *
 * Usage:
 *   node scripts/mutation-phase10.mjs
 *   node scripts/mutation-phase10.mjs --bad-control
 *   node scripts/mutation-phase10.mjs --selftest
 */

import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO = process.cwd();
const DIST = path.join(REPO, "dist");
const WORK = path.join(REPO, ".mutation-phase10");

function cleanScratch() {
  for (const name of readdirSync(REPO)) {
    if (name === ".mutation-phase10" || name.startsWith(".mutation-phase10-")) {
      rmSync(path.join(REPO, name), { recursive: true, force: true });
    }
  }
}

/**
 * Compiled suites whose assertions read SOURCE.
 *
 * `src` AND `tests` are both staged - PHASE 08's first structural run reported a BROKEN
 * control because only `src` was copied, and PHASE 09 inherited the fix.
 */
const STRUCTURAL_SUITES = ["tests/knowledgeBoundary.p10-evidence.test.js"];

/* -------------------------------------------------------------------------- */
/* Behavioural mutations - revert one decision in dist/                        */
/* -------------------------------------------------------------------------- */

const MUTATIONS = [
  {
    id: "M1",
    defect: "relevance is a GATE: a query naming terms returns nothing for a non-matching item",
    file: "src/orchestration/memory/retrieval.js",
    from: "if (queryTerms.length > 0 && relevance === 0 && exact === 0 && matchedTerms.length === 0) {",
    to: "if (false) {",
  },
  {
    id: "M2",
    defect: "the runtime reports an attached knowledge provider as NOT consulted",
    file: "src/orchestration/composition.js",
    from: 'knowledge: options.knowledge === undefined ? "unattached" : "attached-not-consulted",',
    to: 'knowledge: options.knowledge === undefined ? "unattached" : "attached",',
  },
  {
    id: "M3",
    defect: "the runtime reports an absent knowledge provider as absent",
    file: "src/orchestration/composition.js",
    from: 'knowledge: options.knowledge === undefined ? "unattached" : "attached-not-consulted",',
    to: 'knowledge: "attached-not-consulted",',
  },
  {
    id: "M4",
    defect: "the honest null provider reports itself unavailable",
    file: "src/knowledge/port.js",
    from: "return Promise.resolve(false);",
    to: "return Promise.resolve(true);",
  },
  {
    id: "M5",
    defect: "the honest null provider invents no documents and names why",
    file: "src/knowledge/port.js",
    from: 'reason: "knowledge_unavailable",',
    to: 'reason: null,',
  },
  {
    id: "M6",
    defect: "an unreachable ingestor is reported as a refusal carrying its reason",
    file: "src/orchestration/memory/ingestion.js",
    from: "refused: [{ id: ingestor.name, reason: read.reason }],",
    to: "refused: [],",
  },
];

/* -------------------------------------------------------------------------- */
/* Structural mutations - revert one decision in src/                          */
/* -------------------------------------------------------------------------- */

const STRUCTURAL_MUTATIONS = [
  {
    id: "S1",
    defect: "the composition root constructs no knowledge ingestion boundary",
    file: "src/orchestration/composition.ts",
    from: "  const capabilities = new CapabilityRegistry();",
    to: "  const capabilities = new CapabilityRegistry();\n  // PHASE 10 mutation: an ingestion boundary quietly composed. TODO.md item 2 says\n  // boundary-only, and composing one would make that an integration.\n  const knowledgeIngestion = new UnreachableKnowledgeIngestor(\"mutation\", \"composed by a mutation\");",
  },
];

/*
 * ## A MUTATION THAT WAS WRITTEN AND THEN REMOVED, BECAUSE IT COULD NOT FAIL
 *
 * A second structural mutation was written for the claim `knowledge/port.ts` makes as its
 * first invariant - "the core orchestrator never imports a concrete knowledge implementation" -
 * and it SURVIVED. The reason is worth more than the mutation:
 *
 *   no mutation of the CURRENT source can violate it, because there is no concrete knowledge
 *   implementation in `src/` to import. The invariant is true by absence of subject matter.
 *   My first attempt added a second import FROM `knowledge/port.js` - which the check permits,
 *   correctly, because importing the port is exactly what it demands. Expressing a violation
 *   would require CREATING a `knowledge/<vendor>.ts` file, and a harness that does string
 *   replacement cannot create one.
 *
 * So it is removed rather than kept as decoration. The underlying TEST stays, because it
 * becomes falsifiable the moment a vendor module exists and would then fire on the import that
 * introduces it - which is the only moment it is worth anything.
 *
 * This is the second time in three phases that a claim turned out to be non-discriminating
 * (after PHASE 08's cross-workspace check), and it is the same shape: the honest options are
 * to keep it and say so, or to drop it, and NOT to leave it in a battery where its survival
 * looks like a coverage gap that was papered over.
 */

/**
 * The deliberate BAD control.
 *
 * `NullKnowledgeProvider.name` becomes something more descriptive. Nothing asserts the exact
 * string, so this is expected to SURVIVE - and a survivor here is the point: it shows the
 * harness can print one, which is what makes "0 survivors" above mean something.
 */
const BAD_CONTROL = {
  id: "BAD",
  defect: "the null provider gains a more descriptive name",
  file: "src/knowledge/port.js",
  from: '    name = "none";',
  to: '    name = "none (no knowledge layer attached)";',
};

function listTests(variantDir) {
  const testsDir = path.join(variantDir, "tests");
  return readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.js"))
    .map((name) => path.join(testsDir, name));
}

function runSuite(variantDir, cwd = REPO, only = null) {
  const target = only ?? listTests(variantDir);
  if (target.length === 0) throw new Error(`No compiled tests found in ${path.join(variantDir, "tests")}`);
  const result = spawnSync(process.execPath, ["--test", ...target], {
    cwd,
    encoding: "utf8",
    maxBuffer: 96 * 1024 * 1024,
  });
  return { code: result.status ?? -1, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

/** Load failure is NOT a catch. Classified separately, on purpose. */
function classify(output) {
  const isSyntax =
    /(SyntaxError:|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|Cannot find module|Cannot use import statement|The requested module)/.test(
      output,
    );
  const passMatch = output.match(/(?:^|\n)\s*(?:ℹ|#)\s*pass\s+(\d+)/);
  const failMatch = output.match(/(?:^|\n)\s*(?:ℹ|#)\s*fail\s+(\d+)/);
  return { isSyntax, pass: passMatch === null ? null : Number(passMatch[1]), fail: failMatch === null ? null : Number(failMatch[1]) };
}

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
  cpSync(path.join(REPO, "tests"), path.join(dir, "tests"), { recursive: true });
  return dir;
}

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
  if (c.isSyntax) return { verdict: "HARNESS_ERROR", detail: "the mutant failed to load; that is not a catch" };
  if (c.fail === null) return { verdict: "HARNESS_ERROR", detail: "no pass/fail summary in the mutant output" };
  if (c.fail > 0) return { verdict: "CAUGHT", detail: `${c.fail} failing test(s)` };
  return { verdict: "SURVIVED", detail: "nothing failed" };
}

const runBehavioural = (dir) => runSuite(dir);
const runStructural = (dir) => runSuite(dir, dir, STRUCTURAL_SUITES.map((s) => path.join(DIST, s)));

function controls() {
  const bDir = stageDist();
  const b = classify(runSuite(bDir).output);
  rmSync(bDir, { recursive: true, force: true });
  const bGreen = b.fail === 0 && !b.isSyntax && b.fail !== null;
  console.log(`CONTROL              ${bGreen ? "GREEN" : "BROKEN"}  pass=${b.pass} fail=${b.fail}`);

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
  const results = [];
  for (const mutation of MUTATIONS) {
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
  const total = MUTATIONS.length + STRUCTURAL_MUTATIONS.length;

  rmSync(WORK, { recursive: true, force: true });

  console.log("");
  console.log(`CAUGHT ${caught.length}/${total}  (behavioural ${MUTATIONS.length}, structural ${STRUCTURAL_MUTATIONS.length})`);
  console.log(`SURVIVED ${survived.length}: ${survived.map((r) => `${r.id} (${r.defect})`).join("; ") || "none"}`);
  console.log(`HARNESS_ERRORS ${harness.length}: ${harness.map((r) => `${r.id} (${r.detail})`).join("; ") || "none"}`);

  if (survived.length > 0 || harness.length > 0) {
    console.log("");
    console.log("SURVIVORS AND HARNESS ERRORS ARE SEPARATE FAILURE CLASSES. Either one blocks PASS.");
    process.exitCode = 1;
  } else {
    console.log("");
    console.log(`PHASE 10 mutation battery: ${caught.length}/${total} caught, 0 survivors, 0 harness errors.`);
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
        ? "OK: caught. The harness demonstrably detects a real knowledge-boundary defect."
        : "OK: survived, which is the expected outcome for a change no suite claims. The harness can therefore print SURVIVED, so '0 survivors' above means something.",
    );
  }
}

function selftest() {
  cleanScratch();
  const failures = [];
  const classifyChecks = [
    ["a SyntaxError is a load failure", classify("SyntaxError: Unexpected token").isSyntax === true],
    ["a missing module is a load failure", classify("Cannot find module 'x'").isSyntax === true],
    ["a green run reads as zero failures", classify("ℹ pass 1971\nℹ fail 0").fail === 0],
    ["a failing run reads as its count", classify("ℹ pass 1900\nℹ fail 71").fail === 71],
    ["output with no summary invents nothing", classify("something happened").fail === null],
  ];
  for (const [label, ok] of classifyChecks) if (!ok) failures.push(`classify(): ${label}`);

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

  const ambiguous = applyAndRun({ id: "Z", file: MUTATIONS[0].file, from: "return", to: "x" }, stageDist(), runBehavioural);
  if (ambiguous.verdict !== "HARNESS_ERROR") failures.push(`ambiguous anchor gave ${ambiguous.verdict}`);

  for (const mutation of [...MUTATIONS, ...STRUCTURAL_MUTATIONS, BAD_CONTROL]) {
    const verdict = checkAnchor(mutation, mutation.file.endsWith(".ts") ? stageSrc() : stageDist());
    if (verdict !== "unique") failures.push(`${mutation.id}: anchor is ${verdict} in the real source`);
  }

  const controlsOk = controls();
  if (!controlsOk.behavioural) failures.push("the behavioural control is not green");
  if (!controlsOk.structural) failures.push("the structural control is not green");

  cleanScratch();
  const anchorChecks = MUTATIONS.length + STRUCTURAL_MUTATIONS.length + 1;
  const checks = classifyChecks.length + 3 + anchorChecks + 2;
  console.log("");
  if (failures.length === 0) {
    console.log(`HARNESS SELF-TEST PASS (${checks}/${checks} checks)`);
    console.log("The classifier separates green, red, load-failure and unclassified output; a mutation");
    console.log("that cannot be applied cleanly is a harness error in BOTH modes; every anchor is");
    console.log("unique against the real source; and both controls are green before any verdict.");
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
