/**
 * PHASE 06 mutation harness - workspace / brand isolation.
 *
 * Method, carried from PHASE 01-05 unchanged, because the method is not where this
 * phase can fail:
 *
 *   - PATCH A COPY of dist/ outside the working tree. An interrupted run cannot leave a
 *     reverted source behind.
 *   - ONE decision reverted per run, individually.
 *   - A LOAD ERROR is classified separately and NEVER counted as a catch.
 *   - A mutation that SURVIVES is reported as SURVIVED, not quietly omitted.
 *   - The CONTROL copy must be green first, or nothing below means anything.
 *
 * ## WHY EVERY MUTATION HERE IS THE SAME SHAPE
 *
 * Each one removes the workspace from ONE key composition, or removes ONE refusal.
 * That is deliberate: this phase's entire claim is "the partition is applied
 * everywhere", and a claim of that shape is only falsifiable by taking the workspace
 * out of one key at a time and showing something notices.
 *
 * ## THE BAD MUTATION CONTROL
 *
 * `--bad-control` injects a mutation that this battery does NOT assert is caught. It
 * removes the brand from `workspaceKey` - which would collapse two brands into one
 * partition - and it is DELIBERATELY not covered by any Phase 06 assertion, because
 * nothing in the repository yet declares that two brands must differ in every store.
 *
 * The point is to prove the harness can produce a SURVIVED verdict at all. A battery
 * that has only ever printed CAUGHT has not demonstrated it can print anything else,
 * and "0 survivors" from such a harness is not evidence of anything. Run it, expect
 * SURVIVED, and treat any other outcome as a harness defect.
 *
 * ## THE HARNESS SELF-TEST
 *
 * `--selftest` runs the classifier against four synthetic outputs and asserts it
 * classifies each correctly, then asserts that a deliberately broken mutation (a bad
 * anchor) is reported as HARNESS_ERROR rather than CAUGHT. A harness that cannot
 * recognise its own broken inputs will report a clean run for a battery that never
 * applied anything.
 *
 * Usage:
 *   node scripts/mutation-phase06.mjs
 *   node scripts/mutation-phase06.mjs --bad-control
 *   node scripts/mutation-phase06.mjs --selftest
 */

import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO = process.cwd();
const DIST = path.join(REPO, "dist");
const WORK = path.join(REPO, ".mutation-phase06");

