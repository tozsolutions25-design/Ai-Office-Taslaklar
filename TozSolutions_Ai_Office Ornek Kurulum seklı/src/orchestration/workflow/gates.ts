/**
 * PHASE 07: checkpoints and approval gates.
 *
 * Both are here because both share the same honesty requirement: a record of
 * progress is only useful if it is accurate about whether progress can be
 * resumed from it.
 */

import { createHash } from "node:crypto";
import { type WorkspaceRef, workspaceKey } from "../workspace/workspace.js";
import { type Clock, systemClock } from "../../core/clock.js";
import { DURABLE_SCHEMA_VERSION, type DurableStateRepository, type CheckpointRow } from "../../state/durable.js";
import { checkpointIdentity, type IdentityKey } from "../../state/identity.js";
import {
  type ApprovalGate,
  type ApprovalState,
  type Checkpoint,
  canTransitionApproval,
  isTerminalApprovalState,
} from "./model.js";

/**
 * PHASE 10: the composite key every job-scoped store must use.
 *
 * WHY THIS EXISTS
 *
 * A `taskId` is only unique WITHIN a job. It is not unique within a process. Two
 * jobs that both contain a task called "step-1" are ordinary, and nothing in this
 * codebase forbids them.
 *
 * Every store in this file and in `coordinator.ts` used to be keyed by `taskId`
 * ALONE. That made the last writer win, which produced two very different
 * failures depending on the order of arrival:
 *
 *   - attempts, checkpoints and results from different jobs interleaved into one
 *     record, so a run reported history that never happened;
 *   - and, far worse, an APPROVAL BYPASS: `ApprovalRegistry` kept one gate per
 *     taskId, so approving job A's task released job B's identically-named task
 *     while job B's own gate sat un-approved. Verified empirically in PHASE 10 -
 *     it fails OPEN when the approved job's gate is the one that survives the
 *     last-write, and fails CLOSED in the opposite order.
 *
 * An approval gate that another job's decision can satisfy is not an approval
 * gate, so the key is now composed. This is the ONE place the composition lives:
 * a second spelling would be a second chance to get it wrong.
 *
 * PHASE 06 puts the WORKSPACE in that same key, for the same reason and one step
 * further out. `(jobId, taskId)` was enough to stop one job approving another; it
 * is not enough once two customers share a process, because both may name a job
 * `job-1`. Two identical job ids in two workspaces would still collide, and an
 * approval decided in one would release the other's task.
 *
 * The workspace is therefore part of the KEY rather than a field compared at read
 * time. That is the whole difference between partitioning and filtering: a
 * cross-workspace lookup is not rejected by a check somebody could forget, it
 * **misses**, because there is no key that finds it. `taskKey` is a single
 * function with the call sites enumerated in this file, `claims.ts` and
 * `coordinator.ts`, so "partition the key" is one change here rather than a filter
 * on every read.
 *
 * The separator is U+0000, written as an escape so this file stays plain ASCII
 * text. A NUL cannot appear in a jobId or taskId, so the composition is
 * unambiguous. Even if one ever did, a collision would degrade to a wrong gate
 * lookup, which `mayRelease` resolves fail-closed - never to a false approval.
 *
 * WHY `null` IS A REAL WORKSPACE AND NOT A WILDCARD. A gate opened before any
 * workspace was known is keyed under the unattributed partition, and a partitioned
 * reader never reaches it. That is deliberate: "we do not know where this is" and
 * "this is everywhere" are different statements, and only one of them is safe.
 */
export function taskKey(jobId: string, taskId: string, workspace?: WorkspaceRef | null): string {
  // The optional third argument exists so the SINGLE-partition case keeps a stable
  // key shape and the existing assertions on key composition still describe it. It
  // is NOT a default: a caller with a workspace must pass it, and the coordinator -
  // the only component that opens gates - always does.
  //
  // `null` is the UNATTRIBUTED partition, which is a real partition and not a
  // wildcard. It has to compose to a key, because an unattributed job still has
  // tasks that need claims and approvals; it is a different key from every
  // partitioned one, and a partitioned reader never reaches it.
  return workspace === undefined
    ? `${jobId}\u0000${taskId}`
    : workspace === null
      ? `\u0000${jobId}\u0000${taskId}`
      : workspaceKey(workspace, jobId, taskId);
}

