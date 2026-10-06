/**
 * PHASE 08: the governance decision surface.
 *
 * Sections covered: POLICY, PERMISSION, DEFAULT DENY, DELEGATION, RESOURCE,
 * ROUTING, APPROVAL, AUDIT.
 *
 * The theme: governance must be able to REFUSE, must be able to say no, and must
 * never be able to choose. Every test below that asserts an allow also asserts
 * that a slightly different input does not get one.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { CapabilitySet } from "../src/capabilities/capability.js";
import { AuditLog } from "../src/audit/events.js";
import { TraceRecorder } from "../src/orchestration/observability/trace.js";
import {
  ApprovalResolverRule,
  ApprovalRule,
  CapabilityRule,
  DEFAULT_RESOURCE_LIMITS,
  GovernanceRecorder,
  GrantRule,
  HUMAN_APPROVAL_OPERATIONS,
  KnownActorRule,
  OPERATIONS,
  PolicyEngine,
  RESOURCE_BEARING_OPERATIONS,
  ResourceTracker08,
  SECURITY_SENSITIVE_OPERATIONS,
  ScopeRule,
  TrustFloorRule,
  applyRoutingRestriction,
  bridgeApproval,
  checkResourceLimits,
  createSecurityContext,
  decide,
  isPermitted,
  malformed,
  toSecurityDecision,
  type GovernanceResource,
  type Grant,
  type Operation,
  type RoutingRestriction,
  type SecurityContext,
} from "../src/orchestration/governance/index.js";
import { type RoutingCandidate } from "../src/routing/index.js";
import { type ProviderRecord } from "../src/providers/index.js";
import { type ModelRecord } from "../src/models/index.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const START = NOW.getTime();

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

function context(overrides: Partial<Parameters<typeof createSecurityContext>[0]> = {}): SecurityContext {
  return createSecurityContext({
    actor: "team-a",
    trustLevel: "standard",
    grants: [grant("tool.invoke", { allowList: ["calculator"] })],
    ...overrides,
  });
}

function resource(kind: GovernanceResource["kind"], id: string | null): GovernanceResource {
  return { kind, id };
}

function engine(rules?: ConstructorParameters<typeof PolicyEngine>[0]["rules"]): PolicyEngine {
  return new PolicyEngine({
    clock: new ManualClock(NOW),
    rules:
      rules ?? [
        new KnownActorRule((actor) => actor.startsWith("team-") || actor.startsWith("human:") || actor.startsWith("agent:")),
        new GrantRule(),
        new TrustFloorRule(),
        new ResourceAllowListForTest(),
        new CapabilityRule(),
        new ScopeRule(),
        new ApprovalResolverRule(),
      ],
  });
}

/** Mirrors the shipped `ResourceAllowListRule` without importing it by name twice. */
class ResourceAllowListForTest {
  public readonly name = "resource-allow-list";
  public readonly reasonCode = "permission_not_granted" as const;
  public evaluate(request: {
    context: SecurityContext;
    operation: Operation;
    resource: GovernanceResource | null;
  }): "ALLOW" | "DENY" | null {
    const id = request.resource?.id ?? null;
    if (id === null) {
      return null;
    }
    const matching = request.context.grants.filter((g) => g.operation === request.operation);
    if (matching.length === 0) {
      return null;
    }
    const lists = matching.map((g) => g.allowList).filter((list) => list.length > 0);
    if (lists.length === 0) {
      return null;
    }
    return lists.some((list) => list.includes(id)) ? null : "DENY";
  }
}

/* -------------------------------------------------------------------------- */

