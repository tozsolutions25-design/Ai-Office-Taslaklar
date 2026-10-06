/**
 * Retrieval.
 *
 * "Which of the things we know should I bring into this task?" is the only
 * question that matters about memory at execution time, and the only acceptable
 * answer to it is one the system can justify.
 *
 * FOUR PROPERTIES THIS ENGINE GUARANTEES
 *
 *  1. NO VENDOR. Retrieval strategies are a port. Semantic search needs an
 *     `EmbeddingProvider`; none ships, because none is integrated, and an engine
 *     that hard-codes one would couple memory to a model provider. Without a
 *     provider the semantic strategy reports itself unavailable and the others
 *     still work.
 *
 *  2. EXPLICIT SCOPES. A query names the scopes it may search. A retrieval that
 *     defaulted to "everything readable" would be a way to leak global memory
 *     into a narrow task.
 *
 *  3. EVERY RESULT EXPLAINS ITSELF. Each returned item carries the strategies
 *     that found it and the score contributions that ranked it. A memory chosen
 *     without a stated reason is indistinguishable from one chosen arbitrarily.
 *
 *  4. UNMEASURED IS NOT ZERO. Latency is measured. A signal the system does not
 *     have contributes nothing rather than a favourable default, so an unmeasured
 *     item never wins a comparison it has not earned.
 *
 * The engine holds no reference to the orchestrator, the pool, or any provider
 * beyond the embedding port it was given. It cannot start work.
 */

import { type Clock, systemClock } from "../../core/clock.js";
import { type MemoryScope } from "./memory.js";
import { type MemoryStore } from "./store.js";
import {
  CONFIDENCE_RANK,
  type MemoryConfidenceLevel,
  type MemoryItem,
  type MemoryQuery,
  type MemoryRetrievalResult,
  type RetrievalExplanation,
  type RetrievalStrategy,
  type ScoredMemory,
  emptyRetrieval,
} from "./model.js";

/**
 * Turns text into a vector.
 *
 * A port with NO implementation shipped. Whoever integrates an embedding model
 * implements this; the engine then gains semantic retrieval without changing.
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  isAvailable(): Promise<boolean>;
  embed(texts: readonly string[]): Promise<readonly number[][]>;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

/**
 * How much each signal contributes to a final score.
 *
 * Exposed and named because these are decisions a deployment may legitimately
 * disagree with. What is NOT exposed is a way to add a term that outweighs
 * relevance: `relevance` dominates by construction, so a term added to the tail
 * cannot promote an irrelevant memory into a relevant one.
 */
export interface RetrievalWeights {
  /** Text overlap. Dominant, and multiplied well above the others. */
  readonly relevance: number;
  /** How recently the underlying fact was observed. */
  readonly recency: number;
  /** How much the item is believed. */
  readonly confidence: number;
  /** How much the item matters. */
  readonly importance: number;
  /** Exact key or id hit. A strong signal, not a guarantee. */
  readonly exactMatch: number;
}

export const DEFAULT_RETRIEVAL_WEIGHTS: RetrievalWeights = {
  relevance: 1_000,
  recency: 30,
  confidence: 20,
  importance: 10,
  exactMatch: 500,
};

/** Half-life for recency, in ms. After this, recency contributes half as much. */
export const DEFAULT_RECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1_000;

export interface RetrievalOptions {
  readonly weights?: Partial<RetrievalWeights>;
  readonly recencyHalfLifeMs?: number;
  /** A clock, so recency is testable rather than dependent on wall time. */
  readonly clock?: Clock;
  /**
   * Semantic search, when an embedding provider is available.
   *
   * Optional and absent by default. Its absence degrades retrieval quality and
   * nothing else: the exact, metadata and recency strategies still run.
   */
  readonly embeddings?: EmbeddingProvider;
}

interface ScoredCandidate {
  readonly item: MemoryItem;
  readonly score: number;
  readonly strategies: Set<RetrievalStrategy>;
  readonly contributions: Array<{ term: string; weight: number }>;
  readonly matchedTerms: readonly string[];
}

/**
 * Ranks and explains.
 *
 * Pure and total, so a ranking can be tested without a store, a clock, or a
 * network. The engine supplies the candidates; this decides.
 */
export class RetrievalScorer {
  readonly #weights: RetrievalWeights;
  readonly #halfLife: number;

  public constructor(options: { weights?: Partial<RetrievalWeights>; recencyHalfLifeMs?: number } = {}) {
    this.#weights = { ...DEFAULT_RETRIEVAL_WEIGHTS, ...options.weights };
    this.#halfLife = options.recencyHalfLifeMs ?? DEFAULT_RECENCY_HALF_LIFE_MS;
  }

