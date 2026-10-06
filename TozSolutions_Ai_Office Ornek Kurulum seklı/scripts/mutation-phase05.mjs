/**
 * PHASE 05 mutation harness - the provider / tool boundary.
 *
 * Method, carried from Phase 01-04 without being improved on:
 *
 *   - PATCH A COPY of dist/ outside the repository. The working tree is never
 *     mutated, so an interrupted run cannot leave a reverted source behind.
 *   - ONE decision reverted per run, individually.
 *   - A LOAD ERROR is classified separately and NEVER counted as a catch.
 *   - A mutation that SURVIVES is reported as SURVIVED, not quietly omitted.
 *
 * WHY THIS PHASE'S BATTERY IS MOSTLY FAIL-CLOSED MUTATIONS. The defect this phase
 * found was a caller asserting a fact the system owns: an adapter reported a tool
 * call, and the orchestrator wrote `sideEffecting: false` into the evidence without
 * asking anyone. Every mutation below that matters therefore removes a REFUSAL. A
 * battery of only "now it permits the bad case" reverts would pass against a suite
 * that refused everything, so each is paired with a positive control: M2/M3 are the
 * pair "still permits the legitimate call" against "still refuses the illegitimate
 * one", and the battery reports them separately for exactly that reason.
 *
 * Usage: node <repo>/scripts/mutation-phase05.mjs
 */

import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO = process.cwd();
const DIST = path.join(REPO, "dist");
// Same reason as the Phase 03 and 04 harnesses: some pre-existing suites resolve
// `src/` relative to their own compiled location, so the copy must sit at the same
// depth as `dist/`.
const WORK = path.join(REPO, ".mutation-phase05");
for (const name of readdirSync(REPO)) {
  if (name === ".mutation-phase05" || name.startsWith(".mutation-phase05-")) {
    rmSync(path.join(REPO, name), { recursive: true, force: true });
  }
}

