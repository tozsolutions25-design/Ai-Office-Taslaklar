/**
 * PHASE 03 mutation harness - governance and QA separation.
 *
 * Method, carried from Phase 01 and Phase 02 without being improved on:
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
 * Scope: every mutation runs the FULL suite, not only the Phase 03 file. Two of
 * the decisions here (the approval rule and the caller forwarding) were first
 * proved in the Phase 02 composition suite, and a mutant that only the other
 * suite can see must not be reported as surviving because the wrong file was
 * pointed at.
 *
 * Usage: node <repo>/scripts/mutation-phase03.mjs
 */

import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO = process.cwd();
const DIST = path.join(REPO, "dist");
// The copy lives at the same depth as `dist/` for the reason Phase 02 recorded:
// three pre-existing suites resolve `src/` relative to their own compiled
// location (`dist/tests/../src`), so a copy one level deeper stops being green
// for a reason that has nothing to do with the mutation under test. Each variant
// is a DIRECT child of the repository root and is deleted at the end; `src/` and
// `dist/` are never written to.
const WORK = path.join(REPO, ".mutation-phase03");
for (const name of readdirSync(REPO)) {
  if (name === ".mutation-phase03" || name.startsWith(".mutation-phase03-")) {
    rmSync(path.join(REPO, name), { recursive: true, force: true });
  }
}