  public get weights(): RetrievalWeights {
    return this.#weights;
  }

  /**
   * Scores one candidate.
   *
   * Returns null when the item is not relevant at all - a zero score is a
   * different statement from "not a candidate", and a result list that includes
   * zeros would look like a ranked answer rather than an empty one.
   */
  public score(
    item: MemoryItem,
    query: MemoryQuery,
    now: number,
    matchedTerms: readonly string[] = [],
  ): ScoredCandidate | null {
    const contributions: Array<{ term: string; weight: number }> = [];
    const strategies = new Set<RetrievalStrategy>();

    const exact = this.#exactMatch(item, query);
    if (exact > 0) {
      strategies.add("exact");
      contributions.push({ term: "exact", weight: exact });
    }

    const relevance = this.#relevance(item, query, matchedTerms);
    if (relevance > 0) {
      strategies.add("metadata");
      contributions.push({ term: "relevance", weight: relevance });
    }

    // RELEVANCE IS A GATE, NOT A WEIGHT.
    //
    // If the query names terms and this item matches none of them, it is not a
    // candidate - however recent, confident or important it happens to be.
    // Without this gate, every memory in the store was returned by every query,
    // because recency alone is always a positive score, and the store would
    // retrieve noise while appearing to rank it. That is the failure this whole
    // subsystem exists to prevent, and it is why an empty query is the only case
    // where "recent and important" is enough on its own.
    const queryTerms = tokenise(query.text);
    if (queryTerms.length > 0 && relevance === 0 && exact === 0 && matchedTerms.length === 0) {
      return null;
    }

    const recency = this.#recency(item, now);
    if (recency > 0) {
      strategies.add("recency");
      contributions.push({ term: "recency", weight: recency });
    }

    const confidence = this.#confidence(item);
    if (confidence > 0) {
      contributions.push({ term: "confidence", weight: confidence });
    }

    const importance = this.#importance(item);
    if (importance > 0) {
      contributions.push({ term: "importance", weight: importance });
    }

    if (strategies.size === 0) {
      return null;
    }
    const score = contributions.reduce((total, entry) => total + entry.weight, 0);
    if (score <= 0) {
      return null;
    }
    return {
      item,
      score,
      strategies,
      contributions: contributions.sort((a, b) => b.weight - a.weight),
      matchedTerms,
    };
  }

  /**
   * Term overlap, weighted by coverage.
   *
   * Coverage of the QUERY, not a raw count: an item matching every term of a
   * three-term query must outrank one matching the same three of a nine-term
   * query. A raw frequency count would do the opposite, which is the difference
   * between relevance and verbosity.
   */
  #relevance(item: MemoryItem, query: MemoryQuery, matchedTerms: readonly string[]): number {
    const terms = tokenise(query.text);
    if (terms.length === 0) {
      return 0;
    }
    const haystack = tokenise(`${item.summary} ${item.key} ${stringifyValue(item.value)}`);
    if (haystack.length === 0) {
      return 0;
    }
    const haystackSet = new Set(haystack);
    let hits = 0;
    for (const term of terms) {
      if (haystackSet.has(term)) {
        hits += 1;
      }
    }
    if (hits === 0) {
      // A caller may supply its own matched terms, e.g. from a semantic strategy.
      return matchedTerms.length > 0 ? this.#weights.relevance * 0.5 : 0;
    }
    const coverage = hits / terms.length;
    return this.#weights.relevance * coverage;
  }

  #exactMatch(item: MemoryItem, query: MemoryQuery): number {
    const needle = query.text.trim();
    if (needle === "") {
      return 0;
    }
    if (item.key === needle || item.id === needle) {
      return this.#weights.exactMatch;
    }
    return 0;
  }

  /**
   * Recency as a decaying weight.
   *
   * Exponential decay rather than a bucket, so there is no cliff at a boundary. An
   * item that never expires is treated as not decaying: an eternal fact should
   * not be penalised for being eternal.
   */
  #recency(item: MemoryItem, now: number): number {
    if (this.#halfLife <= 0) {
      return 0;
    }
    if (item.expiresAt === null) {
      return this.#weights.recency;
    }
    const age = Math.max(0, now - item.observedAt);
    const factor = Math.pow(0.5, age / this.#halfLife);
    return this.#weights.recency * factor;
  }

  #confidence(item: MemoryItem): number {
    return this.#weights.confidence * (CONFIDENCE_RANK[item.confidence.level] / CONFIDENCE_RANK.certain);
  }

  #importance(item: MemoryItem): number {
    return this.#weights.importance * item.importance;
  }
}

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */

