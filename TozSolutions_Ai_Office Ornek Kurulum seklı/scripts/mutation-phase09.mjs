/**
 * PHASE 09 mutation harness - skill architecture.
 *
 * Method inherited from PHASE 01-08 unchanged:
 *
 *   - PATCH A COPY of dist/ (behavioural) or src/ (structural); the working tree is never
 *     mutated.
 *   - ONE decision reverted per run, individually.
 *   - A LOAD ERROR is classified separately and NEVER counted as a catch.
 *   - A SURVIVOR is reported, not quietly omitted.
 *   - Each mode has its own CONTROL, which must be green before any verdict is read.
 *   - `--selftest` re-checks every anchor against the real source, because a stale anchor
 *     silently REMOVES a mutation from the battery.
 *
 * ## WHAT IS WORTH MUTATING HERE, AND WHY MOST OF IT IS STRUCTURAL
 *
 * A skill registry is small, and most of its requirements are PROHIBITIONS: no method that
 * grants, no method that bulk-loads, a check that runs in one direction. Those are exactly the
 * claims a behavioural battery cannot test - there is no way to call a method that should not
 * exist, and no way to observe that a merge was not performed without trying to perform one.
 *
 * So this battery is mostly structural, and that is not a weakness of the battery. It is the
 * shape of the subsystem. The four behavioural mutations cover what CAN be observed: a refused
 * load becoming a permitted one, a validation check disappearing, and an audit record being
 * dropped.
 *
 * ## THE BAD MUTATION CONTROL
 *
 * `--bad-control` reverts a decision this battery does NOT assert is caught, and reports
 * whatever comes back. A battery that has only ever printed CAUGHT has not demonstrated it can
 * print anything else.
 *
 * Usage:
 *   node scripts/mutation-phase09.mjs
 *   node scripts/mutation-phase09.mjs --bad-control
 *   node scripts/mutation-phase09.mjs --selftest
 */

import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO = process.cwd();
const DIST = path.join(REPO, "dist");
const WORK = path.join(REPO, ".mutation-phase09");

function cleanScratch() {
  for (const name of readdirSync(REPO)) {
    if (name === ".mutation-phase09" || name.startsWith(".mutation-phase09-")) {
      rmSync(path.join(REPO, name), { recursive: true, force: true });
    }
  }
}

/**
 * Compiled suites whose assertions read SOURCE.
 *
 * `src` AND `tests` are both staged: `skillContract.p09-evidence.test.ts` walks both, and
 * PHASE 08's first structural run reported a BROKEN control because only `src` was copied.
 */
const STRUCTURAL_SUITES = [
  "tests/skillContract.p09-evidence.test.js",
  "tests/agentAuthority.p08-evidence.test.js",
  "tests/executiveLayer.p08-evidence.test.js",
];

/* -------------------------------------------------------------------------- */
/* Behavioural mutations - revert one decision in dist/                        */
/* -------------------------------------------------------------------------- */

