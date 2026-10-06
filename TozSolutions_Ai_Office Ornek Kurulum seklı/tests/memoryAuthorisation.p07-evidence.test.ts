/**
 * PHASE 07 EVIDENCE - memory authorisation, retention and identity.
 *
 * The companion to `memoryScopeModel.p07-evidence.test.ts`, which covers what a scope
 * MEANS. This file covers what the subsystem DOES with one: who may read, who may write,
 * what happens when identity is absent, and what happens when a memory expires.
 *
 * Written test-first for each item, and each item records why the naive version would
 * have been wrong - which in this subsystem was repeatedly the case.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import {
  InMemoryMemoryProvider,
  MemoryAccessPolicy,
  type MemoryGrant,
  type MemorySubject,
} from "../src/orchestration/memory/memory.js";
import { MemoryStore } from "../src/orchestration/memory/store.js";
import { DefaultWritePolicy } from "../src/orchestration/memory/policy.js";
import type { MemoryDraft, MemoryProvenance } from "../src/orchestration/memory/model.js";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";

const NOW = new Date("2026-07-01T00:00:00.000Z");
const NOW_MS = NOW.getTime();
const ACME = workspaceRef("acme");
const ACME_BRAND = workspaceRef("acme", "brand-two");
const GLOBEX = workspaceRef("globex");

function clock(): ManualClock {
  return new ManualClock(NOW);
}

function provenance(overrides: Partial<MemoryProvenance> = {}): MemoryProvenance {
  return {
    source: "agent",
    sourceRef: "agent:prober",
    taskId: null,
    traceId: null,
    observedAt: NOW_MS,
    verification: null,
    sourceReference: null,
    ...overrides,
  };
}

function subject(overrides: Partial<MemorySubject> = {}): MemorySubject {
  return { id: "agent:a@1.0.0", workspace: ACME, operatingScope: "task", ...overrides };
}

function grant(overrides: Partial<MemoryGrant> = {}): MemoryGrant {
  return {
    subject: subject(),
    scopes: ["task"],
    writableScopes: ["task"],
    minimumTrust: "untrusted",
    expiresAt: null,
    ...overrides,
  };
}

function store(target: ManualClock = clock(), workspace = ACME): MemoryStore {
  return new MemoryStore({
    provider: new InMemoryMemoryProvider(),
    clock: target,
    workspace,
  });
}

function draft(overrides: Partial<MemoryDraft> = {}): MemoryDraft {
  return {
    scope: "task",
    key: "k",
    type: "semantic",
    value: { text: "content" },
    summary: "a summary",
    provenance: provenance(),
    ...overrides,
  };
}

function seed(target: MemoryStore, overrides: Partial<MemoryDraft> = {}): string {
  const outcome = target.store(draft(overrides));
  assert.equal(outcome.ok, true, "fixture store");
  if (!outcome.ok || outcome.value.kind !== "stored") throw new Error("unreachable");
  return outcome.value.item.id;
}

describe("PHASE 07 EVIDENCE - authorisation", () => {
  /* -- trust level: the field that nothing honoured --------------------------- */

  it("withholds a grant from a subject below its minimum trust", () => {
    // `MemorySubject.trustLevel` was declared with the comment "so a grant can be
    // withheld from a low-trust subject" and was READ NOWHERE - a declared guarantee
    // that guaranteed nothing.
    //
    // The trap: it is a field on the SUBJECT, so enforcing it naively would let a
    // caller write `trustLevel: "privileged"` into its own subject and grant itself
    // everything. It is only safe because the value comes from the VERIFIED identity -
    // `authority.ts` copies `securityContext.trustLevel`, which the identity resolver
    // produced - and because an ABSENT value is treated as the lowest, not the highest.
    const policy = new MemoryAccessPolicy({ nowMs: () => NOW_MS });
    const strict = grant({ minimumTrust: "high" });

    for (const [level, expected] of [
      ["untrusted", false],
      ["low", false],
      ["standard", false],
      ["high", true],
      ["privileged", true],
      [undefined, false],
    ] as const) {
      const s = subject({ trustLevel: level });
      policy.grant({ ...strict, subject: s });
      assert.equal(
        policy.canRead(s, "task"),
        expected,
        `a ${String(level)} subject against a "high" minimum: expected ${String(expected)}`,
      );
      policy.revoke(s);
    }
  });

  it("treats an absent trust level as the lowest, not as unconstrained", () => {
    // The fail-OPEN default is the obvious mistake: `trustLevel ?? "privileged"` would
    // make omitting the field the most privileged thing a caller could do.
    const policy = new MemoryAccessPolicy({ nowMs: () => NOW_MS });
    const anonymous = subject();
    assert.equal(anonymous.trustLevel, undefined);
    policy.grant({ ...grant({ minimumTrust: "low" }), subject: anonymous });
    assert.equal(policy.canRead(anonymous, "task"), false, "no stated trust is no trust");
  });

  it("still allows a grant that names no minimum", () => {
    // Required to be the LOWEST rather than "absent means unconstrained", so that
    // adding a minimum is opt-in and omitting one cannot widen anything.
    const policy = new MemoryAccessPolicy({ nowMs: () => NOW_MS });
    const s = subject();
    policy.grant({ ...grant({ minimumTrust: "untrusted" }), subject: s });
    assert.equal(policy.canRead(s, "task"), true, "the lowest minimum admits even an untrusted subject");
  });

  /* -- read and write are different permissions ------------------------------- */

  it("keeps read and write separate at every scope", () => {
    const policy = new MemoryAccessPolicy({ nowMs: () => NOW_MS });
    const s = subject({ operatingScope: "project" });
    policy.grant(grant({ subject: s, scopes: ["task", "project"], writableScopes: ["task"] }));

    assert.equal(policy.canRead(s, "project"), true);
    assert.equal(policy.canWrite(s, "project"), false, "read is not write");
    assert.equal(policy.canWrite(s, "task"), true, "and the writable scope is writable");
    assert.equal(policy.assertWrite(s, "project").ok, false, "assertWrite refuses rather than throws");
    assert.equal(policy.assertRead(s, "project").ok, true);
  });

  /* -- identity: nothing is derivable from a caller-supplied string ----------- */

  it("gives a caller-chosen taskId, jobId or subjectId no authority at all", () => {
    const policy = new MemoryAccessPolicy({ nowMs: () => NOW_MS });
    const real = subject({ id: "agent:real@1.0.0" });
    policy.grant(grant({ subject: real, scopes: ["task"], writableScopes: ["task"] }));

    // Every shape a caller might present. All are simply absent from the grant map.
    for (const presented of [
      "task:task-1",
      "job:job-1",
      "task-1",
      "job-1",
      "user:admin",
      "",
      "   ",
    ]) {
      const forged = subject({ id: presented });
      assert.equal(
        policy.canRead(forged, "task"),
        false,
        `"${presented}" must reach nothing: a string is not an identity`,
      );
    }
    assert.equal(policy.canRead(real, "task"), true, "and the real subject still reads");
  });

  it("keys grants on workspace AND subject, so a peer cannot borrow a grant", () => {
    const policy = new MemoryAccessPolicy({ nowMs: () => NOW_MS });
    const inAcme = subject();
    const inBrand = subject({ workspace: ACME_BRAND });
    const inGlobex = subject({ workspace: GLOBEX });
    policy.grant(grant({ subject: inAcme }));

    assert.equal(policy.canRead(inAcme, "task"), true);
    assert.equal(policy.canRead(inBrand, "task"), false, "a sibling brand is a different partition");
    assert.equal(policy.canRead(inGlobex, "task"), false);
    assert.equal(policy.revoke(inGlobex), false, "and a revoke from elsewhere revokes nothing");
  });

  /* -- the store refuses what the policy would not authorise ------------------ */

  it("reads and writes only its own workspace, at every scope", () => {
    for (const scope of ["conversation", "task", "project", "global"] as const) {
      const acme = store(clock(), ACME);
      seed(acme, { scope, key: "k" });

      const brand = store(clock(), ACME_BRAND);
      const globex = store(clock(), GLOBEX);
      assert.equal(brand.get(scope, "k"), null, `${scope}: brand must not read acme`);
      assert.equal(globex.get(scope, "k"), null, `${scope}: globex must not read acme`);
      assert.equal(brand.listScope(scope).length, 0);
      // And the owning store still reads it, so the negative is not "nothing exists".
      assert.ok(acme.get(scope, "k"), `${scope}: the owner must still read its own`);
    }
  });
});

