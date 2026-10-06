/**
 * PHASE 04 implementation map.
 *
 * Produced by the repository audit that preceded implementation, and kept so the
 * reasoning is auditable rather than reconstructed from the diff.
 *
 * AUDIT RESULT: the repository had NO agent, tool, memory, verification,
 * evidence, feedback, worker, topology or team abstraction. Those are all new.
 * Everything below is either an extension of existing infrastructure or a new
 * module in the new `orchestration` layer. No existing public interface is
 * removed or renamed.
 */

/* ------------------------------------------------------------------ */
/* 1. EXISTING INFRASTRUCTURE TO EXTEND (never replace)                */
/* ------------------------------------------------------------------ */

/* Agent registry: new. There is no agent concept anywhere in PHASE 01-03. */
agents        -> src/orchestration/agent/{record,registry,adapter,trust}.ts
               Follows the ProviderRegistry/ProviderLifecycle pattern exactly:
               explicit lifecycle table, duplicate rejection, Result returns.
               (The lifecycle table lives in `registry.ts`; there is no separate
               `lifecycle.ts`.)

/*
 * Capability registry: new, but MUST reuse PHASE 01 matching.
 *
 * The capability type is currently CLOSED over twelve members. Agents need to
 * declare their own (web_research, entity_extraction, ...), so the union is
 * widened to `BuiltinCapability | (string & {})`. This is backward compatible:
 * every existing use keeps its literal type, and every existing test keeps
 * passing. `CAPABILITIES` is retained as the built-in list.
 */
capabilities  -> src/capabilities/capability.ts  (widen the union, keep the list)
               -> src/orchestration/capabilities/registry.ts
               Reuses `CapabilitySet` and `matchCapabilities` unchanged.

/*
 * Provider registry: EXISTS and is sufficient. It already has lifecycle,
 * approval, health, capabilities, quota and an adapter interface. The only
 * addition is a lookup used by the model router; no second provider registry.
 */
providers     -> src/providers/registry.ts  (unchanged; add nothing unless required)
               Agent records reference providers by id, not by inlining them.

/* Model registry: EXISTS and is sufficient. */
models        -> src/models/registry.ts  (unchanged)
               src/orchestration/model/modelRouter.ts delegates to the existing router.

/*
 * Queue: EXISTS for simple tasks. Orchestration needs a richer state machine
 * (planning, verifying, escalating) and parent/child links, so a SEPARATE task
 * state machine is introduced in the orchestration layer rather than changing
 * TaskState, which the public site and core already depend on.
 */
queue        -> src/queue/  (unchanged)
               -> src/orchestration/task/{state,plan}.ts  (new, orchestration-scoped)

/* Concurrency, retry, health, audit, state: all EXIST and are reused as-is. */
concurrency   -> src/concurrency/limiter.ts  (unchanged)
retry         -> src/retry/  (unchanged)
health        -> src/health/  (unchanged)
audit         -> src/audit/  (unchanged; the orchestrator writes into its sink)
state         -> src/state/  (unchanged)

/*
 * Config: EXISTS and is validated. New sections are added to the same schema
 * and the same env allow-list. No module reads process.env directly.
 */
config        -> src/config/schema.ts  (add agent/memory/security/worker sections)

/* ------------------------------------------------------------------ */
/* 2. NEW MODULES (all new ground)                                     */
/* ------------------------------------------------------------------ */

authority     -> src/orchestration/authority.ts
               THE single control plane. Only type that advances a task to
               completed. Every other service is subordinate and lacks this power.

policy        -> src/orchestration/policy/{antiDrift,security}.ts
               DriftLimits/DriftGuard, InputPolicy, ToolPermission seam.

plan          -> src/orchestration/task/{state,plan}.ts
               OrchestrationTaskState (incl. planning/verifying/escalated),
               ExecutionPlan, SubTask, planner contract.

pool          -> src/orchestration/pool/specialistPool.ts
               Filter then deterministic order, with a rejection reason per
               candidate. Mirrors DefaultRouter rather than reinventing it.

team          -> src/orchestration/team/{topology,team}.ts
               Topology union, TeamPlan, Team, TeamRuntime.

evidence      -> src/orchestration/evidence/evidence.ts
verification  -> src/orchestration/verification/verifier.ts
               pass / fail / needs_review. Distinct from generation.

memory        -> src/orchestration/memory/memory.ts
               Scopes, MemoryAccessPolicy, InMemoryMemoryProvider,
               DisabledMemoryProvider. Read and write are separate permissions.

feedback      -> src/orchestration/feedback/feedback.ts
               Records outcomes. NOT auto-fed into selection in PHASE 04.

tools         -> src/orchestration/tools/tool.ts
               Tool is not Agent. Explicit permissions, via ToolRegistry +
               authorizeToolCall.

workers       -> src/orchestration/workers/worker.ts
               Bounded, cancellable, audited, restartable.

observability -> src/orchestration/observability/trace.ts
               TraceRecorder (local trace + shared audit sink) and
               ResourceTracker (attributable resource usage).

extensions    -> src/orchestration/extensions/extension.ts
               Cannot bypass the policy layer; cannot add a second orchestrator.

config        -> src/orchestration/config/{orchestrationConfig,env}.ts
               Its own schema and env allow-list. AppConfig carries the section;
               orchestrationConfigFromApp validates it, because the core cannot
               import this layer without inverting the dependency direction.

agent         -> src/orchestration/agent/{record,registry,adapter,trust}.ts
               AgentRecord, AgentRegistry (lifecycle), AgentAdapter (leaf),
               trust floors.

capabilities  -> src/orchestration/capabilities/registry.ts
               Indexes agents by capability and explains availability.

model         -> src/orchestration/model/modelRouter.ts
               Thin adapter over the existing ProviderRouter, behind
               ModelRoutingPort.

/* ------------------------------------------------------------------ */
/* 3. RUFLO ADAPTER POLICY                                              */
/* ------------------------------------------------------------------ */

/*
 * No Ruflo package is installed and none is required.
 *
 * The contract (`AgentAdapter`) is what matters. A future RufloAdapter would
 * implement it. It is optional, isolated, disabled by default, and cannot
 * reference the orchestrator.
 *
 * NO fake Ruflo adapter ships: it would be an implementation that claims an
 * integration that does not exist, which is exactly what the brief forbids.
 */

/* ------------------------------------------------------------------ */
/* 4. TEST PLAN                                                        */
/* ------------------------------------------------------------------ */

/*
 * Every new interface gets CONTRACT tests: a reusable suite that any future
 * implementation must pass. That is what makes external integration possible
 * without trusting it.
 *
 * contracts/  - shared, reusable contract suites (the real deliverable)
 * agent/      - registry, lifecycle, adapter
 * pool/       - selection, filtering, rejection reasons, determinism
 * task/       - state machine, plan validation, anti-drift
 * team/       - topologies, execution, failure propagation, cancellation
 * verification/ - pass / fail / needs_review
 * memory/     - namespace isolation, store, retrieve
 * tools/      - registry, permissions
 * workers/    - start, stop, cancellation, failure
 * observability/ - trace propagation, ids, resource attribution
 * isolation/  - one brain, domain separation, no duplicate orchestrator
 */

/* ------------------------------------------------------------------ */
/* 5. WHAT IS DELIBERATELY NOT BUILT                                   */
/* ------------------------------------------------------------------ */

/*
 * Federation, neural routing, GPU/vector infrastructure, CRDTs, QUIC, a large
 * MCP surface, autonomous self-modification, and a large swarm runtime.
 *
 * PHASE 04 delivers contracts plus the smallest sufficient core runtime.
 */
