/**
 * The memory store.
 *
 * Typed persistence for `MemoryItem`, built on the PHASE 04 `MemoryProvider`
 * port. The port is untouched: a `MemoryItem` is stored as a value under a key in
 * a scope, so replacing this store with SQLite or a document database requires no
 * change to the port, the policy, or anything above.
 *
 * WHAT THIS STORE IS RESPONSIBLE FOR, and nothing else:
 *
 *   - persisting and fetching items
 *   - versioning, so a correction never destroys what it corrects
 *   - detecting a CONFLICT: a write that contradicts a live memory on the same key
 *   - lifecycle transitions (stale, invalidated, superseded, deleted)
 *   - retention: expiry and purge
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *   - decide what is worth remembering (that is the write policy)
 *   - rank or retrieve (that is the retrieval engine)
 *   - authorise (that is `MemoryAccessPolicy`, and it is asked, not assumed)
 *
 * THE CONFLICT RULE. Two memories that contradict each other are never silently
 * resolved. A write that contradicts a live memory on the same key is either
 * REJECTED (same value, nothing to do) or recorded as a SUPERSESSION that retains
 * both sides, with the superseded item marked rather than deleted. A reader can
 * then see that the belief changed and when.
 */

import { type Clock, systemClock } from "../../core/clock.js";
import { type Result, err, ok } from "../../core/result.js";
import { isValidMemoryKey, type MemoryProvider } from "./memory.js";
import { type WorkspaceRef } from "../workspace/workspace.js";
import {
  ALL_MEMORY_SCOPES,
  type AnyMemoryScope,
  type MemoryDraft,
  type MemoryItem,
  buildMemoryItem,
  isMemoryStatus,
  type MemoryStatus,
} from "./model.js";

/** Storage key prefix, so a memory is distinguishable from any other entry. */
const ITEM_PREFIX = "memory.item:";
/** Index key, so a store can list without scanning every key. */
const INDEX_KEY = "memory.index";

export class MemoryStoreError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MemoryStoreError";
  }
}

/** A conflict between a new memory and a live one. Both sides are retained. */
export interface MemoryConflict {
  readonly scope: AnyMemoryScope;
  readonly key: string;
  /** The memory already stored. */
  readonly existing: MemoryItem;
  /** What the new draft wanted to say. */
  readonly incoming: MemoryItem;
  /** Why the store considers these contradictory. */
  readonly reason: string;
}

export type StoreOutcome =
  | { readonly kind: "stored"; readonly item: MemoryItem }
  /** The identical memory already existed. Idempotent, not an error. */
  | { readonly kind: "unchanged"; readonly item: MemoryItem }
  /** A conflict was retained rather than resolved. */
  | { readonly kind: "conflict"; readonly conflict: MemoryConflict };

export interface MemoryStoreOptions {
  readonly provider: MemoryProvider;
  readonly clock?: Clock;
  /**
   * PHASE 06. The workspace this store belongs to. REQUIRED.
   *
   * A store instance serves ONE workspace, which is a real limitation and is
   * stated rather than hidden: a deployment serving several workspaces composes
   * one store per workspace. Making the instance multi-workspace would mean a
   * second partition level inside `#items` and `#current`, and those maps are the
   * versioning/conflict machinery this class exists for - the part PHASE 12 owns
   * when it picks a persistence substrate.
   *
   * What matters for THIS phase is only that the store cannot write into a
   * partition it was not built for, and that is what the required field buys: the
   * `MemoryProvider` port is workspace-keyed, so a store with no workspace would
   * have to invent one, and the only value available to invent is "shared".
   */
  readonly workspace: WorkspaceRef;
  /**
   * Whether a contradicting write is retained as a supersession.
   *
   * False means the write is refused outright and the caller must resolve the
   * conflict explicitly. Either way it is never silently merged.
   */
  readonly supersedeOnConflict?: boolean;
}

