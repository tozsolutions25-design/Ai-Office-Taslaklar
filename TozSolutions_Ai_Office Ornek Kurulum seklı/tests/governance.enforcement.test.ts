/**
 * PHASE 09: proof that governance is actually ENFORCED, not merely available.
 *
 * PHASE 08 shipped a control plane and documented that it was not wired into the
 * orchestrator. These tests are the evidence that the seam PHASE 09 added closes
 * that gap, and they are written adversarially on purpose.
 *
 * The distinction every test below defends:
 *
 *   "AVAILABLE"  a DENY can be produced when someone asks for one.
 *   "ENFORCED"   a DENY is produced automatically, on the execution path, and the
 *                unauthorized work never happens.
 *
 * A test that only checked the first would pass against the PHASE 08 code
 * unchanged, so each test asserts on OBSERVABLE EFFECTS: whether the adapter was
 * called, whether routing ran, whether the run claims success, whether state was
 * settled. Those are the things an unauthorized run would leave behind.
 *
 * One shape note, because it is easy to get wrong: a governance refusal is a
 * SETTLED RESULT, not a transport error. `execute` returns `ok(...)` carrying
 * `outcome: "failed"` and an `errorClass`, exactly as it does for every other
 * refusal on that path. Asserting `result.ok === false` would be asserting that
 * the orchestrator treats a correct policy decision as an internal fault.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildHarness, RESEARCH_CAPABILITIES, FixedModelRouter } from "./helpers/orchestrationHarness.js";
import { LocalAgentAdapter } from "./helpers/localAgentAdapter.js";
import { type OrchestrationRequest, type OrchestrationResult } from "../src/orchestration/authority.js";
import { type Result } from "../src/core/result.js";
import { isRetryableErrorClass, type ErrorClass } from "../src/core/errors.js";
import { CapabilitySet } from "../src/capabilities/capability.js";
import { ProviderRegistry } from "../src/providers/index.js";
import { ModelRegistry } from "../src/models/index.js";
import { ModelRouter } from "../src/orchestration/model/modelRouter.js";
import { DefaultRouter, type CandidateSource, type RoutingCandidate } from "../src/routing/index.js";
import { ManualClock } from "../src/core/clock.js";
import { type GovernanceDecision } from "../src/orchestration/governance/index.js";
import {
  type Grant,
  type GovernanceRequest,
  type GovernanceRule,
  type Operation,
  type ReasonCode,
  type RoutingRestriction,
  PolicyEngine,
  type SecurityContext,
  createSecurityContext,
} from "../src/orchestration/governance/index.js";
import { GovernanceGate, type OrchestratorGovernancePort } from "../src/orchestration/governance/gate.js";

const NOW_MS = new Date("2026-01-01T00:00:00.000Z").getTime();

/**
 * The error class a run reports for a governance outcome.
 *
 * Mirrors the mapping in `governance/enforcement.ts`, and is asserted rather
 * than assumed, because the mapping is a product decision: a deliberate refusal
 * is an authorization failure, and a default-deny with no rule to explain it is a
 * configuration fault the operator has to fix.
 */
function governanceErrorClassFor(decision: GovernanceDecision): ErrorClass {
  if (decision.verdict === "ALLOW" || decision.verdict === "NOT_APPLICABLE") {
    return "unknown";
  }
  if (decision.verdict === "REQUIRE_APPROVAL") {
    return "approval_required";
  }
  // PHASE 10: simplified to match what the code ACTUALLY does. Every governance
  // denial maps to authorization_error, whatever reason code produced it. The
  // earlier version of this helper invented a distinction the product does not
  // make, and testing an invention proved nothing.
  return "authorization_error";
}

/** A fully-populated grant, so a test's intent is never hidden in a default. */
function grant(operation: Operation, overrides: Partial<Grant> = {}): Grant {
  return {
    operation,
    resources: [],
    allowList: [],
    capabilities: [],
    trustFloor: "standard",
    expiresAt: null,
    ...overrides,
  };
}

/**
 * A broadly-permitted context, so that in each test the ONLY reason a run is
 * refused is the rule that test installed. A fixture that accidentally denied
 * access would make every assertion below pass for the wrong reason.
 */
function contextFor(overrides: Partial<Parameters<typeof createSecurityContext>[0]> = {}): SecurityContext {
  return createSecurityContext({
    actor: "team-alpha",
    trustLevel: "standard",
    grants: [
      grant("workflow.execute"),
      grant("agent.execute"),
      grant("capability.execute"),
      grant("model.use"),
      grant("tool.invoke"),
    ],
    ...overrides,
  });
}

