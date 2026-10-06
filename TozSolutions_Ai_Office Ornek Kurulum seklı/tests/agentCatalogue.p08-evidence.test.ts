/**
 * PHASE 08 EVIDENCE - the agent roster is a declaration, and says so.
 *
 * ## WHAT IS BEING ASSERTED
 *
 * `MASTER_PLAN.md` 5 asks for five MVP agents and a production core of ten. `TODO.md` PHASE 08
 * item 1 asks for them to be added, and the audit found the catalogue was empty - not one
 * `agentId` literal anywhere in `src/`.
 *
 * Adding a roster creates a specific hazard: nine new records that LOOK available. A reader
 * glancing at a registry listing would reasonably conclude the system can run these roles,
 * and the honest position - that these are declarations reviewed before use, none of them
 * executable, none of them selected - is invisible in a record dump. So the properties that
 * make them honest are asserted here rather than left to the header comment.
 *
 * The most important of them is the one about Hermes: the plan lists it as MVP agent 1, and
 * it is deliberately absent, because in this repository that role is held structurally by
 * `TozOrchestrator`. Registering it would create a second component the pool could select -
 * an authority that a trust floor could reject and an operator could disable.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { createRuntime } from "../src/orchestration/composition.js";
import {
  CATALOGUE_ADAPTER,
  MVP_AGENT_CATALOGUE,
  PRODUCTION_CORE_AGENT_CATALOGUE,
  catalogueEntryToRecordInput,
  fullCatalogue,
} from "../src/orchestration/agent/catalogue.js";
import { allowedAgentTransitions, canTransitionAgent } from "../src/orchestration/agent/registry.js";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";
import { assertOk } from "./contracts/contracts.js";
import type { RegisteredAgent } from "../src/orchestration/agent/registry.js";

const NOW = new Date("2026-04-01T00:00:00.000Z");

describe("PHASE 08 EVIDENCE - the agent catalogue", () => {
  /* -- the roster ------------------------------------------------------------ */

  it("carries the MVP four and the production core five", () => {
    // Four, not five, and five, not ten - see the next test for why the arithmetic differs
    // from the plan's.
    assert.equal(MVP_AGENT_CATALOGUE.length, 4);
    assert.equal(PRODUCTION_CORE_AGENT_CATALOGUE.length, 5);
    assert.equal(fullCatalogue().length, 9);
    for (const entry of fullCatalogue()) {
      assert.match(entry.agentId, /^[A-Za-z0-9._-]{1,128}$/, `${entry.agentId} must be a valid agent id`);
      assert.ok(entry.summary.length > 40, `${entry.agentId} must state what the role is for`);
    }
  });

  it("does not contain Hermes, because the orchestrator is Hermes", () => {
    // The plan's MVP agent 1 is "Hermes Coordinator - the single orchestration authority".
    // Here that role is `TozOrchestrator`, which is not an `AgentRecord`.
    //
    // An agent record for it would be selectable by the pool, subject to a trust floor, and
    // disableable by an operator - so the system's single orchestration authority would be
    // something the agent registry could switch off. That is not an authority, it is a
    // participant. Asserted rather than left to a comment because the plan will keep asking
    // for this entry to be added.
    for (const entry of fullCatalogue()) {
      assert.doesNotMatch(entry.agentId, /hermes|coordinator|orchestrat/i, `${entry.agentId} must not claim the orchestrator role`);
      assert.doesNotMatch(entry.role, /coordinat|orchestrat/i, `${entry.agentId} must not claim the orchestrator role`);
    }
  });

  it("gives no agent record the vocabulary to hold an approval", () => {
    // The first draft of this assertion scanned the catalogue's prose for words like
    // "decide" and "grant", and failed - correctly. The briefing officer's summary says
    // "Holds NO approval authority", which is the most important sentence in the file, and a
    // keyword scan cannot tell a disclaimer from a claim.
    //
    // So this checks the thing that actually decides it: no agent record can CARRY an
    // approval, because the type has no field for one and the adapter port has no method.
    // Prose is documentation; the type is the boundary.
    const recordInput = readFileSync(
      path.join(process.cwd(), "src/orchestration/agent/record.ts"),
      "utf8",
    );
    const input = /export interface AgentRecordInput \{([\s\S]*?)\n\}/.exec(recordInput);
    assert.ok(input !== null, "AgentRecordInput must be findable");
    assert.doesNotMatch(
      input[1],
      /approve|approval|gate|decide|grant/i,
      "an agent record must have no field that could carry an approval authority",
    );

    const adapter = readFileSync(
      path.join(process.cwd(), "src/orchestration/agent/adapter.ts"),
      "utf8",
    );
    const port = /export interface AgentAdapter \{([\s\S]*?)\n\}/.exec(adapter);
    assert.ok(port !== null, "AgentAdapter must be findable");
    assert.doesNotMatch(port[1], /approve|approval|gate|decide/i, "and no adapter method may decide one");
  });

  it("keeps every role's memory reach inside what a task-scoped actor holds", () => {
    // An agent declaring `organization` or `global` memory would be refused at selection
    // for any operator who was not granted those scopes - correct behaviour, but it means the
    // roster would ship nine agents that cannot be selected by anyone. Every entry below is
    // therefore `task`-reachable, and widening one is a deliberate act with a consequence.
    for (const entry of fullCatalogue()) {
      assert.ok(
        entry.memoryScopes.includes("task"),
        `${entry.agentId} must be usable by a task-scoped operator; got ${JSON.stringify(entry.memoryScopes)}`,
      );
      assert.equal(
        entry.memoryScopes.includes("global"),
        false,
        `${entry.agentId} must not claim installation-wide memory; the partition and the ceiling both forbid it`,
      );
    }
  });

  /* -- the records are declarations, not running agents ---------------------- */

  it("registers every entry DISABLED and unpromoted", () => {
    const runtime = createRuntime({ clock: new ManualClock(NOW), workspace: workspaceRef("catalogue") });
    for (const entry of fullCatalogue()) {
      const input = catalogueEntryToRecordInput(entry);
      const registered = assertOk<RegisteredAgent>(runtime.agents.register(input), `${entry.agentId} registration`);
      runtime.capabilities.index(registered.record);
    }

    for (const entry of fullCatalogue()) {
      const record = assertOk<RegisteredAgent>(runtime.agents.require(entry.agentId, "1.0.0"), `${entry.agentId} lookup`);
      assert.equal(record.record.status, "disabled", `${entry.agentId} must register disabled`);
      assert.equal(record.lifecycle, "discovered", `${entry.agentId} must arrive unpromoted`);
      // And the promotion edge exists but is not taken: `discovered` cannot reach
      // `available` in one step, so nothing in this file promoted anything.
      assert.equal(
        allowedAgentTransitions(record.lifecycle).includes("available"),
        false,
        `${entry.agentId} must not be one promotion away from selectable`,
      );
      assert.equal(canTransitionAgent(record.lifecycle, "available"), false);
    }
  });

  it("selects none of them, so the roster cannot be mistaken for a working fleet", () => {
    const runtime = createRuntime({ clock: new ManualClock(NOW), workspace: workspaceRef("catalogue") });
    for (const entry of fullCatalogue()) {
      const registered = assertOk<RegisteredAgent>(
        runtime.agents.register(catalogueEntryToRecordInput(entry)),
        `${entry.agentId} registration`,
      );
      runtime.capabilities.index(registered.record);
    }

    const decision = runtime.pool.select(
      { taskId: "t1", requiredCapabilities: [], minimumTrust: "low" },
      { providerIds: () => [], availableTools: () => [], grantedMemoryScopes: () => ["task"] },
    );
    assert.equal(decision.selectedAgent, null, "no catalogue agent may be selectable while disabled");
    assert.equal(decision.selected.length, 0);
    assert.ok(
      decision.rejected.every((candidate) => candidate.rejections.includes("not_available")),
      `every rejection must be the lifecycle gate, got ${JSON.stringify(decision.rejected.map((c) => c.rejections))}`,
    );
  });

  it("names the honest adapter, so a promoted catalogue agent fails with a configuration error", () => {
    // Phase 05 ships `UnavailableAgentAdapter` rather than a fake success. The roster uses it,
    // so promoting an entry produces a refusal that NAMES what is missing rather than a
    // fabricated result. This asserts the wiring, not the adapter's behaviour.
    for (const entry of fullCatalogue()) {
      assert.equal(
        catalogueEntryToRecordInput(entry).adapter,
        CATALOGUE_ADAPTER,
        `${entry.agentId} must name the catalogue adapter`,
      );
    }
    const runtime = createRuntime({ clock: new ManualClock(NOW), workspace: workspaceRef("catalogue") });
    assert.equal(runtime.describe().agentAdapters.includes(CATALOGUE_ADAPTER), true, "and that adapter must be what a bare runtime composes");
  });

  it("records the role and the summary as metadata rather than as behaviour", () => {
    // `summary` is documentation. It must not be able to influence selection, so it lives in
    // metadata - which the pool never reads - rather than in a field something might match on.
    for (const entry of fullCatalogue()) {
      const record = catalogueEntryToRecordInput(entry);
      assert.equal(record.metadata?.["role"], entry.role);
      assert.equal(record.metadata?.["summary"], entry.summary);
      assert.equal(record.metadata?.["catalogue"], "toz-agent-catalogue");
    }
  });
});