export class MemoryStore {
  readonly #provider: MemoryProvider;
  readonly #clock: Clock;
  readonly #workspace: WorkspaceRef;
  readonly #supersedeOnConflict: boolean;
  /**
   * scope -> item id -> item.
   *
   * Keyed by ITEM ID, not by key, and that is the whole point. A key holds the
   * current belief; a belief that was replaced or corrected is a different
   * record that must survive beside it. Keying by key meant a correction
   * overwrote the very record it was supposed to supersede, and the history it
   * claimed to preserve existed only in the provider until the process restarted.
   */
  readonly #items = new Map<AnyMemoryScope, Map<string, MemoryItem>>();
  /** scope -> key -> the id of the item currently held at that key. */
  readonly #current = new Map<AnyMemoryScope, Map<string, string>>();
  /** Monotonic counter, so two items written in the same millisecond differ. */
  #counter = 0;
  #loaded = false;
  /**
   * Writes the backing port rejected.
   *
   * Persistence is fire-and-forget so `store()` can stay synchronous, which means
   * a rejected write has nowhere to be thrown. Letting it escape produced an
   * UNHANDLED REJECTION that failed an unrelated test - a failure three frames
   * from its cause. It is captured here and readable instead.
   */
  readonly #persistenceFailures: Array<{ readonly key: string; readonly reason: string }> = [];

  public constructor(options: MemoryStoreOptions) {
    this.#provider = options.provider;
    this.#clock = options.clock ?? systemClock;
    this.#workspace = options.workspace;
    this.#supersedeOnConflict = options.supersedeOnConflict ?? true;
  }

  /** The workspace this store writes into and reads from. */
  public get workspace(): WorkspaceRef {
    return this.#workspace;
  }

  public get providerName(): string {
    return this.#provider.name;
  }

  /**
   * Stores a memory.
   *
   * Refuses a draft with no provenance, which is the one field the model cannot
   * default: a memory whose origin is unknown is not storable, because
   * "where did this come from?" would have no answer.
   */
  public store(draft: MemoryDraft): Result<StoreOutcome, MemoryStoreError> {
    if (draft.provenance === undefined || draft.provenance.sourceRef.trim() === "") {
      return err(
        new MemoryStoreError(
          `Memory "${draft.key}" was refused: provenance with a sourceRef is required, because a memory of unknown origin cannot be audited`,
        ),
      );
    }
    if (draft.summary.trim() === "") {
      return err(new MemoryStoreError(`Memory "${draft.key}" was refused: a summary is required`));
    }
    if (!isValidMemoryKey(draft.key)) {
      // Refused HERE rather than half-written: the backing port rejects such a
      // key, and an item that is readable in the index but unpersistable is a
      // memory that vanishes on the next process start. The rejected value is
      // read before the guard narrows the type, so it can still be named.
      const rejected: unknown = draft.key;
      return err(
        new MemoryStoreError(
          `Memory "${String(rejected)}" was refused: a key must be 1-200 characters of letters, digits, dash, underscore, colon or dot, because the storage port cannot accept one that is not`,
        ),
      );
    }
    const now = this.#clock.nowMs();
    this.#counter += 1;
    const incoming: MemoryItem = {
      ...buildMemoryItem(draft, now),
      // A key holds one current belief. Distinct items are what make history
      // possible, so a second claim at the same key is a new record rather than a
      // mutation of the first.
      id: draft.id ?? `${draft.scope}:${draft.key}#${this.#counter}`,
    };
    const current = this.#currentItem(draft.scope, draft.key);

    if (current !== null && current.status === "deleted") {
      // A deleted key is free to be written again: deletion releases the address.
      const revived = { ...incoming, status: "active" as const, supersedes: [current.id, ...incoming.supersedes] };
      this.#put(revived);
      return ok({ kind: "stored", item: revived });
    }

    if (current !== null && this.#isSameClaim(current, incoming)) {
      // Re-recording the same belief is a no-op, not a conflict and not a new
      // version. Storing it again would inflate the store and imply change.
      return ok({ kind: "unchanged", item: current });
    }

    if (current !== null) {
      const conflict: MemoryConflict = {
        scope: draft.scope,
        key: draft.key,
        existing: current,
        incoming,
        reason: `A live memory already holds "${draft.key}" in scope "${draft.scope}" with different content`,
      };
      if (!this.#supersedeOnConflict) {
        return err(
          new MemoryStoreError(
            `Memory "${draft.key}" conflicts with a live memory and supersession is disabled: ${conflict.reason}`,
          ),
        );
      }
      // Both sides retained. The old belief is marked, not deleted: a memory that
      // was believed and then withdrawn is evidence about how the system reasons.
      this.#put({ ...current, status: "superseded", importance: 0 });
      const replacement: MemoryItem = { ...incoming, supersedes: [current.id, ...incoming.supersedes] };
      this.#put(replacement);
      return ok({ kind: "conflict", conflict });
    }

    this.#put(incoming);
    return ok({ kind: "stored", item: incoming });
  }

