# PHASE 07: Autonomous Workflows / Background Workers

Status: **delivered and green**. 1441/1441 tests, 210 suites, typecheck, lint and
build clean. No new runtime dependency. See `docs/PHASE07_MAP.md` for the
pre-implementation audit.

## The one rule everything else serves

> There is exactly one orchestration authority, and a worker cannot become a
> second one.

This is enforced **structurally, not by convention**. `ExecutionCoordinator` holds
no provider registry, no model registry, no router, no agent registry, no memory
service, and no reference to `TozOrchestrator`. It reaches execution through a
single port, `TaskExecutionPort`, whose production implementation
(`OrchestratorTaskExecutor`) forwards to `TozOrchestrator.execute`.

So "a worker picked its own provider" is not a rule that could be broken — the
coordinator has no mechanism for learning a provider's name. A test asserts this
by inspecting the coordinator for `providers`, `models`, `router`, `selectRoute`,
`memoryService` and `capture`, and a second test drives a real job through the
real orchestrator to confirm the provider was chosen by PHASE 06 routing.

The full chain:

```
ExecutionCoordinator          job state authority; no registries
        │  TaskExecutionPort (a port, holding only a request)
        ▼
OrchestratorTaskExecutor      the ONLY adapter that knows TOZ exists
        │
        ▼
TozOrchestrator.execute       the one authority: plan, select, route, verify
        │
        ▼
PHASE 06 routing              evaluateCandidate → policy → provider/model
        │
        ▼
PHASE 05 memory / verification   under their own policies
```

## What the audit found

Almost every primitive already existed: `TaskQueue`, two validated state
machines, `RetryExecutor` with structured failure classification, dependency
semantics in `team.ts`, `ConcurrencyManager`, `WorkerHost`, `StateStore`. PHASE 07
is mostly **integration**, and the discipline that mattered was refusing to build
duplicates. `docs/PHASE07_MAP.md` records this as EXISTING / REUSE / EXTEND / NEW /
OUT OF SCOPE.

## Three state machines, on purpose

| Machine | Scope | Why separate |
|---|---|---|
| `queue/taskState.ts` (existing) | one queued unit in one process's queue | unchanged; core, depended on by the public site |
| `orchestration/task/state.ts` (existing) | an in-run orchestrated task | unchanged; `orchestration.task.test.ts` asserts `paused` does not exist, and that is a deliberate PHASE 04 decision |
| `workflow/jobState.ts` (new) | a durable background **job** | a job must be pausable and may wait on a human for an unbounded time, neither of which is an in-run state |

The invariant is not "one machine everywhere" — it is **one authority per scope**.
`task/state.ts` already argues for multiple machines; PHASE 07 follows that
argument rather than contradicting it.

## State transitions

```
queued ──► running ──► completed
   │         │  ▲  │
   │         │  │  ├──► waiting ──► running        (approval or dependency)
   │         │  │  ├──► retrying ──► running       (bounded)
   │         │  │  ├──► paused ──► running         (a pause must be liftable)
   │         │  │  └──► failed
   │         │  └─────► cancelled
   └──► failed | paused | cancelled
```

Every terminal state has **no outgoing edge**. That is the entire stale-result
defence: a worker reporting after its job was cancelled has nothing legal to
transition to. Illegal transitions are refused and recorded as `REFUSED` rather
than discarded, because a refusal is evidence.

## Retry

Retry decisions come from the **existing** `decideRetry`, applied to the
structured `ErrorClass` — never to a message. A test asserts that
`errorClass: "authentication_failure"` with the message `"try again!"` is not
retried, because a permanent class is permanent whatever the text invites.

Backoff is **recorded, not slept on**: a coordinator that slept would block the
whole job behind one task's wait. A `fallback` action (quota exhaustion) re-enters
the PHASE 06 routing contract on the next attempt; the coordinator names no target
when it happens, because it has no way to.

## Cancellation and stale results

Cooperative. `cancelJob` records the request and releases the job's claims so no
worker is left holding a task of a job that no longer exists. A result arriving
for a cancelled job is **refused**, verified by re-checking the claim token rather
than trusting the worker. Tests cover the race directly, by cancelling from
*inside* the execution.

## Approval gates

Four rules, each pinned by a test:

1. A decision names who made it; an anonymous approval is refused.
2. The executing worker may not approve its own work — refused, not discouraged.
3. The task under approval may not approve itself.
4. A decided gate is **final**: there is no edge out of a terminal approval state,
   so a later attempt cannot overturn a rejection.

