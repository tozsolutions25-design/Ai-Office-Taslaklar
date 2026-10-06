/**
 * PHASE 09 independent verification probe, and its self-test.
 *
 * WHY A SEPARATE PROBE AT ALL
 *
 * Every skill claim in this phase is enforced by tests sharing this repository's fixtures and
 * helpers. That is right for behaviour and wrong for the claims that matter most here — "a
 * skill confers nothing", "there is no bulk load" — because a suite that shares an author's
 * assumptions can only confirm them.
 *
 * So this probe imports the BUILT `dist/` and nothing else: no test helper, no shared fixture,
 * no source read except where the claim is genuinely about source. Each invariant is stated as a
 * fact about the running system.
 *
 * WHY THE SELF-TEST IS THE POINT
 *
 * A probe that only ever prints PASS has demonstrated nothing. `--selftest` reverts each
 * decision, one at a time, in a COPY of dist/, re-runs the probe against that copy, and REQUIRES
 * the named check to fail. Each entry declares which check it must break; an entry whose named
 * check still passes is a FAILURE of the self-test, not a pass with a note.
 *
 * Usage:
 *   node scripts/probe-phase09.mjs
 *   node scripts/probe-phase09.mjs --selftest
 */

import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import path from "node:path";

const REPO = process.cwd();
const WORK = path.join(REPO, ".probe-phase09");
const NOW = new Date("2026-04-01T00:00:00.000Z");
const RESEARCH = "web_research";
const DRAFTING = "text_generation";

/** `PROBE_BASE` lets the self-test point the probe at a mutated copy of the build. */
async function load() {
  const base = process.env["PROBE_BASE"] ?? path.join(REPO, "dist");
  const u = (rel) => pathToFileURL(path.join(base, rel)).href;
  const [skill, capability, clock, workspace, composition] = await Promise.all([
    import(u("src/orchestration/skill/skill.js")),
    import(u("src/capabilities/capability.js")),
    import(u("src/core/clock.js")),
    import(u("src/orchestration/workspace/workspace.js")),
    import(u("src/orchestration/composition.js")),
  ]);
  return { skill, capability, clock, workspace, composition };
}

