/**
 * PHASE 04 mutation harness - the approval / execution boundary.
 *
 * Method, carried from Phase 01-03 without being improved on:
 *
 *   - PATCH A COPY of dist/ outside the repository. The working tree is never
 *     mutated, so an interrupted run cannot leave a reverted source behind.
 *   - ONE wiring decision reverted per run, individually.
 *   - A LOAD ERROR is classified separately and NEVER counted as a catch.
 *   - A mutation that SURVIVES is reported as SURVIVED, not quietly omitted.
 *
 * Scope: every mutation runs the FULL suite. Every decision Phase 04 made is
 * load-bearing for a PHASE 01-03 guarantee as well as its own - the release path
 * is the same code PHASE 01 closed C-3 on - so a mutant only another suite can see
 * must not be reported as surviving because the wrong file was pointed at.
 *
 * FAIL-CLOSED DIRECTIONS ARE MUTATED TOO, not only the permissive ones. A binding
 * check that is only ever proved by "it refuses the bad case" would pass a
 * mutation that made it refuse everything; the pair M2/M3 below exists so that
 * "refuses wrong content" and "still permits right content" are separate, provable
 * decisions.
 *
 * Usage: node <repo>/scripts/mutation-phase04.mjs
 */

import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO = process.cwd();
const DIST = path.join(REPO, "dist");
// Same reason as the Phase 03 harness: three pre-existing suites resolve `src/`
// relative to their own compiled location (`dist/tests/../src`), so the copy must
// sit at the same depth as `dist/`.
const WORK = path.join(REPO, ".mutation-phase04");
for (const name of readdirSync(REPO)) {
  if (name === ".mutation-phase04" || name.startsWith(".mutation-phase04-")) {
    rmSync(path.join(REPO, name), { recursive: true, force: true });
  }
}

