/**
 * Memory.
 *
 * The orchestrator must not be coupled to a database, and an agent must not
 * automatically see everything it could see.
 *
 * Two mechanisms enforce that:
 *
 *  1. NAMESPACES. Every read and write names a scope. A task's memory is not the
 *     project's memory, and a pattern learned by one run is not system state.
 *  2. ACCESS CONTROL. A read is granted for a `(subject, scope)` pair. The
 *     provider records which scopes a read touched, so a later audit can show
 *     that an agent saw only what it was permitted to see. Access is explicit
 *     and separate from storage.
 *
 * Memory is not learning. A `FeedbackStore` writes to the `pattern` scope but
 * derives nothing on its own; see `feedback.ts`.
 *
 * The in-memory implementation is a REFERENCE implementation, not the
 * architecture. SQLite, a vector store, or a hybrid backend implements
 * `MemoryProvider` and requires no orchestrator change.
 */

import { ValidationError } from "../../core/errors.js";
import { err, ok, type Result } from "../../core/result.js";
import { type WorkspaceRef, workspaceKey } from "../workspace/workspace.js";
// PHASE 07: the ONE trust ranking, reused rather than re-derived here. See
// `MemoryGrant.minimumTrust`.
import { meetsTrustFloor, type TrustLevel } from "../agent/trust.js";

/**
 * Memory scopes.
 *
 * The original eight are unchanged. PHASE 05 added three, because a
 * conversational and organisational deployment needs places the earlier set could
 * not express:
 *
 *   `conversation`  the thread of one exchange; shorter-lived than a task
 *   `organization`  knowledge shared across an organisation
 *   `global`        the whole installation
 *
 * The union only grows, so every existing use keeps compiling. `global` is
 * deliberately the most privileged: it is implied by no other grant, and a
 * subject must be granted it explicitly.
 *
 * ## PHASE 07: THE DECLARATION ORDER IS THE BREADTH ORDER, AND IT IS NOW THE ONLY ONE
 *
 * This array used to be declared `system, project, task, ...` while `SCOPE_BREADTH`
 * ranked `conversation: 0` narrowest. Two hand-maintained orderings of the same eleven
 * values, with nothing asserting they agreed - so one could be reordered without the
 * other and the ranking would change silently.
 *
 * The declaration order IS the breadth order now, and `SCOPE_BREADTH` is DERIVED from
 * it. That makes the disagreement unrepresentable rather than merely asserted against:
 * there is no second list to fall out of step. Narrowest first:
 *
 *   conversation < task < agent < team < project < provider < pattern
 *                < knowledge < system < organization < global
 *
 * `MEMORY_SCOPES` order has no other reader - `ALL_MEMORY_SCOPES` is iterated in two
 * places in `store.ts` for order-independent counting and cleanup, and in one error
 * message - so reordering it changes no behaviour beyond making the ranking true.
 */
export const MEMORY_SCOPES = [
  "conversation",
  "task",
  "agent",
  "team",
  "project",
  "provider",
  "pattern",
  "knowledge",
  "system",
  "organization",
  "global",
] as const;

export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export function isMemoryScope(value: unknown): value is MemoryScope {
  return typeof value === "string" && (MEMORY_SCOPES as readonly string[]).includes(value);
}

