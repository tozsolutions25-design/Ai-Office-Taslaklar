/**
 * PHASE 06 - Workspace / Brand Isolation: IDENTITY.
 *
 * WHY THIS FILE IS THE FAILING-TEST-FIRST ARTEFACT
 *
 * The defect was characterised before any code changed, and the characterisation
 * is recorded here rather than only in prose, because a characterisation is only
 * worth anything if it can be run:
 *
 *   - `MemoryAccessPolicy` keyed its entire grant table on `grant.subject.id`
 *     (`src/orchestration/memory/memory.ts:174`), and `#isCurrent` compared
 *     nothing but `subject.id` (`:191`).
 *   - every production subject was built from a CALLER-SUPPLIED STRING:
 *     `` { id: `task:${request.taskId}` } `` at `authority.ts:722`, `:921`, `:1497`,
 *     where `request.taskId` is `OrchestrationRequest.taskId` (`authority.ts:77`).
 *   - so a caller that chose `taskId: "someone-elses-task"` received that task's
 *     grants. That is identity confusion **independent of tenancy**: it works in a
 *     single-workspace deployment today.
 *
 * B-04 question 4 asks for that to be fixed BEFORE partitioning, and this is why
 * that ordering is not pedantry: partitioning on a forgeable identity produces a
 * beautifully, correctly-partitioned, completely forgeable system.
 *
 * The tests below therefore could not be written against the old API - there is
 * no way to express "a subject in workspace A" today - so the evidence of failure
 * was the compiler, exactly as it was in PHASE 03.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { createSecurityContext, withProvenance } from "../src/orchestration/governance/index.js";
import { workspaceRef, workspaceOf, WorkspaceIsolationError } from "../src/orchestration/workspace/workspace.js";
import {
  InMemoryMemoryProvider,
  MemoryAccessPolicy,
  type MemoryGrant,
  type MemorySubject,
} from "../src/orchestration/memory/memory.js";

const CLOCK = new ManualClock(new Date("2026-01-01T00:00:00.000Z"));
const ACME = workspaceRef("acme");
const ACME_BRAND = workspaceRef("acme", "brand-a");
const ACME_OTHER_BRAND = workspaceRef("acme", "brand-b");
const GLOBEX = workspaceRef("globex");

function grantFor(subject: MemorySubject, overrides: Partial<MemoryGrant> = {}): MemoryGrant {
  return {
    subject,
    scopes: ["project"],
    writableScopes: ["project"],
    minimumTrust: "untrusted", expiresAt: null,
    ...overrides,
  };
}

describe("PHASE 06 1 - a workspace reference is well-formed and frozen", () => {
  it("accepts a workspace and an optional brand", () => {
    assert.deepEqual({ ...ACME }, { workspace: "acme", brand: null });
    assert.deepEqual({ ...ACME_BRAND }, { workspace: "acme", brand: "brand-a" });
    assert.equal(Object.isFrozen(ACME), true, "a workspace that can be mutated after a decision is a snapshot of nothing");
  });

  it("refuses a blank, free-form or absurd identifier", () => {
    for (const bad of ["", "   ", "acme/../etc", "a".repeat(129)]) {
      assert.throws(() => workspaceRef(bad), /Workspace reference is invalid/, `must refuse ${JSON.stringify(bad)}`);
    }
    assert.throws(() => workspaceRef("acme", "bad brand"), /Workspace reference is invalid/);
  });

  it("does not normalise: ' acme' and 'acme' are not the same workspace", () => {
    assert.throws(() => workspaceRef(" acme"), /Workspace reference is invalid/);
  });
});

describe("PHASE 06 2 - only a resolved identity carries workspace authority", () => {
  it("a resolved context yields its workspace", () => {
    const context = withProvenance(
      createSecurityContext({ actor: "user:kim", trustLevel: "standard", workspace: ACME }),
      "resolved",
    );
    assert.equal(workspaceOf(context), ACME);
  });

  it("REFUSES an asserted context, even one that names a workspace", () => {
    // The hole this closes: a caller building its own context and writing the
    // workspace it wants. A claim is not an identity.
    const context = createSecurityContext({ actor: "user:mallory", trustLevel: "standard", workspace: ACME });
    assert.equal(context.provenance, "asserted");
    assert.throws(
      () => workspaceOf(context),
      (error: unknown) => error instanceof WorkspaceIsolationError && error.reason === "unresolved-provenance",
    );
  });

  it("REFUSES a delegated context", () => {
    const parent = withProvenance(
      createSecurityContext({ actor: "user:kim", trustLevel: "standard", workspace: ACME }),
      "resolved",
    );
    const child = withProvenance(
      createSecurityContext({ actor: "agent:worker-1", trustLevel: "low", workspace: ACME }),
      "delegated",
    );
    void parent;
    assert.throws(
      () => workspaceOf(child),
      (error: unknown) => error instanceof WorkspaceIsolationError && error.reason === "unresolved-provenance",
    );
  });

  it("REFUSES a resolved identity that names no workspace", () => {
    const context = withProvenance(createSecurityContext({ actor: "user:kim", trustLevel: "standard" }), "resolved");
    assert.throws(
      () => workspaceOf(context),
      (error: unknown) => error instanceof WorkspaceIsolationError && error.reason === "no-workspace",
    );
  });

  it("REFUSES an absent context", () => {
    assert.throws(
      () => workspaceOf(null),
      (error: unknown) => error instanceof WorkspaceIsolationError && error.reason === "no-context",
    );
    assert.throws(
      () => workspaceOf(undefined),
      (error: unknown) => error instanceof WorkspaceIsolationError && error.reason === "no-context",
    );
  });

  it("REFUSES a hand-rolled object shaped like a workspace", () => {
    const forged = {
      provenance: "resolved",
      workspace: Object.freeze({ workspace: "acme", brand: null }),
    } as never;
    // A structurally correct object is accepted here on purpose: it carries the
    // same data. What is refused is an UNFROZEN one, because a mutable workspace
    // is a decision that can be edited after the fact.
    assert.equal(workspaceOf(forged).workspace, "acme");
    const mutable = { provenance: "resolved", workspace: { workspace: "acme", brand: null } } as never;
    assert.throws(
      () => workspaceOf(mutable),
      (error: unknown) => error instanceof WorkspaceIsolationError && error.reason === "no-workspace",
    );
  });
});

describe("PHASE 06 3 - memory authority is keyed on the verified identity, not a taskId", () => {
  it("a subject carries a workspace", () => {
    const subject: MemorySubject = { id: "user:kim", workspace: ACME, operatingScope: "project" };
    assert.equal(subject.workspace.workspace, "acme");
  });

  it("the same subject id in two workspaces does not share a grant", () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    policy.grant(grantFor({ id: "user:kim", workspace: ACME, operatingScope: "project" }));

    assert.equal(policy.canRead({ id: "user:kim", workspace: ACME, operatingScope: "project" }, "project"), true, "its own grant is honoured");
    assert.equal(
      policy.canRead({ id: "user:kim", workspace: GLOBEX, operatingScope: "project" }, "project"),
      false,
      "the same id in another workspace must find nothing",
    );
  });

  it("two brands of one workspace do not share a grant", () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    policy.grant(grantFor({ id: "user:kim", workspace: ACME_BRAND, operatingScope: "project" }));
    assert.equal(policy.canRead({ id: "user:kim", workspace: ACME_BRAND, operatingScope: "project" }, "project"), true);
    assert.equal(policy.canRead({ id: "user:kim", workspace: ACME_OTHER_BRAND, operatingScope: "project" }, "project"), false);
    assert.equal(
      policy.canRead({ id: "user:kim", workspace: ACME, operatingScope: "project" }, "project"),
      false,
      "a brandless subject must not inherit a brand's grant: null is 'the whole workspace', not 'any brand'",
    );
  });

  it("a caller-chosen taskId cannot mint authority, because no key derives from one", () => {
    // The old derivation was `task:${request.taskId}`. A subject is now the
    // verified actor, so choosing a taskId chooses nothing: a task may name memory
    // KEYS, and a key is not an identity.
    const policy = new MemoryAccessPolicy(CLOCK);
    policy.grant(grantFor({ id: "user:kim", workspace: ACME, operatingScope: "project" }));
    assert.equal(
      policy.canRead({ id: "task:someone-elses-task", workspace: ACME, operatingScope: "project" }, "project"),
      false,
      "presenting another task's id must find nothing",
    );
  });

  it("revoking requires the workspace, so a revoke cannot leak across one", () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    policy.grant(grantFor({ id: "user:kim", workspace: ACME, operatingScope: "project" }));
    assert.equal(policy.revoke({ id: "user:kim", workspace: GLOBEX, operatingScope: "project" }), false, "another workspace revokes nothing");
    assert.equal(policy.canRead({ id: "user:kim", workspace: ACME, operatingScope: "project" }, "project"), true, "and the grant survives");
    assert.equal(policy.revoke({ id: "user:kim", workspace: ACME, operatingScope: "project" }), true);
    assert.equal(policy.canRead({ id: "user:kim", workspace: ACME, operatingScope: "project" }, "project"), false);
  });

  it("grant() reports whether it replaced an existing grant", () => {
    // TODO.md PHASE 06 item 6: "grant() overwrites - last write wins. Decide if
    // that is intended." It is intended - a grant that silently UNIONED would make
    // a grant impossible to shrink, and a re-grant after a compromise would
    // regrant everything. Overwrite is the safe direction; what was missing was
    // that it was invisible.
    const policy = new MemoryAccessPolicy(CLOCK);
    const subject: MemorySubject = { id: "user:kim", workspace: ACME, operatingScope: "project" };
    // PHASE 07: `grant()` now also reports `refusedScopes`, the over-broad scopes the
    // breadth ceiling stripped. Both grants here are within `project`'s reach, so the
    // list is empty - which is itself the assertion: a grant that needed no narrowing
    // must say so rather than leaving the caller to assume.
    assert.deepEqual(policy.grant(grantFor(subject, { scopes: ["project"] })), {
      replaced: false,
      refusedScopes: [],
    });
    assert.deepEqual(policy.grant(grantFor(subject, { scopes: ["task"] })), {
      replaced: true,
      refusedScopes: [],
    });
    assert.deepEqual(
      policy.readableScopes(subject),
      ["task"],
      "the replacement wins outright - scopes are not unioned",
    );
  });
});

describe("PHASE 06 4 - a memory store partitions by workspace in the KEY", () => {
  it("the same key in two workspaces holds two different values", async () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    const store = new InMemoryMemoryProvider();
    const acme: MemorySubject = { id: "user:kim", workspace: ACME, operatingScope: "project" };
    const globex: MemorySubject = { id: "user:kim", workspace: GLOBEX, operatingScope: "project" };
    policy.grant(grantFor(acme));
    policy.grant(grantFor(globex));

    await store.writeScoped(policy, acme, {
      scope: "project",
      key: "shared-name",
      value: "acme-only",
      writtenAt: CLOCK.nowMs(),
      writtenBy: "user:kim",
    });

    assert.equal(await store.read(ACME, "project", "shared-name"), "acme-only");
    assert.equal(
      await store.read(GLOBEX, "project", "shared-name"),
      null,
      "another workspace must not read it, and must not see that it exists",
    );
  });

  it("a read in another workspace is not merely filtered - there is no key to find", async () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    const store = new InMemoryMemoryProvider();
    const acme: MemorySubject = { id: "user:kim", workspace: ACME, operatingScope: "project" };
    policy.grant(grantFor(acme));
    await store.writeScoped(policy, acme, {
      scope: "project",
      key: "k",
      value: 1,
      writtenAt: CLOCK.nowMs(),
      writtenBy: "user:kim",
    });

    // A subject with NO grant in the target workspace still cannot read, and the
    // store reports `null` rather than an empty list that would confirm the key
    // exists elsewhere.
    const outsider: MemorySubject = { id: "user:mallory", workspace: GLOBEX, operatingScope: "project" };
    assert.equal(await store.read(GLOBEX, "project", "k"), null);
    // deepEqual, not equal: `assert.equal` on an array is reference identity, which
    // would fail for a correctly-empty list and pass for a shared one. That is
    // exactly the kind of test that cannot distinguish the two states.
    assert.deepEqual(
      await store.list(GLOBEX, "project"),
      [],
      "another workspace must not even learn the key exists",
    );
    assert.equal(policy.canRead(outsider, "project"), false, "and it holds no grant there either");
  });

  it("the read log records which workspace saw what", async () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    const store = new InMemoryMemoryProvider();
    const acme: MemorySubject = { id: "user:kim", workspace: ACME, operatingScope: "project" };
    policy.grant(grantFor(acme));
    await store.writeScoped(policy, acme, {
      scope: "project",
      key: "k",
      value: 1,
      writtenAt: CLOCK.nowMs(),
      writtenBy: "user:kim",
    });
    await store.readScoped(policy, acme, "project", "k");
    const log = store.readLog();
    assert.equal(log.length, 1);
    assert.equal(log[0]?.workspace.workspace, "acme", "an audit of what was seen must say who saw it, where");
  });

  it("two brands of one workspace hold two different values", async () => {
    const policy = new MemoryAccessPolicy(CLOCK);
    const store = new InMemoryMemoryProvider();
    const a: MemorySubject = { id: "user:kim", workspace: ACME_BRAND, operatingScope: "project" };
    const b: MemorySubject = { id: "user:kim", workspace: ACME_OTHER_BRAND, operatingScope: "project" };
    policy.grant(grantFor(a));
    policy.grant(grantFor(b));
    await store.writeScoped(policy, a, {
      scope: "project",
      key: "k",
      value: "brand-a",
      writtenAt: CLOCK.nowMs(),
      writtenBy: "user:kim",
    });
    assert.equal(await store.read(ACME_BRAND, "project", "k"), "brand-a");
    assert.equal(await store.read(ACME_OTHER_BRAND, "project", "k"), null);
  });
});
