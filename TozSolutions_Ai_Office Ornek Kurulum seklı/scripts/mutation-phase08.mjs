/**
 * PHASE 08 mutation harness - agent architecture.
 *
 * Method inherited from PHASE 01-07 unchanged, because the method is not where this phase can
 * fail:
 *
 *   - PATCH A COPY of dist/ (behavioural) or src/ (structural). The working tree is never
 *     mutated, so an interrupted run cannot leave a reverted source behind.
 *   - ONE decision reverted per run, individually.
 *   - A LOAD ERROR is classified separately and NEVER counted as a catch.
 *   - A mutation that SURVIVES is reported as SURVIVED, not quietly omitted.
 *   - Each mode has its own CONTROL, which must be green before any verdict is read.
 *   - `--selftest` re-checks every anchor against the real source, because a stale anchor
 *     silently REMOVES a mutation from the battery. That check exists because PHASE 07's first
 *     run reported five harness errors from stale anchors.
 *
 * ## WHY THIS PHASE HAS BOTH MODES
 *
 * Several of the decisions below are statements about SOURCE STRUCTURE: the orchestrator being
 * the only adapter call site, the executive port having three members, the catalogue naming no
 * orchestrator. None of them is observable through behaviour - a second adapter call site
 * cannot be reached from outside, and a port's missing method cannot be detected by calling
 * what is there. PHASE 07 proved what happens when a battery mutates `dist/` while the only
 * detector reads `src/`: survivors, and a false green if the structural control is missing.
 *
 * ## THE BAD MUTATION CONTROL
 *
 * `--bad-control` reverts a decision this battery does NOT assert is caught, and reports
 * whatever verdict comes back. A battery that has only ever printed CAUGHT has not
 * demonstrated it can print anything else.
 *
 * Usage:
 *   node scripts/mutation-phase08.mjs
 *   node scripts/mutation-phase08.mjs --bad-control
 *   node scripts/mutation-phase08.mjs --selftest
 */

import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO = process.cwd();
const DIST = path.join(REPO, "dist");
const WORK = path.join(REPO, ".mutation-phase08");

function cleanScratch() {
  for (const name of readdirSync(REPO)) {
    if (name === ".mutation-phase08" || name.startsWith(".mutation-phase08-")) {
      rmSync(path.join(REPO, name), { recursive: true, force: true });
    }
  }
}

/**
 * Compiled suites whose assertions read SOURCE, so they detect a source mutation.
 *
 * PHASE 07's two are here for their own cross-phase claims; the PHASE 08 suites carry this
 * phase's structural decisions. Leaving the PHASE 08 list out is what made the first PHASE 07
 * run report three SURVIVORS with CONTROL green.
 */
const STRUCTURAL_SUITES = [
  "tests/workspaceRegistryBoundaries.p06-evidence.test.js",
  "tests/memoryScopeModel.p07-evidence.test.js",
  "tests/agentAuthority.p08-evidence.test.js",
  "tests/trustPolicyWiring.p08-evidence.test.js",
  "tests/agentSurface.p08-evidence.test.js",
  "tests/agentRouteAccounting.p08-evidence.test.js",
  "tests/agentCatalogue.p08-evidence.test.js",
  "tests/executiveLayer.p08-evidence.test.js",
];

/* -------------------------------------------------------------------------- */
/* Behavioural mutations - revert one decision in dist/                        */
/* -------------------------------------------------------------------------- */