/**
 * PHASE 07: how far each scope reaches, DERIVED from the declaration order above.
 *
 * It lives here, beside `MEMORY_SCOPES`, because that is the only place it can be
 * derived without a circular import - `model.ts` imports this module, so breadth could
 * not live there and be used from `MemoryAccessPolicy` in this file.
 *
 * It used to be a second hand-maintained table in `model.ts`, and the two disagreed:
 * `MEMORY_SCOPES` was declared `system, project, task, ...` while this ranked
 * `conversation` narrowest, with nothing asserting they agreed - so one could be
 * reordered without the other and the ranking would change silently. Deriving removes
 * the second list rather than asserting the two match.
 *
 * ## WHAT BREADTH IS FOR, AND WHERE IT IS ENFORCED
 *
 * Breadth answers one question: **how far does a memory reach?** It is the ceiling on
 * what a subject may be granted, enforced in exactly one place -
 * `MemoryAccessPolicy.grant()`, via `withinBreadth` below.
 *
 * It is deliberately NOT re-checked at read time. A second check on the read path would
 * be a second authority, and the recorded grant cannot contain an over-broad scope in the
 * first place, so `canRead`'s `scopes.includes()` is already sound.
 *
 * Before Phase 07 breadth was declared and **used nowhere**: `isBroaderScope` and
 * `importanceCeilingFor` had no production caller, so the invariant the comment always
 * described - "a `global` memory is not injected into a task merely because it exists" -
 * was not implemented at all. It is now.
 */
export const SCOPE_BREADTH: Readonly<Record<MemoryScope, number>> = Object.freeze(
  Object.fromEntries(MEMORY_SCOPES.map((scope, index) => [scope, index])),
) as Readonly<Record<MemoryScope, number>>;

/** The widest scope in this build. The divisor for any breadth normalisation. */
export const MAX_SCOPE_BREADTH = MEMORY_SCOPES.length - 1;

/**
 * PHASE 07: THE one function in the memory subsystem that consults breadth.
 *
 * A scope is kept when it is the subject's own operating scope or NARROWER than it, and
 * is otherwise stripped and named in `refused`. Applied to readable AND writable scopes
 * by the single caller, so a subject cannot gain a write it could not audit.
 *
 * `<=` rather than `<`: a subject operating at `task` must be able to hold a grant for
 * `task`, or the ceiling would refuse the one scope it is entitled to.
 */
function withinBreadth(
  scopes: readonly MemoryScope[],
  operatingScope: MemoryScope,
  refused: MemoryScope[],
): readonly MemoryScope[] {
  return scopes.filter((scope) => {
    const reachable = SCOPE_BREADTH[scope] <= SCOPE_BREADTH[operatingScope];
    if (!reachable) {
      refused.push(scope);
    }
    return reachable;
  });
}

/** Who is performing a memory operation. */
export interface MemorySubject {
  /**
   * A stable id for the SUBJECT. PHASE 06: this is the verified actor, never a
   * caller-chosen string.
   *
   * It used to be `` `task:${request.taskId}` `` - a value the caller supplies - so
   * presenting another task's id presented that task's grants. That was an
   * identity-confusion bug independent of tenancy, and it was fixed BEFORE
   * partitioning, because partitioning on a forgeable identity produces a
   * correctly-partitioned, completely forgeable system.
   *
   * A task may still choose a memory KEY. A key names an entry; it is not an
   * identity, and it grants nothing.
   */
  readonly id: string;
  /**
   * PHASE 06. The workspace this subject is acting in. REQUIRED.
   *
   * Required rather than optional because a subject that could omit it would fall
   * back to "some default workspace", and a default workspace is a shared one.
   */
  readonly workspace: WorkspaceRef;
  /**
   * PHASE 07. The scope this subject is OPERATING at, and therefore the widest scope it
   * may ever be granted. REQUIRED.
   *
   * ## Why breadth needed a field rather than a rule
   *
   * `SCOPE_BREADTH` existed and documented the invariant "a task may read its own
   * memory and anything narrower, but a `global` memory is not injected into a task
   * merely because it exists" - and had no production caller, so that invariant was not
   * implemented at all. A grant alone cannot express it: a grant is an allowlist, and an
   * allowlist says nothing about whether the thing granting it was entitled to.
   *
   * ## Why it is REQUIRED, and why that is the safe direction
   *
   * Optional would mean "no operating scope -> no ceiling", which is a fail-OPEN
   * default: the subject that says least gets the most. That is the same reasoning that
   * made `workspace` required in Phase 06, and the cost is the same - one field at one
   * production construction site.
   *
   * ## What it is NOT
   *
   * It is not a trust level and not a grant. It is a statement of where the subject is
   * working, and it only ever REMOVES scopes from what a grant could otherwise contain.
   * A subject operating at `global` still has to be granted each scope explicitly.
   */
  readonly operatingScope: MemoryScope;
  /** Trust level, so a grant can be withheld from a low-trust subject. */
  readonly trustLevel?: "untrusted" | "low" | "standard" | "high" | "privileged";
}

