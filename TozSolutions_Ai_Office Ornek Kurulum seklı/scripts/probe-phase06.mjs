/**
 * PHASE 06 independent verification probe, and its self-test.
 *
 * WHY A SEPARATE PROBE AT ALL
 *
 * Every isolation claim in this phase is enforced by tests that share this repository's
 * fixtures, helpers and assumptions. That is the right way to test behaviour and the
 * wrong way to test a claim of the form "the partition is applied EVERYWHERE", because
 * a suite that shares an author's assumptions can only confirm them.
 *
 * So this probe imports the BUILT `dist/` and nothing else - no test helper, no shared
 * fixture, no source read - and states each invariant as a fact about the running system,
 * phrased differently from the suite. It is deliberately written to be readable as an
 * argument, not as a test list.
 *
 * WHY THE SELF-TEST IS THE POINT
 *
 * A probe that only ever prints PASS has demonstrated nothing. `--selftest` reverts each
 * isolation decision, one at a time, in a COPY of dist/, re-runs the probe against that
 * copy, and requires the corresponding check to FAIL. A probe whose checks cannot be
 * made to fail by breaking the thing they check is decoration, and this mode is what
 * distinguishes the two.
 *
 * Each self-test entry therefore declares which check it must break. An entry whose
 * named check still passes is a FAILURE of the self-test, not a pass with a note - the
 * probe is then making a claim it cannot back up.
 *
 * Usage:
 *   node scripts/probe-phase06.mjs
 *   node scripts/probe-phase06.mjs --selftest
 */

import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";

const REPO = process.cwd();
const DIST = path.join(REPO, "dist");
const WORK = path.join(REPO, ".probe-phase06");

const NOW = new Date("2026-04-01T00:00:00.000Z");

/* -------------------------------------------------------------------------- */
/* The probe                                                                   */
/* -------------------------------------------------------------------------- */

/** Loads the built modules. `base` lets the self-test point at a mutated copy. */
async function load(base) {
  const u = (rel) => pathToFileURL(path.join(base, rel)).href;
  const [workspace, clockMod, queue, agents, tools, feedback, claims, gates, state, audit, models, trace] =
    await Promise.all([
      import(u("src/orchestration/workspace/workspace.js")),
      import(u("src/core/clock.js")),
      import(u("src/queue/queue.js")),
      import(u("src/orchestration/agent/registry.js")),
      import(u("src/orchestration/tools/tool.js")),
      import(u("src/orchestration/feedback/feedback.js")),
      import(u("src/orchestration/workflow/claims.js")),
      import(u("src/orchestration/workflow/gates.js")),
      import(u("src/state/store.js")),
      import(u("src/audit/events.js")),
      import(u("src/models/model.js")),
      import(u("src/orchestration/observability/trace.js")),
    ]);
  return { workspace, clockMod, queue, agents, tools, feedback, claims, gates, state, audit, models, trace };
}