  /** Fetches the memory currently held at a key. Expired items are hidden unless asked for. */
  public get(scope: AnyMemoryScope, key: string, options: { includeExpired?: boolean } = {}): MemoryItem | null {
    const item = this.#currentItem(scope, key);
    if (item === null) {
      return null;
    }
    if (!options.includeExpired && this.#isExpired(item, this.#clock.nowMs())) {
      return null;
    }
    if (item.status === "deleted" || item.status === "invalidated") {
      return null;
    }
    return item;
  }

  /**
   * Every memory in a scope.
   *
   * With `includeInactive`, this includes the superseded and withdrawn records -
   * one key may hold several over time, and the earlier ones are the history.
   */
  /**
   * Every CURRENT item in a scope.
   *
   * PHASE 07: this filtered only on `status`, while `get` filtered on status AND expiry.
   * Two read paths on one store therefore disagreed about whether an expired memory
   * existed - `get` said no, `listScope` said yes - and the disagreement was silent,
   * because an expired memory keeps `status: "active"`.
   *
   * Retrieval was not affected: `RetrievalEngine` iterates this list and applies its own
   * expiry filter in `#passesFilters`, which is why the bug produced no wrong retrieval
   * result and no failing test. It would have reached any other caller of `listScope`.
   *
   * `includeExpired` uses the same vocabulary as `get` rather than inventing a second
   * option name, so a caller who learned one has learned both.
   */
  public listScope(
    scope: AnyMemoryScope,
    options: { includeInactive?: boolean; includeExpired?: boolean } = {},
  ): readonly MemoryItem[] {
    const items = [...this.#bucket(scope).values()];
    if (options.includeInactive === true) {
      return items;
    }
    const now = this.#clock.nowMs();
    return items.filter(
      (item) =>
        item.status === "active" &&
        (options.includeExpired === true || !this.#isExpired(item, now)),
    );
  }

  /** Every item ever held at a key, newest first. The history of one belief. */
  public historyFor(scope: AnyMemoryScope, key: string): readonly MemoryItem[] {
    return [...this.#bucket(scope).values()]
      .filter((item: MemoryItem) => item.key === key)
      .sort((a: MemoryItem, b: MemoryItem) => b.writtenAt - a.writtenAt || (a.id < b.id ? 1 : -1));
  }

  /** Every scope that holds at least one memory. */
  public scopes(): readonly AnyMemoryScope[] {
    return [...this.#items.keys()].filter((scope) => this.#items.get(scope)?.size !== 0);
  }

  /** How many records exist, history included. */
  public size(): number {
    let total = 0;
    for (const bucket of this.#items.values()) {
      total += bucket.size;
    }
    return total;
  }

  /**
   * How many keys hold a current, retrievable belief.
   *
   * PHASE 07: this counted the `#current` index by SIZE, which is a count of ADDRESSES
   * rather than of beliefs - so an expired memory still counted, and the method's own
   * name ("how many keys hold a current, RETRIEVABLE belief") was false. Its doc had been
   * describing an invariant the code did not hold, which is the same defect shape as the
   * `listScope` one: a read path answering without asking whether the record is expired.
   *
   * Now it counts through `listScope`, so every read path on this store agrees about
   * what "current" means. Counting the index directly would have been faster and would
   * have kept the disagreement.
   */
  public liveCount(): number {
    let total = 0;
    for (const scope of this.#items.keys()) {
      total += this.listScope(scope).length;
    }
    return total;
  }

  /** How many current, retrievable memories a scope holds. */
  public activeCount(scope: AnyMemoryScope): number {
    return this.listScope(scope).length;
  }

  /**
   * Moves a memory to a new status.
   *
   * `deleted` is the only status that releases the key; every other one keeps the
   * item retrievable by an explicit request, so history is not lost.
   */
  public setStatus(id: MemoryItem["id"], status: MemoryStatus): Result<MemoryItem, MemoryStoreError> {
    const found = this.#findById(id);
    if (found === null) {
      return err(new MemoryStoreError(`Unknown memory: ${id}`));
    }
    const next: MemoryItem = { ...found.item, status };
    if (status === "deleted") {
      // Deletion releases the address but keeps the record, so "what did we once
      // believe, and when was it withdrawn?" stays answerable.
      this.#bucket(next.scope).set(next.id, next);
      this.#currentIndex(next.scope).delete(next.key);
    } else {
      this.#bucket(next.scope).set(next.id, next);
      this.#currentIndex(next.scope).set(next.key, next.id);
    }
    void this.#persist(next);
    return ok(next);
  }

  /**
   * Corrects a memory: the replacement keeps the address, the original is marked
   * superseded, and the chain of `supersedes` links records the order.
   */
  public correct(id: MemoryItem["id"], draft: MemoryDraft): Result<MemoryItem, MemoryStoreError> {
    const found = this.#findById(id);
    if (found === null) {
      return err(new MemoryStoreError(`Unknown memory: ${id}`));
    }
    const now = this.#clock.nowMs();
    const corrected = buildMemoryItem(
      {
        ...draft,
        scope: found.item.scope,
        key: found.item.key,
        // A correction is not a fresh observation: it is as current as its write.
        supersedes: [found.item.id, ...draft.supersedes ?? []],
      },
      now,
    );
    // The corrected record is a NEW item. Reusing the id would overwrite the very
    // record the correction is supposed to supersede, which is how history used
    // to disappear: the old belief was written to the port and then lost from
    // the index that serves reads.
    const replacement: MemoryItem = { ...corrected, id: `${found.item.scope}:${found.item.key}#${++this.#counter}` };
    this.#put({ ...found.item, status: "superseded", importance: 0 });
    this.#put(replacement);
    return ok(replacement);
  }

  /** Marks a memory as no longer fresh, without removing it. */
  public markStale(id: MemoryItem["id"]): Result<MemoryItem, MemoryStoreError> {
    return this.setStatus(id, "stale");
  }

  /** Withdraws a memory: it stops being returned, and stays on the record. */
  public invalidate(id: MemoryItem["id"], reason: string): Result<MemoryItem, MemoryStoreError> {
    const outcome = this.setStatus(id, "invalidated");
    if (!outcome.ok) {
      return outcome;
    }
    const next = { ...outcome.value, summary: `${outcome.value.summary} [invalidated: ${reason}]` };
    // PHASE 07 (D1). This wrote `set(next.key, next)` into a map that is keyed by
    // ID - every other writer here uses `set(next.id, next)`. The result typechecked,
    // `get` and `listScope` never showed it (both filter on status, and `#findById`
    // matches `item.id` across VALUES so the real record was still found), and it was
    // therefore invisible on every path a caller uses.
    //
    // It showed up in the two views that report on the store as a whole:
    // `historyFor(key)` returned the item twice, and `size()` counted two. And because
    // the phantom's map key is the memory KEY, it survived the original memory's
    // deletion and collided with whatever was next written at that address - so each
    // reuse of a key added one more permanent entry.
    this.#bucket(next.scope).set(next.id, next);
    void this.#persist(next);
    return ok(next);
  }

  /** Removes a memory and releases its address. Explicit, and the only deletion. */
  /**
   * Removes the current belief at a key and releases the address.
   *
   * Explicit, and the only deletion. The record itself is marked deleted rather
   * than erased, so a reader can still see that something was once held here.
   */
  public async delete(scope: AnyMemoryScope, key: string): Promise<boolean> {
    const current = this.#currentItem(scope, key);
    if (current === null) {
      return false;
    }
    this.#bucket(scope).set(current.id, { ...current, status: "deleted" });
    this.#currentIndex(scope).delete(key);
    await this.#provider.delete(this.#workspace, scope, `${ITEM_PREFIX}${key}`).catch(() => false);
    return true;
  }

  /** Every item that has passed its expiry, in any scope. */
  public expired(): readonly MemoryItem[] {
    const now = this.#clock.nowMs();
    const out: MemoryItem[] = [];
    for (const bucket of this.#items.values()) {
      for (const item of bucket.values()) {
        if (item.status === "active" && this.#isExpired(item, now)) {
          out.push(item);
        }
      }
    }
    return out;
  }

  /**
   * Removes expired memories and reports what went.
   *
   * Retention is explicit. A store that silently forgets is a store nobody can
   * reason about; one that reports the deletion is auditable.
   */
  public async purgeExpired(): Promise<readonly MemoryItem[]> {
    const due = this.expired();
    for (const item of due) {
      this.#bucket(item.scope).delete(item.id);
      this.#currentIndex(item.scope).delete(item.key);
    }
    await Promise.all(due.map((item) => this.#provider.delete(this.#workspace, item.scope, `${ITEM_PREFIX}${item.key}`).catch(() => false)));
    return due;
  }

  /* ---------------------------------------------------------------- */
  /* internals                                                        */
  /* ---------------------------------------------------------------- */

  #bucket(scope: AnyMemoryScope): Map<string, MemoryItem> {
    const bucket = this.#items.get(scope) ?? new Map<string, MemoryItem>();
    this.#items.set(scope, bucket);
    return bucket;
  }

  /** scope -> key -> current item id. */
  #currentIndex(scope: AnyMemoryScope): Map<string, string> {
    const index = this.#current.get(scope) ?? new Map<string, string>();
    this.#current.set(scope, index);
    return index;
  }

  /** The item currently held at a key, or null. */
  #currentItem(scope: AnyMemoryScope, key: string): MemoryItem | null {
    const id = this.#currentIndex(scope).get(key);
    return id === undefined ? null : this.#bucket(scope).get(id) ?? null;
  }

  /** Stores an item and makes it the current belief at its key. */
  #put(item: MemoryItem): void {
    this.#bucket(item.scope).set(item.id, item);
    this.#currentIndex(item.scope).set(item.key, item.id);
    void this.#persist(item);
  }

  #findById(id: string): { readonly item: MemoryItem; readonly scope: AnyMemoryScope } | null {
    for (const [scope, bucket] of this.#items) {
      for (const item of bucket.values()) {
        if (item.id === id) {
          return { item, scope };
        }
      }
    }
    return null;
  }

  #isExpired(item: MemoryItem, now: number): boolean {
    return item.expiresAt !== null && item.expiresAt <= now;
  }

