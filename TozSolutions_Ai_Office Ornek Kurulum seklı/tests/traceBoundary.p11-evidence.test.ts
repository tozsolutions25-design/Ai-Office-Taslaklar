/**
 * PHASE 11 EVIDENCE - one trace crosses the workflow boundary.
 *
 * ## THE FINDING, AND THE PART OF IT THAT WAS WRONG
 *
 * `FINAL_ARCHITECTURE.md` §11 claimed:
 *
 * > `traceId` across the workflow boundary | The coordinator sets `traceId: jobId`; the
 * > orchestrator mints its own; `worker.ts` discards the connecting context. **`byTrace()` on
 * > one side cannot reach the other.**
 *
 * Re-verified against the source, the conclusion holds and one of the three stated causes is
 * wrong:
 *
 * - **"The coordinator sets `traceId: jobId`" — STALE.** It sets `traceId: job.correlationId`
 *   (`coordinator.ts`), both on the `ExecutionContext` it builds and on the worker record. The
 *   doc described an older version of the code.
 * - **"The orchestrator mints its own" — TRUE and it was unconditional.** `authority.ts` ran
 *   `this.#ids.newId("trace")` with no way for a caller to supply one: `OrchestrationRequest`
 *   had no `traceId` field at all.
 * - **"`worker.ts` discards the connecting context" — TRUE, and this was the mechanism.** The
 *   worker's `execute(request, context)` took the context as its second argument and then read
 *   `void context;`. The coordinator had already built the right id and handed it over.
 *
 * So one job produced two unrelated traces. `byTrace()` could not cross, and the coordinator
 * only ever learned the orchestrator's second id after the fact, from the return value.
 *
 * ## WHAT CHANGED
 *
 * `OrchestrationRequest.traceId` (optional), forwarded by the worker from `context.traceId`,
 * adopted by the orchestrator when present. Minted only when the caller supplies none, so every
 * caller that had no correlation id is byte-identical to before.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { createRuntime, type Runtime } from "../src/orchestration/composition.js";

const NOW = new Date("2026-04-01T00:00:00.000Z");

describe("PHASE 11 EVIDENCE - the trace across the workflow boundary", () => {
  it("adopts a caller-supplied traceId instead of minting a second one", async () => {
    const runtime: Runtime = createRuntime({ clock: new ManualClock(NOW), workspace: { workspace: "p11-trace", brand: null } });

    const supplied = "trace_from_the_workflow_side";
    const result = await runtime.orchestrator.execute({
      taskId: "t1",
      objective: "do the thing",
      input: "go",
      requiredCapabilities: [],
      taskType: "single",
      traceId: supplied,
    });

    assert.equal(result.ok, true, `expected the run to start: ${JSON.stringify(result.ok ? null : result.error)}`);
    assert.equal(
      result.value.traceId,
      supplied,
      "the caller's id must come back, or the coordinator is told a different trace than the one it asked for",
    );

    // The part that matters: the events carry it, so `byTrace` can find them.
    const found = runtime.traces.byTrace(supplied);
    assert.ok(found.length > 0, "events must be findable under the SUPPLIED id, not a private one");
    assert.equal(
      found.every((event) => event.traceId === supplied),
      true,
      "and every one of them, with no leftovers on a second trace",
    );
  });

  it("still mints its own trace when the caller supplies none", async () => {
    const runtime = createRuntime({ clock: new ManualClock(NOW), workspace: { workspace: "p11-trace-2", brand: null } });

    const result = await runtime.orchestrator.execute({
      taskId: "t1",
      objective: "do the thing",
      input: "go",
      requiredCapabilities: [],
      taskType: "single",
    });

    assert.equal(result.ok, true, `expected the run to start: ${JSON.stringify(result.ok ? null : result.error)}`);
    const minted = result.value.traceId;
    assert.equal(typeof minted, "string", "a trace must still exist when nobody supplies one");
    assert.match(minted, /^trace_/, "and it must be the orchestrator's own minted id, not an empty or copied value");
    assert.ok(runtime.traces.byTrace(minted).length > 0, "recorded events are findable under it");
  });

  it("does not let one run's supplied id leak into a later run", async () => {
    // The control for the first test: adoption must be per-call, not sticky state on the
    // orchestrator. If `supplied` were cached, this run would report someone else's trace.
    const runtime = createRuntime({ clock: new ManualClock(NOW), workspace: { workspace: "p11-trace-3", brand: null } });

    const first = await runtime.orchestrator.execute({
      taskId: "t1", objective: "one", input: "go", requiredCapabilities: [], taskType: "single", traceId: "trace_first",
    });
    const second = await runtime.orchestrator.execute({
      taskId: "t2", objective: "two", input: "go", requiredCapabilities: [], taskType: "single",
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.notEqual(
      second.value.traceId,
      "trace_first",
      "an unsupplied trace must not inherit the previous call's id",
    );
    assert.equal(runtime.traces.byTrace("trace_first").length > 0, true, "the first run's events stay findable");
    assert.equal(runtime.traces.byTrace(second.value.traceId).length > 0, true, "and so do the second's");
  });

  it("joins a job's events by job id as well as by trace", () => {
    // `byJob` existed only as a promise in a comment ("added below rather than by overloading
    // this one again"). It is now a method, matching `parentTaskId`.
    const runtime = createRuntime({ clock: new ManualClock(NOW), workspace: { workspace: "p11-trace-4", brand: null } });
    runtime.traces.record(
      "subtask_started",
      { traceId: "trace_x", taskId: "task-1", parentTaskId: "job-9", teamId: null },
      { agentId: "a@1" },
      NOW,
    );
    runtime.traces.record(
      "subtask_completed",
      { traceId: "trace_x", taskId: "task-1", parentTaskId: null, teamId: null },
      { agentId: "a@1" },
      NOW,
    );

    const byJob = runtime.traces.byJob("job-9");
    assert.equal(byJob.length, 1, "only the event that names the job");
    assert.equal(byJob[0]?.kind, "subtask_started");
    assert.equal(runtime.traces.byTrace("trace_x").length, 2, "while byTrace still spans the whole run - neither lookup overreaches");
  });

  it("derives the job from metadata.jobId, which is how the WORKFLOW emitter writes it", () => {
    // This is the half that mutation M5 killed, and it was a genuine gap rather than a bad
    // mutation: the coordinator's per-task context puts the job in `parentTaskId`, but its
    // workflow-level emitter labels events with `metadata.jobId` and has no task at all. Only
    // the first shape had a test, so reading the job from `parentTaskId` alone passed while
    // workflow events were unjoinable to their job - the exact defect item 4 describes.
    const runtime = createRuntime({ clock: new ManualClock(NOW), workspace: { workspace: "p11-trace-5", brand: null } });
    runtime.traces.record(
      "subtask_completed",
      // No task, so `parentTaskId` is null - a workflow-level milestone.
      { traceId: "trace_w", taskId: "job-77", parentTaskId: null, teamId: null },
      { jobId: "job-77" },
      NOW,
    );

    const byJob = runtime.traces.byJob("job-77");
    assert.equal(byJob.length, 1, "the labelled event is found by job");
    assert.equal(
      (byJob[0] as { jobId?: string } | undefined)?.jobId,
      "job-77",
      "and the job is a first-class field on the event, not something a consumer must dig out of metadata",
    );
  });

  it("prefers an explicit job label over the task-context fallback", () => {
    // Both conventions meet on events the coordinator emits per task AND per job. When they
    // disagree the explicit label wins, because the label is the one the producer named
    // deliberately rather than the field the context happened to carry.
    const runtime = createRuntime({ clock: new ManualClock(NOW), workspace: { workspace: "p11-trace-6", brand: null } });
    runtime.traces.record(
      "subtask_started",
      { traceId: "trace_b", taskId: "task-3", parentTaskId: "job-from-context", teamId: null },
      { jobId: "job-from-label" },
      NOW,
    );

    assert.equal(runtime.traces.byJob("job-from-label").length, 1, "the label is honoured");
    assert.equal(runtime.traces.byJob("job-from-context").length, 0, "and the fallback does not also match, which would double-count the event");
  });
});