/* -------------------------------------------------------------------------- */
/* Checkpoints                                                                 */
/* -------------------------------------------------------------------------- */

export class CheckpointError extends Error {
  public readonly taskId: string;
  public constructor(taskId: string, detail: string) {
    super(`Checkpoint for task "${taskId}": ${detail}`);
    this.name = "CheckpointError";
    this.taskId = taskId;
  }
}

/**
 * Stores checkpoints, newest-sequence-wins per task.
 *
 * A lower sequence is never treated as newer, which is what stops a slow worker
 * writing an old checkpoint over a newer one after a retry. `recoverable` is
 * carried from the task, never inferred here: only the task knows whether its
 * side effects can be replayed.
 */
/**
 * PHASE 12: the checkpoint store, on `DurableStateRepository`.
 *
 * ## WHY THIS CLASS STILL EXISTS
 *
 * It is no longer a store. Before Phase 12 it OWNED a `Map` and every answer came from it. Now
 * the repository owns the rows and this class is the workflow's vocabulary over them -
 * `recoveryPlan` stays here because the DECISION belongs to the workflow, while the FACTS belong
 * to the repository.
 *
 * ## THE ORDERING RULE, WRITTEN WHERE IT CAN BE READ
 *
 *     write:  validate -> repository.transaction(append) -> #cache
 *     read:   repository -> returned directly
 *
 * The cache is never consulted for an authoritative answer. That is the whole "no dual authority"
 * rule, and it is why `#cache` is written in exactly one place and read in none.
 *
 * ## IDENTITY
 *
 * `checkpointId` was `cp-${processCounter++}`, which restarted at `cp-1` - measured, not assumed:
 * the Phase 12 discovery probe opened a fresh store and its first checkpoint was `cp-1` again.
 * Identity now comes from `checkpointIdentity()`, derived from durable inputs, and the sequence
 * continues from `repository.nextCheckpointSequence()` rather than a process counter.
 */
export class CheckpointStore {
  /** Non-authoritative mirror, written after the repository and read by nobody. */
  readonly #cache = new Map<string, Checkpoint[]>();
  readonly #repository: DurableStateRepository;
  readonly #clock: Clock;
  readonly #perTaskLimit: number;
  readonly #identity: IdentityKey;

  public constructor(options: {
    repository: DurableStateRepository;
    clock?: Clock;
    perTaskLimit?: number;
    identity?: IdentityKey;
  }) {
    this.#repository = options.repository;
    this.#clock = options.clock ?? systemClock;
    this.#perTaskLimit = options.perTaskLimit ?? 20;
    // A caller-supplied secret, because a key generated here would be new on every start and
    // every id from a previous run would become unverifiable - the failure being fixed.
    this.#identity = options.identity ?? { secret: "toz-phase-12-development-key", schemaVersion: DURABLE_SCHEMA_VERSION };
  }

  /** The ONLY place this store composes a checkpoint key. */
  #key(jobId: string, taskId: string): string {
    return taskKey(jobId, taskId, this.#repository.scope);
  }

