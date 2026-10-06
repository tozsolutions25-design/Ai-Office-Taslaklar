/**
 * PHASE 08 EVIDENCE - the configured trust policy reaches both places it belongs.
 *
 * ## THE DEFECT
 *
 * `agent.defaultMinimumTrust` is documented as "Default trust floor when a task does not
 * state one". It was implemented NOWHERE. Its one read in `src/` was
 *
 *   composition.ts -> maximumTrustFloor: config.agent.defaultMinimumTrust
 *
 * which feeds the pool's MISCONFIGURATION GUARD, not a default. `PoolOptions
 * .maximumTrustFloor` refuses a request whose floor is ABOVE it - so wiring the default
 * ("low") as the maximum meant that with the shipped configuration, any task asking for
 * `standard`, `high` or `privileged` was REFUSED outright, with the reason
 * `Requested trust floor "standard" exceeds the configured maximum "low"`.
 *
 * Meanwhile the behaviour the field actually documents was hardcoded: three separate
 * `request.minimumTrust ?? "low"` sites in `authority.ts`. Raise the configured default to
 * `privileged` and nothing changed, because nothing read it.
 *
 * Two similar names, two different questions, wired to each other. This file asserts the
 * fix in both directions, because either half alone would leave the other as a
 * fabricated capability - which is the shape of defect PHASE 07 found twice
 * (`ephemeral_content`, `duplicate_of_recent`) and `DECISIONS.md` D-53 named.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { CapabilitySet } from "../src/capabilities/capability.js";
import { ManualClock } from "../src/core/clock.js";
import { ok, type Result } from "../src/core/result.js";
import { createSecurityContext, type Grant, type SecurityContext } from "../src/orchestration/governance/context.js";
import { createRuntime } from "../src/orchestration/composition.js";
import { loadOrchestrationConfig } from "../src/orchestration/config/orchestrationConfig.js";
import type {
  AgentAdapter,
  AgentExecutionError,
  AgentExecutionRequest,
  AgentExecutionResult,
  AdapterAgentDescriptor,
} from "../src/orchestration/agent/adapter.js";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";
import { assertOk } from "./contracts/contracts.js";
import type { RegisteredAgent } from "../src/orchestration/agent/registry.js";

const ROOT = process.cwd();
const readSource = (relative: string): string => readFileSync(path.join(ROOT, relative), "utf8");
const NOW = new Date("2026-04-01T00:00:00.000Z");
const RESEARCH = "web_research";

/** A backend that answers, so the only thing under test is which agent was reachable. */
class HonestAdapter implements AgentAdapter {
  public readonly name = "honest";
  public readonly descriptor: AdapterAgentDescriptor = {
    agentId: "low-trust-agent",
    name: "Low trust agent",
    version: "1.0.0",
    capabilities: { supported: [RESEARCH], unsupported: [] },
  };

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public describe(agentId: string, version: string): Promise<Result<AdapterAgentDescriptor, Error>> {
    return Promise.resolve(
      agentId === this.descriptor.agentId
        ? ok({ ...this.descriptor, version })
        : Promise.reject(new Error(`Unknown agent: ${agentId}`)) as never,
    );
  }

  public execute(agentId: string, request: AgentExecutionRequest): Promise<Result<AgentExecutionResult, AgentExecutionError>> {
    return Promise.resolve(ok({ agentId, version: "1.0.0", taskId: request.taskId, durationMs: 1, output: "done" }));
  }
}

function grant(operation: Grant["operation"], overrides: Partial<Grant> = {}): Grant {
  return { operation, resources: [], allowList: [], capabilities: [], trustFloor: "standard", expiresAt: null, ...overrides };
}

function operator(): SecurityContext {
  return createSecurityContext({
    actor: "operator",
    trustLevel: "standard",
    grants: [grant("workflow.execute"), grant("capability.execute", { capabilities: [RESEARCH] })],
    scopes: ["task"],
  });
}

