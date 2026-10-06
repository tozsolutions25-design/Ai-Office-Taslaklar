/**
 * PHASE 02: THE COMPOSITION ROOT.
 *
 * WHY THIS FILE EXISTS
 *
 * Phase 00 established, by execution rather than by reading, that this repository
 * had **no composition root for orchestration**. `src/core/composition.ts`
 * assembled the PHASE 01 core and nothing else. `TozOrchestrator`, `GovernanceGate`,
 * `MemoryService`, `ExecutionCoordinator`, `AgentIngestor`, `ToolExecutionHost`,
 * `ModelRouter`, `SpecialistPool` and the agent registries were constructed NOWHERE
 * in `src/`. The only assembly of the orchestration layer in existence was
 * `tests/helpers/orchestrationHarness.ts`.
 *
 * The consequence was not stylistic. C-1 - governance computing a denied-provider
 * list and then discarding it - survived 1,598 green tests, because every
 * governance test built its own gate and its own router and the seam between the
 * two real objects was never crossed outside a fixture that could not distinguish
 * the defective code from the fixed code (D-03). **Four authorization defects lived
 * in a library with nothing behind it.** A component that is never assembled cannot
 * fail, which is exactly why nobody found out that it could.
 *
 * This file is that assembly. It is the ONE place in `src/` permitted to construct
 * these classes, and a test enforces it.
 *
 * WHAT THIS FILE IS NOT
 *
 * It is not a service, and it is not a framework. It opens no socket, reads no file,
 * writes no database and imports nothing outside this repository. It has no HTTP
 * surface, no UI and no CLI of its own beyond describing what it composed. Those
 * belong to later phases and to the decisions B-02, B-03, B-04 and B-05 are still
 * waiting on.
 *
 * It is a LIBRARY composition root with a runnable entry point: a factory that
 * wires the real components together, a `describe()` that reports only what it
 * measured, and `bootstrapRuntime()`, which is the seam a future service, CLI or
 * worker will call. B-03's answer - "current state is a library core, target state
 * is an AI office product" - is what makes this the correct phase-02 shape: the
 * product needs a bootable core before it needs a transport.
 *
 * THE FAIL-CLOSED CONTRACT, WHICH IS THE ACTUAL WORK
 *
 * Composing a system is easy. Composing it so that every ABSENT thing refuses
 * rather than permits is the whole difficulty, and it is where the four Phase 01
 * defects came from (D-05: "an absent value is treated as nothing to enforce,
 * rather than as nothing permitted"). So every optional collaborator here has a
 * default that refuses, and each refusal is stated rather than implied:
 *
 *   governance      installed by DEFAULT. A runtime that never opted in still has a
 *                   control plane on its execution path, and an unidentified caller
 *                   is refused before a plan exists. Opting OUT is explicit.
 *   identity        absent means every run is refused. No actor is ever guessed.
 *   serviceContext  absent means the workflow path refuses. The port that carries a
 *                   background task into the orchestrator has no field for a caller,
 *                   so the runtime must state the principal it acts as.
 *   agent backend   absent means `UnavailableAgentAdapter`, which answers with a
 *                   classified `configuration_error` and never a fake success.
 *   provider        none is registered, so `route()` reports that no route exists.
 *                   No provider client ships in this repository and inventing a wire
 *                   format would be inventing an integration.
 *   memory          disabled means `DisabledMemoryProvider`, which grants nothing,
 *                   rather than an unconfigured service that happens to be empty.
 *   recall scopes   empty by default, which means NO recall - never "everything
 *                   readable". A standing read grant nobody asked for is a leak.
 *   ingestion       never promotes to `available` unless configuration says so.
 *                   Promotion is a trust decision, not a side effect of reading a
 *                   roster.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 *   tenancy / workspace_id / brand_id   Phase 06, and a decision nobody has made
 *   durable state                       Phase 12, and B-02 is still open
 *   provider clients, CRM, n8n, tools   Phase 13
 *   HTTP, UI, auth                      later phases, and B-05 is still open
 *
 * A test scans this file for each of those, so "we did not add it here" is checked
 * rather than promised.
 */

import { type Clock, systemClock } from "../core/clock.js";
import { type IdGenerator } from "../core/ids.js";
import { type ErrorClass } from "../core/errors.js";
import { type Result, err, ok } from "../core/result.js";
import { type AppConfig } from "../config/schema.js";
import { createCore, type Core } from "../core/composition.js";
import { type AuditSink } from "../audit/events.js";
import { type KnowledgeProvider } from "../knowledge/port.js";
import { type ModelRegistry } from "../models/registry.js";
import { type ProviderRegistry } from "../providers/registry.js";
import type { ProviderAdapter } from "../providers/provider.js";
import type { ProviderRouter } from "../routing/router.js";

import type { OrchestratorError} from "./authority.js";
import { TozOrchestrator, type OrchestrationRequest, type OrchestrationResult } from "./authority.js";
import { AgentRegistry } from "./agent/registry.js";
import { AdapterRegistry, UnavailableAgentAdapter, type AgentAdapter } from "./agent/adapter.js";
import { CapabilityRegistry } from "./capabilities/registry.js";
import { SkillRegistry, type SkillLoadRecord } from "./skill/skill.js";
import { SpecialistPool } from "./pool/specialistPool.js";
import { ModelRouter } from "./model/modelRouter.js";
import { ProviderAdapterRegistry } from "./provider/providerAdapterRegistry.js";
import { AgentIngestor } from "./agentsource/ingest.js";
import { ToolRegistry, type ToolInvoker } from "./tools/tool.js";
import { ToolExecutionHost } from "./tools/invoker.js";
import { type WorkspaceRef } from "./workspace/workspace.js";
import { type AuditReadScope } from "../audit/events.js";

/**
 * PHASE 06. The read scope for this runtime's own audit history.
 *
 * A runtime that declared no workspace reads the UNATTRIBUTED history - which is
 * not the same thing as reading everything. It sees the events this process
 * recorded without a workspace and nothing else, and no partitioned reader can
 * ever see them.
 */
function auditScopeOf(workspace: WorkspaceRef | null): AuditReadScope {
  return { workspace: workspace?.workspace ?? null, brand: workspace?.brand ?? null };
}

/**
 * PHASE 06. Reconciles "who" with "where", and REFUSES when they disagree.
 *
 * There are two workspace sources and conflating them would have been a mistake:
 * the deployment's identity source says WHO is asking, and the runtime's
 * `workspace` option says WHERE this process serves. A context that names its own
 * workspace and a runtime that declares a different one cannot both be right.
 *
 * Three cases, and the third is the important one:
 *
 *   1. The context names no workspace -> the runtime's declared one is attached.
 *      Without this a deployment that declared a workspace and supplied an
 *      identity resolver unaware of the concept would silently get NO memory, NO
 *      recall and a run whose steps say "memory was not written: no verified
 *      workspace" - a correct-looking result with the whole memory path switched
 *      off. That is exactly the silent failure this phase exists to remove, and it
 *      was found by a PHASE 02 test rather than by inspection.
 *   2. The context names the SAME workspace -> left alone.
 *   3. The context names a DIFFERENT one -> REFUSED, and the caller sees
 *      `null`, which every authorization path treats as unidentified.
 *
 * Case 3 is a refusal rather than a preference for either side. A deployment whose
 * identity source hands out contexts for another workspace is misconfigured, and
 * quietly preferring the runtime's declaration would authorise work against a
 * partition the identity never claimed - the exact class of bug the composite key
 * exists to prevent, one layer earlier.
 *
 * The returned object is a NEW frozen context. The caller's context is not
 * mutated, and no grant is touched.
 */
function attachWorkspace(context: SecurityContext, workspace: WorkspaceRef | null): SecurityContext | null {
  if (workspace === null) {
    // No workspace declared. Leave whatever the identity said, including nothing.
    return context;
  }
  if (context.workspace === null) {
    return Object.freeze({ ...context, workspace });
  }
  const same =
    context.workspace.workspace === workspace.workspace && context.workspace.brand === workspace.brand;
  return same ? context : null;
}

/**
 * PHASE 06. The registries that stay DEPLOYMENT-scoped and are therefore visible to
 * every workspace in this process.
 *
 * ## Why this list exists, and what it does not claim
 *
 * Hard partitioning is not free: every partitioned registry needs a workspace
 * threaded to it, and the ones listed here are deliberately NOT threaded. That is a
 * decision, not an oversight, so the decision is written down in the place someone
 * would go to add a registry and read it.
 *
 * The reason is what each one holds. Providers, models, capabilities, verifiers and
 * provider adapters are **deployment configuration**: this installation knows which
 * upstreams are reachable, which models they expose, which capability contracts
 * exist, and which verifiers are wired. That describes the installation, not any
 * customer of it. A workspace cannot reach another workspace's data by reading the
 * provider list, because the provider list contains no customer data to reach.
 *
 * ## The non-guarantee, stated plainly
 *
 * This is a claim about the CURRENT record types, enforced by a test that reads
 * their source and rejects any field named like a customer secret. It is not a proof
 * for all time. A future change that adds a credential, a customer-owned document or
 * a per-tenant override to any of these records breaks the isolation guarantee, and
 * the test below is what catches it - which is why the test reads source rather than
 * trusting this comment.
 *
 * Two things are deliberately NOT claimed:
 *
 *   1. Isolation by secrecy of configuration. Provider credentials live here and are
 *      process-wide. A workspace cannot read them through these APIs; nothing in the
 *      runtime returns a `ProviderConfig` to a request path. That is a statement
 *      about the current API surface, not a sandbox, and PHASE 06 does not add one.
 *   2. A second registry authority. Every registry in this list is constructed in
 *      the composition root below, exactly once. None of them is derived from or
 *      mirrored by another, so there is no second place to update and no way for two
 *      of them to disagree.
 */
