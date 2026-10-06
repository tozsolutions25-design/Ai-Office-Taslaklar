# PHASE 05: Memory, Knowledge and Learning

Status: **delivered and green**. 1258/1258 tests, typecheck and lint clean, at
commit time. No new runtime dependency.

## What this phase is

A typed, auditable memory layer that the orchestrator uses for two things and two
things only:

1. **Recall** relevant memory *before* execution, and hand it to the agents.
2. **Capture** a *verified* outcome *after* verification, as a memory candidate.

Memory is not a second authority. It cannot start, schedule, or advance a task, and
nothing it returns can outrank the caller's objective. A run that consulted memory
reports exactly which memories it was given (`OrchestrationResult.recalled`), so a
store can never become the real authority quietly.

## The rules that decide behaviour

| Rule | Why it is this way |
|---|---|
| Provenance is mandatory; a missing one is refused by name | A memory that cannot say where it came from cannot be questioned. |
| Sensitivity defaults to `restricted` | A default of `public` would leak on the first omission. |
| Missing confidence becomes `medium`; unmeasured scores stay `null` | A fabricated number is worse than an admitted gap. |
| Nothing is granted by default, and `recallScopes` ships **empty** | A recall is a read of memory on the authority of configuration. A non-empty default would be a standing grant nobody asked for. |
| Recall names its scopes, or recalls nothing | "Everything readable" is how global memory leaks into a narrow task. |
| Relevance is a **gate**, not a weight | With recency alone, every memory matched every query and the store retrieved noise while appearing to rank it. |
| Write policy defaults importance from the memory's **type** | Reading an unstated importance as `0` refused the entire default write path. |
| A key the storage port would reject is refused up front | An item readable in the index but unpersistable vanishes next process start. |
| A failed persistence is recorded, not thrown into the void | `store()` is synchronous, so a rejected write had no call site and surfaced as an unhandled rejection three frames from its cause. |
| Capture requires a verification **pass** | A `needs_review` result is not a fact. |
| A failed run is not captured as a fact | At most it becomes a lesson. |
| `LearningEvent.appliedPolicy` is always `false` | Learning observes. Behaviour changes require a human to opt in. |
| Agents receive summaries, never values | An agent handed values could carry private material into its output, where nothing downstream could catch it. |
| Semantic retrieval is a port, with no production vendor | Coupling memory to an embedding provider is the thing the brief forbids. |

## Layout

| File | Responsibility |
|---|---|
| `memory/model.ts` | Item, type, provenance, confidence, sensitivity, importance, status, scope ranking. |
| `memory/store.ts` | Versioned store. Item-ID indexing, one current belief per key, superseded history, conflict, correction, invalidation, expiry, purge. |
| `memory/retrieval.ts` | Provider-independent retrieval, `EmbeddingProvider` port, filters, ranking, and a why-retrieved explanation per candidate. |
| `memory/policy.ts` | The auditable write policy. Every decision carries named rules and a reason. |
| `memory/learning.ts` | Bounded `LearningEventStore`. Records; never applies. |
| `memory/ingestion.ts` | `KnowledgeIngestor` plus static and unreachable adapters, with an honest ingestion report. |
| `memory/service.ts` | The single façade: capture, recall, agent path, correction, invalidation, learning, metrics, observability. |

## Orchestrator integration

Optional and additive. With no `memoryService`, or with `skipMemory`, or with no
`recallScopes`, a run is byte-identical to PHASE 04.1 — including the shape of the
agent execution request, which gains no `context` key at all.

Note that the orchestrator recalls and captures as `task:<taskId>`, **not** as
`system`. A deployment that grants only `system` will find memory silently doing
nothing, and the run will say so in its steps.

## Deliberate omissions

Unchanged from `PHASE05_MAP.md`, and still true: no vector database, no embedding
vendor, no document connectors, no second orchestrator, no automatic behaviour
change from learning, and no new runtime dependency.

## Known limitations

1. **No persistent `MemoryProvider`.** `InMemoryMemoryProvider` is the only
   implementation. `MemoryStore.load()` rehydrates from any port, but no durable
   port ships here, so nothing has yet survived a process restart in this repository.
2. **No embedding provider**, so semantic retrieval is exercised through the port
   and its unavailable path, never against a real vector index.
3. **No document connectors.** Ingestion accepts already-extracted text.
4. **No browser or E2E tests** (K-07, K-11), unchanged since PHASE 03.
5. **Inner pages remain outstanding.**

Each is the absence of an external integration this repository does not have,
reported rather than faked.
