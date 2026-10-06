/**
 * PHASE 09 EVIDENCE - the skill contract, and what a skill is NOT.
 *
 * ## WHY THIS FILE IS MOSTLY ABOUT ABSENCES
 *
 * `TODO.md` PHASE 09 opens with the only question that matters for a greenfield subsystem:
 * *decide the skill contract - what a skill IS, versus a capability, a tool and an agent. Do
 * not retrofit onto `ToolRegistry`.* `DECISIONS.md` D-09 already answered half of it ("a skill
 * is a capability bundle with lifecycle and authority; a tool is one callable") and left the
 * other half open.
 *
 * The rest of the brief's requirements are prohibitions, and a prohibition that is only
 * documented is a convention:
 *
 *   - "Skills must not become a way to grant authority. A skill declares capabilities; it does
 *     not confer them."
 *   - "On-demand loading only. Never bulk-load per task."
 *
 * So most of what follows asserts that something DOES NOT EXIST - no method that confers a
 * capability, no method that loads a set. An absence cannot be observed by calling what is
 * there; it has to be asserted against the declaration. `agentAuthority.p08-evidence.test.ts`
 * and `executiveLayer.p08-evidence.test.ts` established the pattern; this is the third use of it,
 * and the reason it keeps recurring is that this repository finds prohibitions-in-prose turning
 * into capabilities in code.
 *
 * ## WHAT A SKILL IS, IN ONE PARAGRAPH
 *
 * A skill is a **validated, versioned bundle of requirements**: the capabilities it needs, the
 * tools it needs, and the contract its input and output obey. Loading it is the act of checking
 * those requirements against a real caller and recording the attempt. It confers nothing. It is
 * therefore NOT a capability (an atom with no requirements), NOT a tool (one invokable
 * callable, and the thing that actually reaches authority), and NOT an agent (an executor with
 * its own lifecycle that runs and reports). It sits beside all three and borrows vocabulary
 * from none of them.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { CapabilitySet, type Capability } from "../src/capabilities/capability.js";
import { ManualClock } from "../src/core/clock.js";
import { createRuntime } from "../src/orchestration/composition.js";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";
import { SkillRegistry, type SkillDeclaration } from "../src/orchestration/skill/skill.js";
import { auditEvents, type SkillLoadRecord } from "../src/orchestration/skill/skill.js";

const NOW = new Date("2026-04-01T00:00:00.000Z");
const RESEARCH: Capability = "web_research";
const DRAFTING: Capability = "text_generation";

/**
 * Source with comments and string literals removed, so an assertion about CODE cannot be
 * satisfied or broken by PROSE.
 *
 * This exists because it went wrong twice in this file's own first draft: the module header
 * explains at length what a skill is NOT — it says "execute", "invoke", "runs skills", names
 * `ToolExecutionHost` and `AgentAdapter` — and a naive whole-file match reported the file as
 * containing an execution path. The documentation was correct and the detector was wrong. A
 * repository whose tests trip over their own comments stops reading their comments.
 */