describe("PHASE 08 EVIDENCE - trust policy wiring", () => {
  /* -- structural: the wiring itself --------------------------------------- */

  it("feeds the pool's misconfiguration guard a maximum, not a default", () => {
    const source = readSource("src/orchestration/composition.ts");
    assert.doesNotMatch(
      source,
      /maximumTrustFloor:\s*config\.agent\.defaultMinimumTrust/,
      "a default floor is not a maximum; this refused every task that asked for more trust than the default",
    );
    assert.match(
      source,
      /maximumTrustFloor:\s*config\.agent\.maximumTrustFloor/,
      "the guard must read a maximum, and the configuration must declare one",
    );
  });

  it("declares both trust settings, and they are not the same field", () => {
    const config = readSource("src/orchestration/config/orchestrationConfig.ts");
    assert.match(config, /readonly maximumTrustFloor: TrustLevel;/, "a maximum must exist to be wired");
    // Two fields whose names could be confused is exactly why this assertion is here: if
    // they ever collapse back into one, the wiring bug returns silently.
    const defaults = config.match(/maximumTrustFloor:\s*"(\w+)"/);
    assert.ok(defaults !== null, "the maximum needs a default");
    assert.equal(
      defaults[1],
      "privileged",
      "the default maximum must impose no artificial restriction; the pool's own fallback is `privileged`",
    );
  });

  it("applies the configured default where a task states no floor of its own", () => {
    // The behaviour the field has always claimed. Before Phase 08 this was the literal
    // "low" in three places, so the configuration could not change it.
    const source = readSource("src/orchestration/authority.ts");
    const hardcoded = [...source.matchAll(/minimumTrust:\s*request\.minimumTrust\s*\?\?\s*"(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(
      hardcoded,
      [],
      `no site may hardcode a default trust floor; found ${JSON.stringify(hardcoded)}. The configured default must be read instead.`,
    );
    assert.match(
      source,
      /minimumTrust:\s*request\.minimumTrust\s*\?\?\s*this\.#defaultMinimumTrust/,
      "every fallback must read the configured default",
    );
    assert.match(readSource("src/orchestration/composition.ts"), /defaultMinimumTrust:\s*config\.agent\.defaultMinimumTrust/, "wired from configuration");
  });

  /* -- behavioural: the configured default is actually USED ------------------ */

  it("uses the configured default floor for a task that states none", async () => {
    // The structural assertions above prove the field is WIRED. This proves it is USED,
    // which is a different question and the one a mutation of the constructor line answers.
    //
    // The first PHASE 08 battery run reported S6 - "the orchestrator reads the configured
    // default trust floor" - as SURVIVED, because every assertion about it read source and a
    // source-reading test cannot see a behavioural change. It is here so that reverting
    // `options.defaultMinimumTrust ?? "low"` to a literal `"low"` now fails.
    //
    // The shape: a runtime configured to demand `high`, one agent trusted at `low`, and a
    // task that states NO floor. With the configuration honoured the agent is unreachable;
    // with the hardcoded default it is selected and runs.
    const context = operator();
    const build = (defaultMinimumTrust: "low" | "high") => {
      const runtime = createRuntime({
        clock: new ManualClock(NOW),
        adapters: [new HonestAdapter()],
        identity: { resolve: () => context, serviceContext: context },
        workspace: workspaceRef("trust-wiring"),
        config: loadOrchestrationConfig({ agent: { defaultMinimumTrust } }),
      });
      const input = {
        agentId: "low-trust-agent",
        version: "1.0.0",
        adapter: "honest",
        status: "active" as const,
        trustLevel: "low" as const,
        capabilities: CapabilitySet.supporting(RESEARCH),
        requiresModelRoute: false,
      };
      const registered = assertOk<RegisteredAgent>(runtime.agents.register(input), "registration");
      runtime.capabilities.index(registered.record);
      for (const step of ["verified", "registered", "available"] as const) {
        assertOk(runtime.agents.transition(input.agentId, input.version, step), `agent ${step}`);
      }
      return runtime;
    };

    const request = {
      taskId: "t1",
      objective: "do the thing",
      input: "go",
      requiredCapabilities: [RESEARCH],
      taskType: "single",
      securityContext: context,
    };

    // Configured floor is `low` and the agent is `low`: reachable. The control.
    const permissive = await build("low").orchestrator.execute(request);
    assert.equal(permissive.ok && permissive.value.outcome, "succeeded", "the control must actually reach the agent");

    // Configured floor is `high` and the agent is `low`: unreachable, because the task said
    // nothing and the CONFIGURATION said `high`.
    const strict = await build("high").orchestrator.execute(request);
    assert.ok(strict.ok, "execute resolves");
    assert.equal(strict.value.outcome, "failed", "the configured floor must make a low-trust agent unreachable");
    assert.match(String(strict.value.reason), /trust/i, `the refusal must name the trust floor, got: ${strict.value.reason}`);
  });

  it("documents the guard in the direction it actually refuses", () => {
    // The option's doc said "Rejects a task whose trust floor is BELOW this". The code
    // refuses one that is ABOVE. A guard that reads as the opposite of what it does is
    // the kind of comment that makes a reader disable it.
    const source = readSource("src/orchestration/pool/specialistPool.ts");
    assert.match(source, /maximumTrustFloor\?: TrustLevel;[\s\S]{0,200}?(ABOVE|above|exceeds)/, "the doc must state the direction the code refuses");
    assert.doesNotMatch(source, /maximumTrustFloor\?: TrustLevel;[\s\S]{0,160}?below this/, "and must not claim the opposite");
  });
});
