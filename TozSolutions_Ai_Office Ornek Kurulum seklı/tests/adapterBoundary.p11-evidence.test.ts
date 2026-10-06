/**
 * PHASE 11 EVIDENCE - the adapter boundary is recorded, and only when it is crossed.
 *
 * ## WHY THIS FILE EXISTS SEPARATELY FROM THE VOCABULARY TEST
 *
 * `observabilityVocabulary.p11-evidence.test.ts` proves `adapter_invoked` is named by a
 * production file. That is the same weak claim this phase has been dismantling all along: a
 * name in the source is not an observation anybody can make. This file runs the real composition
 * root and counts events against actual adapter invocations.
 *
 * ## THE GAP `TODO.md` ITEM 1 RECORDED
 *
 * "no `adapter_invoked` event. Adapter calls are bracketed by `subtask_started` /
 * `subtask_completed` but leave no event of their own."
 *
 * Audited against the source: accurate, and the consequence was more than cosmetic. A search of
 * the whole event vocabulary found no payload carrying the adapter registry key, so the record
 * said "agent `counting-agent@1.0.0` ran" without ever saying through WHICH adapter.
 *
 * `agent_selected` does not cover it - it is emitted at the CHOICE, before the capability check
 * and before any call. `agent_reported_route` does not cover it either, and the gap is exactly
 * where it matters: an adapter that cannot report a route (`requiresModelRoute: false`) has
 * nothing else to show.
 *
 * ## A SEPARATE FINDING, RECORDED NOT FIXED
 *
 * While measuring the two refusal paths, both were found to leave `orchestrator.execute` returning
 * `ok: true` - a run reports SUCCESS while its only subtask recorded `subtask_failed`. Observed
 * with the real composition root, not inferred.
 *
 * Not changed here. It is outside PHASE 11 (which owns observability, not run semantics), and
 * altering whether a run succeeds is a far larger behavioural change than adding an event - it
 * would change what every existing caller treats as a failure. It is recorded in `TODO.md` as an
 * open finding for a later phase rather than quietly absorbed here. The tests below therefore
 * assert on the EVENTS, which is what this phase owns, and deliberately do not assert `ok: false`
 * for these two paths - that would pin behaviour this phase has no authority over.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CapabilitySet, type Capability } from "../src/capabilities/capability.js";
import { ManualClock } from "../src/core/clock.js";
import { ok, type Result } from "../src/core/result.js";
import { createSecurityContext, type Grant, type SecurityContext } from "../src/orchestration/governance/context.js";
import { createRuntime, type Runtime } from "../src/orchestration/composition.js";
import type {
  AgentAdapter,
  AdapterAgentDescriptor,
  AgentExecutionError,
  AgentExecutionRequest,
  AgentExecutionResult,
} from "../src/orchestration/agent/adapter.js";
import type { AgentRecordInput } from "../src/orchestration/agent/record.js";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";
import { assertOk } from "./contracts/contracts.js";

const NOW = new Date("2026-04-01T00:00:00.000Z");
const RESEARCH: Capability = "web_research";

function grant(operation: Grant["operation"], overrides: Partial<Grant> = {}): Grant {
  return { operation, resources: [], allowList: [], capabilities: [], trustFloor: "standard", expiresAt: null, ...overrides };
}

function authorised(): SecurityContext {
  return createSecurityContext({
    actor: "operator",
    trustLevel: "standard",
    grants: [
      grant("workflow.execute"),
      grant("capability.execute", { capabilities: [RESEARCH] }),
      grant("memory.read"),
      grant("memory.write"),
      grant("memory.capture"),
    ],
    scopes: ["task"],
  });
}

/**
 * An adapter that COUNTS its own invocations.
 *
 * Counting inside the adapter is the point: it is the number of boundary crossings that actually
 * happened, independent of the orchestrator's bookkeeping. Asserting the event count equals this
 * count is what stops the event from being emitted on a path that never called the adapter - the
 * failure mode a `kind` string in the source could never catch.
 */
class CountingAdapter implements AgentAdapter {
  public readonly name: string;
  public readonly calls: string[] = [];