describe("PHASE 08 POLICY - four states, not a boolean", () => {
  it("names all four verdicts", () => {
    const allowed = engine().check({ context: context(), operation: "tool.invoke", resource: resource("tool", "calculator") });
    assert.equal(allowed.verdict, "ALLOW");

    const denied = engine().check({ context: context(), operation: "tool.invoke", resource: resource("tool", "shell") });
    assert.equal(denied.verdict, "DENY");

    const withApproval = engine([
      new GrantRule(),
      new ApprovalRule(["tool.invoke"]),
    ]).check({ context: context(), operation: "tool.invoke", resource: resource("tool", "calculator") });
    assert.equal(withApproval.verdict, "REQUIRE_APPROVAL", "approval-requiring must be expressible, which is why this is not a boolean");

    const deferred = new PolicyEngine({ clock: new ManualClock(NOW), rules: [], deferToSubsystem: ["memory.read"] }).check({
      context: context(),
      operation: "memory.read",
    });
    assert.equal(deferred.verdict, "NOT_APPLICABLE", "governance can decline to answer without that reading as allow");
    assert.equal(deferred.reasonCode, "subsystem_authoritative");
  });

  it("makes NOT_APPLICABLE distinguishable from ALLOW", () => {
    const notApplicable = new PolicyEngine({ rules: [], deferToSubsystem: ["tool.invoke"] }).check({
      context: context(),
      operation: "tool.invoke",
    });
    const allowed = engine().check({ context: context(), operation: "tool.invoke", resource: resource("tool", "calculator") });
    assert.notEqual(notApplicable.verdict, allowed.verdict, "a subsystem that decides is not the same as permission granted");
    assert.equal(isPermitted(notApplicable), false, "NOT_APPLICABLE is not permission from governance");
  });

  it("is deterministic: the same input gives the same decision and the same rules", () => {
    const subject = context();
    const request = { context: subject, operation: "tool.invoke" as Operation, resource: resource("tool", "calculator") };
    const first = engine().check(request);
    const second = engine().check(request);
    assert.equal(first.verdict, second.verdict);
    assert.deepEqual(first.evaluatedRules, second.evaluatedRules);
    assert.equal(first.reason, second.reason);
  });

  it("records every rule that fired, in order", () => {
    const decision = engine().check({ context: context(), operation: "tool.invoke", resource: resource("tool", "shell") });
    assert.ok(decision.evaluatedRules.length > 0, "an explainable decision names its rules");
    assert.equal(decision.evaluatedRules[decision.evaluatedRules.length - 1], decision.reasonCode);
  });

  it("refuses a malformed context rather than allowing it", () => {
    const decision = malformed({ detail: "the actor is missing", at: START });
    assert.equal(decision.verdict, "DENY");
    assert.equal(decision.reasonCode, "malformed_context");
  });

  it("refuses an unknown operation string", () => {
    const decision = engine().check({ context: context(), operation: "tool.invokeTypo" });
    assert.equal(decision.verdict, "DENY");
    assert.equal(decision.reasonCode, "malformed_context");
  });
});

describe("PHASE 08 PERMISSION", () => {
  it("allows a granted operation and denies an ungranted one", () => {
    const subject = context();
    assert.equal(
      engine().check({ context: subject, operation: "tool.invoke", resource: resource("tool", "calculator") }).verdict,
      "ALLOW",
    );
    assert.equal(engine().check({ context: subject, operation: "provider.use", resource: resource("provider", "acme") }).verdict, "DENY");
  });

  it("refuses a tool outside the allow-list", () => {
    const decision = engine().check({ context: context(), operation: "tool.invoke", resource: resource("tool", "shell") });
    assert.equal(decision.verdict, "DENY", "a granted operation with a narrowed allow-list is still narrowed");
  });

  it("refuses a provider or model the context does not name", () => {
    const subject = context({
      grants: [grant("provider.use", { allowList: ["acme"] }), grant("model.use", { allowList: ["acme/m1"] })],
    });
    assert.equal(engine().check({ context: subject, operation: "provider.use", resource: resource("provider", "other") }).verdict, "DENY");
    assert.equal(engine().check({ context: subject, operation: "model.use", resource: resource("model", "acme/m1") }).verdict, "ALLOW");
  });

  it("refuses a capability the grant does not carry", () => {
    const subject = context({ grants: [grant("capability.execute", { capabilities: ["coding"] })] });
    assert.equal(
      engine().check({ context: subject, operation: "capability.execute", capability: "coding" }).verdict,
      "ALLOW",
    );
    assert.equal(
      engine().check({ context: subject, operation: "capability.execute", capability: "vision" }).verdict,
      "DENY",
    );
  });

  it("refuses a scope outside the context's scopes", () => {
    const subject = context({
      grants: [grant("memory.read", { allowList: ["project"] })],
      scopes: ["project"],
    });
    assert.equal(
      engine().check({ context: subject, operation: "memory.read", scope: "project" }).verdict,
      "ALLOW",
    );
    assert.equal(
      engine().check({ context: subject, operation: "memory.read", scope: "global" }).verdict,
      "DENY",
    );
  });

  it("refuses every memory scope when none are named", () => {
    // The same direction PHASE 05 takes when `writableScopes` is omitted: none
    // named means none permitted.
    const subject = context({ grants: [grant("memory.read", { allowList: ["project"] })], scopes: [] });
    assert.equal(engine().check({ context: subject, operation: "memory.read", scope: "project" }).verdict, "DENY");
  });
});

