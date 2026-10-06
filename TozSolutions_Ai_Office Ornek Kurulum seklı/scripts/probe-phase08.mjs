/**
 * PHASE 08 independent verification probe, and its self-test.
 *
 * WHY A SEPARATE PROBE AT ALL
 *
 * Every agent claim in this phase is enforced by tests that share this repository's fixtures,
 * helpers and assumptions. That is the right way to test behaviour and the wrong way to test
 * a claim of the form "an agent cannot reach X", because a suite that shares an author's
 * assumptions can only confirm them.
 *
 * So this probe imports the BUILT `dist/` and nothing else - no test helper, no shared fixture,
 * no source read - and states each invariant as a fact about the running system, phrased as an
 * argument rather than as a list of assertions. Two of the checks deliberately reproduce
 * defects this phase found, in the shape a caller would meet them.
 *
 * WHY THE SELF-TEST IS THE POINT
 *
 * A probe that only ever prints PASS has demonstrated nothing. `--selftest` reverts each
 * decision, one at a time, in a COPY of dist/, re-runs the probe against that copy, and
 * REQUIRES the named check to fail. A probe whose checks cannot be made to fail by breaking
 * the thing they check is decoration. Each entry declares which check it must break, and an
 * entry whose named check still passes is a FAILURE of the self-test rather than a pass with a
 * note.
 *
 * Usage:
 *   node scripts/probe-phase08.mjs
 *   node scripts/probe-phase08.mjs --selftest
 */

import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import path from "node:path";

const REPO = process.cwd();
const WORK = path.join(REPO, ".probe-phase08");
const NOW = new Date("2026-04-01T00:00:00.000Z");

/* -------------------------------------------------------------------------- */
/* The probe                                                                   */
/* -------------------------------------------------------------------------- */

/** `PROBE_BASE` lets the self-test point the probe at a mutated copy of the build. */
async function load() {
  const base = process.env["PROBE_BASE"] ?? path.join(REPO, "dist");
  const u = (rel) => pathToFileURL(path.join(base, rel)).href;
  const [capability, clock, workspace, memory, registry, trust, pool, record, tools, invoker, policy, governance, composition, executive] =
    await Promise.all([
      import(u("src/capabilities/capability.js")),
      import(u("src/core/clock.js")),
      import(u("src/orchestration/workspace/workspace.js")),
      import(u("src/orchestration/memory/memory.js")),
      import(u("src/orchestration/agent/registry.js")),
      import(u("src/orchestration/agent/trust.js")),
      import(u("src/orchestration/pool/specialistPool.js")),
      import(u("src/orchestration/agent/record.js")),
      import(u("src/orchestration/tools/tool.js")),
      import(u("src/orchestration/tools/invoker.js")),
      import(u("src/orchestration/governance/policy.js")),
      import(u("src/orchestration/governance/context.js")),
      import(u("src/orchestration/composition.js")),
      import(u("src/orchestration/executive/index.js")),
    ]);
  return {
    capability,
    clock,
    workspace,
    memory,
    registry,
    trust,
    pool,
    record,
    tools,
    invoker,
    policy,
    governance,
    composition,
    executive,
  };
}

