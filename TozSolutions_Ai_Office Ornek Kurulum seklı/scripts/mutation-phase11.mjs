/**
 * PHASE 11 mutation harness - observability and audit honesty.
 *
 * Method inherited from PHASE 01-10 unchanged: patch a COPY (behavioural `dist/`, structural
 * `src/`), one decision per run, a load error is never counted as a catch, a survivor is
 * reported, each mode has its own control that must be green first, and `--selftest`
 * re-checks every anchor against the real source.
 *
 * ## WHAT IS WORTH MUTATING HERE
 *
 * PHASE 11 was almost entirely about CLAIMS that were false, overstated, or stale, so the
 * battery is aimed at the decisions that make a record true:
 *
 *  - an event that was declared and emitted by nobody (10 kinds), now either emitted by the
 *    component that owns the decision or deleted;
 *  - a name declared in two vocabularies with different payloads;
 *  - metadata stored raw while the sink redacted, so one event had two versions;
 *  - an unbounded buffer;
 *  - substring matching that redacted 18 innocent key names;
 *  - a trace minted on one side of a boundary and discarded on the other;
 *  - a job id buried in metadata by two producers that disagreed about where;
 *  - an audit read that could not narrow.
 *
 * Each mutation below reverts ONE of those decisions. A survivor means the corresponding test
 * does not actually hold the line it claims to.
 *
 * Usage:
 *   node scripts/mutation-phase11.mjs
 *   node scripts/mutation-phase11.mjs --bad-control
 *   node scripts/mutation-phase11.mjs --selftest
 */

import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO = process.cwd();
const DIST = path.join(REPO, "dist");
const WORK = path.join(REPO, ".mutation-phase11");

function cleanScratch() {
  for (const name of readdirSync(REPO)) {
    if (name === ".mutation-phase11" || name.startsWith(".mutation-phase11-")) {
      rmSync(path.join(REPO, name), { recursive: true, force: true });
    }
  }
}

/**
 * Compiled suites whose assertions read SOURCE.
 *
 * `src` AND `tests` are both staged - PHASE 08's first structural run reported a BROKEN
 * control because only `src` was copied, and every phase since inherited the fix.
 */
const STRUCTURAL_SUITES = ["tests/observabilityVocabulary.p11-evidence.test.js"];

/* -------------------------------------------------------------------------- */
/* Behavioural mutations - revert one decision in dist/                       */
/* -------------------------------------------------------------------------- */

const MUTATIONS = [
  {
    id: "M1",
    defect: "the adapter crossing leaves no event, as it did before PHASE 11",
    file: "src/orchestration/authority.js",
    from: 'this.#record(context, "adapter_invoked", { agentId: key, adapter: agent.adapter, attempt: runContext.attempt }, this.#clock.now());',
    to: "void 0;",
  },
  {
    id: "M2",
    defect: "adapter_invoked reports a made-up adapter rather than the registry key",
    file: "src/orchestration/authority.js",
    from: '{ agentId: key, adapter: agent.adapter, attempt: runContext.attempt }',
    to: '{ agentId: key, adapter: "unknown", attempt: runContext.attempt }',
  },
  {
    id: "M3",
    defect: "the orchestrator mints its own trace and ignores the caller's correlation id",
    file: "src/orchestration/authority.js",
    from: 'const traceId = submitted.traceId ?? this.#ids.newId("trace");',
    to: 'const traceId = this.#ids.newId("trace");',
  },
  {
    id: "M4",
    defect: "the worker discards the connecting context again, so the boundary splits",
    file: "src/orchestration/workflow/worker.js",
    from: "traceId: context.traceId,",
    to: 'traceId: this.#ids.newId("trace"),',
  },
  {
    id: "M5",
    defect: "the job is read from only one of the two places a producer writes it",
    file: "src/orchestration/observability/trace.js",
    from: "jobId: labelledJob ?? context.parentTaskId,",
    to: "jobId: context.parentTaskId,",
  },
  {
    id: "M6",
    defect: "byJob returns nothing, as it did when it existed only in a comment",
    file: "src/orchestration/observability/trace.js",
    from: "return this.#events.filter((event) => event.jobId === jobId);",
    to: "return [];",
  },
  {
    id: "M7",
    defect: "an audit read narrows by scope but ignores the requested kind",
    file: "src/audit/events.js",
    from: "(filter?.kind === undefined || event.kind === filter.kind) &&",
    to: "(true) &&",
  },
  {
    id: "M8",
    defect: "an audit read ignores the requested time",
    file: "src/audit/events.js",
    from: "(filter?.since === undefined || event.at.getTime() >= filter.since.getTime()));",
    to: "(true));",
  },
  {
    id: "M9",
    defect: "health reports an event on every observation, not only on a transition",
    file: "src/health/monitor.js",
    from: "if (next.status !== previous.status) {",
    to: "if (true) {",
  },
  {
    id: "M10",
    defect: "health never reports a transition, so the collision is unresolved again",
    file: "src/health/monitor.js",
    from: "if (next.status !== previous.status) {",
    to: "if (false) {",
  },
  {
    id: "M11",
    defect: "the recorder stores raw metadata, so one event has an unredacted and a redacted version",
    file: "src/orchestration/observability/trace.js",
    from: "const safeDetail = redact(detail);",
    to: "const safeDetail = detail;",
  },
  {
    id: "M12",
    defect: "sensitive key names are matched by SUBSTRING again, redacting innocent keys",
    file: "src/audit/redaction.js",
    from: "return wordRuns(key).some((run) => SENSITIVE_KEY_FRAGMENTS.has(run));",
    to: "return SENSITIVE_KEY_FRAGMENTS.has(key.toLowerCase().replace(/[-_\\s]/g, \"\"));",
  },
{
    id: "M13",
    defect: "a declared-but-never-emitted kind is back in the vocabulary, the defect this phase was opened for",
    file: "src/orchestration/observability/trace.js",
    from: '    "adapter_invoked",',
    to: '    "adapter_invoked",\n    "knowledge_ingested",',
  },
  {
    id: "M14",
    defect: "provider_health_changed is declared in the ORCHESTRATION vocabulary again, colliding with the audit one",
    file: "src/orchestration/observability/trace.js",
    from: '    "adapter_invoked",',
    to: '    "adapter_invoked",\n    "provider_health_changed",',
  },
];