/** @type {{id: string, defect: string, file: string, from: string, to: string}[]} */
const MUTATIONS = [
  {
    id: "M1",
    defect: "the runtime's identity resolver is consulted on the execution path",
    file: "src/orchestration/authority.js",
    from: "establishRequestIdentity(this.#options.governance, submitted, traceId)",
    to: "submitted",
  },
  {
    id: "M2",
    defect: "a supplied context is never replaced behind the caller's back",
    file: "src/orchestration/governance/enforcement.js",
    from: "    if (request.securityContext !== undefined) {\n        return request;\n    }\n",
    to: "",
  },
  {
    id: "M3",
    defect: "a root context is marked asserted, which is the honest default",
    file: "src/orchestration/governance/context.js",
    from: "provenance: \"asserted\",",
    to: "provenance: \"resolved\",",
  },
  {
    id: "M4",
    defect: "a derived context is marked delegated rather than inheriting",
    file: "src/orchestration/governance/context.js",
    from: "        provenance: \"delegated\",\n",
    to: "",
  },
  {
    id: "M5",
    defect: "withProvenance actually stamps the context it returns",
    file: "src/orchestration/governance/context.js",
    from: "return Object.freeze({ ...context, provenance });",
    to: "return context;",
  },
  {
    id: "M6",
    defect: "the composition root marks its resolved identity as resolved",
    file: "src/orchestration/composition.js",
    from: "withProvenance(resolved, \"resolved\")",
    to: "resolved",
  },
  {
    id: "M7",
    defect: "the job records the caller it was submitted with",
    file: "src/orchestration/workflow/coordinator.js",
    from: "caller: input.caller ?? null,",
    to: "caller: null,",
  },
  {
    id: "M8",
    defect: "the job's caller reaches the task execution request",
    file: "src/orchestration/workflow/coordinator.js",
    from: "...(job.caller === null ? {} : { securityContext: job.caller }),",
    to: "",
  },
  {
    id: "M9",
    defect: "the approver refuses the identity the job executes as",
    file: "src/orchestration/workflow/coordinator.js",
    from: "            job?.caller?.actor ?? null,\n            job?.caller?.principal ?? null,\n",
    to: "",
  },
  {
    id: "M10",
    defect: "the approver refuses the runtime's declared service principal",
    file: "src/orchestration/workflow/coordinator.js",
    from: "            this.#servicePrincipal?.actor ?? null,\n            this.#servicePrincipal?.principal ?? null,\n",
    to: "",
  },
  {
    id: "M11",
    defect: "the service principal is wired in from the composition root",
    file: "src/orchestration/composition.js",
    from: "servicePrincipal: serviceContext,",
    to: "",
  },
  {
    id: "M12",
    defect: "the bridge prefers the job's caller over the service principal",
    file: "src/orchestration/composition.js",
    from: "const claimed = request.securityContext ?? this.#serviceContext;",
    to: "const claimed = this.#serviceContext;",
  },
  {
    id: "M13",
    defect: "the task port forwards the identity to the bridge",
    file: "src/orchestration/workflow/worker.js",
    from: "...(request.securityContext === undefined ? {} : { securityContext: request.securityContext }),",
    to: "",
  },
  {
    id: "M14",
    defect: "the approval rule is constructed at all",
    file: "src/orchestration/composition.js",
    from: "new ApprovalRule(configured, observer),",
    to: "",
  },
  {
    id: "M15",
    defect: "configured operations are what the approval rule names",
    file: "src/orchestration/composition.js",
    from: "const configured = approvalRequired.filter(isOperation);",
    to: "const configured = [];",
  },
  {
    id: "M16",
    defect: "governance.approvalRequired reaches referenceGovernanceRules",
    file: "src/orchestration/composition.js",
    from: "options.knownActors ?? (() => true), config.governance.approvalRequired, recordedApprovals",
    to: "options.knownActors ?? (() => true), undefined, recordedApprovals",
  },
  {
    id: "M17",
    defect: "the reported verification verdict is recorded",
    file: "src/orchestration/workflow/coordinator.js",
    from: "const verdict = outcome.verificationVerdict ?? null;",
    to: "const verdict = null;",
  },
  {
    id: "M18",
    defect: "null means NOT MEASURED and does not block completion",
    file: "src/orchestration/workflow/coordinator.js",
    from: "verdict !== null && verdict !== \"pass\" && record.state === \"completed\"",
    to: "verdict !== \"pass\" && record.state === \"completed\"",
  },
  {
    id: "M19",
    defect: "the production executor passes the verdict out instead of swallowing it",
    file: "src/orchestration/workflow/worker.js",
    from: "verificationVerdict: response.verificationVerdict,",
    to: "verificationVerdict: null,",
  },
  // Added after the independent probe for this phase found three caller-attestable
  // holes that the first 19 did not cover. Each is reverted here individually.
  {
    id: "M20",
    defect: "a root context cannot be told how it was established",
    file: "src/orchestration/governance/context.js",
    from: "provenance: \"asserted\",",
    to: "provenance: input.provenance ?? \"asserted\",",
  },
  {
    id: "M21",
    defect: "the approval rule does not trust the context's own claim of approval",
    file: "src/orchestration/governance/policy.js",
    from: "        return this.#satisfiedBy(request) ? null : \"REQUIRE_APPROVAL\";",
    to: "        if (request.context.approvalState === \"approved\") {\n            return null;\n        }\n        return this.#satisfiedBy(request) ? null : \"REQUIRE_APPROVAL\";",
  },
  {
    id: "M22",
    defect: "a gate is frozen before the registry hands it out",
    file: "src/orchestration/workflow/gates.js",
    from: "const gate = Object.freeze({",
    to: "const gate = Object.assign({",
  },
  {
    id: "M23",
    defect: "a decided gate is frozen before the registry hands it out",
    file: "src/orchestration/workflow/gates.js",
    from: "const decided = Object.freeze({",
    to: "const decided = Object.assign({",
  },
  // PHASE 03, second pass. B-10 was raised by the independent probe: a
  // governance-configured approval could not be satisfied, the resolution never fed
  // back into governance, and `bridgeApproval` had no call site at all. These are
  // the nine wiring decisions that closed it, reverted one at a time. Each is a
  // decision somebody had to make, so each is proved rather than asserted - and the
  // FAIL-CLOSED direction is proved too, because a mutation that only shows the
  // permissive case being caught would not distinguish a working gate from a
  // permissive one.
  {
    id: "M24",
    defect: "governance's REQUIRE_APPROVAL is bridged into a gate at all",
    file: "src/orchestration/composition.js",
    from: '        if (value.errorClass === "approval_required") {',
    to: "        if (false) {",
  },
  {
    id: "M25",
    defect: "a recorded approval answers a configured requirement",
    file: "src/orchestration/governance/policy.js",
    from: '        return this.#satisfiedBy(request) ? null : "REQUIRE_APPROVAL";',
    to: '        return "REQUIRE_APPROVAL";',
  },
  {
    id: "M26",
    defect: "the hold is read from the coordinator's OWN gate registry, not from the outcome",
    file: "src/orchestration/workflow/coordinator.js",
    from: '            const awaiting = errorClass === "approval_required" ? this.#approvals.forTask(jobId, taskId) : null;',
    to: "            const awaiting = null;",
  },
  {
    id: "M27",
    defect: "only an UNDECIDED gate holds a task; a decided one is an answer",
    file: "src/orchestration/workflow/coordinator.js",
    from: '            if (awaiting !== null && awaiting.state === "waiting") {',
    to: '            if (awaiting !== null && awaiting.state === "approved") {',
  },
  {
    id: "M28",
    defect: "the rule's observer is bound to the one approval registry",
    file: "src/orchestration/composition.js",
    from: "    recordedApprovals.bind(coordinator.approvals);",
    to: "",
  },
  {
    id: "M29",
    defect: "the gate port is bound to the coordinator that owns the registry",
    file: "src/orchestration/composition.js",
    from: "    jobApprovalGates.bind(coordinator);",
    to: "",
  },
  {
    id: "M30",
    defect: "the identity reaching governance carries the job it runs as",
    file: "src/orchestration/composition.js",
    from: "            : inJobScope(claimed, { jobId: request.jobId, taskId: request.taskId });",
    to: "            : claimed;",
  },
  {
    id: "M31",
    defect: "the job scope is stamped onto the identity rather than ignored",
    file: "src/orchestration/governance/context.js",
    from: "    return Object.freeze({ ...context, jobId: scope.jobId, taskId: scope.taskId });",
    to: "    return context;",
  },
  {
    id: "M32",
    defect: "the task port forwards the job to the bridge",
    file: "src/orchestration/workflow/worker.js",
    from: "            ...(request.jobId === undefined ? {} : { jobId: request.jobId }),\n",
    to: "",
  },
  {
    id: "M33",
    defect: "the decision bridged is the one governance actually recorded",
    file: "src/orchestration/governance/gate.js",
    from: '            if (decision !== undefined && decision.verdict === "REQUIRE_APPROVAL" && decision.taskId === taskId) {',
    to: "            if (false) {",
  },
  {
    id: "M34",
    defect: "the approval rule is given the observer at all",
    file: "src/orchestration/composition.js",
    from: "        new ApprovalRule(configured, observer),",
    to: "        new ApprovalRule(configured),",
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
  return { code: result.status ?? -1, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

/** Load failure is NOT a catch. Classified separately, on purpose. */
function classify(output) {
  // NARROW, on purpose. An earlier version also matched "is not defined" and
  // "is not a constructor", which appear inside ordinary assertion messages - so a
  // real test failure was reported as a load error and a mutant was dismissed as
  // unprovable. Only module-load diagnostics count as a load error.
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
  if (name === ".mutation-phase03" || name.startsWith(".mutation-phase03-")) {
    rmSync(path.join(REPO, name), { recursive: true, force: true });
  }
}

const caught = results.filter((r) => r.verdict === "CAUGHT").length;
const survived = results.filter((r) => r.verdict === "SURVIVED");
// `id`, not `verdict`: the control's verdict is "GREEN", so filtering on the
// literal "CONTROL" counted the control itself as an unclassified result and
// turned a fully-caught run into a non-zero exit. Found by reading the harness
// after a run whose printed summary contradicted its own numbers.
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
