/**
 * PHASE 02 mutation harness.
 *
 * Method, carried from Phase 01 and not improved on:
 *
 *   - PATCH A COPY of dist/ outside the repository. The working tree is never
 *     mutated, so an interrupted run cannot leave a reverted source behind.
 *   - ONE wiring decision reverted per run, individually.
 *   - A LOAD ERROR is classified separately and NEVER counted as a catch. Phase 01
 *     scored a JavaScript SyntaxError as "mutation caught", which proved nothing;
 *     D-03 then reproduced itself in a new form. The classifier below is the
 *     response.
 *   - A mutation that SURVIVES is reported as SURVIVED, not quietly omitted. A
 *     line that no test can distinguish is not defence in depth; it is untested
 *     code, and Phase 01 deleted one such line rather than keep it.
 *
 * Usage: node <repo>/scripts/mutation-phase02.mjs
 */

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO = process.cwd();
const DIST = path.join(REPO, "dist");
// The copy lives INSIDE the repository, at the same depth as `dist/`, because three
// pre-existing suites resolve `src/` relative to their own compiled location
// (`dist/tests/../src` and `../../src`). A copy under %TEMP% breaks those walks and
// the control is then not green for a reason that has nothing to do with the
// mutation. Same depth, same shape, and the working tree's real `src/` is still the
// one the architecture tests read. Deleted at the end; `src/` and `dist/` are never
// written to.
// Each variant therefore gets its own directory that is a DIRECT child of the
// repository root - the same depth as `dist/` itself, never one level deeper.
// Compiled suites resolve `src/` as `<variant>/../../src`, so a variant nested one
// level further down resolves it inside the variant and the control stops being
// green for a reason that has nothing to do with the mutation under test.
const WORK = path.join(REPO, ".mutation-phase02");
for (const name of readdirSync(REPO)) {
  if (name === ".mutation-phase02" || name.startsWith(".mutation-phase02-")) {
    rmSync(path.join(REPO, name), { recursive: true, force: true });
  }
}