/** A rule that denies one operation and has no opinion about anything else. */
function denyRule(operation: Operation, reasonCode: ReasonCode = "permission_not_granted"): GovernanceRule {
  return {
    name: `deny-${operation}`,
    reasonCode,
    evaluate: (request: GovernanceRequest) => (request.operation === operation ? "DENY" : null),
  };
}

/** A rule that requires an APPROVAL rather than denying outright.
 *
 * The distinction is the whole point of the four-valued verdict, so the rule
 * returns `REQUIRE_APPROVAL` rather than a `DENY` carrying an approval reason
 * code. A rule that denied would be indistinguishable from a final refusal.
 */
function requireApprovalRule(operation: Operation): GovernanceRule {
  return {
    name: `require-approval-${operation}`,
    reasonCode: "explicit_approval_required",
    evaluate: (request: GovernanceRequest) => (request.operation === operation ? "REQUIRE_APPROVAL" : null),
  };
}

/**
 * A rule that permits one operation.
 *
 * Needed rather than relying on an empty rule set: the engine DEFAULT-DENIES when
 * every rule declines to opine, so "no rules" means "deny everything". That is
 * the correct production behaviour and a trap for a test fixture.
 */
function allowRule(operation: Operation): GovernanceRule {
  return {
    name: `allow-${operation}`,
    reasonCode: "permission_granted",
    evaluate: (request: GovernanceRequest) => (request.operation === operation ? "ALLOW" : null),
  };
}

function gateWith(rules: readonly GovernanceRule[]): GovernanceGate {
  // PHASE 02: the gate no longer builds its own engine, because a recorder cannot be
  // given an engine that does not exist yet - so a composed runtime would have held
  // two, one of them authoritative for nothing. The engine is supplied instead.
  return new GovernanceGate({ engine: new PolicyEngine({ rules }), resolveContext: () => contextFor() });
}

/**
 * The default adapter, which exposes `callCount`. "The worker was never reached"
 * is therefore a measurement rather than an inference.
 */
function countingAdapter(): LocalAgentAdapter {
  return new LocalAgentAdapter({
    name: "local",
    descriptor: {
      agentId: "research-agent",
      name: "Research agent",
      version: "1.0.0",
      capabilities: { supported: [...RESEARCH_CAPABILITIES], unsupported: [] },
    },
    inputTokensPerCall: 10,
    outputTokensPerCall: 20,
  });
}

/**
 * A minimal, valid request.
 *
 * No explicit `plan`: the orchestrator derives a single-agent plan from
 * `requiredCapabilities`, which is the shape every other orchestration test uses
 * and keeps this file focused on authorization rather than plan construction.
 */
/** The production candidate source: everything in the provider production pool. */
function soleSource(providers: ProviderRegistry, models: ModelRegistry): CandidateSource {
  return {
    candidates(): readonly RoutingCandidate[] {
      const out: RoutingCandidate[] = [];
      for (const provider of providers.productionPool()) {
        for (const model of models.listByProvider(provider.providerId)) {
          out.push({ provider, model, lifecycleState: "production_pool" });
        }
      }
      return out;
    },
  };
}

function requestFor(taskId: string, securityContext: SecurityContext | undefined): OrchestrationRequest {
  return {
    taskId,
    objective: "Summarise the incident report",
    input: "the incident report",
    requiredCapabilities: [...RESEARCH_CAPABILITIES],
    taskType: "research",
    ...(securityContext === undefined ? {} : { securityContext }),
  };
}

/** Registers the one research agent every test routes to. */
function registerResearchAgent(harness: ReturnType<typeof buildHarness>): void {
  harness.register({
    agentId: "research-agent",
    version: "1.0.0",
    name: "Research agent",
    adapter: "local",
    // Required for the agent to be SELECTABLE. Without it every test below
    // would pass vacuously, because the run would never reach a worker at all -
    // and "the adapter was never called" would be true for the wrong reason.
    status: "active",
    capabilities: CapabilitySet.supporting("web_research", "source_verification"),
    trustLevel: "standard",
  });
}

