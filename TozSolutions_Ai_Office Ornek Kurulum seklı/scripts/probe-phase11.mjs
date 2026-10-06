/**
 * PHASE 11 independent verification probe, and its self-test.
 *
 * WHY A SEPARATE PROBE AT ALL
 *
 * Every PHASE 11 claim is enforced by tests that share this repository's fixtures and its
 * authors' assumptions. That is right for behaviour and wrong for the claims that matter most
 * in a phase whose subject was FALSE DOCUMENTATION: whether the built system actually behaves
 * as the corrected documents now claim.
 *
 * So this probe imports the BUILT `dist/` and nothing else, drives the real composition root,
 * and states each invariant as a fact about the running system rather than as a fact about the
 * source text.
 *
 * WHAT IT CHECKS - the five boundaries measured during PHASE 11, each one a boundary that was
 * previously wrong, stale, or unobservable:
 *
 *   1. adapter_invoked fires once per REAL crossing, and only on a crossing;
 *   2. errorClass reaches the trace (refuting the old "always null" claim), and durationMs is
 *      still dropped by the token guard (confirming the half that was right);
 *   3. one trace crosses the workflow boundary, and byTrace reaches both halves;
 *   4. the job is derivable from BOTH conventions a producer uses;
 *   5. an audit read narrows by kind and by time.
 *
 * WHY THE SELF-TEST IS THE POINT
 *
 * A probe that only ever prints PASS has demonstrated nothing. `--selftest` reverts each
 * decision, one at a time, in a COPY of dist/, and REQUIRES the named check to fail. Each entry
 * declares which check it must break; an entry whose named check still passes is a FAILURE.
 *
 * Usage:
 *   node scripts/probe-phase11.mjs
 *   node scripts/probe-phase11.mjs --selftest
 */

import { cpSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import path from "node:path";

const REPO = process.cwd();
const WORK = path.join(REPO, ".probe-phase11");
const NOW = new Date("2026-04-01T00:00:00.000Z");
const RESEARCH = "web_research";

function cleanScratch() {
  for (const name of readdirSync(REPO)) {
    if (name === ".probe-phase11" || name.startsWith(".probe-phase11-")) {
      rmSync(path.join(REPO, name), { recursive: true, force: true });
    }
  }
}

/** `PROBE_BASE` lets the self-test point the probe at a mutated copy of the build. */
async function load() {
  const base = process.env["PROBE_BASE"] ?? path.join(REPO, "dist");
  const u = (rel) => pathToFileURL(path.join(base, rel)).href;
  const [trace, clock, capabilities, result, governance, composition, adapter, audit, health] = await Promise.all([
    import(u("src/orchestration/observability/trace.js")),
    import(u("src/core/clock.js")),
    import(u("src/capabilities/capability.js")),
    import(u("src/core/result.js")),
    import(u("src/orchestration/governance/context.js")),
    import(u("src/orchestration/composition.js")),
    import(u("src/orchestration/agent/adapter.js")),
    import(u("src/audit/events.js")),
    import(u("src/health/monitor.js")),
  ]);
  return { trace, clock, capabilities, result, governance, composition, audit, health, Adapter: adapter };
}

async function run() {
  const m = await load();
  const checks = [];
  const check = async (name, fn) => {
    try {
      await fn();
      checks.push({ name, ok: true });
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };

  const { ManualClock } = m.clock;
  const { CapabilitySet } = m.capabilities;
  const { ok, err } = m.result;
  const { createSecurityContext } = m.governance;

  const grant = (operation, overrides = {}) => ({
    operation,
    resources: [],
    allowList: [],
    capabilities: [],
    trustFloor: "standard",
    expiresAt: null,
    ...overrides,
  });
  const authorised = () =>
    createSecurityContext({
      actor: "operator",
      trustLevel: "standard",
      grants: [
        grant("workflow.execute"),
        grant("capability.execute", { capabilities: [RESEARCH] }),
        grant("memory.read"),
        grant("memory.write"),
        grant("memory.capture"),
      ],
      scopes: ["task"],
    });

  /**
   * An adapter that COUNTS its own calls.
   *
   * The count is the ground truth for "a boundary was crossed". Counting inside the adapter
   * rather than reading the orchestrator's own bookkeeping is what makes the adapter_invoked
   * checks falsifiable.
   */
  function makeAdapter(name, behaviour = {}) {
    // A closure, not a method: `execute` is handed to the orchestrator as a bare function, so
    // a `this` reference would not survive and the counter would silently stay at zero. That
    // is not hypothetical - the first version of this probe did exactly that and the check
    // "the adapter was called exactly once" failed with 0, which is how it was caught.
    const calls = [];
    return {
      name,
      calls,
      isAvailable: () => Promise.resolve(true),
      describe: (agentId, version) =>
        Promise.resolve(ok({ agentId, name: "Probe adapter", version, capabilities: { supported: [RESEARCH], unsupported: [] } })),
      execute: (agentId, request) => {
        calls.push(request.taskId);
        return Promise.resolve(
          behaviour.fail
            ? err({ agentKey: `${agentId}@1.0.0`, name, errorClass: behaviour.fail, message: "probe failure" })
            : ok({
                agentId,
                version: "1.0.0",
                taskId: request.taskId,
                durationMs: 42,
                output: "done",
                ...(behaviour.tokens === true ? { inputTokens: 10, outputTokens: 20 } : {}),
                providerId: null,
                modelId: null,
              }),
        );
      },
    };
  }

  function runtimeWith(adapter, capabilities = CapabilitySet.supporting(RESEARCH), adapterKey = adapter.name) {
    const runtime = m.composition.createRuntime({
      clock: new ManualClock(NOW),
      adapters: [adapter],
      identity: { resolve: () => authorised(), serviceContext: authorised() },
      workspace: { workspace: "p11-probe", brand: null },
    });
    const input = {
      agentId: "probe-agent",
      version: "1.0.0",
      adapter: adapterKey,
      status: "active",
      trustLevel: "standard",
      capabilities,
      requiresModelRoute: false,
    };
    const registered = runtime.agents.register(input);
    assert.ok(registered.ok, `agent registration: ${JSON.stringify(registered.ok ? null : registered.error)}`);
    runtime.capabilities.index(registered.value.record);
    for (const step of ["verified", "registered", "available"]) {
      const moved = runtime.agents.transition(input.agentId, input.version, step);
      assert.ok(moved.ok, `agent ${step}: ${JSON.stringify(moved.ok ? null : moved.error)}`);
    }
    return runtime;
  }

  const go = (runtime) =>
    runtime.orchestrator.execute({
      taskId: "t1",
      objective: "do the thing",
      input: "go",
      requiredCapabilities: [RESEARCH],
      taskType: "single",
      securityContext: authorised(),
    });

  /* -- 1. the adapter boundary ------------------------------------------------ */

  await check("one adapter_invoked per REAL crossing, naming the adapter", async () => {
    const adapter = makeAdapter("probe");
    const runtime = runtimeWith(adapter);
    const result = await go(runtime);
    assert.equal(result.ok, true, `expected success: ${JSON.stringify(result.ok ? null : result.error)}`);

    const invocations = runtime.traces.events().filter((e) => e.kind === "adapter_invoked");
    assert.equal(adapter.calls.length, 1, "the adapter was called exactly once");
    assert.equal(invocations.length, 1, "so the record holds exactly one crossing");
    const metadata = invocations[0]?.metadata ?? {};
    assert.equal(metadata["adapter"], "probe", "and it names WHICH adapter - the thing no other event carried");
    assert.equal(metadata["attempt"], 1, "plus the attempt, so a retry is not the same as a first call");
  });

  await check("NO crossing is recorded for a run that never crossed", async () => {
    // The agent is registered against an adapter the runtime does not have. `agent_selected`
    // DOES fire here - so the selection event alone would read as "it ran".
    const adapter = makeAdapter("probe");
    const runtime = runtimeWith(adapter, CapabilitySet.supporting(RESEARCH), "not_registered");
    await go(runtime);

    assert.equal(adapter.calls.length, 0, "no adapter could be called");
    const kinds = runtime.traces.events().map((e) => e.kind);
    assert.ok(kinds.includes("agent_selected"), "the agent WAS selected - this is the case the event exists for");
    assert.ok(
      !kinds.includes("adapter_invoked"),
      `an unresolved adapter is not a crossing, but the record claims one: ${JSON.stringify(kinds)}`,
    );
    assert.ok(kinds.includes("subtask_failed"), "and the failure is still accounted for");
  });

  /* -- 2. errorClass and durationMs ------------------------------------------- */

  await check("errorClass reaches the trace, refuting the old 'always null' claim", async () => {
    const runtime = runtimeWith(makeAdapter("boom", { fail: "timeout" }), CapabilitySet.supporting(RESEARCH), "boom");
    await go(runtime);

    const classified = runtime.traces
      .events()
      .filter((e) => e.errorClass !== null && e.errorClass !== undefined);
    assert.ok(classified.length > 0, "the built system supplies errorClass; the §11 claim that it never did was FALSE");
    assert.ok(
      classified.some((e) => e.errorClass === "timeout"),
      "and the adapter's own class survives rather than being flattened to a generic one",
    );
  });

  await check("durationMs is still dropped without token counts, and kept with them", async () => {
    const without = runtimeWith(makeAdapter("untimed", {}), CapabilitySet.supporting(RESEARCH), "untimed");
    await go(without);
    const dropped = without.traces.events().find((e) => e.kind === "provider_usage_recorded");
    assert.ok(dropped !== undefined, "the usage event is emitted");
    assert.equal(dropped.durationMs, null, "an adapter reporting 42ms with no token counts has its duration discarded");

    const with_ = runtimeWith(makeAdapter("counted", { tokens: true }), CapabilitySet.supporting(RESEARCH), "counted");
    await go(with_);
    const kept = with_.traces.events().find((e) => e.kind === "provider_usage_recorded");
    assert.ok(kept !== undefined, "the usage event is emitted");
    assert.equal(kept.durationMs, 42, "and the SAME adapter WITH token counts keeps it - so the guard is the cause");
  });

  /* -- 3. the trace across the workflow boundary ------------------------------ */

  await check("a caller-supplied traceId is adopted, and byTrace reaches the events", async () => {
    const runtime = m.composition.createRuntime({
      clock: new ManualClock(NOW),
      workspace: { workspace: "p11-probe-trace", brand: null },
    });
    const result = await runtime.orchestrator.execute({
      taskId: "t1",
      objective: "cross the boundary",
      input: "go",
      requiredCapabilities: [],
      taskType: "single",
      traceId: "trace_from_the_workflow_side",
    });
    assert.equal(result.ok, true, `expected the run to start: ${JSON.stringify(result.ok ? null : result.error)}`);
    assert.equal(result.value.traceId, "trace_from_the_workflow_side", "the caller's id comes back, not a second one");

    const found = runtime.traces.byTrace("trace_from_the_workflow_side");
    assert.ok(found.length > 0, "and byTrace reaches the events under the SUPPLIED id");
  });

  await check("an unsupplied trace is still minted, and adoption does not stick", async () => {
    const runtime = m.composition.createRuntime({
      clock: new ManualClock(NOW),
      workspace: { workspace: "p11-probe-trace-2", brand: null },
    });
    const first = await runtime.orchestrator.execute({
      taskId: "t1", objective: "one", input: "go", requiredCapabilities: [], taskType: "single", traceId: "trace_first",
    });
    const second = await runtime.orchestrator.execute({
      taskId: "t2", objective: "two", input: "go", requiredCapabilities: [], taskType: "single",
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.notEqual(second.value.traceId, "trace_first", "a later unsupplied trace must not inherit the previous call's id");
    assert.ok(runtime.traces.byTrace(second.value.traceId).length > 0, "and its own events are findable");
  });

  /* -- 4. the job, from both conventions -------------------------------------- */

  await check("a job is derivable from parentTaskId AND from metadata.jobId", async () => {
    const runtime = m.composition.createRuntime({ clock: new ManualClock(NOW), workspace: { workspace: "p11-probe-job", brand: null } });
    // Shape 1: the per-task context.
    runtime.traces.record("subtask_started", { traceId: "t_a", taskId: "task-1", parentTaskId: "job-A", teamId: null }, { agentId: "a@1" }, NOW);
    // Shape 2: the workflow emitter, which has no task and labels the event instead.
    runtime.traces.record("job_completed", { traceId: "t_b", taskId: "job-B", parentTaskId: null, teamId: null }, { jobId: "job-B" }, NOW);

    assert.equal(runtime.traces.byJob("job-A").length, 1, "the task-context shape joins by job");
    assert.equal(runtime.traces.byJob("job-B").length, 1, "and so does the workflow-emitter shape - neither convention is second-class");
    assert.equal(
      (runtime.traces.byJob("job-B")[0]?.jobId ?? null),
      "job-B",
      "with the job as a first-class field, not something a consumer digs out of metadata",
    );
  });

  await check("byJob and byTrace do not overlap: neither lookup overreaches", async () => {
    const runtime = m.composition.createRuntime({ clock: new ManualClock(NOW), workspace: { workspace: "p11-probe-job-2", brand: null } });
    runtime.traces.record("subtask_started", { traceId: "shared", taskId: "task-1", parentTaskId: "job-C", teamId: null }, { agentId: "a@1" }, NOW);
    runtime.traces.record("subtask_completed", { traceId: "shared", taskId: "task-1", parentTaskId: null, teamId: null }, { agentId: "a@1" }, NOW);

    assert.equal(runtime.traces.byJob("job-C").length, 1, "byJob finds only the job's events");
    assert.equal(runtime.traces.byTrace("shared").length, 2, "byTrace finds the whole run");
  });

  /* -- 5. provider health, and the resolved collision ------------------------- */

  await check("health reports a transition ONCE, and only when the status changes", async () => {
    const clock = new ManualClock(NOW);
    const log = new m.audit.AuditLog({ clock, workspace: "p11-probe" });
    const monitor = new m.health.InMemoryHealthMonitor({ clock, sink: log });

    monitor.report("provider-a", { success: false, detail: "down" });
    monitor.report("provider-a", { success: false, detail: "still down" });

    const events = log.read({ workspace: "p11-probe", brand: null }).filter((e) => e.kind === "provider_health_changed");
    assert.equal(events.length, 1, "two failures in a row is ONE transition, not two events");
    assert.equal(events[0]?.targetId, "provider-a", "and it names the target");
  });

  await check("provider_health_changed is declared in exactly ONE vocabulary", async () => {
    const auditKinds = new Set(m.audit.AUDIT_EVENT_KINDS ?? []);
    const orchestrationKinds = new Set(m.trace.ORCHESTRATION_EVENT_KINDS);
    assert.ok(auditKinds.has("provider_health_changed"), "the audit vocabulary declares it");
    assert.ok(
      !orchestrationKinds.has("provider_health_changed"),
      "and the orchestration vocabulary does not - a kind declared twice with different payloads could not be consumed",
    );
  });

  /* -- 6. audit read filtering ------------------------------------------------- */

  await check("an audit read narrows by kind and by time, together", async () => {
    const clock = new ManualClock(NOW);
    const log = new m.audit.AuditLog({ clock, workspace: "p11-probe" });
    log.append({ kind: "task_transition", taskId: "t1", from: null, to: "queued", attempt: 1, errorClass: null });
    clock.advance(5_000);
    log.append({ kind: "task_transition", taskId: "t2", from: null, to: "running", attempt: 1, errorClass: null });
    clock.advance(5_000);
    log.append({ kind: "route_rejected", taskId: "t3", verdict: "not_eligible", workload: "chat", providerId: "p1", modelId: "m1", reason: "none" });

    const scope = { workspace: "p11-probe", brand: null };
    assert.equal(log.read(scope, { kind: "task_transition" }).length, 2, "kind alone narrows to the two transitions");
    assert.equal(log.read(scope).length, 3, "and an omitted filter still returns everything");
    const both = log.read(scope, { kind: "task_transition", since: new Date("2026-04-01T00:00:01.000Z") });
    assert.equal(both.length, 1, "kind AND time together leave exactly one");
    assert.equal(both[0]?.taskId, "t2", "the middle one - not the first transition, not the rejection");
  });

  /* -- 7. redaction ------------------------------------------------------------ */

  await check("redaction matches sensitive WORDS, not substrings", async () => {
    const { isSensitiveKey } = m.audit.isSensitiveKey === undefined ? await import(pathToFileURL(path.join(process.env["PROBE_BASE"] ?? path.join(REPO, "dist"), "src/audit/redaction.js")).href) : m.audit;
    // The half that must not move.
    for (const key of ["apiKey", "api_key", "authorization", "bearer", "connectionString", "password", "token", "privateKey"]) {
      assert.equal(isSensitiveKey(key), true, `${key} must be redacted`);
    }
    for (const key of ["userPassword", "authToken", "clientSecret", "awsSecretAccessKey"]) {
      assert.equal(isSensitiveKey(key), true, `${key} names a whole sensitive word and must be redacted`);
    }
    // The defect PHASE 11 removed.
    for (const key of ["secretariatName", "tokenizer", "conversation"]) {
      assert.equal(isSensitiveKey(key), false, `${key} merely CONTAINS a fragment and must survive`);
    }
  });

  return checks;
}

async function probe() {
  const checks = await run();
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
    if (!c.ok) console.log(`      ${c.detail}`);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log("");
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

/* -------------------------------------------------------------------------- */
/* The self-test                                                               */
/* -------------------------------------------------------------------------- */

const SELF_TEST = [
  {
    id: "T1",
    breaks: "one adapter_invoked per REAL crossing, naming the adapter",
    file: "src/orchestration/authority.js",
    from: 'this.#record(context, "adapter_invoked", { agentId: key, adapter: agent.adapter, attempt: runContext.attempt }, this.#clock.now());',
    to: "void 0;",
  },
  {
    id: "T2",
    breaks: "one adapter_invoked per REAL crossing, naming the adapter",
    file: "src/orchestration/authority.js",
    from: '{ agentId: key, adapter: agent.adapter, attempt: runContext.attempt }',
    to: '{ agentId: key, adapter: "unknown", attempt: runContext.attempt }',
  },
  {
    id: "T3",
    breaks: "NO crossing is recorded for a run that never crossed",
    // The decision this check exists for: an unresolved adapter must produce NO crossing. Reverted
    // by making the missing-adapter branch record one anyway - the most direct way to make the
    // event a lie, and the failure mode PHASE 11 was opened to prevent.
    //
    // A FIRST attempt at T3 mutated `health/monitor.js` instead, on the reasoning that both
    // checks concern "an event is emitted when it should not be". It came back NOT DETECTED,
    // correctly: provider health has nothing to do with the adapter boundary, so the check was
    // unaffected. The entry was measuring the harness, not the probe.
    file: "src/orchestration/authority.js",
    from: 'this.#record(context, "subtask_failed", { agentId: key, subtaskId: subtask.taskId, reason: message }, this.#clock.now());\n                return { ok: false, error: { errorClass: "configuration_error", message } };',
    to: 'this.#record(context, "subtask_failed", { agentId: key, subtaskId: subtask.taskId, reason: message }, this.#clock.now());\n                this.#record(context, "adapter_invoked", { agentId: key, adapter: agent.adapter, attempt: runContext.attempt }, this.#clock.now());\n                return { ok: false, error: { errorClass: "configuration_error", message } };',
  },
  {
    id: "T4",
    breaks: "errorClass reaches the trace, refuting the old 'always null' claim",
    // Multi-line because `errorClass: detail.errorClass ?? null,` appears TWICE in this file -
    // once building the recorder's event and once on the sink append - so a single-line anchor is
    // ambiguous. The leading `durationMs` line and the trailing PHASE 11 comment pin it to the
    // recorder's copy, which is the one `traces.events()` returns and the one the claim is about.
    file: "src/orchestration/observability/trace.js",
    from: "            durationMs: detail.durationMs ?? null,\n            errorClass: detail.errorClass ?? null,\n            // PHASE 11: REDACT ON THE WAY IN",
    to: "            durationMs: detail.durationMs ?? null,\n            errorClass: null,\n            // PHASE 11: REDACT ON THE WAY IN",
  },
  {
    id: "T5",
    breaks: "durationMs is still dropped without token counts, and kept with them",
    file: "src/orchestration/authority.js",
    from: "if (execution.value.inputTokens !== undefined || execution.value.outputTokens !== undefined) {",
    to: "if (true) {",
  },
  {
    id: "T6",
    breaks: "a caller-supplied traceId is adopted, and byTrace reaches the events",
    file: "src/orchestration/authority.js",
    from: 'const traceId = submitted.traceId ?? this.#ids.newId("trace");',
    to: 'const traceId = this.#ids.newId("trace");',
  },
  {
    id: "T7",
    breaks: "an unsupplied trace is still minted, and adoption does not stick",
    file: "src/orchestration/authority.js",
    from: 'const traceId = submitted.traceId ?? this.#ids.newId("trace");',
    to: 'const traceId = submitted.traceId ?? "trace_first";',
  },
  {
    id: "T8",
    breaks: "a job is derivable from parentTaskId AND from metadata.jobId",
    file: "src/orchestration/observability/trace.js",
    from: "jobId: labelledJob ?? context.parentTaskId,",
    to: "jobId: context.parentTaskId,",
  },
  {
    id: "T9",
    breaks: "a job is derivable from parentTaskId AND from metadata.jobId",
    file: "src/orchestration/observability/trace.js",
    from: "return this.#events.filter((event) => event.jobId === jobId);",
    to: "return [];",
  },
  {
    id: "T10",
    breaks: "byJob and byTrace do not overlap: neither lookup overreaches",
    file: "src/orchestration/observability/trace.js",
    from: "jobId: labelledJob ?? context.parentTaskId,",
    to: "jobId: null,",
  },
  {
    id: "T11",
    breaks: "health reports a transition ONCE, and only when the status changes",
    file: "src/health/monitor.js",
    from: "if (next.status !== previous.status) {",
    to: "if (false) {",
  },
  {
    id: "T12",
    breaks: "provider_health_changed is declared in exactly ONE vocabulary",
    file: "src/orchestration/observability/trace.js",
    from: '    "adapter_invoked",',
    to: '    "adapter_invoked",\n    "provider_health_changed",',
  },
  {
    id: "T13",
    breaks: "an audit read narrows by kind and by time, together",
    file: "src/audit/events.js",
    from: "(filter?.kind === undefined || event.kind === filter.kind) &&",
    to: "(true) &&",
  },
  {
    id: "T14",
    breaks: "an audit read narrows by kind and by time, together",
    file: "src/audit/events.js",
    from: "(filter?.since === undefined || event.at.getTime() >= filter.since.getTime()));",
    to: "(true));",
  },
  {
    id: "T15",
    breaks: "redaction matches sensitive WORDS, not substrings",
    file: "src/audit/redaction.js",
    from: "return wordRuns(key).some((run) => SENSITIVE_KEY_FRAGMENTS.has(run));",
    to: "return SENSITIVE_KEY_FRAGMENTS.has(key.toLowerCase().replace(/[-_\\s]/g, \"\"));",
  },
  {
    id: "T16",
    breaks: "redaction matches sensitive WORDS, not substrings",
    file: "src/audit/redaction.js",
    from: "return wordRuns(key).some((run) => SENSITIVE_KEY_FRAGMENTS.has(run));",
    to: "return false;",
  },
];

async function selftest() {
  cleanScratch();
  const problems = [];
  const base = path.join(REPO, "dist");

  for (const entry of SELF_TEST) {
    const dir = `${WORK}-${entry.id}`;
    rmSync(dir, { recursive: true, force: true });
    cpSync(base, dir, { recursive: true });
    const target = path.join(dir, entry.file);
    let source;
    try {
      source = (await import("node:fs")).readFileSync(target, "utf8");
    } catch {
      problems.push(`${entry.id}: missing ${entry.file}`);
      console.log(`${entry.id.padEnd(4)} NO SUCH FILE    ${entry.file}`);
      continue;
    }
    const hits = source.split(entry.from).length - 1;
    if (hits !== 1) {
      problems.push(`${entry.id}: anchor is ${hits === 0 ? "absent" : `ambiguous (${hits})`} in ${entry.file}`);
      console.log(`${entry.id.padEnd(4)} BAD ANCHOR      ${entry.file}`);
      rmSync(dir, { recursive: true, force: true });
      continue;
    }
    writeFileSync(target, source.replace(entry.from, entry.to), "utf8");

    const previous = process.env["PROBE_BASE"];
    process.env["PROBE_BASE"] = dir;
    const checks = await run();
    if (previous === undefined) delete process.env["PROBE_BASE"];
    else process.env["PROBE_BASE"] = previous;
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
    const collateral = checks
      .filter((c) => !c.ok && c.name !== entry.breaks)
      .map((c) => c.name);
    console.log(
      `${entry.id.padEnd(4)} DETECTED      ${entry.breaks}` +
        (collateral.length === 0 ? "" : `   (also failed: ${collateral.join(", ")})`),
    );
  }

  cleanScratch();
  console.log("");
  if (problems.length === 0) {
    console.log(`PROBE SELF-TEST PASS (${SELF_TEST.length}/${SELF_TEST.length})`);
    console.log("Every PHASE 11 decision the probe claims, the probe can be shown to fail without.");
    return;
  }
  console.log(`PROBE SELF-TEST FAIL (${problems.length} problem(s))`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
}

const mode = process.argv[2];
if (mode === "--selftest") await selftest();
else await probe();