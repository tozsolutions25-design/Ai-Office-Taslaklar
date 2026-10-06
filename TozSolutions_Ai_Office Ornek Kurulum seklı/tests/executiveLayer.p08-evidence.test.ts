/**
 * PHASE 08 EVIDENCE - the executive layer's port cannot become a second orchestrator.
 *
 * ## WHY THESE ARE TYPE ASSERTIONS
 *
 * The brief is explicit that a future Jarvis sits ABOVE `TozOrchestrator` and must not be able
 * to advance task state, approve, govern, or execute. Those are claims about what a component
 * CANNOT do, and a component's capabilities are its type: there is no way to observe the
 * absence of a method from outside, so the absence has to be asserted against the declaration.
 *
 * `tests/agentAuthority.p08-evidence.test.ts` does the same thing one layer down, for the same
 * reason. Together they close the route from "an executive layer" to "a second orchestrator".
 *
 * ## WHAT IS DELIBERATELY NOT HERE
 *
 * No test asserts that a Jarvis implementation behaves correctly, because none exists in this
 * phase. Asserting behaviour of a component that is not built is how a phase ends up claiming
 * a capability it does not have - the defect class PHASE 07 and PHASE 08 have now found four
 * times (`ephemeral_content`, `duplicate_of_recent`, `DEFAULT_TRUST_REQUIREMENT`,
 * `grantUndeclaredTools`). What can be asserted now is the PORT, and that is what this file
 * does.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createExecutiveControl, executiveDescriptionOf, type ExecutiveControlPort } from "../src/orchestration/executive/index.js";

const ROOT = process.cwd();
const readSource = (relative: string): string => readFileSync(path.join(ROOT, relative), "utf8");

/** The declared body of `ExecutiveControlPort`. */
function portBody(): string {
  const source = readSource("src/orchestration/executive/index.ts");
  const match = /export interface ExecutiveControlPort \{([\s\S]*?)\n\}/.exec(source);
  assert.ok(match !== null, "ExecutiveControlPort must be findable");
  return match[1];
}