const PLATFORM_SCOPED_REGISTRIES: readonly PlatformScopedRegistry[] = [
  {
    name: "core.providers",
    holds: "reachable provider endpoints and their credentials",
    customerData: false,
  },
  { name: "core.models", holds: "the models each provider exposes", customerData: false },
  {
    name: "capabilities",
    holds: "capability contracts available to this installation",
    customerData: false,
  },
  { name: "verifiers", holds: "the verifiers wired into this installation", customerData: false },
  {
    name: "providerAdapters",
    holds: "transport adapters, one per provider type",
    customerData: false,
  },
  // Telemetry DERIVED from the five above, holding counters and observations about
  // upstreams rather than about customers. Partitioning these by workspace would
  // produce a rate limiter with no shared view of the upstream it is limiting, which
  // is worse than the flat version: it would let one workspace's traffic exhaust a
  // limit the others believe is still available.
  { name: "core.router", holds: "routing policy and per-provider cooldowns", customerData: false },
  { name: "core.concurrency", holds: "in-flight counters per provider and model", customerData: false },
  { name: "core.health", holds: "health observations about upstreams", customerData: false },
  { name: "orchestrationConfig", holds: "the loaded configuration file", customerData: false },
];

/** One entry of the deployment-scoped inventory, with the reason it is safe to share. */
interface PlatformScopedRegistry {
  readonly name: string;
  /** What this registry actually stores. Prose on purpose: it is read by humans. */
  readonly holds: string;
  /**
   * Explicit, machine-checked, and required. A registry cannot be listed here
   * without it, so "we forgot to think about whether this holds customer data"
   * fails the type check rather than passing silently.
   */
  readonly customerData: false;
}
import { EvidenceIntegrityVerifier, VerificationRunner, type Verifier } from "./verification/verifier.js";
import { InMemoryFeedbackStore } from "./feedback/feedback.js";
import {
  DenyAllInputPolicy,
  DenyAllOutputPolicy,
  HeuristicInjectionInputPolicy,
  PermissiveInputPolicy,
  PermissiveOutputPolicy,
  SecurityDecisionLog,
  type InputPolicy,
  type OutputPolicy,
} from "./policy/security.js";
import { DriftGuard } from "./policy/antiDrift.js";
import { ResourceTracker, TraceRecorder } from "./observability/trace.js";


import { MemoryStore } from "./memory/store.js";
import { RetrievalEngine, type EmbeddingProvider } from "./memory/retrieval.js";
import { DefaultWritePolicy } from "./memory/policy.js";
import { LearningEventStore } from "./memory/learning.js";
import {
  DisabledMemoryProvider,
  InMemoryMemoryProvider,
  MemoryAccessPolicy,
  type MemoryProvider,
  type MemoryScope,
} from "./memory/memory.js";
import { isAnyMemoryScope } from "./memory/model.js";
import { MemoryService } from "./memory/service.js";

import {
  ApprovalResolverRule,
  ApprovalRule,
  CapabilityRule,
  GovernanceRecorder,
  GrantRule,
  KnownActorRule,
  PolicyEngine,
  ResourceAllowListRule,
  ScopeRule,
  TrustFloorRule,
  bridgeApproval,
  createSecurityContext,
  inJobScope,
  isOperation,
  withProvenance,
  type ApprovalGateObserver,
  type ApprovalGatePort,
  type GovernanceRule,
  type RecordedApproval,
  type RoutingRestriction,
  type SecurityContext,
} from "./governance/index.js";
import { OPERATIONS, isHumanApprovalOperation } from "./governance/index.js";
import { GovernanceGate } from "./governance/gate.js";

import {
  ExecutionCoordinator,
  OrchestratorTaskExecutor,
  TaskWorkerRegistry,
  type ApprovalRegistry,
  type OrchestratorExecutionPort,
} from "./workflow/index.js";

import {
  DEFAULT_ORCHESTRATION_CONFIG,
  loadOrchestrationConfig,
  validateOrchestrationConfig,
  type OrchestrationConfig,
  type OrchestrationConfigIssue,
} from "./config/orchestrationConfig.js";
import { rawOrchestrationConfigFromEnv, type OrchestrationEnv } from "./config/env.js";

/* -------------------------------------------------------------------------- */
/* Identity                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Who is asking, and as whom.
 *
 * The orchestrator can only refuse a caller it can identify, and it cannot infer an
 * actor from a task id - a guessed actor is precisely the failure governance
 * exists to prevent. So identity is a composition-root concern, stated here rather
 * than defaulted somewhere deep.
 *
 * There is no authentication in this repository (B-05 is open). What this type
 * does is make the question unavoidable and the absence loud: a runtime built with
 * no `identity` refuses every run, and says so in `describe()`.
 */
export interface RuntimeIdentity {
  /**
   * Resolves the caller for a request that carries none of its own.
   *
   * Returning null means "this caller could not be identified", which the gate
   * reads as a refusal. It is not an error and not a fallback to a default actor.
   */
  readonly resolve: (input: { taskId: string; jobId: string | null; traceId: string }) => SecurityContext | null;
  /**
   * The principal a BACKGROUND task acts as.
   *
   * Required for the workflow path, and the reason is structural rather than
   * procedural: `OrchestratorExecutionPort.execute` has no field for a caller, so a
   * task driven by the coordinator reaches `TozOrchestrator` with nothing
   * identifying who asked for it. A runtime must therefore say which principal the
   * background worker acts as - or the background path refuses.
   *
   * With none supplied, this is null and the workflow path is refused. That is the
   * safe direction, and it is also the honest one: a worker executing as an
   * unnamed service identity is how "who approved this?" becomes unanswerable.
   */
  readonly serviceContext?: SecurityContext | null;
}

/* -------------------------------------------------------------------------- */
/* Options                                                                       */
/* -------------------------------------------------------------------------- */

export interface RuntimeOptions {
  /** Validated orchestration settings. Defaults to the shipped configuration. */
  readonly config?: OrchestrationConfig;
  /** Core settings, forwarded to `createCore`. */
  readonly appConfig?: AppConfig;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  /** Override the audit sink. Everything that records goes through this one. */
  readonly audit?: AuditSink;
  /** Override the knowledge provider. */
  readonly knowledge?: KnowledgeProvider;
  /** Override the memory port. A deployment with a real backend supplies it here. */
  readonly memory?: MemoryProvider;

  /**
   * Agent backends.
   *
   * EMPTY BY DEFAULT, and the runtime registers `UnavailableAgentAdapter` in their
   * place so that a runtime with no backend is startable and honest rather than
   * crashing. No provider client and no agent implementation ships in this
   * repository; a fabricated one would be a fabricated integration.
   */
  readonly adapters?: readonly AgentAdapter[];
  /** Provider adapters, for provider-backed execution. Absent means none. */
  readonly providerAdapters?: readonly ProviderAdapter[];
  /** Tool invokers, by tool id. A tool with no invoker is not executable. */
  readonly toolInvokers?: Readonly<Record<string, ToolInvoker>>;
  /** Verifiers. The reference integrity verifier is registered when this is absent. */
  readonly verifiers?: readonly Verifier[];

  /** Governance rules. Defaults to the reference set below. */
  readonly rules?: readonly GovernanceRule[];
  /** Per-task and global routing restrictions, keyed by task id or `*`. */
  readonly restrictions?: ReadonlyMap<string, RoutingRestriction>;
  /** Whether an actor is known. Absent means "any named actor", which is stated. */
  readonly knownActors?: (actor: string) => boolean;
  /** Semantic search, when a deployment has an embedding provider. */
  readonly embeddings?: EmbeddingProvider;
  /** Identity. Absent means every run is refused. */
  readonly identity?: RuntimeIdentity;
  /**
   * PHASE 06. The workspace this runtime serves.
   *
   * Absent is a real state, not a default: the runtime then composes no memory
   * store, no retrieval engine and no memory service, `describe().workspaceIsolation`
   * reports `"unasserted"`, and every partitioned operation refuses because no
   * resolved identity can name a workspace. That is `TODO.md` PHASE 06 item 8 - a
   * startup assertion, never silent - expressed as an absent capability rather than
   * a boot failure, so a single-workspace library user is not forced to declare
   * tenancy they do not have.
   */
  readonly workspace?: WorkspaceRef;
}

/* -------------------------------------------------------------------------- */
/* What the runtime will tell you about itself                                  */
/* -------------------------------------------------------------------------- */

/**
 * A measurement, not a claim.
 *
 * Every number here is read from the live component at call time. Nothing is
 * declared and nothing is defaulted to a flattering value: an empty registry reads
 * as `0`, an absent backend reads as `absent`, and the two absences this build
 * genuinely has - no durable state and no tenancy - are stated rather than omitted,
 * because a capability that is silently missing is the one nobody plans for.
 *
 * `durableState` and `tenancy` are the only two constants here. They are constants
 * because this build genuinely has neither, and a test scans this file to prove it:
 * there is no `node:fs`, no database and no tenant identifier anywhere in it.
 */