  public write(input: {
    jobId: string;
    taskId: string;
    executionId: string;
    progress: string;
    dataRef: string;
    /** Declared by the task, not guessed here. */
    recoverable: boolean;
    notRecoverableReason?: string | null;
  }): Checkpoint {
    if (input.dataRef.trim() === "") {
      // A checkpoint with no reference points at nothing, and resuming from it
      // would silently restart the task's work while claiming to continue it.
      throw new CheckpointError(input.taskId, "a dataRef is required; a checkpoint must point at resumable data");
    }
    if (!input.recoverable && (input.notRecoverableReason ?? "") === "") {
      throw new CheckpointError(
        input.taskId,
        "a non-recoverable checkpoint must say why, so recovery cannot guess",
      );
    }

    // Sequence allocation and the append share ONE transaction. Allocating from the repository
    // and inserting afterwards would leave a window in which two writers read the same next
    // sequence, which is exactly the collision this class previously had by construction.
    const checkpoint = this.#repository.transaction(() => {
      const sequence = this.#repository.nextCheckpointSequence(input.jobId, input.taskId);
      const checkpointId = checkpointIdentity(this.#identity, {
        workspace: this.#repository.scope.workspace,
        jobId: input.jobId,
        taskId: input.taskId,
        sequence,
        executionId: input.executionId,
      });
      const row: CheckpointRow = {
        checkpointId,
        jobId: input.jobId,
        taskId: input.taskId,
        executionId: input.executionId,
        sequence,
        at: this.#clock.nowMs(),
        progress: input.progress,
        dataRef: input.dataRef,
        recoverable: input.recoverable,
        notRecoverableReason: input.recoverable ? null : (input.notRecoverableReason ?? null),
      };
      this.#repository.appendCheckpoint(row);
      return this.#toCheckpoint(row);
    });

    // Repository has committed. The cache is updated after, and is never read back.
    this.#mirror(checkpoint);
    return checkpoint;
  }

  /**
   * Per-task retention is NOT enforced durably in this slice, and that is a decision rather than
   * an omission.
   *
   * Before Phase 12 the limit evicted from an in-process array, so "keep the newest 20" cost
   * nothing: the array died with the process. Enforcing the same limit on durable rows would mean
   * DELETING checkpoints - which is to say, destroying the resume points that recovery exists to
   * use - and how much history to keep is a product question with a data-loss answer on one side.
   *
   * So the limit applies to the non-authoritative mirror only, and durable rows accumulate. That
   * is recorded in `TODO.md` rather than settled here.
   */
  public perTaskLimit(): number {
    return this.#perTaskLimit;
  }

  public forTask(jobId: string, taskId: string): readonly Checkpoint[] {
    return this.#repository.listCheckpoints(jobId, taskId).map((row) => this.#toCheckpoint(row));
  }

  public latest(jobId: string, taskId: string): Checkpoint | null {
    const row = this.#repository.latestCheckpoint(jobId, taskId);
    return row === null ? null : this.#toCheckpoint(row);
  }

  public count(jobId: string, taskId: string): number {
    return this.#repository.listCheckpoints(jobId, taskId).length;
  }

  /** What a restart should do. Reads the repository, never the mirror. */
  public recoveryPlan(jobId: string, taskId: string): {
    readonly action: "resume" | "restart" | "no_checkpoint";
    readonly checkpoint: Checkpoint | null;
    readonly detail: string;
  } {
    const latest = this.latest(jobId, taskId);
    if (latest === null) {
      return { action: "no_checkpoint", checkpoint: null, detail: `Task "${taskId}" has no checkpoint, so it starts from the beginning.` };
    }
    if (!latest.recoverable) {
      return {
        action: "restart",
        checkpoint: latest,
        detail: `Task "${taskId}" has a checkpoint at sequence ${latest.sequence}, but resuming from it is not safe: ${latest.notRecoverableReason ?? "not stated"}. The task restarts.`,
      };
    }
    return {
      action: "resume",
      checkpoint: latest,
      detail: `Task "${taskId}" resumes from checkpoint ${latest.checkpointId} at sequence ${latest.sequence} (${latest.progress}).`,
    };
  }

  public clearTask(jobId: string, taskId: string): void {
    this.#cache.delete(this.#key(jobId, taskId));
  }

  public clear(): void {
    this.#cache.clear();
  }

  #mirror(checkpoint: Checkpoint): void {
    const key = this.#key(checkpoint.jobId, checkpoint.taskId);
    const list = this.#cache.get(key) ?? [];
    list.push(checkpoint);
    while (list.length > this.#perTaskLimit) list.shift();
    this.#cache.set(key, list);
  }

  #toCheckpoint(row: CheckpointRow): Checkpoint {
    return {
      checkpointId: row.checkpointId,
      jobId: row.jobId,
      taskId: row.taskId,
      executionId: row.executionId,
      sequence: row.sequence,
      at: row.at,
      progress: row.progress,
      dataRef: row.dataRef,
      recoverable: row.recoverable,
      notRecoverableReason: row.notRecoverableReason,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Approval                                                                    */
/* -------------------------------------------------------------------------- */

export class ApprovalError extends Error {
  public readonly gateId: string;
  public constructor(gateId: string, detail: string) {
    super(`Approval gate "${gateId}": ${detail}`);
    this.name = "ApprovalError";
    this.gateId = gateId;
  }
}

/* -------------------------------------------------------------------------- */
/* What an approval is bound to                                                */
/* -------------------------------------------------------------------------- */

/**
 * PHASE 04: the parts of a task that make it THE SAME WORK.
 *
 * Deliberately narrow, and each exclusion is a decision rather than an omission:
 *
 *   - `objective`, `input`, `requiredCapabilities`, `minimumTrust` are IN. Change
 *     any of them and the system is doing something a human was not asked about.
 *   - `dependsOn` is OUT. It changes what runs BEFORE this task, not what this task
 *     does, and its result is decided by the release plan rather than by approval.
 *   - `limits`, `priority`, `checkpointable`, `jobId`, `taskId` are OUT. They are
 *     scheduling and identity, not content. `jobId` and `taskId` are already the
 *     gate's KEY, so including them here would add nothing and would make two gates
 *     for the same material indistinguishable - which is the opposite of what an
 *     attribution field is for.
 *   - the attempt number and the clock are OUT, because a retry of the same content
 *     is the same content and must not need a second approval.
 */
export interface ApprovalIntent {
  readonly objective: string;
  readonly input: string;
  readonly requiredCapabilities: readonly string[];
  readonly minimumTrust: string;
}

/**
 * The digest an approval is bound to.
 *
 * SHA-256, from `node:crypto`, which this repository already uses for identity
 * (`core/ids.ts`). A non-cryptographic digest would be a poor choice for a security
 * boundary specifically because it is fast to collide, and a colliding digest here
 * means one approval releasing another's content.
 *
 * DETERMINISM IS THE POINT. The gate is opened in one call and checked in another,
 * possibly in a different process boundary, so the same intent must produce the same
 * string every time. Two rules make that true:
 *
 *   1. capabilities are SORTED. The requirement is a set; an ordering is a
 *      representation detail, and treating a reordering as a different intent would
 *      invalidate a real approval for no reason - a fail-closed rule that fires on
 *      nothing is not a safety property, it is an outage.
 *   2. fields are joined with U+0000, which cannot occur in any of them, for the same
 *      reason `taskKey` uses it. Without a separator, `["ab","c"]` and `["a","bc"]`
 *      would be the same string.
 *
 * No field is read from outside the intent, and nothing is defaulted: an absent
 * capability list contributes an empty string, which is what it is.
 */
export function approvalBindingOf(intent: ApprovalIntent): string {
  const canonical = [
    intent.objective,
    intent.input,
    // U+0000 within a field and U+0001 between them, written as escapes so this file
    // stays plain ASCII. Neither can occur in a capability name, a minimum trust
    // level or free text a caller supplies - and without a separator `["ab","c"]`
    // and `["a","bc"]` would be the same string, so two different intents would
    // share a binding. `taskKey` uses the same idiom for the same reason.
    [...intent.requiredCapabilities].sort().join("\u0000"),
    intent.minimumTrust,
  ].join("\u0001");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/* -------------------------------------------------------------------------- */
/* Where approval records live                                                 */
/* -------------------------------------------------------------------------- */

/**
 * PHASE 04: what durability this store actually provides.
 *
 * A literal union, not a boolean, because "durable" is a claim with a specific
 * meaning (the record survives a process exit) and a boolean would let a store
 * answer `true` without anyone having defined what it promised.
 */
export type ApprovalDurability = "process-local" | "durable";

/**
 * Where approval records are kept.
 *
 * `MASTER_PLAN.md` §8.6 asks for an approval record that is DURABLE, and §8.4 puts
 * "approval state survives a process restart" in the project definition of done -
 * which is Phase 12's work, and B-02 (the persistence substrate) is still an open
 * decision. So this phase owes the SEAM and not the provider:
 *
 *   - the registry reads and writes every record through this port, so a deployment
 *     that wants durability supplies a store rather than forking the registry;
 *   - the only shipped implementation is process-local and says so, so nobody can
 *     read "approval" and infer "survives a restart";
 *   - `describe()` reports what the store claims, measured rather than asserted.
 *
 * There is no `put` that could overwrite a decision: the registry only ever writes
 * a gate it has just built, and the record is frozen before it arrives.
 */
export interface ApprovalRecordStore {
  /** What this store can honestly promise. Read by `describe()`. */
  readonly durability: ApprovalDurability;
  put(gate: ApprovalGate): void;
  get(gateId: string): ApprovalGate | null;
  byTask(jobId: string, taskId: string): ApprovalGate | null;
  all(): readonly ApprovalGate[];
  clear(): void;
}

/**
 * The only shipped store: two maps in this process.
 *
 * It is the pre-PHASE 12 behaviour, extracted into a named type so that (a) the
 * non-durability is stated in one place rather than implied by the absence of a
 * database, and (b) swapping it requires changing one constructor argument.
 *
 * `durability` is `"process-local"` because that is exactly what it is. A restart
 * loses every gate, which means an approved gate becomes unknown and the task is
 * held again - fail-closed, which is the right direction to fail in, and still not
 * durability.
 */
export class InProcessApprovalRecordStore implements ApprovalRecordStore {
  public readonly durability: ApprovalDurability = "process-local";
  readonly #byId = new Map<string, ApprovalGate>();
  /**
   * PHASE 06: task -> gateId, and this index is the one that has to be partitioned.
   *
   * `#byId` needs nothing: a gate id is a `gate_...` random value, so it cannot
   * collide across workspaces. `#byTask` is the reverse index, and unpartitioned it
   * answers a request for job/task ids another workspace already gated - handing back
   * that workspace's decision, approver and timestamps, and letting `cancel` close
   * their gate.
   */
  readonly #byTask = new Map<string, string>();
  readonly #workspace: WorkspaceRef | null;

  public constructor(options: { workspace?: WorkspaceRef | null } = {}) {
    this.#workspace = options.workspace ?? null;
  }

  /** The ONLY place this store composes a task key. */
  #key(jobId: string, taskId: string): string {
    return taskKey(jobId, taskId, this.#workspace);
  }

  public put(gate: ApprovalGate): void {
    this.#byId.set(gate.gateId, gate);
    // PHASE 10: keyed by JOB as well as task. Keyed by task alone, the last job to
    // open a gate for a taskId owned the mapping, so approving one job released
    // another job's un-approved task. See `taskKey`.
    this.#byTask.set(this.#key(gate.jobId, gate.taskId ?? ""), gate.gateId);
  }

  public get(gateId: string): ApprovalGate | null {
    return this.#byId.get(gateId) ?? null;
  }

  public byTask(jobId: string, taskId: string): ApprovalGate | null {
    const gateId = this.#byTask.get(this.#key(jobId, taskId));
    return gateId === undefined ? null : (this.#byId.get(gateId) ?? null);
  }

  public all(): readonly ApprovalGate[] {
    return [...this.#byId.values()];
  }

  public clear(): void {
    this.#byId.clear();
    this.#byTask.clear();
  }
}

/**
 * Approval gates.
 *
 * The rules, in the order they matter:
 *
 *   1. A gate is decided by an APPROVER, recorded by name.
 *   2. The executor cannot be the approver. `assertDecidable` refuses when the
 *      deciding party is the worker or the task being approved, so approval the
 *      executor grants itself is impossible rather than merely discouraged.
 *   3. A decision is terminal. An approved gate cannot be revoked by a later
 *      retry, a fallback provider, or a second attempt, because there is no edge
 *      out of a terminal approval state.
 *   4. A retry does NOT bypass a gate. Re-entering a waiting-approval task still
 *      requires the gate to be approved, because the gate is consulted on every
 *      release, not once per job.
 */
export class ApprovalRegistry {
  readonly #store: ApprovalRecordStore;
  readonly #clock: Clock;
  #counter = 0;

  /**
   * PHASE 04: the store is an ARGUMENT, so the record container can be replaced
   * without touching this class - which is what Phase 12 needs, and what
   * `MASTER_PLAN.md` §8.6's "durable" asks for. It defaults to the process-local
   * store, which says what it is; a deployment that needs durability supplies one
   * rather than getting a Map and a promise.
   *
   * PHASE 06: `workspace` is passed DOWN to the default store, which is what makes
   * the reverse index partitioned. A SUPPLIED store is the caller's responsibility and
   * must be partitioned by the same workspace - the interface cannot enforce it, so it
   * is stated here rather than implied. The composition root always builds the
   * default one with the runtime's workspace, so the production path cannot be wrong.
   */
  public constructor(options: { clock?: Clock; store?: ApprovalRecordStore; workspace?: WorkspaceRef | null } = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#store = options.store ?? new InProcessApprovalRecordStore({ workspace: options.workspace ?? null });
  }

  /** What this registry's records can honestly promise. Read by `describe()`. */
  public get durability(): ApprovalDurability {
    return this.#store.durability;
  }

  /**
   * Opens a gate, bound to WHAT it is approving.
   *
   * `intent` is required and has no default, for the PHASE 01 (C-3) reason: a
   * default would let a future call site reintroduce an unbound approval by
   * forgetting the argument, and the compiler would not complain. The digest is
   * computed HERE from the intent, so no caller supplies the binding itself.
   */
  public open(input: { jobId: string; taskId: string; question: string; intent: ApprovalIntent; expiresAtMs?: number | null }): ApprovalGate {
    if (input.question.trim() === "") {
      throw new ApprovalError("new", "an approval must ask a question; an empty one cannot be judged");
    }
    if (input.intent.objective.trim() === "" && input.intent.input.trim() === "") {
      // Fail-closed. A gate bound to nothing would be an approval of nothing, and
      // "nothing" is exactly what a name-only gate looked like before PHASE 04.
      throw new ApprovalError("new", "an approval must name what it is approving; a task with no objective and no input is nothing to judge");
    }
    this.#counter += 1;
    // PHASE 03: FROZEN on the way in. `get`/`forTask`/`all` hand the stored record
    // out directly, and an unfrozen one meant "only `decide` can move a gate to a
    // decided state" was false: any holder of the registry could write
    // `record.state = "approved"` on the object the release path reads, and
    // `mayRelease` then reported a gate "granted by null" with no decision, no
    // timestamp and no audit trail. The type already declared every field
    // `readonly`; freezing is what makes the compiler's claim true at runtime.
    const gate: ApprovalGate = Object.freeze({
      gateId: `gate-${this.#counter}`,
      jobId: input.jobId,
      taskId: input.taskId,
      state: "waiting",
      question: input.question,
      binding: approvalBindingOf(input.intent),
      requestedAt: this.#clock.nowMs(),
      decidedAt: null,
      decidedBy: null,
      decisionReason: null,
      expiresAt: input.expiresAtMs ?? null,
    });
    this.#store.put(gate);
    return gate;
  }

  public get(gateId: string): ApprovalGate | null {
    return this.#store.get(gateId);
  }

  public forTask(jobId: string, taskId: string): ApprovalGate | null {
    return this.#store.byTask(jobId, taskId);
  }

  /**
   * Whether a given party may decide a gate.
   *
   * Exposed separately from `decide` so the refusal is testable on its own, and
   * so the coordinator can ask before it has already built a decision.
   *
   * PHASE 01 (C-2): the task comparison now uses the GATE'S OWN `taskId`.
   *
   * It used to compare `decidedBy` against an OPTIONAL `taskId` argument, which
   * `ExecutionCoordinator.decideApproval` never supplied - so the rule "the task
   * under approval may not approve itself" was unreachable from the only production
   * call site. A gate already knows which task it is gating; using that recorded
   * fact instead of an argument the caller may omit makes the rule structural.
   *
   * PHASE 03 (B-05): the EXECUTOR is refused as well, and it arrives here as
   * `executedBy`.
   *
   * `decidedBy` is free text supplied by whoever calls `decide`, so against an
   * honest caller the C-2 rule held and against a dishonest one it did not: the
   * executor simply named somebody else. The parties that may not approve are now
   * the job's caller and the runtime's declared principal - identities the
   * COORDINATOR holds in its own records - and they are handed in by that one
   * caller rather than read from the deciding argument.
   *
   * A caller argument still cannot smuggle a party past this: `refusedParties`
   * is computed by the coordinator from `Job.caller` and its own options, and
   * `workerId` remains only an ADDITIONAL party to refuse, never a substitute for
   * these.
   */
  public assertDecidable(input: {
    gateId: string;
    decidedBy: string;
    workerId?: string | null;
    taskId?: string | null;
    /** Identities derived from the coordinator's records that executed this work. */
    executedBy?: readonly (string | null | undefined)[];
  }): void {
    const gate = this.#store.get(input.gateId);
    if (gate === null) {
      throw new ApprovalError(input.gateId, "no such gate");
    }
    if (input.decidedBy.trim() === "") {
      throw new ApprovalError(input.gateId, "a decision must name who made it; an anonymous approval is not auditable");
    }
    if (input.workerId !== undefined && input.workerId !== null && input.decidedBy === input.workerId) {
      throw new ApprovalError(
        input.gateId,
        `the executing worker ("${input.decidedBy}") may not approve its own work. Self-approval is refused, not merely discouraged.`,
      );
    }
    // The gate's own task first, then any task the caller names. Both are checked
    // because either could be the task under approval, and refusing on the
    // recorded one is what makes this unforgeable.
    for (const taskId of [gate.taskId, input.taskId ?? null]) {
      if (taskId !== null && taskId !== undefined && taskId !== "" && input.decidedBy === taskId) {
        throw new ApprovalError(input.gateId, `the task under approval ("${input.decidedBy}") may not approve itself`);
      }
    }
    for (const party of input.executedBy ?? []) {
      if (party !== null && party !== undefined && party !== "" && input.decidedBy === party) {
        throw new ApprovalError(
          input.gateId,
          `the identity this job executes as ("${input.decidedBy}") may not approve its own work. ` +
            `Approval has to come from a party outside the execution, because an executor that accepts its own output has approved nothing.`,
        );
      }
    }
  }

  public decide(input: {
    gateId: string;
    decision: Exclude<ApprovalState, "waiting">;
    decidedBy: string;
    reason?: string | null;
    workerId?: string | null;
    taskId?: string | null;
    executedBy?: readonly (string | null | undefined)[];
  }): ApprovalGate {
    this.assertDecidable(input);
    const gate = this.#store.get(input.gateId);
    if (gate === null) {
      throw new ApprovalError(input.gateId, "no such gate");
    }
    if (!canTransitionApproval(gate.state, input.decision)) {
      throw new ApprovalError(
        input.gateId,
        `cannot move from "${gate.state}" to "${input.decision}". A decided gate is final, so a retry or a later attempt cannot overturn it.`,
      );
    }
    if (input.decision === "approved" && gate.expiresAt !== null && gate.expiresAt <= this.#clock.nowMs()) {
      throw new ApprovalError(
        input.gateId,
        `this gate expired at ${gate.expiresAt} and cannot be approved afterwards. A stale approval is worse than none.`,
      );
    }
    // Rebuilt rather than mutated (so a decided gate is a new record) AND frozen,
    // so the record that leaves this registry cannot be rewritten by whoever
    // receives it - including the caller this method just returned it to. The
    // `binding` is carried by the spread, deliberately: a decision cannot change
    // what was approved, and a rebuild that recomputed it could drift.
    const decided: ApprovalGate = Object.freeze({
      ...gate,
      state: input.decision,
      decidedAt: this.#clock.nowMs(),
      decidedBy: input.decidedBy,
      decisionReason: input.reason ?? null,
    });
    this.#store.put(decided);
    return decided;
  }

  /** Expire a gate whose deadline has passed. Returns the expired gates. */
  public expireDue(): readonly ApprovalGate[] {
    const now = this.#clock.nowMs();
    const expired: ApprovalGate[] = [];
    for (const gate of [...this.#store.all()]) {
      if (gate.state === "waiting" && gate.expiresAt !== null && gate.expiresAt <= now) {
        const next = this.decide({ gateId: gate.gateId, decision: "expired", decidedBy: "system:expiry" });
        expired.push(next);
      }
    }
    return expired;
  }

  /**
   * Whether a task may be released.
   *
   * Consulted on EVERY release, not once per job. That is what makes a retry
   * unable to slip past a gate: the second attempt asks again and gets the same
   * answer, because a decided gate is final.
   *
   * PHASE 01 (C-3): `approvalRequired` is now a REQUIRED argument.
   *
   * It used to take only the job and the task, and returned `allowed: true` for a
   * task with no gate. A task declaring `approvalRequired: true` was therefore
   * released and executed as soon as nothing happened to open its gate - so
   * "no gate" was read as "no approval needed", which is the fail-open the target
   * architecture forbids. The declaration is the authoritative statement of
   * whether approval is needed, and it comes from the workflow, not from the
   * presence or absence of a gate.
   *
   * The parameter has no default ON PURPOSE. A default would let a future call
   * site reintroduce exactly this bug by forgetting the argument, and the
   * compiler would not complain.
   *
   * PHASE 04: `intent` is REQUIRED for the same reason and for a further one. An
   * approval is bound to WHAT was approved, so the release check has to know what
   * it is about to release and compare. The argument is the intent, not a digest:
   * there is no value a caller could pass that would make two different contents
   * agree, because the digest is computed here from what was handed in.
   *
   * The mismatch check runs BEFORE the state is consulted, and it applies to every
   * state rather than only to `approved`. A gate whose content has changed is no
   * longer about this task, so even a `waiting` gate is describing something else,
   * and answering a question about the wrong material is how an approval becomes
   * meaningless.
   */
  public mayRelease(
    jobId: string,
    taskId: string,
    approvalRequired: boolean,
    intent: ApprovalIntent,
  ): { readonly allowed: boolean; readonly detail: string; readonly gate: ApprovalGate | null } {
    const gate = this.forTask(jobId, taskId);
    if (gate === null) {
      return approvalRequired
        ? {
            allowed: false,
            detail:
              `Task "${taskId}" declares that it requires approval, but no approval gate is open for it. ` +
              `It is held rather than run: "no gate" is not "no approval needed".`,
            gate: null,
          }
        : { allowed: true, detail: `Task "${taskId}" has no approval gate.`, gate: null };
    }
    const binding = approvalBindingOf(intent);
    if (gate.binding !== binding) {
      // Fail-closed, and loud. An approval that has drifted away from the work is
      // not a stale approval - it is an answer to a different question - so the
      // detail names both digests rather than merely refusing.
      return {
        allowed: false,
        detail:
          `Approval ${gate.gateId} was granted for content ${gate.binding.slice(0, 12)}, ` +
          `but task "${taskId}" now describes content ${binding.slice(0, 12)}. ` +
          `The work has changed since it was approved, so it is held: an approval answers one question, not any question with the same name.`,
        gate,
      };
    }
    if (gate.state === "approved") {
      return { allowed: true, detail: `Approval ${gate.gateId} was granted by "${gate.decidedBy}".`, gate };
    }
    if (gate.state === "waiting") {
      return { allowed: false, detail: `Task "${taskId}" is waiting on approval ${gate.gateId}: ${gate.question}`, gate };
    }
    return {
      allowed: false,
      detail: `Approval ${gate.gateId} for "${taskId}" is ${gate.state}${gate.decidedBy === null ? "" : ` by "${gate.decidedBy}"`}. The task will not run.`,
      gate,
    };
  }

  public all(): readonly ApprovalGate[] {
    return this.#store.all();
  }

  public clear(): void {
    this.#store.clear();
  }
}

export { isTerminalApprovalState };
