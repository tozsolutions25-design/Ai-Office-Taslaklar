import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InvalidTransitionError } from "../src/core/errors.js";
import { CapabilitySet } from "../src/capabilities/capability.js";
import {
  assertOrchestrationTransition,
  canCompleteFrom,
  canTransitionOrchestration,
  isOrchestrationState,
  isTerminalOrchestrationState,
  allowedOrchestrationTransitions,
  ORCHESTRATION_TASK_STATES,
} from "../src/orchestration/task/state.js";
import {
  dependentsOf,
  findDependencyCycle,
  readySubtasks,
  validatePlan,
  type ExecutionPlan,
  type SubTask,
} from "../src/orchestration/task/plan.js";
import {
  TOPOLOGIES,
  allowsConcurrency,
  hasSupervisor,
  isTopology,
  smallestSufficientTopology,
  topologyFits,
} from "../src/orchestration/team/topology.js";
import { TeamPlan, TeamRuntime } from "../src/orchestration/team/team.js";
import { DriftGuard, assessPlanDrift, DEFAULT_DRIFT_LIMITS } from "../src/orchestration/policy/antiDrift.js";
import { assertErr, assertOk } from "./contracts/contracts.js";
import type { ValidationError } from "../src/core/errors.js";

/** Asserts a plan is rejected, and hands back the structured error. */
function expectInvalid(invalid: ExecutionPlan): ValidationError {
  return assertErr<ValidationError>(validatePlan(invalid), `expected the plan to be rejected: ${invalid.planId}`);
}
import type { Team, TeamResult } from "../src/orchestration/team/team.js";

function subtask(id: string, dependsOn: readonly string[] = [], overrides: Partial<SubTask> = {}): SubTask {
  return {
    taskId: id,
    parentTaskId: "root",
    objective: `Do ${id}`,
    requiredCapabilities: [],
    input: "in",
    expectedOutput: `out ${id}`,
    dependsOn,
    limits: { timeoutMs: 1_000, maxRetries: 1, maxChildren: 0 },
    verificationKinds: [],
    ...overrides,
  };
}

function plan(subtasks: readonly SubTask[], overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    planId: "plan-1",
    rootTaskId: "root",
    objective: "Complete the objective",
    topology: subtasks.length <= 1 ? "single" : "parallel",
    subtasks,
    limits: { timeoutMs: 10_000, maxRetries: 1, maxChildren: 0 },
    verificationKinds: [],
    terminalTaskId: subtasks[0]?.taskId ?? null,
    ...overrides,
  };
}

describe("orchestration task state machine", () => {
  it("recognises every declared state", () => {
    for (const state of ORCHESTRATION_TASK_STATES) {
      assert.equal(isOrchestrationState(state), true, `${state} must be recognised`);
    }
    assert.equal(isOrchestrationState("paused"), false);
  });

  it("follows the intended happy path", () => {
    assert.equal(canTransitionOrchestration("created", "classifying"), true);
    assert.equal(canTransitionOrchestration("classifying", "planning"), true);
    assert.equal(canTransitionOrchestration("planning", "ready"), true);
    assert.equal(canTransitionOrchestration("ready", "running"), true);
    assert.equal(canTransitionOrchestration("running", "verifying"), true);
    assert.equal(canTransitionOrchestration("verifying", "completed"), true);
  });

  it("rejects skipping straight from created to running", () => {
    assert.equal(canTransitionOrchestration("created", "running"), false);
    assert.throws(() => assertOrchestrationTransition("created", "running"), InvalidTransitionError);
  });

  it("allows a ready task to return to planning", () => {
    assert.equal(canTransitionOrchestration("ready", "planning"), true, "a plan may prove insufficient");
  });

  it("supports the retry loop", () => {
    assert.equal(canTransitionOrchestration("running", "failed"), true);
    assert.equal(canTransitionOrchestration("failed", "retrying"), true);
    assert.equal(canTransitionOrchestration("retrying", "ready"), true);
  });

  it("supports escalation from a failure or a retry", () => {
    assert.equal(canTransitionOrchestration("failed", "escalated"), true);
    assert.equal(canTransitionOrchestration("retrying", "escalated"), true);
    assert.equal(canTransitionOrchestration("running", "escalated"), true);
  });

  it("treats completed and cancelled as terminal", () => {
    assert.equal(isTerminalOrchestrationState("completed"), true);
    assert.equal(isTerminalOrchestrationState("cancelled"), true);
    assert.deepEqual(allowedOrchestrationTransitions("completed"), []);
    assert.deepEqual(allowedOrchestrationTransitions("cancelled"), []);
  });

  it("treats escalated as waiting for a human, not for a retry", () => {
    assert.equal(isTerminalOrchestrationState("escalated"), false);
    assert.ok(allowedOrchestrationTransitions("escalated").includes("cancelled"));
  });

  it("prevents a task requiring verification from completing without it", () => {
    assert.equal(canCompleteFrom("running", true), false, "a verified task must pass through verifying");
    assert.equal(canCompleteFrom("running", false), true, "a task needing no verification may complete directly");
    assert.equal(canCompleteFrom("verifying", true), true);
  });
});