export interface RuntimeDescription {
  /** `advisory` means governance does NOT stop work on the execution path. */
  readonly governance: "enforced" | "advisory";
  readonly governanceOnExecutionPath: boolean;
  readonly governanceRules: readonly string[];
  /** `absent` means every run is refused: no actor is ever guessed. */
  readonly identityResolver: "supplied" | "absent";
  readonly serviceContext: "supplied" | "absent";
  /** `refused` means a background task cannot be authorised and will not run. */
  readonly workflowExecution: "wired" | "refused";
  /**
   * PHASE 03: whether a governance-configured approval is ANSWERABLE here.
   *
   * Measured from the binding, not asserted from configuration. `wired` means a
   * `governance.approvalRequired` entry can be satisfied by a human through the one
   * registry; `unwired` means the rule still fires and nothing can answer it, which
   * is the fail-closed behaviour PHASE 03 recorded as a blocker rather than a
   * defect. A deployment reading this is being told whether the setting works.
   */
  readonly approvalBridge: "wired" | "unwired";
  /**
   * WHICH authority records approvals. A constant rather than a measurement, and
   * stated because "there is exactly one" is a property worth being able to read
   * rather than infer: a second gate registry would give "who approved this?" two
   * answers.
   */
  readonly approvalAuthority: "workflow-registry";
  /**
   * PHASE 04: what the approval RECORD can honestly promise.
   *
   * Read from the store the coordinator's registry was given, not from a constant
   * here. `process-local` means a restart loses every gate - which fails CLOSED,
   * because an unknown gate holds the task again - and is still not durability.
   * `MASTER_PLAN.md` §8.6 wants a durable approval record and §8.4 puts it in the
   * project definition of done; that is Phase 12, with B-02 still open. This field
   * is the seam, stated rather than implied.
   */
  readonly approvalDurability: "process-local" | "durable";
  /**
   * PHASE 04: who re-drives a task an approval has released.
   *
   * A constant, and stated because the alternative is silence. Nothing in this
   * repository schedules work: the caller that owns a job calls `runJob`, and
   * `ExecutionCoordinator.redriveRequired` reports when it has not. A constant here
   * is a promise about behaviour, so it is stated in the one place a deployer reads
   * what the runtime is.
   */
  readonly approvalRedrive: "caller-owned";
  /**
   * PHASE 04: every operation the brief says needs a human.
   *
   * The CLASSIFICATION, in full, whether or not this deployment has turned any of
   * it on. Reported separately from `approvalRequiredOperations` so the difference
   * between "the brief requires a human" and "this deployment requires one" is a
   * number a reader can see rather than an assumption.
   */
  readonly humanApprovalOperations: readonly string[];
  /** What `governance.approvalRequired` actually names. The only switch. */
  readonly approvalRequiredOperations: readonly string[];
  readonly providers: number;
  readonly models: number;
  readonly providerAdapters: number;
  readonly agents: number;
  readonly agentAdapters: readonly string[];
  /**
   * PHASE 10: what state the knowledge layer is in.
   *
   * `"unattached"` when no provider was supplied, `"attached-not-consulted"` when one was.
   * The second half of that string is the whole point of this field.
   *
   * `KnowledgeProvider` is threaded all the way into `Core` and **nothing in `src/` ever
   * queries it** — `knowledge.query(` appears in no production file. So before this field
   * existed, `createRuntime({ knowledge })` accepted a full RAG backend and changed nothing
   * observable, and `describe()` gave a deployer no way to learn that. AnythingLLM is a
   * **PHASE 13** external boundary, and `TODO.md` says to keep the port until it is real, so
   * the fix is to report the state honestly rather than to build the integration here.
   *
   * `tests/knowledgeBoundary.p10-evidence.test.ts` asserts both halves: that this reports
   * `attached-not-consulted`, and that no production file consults the provider. When Phase
   * 13 wires a real backend, the first assertion is what must change — deliberately, in a
   * diff — rather than the second quietly ceasing to be true.
   */
  readonly knowledge: "unattached" | "attached-not-consulted";
  /**
   * PHASE 09: skills this runtime has installed. Declarations only.
   *
   * `skillAuthority` is the field that matters and it is a literal, not a boolean: it says
   * the subsystem DECLARES requirements and never confers them, so an operator reading a boot
   * report can see that installing a skill did not widen anyone's reach.
   */
  readonly skills: number;
  readonly skillAuthority: "declares-only";
  readonly verifiers: readonly string[];
  readonly tools: number;
  readonly toolInvokers: number;
  readonly toolTimeoutMs: number;
  /**
   * PHASE 05. What a side-effecting tool call can currently obtain.
   *
   * `"required-and-unobtained"` is the honest value and it is a *statement about the
   * code*, not about configuration: the orchestrator always sets
   * `requiresApprovalForSideEffects: true` for a reported tool call, and no flow yet
   * issues a `ToolCallApproval` during an execution. So an irreversible tool is
   * refused, with a message naming what would satisfy it (B-13). `"available"` would
   * be a claim about a flow that does not exist, and `"not-required"` would be a way
   * to switch off the project definition of done.
   */
  readonly toolApproval: "required-and-unobtained" | "available";
  /**
   * PHASE 05. Whether an agency adapter is composed as a runtime authority.
   *
   * `false` is CORRECT and deliberate. Agency is a specialist/capability source, not
   * a second system authority, so the composition root does not construct one and
   * its `describe()` - which needs a roster the product never supplies - is
   * unreachable by construction. Recorded so a reader does not have to infer it from
   * the absence of a class name.
   */
  readonly agencyAdapterComposed: boolean;
  readonly memory: "in_memory" | "supplied" | "disabled";
  readonly memoryService: boolean;
  readonly memoryMinimumImportance: number;
  readonly learning: boolean;
  /** Empty means NO recall. Never "everything readable". */
  readonly recallScopes: readonly string[];
  readonly autoPromote: boolean;
  readonly workflowMaxConcurrency: number;
  /**
   * The concurrency ceiling the coordinator is ACTUALLY running under.
   *
   * Read from the coordinator, not from configuration. A configured limit that
   * nothing reports back is a limit that looks applied and may not be - so this
   * field is the measurement, and a test asserts it equals what was configured.
   */
  readonly coordinatorMaxConcurrency: number;
  /**
   * How the PRIMARY candidate is ordered. Measured from the router, not assumed.
   *
   * It is NOT the configured fallback policy, and cannot be: `DefaultRouter` orders
   * by a verified-facts scorer with no policy concept. Stating both facts here is
   * what stops `orchestration.routing.defaultPolicy` from reading as a setting that
   * governs routing as a whole when it governs the fallback chain only.
   */
  readonly selectionOrder: string;
  /** The policy the fallback chain is ordered by. */
  readonly fallbackPolicy: string;
  readonly inputPolicy: string;
  readonly outputPolicy: string;
  readonly auditEvents: number;
  readonly durableState: false;
  /**
   * PHASE 06. The isolation mode this runtime is actually running in.
   *
   * It replaces a `tenancy: "none"` CONSTANT, which asserted nothing: it was
   * `false` on every build forever, including one serving two customers. A
   * constant that cannot vary is a decoration, and `TODO.md` PHASE 06 item 8 asked
   * for a startup assertion that is never silent.
   *
   *   - `"unasserted"` - no workspace was declared. Partitioned subsystems are NOT
   *     composed and every partitioned operation refuses. This is a real state, not
   *     a failure: it is what a single-workspace library user looks like, and it is
   *     the safe direction because nothing is shared.
   *   - `"partitioned"` - a workspace was declared. Every partitionable store is
   *     keyed on it, so a cross-workspace lookup misses rather than being filtered.
   *
   * There is deliberately no `"single"` mode. Declaring one workspace is the
   * partitioned case with one partition, and a separate label for it would be an
   * invitation to treat the two as different code paths.
   */
  readonly workspaceIsolation: "unasserted" | "partitioned";
  /**
   * PHASE 06. The workspace this runtime serves, or `null`.
   *
   * Present so a reader of `runtime:describe` can see WHICH partition rather than
   * only that partitioning is on, and so an operator can confirm two runtimes that
   * should be separate are not sharing one.
   */
  readonly workspace: string | null;
  readonly brand: string | null;
  /**
   * PHASE 06. Registries that remain DEPLOYMENT-scoped, and are therefore shared by
   * every workspace in this process.
   *
   * Listed rather than left implicit, because a reader deserves to know which stores
   * a cross-workspace read cannot reach and which it can. Each entry carries WHAT it
   * holds and asserts it holds no customer data, so a registry cannot be shared
   * without someone writing that down.
   *
   * The reason this is safe today is that these records describe the installation -
   * which upstreams are reachable, which models they expose, which verifiers are
   * wired - and describe no customer. The non-guarantee is deliberate: this is a
   * claim about the current record types, and a test reads those types' source and
   * rejects a field named like a customer secret. It is not a claim that a
   * credential-free future version cannot exist, and PHASE 06 adds no sandbox.
   */
  readonly platformScopedRegistries: readonly PlatformScopedRegistry[];
}

/* -------------------------------------------------------------------------- */
/* The runtime                                                                   */
/* -------------------------------------------------------------------------- */

export interface Runtime {
  /* Configuration */
  readonly config: OrchestrationConfig;
  readonly app: AppConfig;
  /** The PHASE 01 core this runtime is built on. Its registries are reused, not rebuilt. */
  readonly core: Core;

  /* Shared infrastructure. Reused from `core`, never duplicated. */
  readonly clock: Clock;
  readonly audit: AuditSink;
  readonly providers: ProviderRegistry;
  readonly modelRegistry: ModelRegistry;
  readonly router: ProviderRouter;

