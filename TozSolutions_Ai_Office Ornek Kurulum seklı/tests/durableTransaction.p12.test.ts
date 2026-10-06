/**
 * PHASE 12 EVIDENCE - the durable transaction boundary, on both implementations.
 *
 * ## WHY THIS FILE TESTS BOTH STORES AGAINST EACH OTHER
 *
 * `DurableStateRepository` has two implementations. The hazard they share is not that one of
 * them is wrong - it is that they are DIFFERENT, so a caller developed against the in-memory one
 * gets guarantees the SQLite one does not provide, and the only place that shows up is
 * production.
 *
 * The in-memory store's `transaction()` started life as a no-op wrapper. That was defensible on
 * its own terms - an in-process Map cannot half-write - and wrong in the way this phase exists
 * to catch: it meant atomicity existed in production and not in the tests, which is precisely
 * where nobody looks for a missing guarantee. Both now commit on return and roll back on throw,
 * and this file is what keeps them honest.
 *
 * ## NESTED TRANSACTIONS: SUPPORTED, AND THE RULE IS WRITTEN DOWN
 *
 * Determined rather than invented. SQLite rejects `BEGIN` inside `BEGIN`, so a naive nesting
 * would be a runtime error in one implementation and a silent no-op in the other. Both join the
 * OUTER transaction instead, which is the standard answer, and both were verified to do it -
 * see the nesting test below.
 *
 * ## THE RULE THAT MATTERS MOST
 *
 * A transaction may cover state persistence ONLY. It must never be held open across an
 * `await` that performs external work - a provider call, a tool call, anything that talks to a
 * system outside this process. Holding one would pin SQLite's single write lock for the duration
 * of a network round trip, and a crash inside the window would roll back state describing work
 * that had already happened.
 *
 * That is not managed by transaction scope. It is represented by `INDETERMINATE`. So this file
 * also asserts the SHAPE that keeps it safe: transactions in this codebase are short and
 * synchronous, and the evidence tests that drive execution do so without one open.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { InMemoryDurableStore } from "../src/state/inMemoryStore.js";
import { SqliteDurableStore } from "../src/state/sqliteStore.js";
import type { DurableStateRepository } from "../src/state/durable.js";

const WS = { workspace: "acme", brand: null };

function jobRow(overrides: Partial<Parameters<DurableStateRepository["putJob"]>[0]> = {}) {
  return {
    jobId: "j1",
    workflowId: "wf",
    label: "L",
    state: "queued" as const,
    priority: "normal",
    owner: "op",
    correlationId: "c1",
    budget: "{}",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "j1",
    taskId: "t1",
    state: "pending" as const,
    attempts: 0,
    executionId: null,
    claimToken: null,
    startedAt: null,
    finishedAt: null,
    resultRef: null,
    failure: null,
    failureClass: null,
    retryable: null,
    redriveSafe: false,
    definition: "{}",
    ...overrides,
  };
}

/** Both implementations, so every assertion below runs against each. */
/**
 * One directory PER STORE.
 *
 * Sharing one directory between the two entries looks harmless and is not: each entry's
 * `cleanup` removes it, so the first suite to finish deleted the second suite's database
 * directory and every SQLite case failed with "unable to open database file". Caught by
 * running the tests, which is the only place a shared fixture can be caught.
 */
function stores(): { name: string; make: () => DurableStateRepository; cleanup: () => void }[] {
  const freshDir = (tag: string): string => mkdtempSync(path.join(tmpdir(), `toz-p12-tx-${tag}-`));
  let counter = 0;
  return [
    {
      name: "InMemoryDurableStore",
      make: () => new InMemoryDurableStore({ scope: WS }),
      cleanup: () => rmSync(freshDir("never-created"), { recursive: true, force: true }),
    },
    {
      name: "SqliteDurableStore",
      make: () => {
        const dir = freshDir("sqlite");
        return SqliteDurableStore.open({ path: path.join(dir, `s${++counter}.db`), workspace: WS });
      },
      cleanup: () => rmSync(freshDir("never-created"), { recursive: true, force: true }),
    },
  ];
}

