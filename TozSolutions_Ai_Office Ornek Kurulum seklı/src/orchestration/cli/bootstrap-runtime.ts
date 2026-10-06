#!/usr/bin/env node
/**
 * PHASE 02: boot the runtime and report what it is.
 *
 * WHY THIS EXISTS
 *
 * Phase 00's central finding was not that the components were wrong. It was that
 * **nothing assembled them**: `TozOrchestrator` had never been constructed in
 * `src/`, so the governance that was written had never once been in front of a real
 * request. Every one of the four authorization defects was reachable through the
 * library API and through no shipped binary, and that is precisely why 1,598 green
 * tests did not catch any of them.
 *
 * This is the smallest entry point that makes the composition root demonstrably
 * runnable OUTSIDE a test harness. It reads the real process environment, builds
 * the real graph, and prints the runtime's own measured description.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It executes no work, opens no socket, writes no file and installs no agent. It is
 * a BOOT CHECK, not a server. Anyone reading its output learns what the runtime is
 * and - more importantly - what it is not: no provider adapter, no agent backend,
 * no identity resolver, no durable state, no tenancy, and therefore no ability to
 * execute anything. A system that prints those absences is a system that cannot be
 * mistaken for one that is finished.
 *
 * Exit codes: 0 = booted, 1 = configuration rejected, 2 = it could not be built.
 */

import { bootstrapRuntime } from "../composition.js";