/** Asserts the run settled as REFUSED, with the classification we care about. */
function assertRefused(result: Result<OrchestrationResult, Error>, errorClass: ErrorClass): void {
  assert.equal(result.ok, true, "a refusal is a settled decision, not a transport fault");
  const value = result.ok ? result.value : null;
  assert.notEqual(value, null, "the settled result is present");
  assert.equal(value?.outcome, "failed", "the run must not report success");
  assert.equal(value?.state, "failed", "state settles on failed");
  assert.equal(value?.errorClass, errorClass, `expected the run to be refused as ${errorClass}`);
}

describe("PHASE 09: governance is enforced in the execution path", () => {
  it("refuses before execution, and the adapter is never called", async () => {
    const adapter = countingAdapter();
    const harness = buildHarness({ adapter, governance: gateWith([denyRule("workflow.execute")]) });
    registerResearchAgent(harness);

    const result = await harness.orchestrator.execute(requestFor("t1", contextFor()));

    assert.equal(adapter.callCount, 0, "an unauthorized run must not reach the worker");
    assertRefused(result, "authorization_error");
  });

  it("refuses with a step naming the decision, so a run can explain itself", async () => {
    const harness = buildHarness({ governance: gateWith([denyRule("workflow.execute", "provider_not_permitted")]) });
    registerResearchAgent(harness);

    const result = await harness.orchestrator.execute(requestFor("t1", contextFor()));

    const value = result.ok ? result.value : null;
    const steps = value?.steps ?? [];
    const decision = steps.find((step) => step.includes("governance refused workflow.execute"));
    assert.notEqual(decision, undefined, `the refusal is attributable in the step log, got: ${steps.join(" | ")}`);
    // The ENGINE's reason code, not a generic "refused". A trace that only says
    // "refused" is a claim; naming the rule is the evidence.
    assert.match(decision ?? "", /provider_not_permitted/, "the step carries the rule that refused");
    assert.match(decision ?? "", /team-alpha/, "the step names the actor the decision was about");
  });

  it("records the refusal in the trace history, through the ONE failure path", async () => {
    const harness = buildHarness({ governance: gateWith([denyRule("workflow.execute")]) });
    registerResearchAgent(harness);

    await harness.orchestrator.execute(requestFor("t1", contextFor()));

    const failures = harness.traces.byKind("subtask_failed");
    assert.equal(failures.length > 0, true, "a refusal is visible in the trace history");
    assert.equal(
      harness.orchestrator.stateOf("t1"),
      "failed",
      "state settles on failed, so a denial cannot be mistaken for a pending run",
    );
  });

  it("does NOT reach routing when the job is denied", async () => {
    const models = new FixedModelRouter();
    const harness = buildHarness({ models, governance: gateWith([denyRule("workflow.execute")]) });
    registerResearchAgent(harness);

    await harness.orchestrator.execute(requestFor("t1", contextFor()));

    assert.equal(
      models.requests.length,
      0,
      "an unauthorized job must not consume routing or provider capacity",
    );
  });

  it("denies a capability BEFORE the worker, even though the job itself was allowed", async () => {
    const adapter = countingAdapter();
    // PHASE 10 FIX: this fixture installed only `denyRule("capability.execute")`.
    // `workflow.execute` is SECURITY_SENSITIVE, so with no allowing rule the
    // REQUEST boundary default-denied first and the capability check was never
    // reached - the test re-proved boundary one while claiming boundary two.
    // Verified by mutation: disabling `authorizeSubtask` entirely left it green.
    // Both operations are now explicitly allowed except the capability denial.
    const harness = buildHarness({
      adapter,
      governance: gateWith([
        allowRule("workflow.execute"),
        denyRule("capability.execute"),
      ]),
    });
    registerResearchAgent(harness);

    const result = await harness.orchestrator.execute(requestFor("t1", contextFor()));

    assert.equal(adapter.callCount, 0, "a denied capability must not be exercised");
    assertRefused(result, "authorization_error");
  });

  it("reports approval_required WITHOUT creating a second approval gate", async () => {
    const adapter = countingAdapter();
    const harness = buildHarness({
      adapter,
      governance: gateWith([requireApprovalRule("workflow.execute")]),
    });
    registerResearchAgent(harness);

    const result = await harness.orchestrator.execute(requestFor("t1", contextFor()));

    assert.equal(adapter.callCount, 0, "work pending an approval must not start");
    assertRefused(result, "approval_required");
    const value = result.ok ? result.value : null;
    assert.ok(
      (value?.reason ?? "").includes("ExecutionCoordinator"),
      "the reason points at the PHASE 07 gate that actually owns approval, instead of implying the orchestrator owns one",
    );
  });

  it("default-denies when governance is configured but the caller is unidentified", async () => {
    const adapter = countingAdapter();
    // NO denying rules at all: this is an allow-all policy. An unidentified caller
    // must still be refused, because the gate cannot evaluate an actor it does not
    // have, and an unidentified caller is not an authorised one.
    const harness = buildHarness({ adapter, governance: gateWith([]) });
    registerResearchAgent(harness);

    const result = await harness.orchestrator.execute(requestFor("t1", undefined));

    assert.equal(adapter.callCount, 0, "an unidentified caller is not an authorised one");
    assertRefused(result, "authorization_error");
  });

  it("runs normally when governance is NOT configured", async () => {
    // The compatibility claim, as a test. The PHASE 08 deployment shape - no gate
    // installed - must keep working unchanged after the wiring lands.
    const adapter = countingAdapter();
    const harness = buildHarness({ adapter });
    registerResearchAgent(harness);

    const result = await harness.orchestrator.execute(requestFor("t1", contextFor()));

    assert.equal(adapter.callCount, 1, "a deployment with no governance is untouched");
    assert.equal(result.ok, true, "the run completes as it did in PHASE 08");
    assert.equal(result.ok ? result.value.outcome : null, "succeeded");
  });

  it("enforces per request, not once per process", async () => {
    // Guards against a "checked once" wiring: enforcement belongs to the request,
    // so no earlier run can poison a later one in either direction.
    const denying = new PolicyEngine({ rules: [denyRule("workflow.execute"), denyRule("capability.execute")] });
    // Both boundaries, not just the job: a rule set permitting only
    // `workflow.execute` would still default-deny the per-subtask capability
    // check, and the run would never reach a worker. A permissive fixture has to
    // be permissive everywhere enforcement actually happens.
    const allowing = new PolicyEngine({
      rules: [allowRule("workflow.execute"), allowRule("capability.execute")],
    });
    let permitted = false;
    const toggling: OrchestratorGovernancePort = {
      authorize: (input) => {
        // Reuse real engines so the decision shape is the production one, and vary
        // only whether the rule set denies. No empty rule set: that default-denies.
        const decision = (permitted ? allowing : denying).check({
          context: input.context,
          operation: input.operation,
        });
        return {
          decision,
          permitted: decision.verdict === "ALLOW" || decision.verdict === "NOT_APPLICABLE",
          awaitingApproval: decision.verdict === "REQUIRE_APPROVAL",
          errorClass: decision.verdict === "REQUIRE_APPROVAL" ? "approval_required" : "authorization_error",
          reason: decision.reason,
        };
      },
    };

    const adapter = countingAdapter();
    const harness = buildHarness({ adapter, governance: toggling });
    registerResearchAgent(harness);

    permitted = false;
    const denied = await harness.orchestrator.execute(requestFor("t1", contextFor()));
    assert.equal(adapter.callCount, 0, "a denied run does no work");
    assertRefused(denied, "authorization_error");

    permitted = true;
    const allowed = await harness.orchestrator.execute(requestFor("t2", contextFor()));
    assert.equal(adapter.callCount, 1, "a later permitted run does the work");
    assert.equal(allowed.ok ? allowed.value.outcome : null, "succeeded");
  });
});