  /* Governance: one engine, one gate, one recorder, one history. */
  readonly policy: PolicyEngine;
  readonly governance: GovernanceGate;
  readonly governanceRecorder: GovernanceRecorder;
  readonly security: SecurityDecisionLog;

  /* Routing. */
  readonly modelRouter: ModelRouter;

  /* Agent lifecycle. */
  readonly agents: AgentRegistry;
  readonly capabilities: CapabilityRegistry;
  /**
   * PHASE 09: the ONE skill registry.
   *
   * Platform-scoped, like `capabilities` and `adapters`: a skill DECLARATION is deployment
   * configuration. The ACTIVITY is not, which is why the registry is constructed with a sink
   * that writes into this runtime's audit trail rather than keeping a log of its own - the
   * partitioned trail is where "who loaded what, in which workspace" belongs, and a private
   * in-registry log would be one answer to that question living outside the partition.
   */
  readonly skills: SkillRegistry;
  readonly pool: SpecialistPool;
  readonly adapters: AdapterRegistry;
  readonly providerAdapters: ProviderAdapterRegistry;
  readonly ingestor: AgentIngestor;
  readonly workers: TaskWorkerRegistry;

  /* Memory. */
  readonly memory: MemoryProvider;
  readonly memoryPolicy: MemoryAccessPolicy;
  /**
   * PHASE 06. `null` when the runtime was told no workspace.
   *
   * A memory store is workspace-keyed, so there is no honest way to compose one
   * without a partition. `null` here is the loud statement that this deployment
   * has no memory, rather than a store writing into a shared bucket.
   */
  readonly memoryStore: MemoryStore | null;
  /** `null` for the same reason as `memoryStore`. */
  readonly retrieval: RetrievalEngine | null;
  readonly writePolicy: DefaultWritePolicy;
  readonly learning: LearningEventStore | null;
  readonly memoryService: MemoryService | null;

  /* Tools, verification, feedback, observability. */
  readonly tools: ToolRegistry;
  readonly toolHost: ToolExecutionHost;
  readonly verification: VerificationRunner;
  readonly feedback: InMemoryFeedbackStore;
  readonly traces: TraceRecorder;
  readonly resources: ResourceTracker;
  readonly drift: DriftGuard;

  /* Execution. */
  readonly orchestrator: TozOrchestrator;
  readonly taskExecutor: OrchestratorTaskExecutor;
  readonly coordinator: ExecutionCoordinator;

  /** What is actually wired, measured now. */
  describe(): RuntimeDescription;
  /**
   * PHASE 05: what is actually wired, measured by ASKING.
   *
   * `describe()` is synchronous and reports structure: how many adapters are
   * registered, how many tools exist. Neither answers "can this adapter run right
   * now", which is a different question with a different answer - an adapter can be
   * registered and have no transport behind it. `AgentAdapter.isAvailable()` exists
   * and had **zero callers in `src/`**, so the question was never asked and the CLI
   * printed the adapter's registered NAME where a reader reasonably reads an
   * availability: `agent adapters  unavailable` was the name of the shipped adapter,
   * not a measurement of anything.
   *
   * So availability is probed here, and the CLI prints the answer rather than the
   * name. A name is not a measurement, and a coincidence between a name and a state
   * is the kind of thing that hides a real regression.
   */
  probe(): Promise<RuntimeProbe>;
}

/** One adapter's answer to "can you run right now". */
export interface AdapterAvailability {
  readonly name: string;
  readonly available: boolean;
}

/**
 * The asynchronous half of the runtime's self-report.
 *
 * Separate from `RuntimeDescription` rather than folded into it, because folding it
 * in would mean making `describe()` a promise - and a boot check that cannot be read
 * synchronously is a boot check that gets skipped.
 */
export interface RuntimeProbe {
  readonly agentAdapterAvailability: readonly AdapterAvailability[];
}

/* -------------------------------------------------------------------------- */
/* The one approval authority, seen from the seam                               */
/* -------------------------------------------------------------------------- */

/**
 * PHASE 03 (B-10): the composition root's read-only view of the approval registry.
 *
 * This is the whole of the answer to "a governance-configured approval cannot be
 * satisfied", and it is deliberately small.
 *
 *   BEFORE:  `ApprovalRule` stated a requirement. Nothing could ever answer it, so
 *            every job that used `governance.approvalRequired` failed permanently
 *            with `approval_required` - fail-closed, and unusable.
 *   AFTER:   the rule asks this port, and the answer comes from the PHASE 07
 *            registry the coordinator already owns. No second registry, no second
 *            approval record, and no verb through which a rule could decide.
 *
 * WHY THE BINDING IS LATE. The registry lives inside the coordinator, and the
 * coordinator is built after the policy engine - because the engine is what the
 * orchestrator needs and the orchestrator is built first. So the port is created
 * empty and bound once the registry exists. Before it is bound it answers nothing,
 * which is the fail-closed direction rather than a crash: an un-wired observer makes
 * an approval requirement stricter, never weaker.
 */
class RecordedApprovals implements ApprovalGateObserver {
  #registry: ApprovalRegistry | null = null;

  /** The composition root calls this exactly once, immediately after constructing the coordinator. */
  public bind(registry: ApprovalRegistry): void {
    this.#registry = registry;
  }

  public get wired(): boolean {
    return this.#registry !== null;
  }

  public observedApproval(input: { readonly jobId: string | null; readonly taskId: string | null }): RecordedApproval | null {
    const registry = this.#registry;
    if (registry === null || input.jobId === null || input.taskId === null) {
      return null;
    }
    // Job AND task, never the task alone. A task id is unique only within a job.
    const gate = registry.forTask(input.jobId, input.taskId);
    if (gate === null) {
      return null;
    }
    return {
      gateId: gate.gateId,
      state: gate.state,
      decidedBy: gate.decidedBy,
      decidedAt: gate.decidedAt,
    };
  }
}

/**
 * PHASE 03 (B-10): `bridgeApproval`'s gate port, bound to one job.
 *
 * The port is declared in governance as a two-verb question - "open a gate for this
 * task" and "what is the state of its gate" - because that is all governance is
 * allowed to ask. The coordinator's registry is keyed by JOB as well as task, so the
 * job is bound here rather than passed on every call: the bridge holds a port for
 * the attempt it is actually running, and cannot therefore ask about another job's
 * task even by accident.
 *
 * The returned object has no verb that could DECIDE a gate, so this seam can hold
 * the work and read the answer but can never grant approval itself.
 */
class JobApprovalGates {
  #coordinator: ExecutionCoordinator | null = null;

  /** The composition root calls this exactly once, immediately after constructing the coordinator. */
  public bind(coordinator: ExecutionCoordinator): void {
    this.#coordinator = coordinator;
  }

  public get wired(): boolean {
    return this.#coordinator !== null;
  }

  public forJob(jobId: string): ApprovalGatePort | null {
    const coordinator = this.#coordinator;
    // Nowhere to ask. `bridgeApproval` reads a null port as a refusal, which is
    // the strict reading: "no gate available" must never mean "no approval needed".
    return coordinator === null ? null : approvalGatesFor(coordinator, jobId);
  }
}

/**
 * PHASE 04: the ONE production implementation of governance's gate port.
 *
 * Exported, and for a reason rather than for convenience. `bridgeApproval` is the
 * function that turns a governance `REQUIRE_APPROVAL` into something a human can
 * answer, and PHASE 04 has to be able to prove it works for EVERY operation the
 * brief names - not only `workflow.execute`, which is the one a background job
 * happens to check. A test that built its own port would be proving that its own
 * fixture works; a test that calls this is proving the production path does.
 *
 * It is two delegations and nothing else, which is the shape worth asserting:
 * opening goes to `ExecutionCoordinator.openApproval`, which derives the binding
 * from the coordinator's own task record, and reading goes to the coordinator's
 * registry. There is no third operation here, and in particular no way to decide a
 * gate - which is why a governance rule can observe an approval and never produce
 * one.
 */