/** @type {{id: string, defect: string, file: string, from: string, to: string}[]} */
const MUTATIONS = [
  // -- The content binding ------------------------------------------------------
  {
    id: "M1",
    defect: "the release check compares the approval against the content at all",
    file: "src/orchestration/workflow/gates.js",
    from: "        if (gate.binding !== binding) {",
    to: "        if (false) {",
  },
  {
    id: "M2",
    defect: "a gate records WHAT was approved, on the record",
    file: "src/orchestration/workflow/gates.js",
    from: "      binding: approvalBindingOf(input.intent),",
    to: "      binding: approvalBindingOf({ objective: '', input: '', requiredCapabilities: [], minimumTrust: '' }),",
  },
  {
    id: "M3",
    defect: "the capability set is part of the content",
    file: "src/orchestration/workflow/gates.js",
    from: "[...intent.requiredCapabilities].sort().join(\"\\u0000\"),",
    to: "[...intent.requiredCapabilities].join(\"\\u0000\"),",
  },
  {
    id: "M4",
    defect: "the objective is part of the content",
    file: "src/orchestration/workflow/gates.js",
    from: "        intent.objective,\n        intent.input,",
    to: "        '',\n        intent.input,",
  },
  {
    id: "M5",
    defect: "the input is part of the content",
    file: "src/orchestration/workflow/gates.js",
    from: "        intent.input,\n        // U+0000",
    to: "        '',\n        // U+0000",
  },
  {
    id: "M6",
    defect: "a gate with nothing behind it is refused rather than stored",
    file: "src/orchestration/workflow/coordinator.js",
    from: "        if (record === undefined) {\n            throw new ApprovalError(\"new\",",
    to: "        if (false) {\n            throw new ApprovalError(\"new\",",
  },
  {
    id: "M7",
    defect: "the gate is bound to the coordinator's OWN task, not to a caller's claim",
    file: "src/orchestration/workflow/coordinator.js",
    from: "      intent: record.task,",
    to: "      intent: { objective: 'anything', input: 'anything', requiredCapabilities: [], minimumTrust: 'low' },",
  },
  {
    id: "M8",
    defect: "the release check uses the SAME content the executor receives",
    file: "src/orchestration/workflow/coordinator.js",
    from: "const approval = this.#approvals.mayRelease(jobId, taskId, record.task.approvalRequired, executed);",
    to: "const approval = this.#approvals.mayRelease(jobId, taskId, record.task.approvalRequired, { objective: 'other', input: 'other', requiredCapabilities: [], minimumTrust: 'low' });",
  },
  // -- The record container -----------------------------------------------------
  {
    id: "M9",
    defect: "the registry reads and writes through the store it was given",
    file: "src/orchestration/workflow/gates.js",
    from: "        this.#store.put(gate);",
    to: "        void gate;",
  },
  {
    id: "M10",
    defect: "a store that cannot promise durability does not claim it",
    file: "src/orchestration/workflow/gates.js",
    from: '    durability = "process-local";',
    to: '    durability = "durable";',
  },
  {
    id: "M11",
    defect: "the runtime reports the durability the store actually declares",
    file: "src/orchestration/composition.js",
    from: "                approvalDurability: coordinator.approvals.durability,",
    to: '                approvalDurability: "durable",',
  },
  // -- The re-drive ownership contract ------------------------------------------
  {
    id: "M12",
    defect: "an approved, un-run task reports that its owner must re-drive it",
    file: "src/orchestration/workflow/coordinator.js",
    from: '            if (record.state !== "ready") {',
    to: '            if (record.state === "never") {',
  },
  {
    id: "M13",
    defect: "a job that never asked for an approval is not told it owes a re-drive",
    file: "src/orchestration/workflow/coordinator.js",
    from: "            if (record.approval === null) {",
    to: "            if (false) {",
  },
  {
    id: "M14",
    defect: "the runtime states who owns the re-drive",
    file: "src/orchestration/composition.js",
    from: '                approvalRedrive: "caller-owned",',
    to: '                approvalRedrive: "automatic",',
  },
  // -- The operation classification ---------------------------------------------
  {
    id: "M15",
    defect: "an outbound operation is classified as needing a human",
    file: "src/orchestration/governance/operations.js",
    from: '    // The system\'s door to the outside: a tool may publish, send or spend.\n    "tool.invoke": true,',
    to: '    // The system\'s door to the outside: a tool may publish, send or spend.\n    "tool.invoke": false,',
  },
  {
    id: "M16",
    defect: "spending a resource is classified as needing a human",
    file: "src/orchestration/governance/operations.js",
    from: '    // Grants authority: the escalation the brief names.\n    "approval.resolve": true,\n    "resource.consume": true,',
    to: '    // Grants authority: the escalation the brief names.\n    "approval.resolve": true,\n    "resource.consume": false,',
  },
  {
    id: "M17",
    defect: "internal mechanics are NOT classified as needing a human",
    file: "src/orchestration/governance/operations.js",
    from: '    "workflow.execute": false,',
    to: '    "workflow.execute": true,',
  },
  {
    id: "M18",
    defect: "the runtime reports the classification separately from what is configured",
    file: "src/orchestration/composition.js",
    from: "                approvalRequiredOperations: [...config.governance.approvalRequired],",
    to: "                approvalRequiredOperations: [...OPERATIONS.filter(isHumanApprovalOperation)],",
  },
  // -- The removal ---------------------------------------------------------------
  {
    id: "M19",
    defect: "the execution gate is still asked about approval on every release",
    file: "src/orchestration/workflow/coordinator.js",
    from: "      const awaiting = errorClass === \"approval_required\" ? this.#approvals.forTask(jobId, taskId) : null;",
    to: "      const awaiting = null;",
  },
  {
    id: "M20",
    defect: "only an UNDECIDED gate holds a task; a decided one is an answer",
    file: "src/orchestration/workflow/coordinator.js",
    from: '      if (awaiting !== null && awaiting.state === "waiting") {',
    to: '      if (awaiting !== null && awaiting.state === "approved") {',
  },
  {
    id: "M21",
    defect: "the governance verdict is bridged into a gate at all",
    file: "src/orchestration/composition.js",
    from: "        const outcome = bridgeApproval({\n            decision,\n            gates: this.#gates.forJob(jobId),\n            jobId,\n            taskId,\n        });",
    to: "        const outcome = { action: \"denied\", decision };\n        void bridgeApproval;",
  },
];

/** Every compiled test file in a variant's `tests/` directory. */
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
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: result.status ?? -1, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