export interface MemoryEntry<T = unknown> {
  readonly scope: MemoryScope;
  readonly key: string;
  readonly value: T;
  /** Epoch ms. Written so a reader can reason about staleness. */
  readonly writtenAt: number;
  /** Subject that wrote it, for provenance. */
  readonly writtenBy: string;
}

export interface MemoryRead {
  readonly scope: MemoryScope;
  readonly key: string;
}

export interface MemoryGrant {
  readonly subject: MemorySubject;
  /** Scopes this subject may READ. */
  readonly scopes: readonly MemoryScope[];
  /**
   * Scopes this subject may WRITE.
   *
   * Separate from `scopes`, and required rather than defaulted: reading and
   * writing are different permissions, and a grant that quietly implied both
   * would make "this agent may see project memory" indistinguishable from "this
   * agent may rewrite it". An agent that should only observe is granted an
   * empty list here, which is the safe direction.
   */
  readonly writableScopes: readonly MemoryScope[];
  /**
   * PHASE 07: the lowest trust level this grant is valid for. REQUIRED.
   *
   * It exists because `MemorySubject.trustLevel` was declared - with the comment "so a
   * grant can be withheld from a low-trust subject" - and read NOWHERE. A declared
   * guarantee that guaranteed nothing is worse than no declaration, because a reader
   * reasonably concludes the field does something.
   *
   * Required rather than optional, and required to be the LOWEST value if a caller does
   * not care, so that omitting it can never widen anything.
   *
   * ## THE TRAP, AND WHY IT IS SAFE
   *
   * `trustLevel` is a field on the SUBJECT, which a caller constructs. Enforcing it
   * naively would let a caller write `trustLevel: "privileged"` into its own subject and
   * grant itself everything - a privilege-escalation bug introduced by the act of
   * enforcing a security field.
   *
   * It is safe because of two rules together:
   *
   *   1. The value comes from the VERIFIED identity. `authority.ts` copies
   *      `securityContext.trustLevel`, which the deployment's identity resolver
   *      produced - the same source `workspaceOf` trusts for `workspace`.
   *   2. An ABSENT value is the LOWEST, never the highest. A caller that constructs a
   *      subject without a trust level gets `untrusted`, not a bypass.
   */
  readonly minimumTrust: TrustLevel;
  /** Expiry in epoch ms. null = no expiry. A grant should not be permanent by default. */
  readonly expiresAt: number | null;
}

/**
 * The memory port.
 *
 * PHASE 06: every operation takes a `WorkspaceRef` FIRST, and it is a parameter
 * rather than something the implementation infers from the entry. That is the
 * difference between partitioning and filtering: a store whose raw `read` has no
 * workspace parameter can be asked to read any partition by anyone holding a
 * handle to it, and the only thing standing between that and a cross-tenant read
 * is every call site remembering to scope itself - which is C-1, shipped.
 *
 * Implementations must be idempotent on write (same key and value is not an
 * error) and must never widen a read beyond the scopes granted.
 */
export interface MemoryProvider {
  readonly name: string;
  write<T>(workspace: WorkspaceRef, entry: MemoryEntry<T>): Promise<void>;
  read<T>(workspace: WorkspaceRef, scope: MemoryScope, key: string): Promise<T | null>;
  list(workspace: WorkspaceRef, scope: MemoryScope): Promise<readonly MemoryEntry[]>;
  delete(workspace: WorkspaceRef, scope: MemoryScope, key: string): Promise<boolean>;
}