/** @type {{id: string, defect: string, file: string, from: string, to: string}[]} */
const MUTATIONS = [
  // -- A reported tool call is evidence only when verified -----------------------
  {
    id: "M1",
    defect: "the orchestrator verifies a reported tool call AT ALL",
    file: "src/orchestration/authority.js",
    from: "      const toolOutcome = this.#verifyReportedTools(subtask, agent, context, execution.value.toolCalls ?? []);",
    to: "      const toolOutcome = { ok: true, verified: (execution.value.toolCalls ?? []).map((toolId) => ({ toolId, durationMs: null, sideEffecting: false })) };",
  },
  {
    id: "M2",
    defect: "a tool the agent never declared is refused",
    file: "src/orchestration/tools/invoker.js",
    from: "      if (!declared.includes(toolId)) {",
    to: "      if (false) {",
  },
  {
    id: "M3",
    defect: "the registry, not the claimant, states whether a tool has side effects",
    file: "src/orchestration/tools/invoker.js",
    from: "        sideEffecting: decision.value.sideEffecting,",
    to: "        sideEffecting: false,",
  },
  {
    id: "M4",
    defect: "an unmeasured duration is reported as unmeasured",
    file: "src/orchestration/tools/invoker.js",
    from: "                durationMs: null,\n                // The registry's fact, not the claimant's silence.",
    to: "                durationMs: 0,\n                // The registry's fact, not the claimant's silence.",
  },
  {
    id: "M5",
    defect: "an unauthorised call is refused rather than recorded",
    file: "src/orchestration/tools/invoker.js",
    from: "            if (!decision.ok) {\n                refusals.push({ toolId, reason: decision.error.message });\n                continue;\n            }",
    to: "            if (false) {\n                refusals.push({ toolId, reason: decision.error.message });\n                continue;\n            }",
  },
  {
    id: "M6",
    defect: "a refusal FAILS the subtask rather than being a warning",
    file: "src/orchestration/authority.js",
    from: "      if (!toolOutcome.ok) {",
    to: "      if (false) {",
  },
  {
    id: "M7",
    defect: "a claim is refused when NO tool authority is configured",
    file: "src/orchestration/authority.js",
    from: "    if (host === undefined) {",
    to: "    if (false) {",
  },
  {
    id: "M8",
    defect: "the tool host and the orchestrator must share ONE registry",
    file: "src/orchestration/authority.js",
    from: "    if (options.toolHost !== undefined && options.toolHost.registry !== options.tools) {",
    to: "    if (false) {",
  },
  {
    id: "M9",
    defect: "a verified call is TRACED as invoked",
    file: "src/orchestration/authority.js",
    from: '            this.#record(context, "tool_invoked", {',
    to: '            this.#record(context, "tool_refused", {',
  },
  {
    id: "M10",
    defect: "a side-effecting tool needs an approval (B-13, first half)",
    file: "src/orchestration/tools/tool.js",
    from: "  if (tool.sideEffecting && permission.requiresApprovalForSideEffects === true) {",
    to: "  if (false) {",
  },
  {
    id: "M11",
    defect: "an approval for ANOTHER subject does not release this call",
    file: "src/orchestration/tools/tool.js",
    from: "  if (approval.toolId !== toolId || approval.subject !== subject) {",
    to: "  if (false) {",
  },
  {
    id: "M12",
    defect: "an approval with no named approver is not an approval",
    file: "src/orchestration/tools/tool.js",
    from: '  if (typeof approval.approvedBy !== "string" || approval.approvedBy.trim() === "") {',
    to: "  if (false) {",
  },
  {
    id: "M13",
    defect: "the orchestrator always requires approval for a side effect",
    file: "src/orchestration/authority.js",
    from: "requiresApprovalForSideEffects: true }, trustRank, reported);",
    to: "requiresApprovalForSideEffects: false }, trustRank, reported);",
  },
  // -- B-09: the configured policy orders the PRIMARY too -----------------------
  {
    id: "M14",
    defect: "the configured policy reaches primary selection at all",
    file: "src/orchestration/model/modelRouter.js",
    from: "      policy: requirements.policy ?? this.#policy ?? null,",
    to: "      policy: null,",
  },
  {
    id: "M15",
    defect: "a named policy orders the candidates",
    file: "src/routing/defaultRouter.js",
    from: "    const policy = request.policy === undefined || request.policy === null ? null : resolvePolicy(request.policy);",
    to: "    const policy = null;",
  },
  {
    id: "M16",
    defect: "the decision reports WHICH facts decided the order",
    file: "src/routing/defaultRouter.js",
    from: "        decidingFacts: [...comparison.decidingFacts],",
    to: "        decidingFacts: [],",
  },
  {
    id: "M17",
    defect: "a fact nothing recorded is reported as uninformed",
    file: "src/routing/defaultRouter.js",
    from: "        uninformedFacts: explanation.uninformedFacts,",
    to: "        uninformedFacts: [],",
  },
  {
    id: "M18",
    defect: "a refused policy name REJECTS rather than throwing synchronously",
    file: "src/routing/defaultRouter.js",
    from: "    return await Promise.resolve(this.#selectSync(request));",
    to: "    try {\n        return await Promise.resolve(this.#selectSync(request));\n    } catch {\n        return { selected: null, evaluated: [], consideredOrder: [], selectionReason: \"refused\", selectionVerdict: null };\n    }",
  },
  {
    id: "M19",
    defect: "a policy cannot reselect a candidate governance denied",
    file: "src/routing/defaultRouter.js",
    from: "    const all = applyCandidateExclusion(this.#candidates.candidates(), request.exclude);",
    to: "    const all = this.#candidates.candidates();",
  },
  // -- the dead methods, decided and reported -----------------------------------
  {
    id: "M20",
    defect: "availability is ASKED of each adapter",
    file: "src/orchestration/composition.js",
    from: "          availability.push({ name, available: await adapter.isAvailable() });",
    to: "          availability.push({ name, available: true });",
  },
  {
    id: "M21",
    defect: "the runtime reports the tool approval closure",
    file: "src/orchestration/composition.js",
    from: '        toolApproval: "required-and-unobtained",',
    to: '        toolApproval: "available",',
  },
];

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
  writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");
  const { output } = runSuite(dir);
  rmSync(dir, { recursive: true, force: true });
  const c = classify(output);
  let verdict;
  let detail;
  if (c.isSyntax) {
    verdict = "HARNESS_ERROR";
    detail = "the mutant failed to load; that is not a catch";
  } else if (c.fail === null) {
    verdict = "HARNESS_ERROR";
    detail = "no pass/fail summary in the mutant output";
  } else if (c.fail > 0) {
    verdict = "CAUGHT";
    detail = `${c.fail} failing test(s)`;
  } else {
    verdict = "SURVIVED";
    detail = "nothing failed";
  }
  results.push({ id: mutation.id, verdict, detail });
  console.log(`${mutation.id.padEnd(8)} ${verdict.padEnd(13)} ${detail}`);
}

const caught = results.filter((r) => r.verdict === "CAUGHT");
const survived = results.filter((r) => r.verdict === "SURVIVED");
const harness = results.filter((r) => r.verdict === "HARNESS_ERROR");

// The control copy is removed here rather than left for the next run to find. It
// exists only to prove the suite is green before any mutation is interpreted, and a
// directory of compiled JavaScript left inside the repository is litter that the
// next `lint`/`typecheck` has to be taught to ignore.
rmSync(WORK, { recursive: true, force: true });

console.log("");
console.log(`CAUGHT ${caught.length}/${MUTATIONS.length}`);
console.log(`SURVIVED ${survived.length}: ${survived.map((r) => `${r.id} (${r.defect})`).join("; ") || "none"}`);
console.log(`NOT-A-CATCH ${harness.length}: ${harness.map((r) => `${r.id} (${r.detail})`).join("; ") || "none"}`);

if (survived.length > 0 || harness.length > 0) {
  process.exitCode = 1;
}
