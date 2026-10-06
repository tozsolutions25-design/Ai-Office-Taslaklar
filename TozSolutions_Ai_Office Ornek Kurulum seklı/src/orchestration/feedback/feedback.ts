/**
 * Feedback and learning.
 *
 * Learning from outcomes is a PHASE 04 CONTRACT, not a PHASE 04 BEHAVIOUR.
 *
 * What ships: structured records of what was chosen, what happened, and what it
 * cost, written after every execution and readable by anything.
 *
 * What deliberately does not ship: automatically feeding those records back into
 * selection. Routing stays deterministic. A self-modifying selection policy that
 * nobody can explain is the failure this design is built to avoid, and an
 * opaque one is worse than none.
 *
 * A learned ranker would slot in as a `Scorer` implementation behind the
 * existing interface, opt-in, and would still be unable to route an ineligible
 * agent â€” because the hard filter is separate from scoring.
 */

import { type Clock, systemClock } from "../../core/clock.js";
import type { WorkspaceRef } from "../workspace/workspace.js";
import { type ErrorClass } from "../../core/errors.js";
import { type VerificationVerdict } from "../verification/verifier.js";

export const OUTCOMES = ["succeeded", "failed", "cancelled", "escalated"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/**
 * What one execution taught us.
 *
 * Every field is a recorded fact. `humanCorrection` is null unless a person
 * actually corrected the result â€” it is never inferred from a low score.
 */
export interface FeedbackRecord {
  readonly recordId: string;
  /**
   * PHASE 06: the workspace this record belongs to, stamped by the store rather
   * than taken from the caller.
   *
   * `null` means the unattributed partition, which is a real partition and not a
   * wildcard. A record is evidence about one workspace's execution; it is not a
   * cross-workspace signal, and PHASE 07 decides what may aggregate over these -
   * which is not decided here and is not decided by making the field optional at
   * the read site.
   */
  readonly workspace: WorkspaceRef | null;
  readonly traceId: string;
  readonly taskId: string;
  readonly taskType: string;
  readonly agentId: string | null;
  readonly agentVersion: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly topology: string;
  readonly outcome: Outcome;
  /** null when no verification was performed. Never inferred from the outcome. */
  readonly verificationVerdict: VerificationVerdict | null;
  readonly errorClass: ErrorClass | null;
  readonly latencyMs: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly retries: number;
  /** What a reviewer changed, when one did. */
  readonly humanCorrection: string | null;
  readonly recordedAt: number;
}

/**
 * Fields a caller may leave out.
 *
 * All of them are "unknown / nobody touched this" facts, so defaulting them to
 * null is honest: a record that omits `inputTokens` says "not measured", which is
 * not the same as claiming zero.
 */
export type FeedbackRecordInput = Omit<
  FeedbackRecord,
  // `workspace` is omitted deliberately: the STORE stamps it, from the workspace it was
  // constructed with. Accepting it from the caller would let a caller file a record
  // under a workspace the store does not serve, which is precisely the confusion this
  // phase exists to remove - the value would be asserted rather than derived, and the
  // two would disagree whenever either was wrong.
  "recordId" | "workspace" | "inputTokens" | "outputTokens" | "agentVersion" | "humanCorrection" | "recordedAt"
> &
  Partial<Pick<FeedbackRecord, "inputTokens" | "outputTokens" | "agentVersion" | "humanCorrection">> & {
    readonly recordedAt?: number;
  };

export interface FeedbackStore {
  append(record: FeedbackRecordInput): FeedbackRecord;
  list(): readonly FeedbackRecord[];
  forTask(taskId: string): readonly FeedbackRecord[];
  forAgent(agentId: string): readonly FeedbackRecord[];
  size(): number;
}

/**
 * In-memory feedback store.
 *
 * Bounded, because an unbounded record log is a memory leak. Truncation is
 * visible through `droppedCount`, so a truncated history is never mistaken for a
 * complete one.
 *
 * PHASE 06: the bound is PER WORKSPACE, which is why this store is per-instance
 * rather than one instance holding keyed partitions. A single shared ring buffer
 * lets one workspace's volume evict another workspace's records - the evicted
 * workspace sees its history vanish and its own `droppedCount` stays zero, so the
 * loss is both cross-tenant and invisible. Partitioning the KEYS but keeping one
 * shared `#maxRecords` would have left that defect in place.
 */
export class InMemoryFeedbackStore implements FeedbackStore {
  readonly #records: FeedbackRecord[] = [];
  readonly #maxRecords: number;
  /**
   * PHASE 06: the workspace this store's records belong to.
   *
   * Stamped onto every record rather than trusted from the caller, so a record
   * carries its own provenance and a misrouted write is visible in the data instead
   * of only in this file.
   *
   * `null` is the unattributed partition. It is NOT a wildcard: a store composed
   * without a workspace holds unattributed records and will not answer a read for a
   * real one.
   */
  readonly #workspace: WorkspaceRef | null;
  #dropped = 0;
  #counter = 0;

  public constructor(options: { maxRecords?: number; workspace?: WorkspaceRef | null } = {}) {
    this.#maxRecords = options.maxRecords ?? 1_000;
    this.#workspace = options.workspace ?? null;
  }

  /**
   * The workspace whose records this store holds.
   *
   * Frozen by `workspaceRef`, so a caller cannot widen the store's scope by
   * mutating the object it passed in.
   */
  public get workspace(): WorkspaceRef | null {
    return this.#workspace;
  }

  public append(input: FeedbackRecordInput): FeedbackRecord {
    this.#counter += 1;
    const record: FeedbackRecord = {
      inputTokens: null,
      outputTokens: null,
      agentVersion: null,
      humanCorrection: null,
      ...input,
      recordId: `fb-${this.#counter}`,
      workspace: this.#workspace,
      recordedAt: input.recordedAt ?? Date.now(),
    };
    this.#records.push(record);
    while (this.#records.length > this.#maxRecords) {
      this.#records.shift();
      this.#dropped += 1;
    }
    return record;
  }

  public list(): readonly FeedbackRecord[] {
    return [...this.#records];
  }

  public forTask(taskId: string): readonly FeedbackRecord[] {
    return this.#records.filter((record) => record.taskId === taskId);
  }

  public forAgent(agentId: string): readonly FeedbackRecord[] {
    return this.#records.filter((record) => record.agentId === agentId);
  }

  /** Success rate for an agent, or null when nothing has been measured. */
  public successRateFor(agentId: string): number | null {
    const records = this.forAgent(agentId);
    if (records.length === 0) {
      return null;
    }
    const succeeded = records.filter((record) => record.outcome === "succeeded").length;
    return succeeded / records.length;
  }

  public size(): number {
    return this.#records.length;
  }

  public get droppedCount(): number {
    return this.#dropped;
  }

  public clear(): void {
    this.#records.length = 0;
    this.#dropped = 0;
  }
}

/**
 * A summary an operator can read.
 *
 * Aggregates are computed from records on demand rather than maintained
 * incrementally, so a summary cannot drift from the records it summarises.
 */
export interface AgentPerformanceSummary {
  readonly agentId: string;
  readonly executions: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly escalated: number;
  /** null when no execution measured latency. */
  readonly averageLatencyMs: number | null;
  /** null when no execution was verified. */
  readonly verifiedPassRate: number | null;
}

export function summariseAgent(store: FeedbackStore, agentId: string): AgentPerformanceSummary {
  const records = store.forAgent(agentId);
  const latencies = records
    .map((record) => record.latencyMs)
    .filter((value): value is number => value !== null);
  const verified = records.filter(
    (record): record is FeedbackRecord & { verificationVerdict: VerificationVerdict } =>
      record.verificationVerdict !== null,
  );

  return {
    agentId,
    executions: records.length,
    succeeded: records.filter((record) => record.outcome === "succeeded").length,
    failed: records.filter((record) => record.outcome === "failed").length,
    escalated: records.filter((record) => record.outcome === "escalated").length,
    averageLatencyMs: latencies.length === 0 ? null : latencies.reduce((a, b) => a + b, 0) / latencies.length,
    verifiedPassRate:
      verified.length === 0 ? null : verified.filter((record) => record.verificationVerdict === "pass").length / verified.length,
  };
}

/** Builds a feedback record from an execution outcome. */
export function feedbackFromExecution(input: {
  /** PHASE 06. Defaults to the unattributed partition; never a wildcard. */
  readonly workspace?: WorkspaceRef | null;
  readonly traceId: string;
  readonly taskId: string;
  readonly taskType: string;
  readonly agentId: string | null;
  readonly agentVersion?: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly topology: string;
  readonly outcome: Outcome;
  readonly verificationVerdict: VerificationVerdict | null;
  readonly errorClass: ErrorClass | null;
  readonly latencyMs: number | null;
  readonly inputTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly retries: number;
  readonly humanCorrection?: string | null;
  readonly clock?: Clock;
}): Omit<FeedbackRecord, "recordId"> {
  return {
    // PHASE 06: the store stamps the authoritative value on write; carrying it here
    // too means a record built and inspected before storing still says whose it is.
    workspace: input.workspace ?? null,
    traceId: input.traceId,
    taskId: input.taskId,
    taskType: input.taskType,
    agentId: input.agentId,
    agentVersion: input.agentVersion ?? null,
    provider: input.provider,
    model: input.model,
    topology: input.topology,
    outcome: input.outcome,
    verificationVerdict: input.verificationVerdict,
    errorClass: input.errorClass,
    latencyMs: input.latencyMs,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    retries: input.retries,
    humanCorrection: input.humanCorrection ?? null,
    recordedAt: (input.clock ?? systemClock).nowMs(),
  };
}