/** @type {{id: string, defect: string, file: string, from: string, to: string, scope?: string}[]} */
const MUTATIONS = [
  {
    id: "M1",
    defect: "governance is on the execution path",
    file: "src/orchestration/composition.js",
    from: "governance: enforced ? governance : undefined,",
    to: "",
  },
  {
    id: "M2",
    defect: "the governance recorder is wired into the gate",
    file: "src/orchestration/governance/gate.js",
    from: "this.#recorder = options.recorder ?? null;",
    to: "this.#recorder = null;",
  },
  {
    id: "M3",
    defect: "there is exactly ONE policy engine",
    file: "src/orchestration/governance/gate.js",
    from: "this.#engine = options.engine;",
    to: "this.#engine = { check: () => ({ verdict: 'ALLOW', reasonCode: 'permission_granted', reason: 'engine ignored', evaluatedRules: [], operation: null, actor: null, resource: null, capability: null, scope: null, policy: 'mutant', approvalRequired: false, approvalId: null, workflowId: null, executionId: null, trustLevel: null, jobId: null, taskId: null, at: 0, delegations: [] }), decisions: () => [], refusals: () => [], ruleNames: [], delegateAuthority: () => ({ ok: true, context: null }) };",
  },
  {
    id: "M4",
    defect: "one audit history",
    file: "src/orchestration/composition.js",
    from: "const traces = new TraceRecorder(audit);",
    to: "const traces = new TraceRecorder();",
  },
  {
    id: "M5",
    defect: "memory writes are policy-checked",
    file: "src/orchestration/composition.js",
    from: "    memory,\n        memoryPolicy,",
    to: "    memory,",
  },
  {
    id: "M6",
    defect: "the memory service is on the orchestrator",
    file: "src/orchestration/composition.js",
    from: "...(memoryService === null ? {} : { memoryService }),",
    to: "",
  },
  {
    id: "M7",
    defect: "disabled memory grants nothing",
    file: "src/orchestration/composition.js",
    from: "      new DisabledMemoryProvider();",
    to: "      new InMemoryMemoryProvider();",
  },
  {
    id: "M8",
    defect: "ingestion never promotes unless configured",
    file: "src/orchestration/composition.js",
    from: "promoteToAvailable: config.agents.autoPromote,",
    to: "promoteToAvailable: true,",
  },
  {
    id: "M9",
    defect: "a provider route must have an adapter behind it",
    file: "src/orchestration/composition.js",
    from: "        providerAdapters,",
    to: "",
  },
  {
    id: "M10",
    defect: "a runtime with no agent backend says so",
    file: "src/orchestration/composition.js",
    from: "const adapterList = suppliedAdapters.length > 0 ? suppliedAdapters : [new UnavailableAgentAdapter()];",
    to: "const adapterList = suppliedAdapters;",
  },
  {
    id: "M11",
    // Re-anchored, and re-scoped, in PHASE 03.
    //
    // The line this used to name no longer exists: the bridge was extracted into a
    // class, so the composition root no longer builds the request inline. The
    // DECISION is the same one - a run with no identity travels with no identity
    // attached, so the governance gate refuses it rather than the bridge inventing a
    // principal - and it is still in the bridge, still in the composition root.
    //
    // `scope: "full"` because PHASE 03 moved the proof. B-08 gave the workflow path
    // a job's own caller, so "the workflow path carries its service identity" is now
    // a statement about the FALLBACK, and the test that distinguishes it is the
    // PHASE 03 suite's, not this one. The same reason M19 already runs the full
    // suite. Pointing this at the phase-02 file alone would report a survivor for a
    // decision the suite no longer makes.
    scope: "full",
    defect: "the workflow path refuses without a service identity",
    file: "src/orchestration/composition.js",
    from: "...(identity === null ? {} : { securityContext: identity }),",
    to: "",
  },
  {
    id: "M12",
    // Re-anchored and re-scoped for the same reason as M11, plus the bridge's
    // constructor gained the two PHASE 03 collaborators.
    scope: "full",
    defect: "the workflow path carries its service identity",
    file: "src/orchestration/composition.js",
    from: "new RuntimeExecutionBridge(orchestrator, serviceContext, enforced ? governance : null, jobApprovalGates)",
    to: "new RuntimeExecutionBridge(orchestrator, null, enforced ? governance : null, jobApprovalGates)",
  },
  {
    id: "M13",
    defect: "the configured routing policy reaches the fallback planner",
    file: "src/orchestration/composition.js",
    from: "        policy: config.routing.defaultPolicy,",
    to: "",
  },
  {
    id: "M14",
    defect: "the workflow concurrency ceiling is configured",
    file: "src/orchestration/composition.js",
    from: "        maxConcurrency: config.workflow.maxConcurrency,",
    to: "",
  },
  {
    id: "M15",
    defect: "the tool call ceiling is configured",
    file: "src/orchestration/composition.js",
    from: "const toolHost = new ToolExecutionHost({ registry: tools, invokers, defaultTimeoutMs: config.tools.defaultTimeoutMs });",
    to: "const toolHost = new ToolExecutionHost({ registry: tools, invokers });",
  },
  {
    id: "M16",
    defect: "the configured input policy is installed",
    file: "src/orchestration/composition.js",
    from: "    inputPolicy: inputPolicyFor(config.security.inputPolicy),",
    to: "    inputPolicy: new PermissiveInputPolicy(),",
  },
  {
    id: "M17",
    defect: "a rejected configuration is refused",
    file: "src/orchestration/composition.js",
    from: "    if (issues.length > 0) {\n        return err(new RuntimeConfigurationError(issues));\n    }",
    to: "",
  },
  {
    id: "M18",
    defect: "the environment is actually read",
    file: "src/orchestration/composition.js",
    from: "const env = options.env ?? (process.env);",
    to: "const env = options.env ?? ({});",
  },
  {
    id: "M19",
    defect: "a run that required no verification reports no verdict",
    file: "src/orchestration/authority.js",
    from: "const reportedVerification = verificationRequired ? verification : null;",
    to: "const reportedVerification = verification;",
    scope: "full",
  },
  {
    id: "M20",
    defect: "the advisory downgrade is recorded",
    file: "src/orchestration/composition.js",
    from: 'traces.record("runtime_started",',
    to: 'traces.record("orchestration_started",',
  },
  {
    id: "M21",
    defect: "the registered provider inventory reaches the orchestrator",
    file: "src/orchestration/composition.js",
    from: "        providerIds: () => core.providers.list().map((provider) => provider.providerId),",
    to: "",
  },
  {
    id: "M22",
    defect: "the orchestration config is read from the environment",
    file: "src/orchestration/composition.js",
    from: "const raw = rawOrchestrationConfigFromEnv(env);",
    to: "const raw = {};",
  },
  {
    id: "M23",
    defect: "recall scopes reach the orchestrator",
    file: "src/orchestration/composition.js",
    from: "    recallScopes: recallScopesOf(config.memory.recallScopes),",
    to: "    recallScopes: [],",
  },
  {
    id: "M24",
    defect: "the memory importance floor is configured",
    file: "src/orchestration/composition.js",
    from: "    minimumImportance: config.memory.minimumImportance,",
    to: "",
  },
  {
    id: "M25",
    defect: "the shared tool registry reaches the tool host",
    file: "src/orchestration/composition.js",
    from: "const toolHost = new ToolExecutionHost({ registry: tools, invokers, defaultTimeoutMs: config.tools.defaultTimeoutMs });",
    to: "const toolHost = new ToolExecutionHost({ registry: new ToolRegistry({ clock }), invokers, defaultTimeoutMs: config.tools.defaultTimeoutMs });",
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
  // Asserted rather than assumed: an empty list makes `node --test` fall back to
  // discovering `**/*.test.ts` in the working directory, which runs the SOURCE files
  // with Node's TypeScript loader. That produces a plausible-looking result about a
  // completely different set of files, which is worse than crashing.
  const target = listTests(variantDir);
  if (target.length === 0) {
    throw new Error(`No compiled tests found in ${path.join(variantDir, "tests")}`);
  }
  const result = spawnSync(process.execPath, ["--test", ...target], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return { code: result.status ?? -1, output };
}

/** Load failure is NOT a catch. Classified separately, on purpose. */
function classify(output) {
  // NARROW, on purpose. An earlier version also matched "is not defined" and
  // "is not a constructor", which appear inside ordinary assertion messages - so a
  // real test failure was reported as a load error and a mutant was dismissed as
  // unprovable. Only module-load diagnostics count as a load error.
  const isSyntax = /(SyntaxError:|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|Cannot find module|Cannot use import statement|The requested module)/.test(output);
  const failedTests = (output.match(/^\s*[✖x]\s+/gm) ?? []).length;
  const passMatch = output.match(/(?:^|\n)\s*(?:ℹ|#)\s*pass\s+(\d+)/);
  const failMatch = output.match(/(?:^|\n)\s*(?:ℹ|#)\s*fail\s+(\d+)/);
  return {
    isSyntax,
    failedTests,
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
  results.push({ id: "CONTROL", verdict: c.fail === 0 && !c.isSyntax ? "GREEN" : "BROKEN", detail: `pass=${c.pass} fail=${c.fail} syntax=${c.isSyntax}` });
  console.log(`CONTROL  ${results[0].verdict}  pass=${c.pass} fail=${c.fail} syntax=${c.isSyntax}`);
  if (results[0].verdict !== "GREEN") {
    console.log("The control is not green; every mutation below would be uninterpretable. Stopping.");
    console.log("--- last 30 lines of the control output ---");
    console.log(output.split("\n").slice(-30).join("\n"));
    process.exitCode = 1;
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
  writeFileSync(target, source.replace(mutation.from, mutation.to));

  const files = mutation.scope === "full" ? listTests(dir) : [path.join(dir, "tests", "compositionRoot.phase02.test.js")];
  if (files.length === 0) throw new Error(`No compiled tests found in ${dir}`);
  const result = spawnSync(process.execPath, ["--test", ...files], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const c = classify(output);

  let verdict;
  let detail;
  if (c.isSyntax) {
    verdict = "LOAD_ERROR";
    detail = "the mutant did not load; this is NOT counted as a catch";
  } else if (c.fail !== null && c.fail > 0) {
    verdict = "CAUGHT";
    detail = `fail=${c.fail} (${mutation.scope === "full" ? "full suite" : "phase-02 suite"})`;
  } else if (result.status !== 0) {
    verdict = "CAUGHT";
    detail = `non-zero exit ${result.status}`;
  } else {
    verdict = "SURVIVED";
    detail = "no test distinguishes the mutant from the real code";
  }
  results.push({ id: mutation.id, verdict, detail });
  console.log(`${mutation.id.padEnd(8)} ${verdict.padEnd(13)} ${mutation.defect} :: ${detail}`);
}

for (const name of readdirSync(REPO)) {
  if (name === ".mutation-phase02" || name.startsWith(".mutation-phase02-")) {
    rmSync(path.join(REPO, name), { recursive: true, force: true });
  }
}

const caught = results.filter((r) => r.verdict === "CAUGHT").length;
const survived = results.filter((r) => r.verdict === "SURVIVED");
// `id`, not `verdict`: the control's verdict is "GREEN", so filtering on the
// literal "CONTROL" counted the control itself as an unclassified result and
// turned a fully-caught run into a non-zero exit.
const broken = results.filter((r) => r.id !== "CONTROL" && r.verdict !== "CAUGHT");
// PHASE 05: the control copy is removed rather than left for the next run to find.
// A directory of compiled JavaScript left inside the repository is litter that the
// next lint/	ypecheck has to be taught to ignore - which is exactly what had
// to happen, and is now also handled in eslint.config.mjs.
rmSync(WORK, { recursive: true, force: true });
console.log("");
console.log(`CAUGHT ${caught}/${MUTATIONS.length}`);
console.log(`SURVIVED ${survived.length}: ${survived.map((r) => r.id).join(", ") || "none"}`);
console.log(`NOT-A-CATCH ${broken.length}: ${broken.map((r) => `${r.id}=${r.verdict}`).join(", ") || "none"}`);
if (survived.length > 0 || broken.length > 0) {
  process.exitCode = 2;
}