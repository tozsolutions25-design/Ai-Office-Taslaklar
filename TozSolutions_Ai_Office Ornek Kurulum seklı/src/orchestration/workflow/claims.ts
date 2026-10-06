/**
 * PHASE 07: claiming, delivery semantics, and idempotency.
 *
 * THE HONEST GUARANTEE, stated up front because everything here depends on it:
 *
 *   This is SINGLE-PROCESS exclusion with an expiry. It is not a distributed
 *   lock, and it does not become one by being called a lease.
 *
 * There is no database in this repository, so there is nowhere for a claim to be
 * visible to a second process. `ClaimRegistry` is authoritative for one process,
 * and the tests say so. A multi-process deployment needs real shared storage for
 * this class, and that is a documented limitation rather than an implied one.
 *
 * Delivery semantics, named precisely because "exactly once" is not available:
 *
 *   at-most-once      a claim is observed exactly once; a duplicate delivery is
 *                     REFUSED rather than run. Achieved for a single process.
 *   at-least-once     a task is offered until something claims it. A worker that
 *                     dies mid-attempt loses the claim on expiry and the task is
 *                     offered again - so the work may run twice.
 *   effectively-once  the COMBINED behaviour above: at-least-once delivery with
 *                     at-most-once execution, and duplicate side effects
 *                     suppressed by an idempotency key.
 *
 * What this module does NOT claim: that an external effect outside this process
 * happened exactly once. A crash between "effect applied" and "checkpoint
 * written" is a real window, and no amount of bookkeeping in memory closes it.
 */

import { type Clock, systemClock } from "../../core/clock.js";
import { claimToken, type IdentityKey } from "../../state/identity.js";
import { InMemoryDurableStore } from "../../state/inMemoryStore.js";
import { DURABLE_SCHEMA_VERSION, scopeOf, type ClaimRow, type DurableStateRepository, type IdempotencyRow } from "../../state/durable.js";
import { taskKey } from "./gates.js";
import type { WorkspaceRef } from "../workspace/workspace.js";

export const DELIVERY_SEMANTICS = {
  /** At-least-once delivery, at-most-once execution per attempt key. */
  claim: "effectively-once",
  /**
   * PHASE 12.8: this was `single-process`.
   *
   * It was true when the only record of what a key had done lived in a `Map` inside one
   * coordinator, and it stopped being true the moment idempotency moved into
   * `DurableStateRepository`. Leaving the old value would have been the more comfortable
   * option and the dishonest one: the scope would have claimed LESS than the code now
   * delivers, which is precisely how an under-claim becomes a place a real limitation hides.
   *
   * What it does NOT become: `cross-workspace`. A key is scoped to one workspace and one
   * brand, so two workspaces running the same job and task ids never see each other's record.
   * Within one workspace the record is durable across a process restart.
   */
  scope: "durable-per-workspace",
} as const;

export interface Claim {
  readonly taskId: string;
  readonly jobId: string;
  /** Opaque token proving this caller holds the claim. */
  readonly token: string;
  readonly workerId: string;
  readonly claimedAt: number;
  /** Epoch ms after which the claim is considered abandoned. */
  readonly expiresAt: number;
  /** How many times this task has been claimed, including this one. */
  readonly claimCount: number;
}

export type ClaimOutcome =
  | { readonly ok: true; readonly claim: Claim }
  | {
      readonly ok: false;
      readonly reason: "already_claimed" | "not_claimable" | "unknown_task";
      readonly detail: string;
      /** Present when already claimed: who holds it. */
      readonly heldBy: string | null;
    };

interface ClaimEntry {
  claim: Claim;
}

/**
 * Tracks which task is currently claimed.
 *
 * An expired claim is not a permanent loss: it is released, and the task becomes
 * claimable again. That is what makes a crashed worker's task recoverable rather
 * than stuck, and it is why the expiry is mandatory rather than optional.
 */