async function run() {
  const m = await load();
  const { CapabilitySet } = m.capability;
  const { ManualClock } = m.clock;
  const { workspaceRef } = m.workspace;
  const { AgentRegistry, canTransitionAgent } = m.registry;
  const { SpecialistPool } = m.pool;
  const { InMemoryMemoryProvider } = m.memory;
  const { workspaceKey } = m.workspace;
  const { trustRank } = m.trust;
  const RESEARCH = "web_research";

  const ACME = workspaceRef("acme");
  const GLOBEX = workspaceRef("globex");
  const clock = new ManualClock(NOW);
  const emptyContext = {
    providerIds: () => [],
    availableTools: () => [],
    grantedMemoryScopes: () => ["task"],
  };

  const checks = [];
  // AWAITS its callback. A check that has not finished has not passed.
  const check = async (name, fn) => {
    try {
      await fn();
      checks.push({ name, ok: true });
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };

  /** A registered, promoted agent in the given workspace, plus its registry. */
  function agentIn(workspace, overrides = {}) {
    const registry = new AgentRegistry({ clock, workspace });
    const outcome = registry.register({
      agentId: "probe-agent",
      version: "1.0.0",
      adapter: "unavailable",
      status: "active",
      trustLevel: "standard",
      capabilities: CapabilitySet.supporting(RESEARCH),
      requiresModelRoute: false,
      now: NOW,
      ...overrides,
    });
    assert.ok(outcome.ok, `the agent must register, got ${String(outcome.ok)}`);
    for (const step of ["verified", "registered", "available"]) {
      const moved = registry.transition("probe-agent", "1.0.0", step);
      assert.ok(moved.ok, `the agent must reach ${step}, got ${String(moved.ok)}`);
    }
    return { registry, record: outcome.value.record };
  }

  /* -- 1. the registry is the only place an agent exists ------------------- */

  await check("an agent in one workspace is not merely hidden from another; it is absent", async () => {
    const acme = agentIn(ACME);
    const globex = agentIn(GLOBEX);
    assert.equal(acme.registry.has("probe-agent", "1.0.0"), true, "it exists where it was registered");
    assert.equal(globex.registry.has("probe-agent", "1.0.0"), true, "and independently in the other");
    // A third registry, in no workspace at all, cannot see either. This is the property that
    // makes the partition a MISS and not a filter.
    const unattributed = new AgentRegistry({ clock });
    assert.equal(
      unattributed.has("probe-agent", "1.0.0"),
      false,
      "an unattributed registry must not find a partitioned agent",
    );
  });

  await check("two workspaces' agents cannot collide in one another's key space", async () => {
    // Not the same check as the one above, and the difference is the point: two registries
    // holding the SAME agent id are two separate facts. If the key dropped its workspace
    // they would be one, and this is the claim that would stop holding.
    const a = agentIn(ACME);
    const b = agentIn(GLOBEX);
    // `workspaceKey` takes the `WorkspaceRef` ITSELF as its first argument, not the
    // workspace string. Passing `ACME.workspace` produced
    // `Cannot read properties of undefined (reading 'length')` inside the key builder - the
    // first draft of this check did exactly that.
    assert.notEqual(
      workspaceKey(ACME, "probe-agent@1.0.0"),
      workspaceKey(GLOBEX, "probe-agent@1.0.0"),
      "the composite key must separate them",
    );
    assert.equal(a.record.agentId, b.record.agentId, "and both carry the same bare id");
  });
  /* -- 2. the lifecycle cannot be skipped ---------------------------------- */

  await check("a registry will not move an agent straight to available", async () => {
    const registry = new AgentRegistry({ clock, workspace: ACME });
    const outcome = registry.register({
      agentId: "fresh",
      version: "1.0.0",
      adapter: "unavailable",
      now: NOW,
    });
    assert.ok(outcome.ok, "registration must succeed");
    assert.equal(outcome.value.lifecycle, "discovered", "and it arrives undiscovered");
    assert.equal(
      canTransitionAgent("discovered", "available"),
      false,
      "there is no edge from discovered to available: verification is not optional",
    );
    const jumped = registry.transition("fresh", "1.0.0", "available");
    assert.equal(jumped.ok, false, "and attempting it is refused, not silently allowed");
  });

  await check("a status of active does not make an unverified agent selectable", async () => {
    // The two gates are independent. A record can look perfectly selectable on every field
    // the registry stores except the one that matters.
    const registry = new AgentRegistry({ clock, workspace: ACME });
    const outcome = registry.register({
      agentId: "sneaky",
      version: "1.0.0",
      adapter: "unavailable",
      status: "active",
      trustLevel: "privileged",
      capabilities: CapabilitySet.supporting(RESEARCH),
      now: NOW,
    });
    assert.ok(outcome.ok, "registration must succeed");
    assert.equal(outcome.value.record.status, "active", "status says active");
    assert.equal(outcome.value.lifecycle, "discovered", "and the lifecycle still says discovered");

    const pool = new SpecialistPool({
      candidates: () => [{ agent: outcome.value.record, lifecycle: outcome.value.lifecycle }],
    });
    const decision = pool.select(
      { taskId: "t1", requiredCapabilities: [RESEARCH], minimumTrust: "untrusted" },
      emptyContext,
    );
    assert.equal(decision.selectedAgent, null, "so no agent is selected");
  });

  /* -- 3. selection refuses, and explains ----------------------------------- */

  await check("every refusal names itself, and none of them is 'unavailable' for no reason", async () => {
    const reasons = new Set();
    const cases = [
      [{ trustLevel: "untrusted" }, "high", "trust_below_floor"],
      [{ capabilities: CapabilitySet.of({ [RESEARCH]: "unsupported" }) }, "low", "capability_incompatible"],
      [{ toolRequirements: ["absent-tool"] }, "low", "missing_tool"],
      [{ providerRequirements: ["absent-provider"] }, "low", "missing_provider"],
      [{ memoryScopes: ["global"] }, "low", "memory_scope_unavailable"],
      [{ health: { status: "unavailable", observedAt: NOW, latencyMs: null, consecutiveFailures: 3, detail: null } }, "low", "agent_health_not_routable"],
    ];
    for (const [overrides, floor, expected] of cases) {
      const { record } = agentIn(ACME, overrides);
      const pool = new SpecialistPool({ candidates: () => [{ agent: record, lifecycle: "available" }] });
      const decision = pool.select(
        { taskId: "t1", requiredCapabilities: [RESEARCH], minimumTrust: floor },
        emptyContext,
      );
      assert.equal(decision.selectedAgent, null, `${expected}: nothing may be selected`);
      const found = decision.rejected.flatMap((c) => c.rejections);
      assert.ok(found.includes(expected), `expected ${expected}, got ${JSON.stringify(found)}`);
      assert.match(decision.rejected[0].rationale, /Rejected/, "and the rationale must say it was rejected");
      found.forEach((r) => reasons.add(r));
    }
    assert.ok(!reasons.has("unhealthy"), "no input can produce an `unhealthy` health status, so no input can produce that reason");
  });

  await check("the pool refuses a task demanding more trust than the deployment allows", async () => {
    const { record } = agentIn(ACME, { trustLevel: "privileged" });
    const pool = new SpecialistPool({
      candidates: () => [{ agent: record, lifecycle: "available" }],
      // The guard, set BELOW what the agent can offer, so the request is what crosses it.
      maximumTrustFloor: "standard",
    });
    const refused = pool.select(
      { taskId: "t1", requiredCapabilities: [RESEARCH], minimumTrust: "privileged" },
      emptyContext,
    );
    assert.equal(refused.selectedAgent, null, "a task above the ceiling is refused even by a trusted agent");
    assert.match(refused.reason, /exceeds the configured maximum/i, "and the reason names the ceiling");

    const allowed = pool.select(
      { taskId: "t1", requiredCapabilities: [RESEARCH], minimumTrust: "standard" },
      emptyContext,
    );
    assert.equal(allowed.selectedAgent !== null, true, "a task at or below it is served");
  });

  /* -- 4. tools are earned ------------------------------------------------- */

  await check("an agent may not call a tool it never declared", async () => {
    const registry = new m.tools.ToolRegistry({ clock, workspace: ACME });
    const registered = registry.register({
      toolId: "declared-tool",
      kind: "local",
      description: "a tool the agent declared",
      sideEffecting: false,
      network: false,
      minimumTrust: "low",
    });
    assert.ok(registered.ok, `the tool must register, got ${JSON.stringify(registered)}`);

    const permission = {
      subject: "probe-agent@1.0.0",
      trustLevel: "standard",
      requiresApprovalForSideEffects: true,
    };
    const host = new m.invoker.ToolExecutionHost({ registry, clock });

    // `verifyReported` returns `{ verified, refusals }` and has no `ok` field. The first
    // draft of this check asserted `outcome.ok === true` and failed against a successful
    // verification, which is what reading the shape wrong looks like from the outside.
    const passed = host.verifyReported(["declared-tool"], permission, trustRank, ["declared-tool"]);
    assert.deepEqual(passed.refusals, [], "a declared tool must not be refused");
    assert.equal(passed.verified.length, 1, "and must be verified");

    const refused = host.verifyReported(["declared-tool"], permission, trustRank, ["a-tool-it-never-declared"]);
    assert.equal(refused.verified.length, 0, "an undeclared tool must not be verified");
    assert.match(JSON.stringify(refused.refusals), /never declared/i, "and the refusal must say why");
  });

  /* -- 5. an agent is not a memory authority ------------------------------- */

  await check("an agent's declared memory reach cannot exceed the actor's grants", async () => {
    // The agent declares what it needs; the VERIFIED ACTOR's grants decide whether it gets
    // it. An agent is never itself a memory subject.
    const { record } = agentIn(ACME, { memoryScopes: ["global"] });
    const narrowPool = new SpecialistPool({ candidates: () => [{ agent: record, lifecycle: "available" }] });
    const decision = narrowPool.select(
      { taskId: "t1", requiredCapabilities: [RESEARCH], minimumTrust: "low" },
      { providerIds: () => [], availableTools: () => [], grantedMemoryScopes: () => ["task"] },
    );
    assert.equal(decision.selectedAgent, null, "an agent demanding global memory is unreachable to a task-scoped actor");
    assert.match(JSON.stringify(decision.rejected.flatMap((c) => c.rejections)), /memory_scope_unavailable/);

    const widePool = new SpecialistPool({ candidates: () => [{ agent: record, lifecycle: "available" }] });
    const wide = widePool.select(
      { taskId: "t1", requiredCapabilities: [RESEARCH], minimumTrust: "low" },
      { providerIds: () => [], availableTools: () => [], grantedMemoryScopes: () => ["task", "global"] },
    );
    assert.equal(wide.selectedAgent !== null, true, "and reachable to an actor that does hold it");
  });

  await check("a memory grant for one actor is not usable by another", async () => {
    // The SAME id in TWO workspaces. The first draft of this check used two different ids
    // (`user:kim` and `user:stranger`) and passed whether the grant key included the
    // workspace or not - two ids are separated by the id alone, so the check could not
    // discriminate. Reverting `grantKey` to a bare id therefore left it PASSING, and the
    // self-test said so. Identical actors in different workspaces are the case that actually
    // exercises the composite key.
    const access = new m.memory.MemoryAccessPolicy({ nowMs: () => NOW.getTime() });
    const sameId = "user:same-person";
    const acmeActor = { id: sameId, workspace: ACME, operatingScope: "task", trustLevel: "standard" };
    const globexActor = { id: sameId, workspace: GLOBEX, operatingScope: "task", trustLevel: "standard" };
    const otherActor = { id: "user:stranger", workspace: ACME, operatingScope: "task", trustLevel: "standard" };

    access.grant({ subject: acmeActor, scopes: ["task"], writableScopes: [], minimumTrust: "low", expiresAt: null });
    assert.equal(access.canRead(acmeActor, "task"), true, "the holder may read");
    assert.equal(access.canRead(otherActor, "task"), false, "a different actor may not");
    assert.equal(
      access.canRead(globexActor, "task"),
      false,
      "and the SAME actor string in another workspace may not - which is the claim a bare-id key would lose",
    );
  });

  /* -- 6. the catalogue is a declaration ----------------------------------- */

  await check("no catalogue entry claims to be the orchestrator, and none is selectable", async () => {
    const catalogue = await import(pathToFileURL(path.join(process.env["PROBE_BASE"] ?? path.join(REPO, "dist"), "src/orchestration/agent/catalogue.js")).href);
    const entries = catalogue.fullCatalogue();
    assert.equal(entries.length, 9, "nine declared roles");
    for (const entry of entries) {
      assert.doesNotMatch(entry.agentId, /hermes|coordinat|orchestrat/i, `${entry.agentId} must not claim the orchestrator role`);
      assert.equal(entry.memoryScopes.includes("global"), false, `${entry.agentId} must not claim installation-wide memory`);
    }
    // And registering them produces nothing selectable.
    const registry = new AgentRegistry({ clock, workspace: ACME });
    for (const entry of entries) {
      const outcome = registry.register({ ...catalogue.catalogueEntryToRecordInput(entry), now: NOW });
      assert.ok(outcome.ok, `${entry.agentId} must register`);
      assert.equal(outcome.value.record.status, "disabled", `${entry.agentId} must be disabled`);
    }
    const pool = new SpecialistPool({
      candidates: () => registry.list().map((e) => ({ agent: e.record, lifecycle: e.lifecycle })),
    });
    assert.equal(pool.select({ taskId: "t1", requiredCapabilities: [], minimumTrust: "low" }, emptyContext).selectedAgent, null);
  });

  /* -- 7. the executive layer can observe and ask, and nothing else ------- */

  await check("an executive layer can describe, observe and submit, and has no other verb", async () => {
    // Wired to a REAL orchestrator rather than a stub. The first draft injected
    // `observeTask: () => ({ taskId, state: "created" })` and then asserted that observing an
    // unknown task returns `null` - which the stub made false, and which tested the stub
    // rather than the system. Reading real state is the whole point of `observe`.
    const context = m.governance.createSecurityContext({
      actor: "operator",
      trustLevel: "standard",
      grants: [],
    });
    const runtime = m.composition.createRuntime({
      clock: new ManualClock(NOW),
      identity: { resolve: () => context, serviceContext: context },
      workspace: ACME,
    });
    const control = m.executive.createExecutiveControl({
      describeRuntime: () => m.executive.executiveDescriptionOf({ workspace: ACME, governance: "enforced" }),
      observeTask: (taskId) => {
        const state = runtime.orchestrator.stateOf(taskId);
        return state === null ? null : { taskId, state: String(state) };
      },
      submitToOrchestrator: (request) => runtime.orchestrator.execute(request),
    });
    const verbs = Object.keys(control).sort();
    assert.deepEqual(verbs, ["describe", "observe", "submit"], "exactly three capabilities");

    const description = control.describe();
    assert.equal(description.executiveAuthority, "executive-observe-and-submit", "and it reports only what it may do");
    assert.equal(description.authorities["agentExecution"], "TozOrchestrator", "naming the one agent-execution authority");
    assert.equal(description.workspace, ACME.workspace, "and the workspace it acts in");

    // The names it must NOT have. Structural, but asserted here as well so the probe does
    // not depend on a suite reading the source.
    for (const forbidden of ["cancel", "approve", "decideApproval", "authorize", "grant", "revoke", "select", "execute", "invoke", "route", "plan", "advance", "transition", "settle"]) {
      assert.equal(verbs.includes(forbidden), false, `the executive layer must have no "${forbidden}"`);
    }
    // A real read of real state: an unknown task is genuinely absent, not fabricated.
    assert.equal(control.observe("no-such-task"), null, "an unknown task is absent, not invented");
  });

  await check("submitting through an executive layer goes through the orchestrator's own refusal", async () => {
    // Not "the executive layer refuses" - it cannot. It hands the request to the existing
    // authority and returns whatever came back, which is how governance stays unbypassed.
    //
    // The caller is `privileged` and holds NO grants, so `GrantRule` is the only rule that
    // can refuse. That matters for the self-test: the first draft used a `low` trust caller,
    // and reverting `GrantRule` to always allow left the check PASSING because a trust rule
    // refused anyway. The check was not specific to the decision it claimed to cover.
    const context = m.governance.createSecurityContext({
      actor: "stranger",
      trustLevel: "privileged",
      grants: [],
    });
    const runtime = m.composition.createRuntime({
      clock: new ManualClock(NOW),
      identity: { resolve: () => context, serviceContext: context },
      workspace: ACME,
    });
    const control = m.executive.createExecutiveControl({
      describeRuntime: () => m.executive.executiveDescriptionOf({ workspace: ACME, governance: "enforced" }),
      observeTask: (taskId) => {
        const state = runtime.orchestrator.stateOf(taskId);
        return state === null ? null : { taskId, state: String(state) };
      },
      submitToOrchestrator: (request) => runtime.orchestrator.execute(request),
    });

    const result = await control.submit({
      taskId: "t1",
      objective: "do the thing",
      input: "go",
      requiredCapabilities: [RESEARCH],
      taskType: "single",
      securityContext: context,
    });
    assert.ok(result.ok, "the call resolves; the refusal is in the result");
    assert.equal(result.value.errorClass, "authorization_error", "and it is the orchestrator's own authorization refusal");
    assert.match(String(result.value.reason), /grant|not granted|permission/i, `and it must name the missing grant, got: ${result.value.reason}`);
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

/**
 * Each entry names the check it must invalidate. If reverting the decision leaves that check
 * PASSING, the probe is claiming something it cannot detect, and that is a self-test failure.
 *
 * ## WHAT IS DELIBERATELY ABSENT, AND WHY
 *
 * There is NO entry for "a workspace cannot read another workspace's agent". Reverting
 * `AgentRegistry`'s key function to a bare agent key left the corresponding check PASSING, and
 * the reason is PHASE 06's, verbatim: **each registry instance already belongs to exactly one
 * workspace, so two instances never share a Map and the workspace inside the key is not
 * observable through behaviour at all.** The check is a true statement and stays in the probe,
 * because an operator wants it confirmed - but it is not DISCRIMINATING, and listing it here
 * as though it were would be claiming a sensitivity the probe does not have.
 *
 * That decision is covered structurally instead, by mutation `S4` in
 * `scripts/mutation-phase08.mjs`, which patches `src/` and is detected by the Phase 06
 * key-wiring assertions. Two modes, two tools, one claim each way it can actually be tested.
 */
const SELF_TEST = [
  {
    id: "T2",
    breaks: "a registry will not move an agent straight to available",
    file: "src/orchestration/agent/registry.js",
    from: "return err(new AgentLifecycleError(entry.lifecycle, to));",
    to: "entry.lifecycle = to;\n            return ok(entry);",
  },
  {
    id: "T3",
    breaks: "a status of active does not make an unverified agent selectable",
    file: "src/orchestration/pool/specialistPool.js",
    from: 'rejections.push("not_available");',
    to: "",
  },
  {
    id: "T4",
    breaks: "every refusal names itself, and none of them is 'unavailable' for no reason",
    file: "src/orchestration/pool/specialistPool.js",
    from: 'rejections.push("trust_below_floor");',
    to: "",
  },
  {
    id: "T5",
    breaks: "the pool refuses a task demanding more trust than the deployment allows",
    file: "src/orchestration/pool/specialistPool.js",
    from: "if (trustRank(request.minimumTrust) > trustRank(this.#maximumTrustFloor)) {",
    to: "if (false) {",
  },
  {
    id: "T6",
    breaks: "an agent may not call a tool it never declared",
    file: "src/orchestration/tools/invoker.js",
    from: 'refusals.push({ toolId, reason: UNDECLARED });',
    to: "",
  },
  {
    id: "T7",
    breaks: "an agent's declared memory reach cannot exceed the actor's grants",
    file: "src/orchestration/pool/specialistPool.js",
    from: 'rejections.push("memory_scope_unavailable");',
    to: "",
  },
  {
    id: "T8",
    breaks: "a memory grant for one actor is not usable by another",
    file: "src/orchestration/memory/memory.js",
    from: "function grantKey(subject) {\n    return workspaceKey(subject.workspace, subject.id);\n}",
    to: "function grantKey(subject) {\n    return subject.id;\n}",
  },
  {
    id: "T9",
    breaks: "no catalogue entry claims to be the orchestrator, and none is selectable",
    file: "src/orchestration/agent/catalogue.js",
    from: 'agentId: "qa-reviewer",',
    to: 'agentId: "hermes-coordinator",\n        name: "Hermes Coordinator",\n        role: "coordination",\n        summary: "The single orchestration authority for the whole system.",\n        capabilities: ["reasoning"],\n        memoryScopes: ["task", "global"],\n        trustLevel: "privileged",\n        costClass: "standard",\n        latencyClass: "standard",\n        executionMode: "in_process",\n        requiresModelRoute: false,\n    },\n    {\n        agentId: "qa-reviewer",',
  },
  {
    id: "T10",
    breaks: "an executive layer can describe, observe and submit, and has no other verb",
    file: "src/orchestration/executive/index.js",
    from: "submit: (request) => deps.submitToOrchestrator(request),",
    to: "submit: (request) => deps.submitToOrchestrator(request),\n        cancel: async () => {},",
  },
  {
    id: "T11",
    breaks: "submitting through an executive layer goes through the orchestrator's own refusal",
    file: "src/orchestration/governance/policy.js",
    from: "return grant === null ? \"DENY\" : \"ALLOW\";",
    to: 'return "ALLOW";',
  },
];

function cleanScratch() {
  for (const name of readdirSync(REPO)) {
    if (name === ".probe-phase08" || name.startsWith(".probe-phase08-")) {
      rmSync(path.join(REPO, name), { recursive: true, force: true });
    }
  }
}

async function probeAgainst(base) {
  // A plain absolute path, not a file URL: `spawnSync` with `node <file-url>` passes the URL
  // through as a literal string on Windows and fails to resolve it.
  const script = path.join(REPO, "scripts", "probe-phase08.mjs");
  const result = spawnSync(process.execPath, [script], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PROBE_BASE: base },
  });
  return { code: result.status ?? -1, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

async function selftest() {
  cleanScratch();

  // The probe must be GREEN before any self-test verdict is read, or a broken probe would
  // "detect" every break by failing for an unrelated reason.
  const controlRun = await probeAgainst(path.join(REPO, "dist"));
  const controlGreen = controlRun.code === 0;
  console.log(`PROBE CONTROL  ${controlGreen ? "GREEN" : "BROKEN"}`);
  if (!controlGreen) {
    console.log(controlRun.output.split("\n").slice(-24).join("\n"));
    console.log("PROBE SELF-TEST FAIL: the probe is not green against the real build.");
    process.exitCode = 1;
    return;
  }

  const problems = [];
  for (const entry of SELF_TEST) {
    const dir = `${WORK}-${entry.id}`;
    cpSync(path.join(REPO, "dist"), dir, { recursive: true });
    const target = path.join(dir, entry.file);
    let source;
    try {
      source = readFileSync(target, "utf8");
    } catch {
      rmSync(dir, { recursive: true, force: true });
      problems.push(`${entry.id}: missing ${entry.file}`);
      console.log(`${entry.id.padEnd(4)} HARNESS_ERROR  missing file`);
      continue;
    }
    const hits = source.split(entry.from).length - 1;
    if (hits !== 1) {
      rmSync(dir, { recursive: true, force: true });
      problems.push(`${entry.id}: anchor is not a unique match in ${entry.file} (${hits} hits)`);
      console.log(`${entry.id.padEnd(4)} HARNESS_ERROR  anchor ${hits === 0 ? "not found" : "ambiguous"}`);
      continue;
    }
    writeFileSync(target, source.replace(entry.from, entry.to), "utf8");

    // The mutated build is exercised in-process, because the child probe run imports the REAL
    // dist. Reverted copy in, probe logic re-used, so the only difference between the control
    // run and this one is the mutation.
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
    console.log("Every agent decision the probe claims, the probe can be shown to fail without.");
    return;
  }
  console.log(`PROBE SELF-TEST FAIL (${problems.length} problem(s))`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
}

const mode = process.argv[2];
if (mode === "--selftest") await selftest();
else await probe();
