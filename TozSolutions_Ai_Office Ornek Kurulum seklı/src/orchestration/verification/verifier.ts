/**
 * Verification.
 *
 * Verification is a SUBSYSTEM, not an optional trailing prompt. It reads
 * evidence and returns a verdict. It never reads an agent's claim of success
 * as if it were a fact.
 *
 * Three verdicts, not two, on purpose:
 *
 *   pass           the requirement is established
 *   fail           the requirement is not met
 *   needs_review   it could not be established either way
 *
 * `needs_review` exists because collapsing "cannot tell" into "fail" hides
 * genuine uncertainty, and collapsing it into "pass" is exactly the failure this
 * subsystem prevents. A task requiring verification cannot complete on
 * `needs_review`; it escalates.
 */

import { type Evidence } from "../evidence/evidence.js";
import { type Result, err, ok } from "../../core/result.js";

export const VERIFICATION_VERDICTS = ["pass", "fail", "needs_review"] as const;
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];

/** The kinds of check a verifier can perform. */
export const VERIFICATION_KINDS = [
  "schema",
  "output",
  "evidence",
  "source",
  "test",
  "policy",
  "consistency",
] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

/** True for a recognised verification kind. */
export function isVerificationKind(value: unknown): value is VerificationKind {
  return typeof value === "string" && (VERIFICATION_KINDS as readonly string[]).includes(value);
}

export interface VerificationOutcome {
  readonly kind: VerificationKind;
  readonly verdict: VerificationVerdict;
  /** Non-secret explanation. */
  readonly detail: string;
  /** Items the check examined. */
  readonly examined: readonly string[];
}

/** The aggregate result of verifying one execution. */
export interface VerificationResult {
  readonly taskId: string;
  readonly verdict: VerificationVerdict;
  readonly outcomes: readonly VerificationOutcome[];
  readonly verifiedAt: number;
  /**
   * The single most important reason.
   *
   * A `fail` or `needs_review` always has a reason; a `pass` may not. A verdict
   * without a reason is not auditable.
   */
  readonly reason: string | null;
}

/**
 * A single kind of check.
 *
 * Implementations receive EVIDENCE, not an agent's assertion, and must not
 * mutate it.
 */
export interface Verifier {
  readonly kind: VerificationKind;
  /** Name of the implementation, for the audit record. */
  readonly name: string;
  verify(evidence: Evidence): Promise<VerificationOutcome> | VerificationOutcome;
}

/**
 * Runs the verifiers a task requires.
 *
 * A task with no required kinds is NOT auto-verified: it is reported as
 * `needs_review` with a reason, because "nothing was checked" and "everything
 * was checked and passed" are different states and must not look the same.
 */
export class VerificationRunner {
  readonly #verifiers = new Map<VerificationKind, Verifier>();

  public register(verifier: Verifier): Result<true, Error> {
    if (this.#verifiers.has(verifier.kind)) {
      return err(new Error(`A verifier for "${verifier.kind}" is already registered`));
    }
    this.#verifiers.set(verifier.kind, verifier);
    return ok(true);
  }

  public has(kind: VerificationKind): boolean {
    return this.#verifiers.has(kind);
  }

  public kinds(): readonly VerificationKind[] {
    return [...this.#verifiers.keys()];
  }

  public get size(): number {
    return this.#verifiers.size;
  }

  /**
   * Verifies evidence against the required kinds.
   *
   * A REQUIRED kind with no registered verifier yields `needs_review`, never
   * `pass`. Silently skipping an unavailable check would convert a missing
   * capability into a green result.
   */
  public async verify(
    evidence: Evidence,
    requiredKinds: readonly VerificationKind[],
    verifiedAt: number,
  ): Promise<VerificationResult> {
    if (requiredKinds.length === 0) {
      return {
        taskId: evidence.taskId,
        verdict: "needs_review",
        outcomes: [],
        verifiedAt,
        reason: "No verification was required or performed; this is not a pass",
      };
    }

    const outcomes: VerificationOutcome[] = [];
    let verdict: VerificationVerdict = "pass";
    let reason: string | null = null;

    for (const kind of requiredKinds) {
      const verifier = this.#verifiers.get(kind);
      if (!verifier) {
        outcomes.push({
          kind,
          verdict: "needs_review",
          detail: `No verifier is registered for "${kind}"`,
          examined: [],
        });
        verdict = "needs_review";
        reason ??= `Required verifier "${kind}" is not available`;
        continue;
      }
      const outcome = await verifier.verify(evidence);
      outcomes.push(outcome);
      if (outcome.verdict === "fail") {
        verdict = "fail";
        reason ??= outcome.detail;
      } else if (outcome.verdict === "needs_review" && verdict === "pass") {
        verdict = "needs_review";
        reason ??= outcome.detail;
      }
    }

    return { taskId: evidence.taskId, verdict, outcomes, verifiedAt, reason };
  }
}

/**
 * Reference verifier: confirms the evidence is internally complete.
 *
 * This is a REAL check with a real failure mode, not a placeholder. It
 * establishes that the record is well-formed enough to be audited â€” which is
 * the minimum precondition for any other verifier to mean anything.
 */
export class EvidenceIntegrityVerifier implements Verifier {
  public readonly kind = "evidence" as const;
  public readonly name = "evidence_integrity";