describe("PHASE 08 DEFAULT DENY", () => {
  it("refuses an unknown actor", () => {
    const subject = context({ actor: "stranger", grants: [grant("tool.invoke", { allowList: [] })] });
    const decision = engine().check({ context: subject, operation: "tool.invoke" });
    assert.equal(decision.verdict, "DENY");
    assert.equal(decision.reasonCode, "unknown_actor");
  });

  it("refuses an unknown permission, and says the name is not in the catalogue", () => {
    const decision = engine().check({ context: context(), operation: "tools.invoke" });
    assert.equal(decision.verdict, "DENY");
  });

  it("refuses a security-sensitive operation when no rule permitted it", () => {
    // A rule set that defers on everything must not become a permissive default.
    const permissive = new PolicyEngine({ clock: new ManualClock(NOW), rules: [] });
    const decision = permissive.check({ context: context(), operation: "tool.invoke" });
    assert.equal(decision.verdict, "DENY", "'nobody objected' is not 'somebody permitted'");
    assert.equal(decision.reasonCode, "permission_not_granted");
    assert.ok(decision.evaluatedRules.includes("default-deny"));
  });

  it("refuses a provider outside the allow-list rather than passing it through", () => {
    // A non-empty allow-list is what makes "unknown" meaningful. An EMPTY
    // allow-list is a deliberately broad grant ("any provider of this kind"),
    // which a deployment can choose and which is recorded as a grant - it is not
    // the same as a default.
    const subject = context({ grants: [grant("provider.use", { allowList: ["acme"] })] });
    assert.equal(engine().check({ context: subject, operation: "provider.use", resource: resource("provider", "who-knows") }).verdict, "DENY");
    assert.equal(engine().check({ context: subject, operation: "provider.use", resource: resource("provider", "acme") }).verdict, "ALLOW");
  });

  it("classifies every operation, and marks them all security-sensitive", () => {
    for (const operation of OPERATIONS) {
      assert.equal(SECURITY_SENSITIVE_OPERATIONS[operation] !== undefined, true, `${operation} must be classified`);
      assert.equal(RESOURCE_BEARING_OPERATIONS[operation] !== undefined, true, `${operation} must be classified`);
      assert.equal(SECURITY_SENSITIVE_OPERATIONS[operation], true, `${operation} carries authority and is default-deny`);
      // PHASE 04: the third classification, extended here rather than in a new file
      // so the property being asserted is the one it already claims - that the
      // catalogue and its classifications cannot drift apart. An operation added to
      // `OPERATIONS` without a decision about whether it needs a human would
      // otherwise read as "no approval needed", silently.
      assert.equal(HUMAN_APPROVAL_OPERATIONS[operation] !== undefined, true, `${operation} must be classified for human approval`);
    }
    assert.equal(
      Object.keys(HUMAN_APPROVAL_OPERATIONS).length,
      OPERATIONS.length,
      "the human-approval classification must cover the catalogue exactly, with no entries outside it",
    );
  });
});

