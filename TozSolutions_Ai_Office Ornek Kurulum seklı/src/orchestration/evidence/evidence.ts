/**
 * Evidence.
 *
 * What an execution actually did, as a structured record.
 *
 * Evidence is NOT output. An output is what an agent claims; evidence is the
 * record of how it was produced and what supports it. Verification reads
 * evidence, not the claim, which is what keeps "the agent said it is done" from
 * being indistinguishable from "the system confirmed it".
 *
 * Every field is either a recorded fact or an explicit `null`. Nothing is
 * inferred, and a missing measurement stays null rather than becoming zero.
 */

import { type ErrorClass } from "../../core/errors.js";

/** A source an output rests on. Non-secret: a locator, not a credential. */
export interface EvidenceSource {
  /** A stable reference: a URL, a file path, a document id. */
  readonly reference: string;
  /** What was taken from it. */
  readonly excerpt: string;
  /** When it was consulted. Epoch ms. */
  readonly retrievedAt: number;
}

export interface EvidenceToolCall {
  readonly toolId: string;
  readonly durationMs: number | null;
  /** True when the call changed state the system cannot undo. */
  readonly sideEffecting: boolean;
}

export interface EvidenceArtifact {
  readonly name: string;
  /** Size in bytes, when known. */
  readonly bytes: number | null;
  /** Content digest, when the producing tool computed one. */
  readonly digest: string | null;
}

/** Resource use attributable to this execution. */
export interface EvidenceCost {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly durationMs: number | null;
  /** Tool invocations attributable to this execution. */
  readonly toolCallCount: number;
  /**
   * Monetary amount.
   *
   * Null unless a provider actually reported one. No price table is embedded in
   * the core, because a fabricated price is a fabricated financial claim.
   */
  readonly amount: number | null;
  readonly currency: string | null;
}

export const UNKNOWN_EVIDENCE_COST: EvidenceCost = {
  inputTokens: null,
  outputTokens: null,
  durationMs: null,
  toolCallCount: 0,
  amount: null,
  currency: null,
};

