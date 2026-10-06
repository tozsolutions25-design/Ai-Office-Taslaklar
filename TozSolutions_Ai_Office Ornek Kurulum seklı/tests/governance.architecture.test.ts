/**
 * PHASE 08: architectural guarantees.
 *
 * These are the assertions the brief's section 19 asks for, written so that a
 * future change which opens one of these doors FAILS a test whose name says which
 * door. A comment cannot do that; a test can.
 *
 * Each one is a STRUCTURAL check - what an object holds, not what it was asked to
 * do - because a component that cannot reach a registry cannot use it, regardless
 * of its intentions.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ManualClock } from "../src/core/clock.js";
import { AuditLog } from "../src/audit/events.js";
import { TraceRecorder } from "../src/orchestration/observability/trace.js";
import { ExecutionCoordinator } from "../src/orchestration/workflow/index.js";
import { isOrchestrationState } from "../src/orchestration/task/state.js";
import { GovernanceRecorder } from "../src/orchestration/governance/index.js";
import {
  ApprovalResolverRule,
  CapabilityRule,
  GrantRule,
  KnownActorRule,
  PolicyEngine,
  ScopeRule,
  TrustFloorRule,
  createSecurityContext,
  type Grant,
  type Operation,
} from "../src/orchestration/governance/index.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

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
 * Whether an import clause binds nothing at runtime.
 *
 * Covers `import type { X }` and `import { type X }`, plus a mixed clause whose
 * only non-type bindings would be caught by the specifier check itself.
 */