export function approvalGatesFor(coordinator: ExecutionCoordinator, jobId: string): ApprovalGatePort {
  return {
    openApproval: (input) => {
      const gate = coordinator.openApproval({ jobId, taskId: input.taskId, question: input.question, ...(input.expiresAtMs === undefined ? {} : { expiresAtMs: input.expiresAtMs }) });
      return { gateId: gate.gateId, state: gate.state };
    },
    forTask: (taskId) => {
      const gate = coordinator.approvals.forTask(jobId, taskId);
      return gate === null ? null : { gateId: gate.gateId, state: gate.state };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The bridge the workflow path was missing                                      */
/* -------------------------------------------------------------------------- */

/**
 * The single door from a background task to a real execution.
 *
 * `OrchestratorTaskExecutor` speaks `OrchestratorExecutionPort`; `TozOrchestrator`
 * speaks `OrchestrationRequest`. Nothing in the repository translated between
 * them, which is why the workflow layer had never been composed into anything:
 * `tests/workflow.integration.test.ts` could only wire the coordinator to a test
 * executor, because there was no production bridge to wire it to.
 *
 * This class is that translation, and it is deliberately thin. It chooses no
 * provider, no agent, no topology and no policy: it maps a request onto a request
 * and a result onto a result, and every decision that follows is made by the
 * authority that owns it.
 *
 * It carries `securityContext` because the port has nowhere to carry it. PHASE 03
 * added a second source for it: the identity the JOB was submitted with, which
 * takes precedence over the principal the runtime declared for background work.
 * With neither the bridge passes nothing, the gate refuses, and the task fails
 * visibly. It does not fall back to the orchestrator's own identity: a worker
 * executing as an unnamed service account is how "who authorised this?" becomes
 * unanswerable.
 *
 * PHASE 03 (B-10) GAVE IT THE THIRD JOB: it is the ONLY call site of
 * `bridgeApproval`, and the only place in `src/` that can see both the governance
 * verdict and the approval registry. When the orchestrator refuses with
 * `approval_required`, this bridge turns that verdict into an open gate on the
 * coordinator's own registry, so a human is asked instead of the job being failed.
 */
class RuntimeExecutionBridge implements OrchestratorExecutionPort {
  readonly #orchestrator: TozOrchestrator;
  readonly #serviceContext: SecurityContext | null;
  readonly #governance: GovernanceGate | null;
  readonly #gates: JobApprovalGates;

  public constructor(
    orchestrator: TozOrchestrator,
    serviceContext: SecurityContext | null,
    governance: GovernanceGate | null,
    gates: JobApprovalGates,
  ) {
    this.#orchestrator = orchestrator;
    this.#serviceContext = serviceContext;
    this.#governance = governance;
    this.#gates = gates;
  }

  public async execute(request: {
    taskId: string;
    objective: string;
    input: string;
    requiredCapabilities: readonly string[];
    minimumTrust: string;
    readonly verificationKinds?: readonly string[];
    /** PHASE 03 (B-08): the job's caller, when it recorded one. */
    readonly securityContext?: SecurityContext;
    /** PHASE 03 (B-10): the job this attempt belongs to. */
    readonly jobId?: string;
    /**
     * PHASE 11: the workflow side's correlation id, forwarded so the orchestrator adopts it
     * rather than minting a second trace. Without this the two halves of one job shared no
     * identifier and `byTrace()` could not cross the boundary.
     */
    readonly traceId?: string;
    signal: AbortSignal;
  }): Promise<{
    succeeded: boolean;
    output: string;
    providerId: string | null;
    modelId: string | null;
    traceId: string | null;
    verificationVerdict: "pass" | "fail" | "needs_review" | null;
    errorClass: ErrorClass;
    reason: string;
    cost: {
      inputTokens: number | null;
      outputTokens: number | null;
      latencyMs: number | null;
      amount: number | null;
      currency: string | null;
    } | null;
  }> {
    // PHASE 03 (B-08): WHO is executing, in two steps and in this order.
    //
    //   1. the identity the job recorded when it was submitted - the party whose
    //      work an approval would be accepting, so it is the one that must reach
    //      the authorization boundary;
    //   2. otherwise the principal the runtime declared for background work.
    //
    // Null when neither exists, in which case nothing is attached and the gate
    // refuses. It does not fall back to the orchestrator's own identity: a worker
    // executing as an unnamed service account is how "who authorised this?"
    // becomes unanswerable.
    const claimed: SecurityContext | null = request.securityContext ?? this.#serviceContext;
    // PHASE 03 (B-10): and WHICH job. Stamped from the port request, which the
    // coordinator fills from the job record it owns, and OVERWRITES anything the
    // submitter put on the context - so the (job, task) pair governance resolves a
    // recorded approval against is a fact rather than a claim. No job on the
    // request means no pair, and the rule then requires approval.
    const identity: SecurityContext | null =
      claimed === null || request.jobId === undefined
        ? claimed
        : inJobScope(claimed, { jobId: request.jobId, taskId: request.taskId });
    const orchestration: OrchestrationRequest = {
      taskId: request.taskId,
      objective: request.objective,
      input: request.input,
      requiredCapabilities: request.requiredCapabilities,
      taskType: "workflow",
      minimumTrust: request.minimumTrust as OrchestrationRequest["minimumTrust"],
signal: request.signal,
        // PHASE 11: one trace across the boundary. Omitted entirely when absent so a caller
        // that has no correlation id gets the orchestrator's own minted trace, unchanged.
        ...(request.traceId === undefined ? {} : { traceId: request.traceId }),
        ...(request.verificationKinds === undefined ? {} : { verificationKinds: request.verificationKinds }),
      ...(identity === null ? {} : { securityContext: identity }),
    };

    let result: Result<OrchestrationResult, OrchestratorError>;
    try {
      result = await this.#orchestrator.execute(orchestration);
    } catch (error) {
      // A thrown error on an execution path is a bug in the authority, not a
      // refusal. It is still reported as a failure, because a task that reaches the
      // coordinator with no outcome would be retried forever.
      return {
        succeeded: false,
        output: "",
        providerId: null,
        modelId: null,
        traceId: null,
        verificationVerdict: null,
        errorClass: "unknown",
        reason: error instanceof Error ? error.message : String(error),
        cost: null,
      };
    }

    if (!result.ok) {
      return {
        succeeded: false,
        output: "",
        providerId: null,
        modelId: null,
        traceId: null,
        verificationVerdict: null,
        errorClass: result.error.errorClass,
        reason: result.error.message,
        cost: null,
      };
    }

    const value = result.value;
    // PHASE 03 (B-10): THE CALL SITE. `approval_required` is not a failure to
    // report, it is a question to put to a human, and this is the only place in
    // `src/` that holds both halves: the governance verdict and the approval
    // registry. Before this existed the requirement was stated and nothing could
    // ever answer it, so the setting failed every job that used it.
    if (value.errorClass === "approval_required") {
      const held = this.#holdForApproval(value, request.jobId, request.taskId);
      if (held !== null) {
        return held;
      }
    }
    return {
      succeeded: value.outcome === "succeeded",
      output: value.output,
      providerId: value.provider,
      modelId: value.model,
      traceId: value.traceId,
      verificationVerdict: value.verification === null ? null : value.verification.verdict,
      // `null` here means the failure was never classified - a cancellation, or a
      // refusal that produced no class. It is reported as `unknown` rather than
      // guessed at, and `unknown` is a class the default retry policy does NOT
      // retry, which is the safe direction for a failure of unknown cause.
      errorClass: value.errorClass ?? "unknown",
      reason: value.reason,
      // Cost is passed through as measured or null. A budget reads these numbers,
      // so a missing measurement must never become a zero.
      cost:
        value.evidence === null
          ? null
          : {
              inputTokens: value.evidence.cost.inputTokens,
              outputTokens: value.evidence.cost.outputTokens,
              latencyMs: value.evidence.cost.durationMs,
              amount: value.evidence.cost.amount,
              currency: value.evidence.cost.currency,
            },
    };
  }

  /**
   * Turns governance's REQUIRE_APPROVAL into an open gate, or into nothing.
   *
   * Returns the outcome to report, or null to fall through to the ordinary failure
   * report. Null is the FAIL-CLOSED answer in three distinct situations, and each
   * one is deliberate:
   *
   *   - no job on the request: there is nothing to bind a gate to, and a gate keyed
   *     on a task id with no job is the PHASE 10 cross-job hazard;
   *   - no recorded decision: the engine holds no REQUIRE_APPROVAL for this task, so
   *     there is no verdict to bridge and nothing may be invented in its place;
   *   - `proceed` or `denied`: `proceed` means a gate already says approved while
   *     governance still refused, which is a disagreement between two authorities
   *     and must never be resolved in favour of running the work.
   */
  #holdForApproval(
    value: OrchestrationResult,
    jobId: string | undefined,
    taskId: string,
  ): {
    succeeded: false;
    output: string;
    providerId: string | null;
    modelId: string | null;
    traceId: string | null;
    verificationVerdict: "pass" | "fail" | "needs_review" | null;
    errorClass: ErrorClass;
    reason: string;
    cost: null;
  } | null {
    const governance = this.#governance;
    if (governance === null || jobId === undefined) {
      return null;
    }
    // The decision GOVERNANCE MADE, read from the engine's own record. Re-deciding
    // here would be a second decision point, and synthesising one from the error
    // class would be a decision nobody took.
    const decision = governance.approvalRequiringFor(taskId);
    if (decision === null) {
      return null;
    }
    const outcome = bridgeApproval({
      decision,
      gates: this.#gates.forJob(jobId),
      jobId,
      taskId,
    });
    if (outcome.action !== "blocked") {
      return null;
    }
    return {
      succeeded: false,
      output: "",
      providerId: null,
      modelId: null,
      // The refused run's own trace, so the two halves join in the audit trail
      // rather than leaving a gate with no visible origin.
      traceId: value.traceId,
      verificationVerdict: null,
      // Still `approval_required`, and that is the signal the coordinator reads: it
      // looks for a gate it owns and holds the task - and it can only do that
      // because `openApproval` above put the gate in its own registry.
      errorClass: "approval_required",
      reason: `${value.reason} ${outcome.detail}`,
      cost: null,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* The reference rule set                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The rules a runtime gets when it names none.
 *
 * Ordered ALLOW-then-DENY on purpose: `PolicyEngine` returns the first non-ALLOW
 * verdict it meets, so permitting rules run first and a single refusal still ends
 * the evaluation. A set that started with a refusing rule would let that rule veto
 * operations it has no business examining.
 *
 * `KnownActorRule`'s predicate is the weakest honest answer, because no identity
 * provider ships here: an actor is "known" if it is named. `createSecurityContext`
 * refuses an unnamed actor outright, and `GrantRule` refuses anyone holding no
 * grant, so the real authority remains the grant rather than this predicate. A
 * deployment with a real directory supplies `knownActors`.
 *
 * PHASE 03 (P3-4): `approvalRequired` is finally CONSTRUCTED into an
 * `ApprovalRule`.
 *
 * `governance.approvalRequired` ships as `["approval.resolve",
 * "admin.configure"]`, is validated against the real operation names, is
 * settable through `TOZ_GOVERNANCE_APPROVAL_REQUIRED` - and was read by nothing.
 * `ApprovalRule` existed and was never built, so a configuration that said "this
 * operation always needs a human" changed nothing: the fail-open shape C-1
 * through C-4 all had, in configuration instead of code.
 *
 * `ApprovalRule` is LAST on purpose. The engine returns the first non-ALLOW
 * verdict, so a caller holding no grant is DENIED by `GrantRule` rather than
 * deferred for approval - an approval cannot upgrade a refusal - and
 * `ApprovalResolverRule` still refuses self-approval outright before the
 * configured list is ever consulted. Only when nothing else has an opinion does
 * the configured list turn an operation into `REQUIRE_APPROVAL`.
 *
 * Operation names that are not real operations are dropped rather than handed to
 * the engine, which would answer `malformed` for the whole request: a typo in an
 * environment variable must not disable authorization.
 *
 * PHASE 03 (B-10): `observer` is how a configured requirement becomes ANSWERABLE.
 *
 * The rule used to state the requirement and nothing could ever satisfy it. It now
 * asks this read-only port, which the composition root backs with the one registry
 * that records approvals. Omitting it - as any other caller of this function may -
 * restores the previous fail-closed behaviour exactly, which is the point: the
 * port is what makes the requirement satisfiable, and nothing else about the rule
 * changed.
 */
export function referenceGovernanceRules(
  known: (actor: string) => boolean,
  approvalRequired: readonly string[] = [],
  observer: ApprovalGateObserver | null = null,
): readonly GovernanceRule[] {
  const configured = approvalRequired.filter(isOperation);
  return [
    new KnownActorRule(known),
    new GrantRule(),
    new TrustFloorRule(),
    new ResourceAllowListRule(),
    new CapabilityRule(),
    new ScopeRule(),
    new ApprovalResolverRule(),
    new ApprovalRule(configured, observer),
  ];
}

/* -------------------------------------------------------------------------- */
/* The factory                                                                   */
/* -------------------------------------------------------------------------- */

export function createRuntime(options: RuntimeOptions = {}): Runtime {
  const config = options.config ?? DEFAULT_ORCHESTRATION_CONFIG;
  const clock = options.clock ?? systemClock;

  // PHASE 06. Read ONCE, at the top, before anything is constructed.
  //
  // This is the ordering that matters: a partitioned registry takes its workspace in
  // its constructor, so the value has to exist before the first one is built. Reading
  // `options.workspace` lazily at each construction site would be equivalent today and
  // wrong the moment a construction site is reordered or a registry is added to an
  // earlier branch - the failure being a registry that silently lands in the
  // unattributed partition, which is invisible until a cross-workspace read comes
  // back empty.
  const workspace = options.workspace ?? null;

  // The core is built FIRST and everything else reuses it. A second provider
  // registry would mean two answers to "which providers exist", which is the failure
  // `createCore` exists to prevent and the reason routing cannot otherwise be
  // reasoned about.
  const core = createCore({
    ...(options.appConfig === undefined ? {} : { config: options.appConfig }),
    clock,
    ...(options.ids === undefined ? {} : { ids: options.ids }),
    ...(options.audit === undefined ? {} : { audit: options.audit }),
    ...(options.knowledge === undefined ? {} : { knowledge: options.knowledge }),
    // PHASE 06: reaches the queue, the state store and the default audit log. Read
    // BEFORE `createCore` for the same reason as the registries below - a value that
    // has to be threaded to some constructions and not others is a value that will
    // eventually be threaded to the wrong subset.
    workspace,
  });
  const audit = core.audit;
  const traces = new TraceRecorder(audit);
  const resources = new ResourceTracker();
  const security = new SecurityDecisionLog();
  const feedback = new InMemoryFeedbackStore({ workspace });
  const drift = new DriftGuard();

  /* ---- governance: ONE engine, ONE gate, ONE recorder, ONE history -------- */

  // PHASE 03 (B-10): created before the engine and bound after the coordinator,
  // because the registry it observes lives inside the coordinator and the
  // coordinator needs the orchestrator, which needs the engine. Un-bound it answers
  // nothing, which makes an approval requirement stricter rather than weaker.
  const recordedApprovals = new RecordedApprovals();
  const jobApprovalGates = new JobApprovalGates();

  const policy = new PolicyEngine({
    rules:
      options.rules ??
      referenceGovernanceRules(
        options.knownActors ?? (() => true),
        config.governance.approvalRequired,
        recordedApprovals,
      ),
    clock,
    deferToSubsystem: config.governance.deferToSubsystem as never,
  });
  // The recorder is constructed FIRST and handed to the gate, so the engine that
  // records decisions is the same engine the gate answers from. When a recorder is
  // present the gate delegates every decision to it, which means a gate that built
  // its own engine would hold an engine whose verdicts nothing ever consulted.
  const governanceRecorder = new GovernanceRecorder({ engine: policy, traces, clock });
  const governance = new GovernanceGate(
    {
      engine: policy,
      recorder: governanceRecorder,
      clock,
      // PHASE 03 (B-08): STAMPED, not merely forwarded.
      //
      // `identity.resolve` returns an ordinary context built by
      // `createSecurityContext`, so it arrives marked `asserted` - and a runtime
      // that consulted its own identity source has established who the caller is,
      // which is a different fact. Marking it HERE, at the one seam that knows the
      // answer was resolved rather than claimed, is what lets a decision read the
      // provenance without reading the call site. `withProvenance` copies; it does
      // not touch a single grant.
      resolveContext: (input) => {
        const resolved = options.identity?.resolve(input);
        return resolved === null || resolved === undefined
          ? null
          : attachWorkspace(withProvenance(resolved, "resolved"), workspace);
      },
    },
    options.restrictions ?? new Map<string, RoutingRestriction>(),
  );

  /* ---- routing: the real router over the core registries ------------------ */

  const modelRouter = new ModelRouter({
    providers: core.providers,
    models: core.models,
    router: core.router,
    clock,
    policy: config.routing.defaultPolicy,
  });

  /* ---- agent lifecycle ---------------------------------------------------- */

  const agents = new AgentRegistry({ clock, workspace });
  const capabilities = new CapabilityRegistry();
  // PHASE 09: the one skill registry, with its load sink pointed at the audit trail.
  //
  // The sink is what makes "an audit record for EVERY load" true rather than aspirational:
  // the registry treats its sink as optional so a caller with nowhere to send records is not
  // forced to invent one, which means the requirement is only satisfied if the COMPOSITION
  // ROOT wires it. Both outcomes are recorded, and a refusal carries the reason - because the
  // entry worth having is the one that was refused.
  const skills = new SkillRegistry({
    clock,
    sink: (record: SkillLoadRecord) => {
      traces.record(
        record.outcome === "loaded" ? "skill_loaded" : "skill_load_refused",
        {
          traceId: `skill-${record.skillId}`,
          taskId: record.skillId,
          parentTaskId: null,
          teamId: null,
        },
        {
          agentId: null,
          provider: null,
          model: null,
          durationMs: null,
          errorClass: null,
          skillId: record.skillId,
          version: record.version,
          workspace: record.workspace,
          outcome: record.outcome,
          refusal: record.refusal,
          reason: record.reason,
          missing: record.missing,
        },
        new Date(record.at),
      );
    },
  });
  // Candidates come from the registry, with each version's own lifecycle, so the
  // pool sees exactly what the registry believes and cannot become a second one.
  const pool = new SpecialistPool({
    candidates: () => agents.list().map((entry) => ({ agent: entry.record, lifecycle: entry.lifecycle })),
    maximumSelectedAgents: config.agent.maxSelectedAgents,
    // PHASE 08: this read `config.agent.defaultMinimumTrust`, which is a different
    // question - the floor used when a task states none. The pool refuses a request whose
    // floor is ABOVE this, so with the shipped default of "low" every task asking for
    // `standard` or more was refused outright. The two settings now have two fields.
    maximumTrustFloor: config.agent.maximumTrustFloor,
  });
  const adapters = new AdapterRegistry();
  const suppliedAdapters = options.adapters ?? [];
  // Always at least one adapter, so a runtime with no backend starts and says so
  // rather than failing to construct or - far worse - pretending it can execute.
  const adapterList = suppliedAdapters.length > 0 ? suppliedAdapters : [new UnavailableAgentAdapter()];
  for (const adapter of adapterList) {
    const registered = adapters.register(adapter);
    if (!registered.ok) {
      throw new Error(`Runtime could not register the agent adapter "${adapter.name}": ${registered.error.message}`);
    }
  }
  const providerAdapters = new ProviderAdapterRegistry();
  for (const adapter of options.providerAdapters ?? []) {
    const registered = providerAdapters.register(adapter);
    if (!registered.ok) {
      throw new Error(`Runtime could not register the provider adapter "${adapter.providerId}": ${registered.error.message}`);
    }
  }
  const ingestor = new AgentIngestor({
    agents,
    capabilities,
    maximumTrustLevel: config.agents.maximumExternalTrust,
    // Off unless configuration says otherwise. Promotion is a trust decision; baking
    // it into ingestion would let a source grant itself availability.
    promoteToAvailable: config.agents.autoPromote,
    // PHASE 11: ingestion is the only path by which an agent this repository did not write
    // becomes reachable, so it is recorded. The `onIngested` port keeps `AgentIngestor` free of
    // any dependency on the observability vocabulary; this is where the two meet.
    onIngested: (record) => {
      traces.record(
        "agent_source_ingested",
        { traceId: `ingest-${record.agentId || record.source}`, taskId: record.agentId || record.source, parentTaskId: null, teamId: null },
        {
          agentId: record.agentId === "" ? null : record.agentId,
          version: record.version === "" ? null : record.version,
          source: record.source,
          status: record.status,
          trustLevel: record.trustLevel,
          promotedToAvailable: record.promotedToAvailable,
          refused: record.refused,
        },
        clock.now(),
      );
    },
    clock,
  });
  const workers = new TaskWorkerRegistry();

  /* ---- memory ------------------------------------------------------------- */

  const memoryEnabled = config.memory.enabled;
  const memory: MemoryProvider = memoryEnabled
    ? (options.memory ?? new InMemoryMemoryProvider())
    : // Disabled means grants nothing, not "unconfigured and therefore empty".
      new DisabledMemoryProvider();
  const memoryPolicy = new MemoryAccessPolicy(clock);
  const writePolicy = new DefaultWritePolicy({
    minimumImportance: config.memory.minimumImportance,
    importanceCeiling: config.memory.importanceCeiling,
  });
  /**
   * PHASE 06. The workspace this runtime serves, or `null` when it has not been
   * told.
   *
   * `null` is a REAL STATE and not a default to be papered over: a memory store is
   * workspace-keyed, so a store with no workspace would have to invent one, and the
   * only value available to invent is "shared" - which is the classification D
   * failure this phase exists to remove. So with no workspace declared the runtime
   * composes NO memory store, NO retrieval engine and NO memory service, and
   * `describe().workspaceIsolation` reports `"unasserted"`. That is the loud
   * version of "never silent": a deployment that wants memory declares where it is.
   */
  const memoryStore = workspace === null ? null : new MemoryStore({ provider: memory, clock, workspace });
  const retrieval =
    memoryStore === null
      ? null
      : new RetrievalEngine(memoryStore, {
          clock,
          recencyHalfLifeMs: config.memory.recencyHalfLifeMs,
          ...(options.embeddings === undefined ? {} : { embeddings: options.embeddings }),
        });
  const learning = config.memory.recordLearning ? new LearningEventStore({ clock, ids: options.ids }) : null;
  const memoryService =
    memoryEnabled && memoryStore !== null && retrieval !== null
      ? new MemoryService({
          store: memoryStore,
          retrieval,
          policy: writePolicy,
          ...(learning === null ? {} : { learning }),
          access: memoryPolicy,
          traces,
          clock,
          recordLearning: config.memory.recordLearning,
        })
      : null;

  /* ---- tools, verification ------------------------------------------------ */

  const tools = new ToolRegistry({ clock, workspace });
  const invokers = options.toolInvokers ?? {};
  const toolHost = new ToolExecutionHost({ registry: tools, invokers, defaultTimeoutMs: config.tools.defaultTimeoutMs });
  const verification = new VerificationRunner();
  const verifiers = options.verifiers ?? [new EvidenceIntegrityVerifier()];
  for (const verifier of verifiers) {
    const registered = verification.register(verifier);
    if (!registered.ok) {
      throw new Error(`Runtime could not register the "${verifier.kind}" verifier: ${registered.error.message}`);
    }
  }

  /* ---- the authority ------------------------------------------------------ */

  const enforced = config.governance.enforced;
  const orchestrator = new TozOrchestrator({
    agents,
    capabilities,
    pool,
    models: modelRouter,
    // Always supplied, even empty: with an empty registry `providerAdapters.has()`
    // is false for every route, which turns "this route has nothing behind it" into
    // a classified failure instead of a claim in the evidence.
    providerAdapters,
    providerIds: () => core.providers.list().map((provider) => provider.providerId),
    tools,
    // PHASE 05: the ONE tool authority, the same instance the runtime exposes.
    // Before this the host was constructed here and called from nowhere, so a tool
    // call an adapter reported was recorded as evidence without ever passing an
    // authorisation check. The orchestrator refuses a host that does not share this
    // registry, so the two cannot drift apart.
    toolHost,
    verification,
    memory,
    memoryPolicy,
    // The gate is installed by DEFAULT. Its absence is a deployment's explicit
    // choice, not the shape of the code - and with it absent, an unidentified caller
    // is permitted, which is the exact fail-open this project exists to remove.
    governance: enforced ? governance : undefined,
    feedback,
    traces,
    resources,
    drift,
    security,
    inputPolicy: inputPolicyFor(config.security.inputPolicy),
    outputPolicy: outputPolicyFor(config.security.outputPolicy),
    adapters,
    team: {
      maxConcurrency: config.agent.maxSelectedAgents,
      subtaskTimeoutMs: config.agent.subtaskTimeoutMs,
    },
    clock,
    ...(options.ids === undefined ? {} : { ids: options.ids }),
    ...(memoryService === null ? {} : { memoryService }),
    // Scoped recall, never implicit. Empty means NO recall, which is what
    // `OrchestratorOptions.recallScopes` already documents and what keeps a
    // deployment from holding a standing read grant nobody asked for.
    recallScopes: recallScopesOf(config.memory.recallScopes),
    recallLimit: config.memory.recallLimit,
    memoryScope: memoryScopeOf(config.memory.executionScope),
    // PHASE 08: the configured default floor, so `agent.defaultMinimumTrust` reaches the
    // three sites that used to hardcode "low".
    defaultMinimumTrust: config.agent.defaultMinimumTrust,
  });

  /* ---- durable jobs: coordinator -> task executor -> the authority --------- */

  /**
   * PHASE 06. The service identity, reconciled with the declared workspace on the
   * same three-case rule as `attachWorkspace`, and stamped `"resolved"`.
   *
   * A deployment states that its background service identity is resolved; nothing
   * in this repository can verify that, and B-05 is open. What is verified here is
   * the narrower and checkable property: the workspace it runs in is the one this
   * runtime declared, so background work cannot be routed into a partition the
   * deployment did not configure.
   */
  const declaredServiceContext = (() => {
    const supplied = options.identity?.serviceContext ?? null;
    if (supplied === null) {
      return null;
    }
    const stamped = withProvenance(supplied, "resolved");
    return attachWorkspace(stamped, workspace);
  })();
  const serviceContext = declaredServiceContext;
  const taskExecutor = new OrchestratorTaskExecutor(
    // The governance gate is handed over as well, because bridging a verdict into a
    // gate needs BOTH authorities and this bridge is the only object that sees both.
    // It is the same gate instance the orchestrator authorizes against, so the
    // decision it reads is the decision that was just made.
    new RuntimeExecutionBridge(orchestrator, serviceContext, enforced ? governance : null, jobApprovalGates),
    {
      ...(options.ids === undefined ? {} : { ids: options.ids }),
    },
  );
  const coordinator = new ExecutionCoordinator({
    executor: taskExecutor,
    traces,
    clock,
    // PHASE 06: the coordinator partitions its jobs, tasks, claims, checkpoints and
    // approval gates by this. It also passes it DOWN to ClaimRegistry,
    // CheckpointStore and ApprovalRegistry, which are the three that were keying by
    // the two-argument `taskKey` and therefore sharing one entry per job/task id.
    workspace,
    // PHASE 03 (B-05): the runtime's own declaration of what executes background
    // work, so `decideApproval` can refuse it as the executor it is. Read from the
    // same `serviceContext` the bridge uses, so the two can never disagree.
    servicePrincipal: serviceContext,
    maxConcurrency: config.workflow.maxConcurrency,
    defaultMaxAttempts: config.workflow.defaultMaxAttempts,
    defaultTimeoutMs: config.workflow.defaultTimeoutMs,
    claimTtlMs: config.workflow.claimTtlMs,
    backoffBaseMs: config.workflow.backoffBaseMs,
    backoffMaxMs: config.workflow.backoffMaxMs,
  });

  // PHASE 03 (B-10): NOW the two halves can see each other, and both are bound to
  // the ONE registry the coordinator already owns. There is no second approval
  // record anywhere in this runtime, and `describe()` says which authority it is.
  recordedApprovals.bind(coordinator.approvals);
  jobApprovalGates.bind(coordinator);

  /* ---- the startup record, and the measurement ---------------------------- */

  // The advisory downgrade is written down. A control plane that a deployment
  // silently turned off must be visible to whoever reads the history next, because
  // "governance is on" and "governance is installed but advisory" are different
  // systems and the difference is invisible until it is needed.
  traces.record(
    "runtime_started",
    { traceId: "runtime", taskId: "runtime", parentTaskId: null, teamId: null },
    {
      governance: enforced ? "enforced" : "advisory",
      governanceOnExecutionPath: enforced,
      governanceRules: policy.ruleNames,
      identityResolver: options.identity === undefined ? "absent" : "supplied",
        workflowExecution: serviceContext === null ? "refused" : "wired",
        approvalBridge: recordedApprovals.wired && jobApprovalGates.wired ? "wired" : "unwired",
        approvalAuthority: "workflow-registry",
        approvalDurability: coordinator.approvals.durability,
        approvalRedrive: "caller-owned",
        humanApprovalOperations: OPERATIONS.filter(isHumanApprovalOperation),
        approvalRequiredOperations: [...config.governance.approvalRequired],
        agentAdapters: adapters.names(),
      providers: core.providers.list().length,
      agents: agents.size,
      recallScopes: config.memory.recallScopes,
      ...(enforced
        ? {}
        : {
            advisoryWarning:
              "orchestration.governance.enforced is false, so a governance DENY does not stop work on the execution path",
          }),
    },
    clock.now(),
  );

  const runtime: Runtime = {
    config,
    app: core.config,
    core,
    clock,
    audit,
    providers: core.providers,
    modelRegistry: core.models,
    router: core.router,
    policy,
    governance,
    governanceRecorder,
    security,
    modelRouter,
    agents,
    capabilities,
    // PHASE 09: exposed so a deployment can install and load skills. Nothing composes a
    // skill by default, and the registry confers nothing when asked to.
    skills,
    pool,
    adapters,
    providerAdapters,
    ingestor,
    workers,
    memory,
    memoryPolicy,
    memoryStore,
    retrieval,
    writePolicy,
    learning,
    memoryService,
    tools,
    toolHost,
    verification,
    feedback,
    traces,
    resources,
    drift,
    orchestrator,
    taskExecutor,
    coordinator,
    describe(): RuntimeDescription {
      return {
        governance: enforced ? "enforced" : "advisory",
        governanceOnExecutionPath: enforced,
        governanceRules: policy.ruleNames,
        identityResolver: options.identity === undefined ? "absent" : "supplied",
        serviceContext: serviceContext === null ? "absent" : "supplied",
        workflowExecution: serviceContext === null ? "refused" : "wired",
        approvalBridge: recordedApprovals.wired && jobApprovalGates.wired ? "wired" : "unwired",
        approvalAuthority: "workflow-registry",
        approvalDurability: coordinator.approvals.durability,
        approvalRedrive: "caller-owned",
        humanApprovalOperations: OPERATIONS.filter(isHumanApprovalOperation),
        approvalRequiredOperations: [...config.governance.approvalRequired],
        providers: core.providers.list().length,
        models: core.models.list().length,
        providerAdapters: providerAdapters.size,
        agents: agents.size,
        agentAdapters: adapters.names(),
        // PHASE 10: reported, not implied. See the field's doc — the "not-consulted" half is
        // what makes this field worth having.
        knowledge: options.knowledge === undefined ? "unattached" : "attached-not-consulted",
        // PHASE 09: what the skill registry holds, and — the part a deployer actually needs —
        // that it confers nothing. A count alone would leave open whether installing a skill
        // widened anyone's reach, and the answer is no, structurally.
        skills: skills.size,
        skillAuthority: "declares-only",
        verifiers: verification.kinds(),
        tools: tools.size,
        toolInvokers: Object.keys(invokers).length,
        toolTimeoutMs: toolHost.defaultTimeoutMs,
        // PHASE 05. Two facts a deployer cannot otherwise see, both of which were
        // previously invisible rather than absent.
        toolApproval: "required-and-unobtained",
        agencyAdapterComposed: false,
        memory: !memoryEnabled ? "disabled" : options.memory === undefined ? "in_memory" : "supplied",
        memoryService: memoryService !== null,
        memoryMinimumImportance: writePolicy.minimumImportance,
        learning: learning !== null,
        recallScopes: [...config.memory.recallScopes],
        autoPromote: config.agents.autoPromote,
        workflowMaxConcurrency: config.workflow.maxConcurrency,
        coordinatorMaxConcurrency: coordinator.maxConcurrency,
        selectionOrder: modelRouter.selectionOrder,
        fallbackPolicy: modelRouter.policy ?? config.routing.defaultPolicy,
        inputPolicy: config.security.inputPolicy,
        outputPolicy: config.security.outputPolicy,
        auditEvents: audit.read(auditScopeOf(workspace)).length,
        // Genuinely a constant: this build has no persistence substrate. The test
        // that scans this file for `node:fs` is what makes it honest rather than
        // hopeful.
        durableState: false,
        // PHASE 06. Measured, not a constant. See `workspaceIsolation`.
        workspaceIsolation: workspace === null ? "unasserted" : "partitioned",
        workspace: workspace?.workspace ?? null,
        brand: workspace?.brand ?? null,
        platformScopedRegistries: PLATFORM_SCOPED_REGISTRIES,
      };
    },

    async probe(): Promise<RuntimeProbe> {
      const names = adapters.names();
      const availability: AdapterAvailability[] = [];
      for (const name of names) {
        const adapter = adapters.get(name);
        if (adapter === null) {
          // A name with no adapter behind it is not available, and saying so is
          // better than omitting it: an absent entry reads as "not registered".
          availability.push({ name, available: false });
          continue;
        }
        try {
          availability.push({ name, available: await adapter.isAvailable() });
        } catch {
          // An adapter that throws when asked whether it can run cannot run.
          availability.push({ name, available: false });
        }
      }
      return { agentAdapterAvailability: availability };
    },
  };

  return runtime;
}

/* -------------------------------------------------------------------------- */
/* Bootstrap: the seam a service, a CLI or a worker will call                     */
/* -------------------------------------------------------------------------- */

export interface BootstrapOptions {
  /** The environment to read. Defaults to `process.env`. */
  readonly env?: OrchestrationEnv;
  /** Core settings. Defaults to the shipped core configuration. */
  readonly appConfig?: AppConfig;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly audit?: AuditSink;
  readonly knowledge?: KnowledgeProvider;
  readonly memory?: MemoryProvider;
  readonly adapters?: readonly AgentAdapter[];
  readonly providerAdapters?: readonly ProviderAdapter[];
  readonly toolInvokers?: Readonly<Record<string, ToolInvoker>>;
  readonly verifiers?: readonly Verifier[];
  readonly rules?: readonly GovernanceRule[];
  readonly restrictions?: ReadonlyMap<string, RoutingRestriction>;
  readonly knownActors?: (actor: string) => boolean;
  readonly embeddings?: EmbeddingProvider;
  readonly identity?: RuntimeIdentity;
}

/** Everything the validator rejected, so a caller can name each offending field. */
export class RuntimeConfigurationError extends Error {
  public readonly issues: readonly OrchestrationConfigIssue[];
  public constructor(issues: readonly OrchestrationConfigIssue[]) {
    super(
      `Runtime configuration was rejected:\n${issues.map((issue) => `  - ${issue.field}: ${issue.message}`).join("\n")}`,
    );
    this.name = "RuntimeConfigurationError";
    this.issues = [...issues];
  }
}

/**
 * Builds a runtime from the environment, and REFUSES a rejected configuration.
 *
 * The refusal is the point. `loadOrchestrationConfig` substitutes a default for
 * every value it could not use, which is the right behaviour for a library that
 * must not throw - but a deployment that set `TOZ_ROUTING_POLICY=nonsense` and got
 * a running system would have no way to tell that its setting was ignored. So
 * `bootstrapRuntime` validates first, reports every offending field, and starts
 * nothing.
 *
 * This is the function a future HTTP server, CLI or background worker calls. It
 * takes no transport and depends on nothing, so whichever of those arrives in a
 * later phase, the composition root does not change.
 */
export function bootstrapRuntime(options: BootstrapOptions = {}): Result<Runtime, RuntimeConfigurationError> {
  const env = options.env ?? (process.env);
  const raw = rawOrchestrationConfigFromEnv(env);
  const issues = validateOrchestrationConfig(raw);
  if (issues.length > 0) {
    return err(new RuntimeConfigurationError(issues));
  }
  return ok(
    createRuntime({
      config: loadOrchestrationConfig(raw),
      ...(options.appConfig === undefined ? {} : { appConfig: options.appConfig }),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.ids === undefined ? {} : { ids: options.ids }),
      ...(options.audit === undefined ? {} : { audit: options.audit }),
      ...(options.knowledge === undefined ? {} : { knowledge: options.knowledge }),
      ...(options.memory === undefined ? {} : { memory: options.memory }),
      ...(options.adapters === undefined ? {} : { adapters: options.adapters }),
      ...(options.providerAdapters === undefined ? {} : { providerAdapters: options.providerAdapters }),
      ...(options.toolInvokers === undefined ? {} : { toolInvokers: options.toolInvokers }),
      ...(options.verifiers === undefined ? {} : { verifiers: options.verifiers }),
      ...(options.rules === undefined ? {} : { rules: options.rules }),
      ...(options.restrictions === undefined ? {} : { restrictions: options.restrictions }),
      ...(options.knownActors === undefined ? {} : { knownActors: options.knownActors }),
      ...(options.embeddings === undefined ? {} : { embeddings: options.embeddings }),
      ...(options.identity === undefined ? {} : { identity: options.identity }),
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                                  */
/* -------------------------------------------------------------------------- */

function inputPolicyFor(name: string): InputPolicy {
  switch (name) {
    case "deny_all":
      return new DenyAllInputPolicy();
    case "heuristic":
      return new HeuristicInjectionInputPolicy();
    default:
      // Permissive is the shipped default and is NAMED as such rather than left to
      // look like protection that is not there.
      return new PermissiveInputPolicy();
  }
}

function outputPolicyFor(name: string): OutputPolicy {
  return name === "deny_all" ? new DenyAllOutputPolicy() : new PermissiveOutputPolicy();
}

/**
 * Keeps only scopes that exist, and says so by dropping them.
 *
 * A recall scope that does not exist is a grant that recalls nothing, which looks
 * exactly like memory being broken. The validator already reports an unknown scope
 * in `memory.recallScopes`, and this is the second half: the running system refuses
 * to hold a scope it cannot resolve.
 */
function recallScopesOf(scopes: readonly string[]): readonly MemoryScope[] {
  return scopes.filter(isAnyMemoryScope);
}

/** The scope execution records are written to, or `task` when the name is unknown. */
function memoryScopeOf(scope: string): MemoryScope {
  return isAnyMemoryScope(scope) ? scope : "task";
}

export { createSecurityContext };