/** Raised when a subject performs an operation it was not granted. */
export class MemoryAccessError extends Error {
  public readonly subject: string;
  public readonly scope: MemoryScope;
  public constructor(subject: string, scope: MemoryScope) {
    super(`Subject "${subject}" is not granted access to the "${scope}" memory scope`);
    this.name = "MemoryAccessError";
    this.subject = subject;
    this.scope = scope;
  }
}

export class MemoryKeyError extends ValidationError {
  public readonly scope: MemoryScope;
  public readonly key: string;

  public constructor(scope: MemoryScope, key: string) {
    super("Memory key is invalid", [
      `key must be 1-200 characters of letters, digits, dash, underscore, colon or dot: "${key}"`,
    ]);
    this.name = "MemoryKeyError";
    this.scope = scope;
    this.key = key;
  }
}

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

export function isValidMemoryKey(key: unknown): key is string {
  return typeof key === "string" && KEY_PATTERN.test(key);
}

/**
 * Millisecond time, which is what expiry is expressed in.
 *
 * A `Date`-returning clock is not accepted: comparing a Date to an epoch
 * number compiles only through a coercion, which would silently be wrong.
 */
export interface EpochClock {
  nowMs(): number;
}

/**
 * Access control for memory scopes.
 *
 * Separate from storage on purpose: swapping the backend must not change who can
 * read what, and changing the policy must not require touching the backend.
 */
export class MemoryAccessPolicy {
  /**
   * PHASE 06: keyed `(workspace, subjectId)`, not `subjectId`.
   *
   * The old key was the bare id, which made a grant a process-wide fact about a
   * string. The composite key means a grant for `user:kim` in `acme` is simply not
   * reachable from `user:kim` in `globex` - not filtered out, absent.
   */
  readonly #grants = new Map<string, MemoryGrant>();
  readonly #clock: EpochClock;

  public constructor(clock: EpochClock = { nowMs: () => Date.now() }) {
    this.#clock = clock;
  }

  /**
   * Records a grant, REPLACING any grant for the same `(workspace, subject)`, and
   * refusing to record scopes the subject's operating scope does not reach.
   *
   * `TODO.md` PHASE 06 item 6 asked whether the overwrite is intended. It is, and the
   * reason is worth stating because the alternative looks friendlier: a grant that
   * silently UNIONED scopes could never be shrunk, so withdrawing a capability would be
   * impossible and a re-grant after a compromise would hand back everything the subject
   * ever had. Overwrite is the direction that can take authority away. What was
   * genuinely missing was that it was invisible, so the result reports whether anything
   * was replaced.
   *
   * ## PHASE 07: the breadth ceiling is enforced HERE, and only here
   *
   * A scope broader than `subject.operatingScope` is stripped and REPORTED in
   * `refusedScopes`. This is the single place breadth is consulted, which is why the
   * read path does not check it: the grant cannot contain an over-broad scope, so
   * `canRead`'s `scopes.includes()` is already sound. A second check on the read path
   * would be a second authority, and two places that can disagree about access is the
   * defect this project keeps finding.
   *
   * Narrow-and-report rather than refuse-the-grant: a whole-grant refusal would also
   * remove the scopes the caller was entitled to, so a deployment that listed one
   * over-broad scope would present as a policy that rejects all memory. Reporting is
   * what makes the misconfiguration visible without turning it into an outage.
   */
  public grant(grant: MemoryGrant): { replaced: boolean; refusedScopes: readonly MemoryScope[] } {
    const key = grantKey(grant.subject);
    const replaced = this.#grants.has(key);
    const refused: MemoryScope[] = [];
    const scopes = withinBreadth(grant.scopes, grant.subject.operatingScope, refused);
    const writableScopes = withinBreadth(grant.writableScopes, grant.subject.operatingScope, refused);
    this.#grants.set(key, { ...grant, scopes, writableScopes });
    return { replaced, refusedScopes: [...new Set(refused)] };
  }

  /** Revokes a grant. Requires the subject, so a revoke cannot leak across one. */
  public revoke(subject: MemorySubject): boolean {
    return this.#grants.delete(grantKey(subject));
  }