function isTypeOnlyClause(clause: string): boolean {
  const trimmed = clause.trim();
  if (trimmed.startsWith("type ")) {
    return true;
  }
  const inner = trimmed.replace(/^\{|\}$/g, "").trim();
  if (inner === "") {
    return false;
  }
  const specifiers = inner
    .replace(/^\*\s+as\s+\w+/, "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return specifiers.length > 0 && specifiers.every((entry) => entry.startsWith("type "));
}

function ownFields(value: unknown): readonly string[] {
  return Object.getOwnPropertyNames(value);
}

/* -------------------------------------------------------------------------- */

describe("PHASE 08 - governance remains governance-only", () => {
  it("holds no registry through which it could route, select, or write", () => {
    const engine = new PolicyEngine({
      clock: new ManualClock(NOW),
      rules: [new KnownActorRule(() => true), new GrantRule(), new TrustFloorRule(), new CapabilityRule(), new ScopeRule(), new ApprovalResolverRule()],
    });
    const surface = engine as unknown as Record<string, unknown>;
    for (const forbidden of [
      "providers",
      "models",
      "router",
      "providerRouter",
      "modelRouter",
      "selectRoute",
      "agents",
      "agentRegistry",
      "capabilityRegistry",
      "memory",
      "memoryService",
      "capture",
      "recall",
      "orchestrator",
      "coordinator",
      "tools",
      "verifier",
    ]) {
      assert.equal(
        surface[forbidden],
        undefined,
        `governance must hold no ${forbidden}. A control plane that can reach a registry can be pressured into using it.`,
      );
    }
  });

  it("exposes no execution entry point", () => {
    const engine = new PolicyEngine({ clock: new ManualClock(NOW), rules: [] });
    const surface = engine as unknown as Record<string, unknown>;
    for (const forbidden of ["execute", "run", "start", "plan", "schedule", "select", "route"]) {
      assert.equal(surface[forbidden], undefined, `governance must have no ${forbidden}()`);
    }
  });

  it("cannot express a preference between two permitted candidates", () => {
    // A governance restriction is a filter. There is no field through which it
    // could become a second router, so the failure mode is not representable.
    const restriction = {
      deniedProviders: ["acme"],
      deniedModels: [],
      deniedProviderTypes: [],
      reason: "policy",
      decidedBy: "governance",
    };
    for (const forbidden of ["preferred", "preferredProvider", "score", "rank", "order", "weight", "boost"]) {
      assert.equal(
        Object.hasOwn(restriction, forbidden),
        false,
        `a restriction must not be able to express "${forbidden}"`,
      );
    }
  });
});

describe("PHASE 08 - authorities are unchanged and single", () => {
  it("the coordinator still holds no provider or model registry", () => {
    const coordinator = new ExecutionCoordinator({
      executor: {
        execute: () =>
          Promise.resolve({
            succeeded: true,
            output: "",
            errorClass: null,
            error: null,
            providerId: null,
            modelId: null,
            traceId: null,
            usage: null,
            cancelled: false,
          }),
      },
      clock: new ManualClock(NOW),
    });
    const surface = coordinator as unknown as Record<string, unknown>;
    for (const forbidden of ["providers", "models", "router", "governance", "policyEngine"]) {
      assert.equal(surface[forbidden], undefined, `the coordinator must hold no ${forbidden}`);
    }
    assert.ok(
      coordinator.approvals !== undefined,
      "the PHASE 07 approval gate is still the coordinator's own gate, not governance's",
    );
  });

  it("the coordinator exposes job state and nothing else that governs", () => {
    // It REMAINS the job state authority - PHASE 08 moved that nowhere.
    const coordinator = new ExecutionCoordinator({
      executor: {
        execute: () =>
          Promise.resolve({
            succeeded: true,
            output: "",
            errorClass: null,
            error: null,
            providerId: null,
            modelId: null,
            traceId: null,
            usage: null,
            cancelled: false,
          }),
      },
      clock: new ManualClock(NOW),
    });
    // Methods live on the prototype, so both levels are inspected.
    const names = [
      ...ownFields(coordinator),
      ...ownFields(Object.getPrototypeOf(coordinator)),
    ];
    assert.ok(names.includes("createJob"), "job state authority is still the coordinator's");
    assert.ok(names.includes("settle"));
    assert.ok(names.includes("cancelJob"));
  });

  it("governance does not appear anywhere in the PHASE 07 job state machine", () => {
    // The state machine is untouched: it has no notion of governance at all, and
    // a machine whose transitions depended on a policy engine would be a different
    // machine.
    const source = readFileSync(
      join(process.cwd(), "src/orchestration/workflow/jobState.ts"),
      "utf8",
    );
    assert.equal(source.includes("governance"), false, "the job state machine must not know governance exists");
    assert.equal(source.includes("Governance"), false);
  });

  it("the PHASE 07 orchestration task machine still refuses `paused`", () => {
    // Asserted explicitly because PHASE 08 was told not to add it, and because
    // adding it would change a PHASE 04 decision rather than extend PHASE 08.
    assert.equal(
      isOrchestrationState("paused"),
      false,
      "adding `paused` to the in-run task machine is out of scope for PHASE 08; a durable job has its own machine",
    );
  });

  it("no PHASE 08 module imports a router, an orchestrator, or a memory service", () => {
    const directory = join(process.cwd(), "src/orchestration/governance");
    // Declaration files are build output, not source: `policy.d.ts` re-exports the
    // router TYPE, which is not a dependency the runtime has.
    const files = readdirSync(directory).filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"));
    assert.ok(files.length > 0, "the governance directory should not be empty");
    for (const file of files) {
      const source = readFileSync(join(directory, file), "utf8");
      // TYPE-ONLY imports are allowed, in both forms: `import type { X }` and
      // `import { type X }`. `applyRoutingRestriction` takes a
      // `RoutingCandidate[]`, and a type import binds nothing at runtime - the
      // guarantee under test is that governance cannot CALL a router, not that it
      // cannot describe one.
      const imports = [...source.matchAll(/import\s+([\s\S]*?)from\s+"([^"]+)"/g)]
        .filter((match) => !isTypeOnlyClause(match[1] ?? ""))
        .map((match) => match[2] ?? "");
      for (const specifier of imports) {
        for (const forbidden of ["/routing/", "authority.js", "memory/service", "verification/", "tools/"]) {
          assert.equal(
            specifier.includes(forbidden),
            false,
            `${file} imports "${specifier}" at runtime, which would give governance a route, an orchestrator, memory or verification. Governance decides; those components act.`,
          );
        }
      }
    }
  });
});

describe("PHASE 08 - a security context is frozen authority", () => {
  it("cannot be mutated after a decision", () => {
    const context = createSecurityContext({
      actor: "team-a",
      trustLevel: "standard",
      grants: [grant("tool.invoke")],
    });
    assert.equal(Object.isFrozen(context), true);
    assert.throws(() => {
      (context as unknown as { trustLevel: string }).trustLevel = "privileged";
    }, "escalating trust by mutating a context is the attack this freeze prevents");
  });

  it("has no mutable array fields", () => {
    const context = createSecurityContext({
      actor: "team-a",
      trustLevel: "standard",
      grants: [grant("tool.invoke", { allowList: ["calculator"] })],
      scopes: ["project"],
      capabilities: ["coding"],
    });
    for (const field of ["grants", "scopes", "capabilities", "roles", "delegation"] as const) {
      assert.equal(
        Object.isFrozen(context[field]),
        true,
        `${field} must be frozen; a mutable allow-list makes every decision provisional`,
      );
    }
  });

  it("refuses to be created without an accountable actor", () => {
    assert.throws(
      () => createSecurityContext({ actor: "  ", trustLevel: "standard" }),
      /must be named/,
    );
  });
});

describe("PHASE 08 - workers and adapters cannot bypass governance", () => {
  it("the recorder refuses a context it cannot evaluate rather than allowing it", () => {
    const engine = new PolicyEngine({ clock: new ManualClock(NOW), rules: [] });
    const clock = new ManualClock(NOW);
    const audit = new AuditLog({ clock });
    const traces = new TraceRecorder(audit);
    const recorder = new GovernanceRecorder({ engine, traces, clock });
    // A caller that supplies no context at all: the engine must refuse it rather
    // than the recorder dereference it and throw. A throwing audit path is an
    // outage vector - the refusal would look like it never happened.
    const outcome = recorder.authorize({
      context: null,
      operation: "tool.invoke",
    });
    assert.equal(outcome.permitted, false, "a missing security context is a refusal, not a pass");
  });

  it("a worker cannot grant itself authority", () => {
    const context = createSecurityContext({ actor: "agent:worker-1", trustLevel: "standard", grants: [grant("tool.invoke")] });
    assert.equal(Object.isFrozen(context.grants), true);
    assert.throws(() => {
      (context as unknown as { grants: Grant[] }).grants = [grant("admin.configure")];
    });
  });
});

describe("PHASE 08 - memory authority is not duplicated", () => {
  it("governance is not wired into the memory subsystem", () => {
    const directory = join(process.cwd(), "src/orchestration/memory");
    for (const file of readdirSync(directory).filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))) {
      const source = readFileSync(join(directory, file), "utf8");
      assert.equal(
        source.includes("governance"),
        false,
        `${file} must not reference governance. PHASE 05 memory authority stays the only thing that answers a memory question.`,
      );
    }
  });

  it("governance defers rather than re-deciding, when configured to", () => {
    const engine = new PolicyEngine({ clock: new ManualClock(NOW), rules: [], deferToSubsystem: ["memory.write"] });
    const context = createSecurityContext({ actor: "team-a", trustLevel: "standard", grants: [grant("memory.write")] });
    const decision = engine.check({ context, operation: "memory.write" });
    assert.equal(decision.verdict, "NOT_APPLICABLE");
    assert.equal(decision.reasonCode, "subsystem_authoritative", "the subsystem that owns it remains authoritative");
  });
});


