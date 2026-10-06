/**
 * PHASE 07 EVIDENCE - memory scope semantics, and the breadth ceiling.
 *
 * ## WHY THIS FILE EXISTS
 *
 * `MemoryScope` is an eleven-value closed enum, and until Phase 07 the words
 * "narrowest" and "widest" had no enforcement anywhere. `SCOPE_BREADTH` was declared,
 * documented as the thing retrieval used, and had **no production caller at all** -
 * `isBroaderScope` and `importanceCeilingFor` were both unreferenced. So the invariant
 * the enum's own comment described - "a task may read its own memory and anything
 * narrower, but a `global` memory is not injected into a task merely because it
 * exists" - was not merely weakly implemented. It was absent.
 *
 * This file makes it a property of the GRANT, which is the one place authority is
 * conferred, rather than a second check on the read path. See `DECISIONS.md` D-51.
 *
 * ## THE FOUR PROPERTIES EVERY SCOPE MUST HAVE
 *
 * The brief asks for four separations - system / workspace+brand / task+run / episodic
 * history - and asks that each scope's breadth, isolation, visibility, retention,
 * authorization and subject relation be unambiguous. `SCOPE_SEMANTICS` below is that
 * statement, and it is asserted rather than described: a scope whose semantics are
 * prose can drift from the code, and a scope whose semantics are a value cannot.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  MemoryAccessPolicy,
  MEMORY_SCOPES,
  type MemoryGrant,
  type MemoryScope,
  type MemorySubject,
} from "../src/orchestration/memory/memory.js";
import { MAX_SCOPE_BREADTH, SCOPE_BREADTH } from "../src/orchestration/memory/model.js";
import { InMemoryMemoryProvider } from "../src/orchestration/memory/memory.js";
import { MemoryStore } from "../src/orchestration/memory/store.js";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";

const ACME = workspaceRef("acme");
const GLOBEX = workspaceRef("globex");
const NOW_MS = 1_800_000_000_000;

/** A clock that never moves, so expiry cannot confound a grant test. */
const CLOCK = { nowMs: () => NOW_MS };