/**
 * Tracks which task is currently claimed, on `DurableStateRepository`.
 *
 * ## PARAMETER ORDER IS NOW ONE ORDER
 *
 * `claim` used to be `claim(taskId, jobId, workerId)` while `current`, `claimCount`, `release`
 * and `verify` were all `(jobId, taskId, ...)`. Every in-repo caller was consistent with its own
 * method, so nothing was broken - which is exactly why it survived. The Phase 12 discovery probe
 * hit it: calling the registry the way every OTHER method is called produced a claim that could
 * not be read back.
 *
 * A trap like that does not announce itself, so the whole registry is now `(jobId, taskId, ...)`
 * and no compatibility overload is offered. An overload would preserve the ambiguity for
 * whoever found it next, and would do it silently - both orders are `(string, string, ...)`, so
 * a wrapper cannot even detect the mistake.
 *
 * ## THE AUTHORITY ORDER
 *
 *     claim:    read repository -> repository.transaction(put) -> #mirror
 *     current:  repository (the mirror is never read)
 *     release:  repository -> #mirror
 *
 * `#entries` is now a mirror rather than a store. It exists for one reason only: `active()` needs
 * a list, and the repository's interface answers a point lookup. Anything that decides anything
 * reads the repository.
 *
 * ## IDENTITY
 *
 * `token` was `claim-${taskId}-${processCounter}`, so a restart could mint the same token for a
 * different claim - and `verify()` compares tokens, which would then accept a stale worker. It is
 * derived now, and `acquiredAt` is in the derivation precisely so two processes cannot agree.
 */
export class ClaimRegistry {
  /** Non-authoritative mirror for list-shaped reads only. */
  readonly #entries = new Map<string, ClaimEntry>();
  readonly #claimCounts = new Map<string, number>();
  readonly #clock: Clock;
  readonly #workspace: WorkspaceRef | null;
  readonly #defaultTtlMs: number;
  readonly #repository: DurableStateRepository;
  readonly #identity: IdentityKey;

  public constructor(options: {
    clock?: Clock;
    defaultTtlMs?: number;
    workspace?: WorkspaceRef | null;
    repository?: DurableStateRepository;
    identity?: IdentityKey;
  } = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#defaultTtlMs = options.defaultTtlMs ?? 30_000;
    this.#workspace = options.workspace ?? null;
    // A registry with no repository gets its own in-memory one, scoped the same way. That keeps
    // every existing construction site working with identical semantics, and makes the durable
    // path something a caller opts into rather than something it inherits by accident.
    this.#repository = options.repository ?? new InMemoryDurableStore({ scope: scopeOf(this.#workspace) });
    this.#identity = options.identity ?? { secret: "toz-phase-12-development-key", schemaVersion: DURABLE_SCHEMA_VERSION };
  }

  /** The ONLY place this registry composes a claim key. */
  #claimKey(jobId: string, taskId: string): string {
    return taskKey(jobId, taskId, this.#workspace);
  }

  public claimCount(jobId: string, taskId: string): number {
    return this.#claimCounts.get(this.#claimKey(jobId, taskId)) ?? 0;
  }

  /**
   * A claim is LIVE until its expiry, and the repository is what says so.
   *
   * Expired claims are released rather than merely ignored: a dead worker's task has to become
   * claimable again, and leaving the row behind would make the SECOND attempt look like it was
   * already taken.
   */
  public current(jobId: string, taskId: string): Claim | null {
    const row = this.#repository.getClaim(jobId, taskId);
    if (row === null) return null;
    if (row.expiresAt <= this.#clock.nowMs()) {
      this.#repository.releaseClaim(jobId, taskId);
      this.#entries.delete(this.#claimKey(jobId, taskId));
      return null;
    }
    return toClaim(row);
  }

