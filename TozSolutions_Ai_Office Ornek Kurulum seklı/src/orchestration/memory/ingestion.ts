/**
 * Knowledge ingestion.
 *
 * The interface by which material from outside a task becomes knowledge the
 * system can retrieve. Deliberately an INTERFACE plus adapters that accept
 * already-extracted text.
 *
 * WHY NO CONNECTORS. A GitHub connector, a filesystem walker and a web scraper
 * all need credentials, a network, and a real source to be meaningful. None is
 * available in this repository, so a connector here would be an untested class
 * asserting an integration that does not exist. What ships instead is the seam
 * they will plug into: a `KnowledgeIngestor` implementation, and adapters that
 * turn a text-plus-metadata payload into knowledge items.
 *
 * The dependency direction is the same as everywhere else: TOZ ingests, nothing
 * ingests into TOZ. An ingestor cannot start a task, select an agent, or write
 * anywhere except through the store it is given.
 */

import { type Clock, systemClock } from "../../core/clock.js";
import { isSensitiveKey } from "../../audit/redaction.js";
import {
  type KnowledgeItem,
  type MemoryConfidence,
  type MemoryMetadata,
  type MemoryProvenance,
  type MemorySource,
} from "./model.js";
import { type MemoryStore } from "./store.js";
import { type MemoryWritePolicy } from "./policy.js";

/** One piece of material offered for ingestion. */
export interface Ingestible {
  /** Stable id within the source. */
  readonly id: string;
  readonly title: string;
  /** Already-extracted text. A connector's job, not the core's. */
  readonly content: string;
  /** Non-secret reference: a URL, a file path, a document id. */
  readonly reference: string | null;
  /** Topic, used to group and filter. */
  readonly topic: string;
  /** Who or what the material came from. */
  readonly sourceRef: string;
  /** Verification state of the material, when the source knows it. */
  readonly verification?: "pass" | "fail" | "needs_review" | null;
  readonly metadata?: Partial<MemoryMetadata>;
  /** Epoch ms the material was observed, when known. */
  readonly observedAt?: number;
}

/** PHASE 05. Named distinctly from the PHASE 04.1 agent-source ingest report, which is a different thing: that one registers agents, this one stores knowledge. */
export interface KnowledgeIngestReport {
  /** Items stored. */
  readonly ingested: readonly KnowledgeItem[];
  /** Items refused, each with a reason. Never silently dropped. */
  readonly refused: readonly { readonly id: string; readonly reason: string }[];
  /** Items already present under the same id. */
  readonly skipped: readonly string[];
  readonly source: MemorySource;
  readonly durationMs: number;
}

/** The port a connector implements. */
export interface KnowledgeIngestor {
  readonly name: string;
  /**
   * Reads material.
   *
   * Returning a Result rather than throwing keeps an unreachable source a
   * reportable outcome rather than a crash in a worker.
   */
  read(options: { limit?: number; signal?: AbortSignal }): Promise<{ readonly ok: true; readonly items: readonly Ingestible[] } | { readonly ok: false; readonly reason: string }>;
}

export interface IngestionOptions {
  readonly store: MemoryStore;
  readonly policy: MemoryWritePolicy;
  readonly clock?: Clock;
  /** Characters above which an item is refused as too large to retrieve usefully. */
  readonly maximumContentLength?: number;
  /** Topic -> scope. A caller decides where knowledge lands. */
  readonly scopeFor?: (topic: string) => "knowledge" | "project" | "organization";
}

/**
 * Turns offered material into stored knowledge.
 *
 * Every refusal is reported. A connector that quietly contributed nothing would
 * look exactly like a connector whose material was all rejected, and those are
 * very different problems.
 */
export class IngestionService {
  readonly #store: MemoryStore;
  readonly #policy: MemoryWritePolicy;
  readonly #clock: Clock;
  readonly #maximumLength: number;
  readonly #scopeFor: (topic: string) => "knowledge" | "project" | "organization";

  public constructor(options: IngestionOptions) {
    this.#store = options.store;
    this.#policy = options.policy;
    this.#clock = options.clock ?? systemClock;
    this.#maximumLength = options.maximumContentLength ?? 200_000;
    this.#scopeFor = options.scopeFor ?? (() => "knowledge");
  }

