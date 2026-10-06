/**
 * PHASE 11 EVIDENCE - the trace recorder must not be the one place a secret survives.
 *
 * ## THE DEFECT, AND WHY IT IS A DEFECT RATHER THAN A NIT
 *
 * `AuditLog.append` redacts on the way IN (`redact(rest)`) and bounds its buffer with
 * `maxEvents` plus a `droppedCount`. `TraceRecorder.record` did **neither**: it pushed
 * `metadata: { ...detail }` — raw — into `#events`, and handed the same raw object to the
 * sink, which then redacted only its own copy.
 *
 * So the sink held `[REDACTED]` and the recorder held the secret, in the same process, for the
 * same event. And every read path — `events()`, `byTrace()`, `byTask()`, `byKind()` — returned
 * the raw one. The redaction was real; it was just applied to the copy nobody reads.
 *
 * That inverts the guarantee. The audit layer exists so an operator can inspect a run, and the
 * component whose whole job is in-memory run history was the one holding the unredacted value.
 *
 * ## WHY THIS FILE IS MOSTLY ABOUT A MIRROR
 *
 * The fix is not a new mechanism. `AuditLog` already does both things correctly, in the same
 * repository, for the same reason. So these tests assert that `TraceRecorder` matches its
 * sibling — which is the cheapest possible specification, and one that cannot drift into a
 * second opinion about what a secret is.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { AuditLog } from "../src/audit/events.js";
import { TraceRecorder, type ExecutionContext } from "../src/orchestration/observability/trace.js";

const NOW = new Date("2026-04-01T00:00:00.000Z");
const CLOCK = new ManualClock(NOW);
const CONTEXT: ExecutionContext = {
  traceId: "trace-1",
  taskId: "task-1",
  parentTaskId: null,
  teamId: null,
};

describe("PHASE 11 EVIDENCE - trace recorder redaction and bounds", () => {
  /* -- 1. redaction happens on the way IN ---------------------------------- */

  it("stores redacted metadata, so every read path is safe", () => {
    // Before: `metadata` was `{ ...detail }`, verbatim. The sink redacted its own copy and the
    // recorder kept the original, which meant `events()` was the one API in the process that
    // could return a secret the audit log had already removed.
    const recorder = new TraceRecorder();
    recorder.record(
      "subtask_started",
      CONTEXT,
      { agentId: "a", apiKey: "sk-live-abcdefghijklmnop", note: "nothing here" },
      NOW,
    );

    const event = recorder.events()[0];
    const metadata = event.metadata as Record<string, unknown>;
    assert.equal(metadata["apiKey"], "[REDACTED]", "the sensitive field must not survive in the recorder");
    assert.equal(metadata["note"], "nothing here", "and an ordinary field must be untouched");
    assert.doesNotMatch(
      JSON.stringify(recorder.events()),
      /sk-live-abcdefghijklmnop/,
      "no read path may return the raw value",
    );
  });

  it("keeps the recorder and the sink in AGREEMENT, rather than one redacted and one not", () => {
    // The failure mode was not "the sink leaked" — it was "the sink was safe and the recorder
    // was not". A test that only checked the sink passed throughout. Asserting that both views
    // of the SAME event agree is what would have caught it.
    const log = new AuditLog({ clock: CLOCK });
    const recorder = new TraceRecorder(log);
    recorder.record(
      "subtask_failed",
      CONTEXT,
      { password: "hunter2-correct-horse", agentId: "a" },
      NOW,
    );

    const fromRecorder = recorder.events()[0].metadata as Record<string, unknown>;
    // `AuditLog.read` returns the union of audit event shapes, and only the
    // `orchestration_event` variant carries `metadata` — which is precisely the event written
    // here. Narrowed rather than cast, so a future change to what the recorder mirrors would
    // fail here instead of reading `undefined` and passing a vacuous comparison.
    const mirrored = log.read({ workspace: null, brand: null }).find(
      (event) => event.kind === "orchestration_event",
    );
    assert.ok(mirrored !== undefined, "the recorder must mirror into the shared sink");
    assert.ok("metadata" in mirrored, "and the mirrored event must be the orchestration variant");
    const sinkMetadata: Record<string, unknown> = { ...mirrored.metadata };

    assert.equal(fromRecorder["password"], "[REDACTED]", "the recorder redacts");
    assert.equal(sinkMetadata["password"], "[REDACTED]", "and so does the sink");
    assert.equal(
      JSON.stringify(fromRecorder),
      JSON.stringify(sinkMetadata),
      "so the two views of one event cannot disagree about what was recorded",
    );
  });

  it("redacts a secret hidden in a nested structure, not only at the top level", () => {
    // `redact` is recursive, and the point of the recorder not storing raw input is that the
    // recursion actually gets applied. A top-level-only fix would leave `metadata: { request:
    // { headers: { authorization: "..." } } }` readable through `events()`.
    const recorder = new TraceRecorder();
    recorder.record(
      "subtask_started",
      CONTEXT,
      { request: { headers: { authorization: "Bearer abcdefghijklmnopqrst" }, url: "https://example.test" } },
      NOW,
    );
    const serialised = JSON.stringify(recorder.events());
    assert.doesNotMatch(serialised, /abcdefghijklmnopqrst/, "a nested secret must not survive either");
    assert.match(serialised, /example\.test/, "while an ordinary nested value is kept");
  });

  /* -- 2. the buffer is bounded, and says what it dropped ------------------- */

  it("bounds its own buffer and counts what it dropped", () => {
    // `AuditLog` has had `maxEvents` and `droppedCount` since Phase 01. `TraceRecorder` had
    // neither, so a long-running process accumulated every event it had ever been told about,
    // with raw metadata, forever. An unbounded buffer of unbounded strings is a denial of
    // service against the process that is supposed to be observing it.
    const recorder = new TraceRecorder(undefined, { maxEvents: 5 });
    for (let index = 0; index < 20; index += 1) {
      recorder.record("subtask_started", { ...CONTEXT, taskId: `task-${index}` }, { agentId: "a" }, NOW);
    }
    assert.equal(recorder.size, 5, "the buffer holds at most the bound");
    assert.equal(recorder.droppedCount(), 15, "and the recorder says how many it discarded");
    // Oldest-first eviction, matching `AuditLog`, so the events that survive are the recent
    // ones — an operator reconstructing a run needs the tail, not the head.
    assert.equal(recorder.events()[0]?.taskId, "task-15", "the oldest events are the ones dropped");
  });

  it("defaults to a bound rather than to unbounded", () => {
    const recorder = new TraceRecorder();
    assert.ok(
      recorder.maxEvents() > 0 && recorder.maxEvents() <= 100_000,
      `a default bound must exist and be finite, got ${String(recorder.maxEvents())}`,
    );
    assert.equal(recorder.droppedCount(), 0, "and nothing is dropped before anything is recorded");
  });

  it("reports its own loss rather than letting a caller infer it from a gap", () => {
    // The alternative to a dropped counter is a recorder that silently stops telling the
    // truth: a caller counting events would believe it had seen them all.
    const recorder = new TraceRecorder(undefined, { maxEvents: 2 });
    for (let index = 0; index < 5; index += 1) {
      recorder.record("subtask_started", { ...CONTEXT, taskId: `t-${index}` }, {}, NOW);
    }
    assert.equal(recorder.size + recorder.droppedCount(), 5, "seen plus dropped accounts for every event");
  });
});