export const EVIDENCE_STATUSES = ["succeeded", "failed", "partial", "cancelled"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/**
 * Provenance: enough to say where a piece of evidence came from, without a second
 * lookup.
 *
 * PHASE 04.1. An evidence record previously carried the task, the agent and the
 * timestamps, which answers "who did this" but not "which execution of which
 * attempt". A retried subtask produces several records under one task, and they
 * were indistinguishable.
 */
export interface EvidenceProvenance {
  /** The run this belongs to. Stable across every record in a run. */
  readonly traceId: string;
  /** The task, and the subtask within it. */
  readonly taskId: string;
  readonly subtaskId: string | null;
  /** The agent key, `agentId@version`. */
  readonly agentKey: string | null;
  /** Which attempt produced this record. 1 = first try. */
  readonly attempt: number;
  /** Monotonic within the trace, so two records can be ordered. */
  readonly sequence: number;
  readonly startedAt: number;
  readonly finishedAt: number;
}

/** The structured record an execution produces. */
export interface Evidence {
  readonly taskId: string;
  readonly parentTaskId: string | null;
  readonly traceId: string;
  /** The primary agent: the one that produced the output. Null when none. */
  readonly agentId: string | null;
  readonly agentVersion: string | null;
  /**
   * Every agent key that took part, as `agentId@version`.
   *
   * Distinct from `agentId` because a multi-agent task has no single producing
   * agent. Without this, a merged record could only either name one agent and
   * hide the rest, or name none and fail the integrity check that a successful
   * execution must attribute its output to somebody.
   */
  readonly agents: readonly string[];
  readonly provider: string | null;
  readonly model: string | null;
  /** Digest of the input, not the input itself: inputs may be sensitive. */
  readonly inputDigest: string | null;
  readonly output: string;
  readonly toolCalls: readonly EvidenceToolCall[];
  readonly sources: readonly EvidenceSource[];
  readonly artifacts: readonly EvidenceArtifact[];
  /** Test identifiers that were run, when execution included tests. */
  readonly tests: readonly string[];
  readonly cost: EvidenceCost;
  readonly status: EvidenceStatus;
  readonly errorClass: ErrorClass | null;
  readonly startedAt: number;
  readonly finishedAt: number;
  /** Where this record came from. See `EvidenceProvenance`. */
  readonly provenance: EvidenceProvenance;
}

/** Extracts the provenance of a record. Exists so callers need not know the shape. */
export function provenanceOf(evidence: Evidence): EvidenceProvenance {
  return evidence.provenance;
}

export interface EvidenceInput {
  readonly taskId: string;
  readonly traceId: string;
  readonly parentTaskId?: string | null;
  readonly agentId?: string | null;
  readonly agentVersion?: string | null;
  readonly agents?: readonly string[];
  readonly attempt?: number;
  readonly sequence?: number;
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly inputDigest?: string | null;
  readonly output?: string;
  readonly toolCalls?: readonly EvidenceToolCall[];
  readonly sources?: readonly EvidenceSource[];
  readonly artifacts?: readonly EvidenceArtifact[];
  readonly tests?: readonly string[];
  readonly cost?: Partial<EvidenceCost>;
  readonly status: EvidenceStatus;
  readonly errorClass?: ErrorClass | null;
  readonly startedAt: number;
  readonly finishedAt: number;
}

export function buildEvidence(input: EvidenceInput): Evidence {
  return {
    taskId: input.taskId,
    parentTaskId: input.parentTaskId ?? null,
    traceId: input.traceId,
    agentId: input.agentId ?? null,
    agentVersion: input.agentVersion ?? null,
    // A single-agent record derives its participant list from itself, so a
    // caller does not have to state it twice and cannot state it inconsistently.
    agents:
      input.agents ??
      (input.agentId ? [`${input.agentId}${input.agentVersion ? `@${input.agentVersion}` : ""}`] : []),
    provider: input.provider ?? null,
    model: input.model ?? null,
    inputDigest: input.inputDigest ?? null,
    output: input.output ?? "",
    toolCalls: input.toolCalls ?? [],
    sources: input.sources ?? [],
    artifacts: input.artifacts ?? [],
    tests: input.tests ?? [],
    cost: { ...UNKNOWN_EVIDENCE_COST, ...input.cost },
    status: input.status,
    errorClass: input.errorClass ?? null,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    // Derived rather than passed separately, so provenance cannot disagree with
    // the fields it describes. `subtaskId` is the task id when the record IS the
    // task, which is the single-subtask case.
    provenance: {
      traceId: input.traceId,
      taskId: input.taskId,
      subtaskId: input.taskId,
      agentKey:
        input.agents?.[0] ??
        (input.agentId ? `${input.agentId}${input.agentVersion ? `@${input.agentVersion}` : ""}` : null),
      attempt: input.attempt ?? 1,
      sequence: input.sequence ?? 0,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
    },
  };
}

/**
 * Whether the evidence is complete enough to verify.
 *
 * A failure with no output and no error classification cannot be verified, and
 * saying so is more useful than presenting it as a verification candidate.
 */
export function isVerifiable(evidence: Evidence): boolean {
  if (evidence.status === "cancelled") {
    return false;
  }
  if (evidence.status === "failed") {
    return evidence.errorClass !== null;
  }
  return evidence.output.trim().length > 0;
}

/**
 * Merges the evidence of several subtasks into one task-level record.
 *
 * Verification reads a single record, so a multi-agent task has to be reduced to
 * one. The reduction is a UNION, not an overwrite: every tool call, source,
 * artifact and test survives, cost figures are summed where measured and stay
 * null where no subtask measured them, and the participant list records every
 * agent that took part.
 *
 * `output` is passed in rather than derived, because the aggregate output of a
 * plan is the terminal subtask's output by definition, not a concatenation that
 * would read as one agent's answer.
 */
export function mergeEvidence(
  records: readonly Evidence[],
  options: {
    readonly taskId: string;
    readonly traceId: string;
    readonly parentTaskId?: string | null;
    readonly output: string;
    readonly finishedAt: number;
  },
): Evidence {
  if (records.length === 0) {
    throw new Error("mergeEvidence requires at least one evidence record; an empty merge would fabricate one");
  }
  const first = records[0];
  if (records.length === 1 && first !== undefined) {
    // A single record already describes the whole task; no union is invented.
    return { ...first, parentTaskId: options.parentTaskId ?? first.parentTaskId, output: options.output };
  }
  const agents = [...new Set(records.flatMap((record) => record.agents))];
  const summed = (pick: (record: Evidence) => number | null): number | null => {
    const values = records.map(pick).filter((value): value is number => value !== null);
    return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
  };
  const failed = records.find((record) => record.status === "failed");
  const status: EvidenceStatus = records.some((record) => record.status === "cancelled")
    ? "cancelled"
    : failed
      ? records.every((record) => record.status === "failed")
        ? "failed"
        : "partial"
      : records.every((record) => record.status === "succeeded")
        ? "succeeded"
        : "partial";

  return buildEvidence({
    taskId: options.taskId,
    traceId: options.traceId,
    parentTaskId: options.parentTaskId ?? first?.parentTaskId ?? null,
    // The producing agent is only meaningful when one agent produced it.
    agentId: agents.length === 1 ? (agents[0]?.split("@")[0] ?? null) : null,
    agentVersion: agents.length === 1 ? (agents[0]?.split("@")[1] ?? null) : null,
    agents,
    provider: first?.provider ?? null,
    model: first?.model ?? null,
    inputDigest: first?.inputDigest ?? null,
    output: options.output,
    toolCalls: records.flatMap((record) => record.toolCalls),
    sources: records.flatMap((record) => record.sources),
    artifacts: records.flatMap((record) => record.artifacts),
    tests: records.flatMap((record) => record.tests),
    cost: {
      inputTokens: summed((record) => record.cost.inputTokens),
      outputTokens: summed((record) => record.cost.outputTokens),
      durationMs: summed((record) => record.cost.durationMs),
      toolCallCount: records.reduce((total, record) => total + record.cost.toolCallCount, 0),
      amount: summed((record) => record.cost.amount),
      currency: first?.cost.currency ?? null,
    },
    status,
    errorClass: failed?.errorClass ?? null,
    startedAt: records.reduce((earliest, record) => Math.min(earliest, record.startedAt), Number.POSITIVE_INFINITY),
    finishedAt: options.finishedAt,
    // A merged record is the task's record, not one attempt of one subtask. The
    // provenance of each part survives in the records that were merged, and the
    // merged sequence is the highest one seen, so ordering still holds.
    attempt: 1,
    sequence: records.reduce((highest, record) => Math.max(highest, record.provenance.sequence), 0),
  });
}

export function evidenceDurationMs(evidence: Evidence): number | null {
  if (evidence.cost.durationMs !== null) {
    return evidence.cost.durationMs;
  }
  return evidence.finishedAt - evidence.startedAt;
}

/**
 * Collects evidence during an execution.
 *
 * Mutable during a run, frozen on completion. A collector that could still be
 * written after a task finished would make the audit trail unreliable.
 */
export class EvidenceCollector {
  readonly #fields: {
    traceId: string;
    taskId: string;
    parentTaskId: string | null;
    agentId: string | null;
    agentVersion: string | null;
    agents: string[];
    attempt: number;
    sequence: number;
    provider: string | null;
    model: string | null;
    inputDigest: string | null;
    output: string;
    toolCalls: EvidenceToolCall[];
    sources: EvidenceSource[];
    artifacts: EvidenceArtifact[];
    tests: string[];
    cost: Partial<EvidenceCost>;
    startedAt: number;
  };
  #finishedAt: number | null = null;
  #status: EvidenceStatus | null = null;
  #errorClass: ErrorClass | null = null;

  public constructor(options: {
    taskId: string;
    traceId: string;
    parentTaskId?: string | null;
    startedAt: number;
    /** Which attempt this execution represents. 1 = first try. */
    attempt?: number;
    /** Monotonic within the trace. Required for order to be meaningful. */
    sequence?: number;
  }) {
    this.#fields = {
      traceId: options.traceId,
      taskId: options.taskId,
      parentTaskId: options.parentTaskId ?? null,
      agentId: null,
      agentVersion: null,
      agents: [],
      attempt: options.attempt ?? 1,
      sequence: options.sequence ?? 0,
      provider: null,
      model: null,
      inputDigest: null,
      output: "",
      toolCalls: [],
      sources: [],
      artifacts: [],
      tests: [],
      cost: {},
      startedAt: options.startedAt,
    };
  }

  public agent(agentId: string, version: string | null = null): void {
    this.#fields.agentId = agentId;
    this.#fields.agentVersion = version;
    // Recorded as a participant too, so a single-agent record and a merged
    // multi-agent record carry the same field and need no special casing.
    const key = `${agentId}${version ? `@${version}` : ""}`;
    if (!this.#fields.agents.includes(key)) {
      this.#fields.agents.push(key);
    }
  }

  public route(provider: string | null, model: string | null): void {
    this.#fields.provider = provider;
    this.#fields.model = model;
  }

  public inputDigest(digest: string | null): void {
    this.#fields.inputDigest = digest;
  }

  public output(output: string): void {
    this.#fields.output = output;
  }

  public toolCall(call: EvidenceToolCall): void {
    this.#fields.toolCalls.push(call);
  }

  public source(source: EvidenceSource): void {
    this.#fields.sources.push(source);
  }

  public artifact(artifact: EvidenceArtifact): void {
    this.#fields.artifacts.push(artifact);
  }

  public test(testId: string): void {
    this.#fields.tests.push(testId);
  }

  public cost(cost: Partial<EvidenceCost>): void {
    this.#fields.cost = { ...this.#fields.cost, ...cost };
  }

  public fail(errorClass: ErrorClass): void {
    this.#status = "failed";
    this.#errorClass = errorClass;
  }

  public cancel(): void {
    this.#status = "cancelled";
  }

  /** Freezes the collector and returns the evidence. */
  public complete(finishedAt: number): Evidence {
    this.#finishedAt = finishedAt;
    return buildEvidence({
      ...this.#fields,
      status: this.#status ?? "succeeded",
      errorClass: this.#errorClass,
      startedAt: this.#fields.startedAt,
      finishedAt,
    });
  }

  public get isComplete(): boolean {
    return this.#finishedAt !== null;
  }
}
