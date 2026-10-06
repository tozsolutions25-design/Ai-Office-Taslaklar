/**
 * Learning events.
 *
 * A learning event is a FACT about an outcome: the task failed, the verifier
 * passed, the operator corrected the answer, this tool was slow three times.
 *
 * IT IS NOT AN INSTRUCTION.
 *
 * Nothing in this system reads an event to change behaviour. That is the
 * PHASE 04.1 decision, extended: PHASE 04.1 made learning a tiebreaker that
 * cannot alter eligibility, and this keeps the same line. An event may be read by
 * a ranking component, a dashboard, or a future analysis - and `appliedPolicy` is
 * recorded on every event precisely so that "learning changed production
 * behaviour" can never happen invisibly. In this phase it is always `false`.
 *
 * WHY NOT JUST USE THE FEEDBACK STORE? `FeedbackRecord` (PHASE 04) records what
 * happened to a TASK. An event is a narrower, typed signal that can be about a
 * tool, a model, a memory, or a person, and that carries its own confidence. Both
 * are kept: the feedback store is the execution record, this is the signal layer,
 * and neither replaces the other.
 */

import { type Clock, systemClock } from "../../core/clock.js";
import { type IdGenerator, uuidIdGenerator } from "../../core/ids.js";
import {
  type LearningEvent,
  type LearningEventKind,
  type MemoryConfidence,
} from "./model.js";

/** What a caller observed. Every field is optional except the kind and subject. */
export interface LearningEventInput {
  readonly kind: LearningEventKind;
  /** What it is about: an agent key, a tool id, a model id, a scope. */
  readonly subject: string;
  readonly taskId?: string | null;
  readonly traceId?: string | null;
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly confidence?: MemoryConfidence;
  readonly observedAt?: number;
}

export interface LearningEventStoreOptions {
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  /**
   * How many events to retain.
   *
   * Bounded because an unbounded event log is a memory leak. Truncation is visible
   * through `droppedCount`, so a partial history is never mistaken for a complete
   * one.
   */
  readonly maxEvents?: number;
}

export class LearningEventStore {
  readonly #events: LearningEvent[] = [];
  readonly #counts = new Map<string, number>();
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #maxEvents: number;
  #dropped = 0;

  public constructor(options: LearningEventStoreOptions = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#ids = options.ids ?? uuidIdGenerator;
    this.#maxEvents = options.maxEvents ?? 10_000;
  }

  /**
   * Records an event.
   *
   * `appliedPolicy` is hard-coded to `false` here rather than being a parameter,
   * so there is no call site that could set it to anything else.
   */
  public record(input: LearningEventInput): LearningEvent {
    const observedAt = input.observedAt ?? this.#clock.nowMs();
    const subjectKey = `${input.kind}:${input.subject}`;
    const previous = this.#counts.get(subjectKey) ?? 0;
    const next = previous + 1;
    this.#counts.set(subjectKey, next);

    const event: LearningEvent = {
      eventId: this.#ids.newId("learn"),
      kind: input.kind,
      subject: input.subject,
      taskId: input.taskId ?? null,
      traceId: input.traceId ?? null,
      detail: input.detail ?? {},
      confidence: input.confidence ?? {
        level: next < 3 ? "low" : "medium",
        score: null,
        // Stated plainly: a single observation is weak evidence, and the
        // confidence should say so rather than looking uniform.
        reasons: [`${next} comparable event(s) observed so far`],
      },
      observedAt,
      appliedPolicy: false,
      sampleSize: next,
    };
    this.#events.push(event);
    while (this.#events.length > this.#maxEvents) {
      this.#events.shift();
      this.#dropped += 1;
    }
    return event;
  }

  public list(filter: { kind?: LearningEventKind; subject?: string } = {}): readonly LearningEvent[] {
    return this.#events.filter(
      (event) =>
        (filter.kind === undefined || event.kind === filter.kind) &&
        (filter.subject === undefined || event.subject === filter.subject),
    );
  }

  public forTask(taskId: string): readonly LearningEvent[] {
    return this.#events.filter((event) => event.taskId === taskId);
  }

  public size(): number {
    return this.#events.length;
  }

  public get droppedCount(): number {
    return this.#dropped;
  }

  /**
   * How many comparable events have been seen for a subject and kind.
   *
   * Exposed because a later decision needs it, and because a caller that reads a
   * single event should be able to see how thin the evidence is.
   */
  public sampleSizeFor(kind: LearningEventKind, subject: string): number {
    return this.#counts.get(`${kind}:${subject}`) ?? 0;
  }

  /**
   * A summary for one subject, computed from the records.
   *
   * Aggregated on demand rather than maintained incrementally, so a summary cannot
   * drift from the events it summarises.
   */
  public summarise(subject: string): {
    readonly subject: string;
    readonly total: number;
    readonly succeeded: number;
    readonly failed: number;
    readonly corrected: number;
    readonly verifiedPass: number;
  } {
    const events = this.#events.filter((event) => event.subject === subject);
    return {
      subject,
      total: events.length,
      succeeded: events.filter((event) => event.kind === "task_succeeded").length,
      failed: events.filter((event) => event.kind === "task_failed").length,
      corrected: events.filter(
        (event) => event.kind === "output_corrected" || event.kind === "user_correction",
      ).length,
      verifiedPass: events.filter(
        (event) => event.kind === "verification_result" && event.detail["verdict"] === "pass",
      ).length,
    };
  }

  public clear(): void {
    this.#events.length = 0;
    this.#counts.clear();
    this.#dropped = 0;
  }
}

/**
 * A learning sink that does nothing.
 *
 * For a deployment that wants outcomes but not a learning layer. Recording into
 * it is a no-op rather than an error, so a caller does not need to branch.
 */
export class NullLearningEventSink {
  public record(_input: LearningEventInput): LearningEvent | null {
    return null;
  }
}