describe("PHASE 07 EVIDENCE - retention and expiry", () => {
  it("hides an expired memory from every read path", () => {
    const target = clock();
    const s = store(target);
    seed(s, { key: "k", expiresAt: NOW_MS + 1_000 });

    assert.ok(s.get("task", "k"), "before expiry it is readable");
    assert.equal(s.listScope("task").length, 1);

    target.advance(2_000);

    assert.equal(s.get("task", "k"), null, "get must not return an expired memory");
    assert.equal(s.listScope("task").length, 0, "nor list it");
    assert.equal(s.listScope("task", { includeExpired: true }).length, 1, "unless the caller opts in");
    // The opt-in is opt-IN: `includeExpired: true` resurrects the item for a caller that
    // asked, and only for that caller.
    assert.ok(s.get("task", "k", { includeExpired: true }), "and `get` honours the same opt-in");
    assert.equal(s.liveCount(), 0);
  });

  it("keeps an expired memory on the record, so the history stays answerable", () => {
    // Expiry is a READ decision, not a deletion. "What did we once believe, and when
    // did it stop being current?" has to remain answerable, or a store that forgets on a
    // timer cannot explain itself.
    const target = clock();
    const s = store(target);
    seed(s, { key: "k", expiresAt: NOW_MS + 1_000 });
    target.advance(2_000);

    assert.equal(s.listScope("task", { includeInactive: true }).length, 1, "the record survives");
    assert.equal(s.historyFor("task", "k").length, 1, "and so does its history");
  });

  it("keeps expiry inside its own workspace", () => {
    // An expired memory must not become readable because a DIFFERENT partition forgot
    // to expire it - i.e. expiry may never widen access.
    const target = clock();
    const acme = store(target, ACME);
    const globex = store(target, GLOBEX);
    seed(acme, { key: "k", expiresAt: NOW_MS + 1_000 });
    target.advance(2_000);

    assert.equal(acme.get("task", "k"), null);
    assert.equal(globex.get("task", "k"), null, "and another workspace gains nothing from the expiry");
  });

  it("gives an expired write-policy TTL to every memory it accepts", () => {
    const policy = new DefaultWritePolicy();
    const evaluated = policy.evaluate(
      draft({ type: "conversational", summary: "a chat turn", importance: 0.5 }),
      NOW_MS,
    );
    assert.ok(evaluated.draft, "a conversational memory is above the floor");
    assert.notEqual(
      evaluated.draft.expiresAt,
      null,
      "a conversational memory is short-lived by policy and must say when it ends",
    );
    assert.ok((evaluated.draft.expiresAt ?? 0) > NOW_MS, "and its expiry is in the future");
  });
});