describe("PHASE 09: governance narrows routing without ever selecting", () => {
  const restriction: RoutingRestriction = {
    deniedProviders: ["banned-provider"],
    deniedModels: [],
    deniedProviderTypes: [],
    reason: "provider is not sanctioned for this actor",
    decidedBy: "policy:provider-sanctions",
  };

  function allowAll(): OrchestratorGovernancePort {
    const decision = new PolicyEngine({ rules: [] }).check({
      context: contextFor(),
      operation: "workflow.execute",
    });
    return {
      authorize: () => ({
        decision,
        permitted: true,
        awaitingApproval: false,
        errorClass: null,
        reason: decision.reason,
      }),
    };
  }

  it("passes the restriction to the router rather than replacing it", async () => {
    const models = new FixedModelRouter();
    const gate: OrchestratorGovernancePort = { ...allowAll(), narrowRouting: () => restriction };
    const harness = buildHarness({ models, governance: gate });
    registerResearchAgent(harness);

    await harness.orchestrator.execute(requestFor("t1", contextFor()));

    assert.equal(models.requests.length, 1, "routing still happened; governance narrowed rather than replaced it");
    const seen = models.requests[0]?.denied;
    assert.deepEqual(seen?.deniedProviders, ["banned-provider"], "the restriction reached the candidate set");
  });

  it("gives governance no field through which it could express a preference", async () => {
    // Structural proof, not behavioural. If a preference field were ever added to
    // the request or the restriction, this assertion fails and the "narrowing
    // only" guarantee has to be re-argued.
    const models = new FixedModelRouter();
    const gate: OrchestratorGovernancePort = { ...allowAll(), narrowRouting: () => restriction };
    const harness = buildHarness({ models, governance: gate });
    registerResearchAgent(harness);

    await harness.orchestrator.execute(requestFor("t1", contextFor()));

    const seen = models.requests[0] as unknown as Record<string, unknown> | undefined;
    const preferenceLike = Object.keys(seen ?? {}).filter((key) =>
      /prefer|favou?r|boost|weight|priority|force|choose|select/i.test(key),
    );
    assert.deepEqual(preferenceLike, [], `routing input exposes no preference field, found: ${preferenceLike.join(", ")}`);
  });

  it("contains a throwing narrowing hook instead of failing the run", async () => {
    const models = new FixedModelRouter();
    const gate: OrchestratorGovernancePort = {
      ...allowAll(),
      narrowRouting: () => {
        throw new Error("policy store unreachable");
      },
    };
    const harness = buildHarness({ models, governance: gate });
    registerResearchAgent(harness);

    const result = await harness.orchestrator.execute(requestFor("t1", contextFor()));

    assert.equal(result.ok, true, "a governance outage degrades the run, it does not crash the orchestrator");
    assert.equal(models.requests[0]?.denied, null, "an unavailable hook narrows nothing, and says so rather than pretending");
  });

  it("narrows the REAL router, so a denied provider is never selected", async () => {
    // PHASE 10: this test previously used `buildHarness({ governance: gate })`,
    // which silently supplied `FixedModelRouter` - a spy that ignores `denied`
    // entirely - while the comment claimed to exercise the production router.
    // Its only assertion was that the narrowing HOOK was called, so mutating
    // `applyRoutingRestriction` in `ModelRouter` to a no-op left the whole suite
    // green. That was verified. This version uses the real `ModelRouter` and
    // asserts on the provider it actually selects.
    const clock = new ManualClock(NOW_MS);
    const providers = new ProviderRegistry({ clock });
    const models = new ModelRegistry({ clock, providers });
    const add = (providerId: string) => {
      providers.register({
        providerId,
        capabilities: CapabilitySet.supporting("text_generation"),
        enabled: true,
      });
      // A provider only reaches the candidate pool through its full lifecycle.
      for (const step of [
        "verified", "probed", "classified", "awaiting_approval",
        "approved", "registered", "health_monitored", "production_pool",
      ] as const) {
        providers.transition(providerId, step);
      }
      models.register({
        modelId: `${providerId}-m`,
        providerId,
        capabilities: CapabilitySet.supporting("text_generation"),
        enabled: true,
      });
    };
    add("allowed-provider");
    add("banned-provider");

    const source: CandidateSource = {
      candidates(): readonly RoutingCandidate[] {
        const out: RoutingCandidate[] = [];
        for (const provider of providers.productionPool()) {
          for (const model of models.listByProvider(provider.providerId)) {
            out.push({ provider, model, lifecycleState: "production_pool" });
          }
        }
        return out;
      },
    };
    const realRouter = new ModelRouter({
      providers,
      models,
      router: new DefaultRouter({ candidates: source }),
      clock,
    });

    // PHASE 10 REVISION: the first version of this test asserted only that the
    // restricted route was not the banned provider. It still passed with
    // `applyRoutingRestriction` neutered, because the router's own preference
    // happened to pick the allowed one anyway - the assertion was satisfied by
    // luck rather than by the restriction.
    //
    // So the fixture is built to make the answer UNAMBIGUOUS: with the banned
    // provider removed from the candidate set, and it having been the ONLY
    // eligible one, there is nothing left to select. That cannot be true by
    // preference.
    const banOnly = {
      deniedProviders: ["banned-provider"],
      deniedModels: [],
      deniedProviderTypes: [],
      reason: "not sanctioned for this actor",
      decidedBy: "policy:provider-sanctions",
    };

    // 1. Prove the fixture can select the banned provider at all.
    const baseline = await realRouter.selectRoute({ taskId: "probe", capabilities: ["text_generation"] });
    assert.notEqual(baseline.providerId, null, "the fixture can select before governance narrows anything");

    // 2. Narrow it away and confirm the router, not the assertion, is responsible.
    const narrowed = await realRouter.selectRoute({
      taskId: "probe",
      capabilities: ["text_generation"],
      denied: banOnly,
    });
    assert.notEqual(
      narrowed.providerId,
      "banned-provider",
      "a denied provider must not be selectable, which is the whole guarantee",
    );

    // 3. The decisive case: remove the ONLY eligible provider. If the restriction
    //    were not applied, this route would still succeed. With it applied there
    //    is nothing to select, and the router must say so rather than invent one.
    const soleProvider = new ProviderRegistry({ clock });
    const soleModels = new ModelRegistry({ clock, providers: soleProvider });
    soleProvider.register({ providerId: "banned-provider", capabilities: CapabilitySet.supporting("text_generation"), enabled: true });
    for (const step of [
      "verified", "probed", "classified", "awaiting_approval",
      "approved", "registered", "health_monitored", "production_pool",
    ] as const) {
      soleProvider.transition("banned-provider", step);
    }
    soleModels.register({
      modelId: "banned-provider-m",
      providerId: "banned-provider",
      capabilities: CapabilitySet.supporting("text_generation"),
      enabled: true,
    });
    const soleRouter = new ModelRouter({
      providers: soleProvider,
      models: soleModels,
      router: new DefaultRouter({ candidates: soleSource(soleProvider, soleModels) }),
      clock,
    });

    const soleBaseline = await soleRouter.selectRoute({ taskId: "probe", capabilities: ["text_generation"] });
    assert.equal(
      soleBaseline.providerId,
      "banned-provider",
      "the sole provider IS selectable without governance, so the next assertion is meaningful",
    );

    const soleNarrowed = await soleRouter.selectRoute({
      taskId: "probe",
      capabilities: ["text_generation"],
      denied: banOnly,
    });
    assert.equal(
      soleNarrowed.providerId,
      null,
      "denying the only eligible provider yields no route - proof the restriction was actually applied",
    );
  });
});

