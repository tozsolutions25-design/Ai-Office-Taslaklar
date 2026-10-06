import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock, systemClock } from "../src/core/clock.js";
import { SequentialIdGenerator } from "../src/core/ids.js";
import { InvalidTransitionError } from "../src/core/errors.js";
import {
  DuplicateTaskError,
  QueueFullError,
  TaskQueue,
  TERMINAL_TASK_STATES,
  assertTaskTransition,
  canTransitionTask,
  isTaskState,
  isTerminalTaskState,
} from "../src/queue/index.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function makeQueue(maxTasks = 10): { queue: TaskQueue; clock: ManualClock } {
  const clock = new ManualClock(NOW);
  const ids = new SequentialIdGenerator("task");
  return { queue: new TaskQueue({ maxTasks, clock, ids }), clock };
}

describe("task state machine", () => {
  it("recognises the defined states", () => {
    for (const state of ["queued", "scheduled", "running", "retrying", "fallback", "completed", "failed", "cancelled"] as const) {
      assert.equal(isTaskState(state), true);
    }
    assert.equal(isTaskState("paused"), false);
  });

  it("allows the intended happy path", () => {
    assert.equal(canTransitionTask("queued", "scheduled"), true);
    assert.equal(canTransitionTask("scheduled", "running"), true);
    assert.equal(canTransitionTask("running", "completed"), true);
  });

  it("allows retry and fallback loops back to scheduled", () => {
    assert.equal(canTransitionTask("running", "retrying"), true);
    assert.equal(canTransitionTask("retrying", "scheduled"), true);
    assert.equal(canTransitionTask("running", "fallback"), true);
    assert.equal(canTransitionTask("fallback", "scheduled"), true);
  });

  it("rejects skipping straight from queued to running", () => {
    assert.equal(canTransitionTask("queued", "running"), false);
    assert.throws(() => assertTaskTransition("queued", "running"), InvalidTransitionError);
  });

  it("rejects mutating a terminal state", () => {
    for (const terminal of TERMINAL_TASK_STATES) {
      assert.equal(isTerminalTaskState(terminal), true);
      for (const target of ["queued", "running", "completed", "failed"] as const) {
        assert.equal(
          canTransitionTask(terminal, target),
          false,
          `${terminal} -> ${target} must be rejected`,
        );
      }
    }
  });

  it("rejects moving backwards out of a terminal state", () => {
    assert.equal(canTransitionTask("completed", "queued"), false);
  });
});