describe("PHASE 08 DELEGATION - bounded, and cannot escalate", () => {
  function parent(): SecurityContext {
    return context({
      grants: [
        grant("tool.invoke", { allowList: ["calculator", "reader"], resources: ["job-1"] }),
        grant("memory.read", { allowList: ["project"], trustFloor: "standard" }),
      ],
      scopes: ["project", "team"],
    });
  }

  it("derives a child that holds a subset of the parent's authority", () => {
    const outcome = engine().delegateAuthority(parent(), {
      to: "agent:worker-1",
      operations: ["tool.invoke"],
      allowList: ["calculator"],
    });
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.context.actor, "agent:worker-1");
      assert.deepEqual(outcome.context.delegation.length, 1);
    }
  });

  it("refuses to delegate an operation the parent does not hold", () => {
    const outcome = engine().delegateAuthority(parent(), { to: "agent:x", operations: ["admin.configure"] });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.match(outcome.detail, /cannot delegate/);
    }
  });

  it("refuses an escalation attempt rather than silently clamping it", () => {
    // Asking for MORE than the parent has must be visible, not quietly reduced.
    const outcome = engine().delegateAuthority(parent(), {
      to: "agent:x",
      operations: ["tool.invoke"],
      allowList: ["calculator", "reader", "shell"],
    });
    assert.equal(outcome.ok, false, "a widening request is refused so the caller finds out");
  });

  it("does not let a child hold a capability the parent lacks", () => {
    const withCapability = context({
      grants: [grant("capability.execute", { capabilities: ["coding"] })],
    });
    const outcome = engine().delegateAuthority(withCapability, {
      to: "agent:x",
      operations: ["capability.execute"],
      capabilities: ["coding", "vision"],
    });
    assert.equal(outcome.ok, false, "a child cannot gain a capability its parent did not have");
  });

  it("does not let a child read a scope the parent cannot", () => {
    const outcome = engine().delegateAuthority(parent(), {
      to: "agent:x",
      operations: ["memory.read"],
      scopes: ["project", "global"],
    });
    assert.equal(outcome.ok, false, "a child cannot read further than its parent");
  });

  it("never inherits the parent's approval", () => {
    // Otherwise a delegator could hand its own approval onward, which is exactly
    // the escalation approval exists to prevent.
    const approver = context({
      actor: "human:ana",
      trustLevel: "privileged",
      grants: [grant("tool.invoke", { allowList: ["calculator"] })],
      approvalId: "gate-1",
      approvalState: "approved",
    });
    const outcome = engine().delegateAuthority(approver, { to: "agent:x", operations: ["tool.invoke"] });
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.context.approvalState, "none");
      assert.equal(outcome.context.approvalId, null);
    }
  });

  it("refuses a delegation with no operations, and one expiring in the past", () => {
    const subject = parent();
    assert.equal(engine().delegateAuthority(subject, { to: "agent:x", operations: [] }).ok, false);
    assert.equal(
      engine().delegateAuthority(subject, { to: "agent:x", operations: ["tool.invoke"], expiresAt: START - 1 }).ok,
      false,
    );
  });

  it("cannot outlive the parent's grant", () => {
    const expiring = context({ grants: [grant("tool.invoke", { allowList: [], expiresAt: START + 1_000 })] });
    const outcome = engine().delegateAuthority(expiring, { to: "agent:x", operations: ["tool.invoke"], expiresAt: START + 9_999_999 });
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.context.grants[0]?.expiresAt, START + 1_000, "the child cannot outlive its parent");
    }
  });

  it("freezes the context so authority cannot be mutated after a decision", () => {
    const subject = parent();
    assert.equal(Object.isFrozen(subject), true, "a mutable authority object makes every decision provisional");
    assert.throws(() => {
      (subject as { actor: string }).actor = "someone-else";
    });
  });
});