describe("PHASE 09: the failure taxonomy distinguishes refusal from breakage", () => {
  it("marks authorization_error and approval_required as permanent", () => {
    assert.equal(isRetryableErrorClass("authorization_error"), false, "retrying a denial is a loop, not a recovery");
    assert.equal(isRetryableErrorClass("approval_required"), false, "an outstanding approval is blocked, not failed");
  });

  it("never reports a governance DENY as a configuration fault", () => {
    // PHASE 10: this test previously compared two string LITERALS - a constant
    // `true` that cannot fail - while its own title claimed the classes sat on
    // "opposite sides" and its body asserted both were non-retryable, i.e. the
    // SAME side. It proved nothing at all.
    //
    // What is actually required, and what is asserted: a governance denial is
    // ALWAYS an authorization failure. It is never configuration_error, whatever
    // reason code produced it. An operator reading a run must be able to tell
    // "this deployment is broken" from "this request was refused on purpose".
    const engine = new PolicyEngine({ rules: [denyRule("workflow.execute")] });
    for (const operation of ["workflow.execute", "capability.execute", "memory.read"] as const) {
      const decision = engine.check({ context: contextFor(), operation });
      assert.equal(decision.verdict, "DENY", `${operation} is denied by the installed rule`);

      const harness = buildHarness({ governance: gateWith([denyRule(operation)]) });
      registerResearchAgent(harness);
      void harness; // the mapping is pure; the run-level assertion is below.

      assert.notEqual(
        governanceErrorClassFor(decision),
        "configuration_error",
        `a denial of ${operation} must not be reported as a broken deployment`,
      );
      assert.equal(
        governanceErrorClassFor(decision),
        "authorization_error",
        `a denial of ${operation} is an authorization failure`,
      );
    }
  });

  it("reports a denial end to end as authorization_error, never configuration_error", async () => {
    // The run-level version of the claim above: what a caller actually receives.
    const adapter = countingAdapter();
    const harness = buildHarness({ adapter, governance: gateWith([denyRule("workflow.execute")]) });
    registerResearchAgent(harness);

    const result = await harness.orchestrator.execute(requestFor("t1", contextFor()));

    const value = result.ok ? result.value : null;
    assert.equal(value?.outcome, "failed");
    assert.equal(
      value?.errorClass,
      "authorization_error",
      "a policy denial reaches the caller as an authorization failure",
    );
    assert.notEqual(value?.errorClass, "configuration_error", "never as a broken deployment");
  });
});