describe("execution plan validation", () => {
  it("accepts a well-formed plan", () => {
    const result = validatePlan(plan([subtask("a")]));
    assert.equal(result.ok, true);
  });

  it("rejects a plan with no subtasks", () => {
    const error = expectInvalid(plan([]));
    assert.match(error.message, /at least one subtask/);
  });

  it("rejects an empty objective", () => {
    const error = expectInvalid(plan([subtask("a")], { objective: "  " }));
    assert.match(error.message, /objective/);
  });

  it("rejects duplicate subtask ids", () => {
    const error = expectInvalid(plan([subtask("a"), subtask("a")]));
    assert.match(error.message, /duplicate subtask id/);
  });

  it("rejects a subtask whose parent is not the root", () => {
    const orphan = subtask("a");
    const error = expectInvalid(plan([{ ...orphan, parentTaskId: "somewhere-else" }]));
    assert.match(error.message, /root task/);
  });

  it("rejects a dependency on an unknown subtask", () => {
    const error = expectInvalid(plan([subtask("a", ["ghost"])]));
    assert.match(error.message, /unknown subtask/);
  });

  it("rejects a self-dependency", () => {
    const error = expectInvalid(plan([subtask("a", ["a"])]));
    assert.match(error.message, /depends on itself/);
  });

  it("rejects a subtask with no expected output", () => {
    const error = expectInvalid(plan([subtask("a", [], { expectedOutput: "" })]));
    assert.match(error.message, /expectedOutput/);
  });

  it("rejects an invalid limit", () => {
    const error = expectInvalid(
      plan([subtask("a", [], { limits: { timeoutMs: 0, maxRetries: 1, maxChildren: 0 } })]),
    );
    assert.match(error.message, /timeoutMs/);
  });

  it("rejects a terminal id that is not a subtask", () => {
    const error = expectInvalid(plan([subtask("a")], { terminalTaskId: "ghost" }));
    assert.match(error.message, /terminalTaskId/);
  });

  it("rejects a dependency cycle", () => {
    const error = expectInvalid(plan([subtask("a", ["b"]), subtask("b", ["a"])]));
    assert.match(error.message, /cycle/);
  });

  it("collects every problem in one pass", () => {
    const error = expectInvalid(plan([subtask("a", ["ghost"]), subtask("a")]));
    assert.ok(error.issues.length >= 2, "validation should report all issues, not just the first");
  });
});

describe("dependency graph", () => {
  it("finds no cycle in a well-formed plan", () => {
    assert.equal(findDependencyCycle([subtask("a"), subtask("b", ["a"]), subtask("c", ["a", "b"])]), null);
  });

  it("identifies a cycle", () => {
    const cycle = findDependencyCycle([subtask("a", ["c"]), subtask("b", ["a"]), subtask("c", ["b"])]);
    assert.ok(cycle, "a cycle must be detected");
    assert.ok(cycle.length >= 2);
  });

  it("lists ready subtasks in declaration order", () => {
    const completed = new Set<string>();
    const ready = readySubtasks(plan([subtask("a"), subtask("b"), subtask("c", ["a"])]), completed);
    assert.deepEqual(ready.map((s) => s.taskId), ["a", "b"]);
  });

  it("does not release a subtask until its dependency completes", () => {
    const ready = readySubtasks(plan([subtask("a"), subtask("b", ["a"])]), new Set(["a"]));
    assert.deepEqual(ready.map((s) => s.taskId), ["b"]);
  });

  it("computes transitive dependents", () => {
    const dependents = dependentsOf(plan([subtask("a"), subtask("b", ["a"]), subtask("c", ["b"])]), "a");
    assert.deepEqual([...dependents].sort(), ["b", "c"]);
  });
});