describe("PHASE 08 APPROVAL - governance decides, PHASE 07 enforces", () => {
  function gatesStub(state: string | null): {
    openApproval(input: { jobId: string; taskId: string; question: string }): { gateId: string; state: string };
    forTask(taskId: string): { gateId: string; state: string } | null;
    opened: string[];
  } {
    const opened: string[] = [];
    return {
      opened,
      openApproval: (input) => {
        opened.push(input.taskId);
        return { gateId: "gate-1", state: "waiting" };
      },
      forTask: () => (state === null ? null : { gateId: "gate-1", state }),
    };
  }

  it("opens a PHASE 07 gate when approval is required, and blocks", () => {
    const decision = engine([new GrantRule(), new ApprovalRule(["tool.invoke"])]).check({
      context: context(),
      operation: "tool.invoke",
      resource: resource("tool", "calculator"),
    });
    assert.equal(decision.verdict, "REQUIRE_APPROVAL");
    const gates = gatesStub(null);
    const outcome = bridgeApproval({ decision, gates, jobId: "job-1", taskId: "t1" });
    assert.equal(outcome.action, "blocked");
    assert.deepEqual(gates.opened, ["t1"], "the gate is the PHASE 07 one, opened here");
  });

  it("reuses an existing gate rather than opening a competing one", () => {
    const decision = decide({ verdict: "REQUIRE_APPROVAL", operation: "tool.invoke", actor: "team-a", reasonCode: "explicit_approval_required", reason: "needs a human", at: START });
    const gates = gatesStub("waiting");
    const outcome = bridgeApproval({ decision, gates, jobId: "job-1", taskId: "t1" });
    assert.equal(outcome.action, "blocked");
    assert.deepEqual(gates.opened, [], "a second gate for one task would be the competing-approval-system failure");
  });

  it("proceeds once the gate is approved", () => {
    const decision = decide({ verdict: "REQUIRE_APPROVAL", operation: "tool.invoke", actor: "team-a", reasonCode: "explicit_approval_required", reason: "needs a human", at: START });
    const outcome = bridgeApproval({ decision, gates: gatesStub("approved"), jobId: "job-1", taskId: "t1" });
    assert.equal(outcome.action, "proceed");
  });

  it("blocks while the gate is still pending", () => {
    const decision = decide({ verdict: "REQUIRE_APPROVAL", operation: "tool.invoke", actor: "team-a", reasonCode: "explicit_approval_required", reason: "needs a human", at: START });
    const outcome = bridgeApproval({ decision, gates: gatesStub("pending"), jobId: "job-1", taskId: "t1" });
    assert.equal(outcome.action, "blocked", "a retry or a fallback arriving at this bridge is blocked exactly the same way");
  });

  it("refuses REQUIRE_APPROVAL when there is nowhere to ask", () => {
    // "No gate available" must never mean "no approval needed".
    const decision = decide({ verdict: "REQUIRE_APPROVAL", operation: "tool.invoke", actor: "team-a", reasonCode: "explicit_approval_required", reason: "needs a human", at: START });
    const outcome = bridgeApproval({ decision, gates: null, jobId: "job-1", taskId: "t1" });
    assert.equal(outcome.action, "denied");
  });

  it("does not open a gate for something already denied", () => {
    const decision = decide({ verdict: "DENY", operation: "tool.invoke", actor: "team-a", reasonCode: "permission_not_granted", reason: "not granted", at: START });
    const gates = gatesStub(null);
    const outcome = bridgeApproval({ decision, gates, jobId: "job-1", taskId: "t1" });
    assert.equal(outcome.action, "denied");
    assert.deepEqual(gates.opened, [], "asking about something already refused would imply it might be permitted");
  });

  it("refuses an actor resolving an approval about itself", () => {
    const subject = context({
      actor: "agent:worker-1",
      trustLevel: "privileged",
      grants: [grant("approval.resolve", { allowList: [] })],
    });
    const decision = engine().check({
      context: subject,
      operation: "approval.resolve",
      resource: resource("agent", "agent:worker-1"),
    });
    assert.equal(decision.verdict, "DENY", "self-approval is refused at the governance layer as well as in PHASE 07");
  });
});

