# PHASE 07 gap and reuse map

Produced by the audit that preceded implementation, from the repository at
`c8648a6` + PHASE 06 (1325/1325). Kept so the reasoning is auditable rather than
reconstructed from the diff.

## The finding that shaped this phase

**Almost every primitive PHASE 07 asks for already exists**, built in PHASE 01 and
PHASE 04, tested, and used. The audit found:

| Primitive | Already exists | Verdict |
|---|---|---|
| Queue with claiming | `TaskQueue` — `enqueue`, `claimNext`, `transition`, `pruneCompleted` | REUSE |
| Validated state machine | `queue/taskState.ts` and `orchestration/task/state.ts` | EXTEND |
| Retry with bounded attempts | `RetryExecutor`, `RetryPolicy`, `computeBackoffDelay` | REUSE |
| Structured failure classification | `RETRYABLE_ERROR_CLASSES` / `PERMANENT_ERROR_CLASSES`, keyed on `ErrorClass` | REUSE |
| Dependency semantics | `team.ts` — `dependsOn`, `skippedDueToDependency`, downstream skip propagation | REUSE the model, new resolver |
| Bounded concurrency | `ConcurrencyManager` — layered limits, leases, waiters | REUSE |
| Worker supervision | `WorkerHost` — bounded, cancellable, recorded, never silently restarted | EXTEND |
| Cancellation | `AbortController` throughout; `OrchestrationRequest.signal` | REUSE |
| Observability | One `AuditLog` / `TraceRecorder` history | REUSE |
| Persistence | `StateStore` — versioned, **in memory** | EXTEND, honestly |

What does **not** exist anywhere, and is therefore the actual work: a **Job**, a
composable **Workflow**, an **Execution/Attempt** as a durable first-class concept,
**Checkpoints**, **ApprovalGates**, **claim leases** (so duplicate delivery can be
detected), and an **idempotency** story.

## EXISTING — reuse unchanged

| Existing | Location | How PHASE 07 uses it |
|---|---|---|
| `TaskQueue`, `TaskRecord`, `createTask` | `src/queue/` | Job/task admission, ordering, claiming, pruning |
| `TASK_STATES` + `assertTaskTransition` | `src/queue/taskState.ts` | Task-level lifecycle, unchanged |
| `ORCHESTRATION_TASK_STATES` + `assertOrchestrationTransition`, `canCompleteFrom` | `src/orchestration/task/state.ts` | The in-run task machine. **Unchanged** — see below |
| `RetryExecutor`, `decideRetry`, `computeBackoffDelay`, `isRetryableUnder` | `src/retry/` | Every retry decision, including the fallback selector hook |
| `RETRYABLE_ERROR_CLASSES`, `PERMANENT_ERROR_CLASSES` | `src/retry/policy.ts` | Retryability, from structured `ErrorClass` and never from a message string |
| `TeamRuntime`, `SubTask.dependsOn`, `SubtaskOutcome.skippedDueToDependency` | `src/orchestration/team/team.ts` | The dependency model and skip propagation |
| `WorkerHost`, `WorkerRunRecord` | `src/orchestration/workers/worker.ts` | Worker supervision: registration, timeout, cancellation, history |
| `ConcurrencyManager`, `ConcurrencyLease` | `src/concurrency/limiter.ts` | Bounded parallel execution, layered |
| `StateStore` | `src/state/store.ts` | Versioned snapshot of jobs, in memory |
| `TozOrchestrator.execute` | `src/orchestration/authority.ts` | **The only way work is executed.** Never reimplemented |
| `ModelRoutingPort`, `evaluateCandidate`, `FallbackPlanner` | PHASE 06 | The only way a provider/model is chosen |
| `MemoryService` | PHASE 05 | The only way a result becomes a memory |
| `VerificationRunner` | `src/orchestration/verification/` | The only way a result becomes verified |
| `TraceRecorder`, `AuditLog` | `src/orchestration/observability/trace.ts` | The only history |
| `idGenerator`, `Clock`, `Result`, `ErrorClass` | `src/core` | As everywhere else |

## EXTEND

- **`Worker`** — the existing `run(signal)` takes no input, so it can only do
  periodic maintenance. A worker that executes an authorized *task* needs the
  execution unit. Extended with an optional task-executing form rather than
  replaced, so PHASE 04.1's periodic-worker tests keep their meaning.