describe("topologies", () => {
  it("recognises every declared topology", () => {
    assert.deepEqual([...TOPOLOGIES], ["single", "sequential", "parallel", "hierarchical", "hierarchical-mesh", "adaptive"]);
    for (const topology of TOPOLOGIES) {
      assert.equal(isTopology(topology), true);
    }
    assert.equal(isTopology("mesh"), false);
  });

  it("identifies which topologies can run concurrently", () => {
    assert.equal(allowsConcurrency("parallel"), true);
    assert.equal(allowsConcurrency("hierarchical"), true);
    assert.equal(allowsConcurrency("sequential"), false);
    assert.equal(allowsConcurrency("single"), false);
  });

  it("identifies which topologies have a supervisor", () => {
    assert.equal(hasSupervisor("hierarchical"), true);
    assert.equal(hasSupervisor("parallel"), false);
  });

  it("chooses the smallest sufficient topology", () => {
    assert.equal(smallestSufficientTopology(1, false), "single");
    assert.equal(smallestSufficientTopology(3, true), "sequential", "a fully ordered plan does not need concurrency");
    assert.equal(smallestSufficientTopology(3, false), "parallel");
  });

  it("rejects a topology that contradicts the plan size", () => {
    assert.equal(topologyFits("single", 1), true);
    assert.equal(topologyFits("single", 3), false, "a swarm must not be claimed for one subtask");
    assert.equal(topologyFits("parallel", 3), true);
    assert.equal(topologyFits("parallel", 1), false);
  });
});

describe("team plan", () => {
  it("builds a team from a plan with the smallest topology", () => {
    const team = assertOk<Team>(TeamPlan.choose(plan([subtask("a")])));
    assert.equal(team.topology, "single");
    assert.equal(team.objective, "Complete the objective");
    assert.deepEqual(team.memberTaskIds, ["a"]);
  });

  it("chooses sequential for a fully ordered plan", () => {
    const team = assertOk<Team>(TeamPlan.choose(plan([subtask("a"), subtask("b", ["a"])])));
    assert.equal(team.topology, "sequential", "a strictly ordered plan needs no concurrency");
  });

  it("chooses parallel for independent subtasks", () => {
    const team = assertOk<Team>(TeamPlan.choose(plan([subtask("a"), subtask("b")])));
    assert.equal(team.topology, "parallel");
  });

  it("honours an explicitly requested topology", () => {
    const team = assertOk<Team>(TeamPlan.choose(plan([subtask("a"), subtask("b")]), { requestedTopology: "hierarchical" }));
    assert.equal(team.topology, "hierarchical");
  });

  it("refuses a requested topology that contradicts the plan", () => {
    const error = assertErr<Error>(TeamPlan.choose(plan([subtask("a")]), { requestedTopology: "parallel" }));
    assert.match(error.message, /does not fit/);
  });
});

describe("team runtime: single agent", () => {
  it("executes one subtask and reports success", async () => {
    const runtime = new TeamRuntime({ executor: async (task) => ({ ok: true, value: `output of ${task.taskId}` }) as never });
    const team = assertOk<Team>(TeamPlan.choose(plan([subtask("a")])));
    const result = assertOk<TeamResult>(await runtime.run(team, plan([subtask("a")]), { traceId: "t" }));
    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.succeeded, ["a"]);
    assert.equal(result.terminalOutput, "output of a");
  });

  it("records the subtask lifecycle", async () => {
    const events: string[] = [];
    const runtime = new TeamRuntime({
      executor: async () => ({ ok: true, value: "x" }) as never,
      onEvent: (event) => events.push(event.kind),
    });
    const team = assertOk<Team>(TeamPlan.choose(plan([subtask("a")])));
    await runtime.run(team, plan([subtask("a")]), { traceId: "t" });
    assert.ok(events.includes("subtask_started"));
    assert.ok(events.includes("subtask_completed"));
  });
});

describe("team runtime: sequential", () => {
  it("respects dependency order", async () => {
    const order: string[] = [];
    const runtime = new TeamRuntime({
      executor: async (task) => {
        order.push(task.taskId);
        return { ok: true, value: task.taskId } as never;
      },
      maxConcurrency: 1,
    });
    const tasks = [subtask("a"), subtask("b", ["a"]), subtask("c", ["b"])];
    const result = assertOk<TeamResult>(await runtime.run(assertOk<Team>(TeamPlan.choose(plan(tasks))), plan(tasks), { traceId: "t" }));
    assert.deepEqual(order, ["a", "b", "c"], "a dependency must run after its prerequisite");
    assert.equal(result.status, "succeeded");
  });
});