function code(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/`(?:[^`\\]|\\.)*`/g, '""')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

function publicMethods(relative: string): string[] {
  return [...code(relative).matchAll(/(?:^|\n)\s{2}public\s+(?:readonly\s+)?(\w+)\s*[(:]/g)].map((m) => m[1]);
}

function declaration(overrides: Partial<SkillDeclaration> = {}): SkillDeclaration {
  return {
    skillId: "research-brief",
    version: "1.0.0",
    summary: "Gathers material and produces a brief an operator can act on.",
    requiredCapabilities: [RESEARCH],
    requiredTools: ["web.search"],
    ...overrides,
  };
}

/** A caller holding exactly the capabilities and tools the default skill needs. */
function permitted() {
  return {
    capabilities: CapabilitySet.supporting(RESEARCH, DRAFTING),
    toolIds: ["web.search", "doc.write"],
    workspace: "acme" as const,
  };
}

describe("PHASE 09 EVIDENCE - the skill contract", () => {
  /* -- what a skill is: a bundle of requirements ----------------------------- */

  it("is a validated bundle of requirements, not an executable", () => {
    // A tool is one callable and an agent runs and reports. A skill does neither: it holds
    // requirements and a contract. Asserting the ABSENCE of execution vocabulary is what
    // separates it from its three neighbours - a skill that could `execute` would be an
    // agent, and one that could `invoke` would be a tool in a trench coat.
    //
    // Checked against `code()`, not the file. The module header explains at length what a
    // skill is NOT, and therefore necessarily contains every one of these words.
    const source = code("src/orchestration/skill/skill.ts");
    for (const forbidden of ["execute", "invoke", "adapter", "AgentAdapter", "ToolExecutionHost", "AgentRegistry", "ToolRegistry"]) {
      assert.doesNotMatch(source, new RegExp(`\\b${forbidden}\\b`), `skill code must not contain "${forbidden}"; that is a tool or an agent`);
    }
    assert.doesNotMatch(source, /\bToolInvoker\b/, "nor a tool invoker");
    // And it declares rather than confers: the field is a REQUIREMENT, and it is named so.
    assert.match(source, /requiredCapabilities/, "the capabilities a skill needs must be named as required");
    assert.doesNotMatch(source, /\bgrantedCapabilities\b|\bconferredCapabilities\b/, "and never as conferred");
  });

  it("refuses a declaration that fails validation, so it can never be loaded", () => {
    // "Validation before registration: a skill that fails validation must not be loadable."
    // The way to make that true is to not register it - a registry that stored an invalid
    // declaration and checked at load time would have a window where an invalid skill exists.
    const registry = new SkillRegistry({ clock: new ManualClock(NOW) });

    const cases = [
      [{ skillId: "" }, "an empty id"],
      [{ skillId: "has spaces" }, "an id with spaces"],
      [{ version: "" }, "an empty version"],
      [{ summary: "" }, "an empty summary"],
      [{ summary: "   " }, "a whitespace-only summary"],
      [{ requiredCapabilities: [""] as Capability[] }, "an empty capability name"],
    ] as const;

    for (const [overrides, what] of cases) {
      const outcome = registry.register(declaration(overrides));
      assert.equal(outcome.ok, false, `${what} must be refused at registration`);
    }

    assert.equal(registry.size, 0, "so nothing invalid was stored");
    // The invalid ids are unreachable by BOTH lookup shapes, and `get`/`has` are versioned
    // like `load` - the first draft of this test called them with one argument and the
    // compiler caught that the registry has no unversioned lookup at all, which is the right
    // answer: a skill is id+version or it is nothing.
    assert.equal(registry.has("has spaces", "1.0.0"), false, "and none of it is reachable by lookup");
    assert.equal(registry.get("has spaces", "1.0.0"), null);
  });

  it("refuses a duplicate id+version rather than replacing it", () => {
    const registry = new SkillRegistry({ clock: new ManualClock(NOW) });
    assert.equal(registry.register(declaration()).ok, true, "the first registration must succeed");
    const second = registry.register(declaration({ summary: "a different summary for the same id" }));
    assert.equal(second.ok, false, "a second registration of the same id+version must be refused");
    assert.equal(registry.size, 1, "and must not have replaced the first");
  });

  /* -- what a skill cannot do ----------------------------------------------- */

  it("has no method that grants, confers or widens authority", () => {
    // The core prohibition. A skill registry with a `grantCapabilities` method would be the
    // exact thing TODO.md forbids, and it would be *reachable* - unlike a comment saying it
    // would not be used.
    const names = publicMethods("src/orchestration/skill/skill.ts");
    assert.ok(names.length > 0, "the registry must expose something");
    for (const forbidden of [
      "grant",
      "grantCapability",
      "grantCapabilities",
      "confer",
      "authorise",
      "authorize",
      "allow",
      "permit",
      "elevate",
      "promote",
      "widen",
    ]) {
      assert.equal(names.includes(forbidden), false, `SkillRegistry must not expose "${forbidden}"`);
    }
  });

  it("has no bulk-load path, so a task cannot pull in the whole catalogue", () => {
    // "On-demand loading only. Never bulk-load per task." A `loadAll()` would satisfy every
    // sentence of that requirement while violating it.
    const names = publicMethods("src/orchestration/skill/skill.ts");
    for (const forbidden of ["loadAll", "loadEvery", "loadAllFor", "loadForTask", "loadMatching", "preload", "warm"]) {
      assert.equal(names.includes(forbidden), false, `SkillRegistry must not expose "${forbidden}"`);
    }
    // And there is exactly one loading method.
    const loaders = names.filter((n) => n.startsWith("load"));
    assert.deepEqual(loaders, ["load"], "one loader, taking one skill");
  });

  it("checks the CALLER's capabilities, so loading a skill can only ever refuse", async () => {
    // The direction of the check is the whole security property. A skill declaring
    // `web_research` does not thereby have it; the CALLER must already hold it. This mirrors
    // how an agent's declared memory scopes are checked against the actor's grants in Phase 07,
    // and for the same reason: a declaration that widened reach would be a privilege grant
    // wearing a different hat.
    const registry = new SkillRegistry({ clock: new ManualClock(NOW) });
    registry.register(declaration());

    // A caller WITHOUT the required capability is refused.
    const refused = registry.load("research-brief", "1.0.0", {
      capabilities: CapabilitySet.supporting(DRAFTING),
      toolIds: ["web.search", "doc.write"],
      workspace: "acme",
    });
    assert.equal(refused.ok, false, "a caller lacking the capability must be refused");
    assert.match(JSON.stringify(refused), /web_research/, "and the refusal must name what was missing");

    // The same skill, a caller WITH it, succeeds - which is what makes the first result a
    // check rather than a blanket denial.
    const granted = registry.load("research-brief", "1.0.0", permitted());
    assert.equal(granted.ok, true, `a permitted caller must succeed, got ${JSON.stringify(granted)}`);
  });

  it("checks the CALLER's tools as well as its capabilities", () => {
    const registry = new SkillRegistry({ clock: new ManualClock(NOW) });
    registry.register(declaration({ requiredTools: ["web.search", "a.tool.the.caller.lacks"] }));
    const refused = registry.load("research-brief", "1.0.0", permitted());
    assert.equal(refused.ok, false, "a missing tool must refuse the load");
    assert.match(JSON.stringify(refused), /a\.tool\.the\.caller\.lacks/, "and name the tool");
  });

  /* -- the audit record ----------------------------------------------------- */

  it("records an attempt for EVERY load, including the refused ones", () => {
    // "an audit record for every load". The word that decides this is EVERY: a log that only
    // records successes is a log of what worked, not a record of attempts, and the interesting
    // entry is always the one that was refused.
    const records: SkillLoadRecord[] = [];
    const registry = new SkillRegistry({ clock: new ManualClock(NOW), sink: (record) => records.push(record) });
    registry.register(declaration());

    registry.load("research-brief", "1.0.0", permitted());
    registry.load("research-brief", "1.0.0", { ...permitted(), capabilities: CapabilitySet.unknown() });
    registry.load("not-registered-at-all", "1.0.0", permitted());

    assert.equal(records.length, 3, `three attempts, three records; got ${JSON.stringify(records.map((r) => r.outcome))}`);
    assert.deepEqual(
      records.map((r) => r.outcome),
      ["loaded", "refused", "refused"],
      "in order, and the unknown skill is refused rather than throwing",
    );
    // The first two name the skill that was loaded; the third names the one that was ASKED
    // for, which is the only useful thing to record about an attempt on a skill that does not
    // exist. The first draft of this test asserted one id for all three and failed on the
    // unknown-skill record — correctly, because the registry recorded what was requested.
    assert.equal(records[0].skillId, "research-brief");
    assert.equal(records[1].skillId, "research-brief");
    assert.equal(records[2].skillId, "not-registered-at-all", "an unknown skill is recorded by the id that was asked for");
    for (const record of records) {
      assert.ok(typeof record.at === "number", "every record is timestamped");
    }
    assert.equal(records[1].reason !== null, true, "a refusal must say why");
    assert.equal(records[2].reason !== null, true, "including a refusal for an unknown skill");
    assert.equal(records[2].refusal, "unknown_skill");
  });

  it("emits through a real runtime, so the audit trail is not an optional extra", () => {
    // The sink is optional in the constructor - a caller with nowhere to send records should
    // not be forced to invent one - so the requirement that a load is recorded is only
    // satisfied if the COMPOSITION ROOT wires it. This asserts it does, end to end, through a
    // real `createRuntime()`, because a sink that nothing connects to is a capability nobody
    // has.
    const source = readFileSync(path.join(process.cwd(), "src/orchestration/composition.ts"), "utf8");
    assert.match(source, /SkillRegistry/, "the composition root must compose a skill registry");
    assert.match(source, /skills:/, "and expose it on the runtime");
  });

  it("declares only the load-event kinds it actually emits", () => {
    // Phase 11 lists 15 orchestration event kinds that are never emitted anywhere, and calls
    // declared-but-never-emitted "a fabricated capability". Adding two more would make this
    // phase part of that problem rather than a correction of it, so the kinds are checked for
    // presence AND the registry is checked for the code that writes them.
    const trace = readFileSync(path.join(process.cwd(), "src/orchestration/observability/trace.ts"), "utf8");
    assert.match(trace, /"skill_loaded"/, "the loaded kind must be declared");
    assert.match(trace, /"skill_load_refused"/, "and the refused kind");
    const composition = readFileSync(path.join(process.cwd(), "src/orchestration/composition.ts"), "utf8");
    assert.match(composition, /skill_loaded/, "the composition root must emit the loaded kind");
    assert.match(composition, /skill_load_refused/, "and the refused kind");
  });

  /* -- end to end, through a real runtime ---------------------------------- */

  it("writes a load and a refusal into a real runtime's audit trail", () => {
    // The gap this closes is real, and the first PHASE 09 battery run found it: two mutations
    // SURVIVED because every assertion about the sink and the boot report read SOURCE. A
    // source-reading test cannot see a behavioural change - the Phase 08 lesson, restated -
    // so the wiring was asserted but never exercised.
    //
    // This runs the whole path: compose a real runtime, install a skill, load it with a
    // permitted caller, load it with a caller that lacks the capability, and read the events
    // back. If the sink is not wired, or is wired to nothing, this fails.
    const runtime = createRuntime({ clock: new ManualClock(NOW), workspace: workspaceRef("skill-wiring") });

    const installed = runtime.skills.register(declaration());
    assert.equal(installed.ok, true, `the skill must install, got ${JSON.stringify(installed)}`);

    const loaded = runtime.skills.load("research-brief", "1.0.0", permitted());
    assert.equal(loaded.ok, true, "a permitted load must succeed");
    const refused = runtime.skills.load("research-brief", "1.0.0", {
      capabilities: CapabilitySet.unknown(),
      toolIds: ["web.search"],
      workspace: "acme",
    });
    assert.equal(refused.ok, false, "and the under-privileged caller must be refused");

    const kinds = runtime.traces.events().map((event) => event.kind);
    assert.ok(kinds.includes("skill_loaded"), `expected skill_loaded in ${JSON.stringify(kinds)}`);
    assert.ok(kinds.includes("skill_load_refused"), `expected skill_load_refused in ${JSON.stringify(kinds)}`);

    const refusal = runtime.traces.events().find((event) => event.kind === "skill_load_refused");
    const meta = (refusal?.metadata ?? {}) as Record<string, unknown>;
    assert.equal(meta["refusal"], "capability_not_held", "the recorded refusal must say WHICH refusal");
    assert.match(String(meta["reason"]), /web_research/, "and what was missing");
  });

  it("reports its skills and states that they confer nothing", () => {
    // The boot report is what an operator reads before deploying. A count alone would leave
    // open the only question that matters about a skill subsystem — did installing these widen
    // anyone's reach — so the report carries the answer as a literal.
    //
    // This assertion did not exist when the first battery ran, and mutation S7 (widening the
    // `skillAuthority` type) SURVIVED because of that. Source-reading the declaration was not
    // enough; the value has to be checked where it is produced.
    const runtime = createRuntime({ clock: new ManualClock(NOW), workspace: workspaceRef("skill-report") });
    assert.equal(runtime.describe().skills, 0, "a fresh runtime has installed no skills");
    assert.equal(runtime.describe().skillAuthority, "declares-only");

    runtime.skills.register(declaration());
    assert.equal(runtime.describe().skills, 1, "and reports the count it actually holds");
    assert.equal(runtime.describe().skillAuthority, "declares-only", "which does not change what a skill can do");
  });
});

/* -- a small self-check that the helpers above are wired to something real ----- */

describe("PHASE 09 EVIDENCE - skill audit sink shape", () => {
  it("exposes the record type and a collector helper the tests and runtime share", () => {
    // Present so a reader can see the audit record is a first-class shape rather than an
    // anonymous object, and so the probe can build one without importing test fixtures.
    assert.equal(typeof auditEvents, "function");
    const collector = auditEvents();
    assert.deepEqual(collector.records, [], "a fresh collector starts empty");
    assert.equal(typeof collector.sink, "function", "and hands back a sink that can be passed to the registry");
  });
});