The gate is consulted on **every release**, not once per job. That is what makes it
unbypassable by a retry — a second attempt asks again and gets the same answer.

## Checkpoints and recovery

`recoverable` is a **declared property of the task**, never inferred. A task that
cannot safely resume states why, and `recoveryPlan` returns `restart` with the
reason rather than pretending to continue. A checkpoint without a `dataRef` is
refused, because a checkpoint pointing at nothing invites exactly the assumption
`recoverable` exists to prevent.

## Delivery semantics — stated precisely

There is **no database** in this repository, so the guarantee is named honestly in
`DELIVERY_SEMANTICS`:

- `claim: "effectively-once"` — at-least-once delivery with at-most-once execution.
- `scope: "single-process"` — a `ClaimLease` gives exclusion within one process,
  with expiry so a crashed worker's task is recoverable.

**"Exactly once" is not claimed anywhere.** A crash between applying an external
effect and writing its idempotency key is a real window, and no amount of
in-memory bookkeeping closes it. A duplicate arriving while the first execution is
still running is told to *wait*, not given an answer that does not exist yet.

## Concurrency, priority and budgets

- **Concurrency** is a configured ceiling, never derived from workflow size. There
  is no "unlimited" setting anywhere: a deployment wanting more configures a
  larger number and pays for it visibly.
- **Priority** governs how much *fallback* is spent, never *eligibility*. A
  `background` task spends one attempt rather than a latency budget nobody asked
  for. Urgency is not a capability.
- **Budgets** are enforced against **measured** spend. A provider that reported
  tokens and no amount means the budget *cannot be evaluated*, and execution stops
  and says so — it does not assume compliance. Nothing has run yet is a different
  situation from unpriced usage, and conflating them produced a budget that could
  never pass its first step (a real bug, now fixed).

## Observability

Sixteen new event kinds in the **one** shared history — `job_created`,
`job_state_changed`, `job_cancelled`, `job_stopped_on_budget`, `task_retrying`,
`task_skipped`, `checkpoint_recorded`, `approval_requested`, `approval_decided`,
`duplicate_delivery_refused`, `idempotency_conflict`, `idempotent_replay` and
others. No second logger. Every job carries a `correlationId` through to every
event.

## Configuration

A `workflow` section beside `memory` and `routing`, validated by the same
`validateOrchestrationConfig` and reachable through `orchestrationConfigFromApp`.
It has a section allow-list, a per-key allow-list, and cross-field validation
(`backoffBaseMs` may not exceed `backoffMaxMs`).

**Deliberately not wired into the CLI.** PHASE 06 established that architectural
isolation outranks convenient wiring, and `src/cli` is core-layer: making it import
orchestration config broke a `phase01Isolation` test, correctly.

## Deliberately NOT implemented

- **Distributed locking or durable claims.** No database exists, so none is faked.
- **Durable queue, checkpoints or approvals across restart.** `StateStore` is in
  memory; the abstractions are built and tested, the persistence guarantee is
  in-process only.
- **Exactly-once execution.** See above.
- **A real scheduler.** No cron, no external scheduler, no new dependency.
- **Provider clients, model clients, external adapters.** Unchanged from PHASE 06;
  the adapters in tests are doubles that say so.
- **A general workflow DSL.** Typed composition only. A string-parsed workflow
  definition would need its own parser and validator and would become a second
  place for orchestration policy to be expressed.
- **Ruflo / Agency adapters.** Deferred by the phase brief.
- **A `format` script.** The repository has none; `lint` remains the gate.

## Known limitations

1. **A job's state lives in memory.** A process restart loses every job. Recovery
   is tested at the level the repository can support: claim expiry, checkpoint
   plans, and refused stale results.
2. **Parallel groups are released in waves, not truly concurrently.** The
   concurrency ceiling is enforced and observed, but the release loop is
   sequential by design so ordering stays reproducible. A deployment wanting full
   parallelism needs that change, and it would need the claim registry to be
   consulted per branch.
3. **Conditional predicates are a fixed vocabulary** (`all_succeeded`,
   `any_failed`, `any_cancelled`, `none_pending`). Anything else returns "cannot
   be evaluated" and the branch is **held, not guessed**.
4. **A `wait` step records intent; it does not block a worker thread.** The job
   goes to `waiting` and needs something external to advance it.
5. **No live health probe** (`HealthProbe` is still a port), **no real MCP client**,
   and **no browser or E2E tests** (K-07, K-11) — both unchanged since PHASE 03.
6. **Inner pages remain outstanding.**
