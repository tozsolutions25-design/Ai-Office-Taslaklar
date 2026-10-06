/**
 * PHASE 11 EVIDENCE - the orchestration event vocabulary must be honest.
 *
 * ## WHY THIS FILE EXISTS
 *
 * `TODO.md` PHASE 11: *"15 of 49 orchestration event kinds are never emitted anywhere in `src/`
 * ... Either emit them or delete them. Declared-but-never-emitted is a fabricated capability."*
 *
 * The count was stale — by Phase 10 it was **10 of 54** — and the existing test was a
 * hand-maintained list of kinds that must EXIST. A list of kinds that must exist cannot notice
 * a kind that exists and never fires; it is an approximation of the real property, maintained
 * by hand, and it is how `tool_failed` survived four phases.
 *
 * So this file asserts the real property instead: **every declared kind is emitted by some
 * production file.** There is no allow-list, because there is nothing left to allow — eight of
 * the ten were emitted at real call sites and two were deleted. A new unemittable kind now
 * fails here rather than accumulating.
 *
 * ## WHAT IS DELIBERATELY NOT HERE
 *
 * No test asserts that a specific kind is emitted, because that would be the same
 * hand-maintained list in a different shape. The property is about the SET.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { ORCHESTRATION_EVENT_KINDS } from "../src/orchestration/observability/trace.js";

const ROOT = process.cwd();

const PRODUCTION_FILES: readonly string[] = (() => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".ts")) found.push(path.relative(ROOT, full).replace(/\\/g, "/"));
    }
  };
  walk(path.join(ROOT, "src"));
  return found;
})();

/**
 * The two files that DECLARE the vocabularies rather than producing anything.
 *
 * Both are excluded, and the second exclusion is not obvious.
 * `observability/trace.ts` holds `ORCHESTRATION_EVENT_KINDS`, so counting it would make every
 * kind "emitted". But `audit/events.ts` holds `AUDIT_EVENT_KINDS` and the event interfaces —
 * and `provider_health_changed` appears there and nowhere else, so with only the trace excluded
 * this file counted a bare DECLARATION as a producer and reported a dead kind as alive. That is
 * the same defect the vocabulary test exists to prevent, reproduced inside the test.
 */
const VOCABULARY_FILES: ReadonlySet<string> = new Set([
  "src/orchestration/observability/trace.ts",
  "src/audit/events.ts",
]);

const PRODUCERS: readonly string[] = PRODUCTION_FILES.filter((file) => !VOCABULARY_FILES.has(file));

/**
 * Where a kind is produced.
 *
 * A production file "emits" a kind when it passes the kind as a string literal on a line that
 * is not a comment. Comments are skipped because this repository argues in its comments, and
 * every removed or deferred kind now has a comment naming itself — a naive scan would find
 * those and conclude they were alive.
 */