  public canRead(subject: MemorySubject, scope: MemoryScope): boolean {
    return this.#isCurrent(subject, (grant) => grant.scopes.includes(scope));
  }

  /** Whether a subject may WRITE a scope. Not implied by being able to read it. */
  public canWrite(subject: MemorySubject, scope: MemoryScope): boolean {
    return this.#isCurrent(subject, (grant) => grant.writableScopes.includes(scope));
  }

  #isCurrent(subject: MemorySubject, allowed: (grant: MemoryGrant) => boolean): boolean {
    const grant = this.#grants.get(grantKey(subject));
    if (!grant) {
      return false;
    }
    if (grant.expiresAt !== null && grant.expiresAt <= this.#clock.nowMs()) {
      return false;
    }
    // PHASE 07: the trust floor. Checked HERE, beside expiry, because both are
    // "is this grant still valid" questions and splitting them would give one concept
    // two homes.
    //
    // An absent `trustLevel` is UNTRUSTED, not unconstrained. The fail-open default
    // (`subject.trustLevel ?? "privileged"`) would make omitting the field the most
    // privileged thing a caller could do.
    //
    // `meetsTrustFloor` is the EXISTING ranking from `agent/trust.ts`, reused rather
    // than re-derived: a second trust ordering in this file would be a second authority
    // on who outranks whom, and the two could disagree.
    if (!meetsTrustFloor(subject.trustLevel ?? "untrusted", grant.minimumTrust)) {
      return false;
    }
    return allowed(grant);
  }

  /** Scopes a subject may currently read. */
  public readableScopes(subject: MemorySubject): readonly MemoryScope[] {
    const grant = this.#grants.get(grantKey(subject));
    if (!grant) {
      return [];
    }
    if (grant.expiresAt !== null && grant.expiresAt <= this.#clock.nowMs()) {
      return [];
    }
    return grant.scopes;
  }

  public assertRead(subject: MemorySubject, scope: MemoryScope): Result<true, MemoryAccessError> {
    return this.canRead(subject, scope) ? ok(true) : err(new MemoryAccessError(subject.id, scope));
  }

  public assertWrite(subject: MemorySubject, scope: MemoryScope): Result<true, MemoryAccessError> {
    return this.canWrite(subject, scope) ? ok(true) : err(new MemoryAccessError(subject.id, scope));
  }
}

/** The one place a memory grant is keyed. Composite, so the key cannot be confused. */
function grantKey(subject: MemorySubject): string {
  return workspaceKey(subject.workspace, subject.id);
}

/**
 * Reference in-memory implementation.
 *
 * Deliberately not persistent. Its purpose is to prove the contract and to keep
 * the orchestrator runnable in tests without a database.
 */
export class InMemoryMemoryProvider implements MemoryProvider {
  public readonly name = "in_memory";
  /**
   * PHASE 06: `workspace -> scope -> key -> entry`.
   *
   * The workspace is the OUTER key rather than a field on the entry, and that is
   * the whole design. A cross-workspace read is not filtered out - there is no
   * path from that workspace to the entry at all, so the read misses. Putting the
   * workspace on the entry instead would make every lookup a chance to forget it,
   * and "a chance to forget" is C-1, which is a defect this repository shipped.
   */
  readonly #entries = new Map<string, Map<MemoryScope, Map<string, MemoryEntry>>>();
  /** Scope keys a read actually touched, for audit. */
  readonly #readLog: Array<{ subject: string; workspace: WorkspaceRef; scope: MemoryScope; key: string }> = [];

  // Synchronous in-memory operations, returned as settled promises. The port is
  // async so a real database-backed provider can be dropped in unchanged; these
  // methods are not `async` because they await nothing, and saying so in the
  // code is more honest than an `await` on nothing.
  public write<T>(workspace: WorkspaceRef, entry: MemoryEntry<T>): Promise<void> {
    if (!isValidMemoryKey(entry.key)) {
      return Promise.reject(new MemoryKeyError(entry.scope, entry.key));
    }
    const byScope = this.#entries.get(workspaceKey(workspace)) ?? new Map<MemoryScope, Map<string, MemoryEntry>>();
    const bucket = byScope.get(entry.scope) ?? new Map<string, MemoryEntry>();
    bucket.set(entry.key, entry);
    byScope.set(entry.scope, bucket);
    this.#entries.set(workspaceKey(workspace), byScope);
    return Promise.resolve();
  }