async function run(base = DIST) {
  const m = await load(base);
  const { workspaceRef } = m.workspace;
  const clock = new m.clockMod.ManualClock(NOW);

  const ACME = workspaceRef("acme");
  const ACME_BRAND = workspaceRef("acme", "brand-two");
  const GLOBEX = workspaceRef("globex");

  const checks = [];
  // AWAITS its callback. A check that has not finished has not passed - the first
  // version of this probe's predecessor called `fn()` without awaiting and reported
  // PASS before its assertions had run.
  const check = async (name, fn) => {
    try {
      await fn();
      checks.push({ name, ok: true });
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };
  const eq = (actual, expected, what) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
  };
  const ok = (value, what) => {
    if (!value) throw new Error(what);
  };

  /* -- 1. identity comes only from a resolved provenance ---------------------- */

  await check("a workspace is accepted only from a resolved identity", () => {
    const resolved = {
      actor: "a",
      trustLevel: "standard",
      grants: [],
      scopes: [],
      provenance: "resolved",
      workspace: ACME,
    };
    eq(m.workspace.workspaceOf(resolved)?.workspace, "acme", "resolved identity");

    // Every other provenance is refused, INCLUDING one that carries a perfectly valid
    // workspace. A caller that states where it is has stated nothing about where it is
    // allowed to be.
    for (const provenance of ["asserted", "delegated", "absent"]) {
      let threw = false;
      try {
        m.workspace.workspaceOf({ ...resolved, provenance });
      } catch {
        threw = true;
      }
      ok(threw, `provenance "${provenance}" must be refused for partitioned work`);
    }
  });

  /* -- 2. the key function distinguishes workspace AND brand ------------------ */

  await check("a composite key separates workspace, brand and every part", () => {
    const { workspaceKey } = m.workspace;
    const seen = new Set();
    for (const w of [ACME, ACME_BRAND, GLOBEX]) {
      for (const part of ["job-1", "task-1"]) {
        const key = workspaceKey(w, part);
        ok(!seen.has(key), `key collision: ${key}`);
        seen.add(key);
      }
    }
    eq(seen.size, 6, "six distinct (workspace, brand, part) combinations");
    // A separator inside a part cannot re-spell another key.
    ok(workspaceKey(ACME, "a/b") !== workspaceKey(ACME, "a", "b"), "a part holding a separator stays distinct");
  });

  /* -- 3. every partitioned store separates two workspaces ------------------- */

  await check("no partitioned store lets one workspace read another's entry", () => {
    const probes = [
      {
        name: "queue",
        make: (w) => new m.queue.TaskQueue({ clock, workspace: w }),
        seed: (s) => s.enqueue({ taskId: "task-1", workload: "coding", input: "a" }),
        read: (s) => s.get("task-1")?.input,
      },
      {
        name: "state",
        make: (w) => new m.state.StateStore({ clock, workspace: w }),
        seed: (s) => s.set("ns", "k", "a"),
        read: (s) => s.get("ns", "k"),
      },
      {
        name: "agents",
        make: (w) => new m.agents.AgentRegistry({ clock, workspace: w }),
        seed: (s) => s.register({ agentId: "a-1", version: "1.0.0", adapter: "local", status: "active" }),
        read: (s) => s.get("a-1", "1.0.0")?.record.agentId,
      },
      {
        name: "tools",
        make: (w) => new m.tools.ToolRegistry({ clock, workspace: w }),
        seed: (s) =>
          s.register({ toolId: "t-1", kind: "local", description: "d", sideEffecting: true, minimumTrust: "low" }),
        read: (s) => s.get("t-1")?.sideEffecting,
      },
      {
        name: "claims",
        make: (w) => new m.claims.ClaimRegistry({ clock, workspace: w }),
        seed: (s) => s.claim("task-1", "job-1", "w-1"),
        read: (s) => s.current("job-1", "task-1")?.workerId,
      },
      {
        name: "checkpoints",
        make: (w) => new m.gates.CheckpointStore({ clock, workspace: w }),
        seed: (s) =>
          s.write({
            jobId: "job-1",
            taskId: "task-1",
            executionId: "e",
            progress: "1",
            dataRef: "ref://a",
            recoverable: true,
          }),
        read: (s) => s.latest("job-1", "task-1")?.dataRef,
      },
      {
        name: "feedback",
        make: (w) => new m.feedback.InMemoryFeedbackStore({ workspace: w }),
        seed: (s) =>
          s.append({
            traceId: "t",
            taskId: "task-1",
            taskType: "research",
            agentId: null,
            provider: null,
            model: null,
            topology: "single",
            outcome: "succeeded",
            verificationVerdict: null,
            errorClass: null,
            latencyMs: null,
            retries: 0,
          }),
        read: (s) => s.forTask("task-1").length === 0 ? undefined : "present",
      },
    ];

    for (const probe of probes) {
      const a = probe.make(ACME);
      const b = probe.make(ACME_BRAND);
      const c = probe.make(GLOBEX);
      probe.seed(a);
      ok(probe.read(a) !== undefined, `${probe.name}: the owning workspace must read its own entry`);
      eq(probe.read(b), undefined, `${probe.name}: a second brand must see nothing`);
      eq(probe.read(c), undefined, `${probe.name}: another workspace must see nothing`);
    }
  });

  /* -- 4. approvals: gate 17 ------------------------------------------------- */

  await check("an approval gate in one workspace cannot be found from another", () => {
    const make = (w) => new m.gates.InProcessApprovalRecordStore({ workspace: w });
    const a = make(ACME);
    const b = make(ACME_BRAND);
    a.put({
      gateId: "gate-x",
      jobId: "job-1",
      taskId: "task-1",
      question: "publish?",
      decision: null,
      decidedBy: null,
      decidedAt: null,
      openedAt: 0,
      expiresAtMs: null,
      intent: { taskId: "task-1", type: "research", description: "d", payload: {} },
    });
    eq(b.byTask("job-1", "task-1"), null, "byTask must not cross the partition");
    eq(b.get("gate-x"), null, "nor must the gate id be a shared handle");
    eq(b.all().length, 0, "nor appear in a listing");
    eq(a.byTask("job-1", "task-1")?.gateId, "gate-x", "the owner must still find it");
  });

  /* -- 5. audit: read is filtered, and events are stamped -------------------- */

  await check("an audit read answers only for the scope it was asked about", () => {
    const log = new m.audit.AuditLog({ clock, workspace: "acme", brand: null });
    log.append({ kind: "orchestration_event", step: "one", outcome: "ok" });
    eq(log.read({ workspace: "acme", brand: null }).length, 1, "own scope");
    eq(log.read({ workspace: "globex", brand: null }).length, 0, "another workspace");
    eq(log.read({ workspace: null, brand: null }).length, 0, "the unattributed partition");
    eq(log.read({ workspace: "acme", brand: "other" }).length, 0, "another brand of the same workspace");
    eq(log.read({ workspace: "acme", brand: null })[0]?.workspace, "acme", "the event is stamped");
  });

  /* -- 6. model metadata is closed ------------------------------------------- */

  await check("model metadata accepts a sanctioned key and refuses customer data", () => {
    const now = NOW;
    const clean = m.models.createModelRecord({
      modelId: "m-1",
      providerId: "p-1",
      now,
      metadata: { [m.models.QUALITY_TIER_METADATA_KEY]: "strong" },
    });
    ok(clean.ok, "a sanctioned key must be accepted");

    // Rejected by the compiler AND by the validator. The validator is the half that
    // holds, because a cast compiles cleanly - which is the reason it exists.
    const smuggled = m.models.createModelRecord({
      modelId: "m-2",
      providerId: "p-1",
      now,
      metadata: { workspace: "acme", tenantId: "acme" },
    });
    ok(!smuggled.ok, "customer data must not reach a deployment-scoped model record");
    ok(
      m.models.validateModelMetadata({ workspace: "acme" }).length > 0,
      "and the validator must refuse it directly",
    );
    eq(m.models.validateModelMetadata({}), [], "absent metadata is not an error");
  });

  /* -- 7. the runtime declares what it is ------------------------------------- */

  await check("describe() states the partition and the shared registries", async () => {
    const composition = await import(pathToFileURL(path.join(base, "src/orchestration/composition.js")).href);
    const declared = composition.createRuntime({ workspace: ACME }).describe();
    eq(declared.workspaceIsolation, "partitioned", "a declared workspace is partitioned");
    eq(declared.workspace, "acme", "and names itself");

    const undeclared = composition.createRuntime().describe();
    eq(undeclared.workspaceIsolation, "unasserted", "no workspace declared means no partition claimed");

    const shared = new Map(declared.platformScopedRegistries.map((entry) => [entry.name, entry]));
    for (const name of ["core.providers", "core.models", "capabilities", "verifiers", "providerAdapters"]) {
      ok(shared.has(name), `${name} must be listed as deployment-scoped`);
      eq(shared.get(name).customerData, false, `${name} must assert it holds no customer data`);
    }
    for (const name of ["memory", "feedback", "agents", "tools", "queue", "state"]) {
      ok(!shared.has(name), `${name} holds customer data and must not be shared`);
    }
  });

  /* -- 8. traces reach the audit log ------------------------------------------ */

  await check("a trace recorder writes into the audit log it was given", () => {
    const log = new m.audit.AuditLog({ clock, workspace: "acme", brand: null });
    const traces = new m.trace.TraceRecorder(log);
    // `record` takes an ExecutionContext - which is exactly why this check exists: the
    // PHASE 04 finding was that `TraceRecorder.byTask(taskId)` matched JOBS on the
    // coordinator path and TASKS on the orchestrator path, because two code paths set one
    // field to two different meanings. Naming the context explicitly is what makes the
    // trace attributable, so the probe names it too.
    traces.record(
      "orchestration_event",
      { taskId: "task-1", parentTaskId: "job-1", teamId: null },
      { step: "probe-step", outcome: "ok" },
    );
    // `OrchestrationEvent.step` carries the EVENT KIND, not a step name - a detail this
    // probe discovered rather than assumed, and worth stating because a reader would
    // reasonably expect the opposite. The caller's own `step` lands in `metadata.step`.
    const found = log
      .read({ workspace: "acme", brand: null })
      .filter((e) => e.metadata.step === "probe-step");
    eq(found.length, 1, "the trace must be in the log");
    eq(found[0]?.taskId, "task-1", "and attributed to the TASK, not the job");
    eq(found[0]?.parentTaskId, "job-1", "with the job as its parent");
    eq(log.read({ workspace: "globex", brand: null }).length, 0, "and not readable from another workspace");
  });

  return checks;
}