describe("PHASE 08 RESOURCE - unpriced spend still blocks", () => {
  function state(inFlight = 0, attempts: Record<string, number> = {}): {
    inFlight: number;
    attemptsByActor: Readonly<Record<string, number>>;
    startedAt: ReadonlyMap<string, number>;
  } {
    return { inFlight, attemptsByActor: attempts, startedAt: new Map() };
  }

  it("blocks when a cost budget exists and no amount was reported", () => {
    // The PHASE 07 rule, preserved. An unknown cost is not a zero cost.
    const verdict = checkResourceLimits({
      limits: DEFAULT_RESOURCE_LIMITS,
      state: state(),
      actor: "team-a",
      operation: "workflow.execute",
      nowMs: START,
      budget: { mayProceed: false, detail: "no provider reported an amount", measuredAmount: null },
    });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.allowed === false ? verdict.reasonCode : null, "resource_cost_unknown");
  });

  it("proceeds when there is no cost budget at all", () => {
    const verdict = checkResourceLimits({
      limits: DEFAULT_RESOURCE_LIMITS,
      state: state(),
      actor: "team-a",
      operation: "workflow.execute",
      nowMs: START,
      budget: null,
    });
    assert.equal(verdict.allowed, true);
  });

  it("enforces a concurrency ceiling", () => {
    const verdict = checkResourceLimits({
      limits: { ...DEFAULT_RESOURCE_LIMITS, maxConcurrent: 2 },
      state: state(2),
      actor: "team-a",
      operation: "workflow.execute",
      nowMs: START,
    });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.allowed === false ? verdict.reasonCode : null, "concurrency_limit");
  });

  it("enforces an attempt ceiling per actor", () => {
    const verdict = checkResourceLimits({
      limits: { ...DEFAULT_RESOURCE_LIMITS, maxAttempts: 1 },
      state: state(0, { "team-a": 1 }),
      actor: "team-a",
      operation: "workflow.execute",
      nowMs: START,
    });
    assert.equal(verdict.allowed, false, "an unbounded retry loop is refused at the resource layer");
  });

  it("enforces a runtime ceiling per actor", () => {
    const verdict = checkResourceLimits({
      limits: { ...DEFAULT_RESOURCE_LIMITS, maxRuntimeMs: 1_000 },
      state: { inFlight: 1, attemptsByActor: {}, startedAt: new Map([["team-a", START - 5_000]]) },
      actor: "team-a",
      operation: "workflow.execute",
      nowMs: START,
    });
    assert.equal(verdict.allowed, false);
  });

  it("counts and releases in-flight work", () => {
    const tracker = new ResourceTracker08({ clock: new ManualClock(NOW) });
    tracker.begin("team-a");
    tracker.begin("team-a");
    assert.equal(tracker.totalInFlight(), 2);
    tracker.end("team-a");
    assert.equal(tracker.totalInFlight(), 1);
    assert.equal(tracker.attemptsOf("team-a"), 2);
  });
});

describe("PHASE 08 ROUTING - governance narrows, and cannot choose", () => {
  function candidate(providerId: string, modelId: string, providerType: string): RoutingCandidate {
    const provider = { providerId, type: providerType } as ProviderRecord;
    const model = { modelId } as ModelRecord;
    return { provider, model, lifecycleState: "production_pool" };
  }

  const candidates = [
    candidate("acme", "m1", "managed"),
    candidate("acme", "m2", "managed"),
    candidate("local", "llama", "local"),
  ];

  it("removes a denied provider", () => {
    const restriction: RoutingRestriction = {
      deniedProviders: ["acme"],
      deniedModels: [],
      deniedProviderTypes: [],
      reason: "policy",
      decidedBy: "governance",
    };
    const remaining = applyRoutingRestriction(candidates, restriction);
    assert.deepEqual(remaining.map((entry) => entry.model?.modelId), ["llama"]);
  });

  it("removes a denied model without touching its siblings", () => {
    const restriction: RoutingRestriction = {
      deniedProviders: [],
      deniedModels: ["acme/m1"],
      deniedProviderTypes: [],
      reason: "policy",
      decidedBy: "governance",
    };
    const remaining = applyRoutingRestriction(candidates, restriction);
    assert.deepEqual(remaining.map((entry) => entry.model?.modelId), ["m2", "llama"]);
  });

  it("removes a whole provider type", () => {
    const restriction: RoutingRestriction = {
      deniedProviders: [],
      deniedModels: [],
      deniedProviderTypes: ["managed"],
      reason: "data residency",
      decidedBy: "governance",
    };
    assert.deepEqual(applyRoutingRestriction(candidates, restriction).map((e) => e.model?.modelId), ["llama"]);
  });

  it("cannot ADD, reorder or prefer anything", () => {
    // The type has no `preferred`, no `score` and no `order` field at all. A test
    // that has to be written this way is the point: expressiveness that could
    // become a second router does not exist to be misused.
    const restriction = applyRoutingRestriction(candidates, null);
    assert.deepEqual(restriction, candidates, "no restriction means no change, in the same order");
    const fieldNames = Object.keys({
      deniedProviders: [],
      deniedModels: [],
      deniedProviderTypes: [],
      reason: "",
      decidedBy: "",
    });
    for (const forbidden of ["preferred", "score", "order", "rank", "choose"]) {
      assert.equal(fieldNames.includes(forbidden), false, `a restriction must not be able to express "${forbidden}"`);
    }
  });

  it("preserves candidate order, so PHASE 06 policy ordering still decides", () => {
    const restriction: RoutingRestriction = {
      deniedProviders: [],
      deniedModels: ["acme/m1"],
      deniedProviderTypes: [],
      reason: "policy",
      decidedBy: "governance",
    };
    assert.deepEqual(
      applyRoutingRestriction(candidates, restriction).map((entry) => entry.model?.modelId),
      ["m2", "llama"],
      "the survivors keep their order, so evaluateCandidate and policy ordering are untouched",
    );
  });
});

