/**
 * PHASE 06 EVIDENCE - scope honesty.
 *
 * PHASE 06 partitions memory by WORKSPACE. It does NOT define what any memory SCOPE
 * may read - breadth semantics are PHASE 07 scope and are deliberately untouched here.
 *
 * That division is easy to state and easy to get wrong, because `global` is the scope
 * most likely to be misread as "readable by everyone". It is not. `global` is a
 * statement about breadth WITHIN one workspace, and the risk is that a future change
 * reads it as a sharing scope and quietly turns a per-workspace guarantee into a
 * process-wide one.
 *
 * So the guarantee is proved at EVERY scope, including the widest - because if
 * `global` is partitioned then everything narrower is too, and one test at the safe
 * end would be the one a future reader trusts.
 *
 * The seam proved here is `MemoryStore` -> `MemoryProvider`: the store is constructed
 * with a workspace and the provider keys entries by it, so a read through workspace B's
 * store can only reach workspace B's entries. No policy is involved, which is the
 * point - isolation must not depend on a caller having configured a grant.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import {
  InMemoryMemoryProvider,
  MEMORY_SCOPES,
} from "../src/orchestration/memory/memory.js";
import type { MemoryProvenance } from "../src/orchestration/memory/model.js";
import { MemoryStore } from "../src/orchestration/memory/store.js";
import { SCOPE_BREADTH } from "../src/orchestration/memory/model.js";
import * as policyModule from "../src/orchestration/memory/policy.js";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";

const CLOCK = new ManualClock(new Date("2026-01-01T00:00:00.000Z"));
/** A complete provenance block: every non-optional field, since a memory of unknown origin cannot be audited. */
function provenance(sourceRef: string): MemoryProvenance {
  return {
    source: "agent",
    sourceRef,
    taskId: null,
    traceId: null,
    observedAt: 0,
    verification: null,
    sourceReference: null,
  };
}

const A = workspaceRef("acme");
const B = workspaceRef("globex", "brand-x");

/**
 * The comment block above `SCOPE_BREADTH`, read from source.
 *
 * PHASE 07 moved that block: `SCOPE_BREADTH` now lives in `memory.ts`, beside the
 * `MEMORY_SCOPES` declaration it derives from, because `MemoryAccessPolicy` consults it
 * and `model.ts` already imports `memory.ts` - so the reverse would have been circular.
 * `model.ts` re-exports it, and a re-export carries no comment. Read from the file that
 * now holds the reasoning.
 */
function readScopeComment(): string {
  const source = readFileSync(path.join(process.cwd(), "src/orchestration/memory/memory.ts"), "utf8");
  const at = source.indexOf("export const SCOPE_BREADTH");
  const start = source.lastIndexOf("/**", at);
  return source.slice(start, at);
}