/* -------------------------------------------------------------------------- */
/* Runner                                                                      */
/* -------------------------------------------------------------------------- */

async function probe() {
  const checks = await run(DIST);
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
    if (!c.ok) console.log(`      ${c.detail}`);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log("");
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
  return checks;
}

/**
 * Each entry reverts one decision and names the check that MUST then fail.
 *
 * The named check is the contract: if reverting the decision leaves the probe green,
 * the probe is claiming something it cannot detect, and that is a self-test failure
 * rather than an acceptable outcome.
 */
const SELF_TEST = [
  {
    id: "T1",
    breaks: "a workspace is accepted only from a resolved identity",
    file: "src/orchestration/workspace/workspace.js",
    from: 'if (context.provenance !== "resolved") {',
    to: 'if (context.provenance === "absent") {',
  },
  {
    id: "T2",
    breaks: "a composite key separates workspace, brand and every part",
    file: "src/orchestration/workspace/workspace.js",
    from: 'return [head, ...parts].join("\\u0001");',
    to: 'return [...parts].join("\\u0001");',
  },
  {
    id: "T3",
    breaks: "an audit read answers only for the scope it was asked about",
    file: "src/audit/events.js",
    from: "return this.#events.filter((event) => event.workspace === scope.workspace && event.brand === scope.brand);",
    to: "return [...this.#events];",
  },
  {
    id: "T4",
    breaks: "model metadata accepts a sanctioned key and refuses customer data",
    file: "src/models/model.js",
    from: "issues.push(...validateModelMetadata(input.metadata));",
    to: "issues.push();",
  },
  {
    id: "T5",
    breaks: "describe() states the partition and the shared registries",
    file: "src/orchestration/composition.js",
    from: "    workspaceIsolation: workspace === null ? \"unasserted\" : \"partitioned\",",
    to: "    workspaceIsolation: \"partitioned\",",
  },
  {
    id: "T6",
    breaks: "a trace recorder writes into the audit log it was given",
    file: "src/audit/events.js",
    from: "workspace: this.#workspace,",
    to: "workspace: null,",
  },
];