const MUTATIONS = [
  {
    id: "M1",
    defect: "a load is refused when the caller does not hold a required capability",
    file: "src/orchestration/skill/skill.js",
    from: "if (missingCapabilities.length > 0) {",
    to: "if (false) {",
  },
  {
    id: "M2",
    defect: "a load is refused when the caller cannot reach a required tool",
    file: "src/orchestration/skill/skill.js",
    from: "if (missingTools.length > 0) {",
    to: "if (false) {",
  },
  {
    id: "M3",
    defect: "an invalid declaration is refused at registration",
    file: "src/orchestration/skill/skill.js",
    from: "if (issues.length > 0) {",
    to: "if (false) {",
  },
  {
    id: "M4",
    defect: "a refused load is recorded in the audit trail",
    file: "src/orchestration/skill/skill.js",
    // The sink call inside `#refuse` is DELETED. The first version of this mutation returned
    // early when `this.#sink === undefined`, which changes nothing in any test that passes a
    // sink — and every test does — so it SURVIVED while appearing to disable the audit trail.
    // A mutation that only fires in a configuration nothing exercises is not an experiment.
    from: "    #refuse(caller, skillId, version, refusal, reason, missing) {\n        this.#sink?.({\n            skillId,\n            version,\n            workspace: caller.workspace,\n            outcome: \"refused\",\n            refusal,\n            reason,\n            missing: [...missing],\n            at: this.#clock.nowMs(),\n        });",
    to: "    #refuse(caller, skillId, version, refusal, reason, missing) {\n        void [\n            skillId,\n            version,\n            caller.workspace,\n            refusal,\n            reason,\n            [...missing],\n            this.#clock.nowMs(),\n        ];",
  },
  {
    id: "M5",
    defect: "an unknown skill is refused rather than returned",
    file: "src/orchestration/skill/skill.js",
    from: "if (declaration === undefined) {",
    to: "if (false) {",
  },
  {
    id: "M6",
    // PROMOTED FROM STRUCTURAL, and the promotion is the lesson rather than a formality.
    //
    // Two things were wrong with the structural version. Its file was a `dist/` path in a list
    // whose staging copies `src/`, so it reported HARNESS_ERROR "missing composition.js" - the
    // harness being right and the mutation being misfiled. And even correctly placed it would
    // have SURVIVED: the audit assertion reads events through the suite's IMPORT of the runtime,
    // which comes from unmutated `dist/`, so patching `src/` cannot reach it.
    //
    // That is PHASE 07's D-56 and PHASE 08's D-64, and this is the third time it has been
    // re-learned inside one phase. A structural mutation is visible only to an assertion that
    // reads files from disk.
    defect: "the composition root wires the load sink into the audit trail",
    file: "src/orchestration/composition.js",
    // The sink's BODY is short-circuited rather than the whole call replaced. The first
    // version replaced `sink: (record) => {` with `sink: undefined,`, which left the original
    // body dangling with no opening brace - the mutant failed to load, and the harness
    // correctly refused to count a load failure as a catch. A mutation that breaks the module
    // tests nothing about the decision it names.
    from: '        sink: (record) => {\n            traces.record(record.outcome === "loaded"',
    to: '        sink: (record) => {\n            if (record.outcome !== null) return;\n            traces.record(record.outcome === "loaded"',
  },
  {
    id: "M7",
    // The VALUE, not the type, and behavioural rather than structural - both corrections found
    // by the first run of this battery.
    //
    // The original widened the literal's TYPE to `"declares-only" | "may-confer"` while leaving
    // the reported value alone, so the boot report said exactly what it always said and the
    // mutation SURVIVED. Second time in this phase that a mutation changed a declaration
    // without changing behaviour: syntactically valid, semantically inert.
    defect: "the boot report states that a skill confers nothing",
    file: "src/orchestration/composition.js",
    from: 'skillAuthority: "declares-only",',
    to: 'skillAuthority: "may-confer",',
  },
];

/* -------------------------------------------------------------------------- */
/* Structural mutations - revert one decision in src/                          */
/* -------------------------------------------------------------------------- */

