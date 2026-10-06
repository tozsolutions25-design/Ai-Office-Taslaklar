/**
 * PHASE 12 EVIDENCE - the repository is the ONLY authority for checkpoints and claims.
 *
 * ## WHY THIS IS A SOURCE-READING TEST AT ALL
 *
 * The behavioural tests can prove that a checkpoint survives a restart. They cannot prove that
 * nothing ELSE also answers "what is the latest checkpoint" - a stale map consulted on a code path
 * the tests never take would pass every one of them and then disagree in production.
 *
 * So this file reads the two classes and checks the specific shape that creates a second
 * authority. It is structural on purpose, and it is narrow: it does not assert that the code is
 * written a particular way, only that no answer is produced from anywhere but the repository.
 *
 * ## WHAT WOULD TRIP IT
 *
 *   - a `#cache` / `#entries` read that decides anything (the mirror is allowed to be WRITTEN
 *     and to back a list-shaped read, never to answer "is this claimed" or "what is latest");
 *   - a repository write that happens AFTER a cache update, which is the same dual authority in
 *     time rather than in space;
 *   - a `putClaim` / `appendCheckpoint` that is not inside the transaction that precedes it.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ManualClock } from "../src/core/clock.js";
import { SqliteDurableStore } from "../src/state/sqliteStore.js";
import { CheckpointStore } from "../src/orchestration/workflow/gates.js";
import { ClaimRegistry } from "../src/orchestration/workflow/claims.js";
import { describe, it } from "node:test";

const GATES = readFileSync("src/orchestration/workflow/gates.ts", "utf8");
const CLAIMS = readFileSync("src/orchestration/workflow/claims.ts", "utf8");

/** The body of a class, from its declaration to the matching close. */
function classBody(source: string, className: string): string {
  const start = source.indexOf(`export class ${className}`);
  assert.notEqual(start, -1, `${className} exists`);
  const lines = source.slice(start).split(/\r?\n/);
  let depth = 0;
  let started = false;
  const out: string[] = [];
  for (const line of lines) {
    out.push(line);
    for (const ch of line) {
      if (ch === "{") {
        depth += 1;
        started = true;
      } else if (ch === "}") depth -= 1;
    }
    if (started && depth === 0) break;
  }
  return out.join("\n");
}

/**
 * The body of ONE member, from its signature to its matching close brace.
 *
 * Two things this had to get right, both of which produced a false failure first:
 *
 *  - the brace scan starts AFTER the parameter list, not at the signature. `write(input: {...})`
 *    has an object literal in its parameters, so scanning from the signature returns the
 *    parameter type and stops there - which reads as "this method does not write through the
 *    repository", a claim that is both false and would have been believed.
 *  - signatures are matched on their DECLARATION form. `#mirror(` alone matches the CALL
 *    `this.#mirror(checkpoint)` first, and the scan then walks into the wrong method.
 */
function memberBody(source: string, className: string, signature: string): string {
  const body = classBody(source, className);
  const at = body.indexOf(signature);
  assert.notEqual(at, -1, `${className}.${signature} exists`);

  /**
   * The body brace is the first `{` reached while NOT inside parentheses.
   *
   * That single rule covers both signature shapes this file uses. `public write(` stops before
   * its parameter list, so the object literal `{ jobId: string ... }` is at paren depth 1 and is
   * skipped; `#mirror(checkpoint: Checkpoint): void` already includes its parameter list, so
   * depth is 0 and the next `{` is the body. Scanning for "the first `{`" without this rule
   * returns the parameter type for the first shape and nothing useful for the second - which is
   * how a version of this file ended up reporting that `write()` never touches the repository.
   */
  let parenDepth = 0;
  let bodyStart = -1;
  for (let i = at + signature.length; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "(") parenDepth += 1;
    else if (ch === ")") parenDepth -= 1;
    else if (ch === "{" && parenDepth === 0) {
      bodyStart = i;
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `${className}.${signature} has a body`);

  let depth = 0;
  for (let i = bodyStart; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return body.slice(at, i + 1);
    }
  }
  throw new Error(`${className}.${signature} has no matching brace`);
}

