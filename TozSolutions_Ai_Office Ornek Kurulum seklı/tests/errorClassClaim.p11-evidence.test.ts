/**
 * PHASE 11 EVIDENCE - the `errorClass` / `durationMs` claim, measured rather than asserted.
 *
 * ## WHAT THE DOCUMENT USED TO SAY, AND WHY IT WAS PINNED
 *
 * `FINAL_ARCHITECTURE.md` §11 carried this row:
 *
 * > `errorClass` and `durationMs` | First-class parameters on `TraceRecorder.record` and
 * > **never supplied** by any of the four producers. Always `null` on every event ever written.
 *
 * `TODO.md` PHASE 11 item 2 flagged the first half as overstated and asked for a re-verify.
 * Re-verified by EXECUTION (four real scenarios through the composition root, 49 events), the
 * claim splits cleanly in two, and only one half survives:
 *
 * - **`errorClass` — the claim is FALSE.** 5 events across real runs carry a non-null
 *   `errorClass` (`timeout`, `configuration_error`). It is supplied at 5 `#record` sites in
 *   `authority.ts`, not zero. "Never supplied ... always null on every event ever written" is
 *   not a slightly exaggerated finding; it is the opposite of what the system does.
 * - **`durationMs` — the claim survives, and the precise reason is more useful than the claim
 *   was.** It is passed at exactly one `#record` site (`authority.ts:1538`, the
 *   `provider_usage_recorded` I added this phase), yet still arrives `null` in practice.
 *
 * ## WHY `durationMs` IS NULL, MEASURED NOT GUESSED
 *
 * The adapter in the probe reports `durationMs: 42` and no token counts — an ordinary shape for
 * a non-LLM adapter, or an LLM adapter that times its call without counting tokens. The event
 * still carries `durationMs: null`, because `authority.ts` guards the whole cost write:
 *
 * ```ts
 * if (execution.value.inputTokens !== undefined || execution.value.outputTokens !== undefined) {
 *   collector.cost({ ..., durationMs: execution.value.durationMs ?? null });
 * }
 * ```
 *
 * The guard tests TOKENS, so an adapter that reports a duration and no tokens never reaches
 * `collector.cost` and its duration is discarded. That guard is a real defect and is recorded
 * as an open `TODO.md` item; it is NOT fixed here, because it changes what
 * `provider_usage_recorded` reports and belongs with the Phase 13 work that gives adapters real
 * token accounting.
 *
 * These tests pin the claim so the document cannot quietly drift back to being false again: the
 * `errorClass` half is asserted as working, and the `durationMs` half is asserted as still-null
 * WITH the mechanism named, so whoever fixes the guard has to change this file deliberately.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CapabilitySet, type Capability } from "../src/capabilities/capability.js";
import { ManualClock } from "../src/core/clock.js";
import { err, ok } from "../src/core/result.js";
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

/** Reports a duration, and token counts only when asked to. */
class TimedAdapter implements AgentAdapter {
  public readonly name: string;
  public readonly calls: string[] = [];