function subject(overrides: Partial<MemorySubject> = {}): MemorySubject {
  return { id: "agent:researcher@1.0.0", workspace: ACME, operatingScope: "task", ...overrides };
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

function readSource(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

/* -------------------------------------------------------------------------- */
/* The scope table under test                                                  */
/* -------------------------------------------------------------------------- */

interface ScopeSemantics {
  readonly scope: MemoryScope;
  /**
   * The retention class this scope is INTENDED to carry - how long the memory is meant to
   * outlast the context that produced it.
   *
   * It is emphatically NOT a claim of durability. No scope in this build survives a
   * restart: the only provider is `InMemoryMemoryProvider`, which is process-local by
   * design. `durable` here means "this scope is not given a TTL and is meant to outlive
   * its context once a durable provider exists" - which is Phase 12's work, not this
   * phase's.
   *
   * The first draft of this table said "whether a memory in this scope survives a restart"
   * over the same column, which was a false statement sitting in a test file: nine scopes
   * were labelled durable by a build that loses all of them on exit. The separate
   * "makes no durability claim" test below is what now holds the honest version of that
   * sentence, so the intent column cannot drift back into a promise.
   */
  readonly retention: "ephemeral" | "durable";
  /** Whether the scope is reachable from a subject at a NARROWER operating scope. */
  readonly reachableFromNarrower: boolean;
}

/**
 * The semantics table, written out independently of `src/` so that this file states
 * what it believes and the test compares the two. A table asserted against itself
 * proves nothing; this one can disagree with the implementation and fail.
 *
 * `reachableFromNarrower` is FALSE only for `conversation`, because nothing is narrower
 * than the narrowest. Every other scope is reachable from SOME subject operating below
 * it - which is what the breadth ceiling means: a subject at scope S reaches S and
 * everything narrower, and nothing above.
 */
const SCOPE_SEMANTICS: readonly ScopeSemantics[] = [
  { scope: "conversation", retention: "ephemeral", reachableFromNarrower: false },
  { scope: "task", retention: "ephemeral", reachableFromNarrower: true },
  { scope: "agent", retention: "durable", reachableFromNarrower: true },
  { scope: "team", retention: "durable", reachableFromNarrower: true },
  { scope: "project", retention: "durable", reachableFromNarrower: true },
  { scope: "provider", retention: "durable", reachableFromNarrower: true },
  { scope: "pattern", retention: "durable", reachableFromNarrower: true },
  { scope: "knowledge", retention: "durable", reachableFromNarrower: true },
  { scope: "system", retention: "durable", reachableFromNarrower: true },
  { scope: "organization", retention: "durable", reachableFromNarrower: true },
  { scope: "global", retention: "durable", reachableFromNarrower: true },
];

/* -------------------------------------------------------------------------- */
/* Tests                                                                        */
/* -------------------------------------------------------------------------- */

describe("PHASE 07 EVIDENCE - memory scope semantics", () => {
  /* -- the breadth ordering, as a property of the enum ----------------------- */

  it("ranks every scope, densely and without ties", () => {
    assert.equal(MAX_SCOPE_BREADTH, MEMORY_SCOPES.length - 1);
    const ranks = MEMORY_SCOPES.map((scope) => SCOPE_BREADTH[scope]);
    assert.deepEqual(
      ranks,
      MEMORY_SCOPES.map((_, index) => index),
      "breadth must be a dense 0..n ranking; a tie would make two scopes compare as neither broader",
    );
  });

  it("orders the eleven scopes from conversation to global, and `global` is the widest", () => {
    assert.equal(
      MEMORY_SCOPES[0],
      "conversation",
      "conversation is the narrowest: it is one exchange",
    );
    assert.equal(
      MEMORY_SCOPES[MEMORY_SCOPES.length - 1],
      "global",
      "global is the widest and is implied by no other grant",
    );
  });

  it("states a retention class and a breadth direction for every scope", () => {
    assert.deepEqual(
      SCOPE_SEMANTICS.map((entry) => entry.scope),
      [...MEMORY_SCOPES],
      "the semantics table must cover every scope, in breadth order",
    );
    for (const entry of SCOPE_SEMANTICS) {
      assert.ok(
        ["ephemeral", "durable"].includes(entry.retention),
        `${entry.scope} must state a retention class`,
      );
      assert.equal(
        entry.reachableFromNarrower,
        SCOPE_BREADTH[entry.scope] > 0,
        `${entry.scope}: a scope is reachable from a narrower subject unless it is the narrowest`,
      );
    }
  });

  /* -- the ceiling, on the GRANT, not on the read path ------------------------ */

  it("refuses to record a grant naming a scope broader than the subject's operating scope", () => {
    // The invariant that had no implementation. A task-scoped subject must not be able
    // to hold a grant for `global` memory, however it was configured.
    const policy = new MemoryAccessPolicy(CLOCK);
    const outcome = policy.grant(
      grant({ scopes: ["task", "conversation", "global", "organization"], writableScopes: [] }),
    );

    assert.deepEqual(
      [...outcome.refusedScopes].sort(),
      ["global", "organization"],
      "the over-broad scopes must be named back to the caller",
    );
    assert.deepEqual(
      [...policy.readableScopes(subject())].sort(),
      ["conversation", "task"],
      "and must not be recorded",
    );
  });

  it("allows a grant of the operating scope and everything narrower", () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    const outcome = policy.grant(grant({ scopes: [...MEMORY_SCOPES.slice(0, 2)] }));
    assert.deepEqual([...outcome.refusedScopes], [], "nothing about task's own breadth is over-broad");
    assert.deepEqual([...policy.readableScopes(subject())].sort(), ["conversation", "task"]);
  });

  it("lets a wider operating scope reach further, but never past the widest", () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    const org = subject({ operatingScope: "organization" });
    const outcome = policy.grant(grant({ subject: org, scopes: [...MEMORY_SCOPES] }));
    assert.deepEqual([...outcome.refusedScopes], ["global"], "only the scope above `organization` is refused");
    assert.equal(policy.readableScopes(org).length, MEMORY_SCOPES.length - 1);
  });

  it("applies the ceiling to WRITABLE scopes too, not only to readable ones", () => {
    // The obvious place to add the check and get half the guarantee. A subject that
    // cannot read `global` but can WRITE it would be a memory nobody can audit.
    const policy = new MemoryAccessPolicy(CLOCK);
    const outcome = policy.grant(
      grant({ scopes: ["task"], writableScopes: ["task", "global"] }),
    );
    assert.deepEqual([...outcome.refusedScopes], ["global"]);
    assert.equal(policy.canWrite(subject(), "task"), true);
    assert.equal(policy.canWrite(subject(), "global"), false);
  });

  it("reports an over-broad grant rather than refusing it whole", () => {
    // A whole-grant refusal would be safer and far more disruptive: a deployment that
    // grants `["task", "global"]` would lose its `task` access too and present as a
    // policy that rejects all memory. Narrowing plus a REPORT is the safe direction -
    // the caller learns exactly what it lost, so the misconfiguration is fixable.
    const policy = new MemoryAccessPolicy(CLOCK);
    policy.grant(grant({ scopes: ["global"] }));
    assert.equal(policy.canRead(subject(), "task"), false, "no access is invented for scopes it did not ask for");
    assert.deepEqual(policy.readableScopes(subject()), [], "an entirely over-broad grant grants nothing");
  });

  /* -- the ceiling is the GRANT's, and the read path trusts it ---------------- */

  it("does not re-check breadth on the read path", () => {
    // Asserted as an ABSENCE, because a second check is the failure mode this design
    // exists to prevent. `canRead` must consult the grant alone: if breadth were also
    // evaluated there, the policy would have two places that decide, and a future edit
    // could make them disagree - which is a memory the system both granted and refused.
    const policy = new MemoryAccessPolicy(CLOCK);
    policy.grant(grant({ scopes: ["task"] }));
    const source = readSource("src/orchestration/memory/memory.ts");
    const canRead = source.slice(source.indexOf("  public canRead("), source.indexOf("  #isCurrent("));
    assert.doesNotMatch(
      canRead,
      /SCOPE_BREADTH|isBroaderScope|MAX_SCOPE_BREADTH/,
      "canRead must consult the grant alone; breadth is settled when the grant is recorded",
    );
  });

  it("settles breadth in exactly one function", () => {
    // Counted by FUNCTION, not by occurrence: `withinBreadth` reads the table twice in
    // one expression (`scope` and `operatingScope`), and an occurrence count would
    // report two authorities where there is one. What must not happen is a SECOND
    // function deciding, because then the ceiling could be enforced in two places that
    // disagree.
    const source = readSource("src/orchestration/memory/memory.ts");
    const functions = [...source.matchAll(/^(?:export )?function (\w+)\(/gm)]
      .map((m) => m[1])
      .filter((name) => {
        const at = source.indexOf(`function ${name}(`);
        const body = source.slice(at, source.indexOf("\n}", at));
        return body.includes("SCOPE_BREADTH");
      });
    assert.deepEqual(functions, ["withinBreadth"], "only `withinBreadth` may consult breadth");
  });

  it("makes no durability claim: a fresh provider starts empty, whatever the table says", () => {
    // The honest half of the `retention` column. Nine scopes are labelled `durable`, and
    // this build loses ALL of them on exit, because the only provider is
    // `InMemoryMemoryProvider`. That is a legitimate design for a phase whose job is the
    // access model - but it is a claim that has to be made somewhere, or the table's
    // `durable` quietly becomes a promise nobody implemented.
    //
    // Asserted rather than asserted-in-prose on purpose: when a durable provider arrives
    // (Phase 12), this test fails, and whoever adds it has to decide what the column then
    // means instead of the two drifting apart unremarked.
    const clock = { nowMs: () => NOW_MS, now: () => new Date(NOW_MS), sleep: async () => {} };
    const store = new MemoryStore({ workspace: ACME, provider: new InMemoryMemoryProvider(), clock });
    const written = store.store({
      scope: "global",
      key: "k",
      type: "semantic",
      value: { text: "content" },
      summary: "a summary",
      provenance: {
        source: "system",
        sourceRef: "test:1",
        sourceReference: "test:1",
        taskId: null,
        traceId: null,
        observedAt: NOW_MS,
        verification: null,
      },
    });
    assert.ok(written.ok, "the write must succeed");
    assert.equal(store.liveCount(), 1, "and be readable in this process");

    // "Restart" for a process-local provider is a new provider instance.
    const afterRestart = new MemoryStore({
      workspace: ACME,
      provider: new InMemoryMemoryProvider(),
      clock,
    });
    assert.equal(afterRestart.liveCount(), 0, "nothing survives a restart in this phase");
    assert.equal(afterRestart.get("global", "k"), null, "not even a `durable` scope");
  });

  it("gives every production subject the `task` operating scope", () => {
    // Structural, and deliberately so. Nothing observable from OUTSIDE the orchestrator
    // can tell whether `#memorySubject` hands back `task` or `global`: a production subject
    // is never constructed by a test, so a behavioural suite would pass either way and the
    // mutation battery would report a survivor that is in fact a live over-broad grant.
    //
    // This is the PHASE 07 requirement that the actor's reach cannot be chosen by the
    // caller. `MemorySubject.operatingScope` is a required field, so a caller CAN name
    // `global` - the guarantee is not "the field cannot lie", it is "production has exactly
    // one place that fills it, and that place does not take an argument". Hence the search
    // for EVERY construction rather than a check of the one we expect.
    const source = readSource("src/orchestration/authority.ts");
    const constructions = [...source.matchAll(/operatingScope:\s*"(\w+)"/g)].map((m) => m[1]);
    assert.ok(constructions.length > 0, "expected at least one production memory subject");
    assert.deepEqual(
      [...new Set(constructions)],
      ["task"],
      "every production memory subject must operate at `task`; a second value is an actor-chosen reach",
    );
    // And the parameter must not exist: a factory that accepted the scope would let the
    // caller pick, however carefully the current call site reads.
    assert.doesNotMatch(
      source.slice(source.indexOf("#memorySubject(")),
      /#memorySubject\([^)]*operatingScope/s,
      "#memorySubject must not accept an operating scope from its caller",
    );
  });

  /* -- isolation, from Phase 06, must survive all of this -------------------- */

  it("keeps the ceiling and the partition independent: a ceiling is not a partition", () => {
    // The ceiling is about REACH; the partition is about POSSESSION. They must not be
    // confused into one mechanism, because a ceiling cannot substitute for a partition:
    // two subjects at the SAME operating scope in DIFFERENT workspaces must still be
    // separate, and two in different scopes in the SAME workspace must still collide.
    const policy = new MemoryAccessPolicy(CLOCK);
    const inAcme = subject();
    const inGlobex = subject({ workspace: GLOBEX });
    // A DISTINCT id, not the same subject at a wider scope. `grantKey` is
    // `(workspace, id)`, so two subjects sharing an id in one workspace are one
    // subject - the second grant legitimately replaces the first, and asserting they
    // coexist would have been asserting that the policy fails to key on identity.
    const projectWorker = subject({ id: "agent:planner@1.0.0", operatingScope: "project" });

    policy.grant(grant({ subject: inAcme, scopes: ["task"] }));
    policy.grant(grant({ subject: inGlobex, scopes: ["task"] }));

    // Same operating scope, different workspace: separated by PARTITION, not ceiling.
    assert.equal(policy.canRead(inAcme, "task"), true);
    assert.equal(policy.canRead(inGlobex, "task"), true);
    assert.deepEqual(policy.readableScopes(inAcme), policy.readableScopes(inGlobex));

    // Same workspace, different subject, wider operating scope: still separate, because
    // breadth is a property of the subject, not a shared allowance.
    policy.grant(grant({ subject: projectWorker, scopes: ["task", "project"] }));
    assert.equal(policy.canRead(projectWorker, "project"), true);
    assert.equal(policy.canRead(inAcme, "project"), false, "the ceiling must not leak between subjects");
  });

  it("treats a subject with no grant as having no access, whatever its operating scope", () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    const root = subject({ operatingScope: "global" });
    assert.equal(policy.canRead(root, "global"), false, "breadth is a ceiling, not a grant");
    assert.deepEqual(policy.readableScopes(root), []);
  });

  it("still refuses an expired grant at every operating scope", () => {
    // The expiry check and the breadth ceiling are independent, and the order matters:
    // an expired grant is no grant, so the ceiling never gets a chance to matter.
    for (const operatingScope of MEMORY_SCOPES) {
      const policy = new MemoryAccessPolicy(CLOCK);
      const s = subject({ operatingScope });
      policy.grant(grant({ subject: s, scopes: [operatingScope], expiresAt: NOW_MS - 1 }));
      assert.equal(
        policy.canRead(s, operatingScope),
        false,
        `an expired grant at operating scope "${operatingScope}" must not read`,
      );
      assert.deepEqual(policy.readableScopes(s), []);
    }
  });
});