// PHASE 05: async, because the boot check now ASKS each adapter whether it can run
// rather than printing its registered name. Synchronous structure and behavioural
// availability are different questions, and the second one needs an await.
async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help")) {
    console.log("Usage: bootstrap-runtime [--json]");
    console.log("  Boots the runtime from this process's environment and prints what it composed.");
    console.log("  --json  emit the measurement as JSON instead of text");
    return 0;
  }

  const booted = bootstrapRuntime();
  if (!booted.ok) {
    // Named fields, no values: the same rule `validate-config` follows, so running
    // this in a pipeline cannot leak a secret through an error message.
    console.error(`Runtime: NOT STARTED (${booted.error.issues.length} configuration issue(s))`);
    for (const issue of booted.error.issues) {
      console.error(`  - ${issue.field}: ${issue.message}`);
    }
    return 1;
  }

  const runtime = booted.value;
  const description = runtime.describe();
  // PHASE 05. Availability is asked, not read off a name. `describe()` is
  // synchronous structure; whether an adapter can run RIGHT NOW needs the adapter to
  // answer, so the boot check awaits it. Printing the registered name where a reader
  // reads an availability is how `agent adapters  unavailable` came to be a
  // coincidence rather than a measurement.
  const probe = await runtime.probe();

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ ...description, probe }, null, 2));
    return 0;
  }

  console.log("Runtime: STARTED");
  console.log("");
  console.log("  AUTHORIZATION");
  console.log(`    governance                 ${description.governance}${description.governanceOnExecutionPath ? " (on the execution path)" : " (ADVISORY - a denial does not stop work)"}`);
  console.log(`    rules                      ${description.governanceRules.join(", ")}`);
  console.log(`    identity resolver          ${description.identityResolver}${description.identityResolver === "absent" ? " (every run is refused: no actor is guessed)" : ""}`);
  console.log(`    background service identity ${description.serviceContext}`);
  console.log(`    workflow execution         ${description.workflowExecution}`);
  // PHASE 03: whether a governance-configured approval is ANSWERABLE in this
  // process. Printed next to the rules rather than in "what this build is not",
  // because it is a capability a deployment can rely on - and because the honest
  // answer is only interesting if it is stated rather than assumed.
  console.log(
    `    configured approvals       ${description.approvalBridge === "wired" ? "answerable" : "REQUIRE APPROVAL BUT NOTHING CAN ANSWER"} (authority: ${description.approvalAuthority})`,
  );
  // PHASE 04. Two facts a deployer cannot otherwise read, and both are boundaries
  // rather than features. The re-drive owner is an ownership contract, and the
  // durability of an approval record is the difference between "a human approved
  // this" and "a human approved this until the process exits".
  console.log(`    approval re-drive          ${description.approvalRedrive} (the caller that owns a job calls runJob)`);
  console.log(
    `    classified as needing one ${description.humanApprovalOperations.length}, configured to need one ${description.approvalRequiredOperations.length}`,
  );
  console.log("");
  console.log("  EXECUTION");
  console.log(`    agents                     ${description.agents}`);
  // PHASE 10: the knowledge layer's state, and specifically whether anything consults it.
  // A provider can be attached without any run ever querying it, and a deployer reading a
  // boot report has no other way to learn that.
  console.log(`    knowledge                  ${description.knowledge}`);
  // PHASE 09: reported with its authority, not just its count. A bare number would leave an
  // operator guessing whether installing a skill granted anything.
  console.log(`    skills                     ${description.skills} (${description.skillAuthority}: a skill declares what a caller must already hold)`);
  console.log(
    `    agent adapters             ${
      probe.agentAdapterAvailability.length === 0
        ? "none"
        : probe.agentAdapterAvailability
            .map((entry) => `${entry.name} (${entry.available ? "available" : "NOT available"})`)
            .join(", ")
    }`,
  );
  console.log(`    providers                  ${description.providers}`);
  console.log(`    models                     ${description.models}`);
  console.log(`    provider adapters          ${description.providerAdapters}${description.providerAdapters === 0 ? " (no provider is integrated in this repository)" : ""}`);
  console.log(`    verifiers                  ${description.verifiers.join(", ") || "none"}`);
  console.log(`    primary selection order    ${description.selectionOrder}`);
  console.log(`    fallback chain policy      ${description.fallbackPolicy}`);
  console.log(`    input / output policy      ${description.inputPolicy} / ${description.outputPolicy}`);
  console.log("");
  console.log("  TOOLS");
  console.log(`    registered                 ${description.tools}`);
  console.log(`    invokers                   ${description.toolInvokers}${description.toolInvokers === 0 ? " (a registered tool with no invoker cannot run)" : ""}`);
  // PHASE 05. Two tool-boundary facts that were invisible rather than absent, and an
  // operator cannot reason about a tool boundary that reports neither.
  console.log(
    `    side-effect approval        ${
      description.toolApproval === "available"
        ? "a flow issues it"
        : "REQUIRED and unobtained (an irreversible tool call is refused)"
    }`,
  );
  console.log(
    `    agency adapter             ${
      description.agencyAdapterComposed ? "composed" : "not composed (Agency is a capability source, not a runtime authority)"
    }`,
  );
  console.log("    MCP client                 none (no such capability exists; a stub shaped like one would be a fabrication)");
  console.log(`    per-call ceiling           ${description.toolTimeoutMs}ms`);
  console.log("");
  console.log("  MEMORY");
  console.log(`    backend                    ${description.memory}`);
  console.log(`    service composed           ${description.memoryService}`);
  console.log(`    importance floor           ${description.memoryMinimumImportance}`);
  console.log(`    recall scopes              ${description.recallScopes.length === 0 ? "none (no recall, never 'all scopes')" : description.recallScopes.join(", ")}`);
  console.log(`    learning events            ${description.learning}`);
  console.log("");
  console.log("  WORKFLOWS");
  console.log(`    concurrency ceiling        ${description.coordinatorMaxConcurrency}`);
  console.log("");
  console.log("  WHAT THIS BUILD IS NOT");
  console.log(`    durable state              ${description.durableState} (every store is process-local; a restart loses jobs, claims, budgets and gates)`);
  console.log(
    `    approval records           ${description.approvalDurability === "durable" ? "durable" : "process-local (a restart loses every gate; an approved gate becomes unknown and the task is held again)"}`,
  );
  // PHASE 06. The isolation MODE, measured, replacing a `tenancy: "none"`
  // constant that was the same on every build forever - including one serving two
  // customers. A constant that cannot vary is not a measurement.
  console.log(
    `    workspace isolation        ${description.workspaceIsolation}` +
      `${description.workspace === null ? " (no workspace declared; no partitioned subsystem is composed)" : ` (${description.workspace}${description.brand === null ? "" : ` / ${description.brand}`})`}`,
  );
  console.log(`    audit events so far        ${description.auditEvents}`);

  const cannotExecute =
    description.providerAdapters === 0 || description.identityResolver === "absent" || description.agents === 0;
  if (cannotExecute) {
    console.log("");
    console.log("  This runtime cannot execute a task yet, and says so rather than trying.");
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2));