const STRUCTURAL_MUTATIONS = [
  {
    id: "S1",
    defect: "the registry has no method that grants, confers or elevates authority",
    file: "src/orchestration/skill/skill.ts",
    from: "  public has(skillId: string, version: string): boolean {",
    to: "  public grantCapabilities(_capabilities: Capability[]): void {\n        // The prohibition, reverted: a skill that confers authority is a privilege grant\n        // wearing a different hat.\n    }\n\n    public has(skillId: string, version: string): boolean {",
  },
  {
    id: "S2",
    defect: "there is no bulk-load path",
    file: "src/orchestration/skill/skill.ts",
    from: "  public names(): readonly string[] {",
    to: "  public loadAll(caller: SkillCaller): Result<LoadedSkill[], SkillLoadError> {\n        const loaded: LoadedSkill[] = [];\n        for (const key of this.#skills.keys()) {\n            const [skillId, version] = key.split(\"@\");\n            const outcome = this.load(skillId, version, caller);\n            if (outcome.ok) loaded.push(outcome.value);\n        }\n        return { ok: true, value: loaded };\n    }\n\n    public names(): readonly string[] {",
  },
  {
    id: "S3",
    defect: "a skill subsystem contains no execution or invocation path",
    file: "src/orchestration/skill/skill.ts",
    from: "  public names(): readonly string[] {",
    to: "  public async execute(skillId: string, version: string, caller: SkillCaller): Promise<Result<LoadedSkill, SkillLoadError>> {\n        return this.load(skillId, version, caller);\n    }\n\n    public names(): readonly string[] {",
  },
  {
    id: "S4",
    defect: "the capability requirement is named as a requirement, never as a grant",
    file: "src/orchestration/skill/skill.ts",
    // Anchored on the DECLARATION, not on `LoadedSkill`'s echo of it. Both name the field
    // `required`, which is the point - the two-hit ambiguity was itself the assertion - but a
    // mutation needs ONE site, and the self-test's anchor check refuses an ambiguous anchor
    // rather than silently patching both.
    from: "  /** Capabilities a caller must ALREADY hold. */\n  readonly requiredCapabilities: readonly Capability[];",
    to: "  /** Capabilities a caller must ALREADY hold. */\n  readonly requiredCapabilities: readonly Capability[];\n  readonly grantedCapabilities: readonly Capability[];",
  },
  {
    id: "S5",
    // Structural on the merits, unlike M6 and M7: the assertion it targets READS THIS FILE.
    // `skillContract` checks that `composition.ts` mentions both event kinds by name, so
    // rewriting one of those mentions is exactly what that assertion exists to catch. An
    // assertion that reads source is the one kind a source mutation can reach.
    //
    // The mutation collapses BOTH outcomes onto `skill_loaded`, which is the defect a Phase 11
    // reader would fear most: a refusal recorded as a success.
    defect: "the composition root emits a distinct event kind for a REFUSED load",
    file: "src/orchestration/composition.ts",
    from: 'record.outcome === "loaded" ? "skill_loaded" : "skill_load_refused",',
    to: 'record.outcome === "loaded" ? "skill_loaded" : "skill_loaded",',
  },
];

/**
 * The deliberate BAD control.
 *
 * The registry gains a `description()` accessor that returns a string. Nothing asserts the
 * absence of a harmless read, so this is expected to SURVIVE - and a survivor here is the
 * point: it demonstrates the harness can print one, which is what makes "0 survivors" above
 * mean something. A CAUGHT verdict would also be acceptable; a HARNESS_ERROR is not.
 */
const BAD_CONTROL = {
  id: "BAD",
  defect: "the registry gains a harmless human-readable description accessor",
  file: "src/orchestration/skill/skill.js",
  from: "    names() {\n        return [...this.#skills.keys()];\n    }",
  to: "    names() {\n        return [...this.#skills.keys()];\n    }\n    description() {\n        return `a skill registry holding ${this.#skills.size} declarations`;\n    }",
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
    console.log(`PHASE 09 mutation battery: ${caught.length}/${total} caught, 0 survivors, 0 harness errors.`);
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
        ? "OK: caught. The harness demonstrably detects a real skill-boundary defect."
        : "OK: survived, which is the expected outcome for an addition no suite claims. The harness can therefore print SURVIVED, so '0 survivors' above means something.",
    );
  }
}

function selftest() {
  cleanScratch();
  const failures = [];
  const classifyChecks = [
    ["a SyntaxError is a load failure", classify("SyntaxError: Unexpected token").isSyntax === true],
    ["a missing module is a load failure", classify("Cannot find module 'x'").isSyntax === true],
    ["a green run reads as zero failures", classify("ℹ pass 1960\nℹ fail 0").fail === 0],
    ["a failing run reads as its count", classify("ℹ pass 1900\nℹ fail 60").fail === 60],
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