/**
 * Retrieves memories for a task.
 *
 * A service, not an authority: it holds a store and a scorer and answers
 * questions. It cannot write a memory, decide a policy, or start an execution.
 */
export class RetrievalEngine {
  readonly #store: MemoryStore;
  readonly #scorer: RetrievalScorer;
  readonly #clock: Clock;
  readonly #embeddings: EmbeddingProvider | undefined;

  public constructor(store: MemoryStore, options: RetrievalOptions = {}) {
    this.#store = store;
    this.#scorer = new RetrievalScorer(options);
    this.#clock = options.clock ?? systemClock;
    this.#embeddings = options.embeddings;
  }

  public get scorer(): RetrievalScorer {
    return this.#scorer;
  }

  /**
   * Retrieves, always explaining.
   *
   * Never throws for an expected problem: an empty scope list, an over-large
   * limit, and an unavailable semantic backend are all outcomes the caller needs
   * to see rather than exceptions.
   */
  public async retrieve(query: MemoryQuery): Promise<MemoryRetrievalResult> {
    const started = this.#clock.nowMs();

    if (query.scopes.length === 0) {
      return emptyRetrieval(
        "The query named no scopes. A retrieval is a scope decision, so an unqualified query is refused rather than widened.",
        this.#clock.nowMs() - started,
      );
    }
    if (!Number.isInteger(query.limit) || query.limit < 1) {
      return emptyRetrieval(
        "Retrieval limit must be a positive integer",
        this.#clock.nowMs() - started,
      );
    }

    const now = this.#clock.nowMs();
    const semantic = await this.#semanticStrategies(query);
    const strategies = new Set<RetrievalStrategy>(["exact", "metadata", "recency", ...semantic.strategies]);

    const candidates: ScoredCandidate[] = [];
    let examined = 0;
    for (const scope of query.scopes) {
      // PHASE 07: `includeExpired: true` HERE, deliberately.
      //
      // `MemoryStore.listScope` now drops expired items by default, which is right for
      // its own callers and wrong for this one: a caller who asked for expired memories
      // (`query.includeExpired`) would never see any, because the store had already
      // removed them before `#passesFilters` could apply the QUERY's preference.
      //
      // So the store hands over everything active, and the QUERY decides - which is what
      // `#passesFilters` already did correctly. The alternative, teaching the store about
      // the query, would give the expiry decision a second home and let the two disagree.
      for (const item of this.#store.listScope(scope, { includeInactive: false, includeExpired: true })) {
        examined += 1;
        if (!this.#passesFilters(item, query, now)) {
          continue;
        }
        const matched = semantic.matchedByKey.get(item.id) ?? [];
        const scored = this.#scorer.score(item, query, now, matched);
        if (scored !== null) {
          candidates.push(scored);
        }
      }
    }

    candidates.sort((a, b) => (b.score !== a.score ? b.score - a.score : tieBreak(a.item, b.item)));
    const chosen = candidates.slice(0, query.limit);
    const ranked: ScoredMemory[] = chosen.map((candidate) => ({
      item: candidate.item,
      score: candidate.score,
      explanation: explain(candidate, query),
    }));

    return {
      items: ranked.map((entry) => entry.item),
      ranked,
      examinedCount: examined,
      hitCount: ranked.length,
      explanation: {
        strategies: [...strategies],
        contributions: [],
        reason:
          ranked.length === 0
            ? `No memory in ${query.scopes.length} scope(s) matched the query; ${examined} item(s) examined`
            : `Returned ${ranked.length} of ${examined} examined item(s) from ${query.scopes.join(", ")}`,
      },
      durationMs: this.#clock.nowMs() - started,
      strategies: [...strategies],
      unavailableReason: semantic.unavailableReason,
    };
  }