async function run() {
  const m = await load();
  const { SkillRegistry, auditEvents, validateSkillDeclaration } = m.skill;
  const { CapabilitySet } = m.capability;
  const { ManualClock } = m.clock;
  const { workspaceRef } = m.workspace;

  const checks = [];
  const check = async (name, fn) => {
    try {
      await fn();
      checks.push({ name, ok: true });
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };

  const declaration = (overrides = {}) => ({
    skillId: "research-brief",
    version: "1.0.0",
    summary: "Gathers material and produces a brief an operator can act on.",
    requiredCapabilities: [RESEARCH],
    requiredTools: ["web.search"],
    ...overrides,
  });
  const permitted = () => ({
    capabilities: CapabilitySet.supporting(RESEARCH, DRAFTING),
    toolIds: ["web.search"],
    workspace: "acme",
  });

  /* -- 1. an unvalidatable skill does not exist ----------------------------- */

  await check("a skill that fails validation cannot be reached by any lookup", async () => {
    const registry = new SkillRegistry({ clock: new ManualClock(NOW) });
    const broken = [
      { skillId: "" },
      { skillId: "has spaces" },
      { version: "" },
      { summary: "" },
      { summary: "   " },
      { requiredCapabilities: [""] },
      { requiredTools: [""] },
    ];
    for (const overrides of broken) {
      const outcome = registry.register(declaration(overrides));
      assert.equal(outcome.ok, false, `${JSON.stringify(overrides)} must be refused`);
      assert.ok(outcome.error.issues.length > 0, "and the refusal must say what is wrong");
    }
    assert.equal(registry.size, 0, "so the registry is empty");
    // And the loader cannot be tricked into producing one.
    const load = registry.load("has spaces", "1.0.0", permitted());
    assert.equal(load.ok, false, "loading an unregistered skill must fail");
    assert.equal(load.error.refusal, "unknown_skill");

    // The validator is exported and agrees with the registry, so a deployment can check a
    // declaration BEFORE installing it rather than discovering the problem at registration.
    assert.ok(validateSkillDeclaration(declaration()).length === 0, "a good declaration passes the exported validator");
    assert.ok(validateSkillDeclaration(declaration({ summary: "" })).length > 0, "and a bad one fails it");
  });

  await check("a duplicate id+version is refused rather than silently replacing", async () => {
    const registry = new SkillRegistry({ clock: new ManualClock(NOW) });
    assert.equal(registry.register(declaration()).ok, true);
    const before = registry.get("research-brief", "1.0.0");
    const second = registry.register(declaration({ summary: "a different summary entirely" }));
    assert.equal(second.ok, false, "the second registration must be refused");
    assert.equal(registry.get("research-brief", "1.0.0").summary, before.summary, "and the first must be untouched");
    // A different VERSION is the legitimate way to change one, and it must work.
    assert.equal(registry.register(declaration({ version: "2.0.0" })).ok, true, "a new version must be accepted");
    assert.equal(registry.size, 2, "so both versions coexist");
  });

  /* -- 2. loading confers nothing ------------------------------------------ */

  await check("loading a skill changes nothing about the caller", async () => {
    // The claim this whole subsystem turns on. Stated as an observation about the caller's
    // own objects: after a successful load, the caller's capability set and tool list are
    // bit-for-bit what they were, and the loaded handle carries no capability set at all.
    const registry = new SkillRegistry({ clock: new ManualClock(NOW) });
    registry.register(declaration());

    const callerCapabilities = CapabilitySet.supporting(RESEARCH, DRAFTING);
    const callerTools = ["web.search"];
    const before = JSON.stringify(callerCapabilities.toJSON());

    const loaded = registry.load("research-brief", "1.0.0", {
      capabilities: callerCapabilities,
      toolIds: callerTools,
      workspace: "acme",
    });
    assert.equal(loaded.ok, true, `the load must succeed, got ${JSON.stringify(loaded)}`);

    assert.equal(JSON.stringify(callerCapabilities.toJSON()), before, "the caller's capability set is unchanged");
    assert.deepEqual(callerTools, ["web.search"], "and so is its tool list");

    // The handle echoes the REQUIREMENTS and has no field that could be merged into anything.
    const handle = loaded.value;
    assert.deepEqual([...handle.requiredCapabilities], [RESEARCH], "the handle names what was required");
    for (const forbidden of ["capabilities", "granted", "grants", "authority", "token", "permissions"]) {
      assert.equal(forbidden in handle, false, `a loaded skill must carry no "${forbidden}" field`);
    }

    // And the decisive demonstration: a second caller who does NOT hold the capability is
    // still refused by the very same skill that just loaded for the first.
    const refused = registry.load("research-brief", "1.0.0", {
      capabilities: CapabilitySet.supporting(DRAFTING),
      toolIds: callerTools,
      workspace: "globex",
    });
    assert.equal(refused.ok, false, "one caller's success must not make the skill available to the next");
  });

  await check("a refusal names what was missing, and distinguishes which kind", async () => {
    const registry = new SkillRegistry({ clock: new ManualClock(NOW) });
    registry.register(declaration());
    registry.register(declaration({ skillId: "needs-a-tool", requiredTools: ["absent.tool"] }));

    const noCapability = registry.load("research-brief", "1.0.0", {
      capabilities: CapabilitySet.unknown(),
      toolIds: ["web.search"],
      workspace: "acme",
    });
    assert.equal(noCapability.ok, false);
    assert.equal(noCapability.error.refusal, "capability_not_held", "a missing capability is named as such");
    assert.match(noCapability.error.message, new RegExp(RESEARCH), "and the missing capability is named");
    assert.deepEqual([...noCapability.error.missing], [RESEARCH], "as a list, so a caller can act on it");

    const noTool = registry.load("needs-a-tool", "1.0.0", {
      capabilities: CapabilitySet.supporting(RESEARCH),
      toolIds: ["web.search"],
      workspace: "acme",
    });
    assert.equal(noTool.ok, false);
    assert.equal(noTool.error.refusal, "tool_not_reachable", "a missing tool is a DIFFERENT refusal");
    assert.deepEqual([...noTool.error.missing], ["absent.tool"]);

    const unknown = registry.load("no-such-skill", "1.0.0", permitted());
    assert.equal(unknown.error.refusal, "unknown_skill", "and an unknown skill is a third");
  });

  await check("the registry offers exactly one loader and nothing that grants", async () => {
    // Read from source because the claim is about what EXISTS, which no call can reveal. The
    // probe reads it here so it does not depend on a suite doing so.
    const source = readFileSync(
      path.join(process.env["PROBE_BASE"] ?? path.join(REPO, "dist"), "src/orchestration/skill/skill.js"),
      "utf8",
    );
    const methods = [...source.matchAll(/^\s{4}(\w+)\s*\(/gm)].map((mm) => mm[1]);
    const loaders = [...new Set(methods.filter((name) => name.startsWith("load")))];
    assert.deepEqual(loaders, ["load"], `exactly one loading path, found ${JSON.stringify(loaders)}`);
    for (const forbidden of ["grant", "confer", "authorize", "authorise", "elevate", "loadAll", "preload"]) {
      assert.equal(methods.includes(forbidden), false, `no "${forbidden}" on the registry`);
    }
  });

  /* -- 3. every attempt is recorded ----------------------------------------- */

  await check("every load attempt is recorded, and a refusal is the interesting one", async () => {
    const collector = auditEvents();
    const registry = new SkillRegistry({ clock: new ManualClock(NOW), sink: collector.sink });
    registry.register(declaration());

    registry.load("research-brief", "1.0.0", permitted());
    registry.load("research-brief", "1.0.0", { ...permitted(), capabilities: CapabilitySet.unknown() });
    registry.load("research-brief", "1.0.0", { ...permitted(), toolIds: [] });
    registry.load("ghost", "1.0.0", permitted());

    assert.equal(collector.records.length, 4, `four attempts, four records; got ${collector.records.length}`);
    assert.deepEqual(
      collector.records.map((r) => r.outcome),
      ["loaded", "refused", "refused", "refused"],
      "one success and three refusals, in order",
    );
    assert.deepEqual(
      collector.records.map((r) => r.refusal),
      [null, "capability_not_held", "tool_not_reachable", "unknown_skill"],
      "each refusal carries its own reason",
    );
    for (const record of collector.records) {
      assert.equal(record.workspace, "acme", "every record names the workspace it happened in");
      assert.ok(typeof record.at === "number", "and is timestamped");
    }
    for (const refused of collector.records.filter((r) => r.outcome === "refused")) {
      assert.ok(typeof refused.reason === "string" && refused.reason.length > 0, "a refusal always says why");
    }
  });

  /* -- 4. the runtime wires it, and says so --------------------------------- */

  await check("a real runtime records skill activity in its audit trail", async () => {
    const runtime = m.composition.createRuntime({
      clock: new ManualClock(NOW),
      workspace: workspaceRef("probe-skill"),
    });
    assert.equal(runtime.describe().skills, 0, "a fresh runtime has installed no skills");
    assert.equal(runtime.describe().skillAuthority, "declares-only", "and says skills confer nothing");

    assert.equal(runtime.skills.register(declaration()).ok, true, "the skill must install");
    assert.equal(runtime.describe().skills, 1, "and the report must show it");

    const caller = {
      capabilities: CapabilitySet.supporting(RESEARCH),
      toolIds: ["web.search"],
      workspace: "probe-skill",
    };
    assert.equal(runtime.skills.load("research-brief", "1.0.0", caller).ok, true, "a permitted load must succeed");
    assert.equal(
      runtime.skills.load("research-brief", "1.0.0", { ...caller, capabilities: CapabilitySet.unknown() }).ok,
      false,
      "and an under-privileged one must not",
    );

    const kinds = runtime.traces.events().map((event) => event.kind);
    assert.ok(kinds.includes("skill_loaded"), `expected skill_loaded in ${JSON.stringify(kinds)}`);
    assert.ok(kinds.includes("skill_load_refused"), `expected skill_load_refused in ${JSON.stringify(kinds)}`);

    // The refusal must be distinguishable from the success in the record itself, not merely
    // present: a log where both look alike is a log you cannot investigate with.
    const refusal = runtime.traces.events().find((event) => event.kind === "skill_load_refused");
    const meta = (refusal?.metadata ?? {});
    assert.equal(meta["outcome"], "refused");
    assert.equal(meta["refusal"], "capability_not_held");
    assert.ok(Array.isArray(meta["missing"]) && meta["missing"].length === 1, "and names what was missing");
  });

  await check("the runtime exposes the one skill registry, not several", async () => {
    const runtime = m.composition.createRuntime({ clock: new ManualClock(NOW), workspace: workspaceRef("probe-skill") });
    assert.ok(runtime.skills !== undefined, "a runtime must expose a skill registry");
    assert.ok(runtime.skills instanceof m.skill.SkillRegistry, "and it is the real one, not a stand-in");
    // One registry is the requirement; a second would mean two answers to "which skills exist",
    // which is the defect class every Phase 06-08 registry decision has been about.
    const skillish = Object.keys(runtime).filter((key) => /skill/i.test(key));
    assert.deepEqual(skillish, ["skills"], `exactly one skill member on the runtime, found ${JSON.stringify(skillish)}`);
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
 */
const SELF_TEST = [
  {
    id: "T1",
    breaks: "a skill that fails validation cannot be reached by any lookup",
    file: "src/orchestration/skill/skill.js",
    from: "if (issues.length > 0) {",
    to: "if (false) {",
  },
  {
    id: "T2",
    breaks: "a duplicate id+version is refused rather than silently replacing",
    file: "src/orchestration/skill/skill.js",
    from: "if (this.#skills.has(key)) {",
    to: "if (false) {",
  },
  {
    id: "T3",
    breaks: "loading a skill changes nothing about the caller",
    file: "src/orchestration/skill/skill.js",
    from: "if (missingCapabilities.length > 0) {",
    to: "if (false) {",
  },
  {
    id: "T4",
    breaks: "a refusal names what was missing, and distinguishes which kind",
    file: "src/orchestration/skill/skill.js",
    from: "if (missingTools.length > 0) {",
    to: "if (false) {",
  },
  {
    id: "T5",
    breaks: "the registry offers exactly one loader and nothing that grants",
    file: "src/orchestration/skill/skill.js",
    from: "    names() {\n        return [...this.#skills.keys()];\n    }",
    to: "    names() {\n        return [...this.#skills.keys()];\n    }\n    loadAll() {\n        return [...this.#skills.keys()];\n    }\n    grantCapabilities() {\n        return [];\n    }",
  },
  {
    id: "T6",
    breaks: "every load attempt is recorded, and a refusal is the interesting one",
    file: "src/orchestration/skill/skill.js",
    from: "        this.#sink?.({\n            skillId,\n            version,\n            workspace: caller.workspace,\n            outcome: \"refused\",",
    to: "        this.#sink === undefined && this.#sink?.({\n            skillId,\n            version,\n            workspace: caller.workspace,\n            outcome: \"never-recorded\",",
  },
  {
    id: "T7",
    breaks: "a real runtime records skill activity in its audit trail",
    file: "src/orchestration/composition.js",
    from: '        sink: (record) => {\n            traces.record(record.outcome === "loaded"',
    to: '        sink: (record) => {\n            if (record.outcome !== null) return;\n            traces.record(record.outcome === "loaded"',
  },
  {
    id: "T8",
    breaks: "a real runtime records skill activity in its audit trail",
    file: "src/orchestration/composition.js",
    from: 'skillAuthority: "declares-only",',
    to: 'skillAuthority: "may-confer",',
  },
  {
    id: "T9",
    breaks: "the runtime exposes the one skill registry, not several",
    file: "src/orchestration/composition.js",
    // A SECOND registry, not a comment about one. The first version of this entry only added
    // a comment line to the composition root, so the runtime object was unchanged and the
    // check correctly reported nothing - a mutation that adds a NOTE about a defect is not a
    // mutation of the defect. Second time in this phase, after `skillAuthority`'s type-only
    // change: syntactically valid, semantically inert.
    from: "        // skill by default, and the registry confers nothing when asked to.\n        skills,\n        pool,",
    to: "        // skill by default, and the registry confers nothing when asked to.\n        skills,\n        skillsShadow: new SkillRegistry({ clock }),\n        pool,",
  },
];

function cleanScratch() {
  for (const name of readdirSync(REPO)) {
    if (name === ".probe-phase09" || name.startsWith(".probe-phase09-")) {
      rmSync(path.join(REPO, name), { recursive: true, force: true });
    }
  }
}

async function probeAgainst(base) {
  // A plain absolute path, not a file URL: `spawnSync` with `node <file-url>` passes the URL
  // through as a literal string on Windows and fails to resolve it.
  const script = path.join(REPO, "scripts", "probe-phase09.mjs");
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
    console.log("Every skill decision the probe claims, the probe can be shown to fail without.");
    return;
  }
  console.log(`PROBE SELF-TEST FAIL (${problems.length} problem(s))`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
}

const mode = process.argv[2];
if (mode === "--selftest") await selftest();
else await probe();