  /**
   * Acquires a claim.
   *
   * The read and the write share one transaction, because "nobody holds it" followed by "I hold
   * it" is two facts and two processes can interleave between them. The transaction makes it one.
   */
  public claim(
    jobId: string,
    taskId: string,
    workerId: string,
    options: { ttlMs?: number; claimable?: boolean } = {},
  ): ClaimOutcome {
    if (options.claimable === false) {
      return {
        ok: false,
        reason: "not_claimable",
        detail: `Task "${taskId}" is not in a claimable state, so it was not offered to any worker.`,
        heldBy: null,
      };
    }

    return this.#repository.transaction((): ClaimOutcome => {
      const held = this.current(jobId, taskId);
      if (held !== null) {
        return {
          ok: false,
          reason: "already_claimed",
          detail: `Task "${taskId}" is already claimed by "${held.workerId}" until ${held.expiresAt}. A duplicate delivery is refused rather than run twice.`,
          heldBy: held.workerId,
        };
      }
      const now = this.#clock.nowMs();
      const count = this.claimCount(jobId, taskId) + 1;
      this.#claimCounts.set(this.#claimKey(jobId, taskId), count);
      const claim: Claim = {
        taskId,
        jobId,
        token: claimToken(this.#identity, {
          workspace: this.#repository.scope.workspace,
          jobId,
          taskId,
          workerId,
          acquiredAt: now,
        }),
        workerId,
        claimedAt: now,
        expiresAt: now + (options.ttlMs ?? this.#defaultTtlMs),
        claimCount: count,
      };
      this.#repository.putClaim({
        jobId,
        taskId,
        token: claim.token,
        workerId,
        acquiredAt: now,
        expiresAt: claim.expiresAt,
      });
      this.#entries.set(this.#claimKey(jobId, taskId), { claim });
      return { ok: true, claim };
    });
  }

  /**
   * Verifies a token before a result is accepted.
   *
   * This is the stale-result guard. A worker whose claim expired, or whose job was
   * cancelled, cannot present a valid token, so its result is rejected rather than
   * reviving a task that has moved on.
   */
  public verify(jobId: string, taskId: string, token: string): { readonly valid: boolean; readonly detail: string } {
    const current = this.current(jobId, taskId);
    if (current === null) {
      return {
        valid: false,
        detail: `No live claim for task "${taskId}": it was never claimed, or the claim expired. A result from a worker that no longer holds the task is refused.`,
      };
    }
    if (current.token !== token) {
      return {
        valid: false,
        detail: `Claim token for task "${taskId}" does not match the current claim, held by "${current.workerId}".`,
      };
    }
    return { valid: true, detail: "Claim is valid." };
  }

  /** Repository first; the mirror follows. A release that only cleared memory was not a release. */
  public release(jobId: string, taskId: string, token: string): boolean {
    const current = this.current(jobId, taskId);
    if (current === null || current.token !== token) {
      return false;
    }
    const released = this.#repository.transaction(() => this.#repository.releaseClaim(jobId, taskId));
    this.#entries.delete(this.#claimKey(jobId, taskId));
    return released;
  }

  public releaseJob(jobId: string): readonly string[] {
    const released: string[] = [];
    for (const entry of [...this.#entries.values()]) {
      if (entry.claim.jobId !== jobId) continue;
      this.#repository.transaction(() => this.#repository.releaseClaim(jobId, entry.claim.taskId));
      this.#entries.delete(this.#claimKey(jobId, entry.claim.taskId));
      released.push(entry.claim.taskId);
    }
    return released;
  }

  /**
   * Live claims, read from the REPOSITORY rather than from the mirror.
   *
   * The mirror is only ever a fallback for claims taken before a restart in a store this process
   * cannot see; anything the repository knows is the answer, because the repository is what
   * survived.
   */
  public active(): readonly Claim[] {
    const fromRepository = this.#repository.listClaims().map(toClaim);
    const known = new Set(fromRepository.map((claim) => this.#claimKey(claim.jobId, claim.taskId)));
    const extras = [...this.#entries.values()]
      .map((entry) => entry.claim)
      .filter((claim) => !known.has(this.#claimKey(claim.jobId, claim.taskId)));
    return [...fromRepository, ...extras].filter((claim) => this.current(claim.jobId, claim.taskId) !== null);
  }

  public clear(): void {
    this.#entries.clear();
    this.#claimCounts.clear();
  }

  /** The repository this registry answers through, for rehydration and for tests. */
  public get repository(): DurableStateRepository {
    return this.#repository;
  }
}

function toClaim(row: ClaimRow): Claim {
  return {
    jobId: row.jobId,
    taskId: row.taskId,
    token: row.token,
    workerId: row.workerId,
    claimedAt: row.acquiredAt,
    expiresAt: row.expiresAt,
    claimCount: 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Idempotency                                                                */
/* -------------------------------------------------------------------------- */

export interface IdempotencyRecord {
  readonly key: string;
  readonly taskId: string;
  /** Result of the first execution, replayed to any duplicate. */
  readonly outcome: "succeeded" | "failed";
  /** Non-secret reference to what the first execution produced. */
  readonly resultRef: string | null;
  readonly at: number;
  readonly replays: number;
}

export type IdempotencyOutcome =
  /**
   * PHASE 12.8: this arm used to hand back a record whose `outcome` was the literal
   * `"succeeded"` for work that had not run yet.
   *
   * That contradicted the refusal two lines below it, which declines to answer a duplicate
   * precisely because "the answer does not exist yet" - and then invented one anyway on the
   * claiming path. The durable row has no such fiction available to it: an unfinished attempt
   * is `in_progress` with `outcome: null`, so there is nothing to report. `record` is null and
   * the caller runs the work.
   */
  | { readonly ok: true; readonly replayed: false; readonly record: null }
  | { readonly ok: true; readonly replayed: true; readonly record: IdempotencyRecord }
  | { readonly ok: false; readonly reason: "in_progress"; readonly detail: string };

/**
 * Remembers what a key already did, so a duplicate delivery does not repeat it.
 *
 * ## PHASE 12.8 - THE REPOSITORY IS THE AUTHORITY
 *
 * This was two process-local structures: a `Map` of finished records and a `Set` of in-flight
 * keys. Both died with the process, so after a restart the ledger could not tell a key that
 * had already run from a key that had never been seen. `DurableStateRepository` holds the record
 * now, in `idempotency_records`, keyed by (workspace, brand, key).
 *
 *     begin:    repository.beginIdempotent -> #mirror
 *     complete: repository, in a transaction -> #mirror
 *     abandon:  repository, in a transaction -> #mirror
 *     get:      repository. The mirror is NEVER read.
 *
 * `#records` survives as a mirror for one reason only: `size` and the bound need a count, and a
 * mirror makes the bound a CACHE bound instead of a durability bound. See `#boundMirror`.
 *
 * ## TWO GUARDS THE MAP VERSION DID NOT NEED
 *
 * `complete` and `abandon` used to test `#inFlight`, and that set was the whole world. A durable
 * row also carries a terminal `state`, and without the check `abandon` would DELETE a completed
 * record - a mistake the Map version could not express, because it held completed records in a
 * different structure from the one it deleted from. Both operations therefore run in one
 * transaction that reads the row, refuses unless the row is `in_progress`, and only then writes.
 *
 * ## SCOPE, stated plainly
 *
 * Suppressing a duplicate now survives a restart, within one workspace and brand. It does NOT
 * make an external effect exactly-once. If the process dies between applying an effect and
 * recording the key, that effect will be repeated after recovery, and pretending otherwise would
 * be the single most damaging claim this subsystem could make.
 */
export class IdempotencyLedger {
  /** Non-authoritative mirror. Exists so `size` and the bound stay cache-shaped. */
  readonly #records = new Map<string, IdempotencyRecord>();
  readonly #clock: Clock;
  readonly #limit: number;
  readonly #repository: DurableStateRepository;
  #dropped = 0;

  public constructor(options: {
    clock?: Clock;
    limit?: number;
    repository?: DurableStateRepository;
    workspace?: WorkspaceRef | null;
  } = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#limit = options.limit ?? 5_000;
    // The same decision `ClaimRegistry` made: no repository means a private in-memory one,
    // scoped the same way. The fallback is still a `DurableStateRepository`, so there is no
    // second authority that can drift from the first - just a store that happens to be empty.
    this.#repository = options.repository ?? new InMemoryDurableStore({ scope: scopeOf(options.workspace ?? null) });
  }

  /**
   * How many records this ledger is currently MIRRORING.
   *
   * It is not how many keys are known. A key evicted by the bound is still in the repository and
   * still suppresses a duplicate; the mirror only bounds memory.
   */
  public get size(): number {
    return this.#records.size;
  }

  /** Mirror entries dropped by the bound, so cache truncation is visible rather than silent. */
  public get droppedCount(): number {
    return this.#dropped;
  }

  /**
   * Claims a key for first execution.
   *
   * `in_progress` is the interesting refusal: a second worker arriving while the first is still
   * running must be told "wait", not "here is the answer" and not "go ahead". Answering early
   * would report a result that does not exist yet.
   *
   * The store's `beginIdempotent` is transactional, so the "is it there?" read and the insert are
   * one fact. Two coordinators racing the same key cannot both see it absent.
   */
  public begin(key: string, taskId: string): IdempotencyOutcome {
    const begun = this.#repository.beginIdempotent(key, taskId, this.#clock.nowMs());
    if (!begun.ok) {
      return { ok: false, reason: "in_progress", detail: begun.detail };
    }
    if (begun.replayed) {
      // The repository counted the replay durably, so the mirror takes the counted row rather
      // than incrementing a second time and reporting one more than was recorded.
      const record = toIdempotencyRecord(begun.row);
      this.#records.set(key, record);
      return { ok: true, replayed: true, record };
    }
    // A fresh key is `in_progress` durably and has no outcome yet, so there is nothing to hand
    // back. Any earlier mirror entry for this key described an attempt that is no longer current.
    this.#records.delete(key);
    return { ok: true, replayed: false, record: null };
  }

  /**
   * Records the outcome of a first execution and frees the key.
   *
   * Refuses a key that is not `in_progress`, which is what the `#inFlight` test used to do. That
   * covers both a key this ledger never began and a key that already finished: re-completing a
   * finished attempt would overwrite the outcome a later duplicate is entitled to replay.
   */
  public complete(key: string, outcome: "succeeded" | "failed", resultRef: string | null): IdempotencyRecord | null {
    return this.#repository.transaction((): IdempotencyRecord | null => {
      const existing = this.#repository.getIdempotent(key);
      if (existing === null || existing.state !== "in_progress") {
        return null;
      }
      const row = this.#repository.completeIdempotent(key, outcome, resultRef, this.#clock.nowMs());
      if (row === null) return null;
      const record = toIdempotencyRecord(row);
      this.#records.set(key, record);
      this.#boundMirror();
      return record;
    });
  }

  /**
   * Frees a key whose execution failed before it could be recorded.
   *
   * Only an `in_progress` row may be abandoned. This is the guard that matters most: the row is
   * the only durable trace of the attempt, and a completed one is what a later duplicate replays
   * from. Deleting it would turn a suppressed duplicate into a re-execution.
   */
  public abandon(key: string): boolean {
    return this.#repository.transaction((): boolean => {
      const existing = this.#repository.getIdempotent(key);
      if (existing === null || existing.state !== "in_progress") {
        return false;
      }
      const abandoned = this.#repository.abandonIdempotent(key);
      if (abandoned) {
        this.#records.delete(key);
      }
      return abandoned;
    });
  }

  /**
   * The repository answers this. The mirror is never read, so it cannot become the authority.
   *
   * Returns null for an `in_progress` row, and that is not a gap - it is the same rule `begin`
   * follows. An unfinished attempt has no outcome, so reporting one would be inventing it. The
   * first version of this method mapped any non-`failed` state to `"succeeded"`, which meant
   * `get()` reported success for work that had not run; the evidence caught it, because a test
   * that had already asserted the refusal elsewhere still passed.
   */
  public get(key: string): IdempotencyRecord | null {
    const row = this.#repository.getIdempotent(key);
    if (row === null || row.state === "in_progress") {
      if (row !== null) this.#records.delete(key);
      return null;
    }
    const record = toIdempotencyRecord(row);
    this.#records.set(key, record);
    return record;
  }

  /** Durable, not counted from the mirror - an in-flight key this process never began still counts. */
  public inFlightCount(): number {
    return this.#repository.listIdempotent().filter((row) => row.state === "in_progress").length;
  }

  /**
   * Clears the MIRROR only.
   *
   * It deliberately does not delete durable records. A method called `clear` that quietly left
   * the repository holding every record would be a lie about completeness in the same way a
   * silent truncation is, and nothing calls this today - so the honest reading is kept.
   */
  public clear(): void {
    this.#records.clear();
    this.#dropped = 0;
  }

  /** Evicts the oldest MIRRORED records. Durable records are never evicted. */
  #boundMirror(): void {
    while (this.#records.size > this.#limit) {
      const oldest = this.#records.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.#records.delete(oldest.value);
      this.#dropped += 1;
    }
  }
}

/**
 * Maps a durable row to the public record.
 *
 * Only a TERMINAL row is mapped. An `in_progress` row has `outcome: null` and no result, and
 * `IdempotencyRecord.outcome` has no honest value to give it - which is why `begin` reports
 * `record: null` for a fresh claim rather than inventing one.
 */
function toIdempotencyRecord(row: IdempotencyRow): IdempotencyRecord {
  return {
    key: row.key,
    taskId: row.taskId,
    outcome: row.state === "failed" ? "failed" : "succeeded",
    resultRef: row.resultRef,
    at: row.at,
    replays: row.replays,
  };
}
