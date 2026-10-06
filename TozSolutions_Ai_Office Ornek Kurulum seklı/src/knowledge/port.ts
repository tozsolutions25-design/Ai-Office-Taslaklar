/**
 * Optional knowledge-layer port.
 *
 * This is a BOUNDARY, not an integration. A future phase may back this port
 * with AnythingLLM (RAG, documents, workspaces, memory, MCP) or with any
 * other implementation.
 *
 * Two invariants this module exists to enforce:
 *   1. The core orchestrator never imports a concrete knowledge implementation.
 *      It only ever holds a `KnowledgeProvider`.
 *   2. `NullKnowledgeProvider` is a real, working implementation: the core
 *      runs with zero knowledge configuration, reporting
 *      `knowledge_unavailable` rather than failing or silently degrading.
 *
 * No network calls, no client, no dependency is present in PHASE 01.
 */

export interface KnowledgeQuery {
  readonly text: string;
  readonly topK: number | null;
  readonly workspace: string | null;
}

export interface KnowledgeDocument {
  readonly id: string;
  readonly score: number | null;
  readonly source: string | null;
  readonly snippet: string;
}

export interface KnowledgeResult {
  readonly available: boolean;
  readonly documents: readonly KnowledgeDocument[];
  /** Populated when `available` is false. Non-sensitive. */
  readonly reason: string | null;
}

export interface KnowledgeProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  query(query: KnowledgeQuery, signal?: AbortSignal): Promise<KnowledgeResult>;
}

/**
 * The core's default: no knowledge layer attached.
 *
 * Being unavailable is a normal, expected state — not an error.
 */
export class NullKnowledgeProvider implements KnowledgeProvider {
  public readonly name = "none";

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(false);
  }

  public query(_query: KnowledgeQuery, _signal?: AbortSignal): Promise<KnowledgeResult> {
    return Promise.resolve({
      available: false,
      documents: [],
      reason: "knowledge_unavailable",
    });
  }
}