const MUTATIONS = [
  {
    id: "M1",
    defect: "the pool refuses a candidate below the requested trust floor",
    file: "src/orchestration/pool/specialistPool.js",
    from: 'rejections.push("trust_below_floor");',
    to: "",
  },
  {
    id: "M2",
    defect: "an agent whose lifecycle is not `available` is not selectable",
    file: "src/orchestration/pool/specialistPool.js",
    from: 'rejections.push("not_available");',
    to: "",
  },
  {
    id: "M3",
    defect: "an agent the deployment does not have the tools for is refused",
    file: "src/orchestration/pool/specialistPool.js",
    from: 'rejections.push("missing_tool");',
    to: "",
  },
  {
    id: "M4",
    defect: "an agent's declared memory reach is checked against the actor's grants",
    file: "src/orchestration/pool/specialistPool.js",
    from: 'rejections.push("memory_scope_unavailable");',
    to: "",
  },
  {
    id: "M5",
    defect: "an agent that declares a capability unsupported is refused",
    file: "src/orchestration/pool/specialistPool.js",
    from: 'rejections.push("capability_incompatible");',
    to: "",
  },
  {
    id: "M6",
    defect: "the pool refuses a task demanding more trust than the deployment allows",
    file: "src/orchestration/pool/specialistPool.js",
    from: "if (trustRank(request.minimumTrust) > trustRank(this.#maximumTrustFloor)) {",
    to: "if (false) {",
  },
  {
    id: "M7",
    defect: "the registry refuses to skip the agent lifecycle",
    file: "src/orchestration/agent/registry.js",
    from: "return err(new AgentLifecycleError(entry.lifecycle, to));",
    to: "entry.lifecycle = to; return ok(entry);",
  },
  {
    id: "M8",
    defect: "an undeclared tool call is refused",
    file: "src/orchestration/tools/invoker.js",
    from: 'refusals.push({ toolId, reason: UNDECLARED });',
    to: "",
  },
  {
    id: "M9",
    defect: "a caller's grant is required before a workflow may execute",
    file: "src/orchestration/governance/policy.js",
    // The DENY itself, not a message about it. An earlier version of this mutation reverted a
    // literal reason string that no longer exists - the rule returns a bare `"DENY"` - and the
    // anchor check caught it, which is the check doing its job.
    from: "return grant === null ? \"DENY\" : \"ALLOW\";",
    to: 'return "ALLOW";',
  },
  {
    id: "M10",
    // PROMOTED FROM STRUCTURAL after surviving the first run, for the reason PHASE 07
    // recorded as D-56.
    //
    // The claim - "the catalogue contains no orchestrator entry" - is asserted against the
    // IMPORTED catalogue, not against source. A structural mutation patches `src/` while the
    // suite's imports come from unmutated `dist/`, so the test read the real catalogue and
    // correctly reported green. The invariant is data, and data is compiled: the honest
    // experiment patches `dist/src/orchestration/agent/catalogue.js`, where the suite's own
    // imports notice.
    defect: "the catalogue contains no orchestrator entry",
    file: "src/orchestration/agent/catalogue.js",
    from: 'agentId: "qa-reviewer",',
    to: 'agentId: "hermes-coordinator",\n        name: "Hermes Coordinator",\n        role: "coordination",\n        summary: "The single orchestration authority for the whole system.",\n        capabilities: ["reasoning"],\n        memoryScopes: ["task", "global"],\n        trustLevel: "privileged",\n        costClass: "standard",\n        latencyClass: "standard",\n        executionMode: "in_process",\n        requiresModelRoute: false,\n    },\n    {\n        agentId: "qa-reviewer",',
  },
  {
    id: "M11",
    // Also promoted from structural. Every assertion about the configured default floor read
    // source, and a source-reading test cannot see a behavioural change - which is why the
    // first run reported this SURVIVED even though the fix was real. A behavioural test now
    // runs a task with no stated floor against a runtime configured to demand `high`.
    defect: "the orchestrator reads the configured default trust floor",
    file: "src/orchestration/authority.js",
    from: 'this.#defaultMinimumTrust = options.defaultMinimumTrust ?? "low";',
    to: 'this.#defaultMinimumTrust = "low";',
  },
];

/* -------------------------------------------------------------------------- */
/* Structural mutations - revert one decision in src/                          */
/* -------------------------------------------------------------------------- */

const STRUCTURAL_MUTATIONS = [
  {
    id: "S1",
    defect: "the orchestrator is the only production site that invokes an adapter",
    file: "src/orchestration/authority.ts",
    from: "const execution = await adapter.execute(agent.agentId, {",
    to: "const execution = await (globalThis as any).__tozSecondAdapter ? adapter.execute(agent.agentId, {\n            taskId: subtask.taskId,\n            objective: subtask.objective,\n            input: subtask.input,\n            requiredCapabilities: [...subtask.requiredCapabilities],\n            timeoutMs: subtask.limits.timeoutMs,\n            signal: runContext.signal,\n        }) : adapter.execute(agent.agentId, {",
  },
  {
    id: "S2",
    defect: "the executive port offers exactly describe, observe and submit",
    file: "src/orchestration/executive/index.ts",
    from: "  submit(request: OrchestrationRequest): Promise<Result<OrchestrationResult, Error>>;\n}",
    to: "  submit(request: OrchestrationRequest): Promise<Result<OrchestrationResult, Error>>;\n  cancel(taskId: string): Promise<void>;\n}",
  },
  {
    id: "S3",
    defect: "the executive port holds no approval vocabulary",
    file: "src/orchestration/executive/index.ts",
    from: "export interface ExecutiveControlPort {\n  /** What the system is and can do. No side effects. */\n  describe(): ExecutiveDescription;",
    to: "export interface ExecutiveControlPort {\n  decideApproval(gateId: string, decision: string): Promise<void>;\n  /** What the system is and can do. No side effects. */\n  describe(): ExecutiveDescription;",
  },
  {
    id: "S4",
    // PROMOTED FROM BEHAVIOURAL after surviving the first run, and the reason is the one
    // PHASE 06 documented: **each `AgentRegistry` instance already belongs to exactly one
    // workspace, so two instances never share a Map and the workspace inside the key is not
    // observable through behaviour at all.** A behavioural mutation of the key therefore
    // changes nothing a caller can see, and the cross-workspace test keeps passing.
    //
    // It is real, load-bearing the moment one instance serves two workspaces, and invisible
    // today. PHASE 06's answer applies unchanged: assert the key WIRING from source.
    // `workspaceRegistryBoundaries.p06-evidence.test.ts` is in this battery's structural list
    // and already requires every key function to reach its own `#workspace`.
    defect: "a workspace cannot read another workspace's agent",
    file: "src/orchestration/agent/registry.ts",
    from: "return workspaceKey(this.#workspace, agentKey(agentId, version));",
    to: "return agentKey(agentId, version);",
  },
  {
    id: "S5",
    defect: "the pool's maximum trust floor is wired to a maximum, not to a default",
    file: "src/orchestration/composition.ts",
    from: "maximumTrustFloor: config.agent.maximumTrustFloor,",
    to: "maximumTrustFloor: config.agent.defaultMinimumTrust,",
  },
];

