/**
 * Execution topologies.
 *
 * A topology is how subtasks are arranged relative to each other. It is a
 * DECLARATIVE value, not a runtime: `TeamRuntime` interprets it, so adding a new
 * topology later does not change `ExecutionPlan`.
 *
 * `single` exists for a reason beyond convenience: a task one capable agent can
 * finish MUST NOT be given a swarm. Topology selection is therefore policy, not
 * preference, and the pool records the topology it chose so the decision is
 * auditable.
 */

export const TOPOLOGIES = [
  "single",
  "sequential",
  "parallel",
  "hierarchical",
  "hierarchical-mesh",
  "adaptive",
] as const;

export type Topology = (typeof TOPOLOGIES)[number];

export function isTopology(value: unknown): value is Topology {
  return typeof value === "string" && (TOPOLOGIES as readonly string[]).includes(value);
}

/** Topologies that can run subtasks at the same time. */
export function allowsConcurrency(topology: Topology): boolean {
  return topology === "parallel" || topology === "hierarchical" || topology === "hierarchical-mesh" || topology === "adaptive";
}

/** Topologies in which one subtask supervises others. */
export function hasSupervisor(topology: Topology): boolean {
  return topology === "hierarchical" || topology === "hierarchical-mesh" || topology === "adaptive";
}

/**
 * The smallest topology that can express a plan.
 *
 * PHASE 04 requires the smallest sufficient topology: a swarm is a cost in
 * tokens, latency and failure surface, so a plan that one agent can execute is
 * never given several.
 *
 * `single` for one subtask, `sequential` when subtasks are strictly ordered,
 * `parallel` when they are independent. The hierarchical shapes are only
 * reached when a caller asks for them explicitly, because choosing a hierarchy
 * unprompted is the drift this guards against.
 */
export function smallestSufficientTopology(subtaskCount: number, isFullyOrdered: boolean): Topology {
  if (subtaskCount <= 1) {
    return "single";
  }
  if (isFullyOrdered) {
    return "sequential";
  }
  return "parallel";
}

/**
 * Validates that a topology is appropriate for a plan.
 *
 * `single` with several subtasks is a contradiction, and catching it here means
 * an inconsistent plan is rejected before execution rather than half-run.
 */
export function topologyFits(topology: Topology, subtaskCount: number): boolean {
  if (topology === "single") {
    return subtaskCount <= 1;
  }
  return subtaskCount >= 2;
}