  /**
   * Hard filters, applied before scoring.
   *
   * These are gates rather than weights: an item that fails one is not ranked at
   * all. A filter implemented as a small negative weight would let a strong
   * relevance score outvote it, which is how an expired memory comes back.
   */
  #passesFilters(item: MemoryItem, query: MemoryQuery, now: number): boolean {
    if (query.includeExpired !== true && item.expiresAt !== null && item.expiresAt <= now) {
      return false;
    }
    if (query.minimumConfidence !== undefined) {
      if (CONFIDENCE_RANK[item.confidence.level] < CONFIDENCE_RANK[query.minimumConfidence]) {
        return false;
      }
    }
    if (query.minimumImportance !== undefined && item.importance < query.minimumImportance) {
      return false;
    }
    if (query.types !== undefined && !query.types.includes(item.type)) {
      return false;
    }
    if (query.tags !== undefined && query.tags.length > 0) {
      const has = query.tags.some((tag) => item.metadata.tags.includes(tag));
      if (!has) {
        return false;
      }
    }
    if (query.capabilities !== undefined && query.capabilities.length > 0) {
      const has = query.capabilities.some((capability) => item.metadata.capabilities.includes(capability));
      if (!has) {
        return false;
      }
    }
    return true;
  }

  /**
   * The semantic strategy, when an embedding provider exists.
   *
   * Degrades honestly: with no provider the strategy is absent, the reason is
   * reported, and retrieval continues with the strategies that need no model.
   * The alternative - silently ranking as though semantic search had run - would
   * make retrieval quality unmeasurable.
  /**
   * PHASE 07 (D2): reports whether semantic retrieval can actually RUN, and does not
   * claim it otherwise.
   *
   * This used to compute a `queryVector`, discard it, and return
   * `strategies: ["semantic"]` whenever a provider was configured and available. So
   * the engine told every reader that a semantic search had happened when no match had
   * been produced - which is the shape `DECISIONS.md` D-46 rejected for MCP, and worse
   * here: `explanation.strategies` is what a reader uses to judge WHY a memory
   * surfaced, so a false entry there corrupts the explanation itself.
   *
   * It is not fixed by populating `matchedByKey`. Doing that needs a vector INDEX to
   * search, and a vector index is Phase 10 (Knowledge / RAG). Until that exists the
   * honest answer is that the strategy cannot run - so it says so, by name, and the
   * remaining strategies are unaffected.
   */
  async #semanticStrategies(
    query: MemoryQuery,
  ): Promise<{ readonly strategies: RetrievalStrategy[]; readonly matchedByKey: Map<string, string[]>; readonly unavailableReason: string | null }> {
    const matchedByKey = new Map<string, string[]>();
    const provider = this.#embeddings;
    const notImplemented =
      "semantic retrieval has no vector index to search: a query vector alone matches nothing";
    if (provider === undefined) {
      return { strategies: [], matchedByKey, unavailableReason: "no embedding provider is configured" };
    }
    if (!(await provider.isAvailable())) {
      return { strategies: [], matchedByKey, unavailableReason: `embedding provider "${provider.name}" is unavailable` };
    }
    if (query.text.trim() === "") {
      return { strategies: [], matchedByKey, unavailableReason: notImplemented };
    }
    try {
      const [queryVector] = await provider.embed([query.text]);
      if (queryVector === undefined) {
        return { strategies: [], matchedByKey, unavailableReason: "the embedding provider returned no vector" };
      }
      // The vector is deliberately NOT used, and the strategy is deliberately NOT
      // claimed. Both are stated here so the next reader does not "fix" the return value
      // and reintroduce the false claim.
      void queryVector;
      return { strategies: [], matchedByKey, unavailableReason: notImplemented };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { strategies: [], matchedByKey, unavailableReason: `embedding failed: ${message}` };
    }
  }
}

function explain(candidate: ScoredCandidate, query: MemoryQuery): RetrievalExplanation {
  const terms = candidate.matchedTerms.length > 0 ? candidate.matchedTerms : tokenise(query.text).slice(0, 5);
  return {
    strategies: [...candidate.strategies],
    contributions: candidate.contributions,
    reason:
      `Matched ${terms.length > 0 ? terms.join(", ") : "metadata"} in scope "${candidate.item.scope}"` +
      ` (${candidate.item.type}, confidence "${candidate.item.confidence.level}")` +
      `${query.taskId === undefined ? "" : ` for task ${query.taskId}`}`,
  };
}

/**
 * Deterministic tie-break.
 *
 * A stable total order, so the same store and the same query always return the
 * same memory first. Without it, a re-run could silently pick a different item
 * and a reader would have no way to know why.
 */
function tieBreak(a: MemoryItem, b: MemoryItem): number {
  if (a.id !== b.id) {
    return a.id < b.id ? -1 : 1;
  }
  if (a.observedAt !== b.observedAt) {
    return b.observedAt - a.observedAt;
  }
  return 0;
}

/** Lower-cased word tokens, plus dotted capability names kept whole. */
export function tokenise(text: string): readonly string[] {
  if (text.trim() === "") {
    return [];
  }
  return text
    .toLowerCase()
    .split(/[^a-z0-9._:-]+/)
    .map((token) => token.replace(/^[.:-]+|[.:-]+$/g, ""))
    .filter((token) => token.length > 1);
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    // A value that cannot serialise is not searchable by text. Reported by
    // absence rather than by throwing: one unserialisable memory must not make
    // the whole store unretrievable.
    return "";
  }
}

/** Re-exported so a caller can build a minimum-confidence filter. */
export type { MemoryConfidenceLevel, MemoryScope };