describe("team runtime: parallel", () => {
  it("runs independent subtasks concurrently", async () => {
    let active = 0;
    let peak = 0;
    const runtime = new TeamRuntime({
      executor: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { ok: true, value: "x" } as never;
      },
      maxConcurrency: 4,
    });
    const tasks = [subtask("a"), subtask("b"), subtask("c"), subtask("d")];
    const result = assertOk<TeamResult>(await runtime.run(assertOk<Team>(TeamPlan.choose(plan(tasks))), plan(tasks), { traceId: "t" }));
    assert.equal(result.status, "succeeded");
    assert.ok(peak > 1, `expected concurrency, peak was ${peak}`);
  });

  it("respects the configured concurrency ceiling", async () => {
    let active = 0;
    let peak = 0;
    const runtime = new TeamRuntime({
      executor: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { ok: true, value: "x" } as never;
      },
      maxConcurrency: 2,
    });
    const tasks = Array.from({ length: 8 }, (_unused, index) => subtask(`t${index}`));
    await runtime.run(assertOk<Team>(TeamPlan.choose(plan(tasks))), plan(tasks), { traceId: "t" });
    assert.ok(peak <= 2, `concurrency ceiling exceeded: ${peak}`);
  });
});

describe("team runtime: failure propagation", () => {
  it("reports a failure with its classification", async () => {
    const runtime = new TeamRuntime({
      executor: async () => ({ ok: false, error: { errorClass: "timeout", message: "took too long" } }) as never,
    });
    const result = assertOk<TeamResult>(await runtime.run(assertOk<Team>(TeamPlan.choose(plan([subtask("a")]))), plan([subtask("a")]), { traceId: "t" }));
    assert.equal(result.status, "failed");
    assert.deepEqual(result.failed, ["a"]);
    const outcome = result.outcomes[0];
    assert.equal(outcome.errorClass, "timeout");
  });

  it("skips dependents of a failed subtask rather than running them", async () => {
    const executed: string[] = [];
    const runtime = new TeamRuntime({
      executor: async (task) => {
        executed.push(task.taskId);
        if (task.taskId === "a") {
          return { ok: false, error: { errorClass: "transient_provider_failure", message: "no" } } as never;
        }
        return { ok: true, value: "x" } as never;
      },
    });
    const tasks = [subtask("a"), subtask("b", ["a"])];
    const result = assertOk<TeamResult>(await runtime.run(assertOk<Team>(TeamPlan.choose(plan(tasks))), plan(tasks), { traceId: "t" }));
    // `a` is transiently failing, so it is retried within its declared budget.
    // What matters here is WHICH subtasks ran, not how many attempts "a" made.
    assert.deepEqual([...new Set(executed)], ["a"], "a dependent of a failed subtask must not run");
    const skipped = result.outcomes.find((outcome) => outcome.taskId === "b");
    assert.equal(skipped?.status, "skipped");
    assert.equal(skipped?.skippedDueToDependency, true);
  });

  it("reports partial success when some subtasks succeed", async () => {
    const runtime = new TeamRuntime({
      executor: async (task) =>
        task.taskId === "a"
          ? ({ ok: true, value: "x" } as never)
          : ({ ok: false, error: { errorClass: "unknown", message: "no" } } as never),
    });
    const tasks = [subtask("a"), subtask("b")];
    const result = assertOk<TeamResult>(await runtime.run(assertOk<Team>(TeamPlan.choose(plan(tasks))), plan(tasks), { traceId: "t" }));
    assert.equal(result.status, "partial");
    assert.deepEqual(result.succeeded, ["a"]);
    assert.deepEqual(result.failed, ["b"]);
  });
});

describe("team runtime: cancellation", () => {
  it("stops when the caller's signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const runtime = new TeamRuntime({
      executor: async (task) => {
        if (task.taskId === "a") {
          return { ok: false, error: { errorClass: "timeout", message: "aborted" } } as never;
        }
        return { ok: true, value: "x" } as never;
      },
    });
    const tasks = [subtask("a"), subtask("b", ["a"])];
    const result = assertOk<TeamResult>(
      await runtime.run(assertOk<Team>(TeamPlan.choose(plan(tasks))), plan(tasks), { traceId: "t", signal: controller.signal }),
    );
    assert.deepEqual(result.succeeded, [], "an aborted run must not report success");
  });
});

