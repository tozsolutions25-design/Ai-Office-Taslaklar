/**
 * PHASE 08 EVIDENCE - who is allowed to sequence work.
 *
 * ## WHY THIS FILE EXISTS
 *
 * `authority.ts` has claimed since PHASE 04 that `TozOrchestrator` is "the single
 * authority that sequences work", and `TODO.md` PHASE 08 item 2 asked for that claim to be
 * "structural and tested". It was neither: it was a comment, and nothing asserted it.
 *
 * The audit that preceded this file found the comment was ALSO imprecise, in the
 * conservative direction. `ExecutionCoordinator` is a second, fully-enforced state machine
 * that creates jobs, transitions tasks, opens approval gates and settles results - so
 * "the only place a task advances" was false as written even though the underlying
 * architecture is sound. The fix is not to merge the two authorities (that would be the
 * rewrite `MASTER_PLAN.md` 4 forbids) and not to weaken the claim until it is true. It is
 * to state what each one owns precisely, and prove the boundary from source.
 *
 * ## WHY THESE ARE SOURCE ASSERTIONS
 *
 * A "nothing else can do this" claim is not observable from outside the system: a caller
 * cannot reach in and try to invoke an adapter a second way, because the second way does
 * not exist. The only way to assert the ABSENCE of a competing path is to read the source
 * and count the paths that exist. `workspaceRegistryBoundaries.p06-evidence.test.ts`
 * established the pattern for exactly this; this file uses it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** Every production source file. `tests/` is excluded: a test is not a competing authority. */
const SRC_FILES: readonly string[] = (() => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".ts")) found.push(full);
    }
  };
  walk(path.join(ROOT, "src"));
  return found;
})();

function readSource(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

/**
 * Every production line matching `pattern`, with its file and line number.
 *
 * Comment lines are dropped, because this repository argues in its comments: a comment
 * that NAMES a forbidden call is not a call, and counting it would make the assertion
 * below pass or fail for a reason that has nothing to do with the architecture.
 */
function productionCallSites(pattern: RegExp): readonly { file: string; line: number; text: string }[] {
  const hits: { file: string; line: number; text: string }[] = [];
  for (const file of SRC_FILES) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, index) => {
      const trimmed = text.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      pattern.lastIndex = 0;
      if (pattern.test(trimmed)) {
        hits.push({ file: path.relative(ROOT, file).replace(/\\/g, "/"), line: index + 1, text: trimmed });
      }
    });
  }
  return hits;
}

