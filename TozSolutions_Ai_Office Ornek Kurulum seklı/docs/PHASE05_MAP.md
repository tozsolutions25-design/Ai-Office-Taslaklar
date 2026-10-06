# PHASE 05 gap and reuse map

Produced by the repository audit that preceded implementation, before any
PHASE 05 code was written. Kept so the reasoning is auditable rather than
reconstructed from the diff.

## What already exists, and is reused rather than replaced

| Existing | Location | How PHASE 05 uses it |
|---|---|---|
| `MemoryProvider` port | `src/orchestration/memory/memory.ts` | The storage seam. PHASE 05 adds a typed layer ABOVE it; the port is unchanged. |
| `MemoryAccessPolicy`, `MemoryGrant` | same | Scope authorisation, with read and write grants already separate. Extended with visibility rules, not replaced. |
| `InMemoryMemoryProvider` | same | Backs the reference store. It stays the reference implementation. |
| `KnowledgeProvider` port | `src/knowledge/port.ts` | The retrieval-external-knowledge seam from PHASE 01, and the place a document/RAG backend plugs in. Reused as a retrieval STRATEGY, not reinvented. |
| `NullKnowledgeProvider` | same | The honest "no knowledge layer attached" state. Still the default. |
| `StateStore`, `assertStorable` | `src/state/store.ts` | Serialisability and secret-key rejection, reused by the memory store rather than a second validator. |
| `redact`, `isSensitiveKey` | `src/audit/redaction.ts` | Sensitivity detection. Reused so memory and the audit log agree on what is sensitive. |
| `matchCapabilities` | `src/capabilities/match.ts` | Capability-aware relevance in retrieval, so memory relevance uses the same matcher as everything else. |
| `TraceRecorder`, `orchestration_event` | `src/orchestration/observability/trace.ts` | Memory and learning events flow into the ONE audit history. No parallel logger. |
| `ResourceTracker` | same | Memory size and retrieval cost accounting. |
| `FeedbackStore`, `FeedbackRecord` | `src/orchestration/feedback/feedback.ts` | Execution outcomes. Left as the execution record; `LearningEvent` is a separate, typed signal and does not replace it. |
| `LearningSignalSource` | `src/orchestration/feedback/learningSignal.ts` | PHASE 04.1's opt-in tiebreaker. Kept: learning events may feed it, and must not do so automatically. |
| `AgentAdapter` | `src/orchestration/agent/adapter.ts` | How an agent requests memory: as a capability, through the orchestrator. Never a storage handle. |
| `Clock`, `IdGenerator`, `Result`, `ErrorClass` | `src/core` | As everywhere else. |

## Gaps this phase fills

| Requirement | Existing | Missing | Needs refactor | Test exists | Test needed |
|---|---|---|---|---|---|
| Typed memory model | only `MemoryEntry` (scope/key/value) | item, type, source, confidence, provenance, status, metadata, importance, sensitivity | no — additive layer | no | yes |
| Retrieval | none; only exact key read | strategies, ranking, relevance, recency, confidence, why-retrieved | no | no | yes |
| Embeddings | none | an abstraction, NOT an implementation and NOT a vendor | no | no | yes |
| Write policy | none; every write lands | decide/reject, scope, confidence, expiry, sensitivity, importance | no | no | yes |
| Learning events | `FeedbackRecord` only | typed `LearningEvent` across the listed categories | no | no | yes |
| Correction / invalidation | overwrite only | correct, invalidate, supersede, mark stale, conflict resolution, history | no | no | yes |
| Knowledge ingestion | none | ingestion interface + adapters | no | no | yes |
| Orchestrator integration | writes one outcome record | recall before, capture after verification, learning events | additive, optional | no | yes |
| Agent integration | none | request through the capability interface | additive | no | yes |
| Observability | event kinds exist, unused for memory | retrieval, capture, invalidation, learning metrics | additive | partial | yes |
| Retention / deletion | `delete` only | retention window, purge, scope-wide deletion | no | no | yes |
| Scope isolation | scopes exist, grant-checked | conversation/organization/global scopes, visibility | additive enum values | partial | yes |

## Intentionally not added

- **No vector database, and no embedding vendor.** Retrieval strategies are a port
  (`EmbeddingProvider`). Nothing in this repository calls a model to embed, and
  hard-coding one would couple the memory layer to a provider, which is the thing
  the brief forbids.
- **No document connectors.** Ingestion is an interface plus adapters that accept
  already-extracted text. A GitHub, filesystem or web connector is a future
  phase's job and would be untestable here without a network.
- **No second orchestrator.** `MemoryService` is a service the orchestrator calls;
  it cannot start, schedule or advance anything.
- **No automatic behaviour change from learning.** `LearningEvent` is recorded and
  readable. Nothing reads it to alter selection, policy or thresholds without a
  human opting in, which is the PHASE 04.1 decision extended.
- **No silent overwrite of contradictory knowledge.** A conflicting write becomes a
  supersession with both sides retained, or a reported conflict.
- **No new runtime dependency.**