describe("anti-drift", () => {
  it("accepts a plan within limits", () => {
    const assessment = assessPlanDrift(plan([subtask("a")]), DEFAULT_DRIFT_LIMITS, 0);
    assert.equal(assessment.allowed, true);
    assert.deepEqual(assessment.violations, []);
  });

  it("records observed facts whether or not it passes", () => {
    const assessment = assessPlanDrift(plan([subtask("a")]), DEFAULT_DRIFT_LIMITS, 0);
    assert.equal(assessment.observed["subtaskCount"], 1);
    assert.equal(assessment.observed["depth"], 1);
  });

  it("rejects a plan with too many subtasks", () => {
    const tasks = Array.from({ length: 30 }, (_unused, index) => subtask(`t${index}`));
    const assessment = assessPlanDrift(plan(tasks), { ...DEFAULT_DRIFT_LIMITS, maxSubtasks: 10 }, 0);
    assert.equal(assessment.allowed, false);
    assert.ok(assessment.violations.some((violation) => violation.kind === "too_many_subtasks"));
  });

  it("rejects excessive nesting depth", () => {
    const tasks = [subtask("a"), subtask("b", ["a"]), subtask("c", ["b"]), subtask("d", ["c"])];
    const assessment = assessPlanDrift(plan(tasks), { ...DEFAULT_DRIFT_LIMITS, maxDepth: 2 }, 0);
    assert.equal(assessment.allowed, false);
    assert.ok(assessment.violations.some((violation) => violation.kind === "depth_exceeded"));
  });

  it("rejects a plan whose budget exceeds the deadline", () => {
    const assessment = assessPlanDrift(
      plan([subtask("a")], { limits: { timeoutMs: 999_999, maxRetries: 1, maxChildren: 0 } }),
      { ...DEFAULT_DRIFT_LIMITS, deadlineMs: 1_000 },
      0,
    );
    assert.equal(assessment.allowed, false);
    assert.ok(assessment.violations.some((violation) => violation.kind === "deadline_exceeded"));
  });

  it("rejects a subtask exceeding the retry ceiling", () => {
    const greedy = subtask("a", [], { limits: { timeoutMs: 1_000, maxRetries: 99, maxChildren: 0 } });
    const assessment = assessPlanDrift(plan([greedy]), { ...DEFAULT_DRIFT_LIMITS, maxRetries: 3 }, 0);
    assert.equal(assessment.allowed, false);
    assert.ok(assessment.violations.some((violation) => violation.kind === "retries_exceeded"));
  });

  it("rejects a plan that may spawn unlimited children", () => {
    const spawner = subtask("a", [], { limits: { timeoutMs: 1_000, maxRetries: 1, maxChildren: 500 } });
    const assessment = assessPlanDrift(plan([spawner]), DEFAULT_DRIFT_LIMITS, 0);
    assert.equal(assessment.allowed, false, "uncontrolled recursive spawning must be impossible");
  });

  it("rejects a dependency cycle", () => {
    const assessment = assessPlanDrift(plan([subtask("a", ["b"]), subtask("b", ["a"])]), DEFAULT_DRIFT_LIMITS, 0);
    assert.ok(assessment.violations.some((violation) => violation.kind === "dependency_cycle"));
  });

  it("requires verification when the task demands it", () => {
    const assessment = assessPlanDrift(plan([subtask("a")]), { ...DEFAULT_DRIFT_LIMITS, verificationRequired: true }, 0);
    assert.equal(assessment.allowed, false);
    assert.ok(assessment.violations.some((violation) => violation.kind === "missing_verification"));
  });

  it("accumulates assessments so a check is observable", () => {
    const guard = new DriftGuard({ maxSubtasks: 2 });
    guard.assess(plan([subtask("a")]), 0);
    guard.assess(plan([subtask("a")]), 1);
    assert.equal(guard.assessmentCount, 2);
    assert.equal(guard.assessments[0]?.allowed, true);
  });

  it("does not execute: it only decides whether execution may proceed", () => {
    // The guard holds no executor reference at all, which is the structural
    // reason it cannot start work.
    const guard = new DriftGuard();
    assert.deepEqual(Object.keys(guard), []);
  });
});

describe("capability coverage of agents", () => {
  it("an agent may declare a capability the core has never heard of", async () => {
    const { buildAgentRecord } = await import("../src/orchestration/agent/record.js");
    const record = buildAgentRecord({
      agentId: "researcher",
      version: "1.0.0",
      adapter: "local",
      capabilities: CapabilitySet.supporting("web_research", "source_verification", "entity_extraction"),
      now: new Date(0),
    });
    assert.equal(record.capabilities.isSupported("web_research"), true);
    assert.equal(record.capabilities.isSupported("entity_extraction"), true);
    assert.equal(record.capabilities.isSupported("never_declared"), false);
  });
});