function producersOf(kind: string): readonly string[] {
  const hits: string[] = [];
  for (const file of PRODUCERS) {
    const lines = readFileSync(path.join(ROOT, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      const text = line.trim();
      if (text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")) return;
      if (text.includes(`"${kind}"`)) hits.push(`${file}:${index + 1}`);
    });
  }
  return hits;
}

describe("PHASE 11 EVIDENCE - the orchestration event vocabulary", () => {
  it("declares only kinds that some production file actually emits", () => {
    // The whole point. Before Phase 11 this was 10 of 54; there is no allow-list because
    // there is nothing left to allow.
    const unemitted = ORCHESTRATION_EVENT_KINDS.filter((kind) => producersOf(kind).length === 0);
    assert.deepEqual(
      unemitted,
      [],
      `these kinds are declared but never emitted, which is a fabricated capability: ${JSON.stringify(unemitted)}`,
    );
  });

  it("keeps the two deleted kinds gone, with their reasons still on record", () => {
    // A deletion is a decision, and a decision that leaves no trace gets undone by the next
    // person who assumes the kind was an oversight.
    assert.equal(ORCHESTRATION_EVENT_KINDS.includes("tool_failed" as never), false, "no tool execution exists to fail");
    assert.equal(
      ORCHESTRATION_EVENT_KINDS.includes("knowledge_ingested" as never),
      false,
      "no knowledge ingestor is composed",
    );
    const trace = readFileSync(path.join(ROOT, "src/orchestration/observability/trace.ts"), "utf8");
    assert.match(trace, /PHASE 11: TWO KINDS REMOVED/, "and the reasoning must remain in the file");
    assert.match(trace, /ToolExecutionHost\.invoke/, "naming why for the tool kind");
    assert.match(trace, /composition root constructs\s*\n?\*?\s*none of them|constructs\s+none of them/, "and for the knowledge kind");
  });

  it("emits the eight that Phase 11 found unemittable, from the paths that own them", () => {
    // Spelled out, unlike the set-level check above, because each of these was a REAL gap
    // rather than a name nobody had used: a run with no first event, a team that formed with no
    // event, a routing refusal visible only as its consequence, usage counted in memory and
    // never in the trail, memory read and written invisibly, and external agents entering the
    // system unrecorded.
    const expected: Readonly<Record<string, string>> = {
      orchestration_started: "src/orchestration/authority.ts",
      team_formed: "src/orchestration/authority.ts",
      model_route_refused: "src/orchestration/authority.ts",
      model_route_fell_back: "src/orchestration/authority.ts",
      provider_usage_recorded: "src/orchestration/authority.ts",
      memory_retrieved: "src/orchestration/authority.ts",
      memory_captured: "src/orchestration/authority.ts",
      agent_source_ingested: "src/orchestration/composition.ts",
    };
    for (const [kind, expectedFile] of Object.entries(expected)) {
      const producers = producersOf(kind);
      assert.ok(producers.length > 0, `${kind} must be emitted somewhere`);
      assert.ok(
        producers.some((site) => site.startsWith(expectedFile)),
        `${kind} must be emitted from ${expectedFile}, found ${JSON.stringify(producers)}`,
      );
    }
  });

  it("resolves the provider_health_changed collision by removing the orchestration duplicate", () => {
    // `TODO.md` PHASE 11 item 3: the kind existed in BOTH vocabularies with different payload
    // shapes, so a consumer switching on `kind` could not tell which it had. Worse, the audit
    // found it was emitted by NEITHER - it existed as a name twice and as an observation never.
    //
    // Resolved in the direction that keeps the meaning: provider health is a PROVIDER concern,
    // not an orchestration one, so the ORCHESTRATION duplicate is deleted and the AUDIT event
    // is implemented in the health monitor, which is composed and already computes the
    // transition. A single kind, one vocabulary, actually produced.
    assert.equal(
      ORCHESTRATION_EVENT_KINDS.includes("provider_health_changed" as never),
      false,
      "the orchestration duplicate must be gone; provider health is not an orchestration event",
    );
    const monitor = readFileSync(path.join(ROOT, "src/health/monitor.ts"), "utf8");
    assert.match(monitor, /provider_health_changed/, "and the audit-side kind must now be produced");
  });

  it("does not count a kind as emitted merely because its own doc mentions it", () => {
    // The check above skips comment lines. This asserts that the skip is real, by pointing at
    // a kind whose file mentions several OTHERS in prose: if comments were counted, deleting
    // the two kinds above would have left them looking alive and the set-level check would
    // have passed vacuously.
    const trace = readFileSync(path.join(ROOT, "src/orchestration/observability/trace.ts"), "utf8");
    assert.match(trace, /`tool_refused`, which is emitted/, "a comment names a kind without emitting it");
    assert.deepEqual(producersOf("tool_failed"), [], "and the deleted kind has no producer anywhere");
  });
  it("produces a real health transition event, and only on a transition", async () => {
    // The source assertions above prove the monitor NAMES the kind. This proves it emits one,
    // through the real composition root, and that a repeated identical report stays quiet —
    // because a provider that keeps succeeding is the normal case and an event per report
    // would bury the transition that matters.
    const { ManualClock } = await import("../src/core/clock.js");
    const { AuditLog } = await import("../src/audit/events.js");
    const { createRuntime } = await import("../src/orchestration/composition.js");
    const { workspaceRef } = await import("../src/orchestration/workspace/workspace.js");

    const now = new Date("2026-04-01T00:00:00.000Z");
    const log = new AuditLog({ clock: new ManualClock(now) });
    const runtime = createRuntime({ clock: new ManualClock(now), audit: log, workspace: workspaceRef("p11-health") });

    runtime.core.health.report("provider-a", { success: false, detail: "probe failed" });
    runtime.core.health.report("provider-a", { success: false, detail: "probe failed again" });

    const events = log.read({ workspace: null, brand: null }).filter((event) => event.kind === "provider_health_changed");
    assert.equal(events.length, 1, "two failures in a row is ONE transition, not two events");
    const [event] = events;
    assert.ok(event !== undefined && "targetId" in event, "and it is the provider event variant");
    assert.equal(event.targetId, "provider-a");
    assert.equal(event.toStatus !== event.fromStatus, true, "a transition by definition");
  });
});