  public read<T>(workspace: WorkspaceRef, scope: MemoryScope, key: string): Promise<T | null> {
    return Promise.resolve(
      (this.#entries.get(workspaceKey(workspace))?.get(scope)?.get(key)?.value as T | undefined) ?? null,
    );
  }

  public list(workspace: WorkspaceRef, scope: MemoryScope): Promise<readonly MemoryEntry[]> {
    return Promise.resolve([...(this.#entries.get(workspaceKey(workspace))?.get(scope)?.values() ?? [])]);
  }

  public delete(workspace: WorkspaceRef, scope: MemoryScope, key: string): Promise<boolean> {
    return Promise.resolve(this.#entries.get(workspaceKey(workspace))?.get(scope)?.delete(key) ?? false);
  }

  /**
   * Scoped read, enforcing policy and recording the access.
   *
   * This is the method the orchestrator uses. `read` is the raw backend
   * operation; policy lives here so a caller cannot bypass it by accident.
   */
  public async readScoped<T>(
    policy: MemoryAccessPolicy,
    subject: MemorySubject,
    scope: MemoryScope,
    key: string,
  ): Promise<T | null> {
    const allowed = policy.assertRead(subject, scope);
    if (!allowed.ok) {
      throw allowed.error;
    }
    this.#readLog.push({ subject: subject.id, workspace: subject.workspace, scope, key });
    return this.read<T>(subject.workspace, scope, key);
  }

  public async writeScoped<T>(
    policy: MemoryAccessPolicy,
    subject: MemorySubject,
    entry: MemoryEntry<T>,
  ): Promise<void> {
    // A write is checked against WRITE permission. It previously checked read
    // permission, which meant any subject allowed to read a scope could also
    // overwrite it.
    const allowed = policy.assertWrite(subject, entry.scope);
    if (!allowed.ok) {
      throw allowed.error;
    }
    await this.write(subject.workspace, { ...entry, writtenBy: subject.id });
  }

  /** Every read performed, for an audit that must show what was seen, and where. */
  public readLog(): readonly { subject: string; workspace: WorkspaceRef; scope: MemoryScope; key: string }[] {
    return [...this.#readLog];
  }

  public scopes(workspace: WorkspaceRef): readonly MemoryScope[] {
    return [...(this.#entries.get(workspaceKey(workspace))?.keys() ?? [])];
  }

  public size(): number {
    let total = 0;
    for (const byScope of this.#entries.values()) {
      for (const bucket of byScope.values()) {
        total += bucket.size;
      }
    }
    return total;
  }

  /** How many workspaces this store currently holds anything for. */
  public workspaceCount(): number {
    return this.#entries.size;
  }

  public clear(): void {
    this.#entries.clear();
    this.#readLog.length = 0;
  }
}

/** A memory provider that grants nothing, for a deployment that stores no memory. */
export class DisabledMemoryProvider implements MemoryProvider {
  public readonly name = "disabled";
  public write<T>(_workspace: WorkspaceRef, _entry: MemoryEntry<T>): Promise<void> {
    // Intentionally a no-op: a disabled provider is not an error.
    return Promise.resolve();
  }
  public read<T>(_workspace: WorkspaceRef, _scope: MemoryScope, _key: string): Promise<T | null> {
    return Promise.resolve(null);
  }
  public list(_workspace: WorkspaceRef, _scope: MemoryScope): Promise<readonly MemoryEntry[]> {
    return Promise.resolve([]);
  }
  public delete(_workspace: WorkspaceRef, _scope: MemoryScope, _key: string): Promise<boolean> {
    return Promise.resolve(false);
  }
}