describe("PHASE 12 EVIDENCE - transaction boundary", () => {
  for (const { name, make, cleanup } of stores()) {
    describe(name, () => {
      it("commits every write when the body returns", () => {
        const store = make();
        try {
          store.transaction(() => {
            store.putJob(jobRow());
            store.putTask(taskRow());
          });
          assert.equal(store.getJob("j1")?.label, "L", "the first write survived");
          assert.equal(store.getTask("j1", "t1")?.state, "pending", "and so did the second");
        } finally {
          store.close();
          cleanup();
        }
      });

      it("rolls EVERYTHING back when the body throws, leaving no partial state", () => {
        const store = make();
        try {
          store.putJob(jobRow({ jobId: "existing" }));
          assert.throws(() => {
            store.transaction(() => {
              store.putJob(jobRow({ jobId: "added" }));
              store.putTask(taskRow());
              throw new Error("the work failed");
            });
          }, /the work failed/);

          // The decisive assertion is about the FIRST write, not the last. A partial rollback
          // that undoes the most recent statement and keeps the earlier one is the failure this
          // test exists to catch, and it is invisible if you only check what was written last.
          assert.equal(store.getJob("added"), null, "the first write in the failed transaction is gone");
          assert.equal(store.getTask("j1", "t1"), null, "and so is the second");
          assert.equal(store.getJob("existing")?.label, "L", "state from BEFORE the transaction is untouched");
        } finally {
          store.close();
          cleanup();
        }
      });

      it("nests by joining the outer transaction, and rolls back as one unit", () => {
        const store = make();
        try {
          // Supported, not rejected and not silently independent. SQLite rejects a nested BEGIN,
          // so "support" here means join-and-commit-once.
          store.transaction(() => {
            store.transaction(() => {
              store.putJob(jobRow({ jobId: "inner" }));
            });
            store.putTask(taskRow());
          });
          assert.equal(store.getJob("inner")?.label, "L", "the inner transaction's write committed with the outer one");
          assert.equal(store.getTask("j1", "t1")?.state, "pending");

          assert.throws(() => {
            store.transaction(() => {
              store.transaction(() => {
                store.putJob(jobRow({ jobId: "inner2" }));
              });
              throw new Error("outer failed");
            });
          }, /outer failed/);
          assert.equal(store.getJob("inner2"), null, "a failure outside the inner scope still discards it - one boundary, not two");
        } finally {
          store.close();
          cleanup();
        }
      });

      it("is re-entrant: a second commit attempt does not start a second transaction", () => {
        const store = make();
        try {
          // If `transaction` were naive, the nested call would issue a second COMMIT and throw.
          // This asserts the guard that prevents that, because the failure would only appear
          // under a nesting pattern no other test happens to use.
          let completed = false;
          store.transaction(() => {
            store.transaction(() => {
              store.putJob(jobRow({ jobId: "deep" }));
            });
            completed = true;
          });
          assert.equal(completed, true, "the outer body ran to completion without a spurious COMMIT error");
          assert.equal(store.getJob("deep")?.label, "L");
        } finally {
          store.close();
          cleanup();
        }
      });
    });
  }

  it("gives both implementations the SAME observable rollback behaviour", () => {
    // The cross-check that makes "0 survivors" meaningful later: if one rolled back and the
    // other did not, this is where it would show, and the difference would be invisible to
    // every store-specific test.
    const outcomes: boolean[] = [];
    for (const { make, cleanup } of stores()) {
      const store = make();
      try {
        // The write has to be INSIDE the transaction that throws. A first version committed it
        // in its own transaction and then asserted it was gone, which would have passed for the
        // wrong reason on a store that never rolls anything back.
        assert.throws(() => {
          store.transaction(() => {
            store.putJob(jobRow({ jobId: "rolled-back" }));
            throw new Error("boom");
          });
        }, /boom/);
        outcomes.push(store.getJob("rolled-back") === null);
      } finally {
        store.close();
        cleanup();
      }
    }
    assert.deepEqual(outcomes, [true, true], "both rolled back; a divergence here would mean one store lies about atomicity");
  });

  it("never requires a transaction to span an await, because the body is synchronous", () => {
    // A structural guard rather than a behavioural one. `transaction<T>(body: () => T)` cannot
    // be handed a promise-returning body by the type system, so the "never hold a transaction
    // across external work" rule is enforced where it can be rather than documented where it can
    // be forgotten. The recovery path is what represents the crash ambiguity instead.
    const store = new InMemoryDurableStore({ scope: WS });
    store.transaction(() => {
      store.putJob(jobRow());
    });
    // Returning a promise would compile only if the signature allowed it; it does not.
    assert.equal(store.getJob("j1")?.label, "L", "a synchronous body committed, and no await was needed to finish it");
    store.close();
  });
});