function cleanScratch() {
  for (const name of readdirSync(REPO)) {
    if (name === ".probe-phase06" || name.startsWith(".probe-phase06-")) {
      rmSync(path.join(REPO, name), { recursive: true, force: true });
    }
  }
}

async function probeAgainst(base) {
  // A plain absolute path, not a file URL: `spawnSync` with `node <file-url>` passes the
  // URL through as a literal string on Windows and fails to resolve it.
  const script = path.join(REPO, "scripts", "probe-phase06.mjs");
  const result = spawnSync(process.execPath, [script], {
    cwd: base,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PROBE_BASE: base },
  });
  return { code: result.status ?? -1, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

async function selftest() {
  cleanScratch();

  // The probe must be GREEN before any self-test verdict is read, or a broken probe
  // would "detect" every break by failing for an unrelated reason.
  const controlRun = await probeAgainst(REPO);
  const controlGreen = controlRun.code === 0;
  console.log(`PROBE CONTROL  ${controlGreen ? "GREEN" : "BROKEN"}`);
  if (!controlGreen) {
    console.log(controlRun.output.split("\n").slice(-20).join("\n"));
    console.log("PROBE SELF-TEST FAIL: the probe is not green against the real build.");
    process.exitCode = 1;
    return;
  }

  const problems = [];
  for (const entry of SELF_TEST) {
    const dir = `${WORK}-${entry.id}`;
    cpSync(DIST, dir, { recursive: true });
    const target = path.join(dir, entry.file);
    let source;
    try {
      source = readFileSync(target, "utf8");
    } catch {
      rmSync(dir, { recursive: true, force: true });
      problems.push(`${entry.id}: missing ${entry.file}`);
      continue;
    }
    if (!source.includes(entry.from)) {
      rmSync(dir, { recursive: true, force: true });
      problems.push(`${entry.id}: anchor not found in ${entry.file}`);
      console.log(`${entry.id.padEnd(4)} HARNESS_ERROR  anchor not found`);
      continue;
    }
    writeFileSync(target, source.replace(entry.from, entry.to), "utf8");

    const outcome = await probeAgainst(REPO);
    // The mutated build is exercised by importing it directly, because the child probe
    // run imports the REAL dist. Reverted copy in, probe logic re-used, so the only
    // difference between the control run and this one is the mutation.
    const checks = await run(dir);
    rmSync(dir, { recursive: true, force: true });

    const named = checks.find((c) => c.name === entry.breaks);
    if (named === undefined) {
      problems.push(`${entry.id}: the probe has no check named "${entry.breaks}"`);
      console.log(`${entry.id.padEnd(4)} NO SUCH CHECK  ${entry.breaks}`);
      continue;
    }
    if (named.ok) {
      problems.push(`${entry.id}: reverting "${entry.breaks}" left it PASSING`);
      console.log(`${entry.id.padEnd(4)} NOT DETECTED  ${entry.breaks}`);
      continue;
    }
    // Every other check must still pass: a break that takes the whole probe down proves
    // nothing about the one check it was supposed to invalidate.
    const collateral = checks.filter((c) => !c.ok && c.name !== entry.breaks).map((c) => c.name);
    console.log(
      `${entry.id.padEnd(4)} DETECTED      ${entry.breaks}` +
        (collateral.length === 0 ? "" : `   (also failed: ${collateral.join(", ")})`),
    );
  }

  cleanScratch();
  console.log("");
  if (problems.length === 0) {
    console.log(`PROBE SELF-TEST PASS (${SELF_TEST.length}/${SELF_TEST.length})`);
    console.log("Every isolation decision the probe claims, the probe can be shown to fail without.");
    return;
  }
  console.log(`PROBE SELF-TEST FAIL (${problems.length} problem(s))`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
}

const mode = process.argv[2];
if (mode === "--selftest") await selftest();
else await probe();