describe("PHASE 06 EVIDENCE - scope honesty", () => {
  /* ----------------------------------------------------- the isolation claim -- */

  it("partitions every scope, `global` included, exactly as it partitions `conversation`", () => {
    for (const scope of MEMORY_SCOPES) {
      const provider = new InMemoryMemoryProvider();
      const storeA = new MemoryStore({ provider, clock: CLOCK, workspace: A });
      const storeB = new MemoryStore({ provider, clock: CLOCK, workspace: B });

      const written = storeA.store({
        scope,
        key: `k-${scope}`,
        type: "semantic",
        value: `secret-${scope}-${A.workspace}`,
        summary: `a ${scope} memory belonging to ${A.workspace}`,
        provenance: provenance(`agent:${A.workspace}`),
      });
      assert.equal(written.ok, true, `A must be able to write its own ${scope} memory`);

      // B reads the same scope through its own store. No grant, no policy - if the
      // partition depended on a caller configuring access, this would be the wrong test.
      assert.equal(
        storeB.listScope(scope).length,
        0,
        `a ${scope} memory must not be visible to another workspace`,
      );
      assert.equal(storeB.get(scope, `k-${scope}`), null, `a ${scope} memory must not be readable`);

      // And A still reads its own, so the test is not passing because nothing was stored.
      assert.equal(storeA.listScope(scope).length, 1, `A must read back its own ${scope} memory`);
      assert.equal(storeA.get(scope, `k-${scope}`)?.value, `secret-${scope}-${A.workspace}`);
    }
  });

  it("makes an unattributed memory store unconstructible rather than merely unreachable", () => {
    // STRONGER than the test I first wrote, which tried to build a store with
    // `workspace: null` and read nothing through it. That test could not compile:
    // `MemoryStoreOptions.workspace` is REQUIRED and non-nullable, so there is no
    // unattributed memory store to construct at all.
    //
    // That is the better guarantee - a partition that cannot be instantiated cannot be
    // a wildcard - so it is asserted directly rather than approximated. The
    // `@ts-expect-error` makes the compile-time half explicit: if `workspace` ever
    // becomes optional, `tsc` fails here and this file stops claiming it.
    const provider = new InMemoryMemoryProvider();
    // @ts-expect-error PHASE 06: a memory store without a workspace must not compile.
    const unattributed = new MemoryStore({ provider, clock: CLOCK });
    void unattributed;

    const real = new MemoryStore({ provider, clock: CLOCK, workspace: A });
    assert.equal(real.workspace.workspace, A.workspace, "a constructed store is bound to its workspace");
    assert.equal(real.listScope("global").length, 0, "and starts empty, including at the widest scope");
  });

  it("gives two brands inside one workspace two separate partitions", () => {
    // The composite key is (workspace, brand). A brand must not be usable to reach a
    // sibling brand's memory, or `brand` would be a label rather than a boundary.
    const provider = new InMemoryMemoryProvider();
    const brandOne = new MemoryStore({ provider, clock: CLOCK, workspace: workspaceRef("acme", "brand-1") });
    const brandTwo = new MemoryStore({ provider, clock: CLOCK, workspace: workspaceRef("acme", "brand-2") });

    for (const scope of ["global", "organization"] as const) {
      assert.equal(
        brandOne
          .store({
            scope,
            key: `shared-${scope}`,
            type: "semantic",
            value: "brand-one-only",
            summary: "brand one",
            provenance: provenance("agent:one"),
          })
          .ok,
        true,
      );
      assert.equal(
        brandTwo.listScope(scope).length,
        0,
        `brand-2 must not read a ${scope} memory filed under brand-1`,
      );
    }
    assert.equal(brandOne.listScope("global").length, 1, "brand-1 reads its own");
  });



  /* ------------------------------------ what PHASE 06 explicitly does NOT claim -- */

  it("no longer defers breadth: PHASE 07 took it, and said where it is enforced", () => {
    // These three tests asserted that two breadth defects were STILL PRESENT, so the
    // Phase 06 deferral could not go stale while Phase 07 waited. Phase 07 fixed both,
    // so the assertions invert: they now fail if either defect is reintroduced.
    //
    // A pin that only knows how to fail in one direction is not a pin, it is a comment
    // - which is exactly why the Phase 06 version was written to fail if someone fixed
    // the defect behind its back, and why the Phase 07 version has to fail if someone
    // puts it back.
    const comment = readScopeComment();
    assert.match(comment, /PHASE 07/, "the scope table must still name the phase that owns breadth");
    assert.match(
      comment,
      /one place|exactly one/i,
      "and must name where breadth is enforced, so a second check cannot be added quietly",
    );
  });

  it("has the breadth normalisation defect FIXED, not merely recorded", () => {
    // The divisor is now `MAX_SCOPE_BREADTH`, so the widest scope no longer floors at
    // 0.5 and the `Math.max(0.2, ...)` floor is finally reachable.
    const { importanceCeilingFor } = policyModule;
    const widest = MEMORY_SCOPES.reduce((a, b) =>
      (SCOPE_BREADTH[a] ?? -1) > (SCOPE_BREADTH[b] ?? -1) ? a : b,
    );

    assert.equal(
      importanceCeilingFor(widest),
      0.2,
      "the widest scope must clamp at the floor, not at 0.5",
    );
    assert.deepEqual(
      MEMORY_SCOPES.filter((scope) => importanceCeilingFor(scope) === 0.2),
      ["system", "organization", "global"],
      "exactly the three widest scopes clamp at the floor",
    );
    // Monotone non-increasing across breadth: a wider scope may never outrank a
    // narrower one on importance.
    const ceilings = MEMORY_SCOPES.map((scope) => policyModule.importanceCeilingFor(scope));
    for (let i = 1; i < ceilings.length; i += 1) {
      assert.ok(
        ceilings[i] <= ceilings[i - 1],
        `breadth ${i} (${MEMORY_SCOPES[i]}) must not outrank its predecessor`,
      );
    }
  });

  it("has the ordering disagreement FIXED by derivation, not by a second edit", () => {
    // `MEMORY_SCOPES` is now DECLARED in breadth order and `SCOPE_BREADTH` derives from
    // it, so there is no second list to disagree with. This asserts the derivation
    // rather than the agreement: an assertion that two hand-maintained orders MATCH
    // would be satisfied by two lists that happen to agree today, which is precisely
    // the state Phase 06 inherited and found wrong.
    const byBreadth = [...MEMORY_SCOPES].sort((a, b) => (SCOPE_BREADTH[a] ?? 0) - (SCOPE_BREADTH[b] ?? 0));
    assert.deepEqual(
      [...MEMORY_SCOPES],
      byBreadth,
      "MEMORY_SCOPES must be declared in breadth order, because SCOPE_BREADTH derives from it",
    );
    assert.deepEqual(
      Object.keys(SCOPE_BREADTH),
      [...MEMORY_SCOPES],
      "and the derived table must carry exactly the declared scopes, in the declared order",
    );
    // A dense ranking: a gap would leave two scopes sharing a rank, and `>` would then
    // say neither is broader than the other - a silent hole in the ordering itself.
    assert.deepEqual(
      MEMORY_SCOPES.map((scope) => SCOPE_BREADTH[scope]),
      MEMORY_SCOPES.map((_, index) => index),
      "breadth must be a dense ranking",
    );
  });
});