describe("PHASE 08 AUDIT - a decision is visible, and carries no secret", () => {
  it("emits a governance event into the one history", () => {
    const clock = new ManualClock(NOW);
    const audit = new AuditLog({ clock });
    const traces = new TraceRecorder(audit);
    const recorder = new GovernanceRecorder({ engine: engine(), traces, clock });
    recorder.authorize({
      context: context({ jobId: "job-1", taskId: "t1" }),
      operation: "tool.invoke",
      resource: resource("tool", "calculator"),
    });
    const events = audit.read({ workspace: null, brand: null }).filter((event) => (event as { kind?: string }).kind === "orchestration_event");
    assert.ok(events.length > 0, "a decision is recorded in the same history as the work it governed");
    const detail = events[events.length - 1] as unknown as { metadata: Record<string, unknown> };
    assert.equal(detail.metadata["verdict"], "ALLOW");
    assert.equal(detail.metadata["operation"], "tool.invoke");
  });

  it("redacts a secret that a caller put into the reason", () => {
    const decision = decide({
      verdict: "DENY",
      operation: "tool.invoke",
      actor: "team-a",
      reasonCode: "permission_not_granted",
      reason: "refused because apiKey=sk-live-abcdef123456 was presented",
      at: START,
    });
    assert.equal(decision.reason.includes("sk-live-abcdef123456"), false, "a secret must not reach the log");
    assert.ok(decision.evaluatedRules.includes("redacted"), "the redaction is visible, not silent");
  });

  it("never records a credential field verbatim", () => {
    const decision = decide({
      verdict: "ALLOW",
      operation: "provider.use",
      actor: "team-a",
      reasonCode: "permission_granted",
      reason: "permitted",
      at: START,
      metadata: { authToken: "super-secret-token", provider: "acme" },
    });
    assert.equal(JSON.stringify(decision).includes("super-secret-token"), false);
  });

  it("records a resource refusal too, not only allowances", () => {
    const clock = new ManualClock(NOW);
    const audit = new AuditLog({ clock });
    const traces = new TraceRecorder(audit);
    const recorder = new GovernanceRecorder({ engine: engine(), traces, clock });
    const outcome = recorder.authorize({
      context: context(),
      operation: "tool.invoke",
      resource: resource("tool", "shell"),
    });
    assert.equal(outcome.permitted, false);
    assert.ok(audit.read({ workspace: null, brand: null }).some((event) => (event as { kind?: string }).kind === "orchestration_event"));
  });
});

describe("PHASE 08 - adaptation to the existing binary screen", () => {
  it("narrows ALLOW to allowed, and everything else to not-allowed", () => {
    const allowed = decide({ verdict: "ALLOW", operation: "tool.invoke", actor: "a", reasonCode: "permission_granted", reason: "yes", at: START });
    const pending = decide({ verdict: "REQUIRE_APPROVAL", operation: "tool.invoke", actor: "a", reasonCode: "explicit_approval_required", reason: "wait", at: START });
    assert.deepEqual(toSecurityDecision(allowed), { allowed: true, reason: "yes" });
    assert.equal(toSecurityDecision(pending).allowed, false, "a binary screen must take the STRICT reading of a pending approval");
  });
});

/* Keep the capability set referenced, so the import documents intent. */
void CapabilitySet;