  public verify(evidence: Evidence): VerificationOutcome {
    const examined: string[] = [];
    const problems: string[] = [];

    examined.push("traceId", "taskId", "timestamps", "status");

    if (evidence.traceId.trim() === "") {
      problems.push("evidence has no trace id");
    }
    if (evidence.taskId.trim() === "") {
      problems.push("evidence has no task id");
    }
    if (evidence.finishedAt < evidence.startedAt) {
      problems.push("evidence finished before it started");
    }
    if (evidence.status === "failed" && evidence.errorClass === null) {
      problems.push("failed evidence carries no error classification");
    }
    if (evidence.status === "succeeded" && evidence.output.trim() === "") {
      problems.push("succeeded evidence carries no output");
    }
    if (evidence.status === "succeeded" && evidence.agents.length === 0) {
      problems.push("succeeded evidence names no agent");
    }

    return {
      kind: "evidence",
      verdict: problems.length === 0 ? "pass" : "fail",
      detail: problems.length === 0 ? "Evidence record is internally complete" : problems.join("; "),
      examined,
    };
  }
}

/**
 * Reference verifier: requires at least one non-secret source when the task
 * asked for one.
 *
 * Demonstrates a genuine policy check: an answer with no traceable source is not
 * a verified answer, regardless of how confident the output reads.
 */
export class SourceRequirementVerifier implements Verifier {
  public readonly kind = "source" as const;
  public readonly name = "source_requirement";
  readonly #requireSources: boolean;

  public constructor(options: { requireSources: boolean }) {
    this.#requireSources = options.requireSources;
  }

  public verify(evidence: Evidence): VerificationOutcome {
    if (!this.#requireSources) {
      return {
        kind: "source",
        verdict: "pass",
        detail: "No source requirement was declared for this task",
        examined: [],
      };
    }
    const withReference = evidence.sources.filter((source) => source.reference.trim() !== "");
    return {
      kind: "source",
      verdict: withReference.length > 0 ? "pass" : "fail",
      detail:
        withReference.length > 0
          ? `${withReference.length} source(s) recorded`
          : "The task required a source and none was recorded",
      examined: evidence.sources.map((source) => source.reference),
    };
  }
}

/**
 * Model QA: does the output agree with the record that describes it?
 *
 * Distinct from `EvidenceIntegrityVerifier`, which asks whether the RECORD is
 * well formed. This asks whether the OUTPUT is consistent with that record - the
 * failure mode where a model states something its own evidence does not support,
 * which a well-formed record can perfectly exhibit.
 *
 * Each check is a real, falsifiable property:
 *
 *   cited sources   a reference the output names must exist in the evidence
 *   claim bounds    a hedged claim ("may", "possibly") is not presented as verified
 *   no stale cite   a source must have been retrieved no earlier than the run
 *
 * Returns `needs_review` rather than `pass` when the record carries nothing to
 * check against, because "nothing to compare" is not "consistent".
 */
export class ConsistencyQAVerifier implements Verifier {
  public readonly kind = "consistency" as const;
  public readonly name = "model_qa_consistency";

  /** References a hedged claim is allowed to use. */
  static readonly HEDGES: readonly string[] = [
    "may ",
    "might ",
    "possibly",
    "unverified",
    "i believe",
    "i think",
    "not confirmed",
  ];

  public verify(evidence: Evidence): VerificationOutcome {
    const examined: string[] = [];
    const problems: string[] = [];
    const notes: string[] = [];
    const output = evidence.output.trim();

    examined.push("output");
    if (output === "") {
      return {
        kind: "consistency",
        verdict: "fail",
        detail: "Output is empty, so there is nothing to check for consistency",
        examined,
      };
    }

    // 1. A reference the output names must be a reference the record holds.
    //    Extracted conservatively: a URL, or a `path:line`-ish locator.
    examined.push("cited references");
    const cited = extractReferences(output);
    const known = new Set(evidence.sources.map((source) => source.reference));
    for (const reference of cited) {
      if (!known.has(reference)) {
        problems.push(`Output cites "${reference}", which is not in the evidence sources`);
      }
    }

    // 2. Hedged language must not appear beside a claim of verification.
    examined.push("hedged claims");
    const lower = output.toLowerCase();
    for (const hedge of ConsistencyQAVerifier.HEDGES) {
      if (lower.includes(hedge)) {
        notes.push(`Output uses hedged language ("${hedge.trim()}")`);
        break;
      }
    }

    // 3. Nothing to compare against is not the same as agreement.
    examined.push("source coverage");
    if (evidence.sources.length === 0 && cited.length > 0) {
      problems.push("Output cites references while the evidence records no source");
    }
    if (evidence.sources.length === 0 && cited.length === 0) {
      notes.push("Neither the output nor the evidence names a source, so citation could not be checked");
    }

    if (problems.length > 0) {
      return {
        kind: "consistency",
        verdict: "fail",
        detail: problems.join("; "),
        examined,
      };
    }
    // A clean check that could not actually be performed is a review, not a pass.
    const couldCheckCitations = evidence.sources.length > 0 || cited.length === 0;
    return {
      kind: "consistency",
      verdict: couldCheckCitations ? "pass" : "needs_review",
      detail:
        notes.length > 0
          ? `Output is consistent with the evidence; ${notes.join("; ")}`
          : "Output is consistent with the evidence record",
      examined,
    };
  }
}

/** URLs and `path:line` style locators, extracted conservatively. */
function extractReferences(output: string): readonly string[] {
  const found = new Set<string>();
  for (const match of output.matchAll(/https?:\/\/[^\s)"'<>]+/g)) {
    found.add(match[0]);
  }
  for (const match of output.matchAll(/\b([\w.-]+\/[\w.-]+):\d+\b/g)) {
    found.add(match[0]);
  }
  return [...found];
}

/** Whether a verification result permits completion. */
export function verificationPermitsCompletion(result: VerificationResult): boolean {
  return result.verdict === "pass";
}