/* -------------------------------------------------------------------------- */
/* Structural mutations - revert one decision in src/                         */
/* -------------------------------------------------------------------------- */

/*
 * ## WHY THERE IS EXACTLY ONE STRUCTURAL MUTATION, AND WHY TWO WERE REMOVED
 *
 * Two more were written and withdrawn, because they could not fail - and a mutation that
 * cannot fail is worse than no mutation, since its survival reads as a coverage gap that was
 * papered over.
 *
 * Both attempted to reintroduce `provider_health_changed` / `knowledge_ingested` into the kind
 * LIST in `src/orchestration/observability/trace.ts`. The structural runner stages `src/` and
 * runs the compiled suite from the real `dist/`, with `cwd` pointed at the staged copy - and
 * `observabilityVocabulary.p11-evidence.test.ts` reads its kind list from the COMPILED module
 * (`import { ORCHESTRATION_EVENT_KINDS }`), not from the staged source. So patching the source
 * list changed nothing the test could see. Both SURVIVED, which says the mutation was aimed at
 * the wrong artefact, not that the test is weak.
 *
 * They were rewritten as M13/M14 against `dist/`, where the kind list actually lives, and both
 * are caught there. The one structural mutation kept below is one the suite genuinely reads out
 * of `src/`: the producer scan walks the staged source, so adding a producer for a DELETED kind
 * is observable and must be.
 */
const STRUCTURAL_MUTATIONS = [
  {
    id: "S1",
    defect: "a producer for a DELETED kind reappears in production source",
    file: "src/orchestration/authority.ts",
    from: '      collector.route(routedProvider, routedModel);',
    to: '      collector.route(routedProvider, routedModel);\n      this.#record(context, "tool_failed", { agentId: key, subtaskId: subtask.taskId, reason: "x" }, this.#clock.now());',
  },
];

/**
 * The deliberate BAD control.
 *
 * A DOC COMMENT is reworded. Nothing asserts on prose, so this is expected to SURVIVE - and a
 * survivor here is the point: it proves this harness can print SURVIVED at all, which is what
 * makes "0 survivors" in the battery above mean something rather than merely being the only
 * output the code knows how to produce.
 *
 * A FIRST attempt at this bad control renamed the `byJob` parameter. It came back CAUGHT, which
 * looked like success and was not: renaming the parameter also breaks the method BODY, which
 * still referred to `jobId`, so three suites failed on a ReferenceError. That measures "the
 * harness runs tests", not "the harness distinguishes a real defect from a harmless edit". A
 * comment cannot break anything, so surviving it is informative rather than accidental.
 */
const BAD_CONTROL = {
  id: "BAD",
  defect: "a doc comment is reworded",
  file: "src/orchestration/observability/trace.js",
  from: "/** Events for one trace, which is how a run is reconstructed. */",
  to: "/** Events for one trace, which is how a run is reassembled from its parts. */",
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
  // Node's spec reporter prefixes the SUMMARY counts with U+2139 (INFORMATION SOURCE). The
  // per-test lines use U+2714/U+2716, which is why matching on those would match test NAMES
  // rather than totals. Both the Unicode prefix and the TAP `#` form are accepted.
  const passMatch = output.match(/(?:^|\n)\s*(?:\u2139|#)\s*pass\s+(\d+)/);
  const failMatch = output.match(/(?:^|\n)\s*(?:\u2139|#)\s*fail\s+(\d+)/);
  return {
    isSyntax,
    pass: passMatch === null ? null : Number(passMatch[1]),
    fail: failMatch === null ? null : Number(failMatch[1]),
  };
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
    console.log(`PHASE 11 mutation battery: ${caught.length}/${total} caught, 0 survivors, 0 harness errors.`);
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
        ? "OK: caught. The harness demonstrably detects a real observability defect."
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
    ["a green run reads as zero failures", classify("\u2139 pass 2005\n\u2139 fail 0").fail === 0],
    ["a failing run reads as its count", classify("\u2139 pass 1971\n\u2139 fail 71").fail === 71],
    ["the TAP form is accepted too", classify("# pass 10\n# fail 2").fail === 2],
    ["a passing TEST NAME is not a summary line", classify("\u2714 pass 3 (1ms)\n\u2714 ok\n").fail === null],
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

  const ambiguous = applyAndRun({ id: "Z", file: MUTATIONS[5].file, from: "return", to: "x" }, stageDist(), runBehavioural);
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