  public async ingest(
    ingestor: KnowledgeIngestor,
    options: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<KnowledgeIngestReport> {
    const started = this.#clock.nowMs();
    const read = await ingestor.read(options);
    if (!read.ok) {
      return {
        ingested: [],
        refused: [{ id: ingestor.name, reason: read.reason }],
        skipped: [],
        source: "knowledge_provider",
        durationMs: this.#clock.nowMs() - started,
      };
    }
    return this.ingestItems(read.items, ingestor.name, started);
  }

  /** Ingests material a caller already holds, with no connector involved. */
  public ingestItems(
    items: readonly Ingestible[],
    sourceRef: string,
    startedAt: number = this.#clock.nowMs(),
  ): KnowledgeIngestReport {
    const ingested: KnowledgeItem[] = [];
    const refused: Array<{ id: string; reason: string }> = [];
    const skipped: string[] = [];
    const now = this.#clock.nowMs();

    for (const item of items) {
      if (item.content.trim() === "") {
        refused.push({ id: item.id, reason: "Empty content: nothing to retrieve" });
        continue;
      }
      if (item.content.length > this.#maximumLength) {
        refused.push({
          id: item.id,
          reason: `Content is ${item.content.length} characters, above the ${this.#maximumLength} limit for retrievable knowledge`,
        });
        continue;
      }
      if (containsSecretKey(item.metadata?.attributes)) {
        refused.push({ id: item.id, reason: "Metadata contains a credential-shaped key" });
        continue;
      }

      const scope = this.#scopeFor(item.topic);
      const key = `knowledge.${item.topic}.${item.id}`;
      if (this.#store.get(scope, key) !== null) {
        skipped.push(item.id);
        continue;
      }

      const provenance: MemoryProvenance = {
        source: "knowledge_provider",
        sourceRef: item.sourceRef === "" ? sourceRef : item.sourceRef,
        taskId: null,
        traceId: null,
        observedAt: item.observedAt ?? now,
        verification: item.verification ?? null,
        outcome: null,
        errorClass: null,
        sourceReference: item.reference,
      };
      const confidence: MemoryConfidence = {
        level: item.verification === "pass" ? "high" : "medium",
        score: null,
        reasons: [
          item.verification === "pass"
            ? "Material was verified by its source"
            : "Material carries no verification from its source",
        ],
      };

      const evaluation = this.#policy.evaluate(
        {
          scope,
          key,
          type: "knowledge",
          value: { title: item.title, content: item.content, topic: item.topic },
          summary: item.title,
          provenance,
          confidence,
          // Ingested material is `internal` by default: it came from a source the
          // operator connected, which is a reason to trust its origin and not a
          // reason to publish its contents.
          sensitivity: "internal",
          metadata: item.metadata,
        },
        now,
      );
      if (evaluation.draft === null) {
        refused.push({ id: item.id, reason: evaluation.reason });
        continue;
      }
      const stored = this.#store.store(evaluation.draft);
      if (!stored.ok) {
        refused.push({ id: item.id, reason: stored.error.message });
        continue;
      }
      if (stored.value.kind === "unchanged") {
        skipped.push(item.id);
        continue;
      }
      if (stored.value.kind === "conflict") {
        // The store kept BOTH sides. Reporting it as refused would be wrong: the
        // material was taken, and the prior belief is now marked superseded.
        refused.push({
          id: item.id,
          reason: `Superseded a live memory: ${stored.value.conflict.reason}`,
        });
        continue;
      }
      const record = stored.value.item;
      ingested.push({
        id: record.id,
        topic: item.topic,
        content: item.content,
        reference: item.reference,
        provenance: record.provenance,
        confidence: record.confidence,
        observedAt: record.observedAt,
        writtenAt: record.writtenAt,
        metadata: record.metadata,
      });
    }

    return {
      ingested,
      refused,
      skipped,
      source: "knowledge_provider",
      durationMs: this.#clock.nowMs() - startedAt,
    };
  }
}

/** A connector over material a caller already holds. The reference shape. */
export class StaticKnowledgeIngestor implements KnowledgeIngestor {
  public readonly name: string;
  readonly #items: readonly Ingestible[];

  public constructor(options: { name: string; items: readonly Ingestible[] }) {
    this.name = options.name;
    this.#items = options.items;
  }

  public read(
    options: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<{ readonly ok: true; readonly items: readonly Ingestible[] }> {
    if (options.signal?.aborted === true) {
      return Promise.resolve({ ok: true, items: [] });
    }
    return Promise.resolve({ ok: true, items: options.limit === undefined ? this.#items : this.#items.slice(0, options.limit) });
  }
}

/** A connector that cannot be reached. Reports why, rather than throwing. */
export class UnreachableKnowledgeIngestor implements KnowledgeIngestor {
  public readonly name: string;
  readonly #reason: string;

  public constructor(name: string, reason: string) {
    this.name = name;
    this.#reason = reason;
  }

  public read(): Promise<{ readonly ok: false; readonly reason: string }> {
    return Promise.resolve({ ok: false, reason: this.#reason });
  }
}

function containsSecretKey(attributes: Readonly<Record<string, unknown>> | undefined): boolean {
  if (attributes === undefined) {
    return false;
  }
  return Object.keys(attributes).some((key) => isSensitiveKey(key));
}