/** Load failure is NOT a catch. Classified separately, on purpose. */
function classify(output) {
  const isSyntax = /(SyntaxError:|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|Cannot find module|Cannot use import statement|The requested module)/.test(output);
  const passMatch = output.match(/(?:^|\n)\s*(?:ℹ|#)\s*pass\s+(\d+)/);
  const failMatch = output.match(/(?:^|\n)\s*(?:ℹ|#)\s*fail\s+(\d+)/);
  return {
    isSyntax,
    pass: passMatch === null ? null : Number(passMatch[1]),
    fail: failMatch === null ? null : Number(failMatch[1]),
  };
}

const results = [];

// CONTROL: unmutated copy. If the control is not green, nothing below means anything.
{
  const dir = WORK;
  rmSync(dir, { recursive: true, force: true });
  cpSync(DIST, dir, { recursive: true });
  const { output } = runSuite(dir);
  const c = classify(output);
  const verdict = c.fail === 0 && !c.isSyntax ? "GREEN" : "BROKEN";
  results.push({ id: "CONTROL", verdict, detail: `pass=${c.pass} fail=${c.fail} syntax=${c.isSyntax}` });
  console.log(`CONTROL  ${verdict}  pass=${c.pass} fail=${c.fail} syntax=${c.isSyntax}`);
  if (verdict !== "GREEN") {
    console.log("The control is not green; every mutation below would be uninterpretable. Stopping.");
    console.log("--- last 30 lines of the control output ---");
    console.log(output.split("\n").slice(-30).join("\n"));
    process.exit(1);
  }
}

for (const mutation of MUTATIONS) {
  const dir = `${WORK}-${mutation.id}`;
  cpSync(DIST, dir, { recursive: true });
  const target = path.join(dir, mutation.file);
  let source;
  try {
    source = readFileSync(target, "utf8");
  } catch {
    results.push({ id: mutation.id, verdict: "HARNESS_ERROR", detail: `missing ${mutation.file}` });
    console.log(`${mutation.id.padEnd(8)} HARNESS_ERROR  missing ${mutation.file}`);
    continue;
  }
  if (!source.includes(mutation.from)) {
    results.push({ id: mutation.id, verdict: "HARNESS_ERROR", detail: `anchor not found in ${mutation.file}` });
    console.log(`${mutation.id.padEnd(8)} HARNESS_ERROR  anchor not found in ${mutation.file}`);
    continue;
  }
  if (source.split(mutation.from).length - 1 !== 1) {
    results.push({ id: mutation.id, verdict: "HARNESS_ERROR", detail: `anchor is not unique in ${mutation.file}` });
    console.log(`${mutation.id.padEnd(8)} HARNESS_ERROR  anchor is not unique in ${mutation.file}`);
    continue;
  }
  writeFileSync(target, source.replace(mutation.from, mutation.to));

  const { code, output } = runSuite(dir);
  const c = classify(output);

  let verdict;
  let detail;
  if (c.isSyntax) {
    verdict = "LOAD_ERROR";
    detail = "the mutant did not load; this is NOT counted as a catch";
  } else if (c.fail !== null && c.fail > 0) {
    verdict = "CAUGHT";
    detail = `fail=${c.fail} pass=${c.pass}`;
  } else if (code !== 0) {
    verdict = "CAUGHT";
    detail = `non-zero exit ${code}`;
  } else {
    verdict = "SURVIVED";
    detail = "no test distinguishes the mutant from the real code";
  }
  results.push({ id: mutation.id, verdict, detail });
  console.log(`${mutation.id.padEnd(8)} ${verdict.padEnd(13)} ${mutation.defect} :: ${detail}`);
}

for (const name of readdirSync(REPO)) {
  if (name === ".mutation-phase04" || name.startsWith(".mutation-phase04-")) {
    rmSync(path.join(REPO, name), { recursive: true, force: true });
  }
}

const caught = results.filter((r) => r.verdict === "CAUGHT").length;
const survived = results.filter((r) => r.verdict === "SURVIVED");
// `id`, not `verdict`: the control's verdict is "GREEN".
const broken = results.filter((r) => r.id !== "CONTROL" && r.verdict !== "CAUGHT");
// PHASE 05: the control copy is removed rather than left for the next run to find.
// A directory of compiled JavaScript left inside the repository is litter that the
// next `lint`/`typecheck` has to be taught to ignore - which is exactly what had to
// happen, and is now also handled in `eslint.config.mjs`.
rmSync(WORK, { recursive: true, force: true });
console.log("");
console.log(`CAUGHT ${caught}/${MUTATIONS.length}`);
console.log(`SURVIVED ${survived.length}: ${survived.map((r) => r.id).join(", ") || "none"}`);
console.log(`NOT-A-CATCH ${broken.length}: ${broken.map((r) => `${r.id}=${r.verdict}`).join(", ") || "none"}`);
if (survived.length > 0 || broken.length > 0) {
  process.exitCode = 2;
}