describe("task queue", () => {
  it("enqueues a task in the queued state", () => {
    const { queue } = makeQueue();
    const result = queue.enqueue({ taskId: "t1", workload: "coding", input: "do the thing" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.state, "queued");
    assert.equal(queue.size, 1);
    assert.equal(queue.countByState("queued"), 1);
  });

  it("generates a task id when none is supplied", () => {
    const { queue } = makeQueue();
    const result = queue.enqueue({ workload: "research", input: "x" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.match(result.value.taskId, /^task-\d+/);
  });

  it("rejects a duplicate task id", () => {
    const { queue } = makeQueue();
    queue.enqueue({ taskId: "t1", workload: "coding", input: "a" });
    const duplicate = queue.enqueue({ taskId: "t1", workload: "coding", input: "b" });
    assert.equal(duplicate.ok, false);
    if (duplicate.ok) return;
    assert.ok(duplicate.error instanceof DuplicateTaskError);
    assert.equal(queue.size, 1);
  });

  it("rejects an invalid workload class", () => {
    const { queue } = makeQueue();
    const result = queue.enqueue({ workload: "teleportation" as never, input: "x" });
    assert.equal(result.ok, false);
    assert.equal(queue.size, 0);
  });

  it("refuses new work once full instead of growing without bound", () => {
    const { queue } = makeQueue(2);
    assert.equal(queue.enqueue({ taskId: "a", workload: "coding", input: "x" }).ok, true);
    assert.equal(queue.enqueue({ taskId: "b", workload: "coding", input: "x" }).ok, true);
    const overflow = queue.enqueue({ taskId: "c", workload: "coding", input: "x" });
    assert.equal(overflow.ok, false);
    if (overflow.ok) return;
    assert.ok(overflow.error instanceof QueueFullError);
    assert.equal(queue.size, 2);
    assert.equal(queue.remainingCapacity, 0);
  });

  it("rejects a non-positive capacity at construction", () => {
    assert.throws(() => new TaskQueue({ maxTasks: 0 }), /positive integer/);
    assert.throws(() => new TaskQueue({ maxTasks: -1 }), /positive integer/);
  });

  it("claims the next queued task and moves it to scheduled", () => {
    const { queue } = makeQueue();
    queue.enqueue({ taskId: "a", workload: "coding", input: "x" });
    queue.enqueue({ taskId: "b", workload: "research", input: "y" });
    const claimed = queue.claimNext("scheduled");
    assert.ok(claimed);
    assert.equal(claimed.taskId, "a", "FIFO order must be preserved");
    assert.equal(claimed.state, "scheduled");
    assert.equal(queue.countByState("queued"), 1);
  });

  it("returns null when nothing is ready to claim", () => {
    const { queue } = makeQueue();
    assert.equal(queue.claimNext("scheduled"), null);
  });

  it("walks a task to completion and records the attempt", () => {
    const { queue, clock } = makeQueue();
    queue.enqueue({ taskId: "a", workload: "coding", input: "x" });
    queue.transition("a", "scheduled");
    queue.transition("a", "running");
    assert.equal(queue.get("a")?.attempt, 1);
    const done = queue.transition("a", "completed");
    assert.equal(done.ok, true);
    const task = queue.snapshot("a");
    assert.ok(task);
    assert.equal(task.state, "completed");
    assert.ok(task.startedAt);
    assert.ok(task.finishedAt);
    assert.equal(task.finishedAt.getTime(), clock.now().getTime());
  });

  it("records a failure with its classification", () => {
    const { queue } = makeQueue();
    queue.enqueue({ taskId: "a", workload: "coding", input: "x" });
    queue.transition("a", "scheduled");
    queue.transition("a", "running");
    queue.transition("a", "retrying", "timeout");
    assert.equal(queue.get("a")?.state, "retrying");
    const task = queue.snapshot("a");
    assert.ok(task);
    assert.equal(task.lastErrorClass, "timeout");
  });

  it("rejects an invalid state transition", () => {
    const { queue } = makeQueue();
    queue.enqueue({ taskId: "a", workload: "coding", input: "x" });
    const result = queue.transition("a", "running");
    assert.equal(result.ok, false, "queued -> running must be refused");
    if (result.ok) return;
    assert.ok(result.error instanceof InvalidTransitionError);
    assert.equal(queue.get("a")?.state, "queued", "state must be unchanged after a refusal");
  });

  it("rejects an unknown state name", () => {
    const { queue } = makeQueue();
    queue.enqueue({ taskId: "a", workload: "coding", input: "x" });
    const result = queue.transition("a", "paused" as never);
    assert.equal(result.ok, false);
  });

  it("fails a transition for an unknown task", () => {
    const { queue } = makeQueue();
    const result = queue.transition("ghost", "scheduled");
    assert.equal(result.ok, false);
  });

  it("keeps a full transition history", () => {
    const { queue } = makeQueue();
    queue.enqueue({ taskId: "a", workload: "coding", input: "x" });
    queue.transition("a", "scheduled");
    queue.transition("a", "running");
    queue.transition("a", "failed", "timeout");
    const task = queue.snapshot("a");
    assert.ok(task);
    assert.deepEqual(
      task.history.map((entry) => entry.to),
      ["queued", "scheduled", "running", "failed"],
    );
    assert.equal(task.history[0]?.from, null);
  });

  it("re-queues a preempted task to the back of the queue", () => {
    const { queue } = makeQueue();
    queue.enqueue({ taskId: "a", workload: "coding", input: "x" });
    queue.enqueue({ taskId: "b", workload: "coding", input: "y" });
    queue.claimNext("scheduled");
    queue.transition("a", "queued");
    // FIFO fairness: a preempted task does not jump ahead of waiting tasks.
    assert.equal(queue.claimNext("scheduled")?.taskId, "b");
    assert.equal(queue.claimNext("scheduled")?.taskId, "a");
  });

  it("reclaims capacity by pruning terminal tasks", () => {
    const { queue } = makeQueue(2);
    queue.enqueue({ taskId: "a", workload: "coding", input: "x" });
    queue.enqueue({ taskId: "b", workload: "coding", input: "y" });
    queue.transition("a", "cancelled");
    assert.equal(queue.remainingCapacity, 0);
    const removed = queue.pruneCompleted();
    assert.deepEqual(removed, ["a"]);
    assert.equal(queue.size, 1);
    assert.equal(queue.enqueue({ taskId: "c", workload: "coding", input: "z" }).ok, true);
  });

  it("records the assigned provider and model, and the result on completion", () => {
    const { queue, clock } = makeQueue();
    queue.enqueue({ taskId: "a", workload: "coding", input: "x" });
    queue.transition("a", "scheduled");
    queue.transition("a", "running");

    const task = queue.get("a");
    assert.ok(task);
    task.assign("acme", "acme-1", clock.now());
    task.complete("the answer", clock.now());

    const snapshot = queue.snapshot("a");
    assert.ok(snapshot);
    assert.equal(snapshot.assignedProviderId, "acme");
    assert.equal(snapshot.assignedModelId, "acme-1");
    assert.equal(snapshot.state, "completed");
    assert.equal(snapshot.result, "the answer");
  });

  it("rejects completing a task that is not running", () => {
    const { queue } = makeQueue();
    queue.enqueue({ taskId: "a", workload: "coding", input: "x" });
    const task = queue.get("a");
    assert.ok(task);
    assert.throws(() => task.complete("premature", new Date()), InvalidTransitionError);
    assert.equal(queue.get("a")?.state, "queued", "a refused completion must not change state");
  });

  it("counts tasks by state", () => {
    const { queue } = makeQueue();
    queue.enqueue({ taskId: "a", workload: "coding", input: "x" });
    queue.enqueue({ taskId: "b", workload: "coding", input: "y" });
    queue.transition("b", "cancelled");
    assert.equal(queue.countByState("queued"), 1);
    assert.equal(queue.countByState("cancelled"), 1);
    assert.equal(queue.countByState("running"), 0);
  });
});

describe("clock", () => {
  it("advances only when the manual clock is advanced", () => {
    const clock = new ManualClock(NOW);
    assert.equal(clock.now().getTime(), NOW.getTime());
    clock.advance(5_000);
    assert.equal(clock.now().getTime(), NOW.getTime() + 5_000);
  });

  it("records sleeps without waiting", async () => {
    const clock = new ManualClock(0);
    await clock.sleep(250);
    await clock.sleep(750);
    assert.deepEqual(clock.recordedSleeps, [250, 750]);
    assert.equal(clock.nowMs(), 1_000);
  });

  it("exposes a real system clock", () => {
    assert.ok(systemClock.nowMs() > 0);
  });
});