  /**
   * Whether two drafts say the same thing.
   *
   * A structural comparison, deliberately conservative: it treats unequal values
   * as a conflict even when they might mean the same thing. A false conflict costs
   * a supersession; a missed conflict silently rewrites a belief.
   */
  #isSameClaim(a: MemoryItem, b: MemoryItem): boolean {
    return a.type === b.type && stableStringify(a.value) === stableStringify(b.value);
  }

  async #persist(item: MemoryItem): Promise<void> {
    try {
      await this.#writeThrough(item);
      await this.#writeIndex();
    } catch (error) {
      this.#persistenceFailures.push({
        key: item.key,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Writes the backing port rejected, readable by a caller or an operator. */
  public persistenceFailures(): readonly { readonly key: string; readonly reason: string }[] {
    return [...this.#persistenceFailures];
  }

  async #writeThrough(item: MemoryItem): Promise<void> {
    await this.#provider.write(this.#workspace, {
      scope: item.scope,
      key: `${ITEM_PREFIX}${item.key}`,
      value: item,
      writtenAt: this.#clock.nowMs(),
      writtenBy: item.provenance.sourceRef,
    });
  }

  async #writeIndex(): Promise<void> {
    const index: Record<string, string[]> = {};
    for (const scope of ALL_MEMORY_SCOPES) {
      const bucket = this.#items.get(scope);
      if (bucket !== undefined && bucket.size > 0) {
        index[scope] = [...bucket.keys()];
      }
    }
    await this.#provider.write(this.#workspace, {
      scope: "knowledge",
      key: INDEX_KEY,
      value: index,
      writtenAt: this.#clock.nowMs(),
      writtenBy: "memory.store",
    });
  }

  /**
   * Rehydrates from the provider.
   *
   * Needed because a `MemoryProvider` may be durable while this store is not:
   * a fresh process must see what a previous one wrote. Exposed rather than
   * automatic so a caller can decide when to pay for it.
   */
  public async load(): Promise<number> {
    let restored = 0;
    for (const scope of ALL_MEMORY_SCOPES) {
      const entries = await this.#provider.list(this.#workspace, scope);
      for (const entry of entries) {
        if (!entry.key.startsWith(ITEM_PREFIX)) {
          continue;
        }
        const item = entry.value as MemoryItem;
        if (item === null || typeof item !== "object" || !isMemoryStatus(item.status)) {
          continue;
        }
        this.#bucket(scope).set(item.id, item);
        // The newest record at a key is the one a read should see; the rest are
        // history, restored alongside it rather than discarded.
        if (item.status === "active") {
          this.#currentIndex(scope).set(item.key, item.id);
        }
        restored += 1;
      }
    }
    this.#loaded = true;
    return restored;
  }

  public get loaded(): boolean {
    return this.#loaded;
  }
}

/**
 * Key order does not change a value's meaning.
 *
 * Two memories are the same claim when they serialise identically, and
 * `{a:1,b:2}` and `{b:2,a:1}` are the same claim. Written out rather than pulled
 * in as a dependency.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

/** Convenience re-export so callers need not import two modules for one type. */
export function okOutcome(outcome: StoreOutcome): Result<StoreOutcome, MemoryStoreError> {
  return ok(outcome);
}