  public constructor(name: string) {
    this.name = name;
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public describe(agentId: string, version: string): Promise<Result<AdapterAgentDescriptor, Error>> {
    return Promise.resolve(
      ok({
        agentId,
        name: "Counting agent",
        version,
        capabilities: { supported: [RESEARCH], unsupported: [] },
      }),
    );
  }

  public execute(agentId: string, request: AgentExecutionRequest): Promise<Result<AgentExecutionResult, AgentExecutionError>> {
    this.calls.push(request.taskId);
    return Promise.resolve(
      ok({
        agentId,
        version: "1.0.0",
        taskId: request.taskId,
        durationMs: 1,
        output: "done",
        providerId: null,
        modelId: null,
      }),
    );
  }
}

function registerAgent(runtime: Runtime, overrides: Partial<Omit<AgentRecordInput, "now">> = {}): void {
  const input: Omit<AgentRecordInput, "now"> = {
    agentId: "counting-agent",
    version: "1.0.0",
    adapter: "counting",
    status: "active",
    trustLevel: "standard",
    capabilities: CapabilitySet.supporting(RESEARCH),
    requiresModelRoute: false,
    ...overrides,
  };
  const registered = assertOk<never>(runtime.agents.register(input), "agent registration");
  runtime.capabilities.index((registered as { record: never }).record);
  for (const step of ["verified", "registered", "available"] as const) {
    assertOk(runtime.agents.transition(input.agentId, input.version, step), `agent ${step}`);
  }
}

function runtimeWith(adapter: AgentAdapter, context: SecurityContext = authorised()): Runtime {
  return createRuntime({
    clock: new ManualClock(NOW),
    adapters: [adapter],
    identity: { resolve: () => context, serviceContext: context },
    workspace: workspaceRef("p11-adapter-boundary"),
  });
}

function execute(runtime: Runtime): Promise<unknown> {
  return runtime.orchestrator.execute({
    taskId: "t1",
    objective: "do the thing",
    input: "go",
    requiredCapabilities: [RESEARCH],
    taskType: "single",
    securityContext: authorised(),
  });
}

describe("PHASE 11 EVIDENCE - the adapter boundary", () => {
  it("records one adapter_invoked per REAL crossing, naming the adapter", async () => {
    const adapter = new CountingAdapter("counting");
    const runtime = runtimeWith(adapter);
    registerAgent(runtime);

    const result = await execute(runtime);
    assert.equal((result as { ok: boolean }).ok, true, `expected success, got ${JSON.stringify(result)}`);

    // The event count is checked against the adapter's OWN count, not against a literal.
    assert.equal(adapter.calls.length, 1, "the adapter was called exactly once");
    const invocations = runtime.traces.events().filter((event) => event.kind === "adapter_invoked");
    assert.equal(invocations.length, 1, "and the record has exactly one crossing to match it");

    const metadata = (invocations[0]?.metadata ?? {}) as Record<string, unknown>;
    // The adapter registry key - the thing no other event carried. Without it, two deployments
    // running the same agent version through different adapters produce identical records.
    assert.equal(metadata["adapter"], "counting", "the adapter must be identifiable");
    assert.equal(metadata["agentId"], "counting-agent@1.0.0");
    assert.equal(metadata["attempt"], 1, "and the attempt, so a retry is distinguishable from a first call");
  });

  it("records NO crossing when no agent is eligible, because none happened", async () => {
    const adapter = new CountingAdapter("counting");
    const runtime = runtimeWith(adapter);
    // The agent cannot do the job, so selection never happens and the call is never reached.
    registerAgent(runtime, { capabilities: CapabilitySet.supporting("code_execution") });

    await execute(runtime);

    assert.equal(adapter.calls.length, 0, "the adapter was never reached");
    const kinds = runtime.traces.events().map((event) => event.kind);
    assert.equal(
      kinds.includes("adapter_invoked"),
      false,
      "a run that never crossed the boundary must not claim it did",
    );
    assert.ok(kinds.includes("agent_rejected"), "and the reason is still in the record");
  });

  it("records NO crossing when the adapter is not registered", async () => {
    const adapter = new CountingAdapter("counting");
    const runtime = runtimeWith(adapter);
    // Selected successfully, then found to have no adapter behind it. This is the path where
    // `agent_selected` HAS fired - so the selection event alone would read as "it ran".
    registerAgent(runtime, { adapter: "not_registered" });

    await execute(runtime);

    assert.equal(adapter.calls.length, 0, "no adapter could be called");
    const kinds = runtime.traces.events().map((event) => event.kind);
    assert.ok(kinds.includes("agent_selected"), "the agent WAS selected - this is the case the new event exists for");
    assert.equal(
      kinds.includes("adapter_invoked"),
      false,
      "an unresolved adapter is not a crossing, and saying otherwise would invent one",
    );
    assert.ok(kinds.includes("subtask_failed"), "the failure is recorded instead");
  });

  it("distinguishes WHICH adapter was crossed, once more than one exists", async () => {
    // The Phase 13 shape, proven while there is still only one real adapter: the same agent,
    // the same version, the same task, through two different adapters - two records that must
    // not look alike.
    const first = new CountingAdapter("first");
    const second = new CountingAdapter("second");
    const left = runtimeWith(first);
    const right = runtimeWith(second);

    registerAgent(left, { adapter: "first" });
    await execute(left);

    registerAgent(right, { adapter: "second" });
    await execute(right);

    const one = left.traces.events().find((event) => event.kind === "adapter_invoked");
    const two = right.traces.events().find((event) => event.kind === "adapter_invoked");
    const leftMeta = (one?.metadata ?? {}) as Record<string, unknown>;
    const rightMeta = (two?.metadata ?? {}) as Record<string, unknown>;

    assert.equal(
      leftMeta["agentId"],
      rightMeta["agentId"],
      "same agent version, so the agent id alone cannot tell the two runs apart",
    );
    assert.equal(leftMeta["adapter"], "first");
    assert.equal(
      rightMeta["adapter"],
      "second",
      "the adapter key is the ONLY thing that does - which is why it had to be recorded",
    );
  });
});