/** Method names declared on the port, ignoring comments and prose. */
function portMethods(): string[] {
  return [...portBody().matchAll(/^\s{2}(?:readonly\s+)?(\w+)\s*[(:]/gm)].map((m) => m[1]);
}

describe("PHASE 08 EVIDENCE - executive layer boundary", () => {
  it("offers exactly three capabilities, and no more", () => {
    // A port with a fifth method is a port with a fourth authority. The count is asserted
    // rather than a denylist, so a new member has to be added here deliberately - which is
    // the review moment the brief asks for.
    assert.deepEqual(portMethods().sort(), ["describe", "observe", "submit"]);
  });

  it("has no way to advance, cancel or transition a task", () => {
    const methods = portMethods();
    for (const forbidden of ["advance", "transition", "cancel", "setState", "complete", "fail", "settle", "retry"]) {
      assert.equal(
        methods.includes(forbidden),
        false,
        `the executive port must not expose "${forbidden}"; task state belongs to the orchestrator`,
      );
    }
    assert.doesNotMatch(portBody(), /OrchestrationTaskState|OrchestratorOptions/, "and it must not import the state type it cannot set");
  });

  it("has no way to decide or grant an approval", () => {
    const methods = portMethods();
    for (const forbidden of ["approve", "decideApproval", "grantApproval", "gate", "openGate"]) {
      assert.equal(methods.includes(forbidden), false, `the executive port must not expose "${forbidden}"`);
    }
    const source = readSource("src/orchestration/executive/index.ts");
    assert.doesNotMatch(
      source,
      /ApprovalRegistry|ApprovalGate|bridgeApproval|decideApproval/,
      "and it must not import the approval authority at all",
    );
  });

  it("has no way to authorize an operation", () => {
    const methods = portMethods();
    for (const forbidden of ["authorize", "narrow", "grant", "revoke", "permit"]) {
      assert.equal(methods.includes(forbidden), false, `the executive port must not expose "${forbidden}"`);
    }
    // "Holds" is the operative word: a governance TYPE would be a handle. The module may
    // NAME the governance authority - its description reports where governance lives, which is
    // the useful thing for an operator - but it must not import one. The first version of this
    // assertion matched the name anywhere in the file and failed on the string
    // `governance: "GovernanceGate"`, which is a report, not a dependency.
    const imports = [...readSource("src/orchestration/executive/index.ts").matchAll(/^import .*from ".*";$/gm)].map(
      (m) => m[0],
    );
    assert.deepEqual(imports, [
      'import type { Result } from "../../core/result.js";',
      'import type { OrchestrationRequest, OrchestrationResult } from "../authority.js";',
      'import type { WorkspaceRef } from "../workspace/workspace.js";',
    ]);
  });

  it("has no way to select an agent or reach an adapter", () => {
    const methods = portMethods();
    for (const forbidden of ["select", "execute", "invoke", "route", "plan", "dispatch"]) {
      assert.equal(methods.includes(forbidden), false, `the executive port must not expose "${forbidden}"`);
    }
    const source = readSource("src/orchestration/executive/index.ts");
    assert.doesNotMatch(
      source,
      /AgentAdapter|AdapterRegistry|SpecialistPool|ModelRouter|TeamRuntime/,
      "an executive layer must not be able to reach the execution path",
    );
  });

  it("reaches the orchestrator only through a submit that returns its own verdict", () => {
    // `submit` is the widest member, so its type is the thing that keeps it a request. It
    // returns `Result<OrchestrationResult, Error>`: the orchestrator's own outcome, which may
    // be a refusal. A signature returning `void`, or returning a shape the caller invents,
    // would be a way to fire and forget past governance.
    const body = portBody();
    assert.match(
      body,
      /submit\(request: OrchestrationRequest\): Promise<Result<OrchestrationResult, Error>>/,
      "submit must return the orchestrator's own result, refusals included",
    );
    assert.match(body, /describe\(\): ExecutiveDescription;/, "and the other two members must keep their narrow types");
    assert.match(body, /observe\(taskId: string\): ExecutiveTaskObservation \| null;/);
  });

  /* -- the one implementation is a forwarder, and says so -------------------- */

  it("builds an object with three properties and no state", () => {
    const seen: string[] = [];
    const control = createExecutiveControl({
      describeRuntime: () => executiveDescriptionOf({ workspace: null, governance: "enforced" }),
      observeTask: (taskId) => {
        seen.push(taskId);
        return { taskId, state: "created" };
      },
      submitToOrchestrator: () => Promise.resolve({ ok: false, error: new Error("not reached") }),
    });

    assert.deepEqual(Object.keys(control).sort(), ["describe", "observe", "submit"]);
    assert.equal(control.describe().executiveAuthority, "executive-observe-and-submit");
    assert.equal(control.observe("t1")?.state, "created");
    assert.deepEqual(seen, ["t1"], "observe is a read that the injected reader can see");
    // And the returned object carries no reference to any authority, so there is nothing on
    // it to reach past the three functions with.
    const members = Object.values(control);
    for (const member of members) {
      assert.equal(typeof member, "function", "every member must be a function, not a handle");
    }
  });

  it("names one authority per job, so a reader can see there is not a second one", () => {
    // The description is the artifact an operator reads when asking "who is in charge here".
    //
    // The first version of this test asserted every role names a DISTINCT authority, and
    // failed - correctly. `ExecutionCoordinator` legitimately holds TWO jobs: workflow state
    // and approvals. One component answering two questions is the design; two components
    // answering one question is the defect PHASE 07 and PHASE 08 have been chasing.
    //
    // So the invariant is: exactly one role is the agent-execution authority, no other role
    // claims it, and the executive role claims nothing at all.
    const description = executiveDescriptionOf({ workspace: null, governance: "enforced" });
    const entries = Object.entries(description.authorities);
    const claimingExecution = entries.filter(([, authority]) => authority === "TozOrchestrator");
    assert.deepEqual(
      claimingExecution.map(([role]) => role),
      ["agentExecution"],
      "exactly one role may be the agent-execution authority",
    );
    assert.equal(description.authorities["workflowState"], "ExecutionCoordinator");
    assert.equal(description.authorities["approvals"], "ExecutionCoordinator", "one authority may hold two jobs");
    assert.equal(description.authorities["executive"], "observe-and-submit only", "and the executive role claims no authority");
    assert.equal(new Set(entries.map(([, a]) => a)).size, 5, "five distinct authorities for six roles");
  });

  it("reports its own capability as a literal, so describe() cannot overclaim", () => {
    // `executiveAuthority` is a literal type rather than a free string. A later phase that
    // ships a real implementation changes the constant, and that change shows up in a diff
    // instead of in a runtime string nobody diffs.
    const source = readSource("src/orchestration/executive/index.ts");
    assert.match(
      source,
      /readonly executiveAuthority: "executive-observe-and-submit";/,
      "the reported capability must be a closed literal",
    );
    const control: ExecutiveControlPort = createExecutiveControl({
      describeRuntime: () => executiveDescriptionOf({ workspace: null, governance: "advisory" }),
      observeTask: () => null,
      submitToOrchestrator: () => Promise.resolve({ ok: false, error: new Error("unused") }),
    });
    assert.equal(control.describe().governance, "advisory", "the runtime's own report is passed through verbatim");
  });
});