describe("PHASE 08 EVIDENCE - execution authority boundaries", () => {
  /* -- the agent-execution authority is unique ------------------------------- */

  it("is the only production site that invokes an agent adapter", () => {
    // `AgentAdapter.execute` is the moment work leaves the process. If a second component
    // could call it, then two components each believe they decide what runs - which is
    // the failure mode `authority.ts` opens by warning about, and the reason this file
    // exists at all.
    const sites = productionCallSites(/\badapter\.execute\(/);
    assert.equal(sites.length, 1, `expected exactly one adapter invocation, got ${JSON.stringify(sites)}`);
    assert.equal(sites[0].file, "src/orchestration/authority.ts", "and it must be the orchestrator");
  });

  it("is the only production site that selects an agent", () => {
    const sites = productionCallSites(/\bpool\.select\(/);
    assert.equal(sites.length, 1, `expected exactly one agent selection, got ${JSON.stringify(sites)}`);
    assert.equal(sites[0].file, "src/orchestration/authority.ts");
  });

  it("is the only production site that runs a subtask wave", () => {
    // `TeamRuntime` is the swarm-shaped scheduler. A second call site would mean a second
    // place that decides the order and concurrency of subtasks.
    const sites = productionCallSites(/\bruntime\.run\(team\b|\bteam\.run\(/);
    assert.equal(sites.length, 1, `expected exactly one team run, got ${JSON.stringify(sites)}`);
    assert.equal(sites[0].file, "src/orchestration/authority.ts");
  });

  it("is the only production site that transitions an agent's lifecycle", () => {
    // Lifecycle promotion is a trust decision. `AgentIngestor` is the one place that makes
    // it, and it is gated on an explicit `promoteToAvailable`. If the orchestrator could
    // also promote, an agent would be able to earn availability by being chosen.
    const sites = productionCallSites(/\bagents\.transition\(/);
    assert.equal(sites.length, 1, `expected exactly one lifecycle transition, got ${JSON.stringify(sites)}`);
    assert.equal(sites[0].file, "src/orchestration/agentsource/ingest.ts", "ingestion is a trust decision, not a scheduling one");
  });

  /* -- the job-state authority is separate, and is never self-driven ----------- */

  it("holds no approval gate of its own, and cannot decide one", () => {
    const sites = productionCallSites(/\.decideApproval\(/);
    assert.deepEqual(sites, [], `only the coordinator may decide an approval; found ${JSON.stringify(sites)}`);
    const source = readSource("src/orchestration/workflow/coordinator.ts");
    assert.match(source, /public decideApproval\(/, "and the coordinator is where it lives");
  });

  it("cannot be a competing production sequencer, because nothing outside src/ drives a job", () => {
    // This is the half of the original claim that was FALSE, and the half that matters for
    // "can two components each believe they decide what runs".
    //
    // `ExecutionCoordinator` does hold a second state machine - it creates jobs,
    // transitions tasks, opens gates and settles results. But no production component
    // calls the workflow-level API: `createJob`, `runJob`, `cancelJob`, `planRelease` and
    // `settle` are reached only by tests and by whoever owns the job at runtime, and the
    // coordinator states it does not re-drive itself. So it cannot race the orchestrator
    // for control of an execution - it is a library authority, not a rival.
    //
    // The coordinator's OWN internal calls are excluded, and had to be: `runJob` calls
    // `this.planRelease` twice. Asserting "zero call sites" instead of "zero EXTERNAL call
    // sites" produced a failing test that was wrong about the architecture - the first
    // draft of this assertion did exactly that.
    const COORDINATOR = "src/orchestration/workflow/coordinator.ts";
    for (const method of ["createJob", "runJob", "cancelJob", "planRelease", "settle"]) {
      const external = productionCallSites(new RegExp(`\\.${method}\\(`)).filter((site) => site.file !== COORDINATOR);
      assert.deepEqual(
        external,
        [],
        `no production component may drive a job through ${method}(); found ${JSON.stringify(external)}`,
      );
    }
    assert.match(
      readSource(COORDINATOR),
      /this coordinator does not re-drive its own work/,
      "the coordinator must state that it does not drive itself",
    );
  });

  it("routes a coordinator-driven task back through the orchestrator, not around it", () => {
    // The two authorities are layered, not parallel. When the coordinator does execute a
    // task it goes through `TaskExecutionPort`, whose only production implementation
    // forwards to `orchestrator.execute` - so "who runs the agent" has one answer even
    // when a job is driving.
    const source = readSource("src/orchestration/workflow/coordinator.ts");
    assert.match(source, /TaskExecutionPort/, "the coordinator must reach execution only through the port");
    const bridge = readSource("src/orchestration/composition.ts");
    assert.match(bridge, /orchestrator\.execute\(|\.execute\(request\)/, "the bridge must forward to the orchestrator");
  });

  /* -- the claim is now stated accurately ------------------------------------- */

  it("states its authority as the agent-execution authority, not as the only state machine", () => {
    // A comment that overstates an architecture is the defect this phase found. Asserting
    // the wording keeps it from creeping back: the header may claim to be the only place
    // that SELECTS, RUNS and ROUTES agent work, and may not claim to be the only place a
    // task state changes - because the coordinator's gate decisions change task state.
    const header = readSource("src/orchestration/authority.ts").slice(0, 2600);
    assert.doesNotMatch(
      header,
      /the single authority that sequences work|the only place a task advances/i,
      "the header must not claim to be the sole state machine; ExecutionCoordinator holds job and task state",
    );
    assert.match(header, /agent-execution authority|selects, runs and routes/i, "and it must state the authority it does hold");
  });
});