  public constructor(
    name: string,
    private readonly behaviour: { fail?: "timeout"; tokens?: boolean } = {},
  ) {
    this.name = name;
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public describe(agentId: string, version: string): Promise<ReturnType<typeof ok<AdapterAgentDescriptor>> | ReturnType<typeof err<Error>>> {
    return Promise.resolve(
      ok({ agentId, name: "Timed adapter", version, capabilities: { supported: [RESEARCH], unsupported: [] } }),
    );
  }

  public execute(agentId: string, request: AgentExecutionRequest): Promise<ReturnType<typeof ok<AgentExecutionResult>> | ReturnType<typeof err<AgentExecutionError>>> {
    this.calls.push(request.taskId);
    if (this.behaviour.fail === "timeout") {
      return Promise.resolve(
        err({ agentKey: `${agentId}@1.0.0`, name: "TimedAdapter", errorClass: "timeout", message: "no answer" }),
      );
    }
    return Promise.resolve(
      ok({
        agentId,
        version: "1.0.0",
        taskId: request.taskId,
        durationMs: 42,
        output: "done",
        // Token counts present only in the variant that reports them.
        ...(this.behaviour.tokens === true ? { inputTokens: 10, outputTokens: 20 } : {}),
        providerId: null,
        modelId: null,
      }),
    );
  }
}

function build(adapter: AgentAdapter, adapterKey: string, capabilities: ReturnType<typeof CapabilitySet.supporting>): Runtime {
  const runtime = createRuntime({
    clock: new ManualClock(NOW),
    adapters: [adapter],
    identity: { resolve: () => authorised(), serviceContext: authorised() },
    workspace: workspaceRef("p11-errorclass"),
  });
  const input: Omit<AgentRecordInput, "now"> = {
    agentId: "timed-agent",
    version: "1.0.0",
    adapter: adapterKey,
    status: "active",
    trustLevel: "standard",
    capabilities,
    requiresModelRoute: false,
  };
  const registered = runtime.agents.register(input);
  assert.ok(registered.ok, `agent registration: ${JSON.stringify(registered.ok ? null : registered.error)}`);
  runtime.capabilities.index(registered.value.record);
  for (const step of ["verified", "registered", "available"] as const) {
    const moved = runtime.agents.transition(input.agentId, input.version, step);
    assert.ok(moved.ok, `agent ${step}: ${JSON.stringify(moved.ok ? null : moved.error)}`);
  }
  return runtime;
}

async function run(runtime: Runtime): Promise<void> {
  await runtime.orchestrator.execute({
    taskId: "t1",
    objective: "do the thing",
    input: "go",
    requiredCapabilities: [RESEARCH],
    taskType: "single",
    securityContext: authorised(),
  });
}

function failing(): Runtime {
  return build(new TimedAdapter("boom", { fail: "timeout" }), "boom", CapabilitySet.supporting(RESEARCH));
}

function timingWithoutTokens(): Runtime {
  return build(new TimedAdapter("timed", {}), "timed", CapabilitySet.supporting(RESEARCH));
}

function timingWithTokens(): Runtime {
  return build(new TimedAdapter("counted", { tokens: true }), "counted", CapabilitySet.supporting(RESEARCH));
}

describe("PHASE 11 EVIDENCE - the errorClass and durationMs claim", () => {
  it("REFUTES the errorClass half: a failing adapter's errorClass reaches the trace", async () => {
    const runtime = failing();
    await run(runtime);

    const failures = runtime.traces.events().filter((event) => event.kind === "subtask_failed");
    assert.ok(failures.length > 0, "a failing adapter must record a failure");
    const classified = failures.filter((event) => event.errorClass !== null && event.errorClass !== undefined);
    assert.ok(
      classified.length > 0,
      "`errorClass` is NOT always null - the §11 claim was false, and this is where it shows",
    );
    assert.ok(
      classified.some((event) => event.errorClass === "timeout"),
      "and the adapter's own error class survives the trip, rather than being flattened",
    );
  });

  it("also classifies the two refusals that never reach an adapter", async () => {
    // Both of these leave `execute` returning ok:true - a separate finding, recorded in TODO and
    // deliberately not fixed here. What matters here is that the EVENT still classifies them, so
    // the audit trail does not have to guess why the subtask failed.
    const ineligible = build(new TimedAdapter("timed", {}), "timed", CapabilitySet.supporting("code_execution"));
    await run(ineligible);
    const missing = build(new TimedAdapter("timed", {}), "absent", CapabilitySet.supporting(RESEARCH));
    await run(missing);

    for (const [label, runtime] of [["no eligible agent", ineligible], ["adapter not registered", missing]] as const) {
      const failures = runtime.traces.events().filter((event) => event.kind === "subtask_failed");
      assert.ok(failures.length > 0, `${label}: a failure is recorded`);
      assert.ok(
        failures.some((event) => event.errorClass === "configuration_error"),
        `${label}: and it carries a class, so the record explains itself`,
      );
    }
  });

  it("CONFIRMS the durationMs half: a reported duration is still discarded", async () => {
    const runtime = timingWithoutTokens();
    await run(runtime);

    const usage = runtime.traces.events().find((event) => event.kind === "provider_usage_recorded");
    assert.ok(usage !== undefined, "the usage event is emitted");
    assert.equal(
      usage.durationMs,
      null,
      "adapter reported 42ms, yet the event says null - the token guard at authority.ts drops it",
    );
    const metadata = (usage.metadata ?? {}) as Record<string, unknown>;
    assert.equal(metadata["durationMs"], null, "and the metadata copy agrees, so it is not a placement problem");
  });

  it("proves the guard is about TOKENS: the same adapter WITH token counts reports its duration", async () => {
    // The control that identifies the mechanism. Identical adapter, identical 42ms, the only
    // difference is that this one reports token counts - and the duration survives.
    const runtime = timingWithTokens();
    await run(runtime);

    const usage = runtime.traces.events().find((event) => event.kind === "provider_usage_recorded");
    assert.ok(usage !== undefined, "the usage event is emitted");
    assert.equal(usage.durationMs, 42, "so the loss is the token guard, not the event, not the recorder");
  });
});