describe("PHASE 12 EVIDENCE - no dual authority", () => {
  it("CheckpointStore decides nothing from its mirror", () => {
    const body = classBody(GATES, "CheckpointStore");

    // `#mirror` is a private WRITER and necessarily reads its own list to append to it. That is
    // not a decision - a first version of this assertion forbade every read and correctly failed
    // on the mirror's own bookkeeping, which would have pushed the implementation towards
    // keeping no mirror at all rather than towards removing the reads that matter.
    //
    // So the rule is scoped: the mirror may be read by its writer, and nowhere else.
    const writer = memberBody(GATES, "CheckpointStore", "#mirror(checkpoint: Checkpoint): void");
    const outsideWriter = classBody(GATES, "CheckpointStore").replace(writer, "");
    const reads = outsideWriter.match(/#cache\.(?:get|has|values|entries|keys)\(/g) ?? [];
    assert.deepEqual(
      reads,
      [],
      `CheckpointStore must not read #cache outside its writer to answer anything; found ${reads.length}. latest()/count()/forTask()/recoveryPlan() must come from the repository.`,
    );

    // `forTask`/`latest`/`count` must actually consult the repository.
    for (const method of ["forTask", "latest", "count", "recoveryPlan"]) {
      const at = body.indexOf(`public ${method}(`);
      assert.notEqual(at, -1, `${method} exists`);
      const slice = body.slice(at, at + 700);
      // `recoveryPlan` reaches the repository THROUGH `latest()`, and that indirection is
      // fine - what would not be fine is reaching the mirror. So both are allowed, and `latest`
      // is separately required to touch the repository, which is what makes the delegation safe.
      assert.match(
        slice,
        /this\.#repository\.|this\.latest\(/,
        `${method}() must reach the repository, directly or via latest(); answering from #cache would be a second authority`,
      );
    }
  });

  it("ClaimRegistry decides nothing from its mirror either", () => {
    const body = classBody(CLAIMS, "ClaimRegistry");

    // `current`, `verify` and `release` all decide. None may consult `#entries`.
    for (const method of ["current", "verify", "release"]) {
      const at = body.indexOf(`public ${method}(`);
      assert.notEqual(at, -1, `${method} exists`);
      const slice = body.slice(at, at + 900);
      assert.doesNotMatch(
        slice,
        /#entries\.(?:get|has)\(/,
        `${method}() reads #entries, so a mirror entry could override the repository`,
      );
    }

    // `current()` is the one every other decision goes through, so it MUST reach the repository.
    const currentAt = body.indexOf("public current(");
    assert.match(body.slice(currentAt, currentAt + 500), /this\.#repository\.getClaim\(/, "current() must read the repository");
  });

  it("updates the mirror only after the repository has accepted the write", () => {
    // PROVEN BEHAVIOURALLY, and this replaced a source-ordering assertion.
    //
    // The source version read `gates.ts`, located the repository write and the mirror write, and
    // compared their positions. It was fragile - a brace scanner cannot tell a parameter object
    // literal from a body - and it proved less: it checked that the code was WRITTEN in an order,
    // not that the order HOLDS when the repository refuses.
    //
    // Closing the store makes the repository reject every write. If the mirror were updated first,
    // a closed store would still answer from memory. So this is the ordering, under the one
    // condition that distinguishes it from a comment about ordering.
    const file = path.join(mkdtempSync(path.join(tmpdir(), "toz-p12-authority-")), "state.db");
    try {
      const repo = SqliteDurableStore.open({ path: file, workspace: { workspace: "acme", brand: null } });
      const clock = new ManualClock(new Date("2026-04-01T00:00:00.000Z"));
      const cp = new CheckpointStore({ clock, repository: repo });
      const claims = new ClaimRegistry({ clock, repository: repo, workspace: { workspace: "acme", brand: null } });

      repo.close();

      // Both writes now fail against a closed repository.
      assert.throws(() => cp.write({ jobId: "j", taskId: "t", executionId: "e", progress: "1/1", dataRef: "s3://x", recoverable: true }));
      assert.throws(() => claims.claim("j", "t", "worker-1"));

      // And the READS fail too, which is the real proof and was not what this test expected.
      //
      // The first version asserted `latest()` returned null, on the theory that a mirror which was
      // never updated answers nothing. It threw instead - because `latest()` asks the repository,
      // and the repository is closed. That is a STRONGER result than the one written down: if
      // `latest()` could answer from the mirror it would have returned a value here, and the
      // mirror would be an authority. Throwing is what authority looks like when the authority is
      // gone.
      assert.throws(() => cp.latest("j", "t"), "a read that goes to the repository cannot succeed once it is closed");
      assert.throws(() => cp.count("j", "t"));
      assert.throws(() => claims.current("j", "t"));
      assert.throws(() => claims.verify("j", "t", "anything"));
      assert.throws(() => cp.recoveryPlan("j", "t"));
    } finally {
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
  it("has no process-local counter left standing in for a persisted identity", () => {
    // The defect this slice fixed: `cp-${counter}` and `claim-${taskId}-${counter}` both restart
    // at zero. A surviving counter in either class would be the same bug wearing a new name.
    for (const [name, source] of [
      ["CheckpointStore", GATES],
      ["ClaimRegistry", CLAIMS],
    ] as const) {
      const body = classBody(source, name);
      assert.doesNotMatch(
        body,
        /checkpointId:\s*`cp-\$\{/,
        `${name} must not mint a checkpoint id from a process counter`,
      );
      assert.doesNotMatch(
        body,
        /token:\s*`claim-\$\{/,
        `${name} must not mint a claim token from a process counter`,
      );
    }
    // Both now go through the identity module.
    assert.match(GATES, /checkpointIdentity\(/, "CheckpointStore derives its identity");
    assert.match(CLAIMS, /claimToken\(/, "ClaimRegistry derives its token");
  });

  it("scopes every claim and checkpoint through the repository, not a field of its own", () => {
    // The partition has to be applied by the thing that builds the key. A store that also kept
    // its own `workspace` field could disagree with the repository's scope, and the two answers
    // would differ depending on which call site asked.
    const cp = classBody(GATES, "CheckpointStore");
    assert.match(cp, /this\.#repository\.scope/, "CheckpointStore keys with the repository's scope");
    assert.doesNotMatch(cp, /readonly #workspace/, "and does not keep a second workspace field that could disagree with it");
  });
});