- **`WorkerHost`** — gains claim/lease awareness and task-execution results.
- **Config** — a `workflow` section alongside `memory` and `routing`, validated by
  the same `validateOrchestrationConfig` and reachable through
  `orchestrationConfigFromApp`. **Not** wired into the CLI: PHASE 06 established
  that architectural isolation outranks convenient wiring.
- **Observability** — new event kinds in the one history.

### Why the orchestration task machine is NOT extended with `paused`

`orchestration.task.test.ts` asserts `isOrchestrationState("paused") === false`.
That is a deliberate PHASE 04 decision, not an oversight: an orchestrated in-run
task is cancelled, not paused, and pausing is a *durable job* concern, not an
in-run one. Adding it would change prior-phase behaviour for a convenience, and
the brief forbids weakening a valid invariant. So the job lifecycle gets its own
machine, which is also what the existing `task/state.ts` header already argues for:
the queue machine and the orchestration machine are separate by design, for
different scopes.

## NEW

| New | Why it cannot be an existing concept |
|---|---|
| `Job` | A durable execution request — workflow + root task + retry policy + budget + approval requirement + correlation. Nothing aggregates these today. |
| `Workflow` and typed composition | `TeamPlan` executes a *flat plan*; there is no composable sequential/parallel/conditional/wait/approval/handoff abstraction. |
| `ExecutionCoordinator` | The job-level state authority. Delegates execution to `TozOrchestrator`; never re-decides selection, routing, policy or verification. |
| `ExecutionState` (job lifecycle) | `queued`/`running`/`waiting`/`retrying`/`paused`/`completed`/`failed`/`cancelled`. Deliberately distinct from both existing machines, per the scopes above. |
| `Execution`, `ExecutionAttempt` | Job-scoped attempt records with a worker id and a claim token. `AttemptRecord` in `retry/` is not durable or job-scoped. |
| `Claim` / `ClaimLease` | `claimNext` returns a task but no token, so a duplicate delivery cannot be detected. A lease with an expiry is the minimum to detect it. |
| `Checkpoint` | Nothing exists. |
| `ApprovalGate` | `escalated` is "waiting for a human" and is not an approval with approve/reject/expiry semantics. A worker must not be able to self-approve. |
| `CancellationRequest` | Cooperative, job-scoped, with an explicit rule that a stale worker result cannot revive a cancelled task. |
| `IdempotencyLedger` | Nothing exists. |
| `ResourceBudget` | A budget is enforce-able only where a real number exists; unmeasured cost stays unknown and is not counted against a budget. |

## OUT OF SCOPE

- **Distributed locking / durable claim.** There is no database. `ClaimLease` gives
  *single-process* exclusion with an expiry, and that is the whole guarantee. A
  multi-process deployment would need real storage, which does not exist here.
- **Durable queue, durable checkpoints, durable approvals across restart.**
  `StateStore` is in memory. The abstractions are built and tested; their
  persistence guarantee is stated as in-process only.
- **A real scheduler.** `WorkerHost` runs on demand; PHASE 07 adds a bounded
  poll loop driven by the injected clock, not a cron or an external scheduler.
- **Exactly-once execution.** Not claimed. The implementation is at-least-once
  delivery with effectively-once *effects* only where an idempotency key is
  honoured, and at-most-once for claim-observed duplicates.
- **A second orchestrator.** Explicitly not built. The coordinator owns job state
  and releases work; it calls `TozOrchestrator.execute` for every task.
- **Provider clients, model clients, external adapters.** Unchanged from PHASE 06.
- **Ruflo / Agency adapters.** Explicitly deferred by the phase brief.
- **No new runtime dependency.**

## What PHASE 07 must not do

- Must not let a worker choose a provider or model. Worker → coordinator →
  `TozOrchestrator` → PHASE 06 routing, every time.
- Must not turn "execution completed" into "verified". Verification stays
  authoritative and a `needs_review` verdict must not become a completed workflow.
- Must not let a retry, a fallback provider, or an external agent bypass an
  approval gate.
- Must not let a stale worker result move a cancelled or completed task back to
  running.
- Must not store every worker event as a memory.