/**
 * The deliberate BAD control.
 *
 * `assessCandidate` gains an extra rejection reason that no test cares about. Nothing asserts
 * the absence of a reason, so this is expected to SURVIVE - and a survivor here is the point:
 * it demonstrates the harness can print one, which is what makes "0 survivors" above mean
 * something. A CAUGHT verdict would also be acceptable; a HARNESS_ERROR is not.
 */
const BAD_CONTROL = {
  id: "BAD",
  defect: "assessCandidate reports an extra rejection reason nobody asked about",
  file: "src/orchestration/pool/specialistPool.js",
  from: 'const rejections = [];',
  to: 'const rejections = ["not_available_but_harmless"];',
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
  const isSyntax =
    /(SyntaxError:|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|Cannot find module|Cannot use import statement|The requested module)/.test(
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

/** Stages an unmutated copy to mutate FROM, mirroring the repo layout each mode needs. */
function stageDist() {
  const dir = `${WORK}-stage-dist`;
  rmSync(dir, { recursive: true, force: true });
  cpSync(DIST, dir, { recursive: true });
  return dir;
}

/**
 * Stages an unmutated copy to mutate FROM, mirroring the repo layout each mode needs.
 *
 * `src` AND `tests` are both staged. `tests` because
 * `agentSurface.p08-evidence.test.ts` scans `<cwd>/src` and `<cwd>/tests` for uses of the
 * names it expects to be unused, and with only `src` staged it died with
 * `ENOENT: scandir '<stage>/tests'` - which the harness would have reported as a BROKEN
 * structural control for a reason that has nothing to do with the architecture.
 *
 * This is the same lesson PHASE 07 recorded about the structural layout: a staged copy whose
 * shape differs from the repository makes structural suites fail for reasons that are not
 * findings, and a broken control then invalidates every verdict.
 */
function stageSrc() {
  const dir = `${WORK}-stage-src`;
  rmSync(dir, { recursive: true, force: true });
  cpSync(path.join(REPO, "src"), path.join(dir, "src"), { recursive: true });
  cpSync(path.join(REPO, "tests"), path.join(dir, "tests"), { recursive: true });
  return dir;
}

/**
 * Reports whether `mutation.from` is present exactly once in `mutation.file` inside the staged
 * base. Separate from `applyAndRun` so the self-test can ask without running a suite.
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
const runStructural = (dir) =>
  runSuite(dir, dir, STRUCTURAL_SUITES.map((s) => path.join(DIST, s)));

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
    console.log(`PHASE 08 mutation battery: ${caught.length}/${total} caught, 0 survivors, 0 harness errors.`);
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
        ? "OK: caught. The harness demonstrably detects a real agent-boundary defect."
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
    ["a green run reads as zero failures", classify("ℹ pass 1948\nℹ fail 0").fail === 0],
    ["a failing run reads as its count", classify("ℹ pass 1900\nℹ fail 48").fail === 48],
    ["output with no summary invents nothing", classify("something happened").fail === null],
  ];
  for (const [label, ok] of classifyChecks) {
    if (!ok) failures.push(`classify(): ${label}`);
  }

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

  // Every anchor, re-checked against the real source. A stale anchor silently removes a
  // mutation from the battery, so this is the check that keeps the count honest.
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
