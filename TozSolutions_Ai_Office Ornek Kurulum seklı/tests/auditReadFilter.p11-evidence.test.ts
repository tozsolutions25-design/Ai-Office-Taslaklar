/**
 * PHASE 11 EVIDENCE - `AuditSink.read` narrows by kind and time, not just by scope.
 *
 * ## THE GAP
 *
 * `TODO.md` PHASE 11 item 5: "`AuditSink.read()` takes no filter; consumers must read all
 * events and filter client-side."
 *
 * Confirmed and fixed. `read` narrowed by scope only, so "this workspace's events of kind K,
 * since T" could not be expressed and had to be assembled client-side.
 *
 * One claim this file made at first, and had to withdraw: that `byKind` "ignores scope
 * entirely" and so crosses tenant boundaries. Checked, that was FALSE. `AuditLog` takes its
 * workspace in the CONSTRUCTOR and stamps it onto every appended event (`append` sets
 * `workspace: this.#workspace`), so every event in a log already shares that log's scope and
 * `byKind` cannot return another tenant's events. The defect is narrower and is stated as such.
 *
 * The correction is left in the file rather than the sentence deleted, because a wrong claim
 * about isolation is the most expensive kind of wrong claim to leave lying around - and this
 * phase has already found one of those (`errorClass`) and one that had simply gone stale
 * (`traceId: jobId`).
 *
 * ## WHAT CHANGED
 *
 * An optional `AuditReadFilter` on `read`, applied on top of the scope. Optional, so every
 * existing call site keeps compiling and keeps its exact previous behaviour.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AuditLog } from "../src/audit/events.js";
import { ManualClock } from "../src/core/clock.js";

const SCOPE = { workspace: "acme", brand: null };
const START = new Date("2026-04-01T00:00:00.000Z");

describe("PHASE 11 EVIDENCE - audit read filtering", () => {
  it("narrows by kind", () => {
    const log = new AuditLog({ clock: new ManualClock(START), workspace: "acme" });

    log.append({ kind: "task_transition", taskId: "t1", from: null, to: "queued", attempt: 1, errorClass: null });
    log.append({ kind: "task_transition", taskId: "t2", from: null, to: "running", attempt: 1, errorClass: null });
    log.append({ kind: "route_rejected", taskId: "t3", verdict: "not_eligible", workload: "chat", providerId: "p1", modelId: "m1", reason: "no eligible provider" });

    const transitions = log.read(SCOPE, { kind: "task_transition" });
    assert.equal(transitions.length, 2, "only the two transitions");
    assert.equal(
      transitions.every((event) => event.kind === "task_transition"),
      true,
      "and every returned event really is that kind",
    );
    assert.equal(log.read(SCOPE).length, 3, "while an unfiltered read still returns all three");
    assert.equal(log.byKind("task_transition").length, 2, "agreeing with the new filter rather than contradicting it");
  });

  it("leaves an omitted filter byte-identical to the old behaviour", () => {
    const log = new AuditLog({ clock: new ManualClock(START), workspace: "acme" });
    log.append({ kind: "task_transition", taskId: "t1", from: null, to: "queued", attempt: 1, errorClass: null });
    log.append({ kind: "route_rejected", taskId: "t3", verdict: "not_eligible", workload: "chat", providerId: "p1", modelId: "m1", reason: "no eligible provider" });

    assert.equal(log.read(SCOPE).length, 2, "no filter means no narrowing, exactly as before");
    assert.equal(
      log.read({ workspace: "nobody", brand: null }).length,
      0,
      "and scope isolation is untouched - the filter was added alongside it, not in place of it",
    );
  });

  it("narrows by time", () => {
    const clock = new ManualClock(START);
    const log = new AuditLog({ clock, workspace: "acme" });
    log.append({ kind: "task_transition", taskId: "t1", from: null, to: "queued", attempt: 1, errorClass: null });
    clock.advance(5_000);
    log.append({ kind: "task_transition", taskId: "t2", from: null, to: "running", attempt: 1, errorClass: null });

    const later = log.read(SCOPE, { since: new Date("2026-04-01T00:00:01.000Z") });
    assert.equal(later.length, 1, "the later event only");
    assert.equal(log.read(SCOPE).length, 2, "and the unfiltered read still has both");
  });

  it("combines kind and time rather than one replacing the other", () => {
    const clock = new ManualClock(START);
    const log = new AuditLog({ clock, workspace: "acme" });
    log.append({ kind: "task_transition", taskId: "t1", from: null, to: "queued", attempt: 1, errorClass: null });
    clock.advance(5_000);
    log.append({ kind: "task_transition", taskId: "t2", from: null, to: "running", attempt: 1, errorClass: null });
    clock.advance(5_000);
    log.append({ kind: "route_rejected", taskId: "t3", verdict: "not_eligible", workload: "chat", providerId: "p1", modelId: "m1", reason: "no eligible provider" });

    // t1 at +0s, t2 at +5s, the rejection at +10s. A `since` of +1s drops t1 and `kind` drops
    // the rejection, so only t2 can survive - which is what makes this a test of BOTH
    // predicates rather than of whichever one happens to be stricter.
    const narrowed = log.read(SCOPE, { kind: "task_transition", since: new Date("2026-04-01T00:00:01.000Z") });
    assert.equal(narrowed.length, 1, "one event satisfies BOTH predicates");
    assert.equal(
      (narrowed[0] as { taskId?: string } | undefined)?.taskId,
      "t2",
      "and it is the middle one - not the first transition, and not the rejection",
    );
  });
});