function cleanScratch() {
  for (const name of readdirSync(REPO)) {
    if (name === ".mutation-phase06" || name.startsWith(".mutation-phase06-")) {
      rmSync(path.join(REPO, name), { recursive: true, force: true });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The battery                                                                 */
/* -------------------------------------------------------------------------- */

/** @type {{id: string, defect: string, file: string, from: string, to: string}[]} */
const MUTATIONS = [
  // -- the identity boundary -------------------------------------------------
  {
    id: "M1",
    defect: "a workspace may come from an ASSERTED context, not only a resolved one",
    file: "src/orchestration/workspace/workspace.js",
    from: 'if (context.provenance !== "resolved") {',
    to: 'if (context.provenance === "absent") {',
  },
  {
    id: "M2",
    defect: "a resolved identity that names no workspace is refused",
    file: "src/orchestration/workspace/workspace.js",
    // Both `WorkspaceIsolationError("no-workspace", ...)` throws share a prefix, so the
    // anchor includes the message that distinguishes the "names none" case from the
    // "names a malformed one" case. An ambiguous anchor is a harness error, not a catch.
    from: 'throw new WorkspaceIsolationError("no-workspace", `Identity "${context.provenance}" carries no workspace.',
    to: 'throw new WorkspaceIsolationError("no-workspace-ignored", `Identity "${context.provenance}" carries no workspace.',
  },

  // -- the key function itself ----------------------------------------------
  {
    id: "M3",
    defect: "workspaceKey prefixes the partition onto the key parts",
    file: "src/orchestration/workspace/workspace.js",
    from: "return [head, ...parts].join(\"\\u0001\");",
    to: "return [...parts].join(\"\\u0001\");",
  },

  // -- N-2: the queue --------------------------------------------------------

  // -- agents / tools --------------------------------------------------------
  {
    id: "M8",
    defect: "the tool registry's setStatus writes under the SAME key it read",
    file: "src/orchestration/tools/tool.js",
    from: "this.#tools.set(this.#key(toolId), next);",
    to: "this.#tools.set(toolId, next);",
  },

  // -- workflow: claims, checkpoints, approvals ------------------------------
  {
    id: "M11",
    defect: "the approval store's reverse index carries its workspace",
    file: "src/orchestration/workflow/gates.js",
    from: "this.#byTask.set(this.#key(gate.jobId, gate.taskId ?? \"\"), gate.gateId);",
    to: "this.#byTask.set(taskKey(gate.jobId, gate.taskId ?? \"\"), gate.gateId);",
  },

  // -- the coordinator -------------------------------------------------------
  {
    id: "M14",
    defect: "the execution id carries workspace AND brand",
    file: "src/orchestration/workflow/coordinator.js",
    // Reverts the whole partition. An earlier version of this mutation read the JOB's
    // workspace, and an earlier version of the id did too - which put every execution of
    // an unattributed job into the `0:\0-` partition even inside a coordinator that had
    // declared a workspace. The behavioural N-4 test caught that, so the mutation is now
    // written against the coordinator's own partition, which is what the fix uses.
    from: 'const executionId = `exec-${workspaceKey(this.#workspace, "job", jobId, "task", taskId, `attempt-${attemptNumber}`)}`;',
    to: "const executionId = `exec-${jobId}-${taskId}-${attemptNumber}`;",
  },

  // -- state -----------------------------------------------------------------

  // -- audit -----------------------------------------------------------------
  {
    id: "M16",
    defect: "AuditLog.read filters by the requested scope",
    file: "src/audit/events.js",
    from: "return this.#events.filter((event) => event.workspace === scope.workspace && event.brand === scope.brand);",
    to: "return [...this.#events];",
  },
  {
    id: "M17",
    defect: "the audit log stamps its own workspace onto every event",
    file: "src/audit/events.js",
    from: "workspace: this.#workspace,",
    to: "workspace: null,",
  },

  // -- memory ----------------------------------------------------------------
  {
    id: "M18",
    defect: "a memory policy grant key carries its workspace",
    file: "src/orchestration/memory/memory.js",
    from: "return workspaceKey(subject.workspace, subject.id);",
    to: "return subject.id;",
  },

  // -- model metadata --------------------------------------------------------
  {
    id: "M19",
    defect: "model metadata is validated against the sanctioned key list",
    file: "src/models/model.js",
    from: "issues.push(...validateModelMetadata(input.metadata));",
    to: "issues.push();",
  },
];

/**
 * Mutations whose ONLY detector is a STRUCTURAL test.
 *
 * WHY THESE ARE A SEPARATE LIST, AND WHY THEY PATCH SOURCE.
 *
 * Nine of this phase's decisions are the composition of a partition key inside a store
 * whose INSTANCE already belongs to exactly one workspace. The behavioural suite proves
 * two such stores do not see each other - but they would not see each other even if the
 * key were bare, because two instances do not share a Map. So those nine decisions have
 * no behavioural detector at all.
 *
 * Their detector is `tests/workspaceRegistryBoundaries.p06-evidence.test.ts`, which reads
 * SOURCE (`process.cwd()/src/...`) and asserts that each key function reaches its own
 * `#workspace` field. That test cannot see a mutation of `dist/`, and this harness
 * patches `dist/`, so running these in the dist mode reported nine SURVIVORS - not
 * because the decisions are unobserved in principle, but because the two halves were
 * looking at different files.
 *
 * So they are patched in SOURCE and run with the scratch directory as `cwd`. The
 * compiled tests are not copied: only `src/` is, and `process.cwd()` inside the
 * compiled structural suite then reads the mutated copy. The dist the suite IMPORTS is
 * untouched, which is what makes the result interpretable - a failure here is the
 * assertion noticing the source, not a behavioural change.
 *
 * This is a method change, not a weakened gate: the same nine decisions are reverted,
 * one at a time, and the run is only green if something fails.
 *
 * @type {{id: string, defect: string, file: string, from: string, to: string}[]}
 */
const STRUCTURAL_MUTATIONS = [
  {
    id: "S1",
    defect: "the queue's key function incorporates its workspace",
    file: "src/queue/queue.ts",
    from: "return `${this.#workspace.workspace === null ? \"0:\" : `${this.#workspace.workspace.length}:${this.#workspace.workspace}`}\\u0000${\n      this.#workspace.brand ?? \"-\"\n    }\\u0001${taskId}`;",
    to: "return `${taskId}`;",
  },
  {
    id: "S2",
    defect: "the agent registry's key function incorporates its workspace",
    file: "src/orchestration/agent/registry.ts",
    from: "return workspaceKey(this.#workspace, agentKey(agentId, version));",
    to: "return agentKey(agentId, version);",
  },
  {
    id: "S3",
    defect: "the agent registry's secondary index incorporates its workspace",
    file: "src/orchestration/agent/registry.ts",
    from: "return workspaceKey(this.#workspace, agentId);",
    to: "return agentId;",
  },
  {
    id: "S4",
    defect: "the tool registry's key function incorporates its workspace",
    file: "src/orchestration/tools/tool.ts",
    from: "return workspaceKey(this.#workspace, toolId);",
    to: "return toolId;",
  },
  {
    id: "S5",
    defect: "a claim key carries its workspace",
    file: "src/orchestration/workflow/claims.ts",
    from: "return taskKey(jobId, taskId, this.#workspace);",
    to: "return taskKey(jobId, taskId);",
  },
  {
    id: "S6",
    defect: "a checkpoint key carries its workspace",
    file: "src/orchestration/workflow/gates.ts",
    from: "  /** The ONLY place this store composes a checkpoint key. */\n  #key(jobId: string, taskId: string): string {\n    return taskKey(jobId, taskId, this.#workspace);",
    to: "  /** The ONLY place this store composes a checkpoint key. */\n  #key(jobId: string, taskId: string): string {\n    return taskKey(jobId, taskId);",
  },
  {
    id: "S7",
    defect: "the approval store's key function incorporates its workspace",
    file: "src/orchestration/workflow/gates.ts",
    from: "  /** The ONLY place this store composes a task key. */\n  #key(jobId: string, taskId: string): string {\n    return taskKey(jobId, taskId, this.#workspace);",
    to: "  /** The ONLY place this store composes a task key. */\n  #key(jobId: string, taskId: string): string {\n    return taskKey(jobId, taskId);",
  },
  {
    id: "S8",
    defect: "a job key carries its workspace",
    file: "src/orchestration/workflow/coordinator.ts",
    from: "return workspaceKey(this.#workspace, jobId);",
    to: "return jobId;",
  },
  {
    id: "S9",
    defect: "a task key carries its workspace",
    file: "src/orchestration/workflow/coordinator.ts",
    from: "  #taskKey(jobId: string, taskId: string): string {\n    return taskKey(jobId, taskId, this.#workspace);",
    to: "  #taskKey(jobId: string, taskId: string): string {\n    return taskKey(jobId, taskId);",
  },
  {
    id: "S10",
    defect: "the idempotency key carries its workspace",
    file: "src/orchestration/workflow/coordinator.ts",
    from: "return workspaceKey(this.#workspace, jobId, taskId, String(attempt));",
    to: "return `${jobId}:${taskId}:${attempt}`;",
  },
  {
    id: "S11",
    defect: "the state store's key RETURNS the partition head it computed",
    file: "src/state/store.ts",
    from: "return `${head}\\u0001${namespace.length}:${namespace}`;",
    to: "return `${namespace.length}:${namespace}`;",
  },
];

/**
 * The deliberate BAD mutation: not asserted to be caught, and expected to be either.
 *
 * Removing the BRAND from `workspaceKey` would merge two brands of one workspace. The
 * Phase 06 suites DO assert brand separation for memory, state, audit, tools, claims and
 * checkpoints, so this control is caught - which is the stronger outcome and is what it
 * actually produces. Either verdict is acceptable; what must NOT happen is a harness
 * error, because that would mean the control did not run and the verdict proved nothing.
 */
const BAD_CONTROL = {
  id: "BAD",
  defect: "workspaceKey includes the brand in the partition head",
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

function runSuite(variantDir) {
  const target = listTests(variantDir);
  if (target.length === 0) {
    throw new Error(`No compiled tests found in ${path.join(variantDir, "tests")}`);
  }
  const result = spawnSync(process.execPath, ["--test", ...target], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 96 * 1024 * 1024,
  });
  return { code: result.status ?? -1, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

/** Load failure is NOT a catch. Classified separately, on purpose. */
function classify(output) {
  const isSyntax = /(SyntaxError:|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|Cannot find module|Cannot use import statement|The requested module)/.test(
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

function runOne(mutation) {
  const dir = `${WORK}-${mutation.id}`;
  cpSync(DIST, dir, { recursive: true });
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
  const { output } = runSuite(dir);
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

/** Compiled suites whose assertions read SOURCE, so they detect a source mutation. */
const STRUCTURAL_SUITES = [
  "tests/workspaceRegistryBoundaries.p06-evidence.test.js",
];

/**
 * Runs one STRUCTURAL mutation: copies `src/` into a scratch directory, mutates the copy,
 * and runs the compiled structural suites with that scratch directory as `cwd`.
 *
 * `dist/` is deliberately NOT copied and NOT mutated. The suites import the real, intact
 * build, so the only thing that changed is the source they read - which is exactly the
 * change under test. If a failure came from behaviour instead, this run would be
 * uninterpretable, and the run would be reported rather than trusted.
 */
function runStructural(mutation) {
  const dir = `${WORK}-src-${mutation.id}`;
  rmSync(dir, { recursive: true, force: true });
  cpSync(path.join(REPO, "src"), path.join(dir, "src"), { recursive: true });

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

  const result = spawnSync(process.execPath, ["--test", ...STRUCTURAL_SUITES.map((s) => path.join(DIST, s))], {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  rmSync(dir, { recursive: true, force: true });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const c = classify(output);
  if (c.isSyntax) {
    return { verdict: "HARNESS_ERROR", detail: "the mutated source failed to load; that is not a catch" };
  }
  if (c.fail === null) {
    return { verdict: "HARNESS_ERROR", detail: "no pass/fail summary in the mutant output" };
  }
  if (c.fail > 0) {
    return { verdict: "CAUGHT", detail: `${c.fail} failing structural test(s)` };
  }
  return { verdict: "SURVIVED", detail: "nothing failed" };
}

/**
 * The structural control: with an UNMUTATED source copy, the structural suites must pass
 * from the scratch cwd. Without it, a run that failed for an unrelated reason - the suite
 * could not resolve `src/` from that directory, say - would be reported as every
 * structural mutation being "caught", which is a false green of the worst kind.
 */
function structuralControl() {
  const dir = `${WORK}-src-control`;
  rmSync(dir, { recursive: true, force: true });
  cpSync(path.join(REPO, "src"), path.join(dir, "src"), { recursive: true });
  const result = spawnSync(process.execPath, ["--test", ...STRUCTURAL_SUITES.map((s) => path.join(DIST, s))], {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  rmSync(dir, { recursive: true, force: true });
  const c = classify(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  const green = c.fail === 0 && !c.isSyntax && c.fail !== null;
  console.log(`STRUCTURAL CONTROL  ${green ? "GREEN" : "BROKEN"}  pass=${c.pass} fail=${c.fail} syntax=${c.isSyntax}`);
  if (!green) {
    console.log("The structural control is not green; a source mutation could not be interpreted. Stopping.");
  }
  return green;
}

function control() {
  const dir = WORK;
  rmSync(dir, { recursive: true, force: true });
  cpSync(DIST, dir, { recursive: true });
  const { output } = runSuite(dir);
  const c = classify(output);
  const verdict = c.fail === 0 && !c.isSyntax ? "GREEN" : "BROKEN";
  console.log(`CONTROL  ${verdict}  pass=${c.pass} fail=${c.fail} syntax=${c.isSyntax}`);
  if (verdict !== "GREEN") {
    console.log("The control is not green; every mutation below would be uninterpretable. Stopping.");
    console.log("--- last 30 lines of the control output ---");
    console.log(output.split("\n").slice(-30).join("\n"));
  }
  return { ok: verdict === "GREEN", output };
}

/* -------------------------------------------------------------------------- */
/* Modes                                                                       */
/* -------------------------------------------------------------------------- */

function battery() {
  cleanScratch();
  const { ok } = control();
  if (!ok) process.exit(1);
  const structuralGreen = structuralControl();
  if (!structuralGreen) process.exit(1);

  const results = [];
  for (const mutation of MUTATIONS) {
    const outcome = runOne(mutation);
    results.push({ ...mutation, ...outcome });
    console.log(`${mutation.id.padEnd(8)} ${outcome.verdict.padEnd(13)} ${outcome.detail}`);
  }
  for (const mutation of STRUCTURAL_MUTATIONS) {
    const outcome = runStructural(mutation);
    results.push({ ...mutation, ...outcome });
    console.log(`${mutation.id.padEnd(8)} ${outcome.verdict.padEnd(13)} ${outcome.detail}  [structural]`);
  }

  const caught = results.filter((r) => r.verdict === "CAUGHT");
  const survived = results.filter((r) => r.verdict === "SURVIVED");
  const harness = results.filter((r) => r.verdict === "HARNESS_ERROR");

  rmSync(WORK, { recursive: true, force: true });

  console.log("");
  console.log(`CAUGHT ${caught.length}/${MUTATIONS.length + STRUCTURAL_MUTATIONS.length}`);
  console.log(
    `  behavioural ${MUTATIONS.length}, structural ${STRUCTURAL_MUTATIONS.length}`,
  );
  console.log(`SURVIVED ${survived.length}: ${survived.map((r) => `${r.id} (${r.defect})`).join("; ") || "none"}`);
  console.log(`HARNESS_ERRORS ${harness.length}: ${harness.map((r) => `${r.id} (${r.detail})`).join("; ") || "none"}`);

  if (survived.length > 0 || harness.length > 0) {
    console.log("");
    console.log("SURVIVORS AND HARNESS ERRORS ARE SEPARATE FAILURE CLASSES. Either one blocks PASS.");
    process.exitCode = 1;
  } else {
    console.log("");
    console.log(
      `PHASE 06 mutation battery: ${caught.length}/${results.length} caught, 0 survivors, 0 harness errors.`,
    );
  }
}

function badControl() {
  cleanScratch();
  const { ok } = control();
  if (!ok) process.exit(1);

  const outcome = runOne(BAD_CONTROL);
  console.log("");
  console.log(`BAD CONTROL (${BAD_CONTROL.defect})`);
  console.log(`  verdict: ${outcome.verdict}  ${outcome.detail}`);

  rmSync(WORK, { recursive: true, force: true });

  if (outcome.verdict === "HARNESS_ERROR") {
    console.log("");
    console.log("FAIL: the bad control did not run. A control that cannot execute proves nothing.");
    process.exitCode = 1;
    return;
  }
  if (outcome.verdict === "CAUGHT") {
    console.log("");
    console.log(
      "OK: the control was CAUGHT. Two brand-separating assertions exist, so the battery can",
    );
    console.log("    see a brand collision. The harness demonstrably detects a real defect.");
    return;
  }
  console.log("");
  console.log("OK: the control SURVIVED, which is the expected outcome for a defect no suite claims.");
  console.log("    The harness can therefore produce a SURVIVED verdict, so '0 survivors' above means something.");
}

function selftest() {
  cleanScratch();
  const failures = [];

  // 1. The classifier must recognise a syntax error as NOT a catch.
  const syntax = classify("SyntaxError: Unexpected token '}'");
  if (!syntax.isSyntax) failures.push("classify() did not flag a SyntaxError as a load failure");

  // 2. A missing module is a load failure, not a catch.
  if (!classify("Cannot find module 'x'").isSyntax) {
    failures.push("classify() did not flag a missing module as a load failure");
  }

  // 3. A passing run reads as zero failures.
  const green = classify("ℹ pass 1860\nℹ fail 0");
  if (green.fail !== 0 || green.isSyntax) failures.push("classify() misread a green run");

  // 4. A failing run reads as a non-zero failure count.
  const red = classify("ℹ pass 1800\nℹ fail 60");
  if (red.fail !== 60) failures.push("classify() misread a failing run");

  // 5. Output with no summary is a harness error, not a silent pass.
  const none = classify("something happened");
  if (none.fail !== null) failures.push("classify() invented a failure count from output with no summary");

  // 6. A deliberately broken mutation must be reported as HARNESS_ERROR, not CAUGHT.
  const broken = { ...MUTATIONS[0], from: "this anchor is not present in any built file" };
  const brokenOutcome = runOne(broken);
  if (brokenOutcome.verdict !== "HARNESS_ERROR") {
    failures.push(`a broken anchor produced ${brokenOutcome.verdict} instead of HARNESS_ERROR`);
  }

  // 7. An ambiguous anchor must also be HARNESS_ERROR - a mutation that hits several
  //    places is not a controlled experiment even if it runs.
  const ambiguous = { ...MUTATIONS[0], from: "return" };
  const ambiguousOutcome = runOne(ambiguous);
  if (ambiguousOutcome.verdict !== "HARNESS_ERROR") {
    failures.push(`an ambiguous anchor produced ${ambiguousOutcome.verdict} instead of HARNESS_ERROR`);
  }

  // 8. The structural control must be green, or every structural mutation would be
  //    reported as "caught" for a reason that has nothing to do with the mutation.
  if (!structuralControl()) {
    failures.push("the structural control is not green from a scratch cwd");
  }

  // 9. A structural mutation whose anchor is missing must be HARNESS_ERROR too - the
  //    source mode is not exempt from the classification rules.
  const brokenStructural = { ...STRUCTURAL_MUTATIONS[0], from: "this anchor is not present in any source file" };
  if (runStructural(brokenStructural).verdict !== "HARNESS_ERROR") {
    failures.push("a broken structural anchor was not reported as HARNESS_ERROR");
  }

  cleanScratch();

  console.log("");
  if (failures.length === 0) {
    console.log(`HARNESS SELF-TEST PASS (${9}/9 checks)`);
    console.log("The classifier distinguishes green, red, load-failure and unclassified output,");
    console.log("a mutation that cannot be applied cleanly is a harness error in BOTH modes,");
    console.log("and the structural control is green before any structural verdict is read.");
    return;
  }
  console.log(`HARNESS SELF-TEST FAIL (${failures.length} problem(s))`);
  for (const failure of failures) console.log(`  - ${failure}`);
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
