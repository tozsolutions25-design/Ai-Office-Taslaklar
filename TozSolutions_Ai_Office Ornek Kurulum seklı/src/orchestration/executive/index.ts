/**
 * The executive layer's port - the extension point a future Jarvis would occupy.
 *
 * ## WHY THIS EXISTS IN PHASE 08
 *
 * The brief asks for an Executive Control Layer ABOVE `TozOrchestrator`, and for its
 * architectural extension points to be built now while the real implementation is left to a
 * later phase. This file is those extension points, and nothing more.
 *
 * What follows from "above" is the whole design. A component above the orchestrator can
 * observe it and ask it to do things. It cannot do the orchestrator's work for it, because a
 * component that can is a second orchestrator - the failure `authority.ts` opens the file by
 * warning about, and the one `TODO.md` PHASE 08 item 2 asked to be made structural.
 *
 * ## WHAT THIS PORT CANNOT DO, AND WHY THAT IS STRUCTURAL
 *
 * The port has exactly three members: describe, observe, submit. There is no method to
 *
 *   - advance or cancel a task            -> task state belongs to the orchestrator
 *   - decide or grant an approval         -> the gate belongs to the coordinator
 *   - authorize an operation              -> governance belongs to the gate
 *   - select an agent or invoke an adapter -> execution belongs to the orchestrator
 *   - grant or revoke memory access       -> grants belong to the memory authority
 *
 * None of those is a convention this file asks a future implementation to respect. They are
 * MISSING CAPABILITIES: an implementor of this interface has no vocabulary for them, so
 * `tests/executiveLayer.p08-evidence.test.ts` asserts the absence from the TYPE, which is the
 * only place an absence can be enforced.
 *
 * That is the same rule `OrchestratorGovernancePort` already states for governance - "what it
 * may not do is not a convention but a MISSING CAPABILITY, because the port has no method for
 * it" - applied one layer up.
 *
 * ## SUBMIT IS NOT A BACK DOOR
 *
 * `submit` looks like the widest thing here, so it is worth being precise: it hands an
 * `OrchestrationRequest` to the existing authority and returns the orchestrator's own result.
 * Every check the orchestrator performs still happens - identity, grants, governance,
 * approval, capability, tool authority. An executive layer cannot use it to skip a step,
 * because it does not perform the steps; it requests them.
 */

import type { Result } from "../../core/result.js";
import type { OrchestrationRequest, OrchestrationResult } from "../authority.js";
import type { WorkspaceRef } from "../workspace/workspace.js";

/** What a caller can be told about the system before asking it to do anything. */
export interface ExecutiveDescription {
  /** Which authorities exist, so an operator can see there is exactly one of each. */
  readonly authorities: Readonly<Record<string, string>>;
  /** The workspace this runtime acts in, or `null` when none was declared. */
  readonly workspace: string | null;
  /** What the deployment reports about itself, verbatim. */
  readonly governance: "enforced" | "advisory";
  /**
   * Always `"executive-observe-and-submit"` in this phase.
   *
   * A literal rather than a configurable value, so `describe()` cannot be used to claim a
   * capability this build does not have. A later phase that ships a real implementation
   * changes this constant, and the change is visible in the diff.
   */
  readonly executiveAuthority: "executive-observe-and-submit";
}

/** One task's state, as the orchestrator reports it. Read-only by construction. */
export interface ExecutiveTaskObservation {
  readonly taskId: string;
  readonly state: string;
  readonly outcome?: string | null;
  readonly errorClass?: string | null;
}

/**
 * The port.
 *
 * Three members, and the absence of a fourth is the point of the file. See the header.
 */
export interface ExecutiveControlPort {
  /** What the system is and can do. No side effects. */
  describe(): ExecutiveDescription;

  /**
   * Reads task state.
   *
   * Returns a snapshot, never a handle: there is nothing to call on the result, so an
   * observer cannot become a writer by keeping it.
   */
  observe(taskId: string): ExecutiveTaskObservation | null;

  /**
   * Asks the existing authority to do a task.
   *
   * This is the ONLY way an executive layer causes work, and it is a request rather than a
   * command: the result is whatever the orchestrator decided, including a refusal.
   */
  submit(request: OrchestrationRequest): Promise<Result<OrchestrationResult, Error>>;
}

/**
 * The one implementation: a forwarder.
 *
 * It holds no state, decides nothing, and has no field it could use to reach past the
 * orchestrator. If a future executive layer needs to cancel a task, add a method to a
 * DIFFERENT port that the orchestrator implements - do not add one here, because here is
 * where "the executive layer may do anything the orchestrator can" would start.
 */
export interface ExecutiveControlDependencies {
  readonly describeRuntime: () => ExecutiveDescription;
  readonly observeTask: (taskId: string) => ExecutiveTaskObservation | null;
  readonly submitToOrchestrator: (request: OrchestrationRequest) => Promise<Result<OrchestrationResult, Error>>;
}

/**
 * Builds the port over three injected capabilities.
 *
 * Exported as a factory rather than a class so that the absence of extra members is visible:
 * the returned object literal has three properties and the compiler rejects a fourth.
 */
export function createExecutiveControl(deps: ExecutiveControlDependencies): ExecutiveControlPort {
  return {
    describe: () => deps.describeRuntime(),
    observe: (taskId: string) => deps.observeTask(taskId),
    submit: (request: OrchestrationRequest) => deps.submitToOrchestrator(request),
  };
}

/**
 * The description a runtime without a real executive layer reports.
 *
 * `authorities` names where each authority lives, which is the useful thing for an operator:
 * it shows there is one agent-execution authority and one approval authority, not several.
 */
export function executiveDescriptionOf(input: {
  readonly workspace: WorkspaceRef | null;
  readonly governance: "enforced" | "advisory";
}): ExecutiveDescription {
  return {
    authorities: {
      agentExecution: "TozOrchestrator",
      workflowState: "ExecutionCoordinator",
      approvals: "ExecutionCoordinator",
      governance: "GovernanceGate",
      memoryAccess: "MemoryAccessPolicy",
      executive: "observe-and-submit only",
    },
    workspace: input.workspace === null ? null : input.workspace.workspace,
    governance: input.governance,
    executiveAuthority: "executive-observe-and-submit",
  };
}
