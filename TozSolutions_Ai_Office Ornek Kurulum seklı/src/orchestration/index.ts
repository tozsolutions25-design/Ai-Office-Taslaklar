/**
 * TOZ AI OFFICE — orchestration fabric.
 *
 * PHASE 04: the core orchestration and extensibility fabric.
 *
 * The dependency direction is one-way:
 *
 *   core  <-  orchestration
 *
 * `src/orchestration` composes the PHASE 01 infrastructure — provider and model
 * registries, the router, the retry policy, the concurrency limiter, the audit
 * log — into an execution. It never reimplements any of it, because a second
 * routing authority or a second audit history is the failure this design
 * exists to prevent.
 *
 * `TozOrchestrator` is the single system authority. Every other component here
 * is subordinate: it can be asked, and it answers, but it cannot start work.
 */

export {
  TozOrchestrator,
  OrchestratorError,
  type OrchestrationRequest,
  type OrchestrationResult,
  type OrchestratorOptions,
} from "./authority.js";

export {
  AGENT_COST_CLASSES,
  AGENT_LATENCY_CLASSES,
  AGENT_STATUSES,
  DEFAULT_CONTRACT,
  EXECUTION_MODES,
  TRUST_LEVELS,
  agentKey,
  agentSupports,
  buildAgentRecord,
  costRank,
  isSelectableStatus,
  latencyRank,
  meetsTrustFloor,
  trustRank,
  AGENT_ORIGIN_KINDS,
  NATIVE_ORIGIN,
  isAgentOriginKind,
  isExternalOrigin,
  type AgentContract,
  type AgentOrigin,
  type AgentOriginKind,
  type AgentCostClass,
  type AgentLatencyClass,
  type AgentRecord,
  type AgentRecordInput,
  type AgentStatus,
  type AgentType,
  type ExecutionMode,
  type TrustLevel,
  type VerificationRequirement,
} from "./agent/record.js";

// PHASE 08: the declared roster. Exported so a deployment can review and register it, not
// so a runtime composes it: nothing here registers anything, and every entry arrives
// disabled. See `agent/catalogue.ts` for why Hermes is absent from it.
export {
  CATALOGUE_ADAPTER,
  MVP_AGENT_CATALOGUE,
  PRODUCTION_CORE_AGENT_CATALOGUE,
  catalogueEntryToRecordInput,
  fullCatalogue,
  type CatalogueEntry,
} from "./agent/catalogue.js";

export {
  AGENT_LIFECYCLE_STATES,
  AgentLifecycleError,
  AgentRegistry,
  DuplicateAgentError,
  UnknownAgentError,
  allowedAgentTransitions,
  canTransitionAgent,
  type AgentLifecycleState,
  type AgentRegistryError,
  type AgentRegistryOptions,
  type RegisteredAgent,
} from "./agent/registry.js";

export {
  AdapterRegistry,
  AgentExecutionError,
  AgentExecutionRequest,
  UnavailableAgentAdapter,
  capabilitySetFromAdapter,
  type AdapterAgentDescriptor,
  type AdapterCapabilities,
  type AgentAdapter,
  type AgentExecutionResult,
} from "./agent/adapter.js";

export {
  CapabilityRegistry,
  type CapabilityAvailability,
  type CapabilityReport,
} from "./capabilities/registry.js";

export {
  REJECTION_REASONS,
  SpecialistPool,
  assessCandidate,
  computeRank,
  type Candidate,
  type CandidateAssessment,
  type PoolContext,
  type PoolOptions,
  type RejectionReason,
  type SelectionDecision,
  type SelectionRequest,
} from "./pool/specialistPool.js";

/* ------------------------------------------------------------------ */
/* PHASE 05: memory, knowledge, learning                              */
/* ------------------------------------------------------------------ */

export {
  ALL_MEMORY_SCOPES,
  CONFIDENCE_RANK,
  EXTENDED_MEMORY_SCOPES,
  LEARNING_EVENT_KINDS,
  MEMORY_CONFIDENCE_LEVELS,
  MEMORY_SENSITIVITIES,
  MEMORY_SOURCES,
  MEMORY_STATUSES,
  MEMORY_TYPES,
  RETRIEVAL_STRATEGIES,
  SCOPE_BREADTH,
  buildMemoryItem,
  emptyRetrieval,
  isBroaderScope,
  isMemoryStatus,
  isMemoryType,
  type AnyMemoryScope,
  type ExtendedMemoryScope,
  type KnowledgeItem,
  type LearningEvent,
  type LearningEventKind,
  type MemoryConfidence,
  type MemoryConfidenceLevel,
  type MemoryDraft,
  type MemoryItem,
  type MemoryMetadata,
  type MemoryProvenance,
  type MemoryQuery,
  type MemoryRetrievalResult,
  type MemorySensitivity,
  type MemorySource,
  type MemoryStatus,
  type MemoryType,
  type RetrievalExplanation,
  type RetrievalStrategy,
  type ScoredMemory,
} from "./memory/model.js";

export {
  MemoryStore,
  MemoryStoreError,
  type MemoryConflict,
  type MemoryStoreOptions,
  type StoreOutcome,
} from "./memory/store.js";

export {
  DEFAULT_RECENCY_HALF_LIFE_MS,
  DEFAULT_RETRIEVAL_WEIGHTS,
  RetrievalEngine,
  RetrievalScorer,
  tokenise,
  type EmbeddingProvider,
  type RetrievalOptions,
  type RetrievalWeights,
} from "./memory/retrieval.js";

export {
  DefaultWritePolicy,
  POLICY_DECISIONS,
  POLICY_RULES,
  derivedConfidence,
  importanceCeilingFor,
  looksSensitive,
  type MemoryWritePolicy,
  type PolicyDecision,
  type PolicyEvaluation,
  type PolicyRule,
  type WritePolicyOptions,
} from "./memory/policy.js";

export {
  LearningEventStore,
  NullLearningEventSink,
  type LearningEventInput,
  type LearningEventStoreOptions,
} from "./memory/learning.js";

export {
  IngestionService,
  StaticKnowledgeIngestor,
  UnreachableKnowledgeIngestor,
  type Ingestible,
  type KnowledgeIngestReport,
  type IngestionOptions,
  type KnowledgeIngestor,
} from "./memory/ingestion.js";

export {
  MemoryService,
  type CaptureResult,
  type MemoryCandidate,
  type MemoryServiceOptions,
  type RecallResult,
} from "./memory/service.js";

// PHASE 07: autonomous workflows and background workers. The coordinator is the
// job-level state authority; it holds no provider, model or agent registry, so
// execution can only ever reach TOZ through `OrchestratorTaskExecutor`.
export * from "./workflow/index.js";

// PHASE 08: governance, policy and the control plane. Governance DECIDES; it
// does not execute, route, write memory or verify, and holds no registry through
// which it could do any of those.
export * from "./governance/index.js";

export {
  ModelRouter,
  type ModelRequirements,
  type ModelRoute,
  type ModelRouterOptions,
  type ModelRoutingPort,
} from "./model/modelRouter.js";

export {
  ORCHESTRATION_TASK_STATES,
  BLOCKED_ORCHESTRATION_STATES,
  TERMINAL_ORCHESTRATION_STATES,
  allowedOrchestrationTransitions,
  assertOrchestrationTransition,
  canCompleteFrom,
  canTransitionOrchestration,
  isOrchestrationState,
  isTerminalOrchestrationState,
  type OrchestrationTaskState,
} from "./task/state.js";

export {
  dependentsOf,
  findDependencyCycle,
  readySubtasks,
  validatePlan,
  type ExecutionPlan,
  type SubTask,
  type SubTaskLimits,
  type TaskPlanner,
} from "./task/plan.js";

export {
  TOPOLOGIES,
  allowsConcurrency,
  hasSupervisor,
  isTopology,
  smallestSufficientTopology,
  topologyFits,
  type Topology,
} from "./team/topology.js";

export {
  TeamPlan,
  TeamRuntime,
  isEscalatingFailure,
  isRetryableSubtaskFailure,
  type SubtaskExecutor,
  type SubtaskOutcome,
  type Team,
  type TeamResult,
  type TeamRuntimeOptions,
} from "./team/team.js";

export {
  EVIDENCE_STATUSES,
  EvidenceCollector,
  UNKNOWN_EVIDENCE_COST,
  buildEvidence,
  evidenceDurationMs,
  isVerifiable,
  mergeEvidence,
  provenanceOf,
  type EvidenceProvenance,
  type Evidence,
  type EvidenceArtifact,
  type EvidenceCost,
  type EvidenceInput,
  type EvidenceSource,
  type EvidenceStatus,
  type EvidenceToolCall,
} from "./evidence/evidence.js";

export {
  VERIFICATION_KINDS,
  VERIFICATION_VERDICTS,
  EvidenceIntegrityVerifier,
  SourceRequirementVerifier,
  VerificationRunner,
  verificationPermitsCompletion,
  type VerificationKind,
  type VerificationOutcome,
  type VerificationResult,
  type VerificationVerdict,
  type Verifier,
} from "./verification/verifier.js";

export {
  DEFAULT_DRIFT_LIMITS,
  DriftGuard,
  assessPlanDrift,
  type DriftAssessment,
  type DriftLimits,
  type DriftViolation,
} from "./policy/antiDrift.js";

export {
  DenyAllInputPolicy,
  DenyAllOutputPolicy,
  HeuristicInjectionInputPolicy,
  PermissiveInputPolicy,
  PermissiveOutputPolicy,
  SecurityDecisionLog,
  screenInput,
  screenOutput,
  type InputPolicy,
  type OutputPolicy,
  type PipelineStage,
  type SecurityDecision,
} from "./policy/security.js";

export {
  MEMORY_SCOPES,
  DisabledMemoryProvider,
  InMemoryMemoryProvider,
  MemoryAccessError,
  MemoryAccessPolicy,
  MemoryKeyError,
  isMemoryScope,
  isValidMemoryKey,
  type EpochClock,
  type MemoryEntry,
  type MemoryGrant,
  type MemoryProvider,
  type MemoryRead,
  type MemoryScope,
  type MemorySubject,
} from "./memory/memory.js";

export {
  InMemoryFeedbackStore,
  feedbackFromExecution,
  summariseAgent,
  type AgentPerformanceSummary,
  type FeedbackRecord,
  type FeedbackStore,
  type Outcome,
} from "./feedback/feedback.js";

export {
  FeedbackLearningSource,
  signalWeight,
  type FeedbackLearningOptions,
  type LearningSignal,
  type LearningSignalSource,
} from "./feedback/learningSignal.js";

export {
  TOOL_KINDS,
  ToolPermissionError,
  ToolRegistry,
  UnknownToolError,
  authorizeToolCall,
  type ToolInvoker,
  type ToolInvocationRequest,
  type ToolInvocationResult,
  type ToolKind,
  type ToolPermission,
  type ToolRecord,
  type ToolRecordInput,
  type ToolRegistryError,
  type ToolStatus,
} from "./tools/tool.js";

export {
  TextStatInvoker,
  ToolExecutionHost,
  type AuthorisedToolRequest,
  type TextStatInput,
  type ToolCallEvidence,
  type ToolCallFailure,
  type ToolHostOptions,
} from "./tools/invoker.js";

export {
  AgentIngestor,
  DeclaredAgentSource,
  type AgentIngestorOptions,
  type IngestRejection,
  type IngestReport,
} from "./agentsource/ingest.js";

export {
  AgentNormalisationError,
  AliasCapabilityMapper,
  IdentityCapabilityMapper,
  normaliseSourceAgent,
  type AgentSource,
  type CapabilityMapper,
  type CapabilityMapping,
  type NormalisationOptions,
  type NormalisedAgent,
  type SourceAgentDescriptor,
} from "./agentsource/source.js";

export {
  AgencyAdapterSet,
  AgencyAgentAdapter,
  classifyAgencyError,
  type AgencyAdapterOptions,
  type AgencyInvocation,
  type AgencyResponse,
  type AgencyTransport,
  type AgencyTransportError,
} from "./agentsource/agencyAdapter.js";

export {
  DuplicateProviderAdapterError,
  ProviderAdapterRegistry,
  UnknownProviderAdapterError,
  type ProviderAdapterRegistryError,
} from "./provider/providerAdapterRegistry.js";

export {
  RUFLO_CONCEPTS,
  RufloAdapterBoundary,
  implementedRufloConcepts,
  rufloConcept,
  translateRufloOutcome,
  type RufloBoundaryOptions,
  type RufloConcept,
  type RufloShapedOutcome,
  type RufloUnavailableReason,
  type TranslatedOutcome,
} from "./ruflo/boundary.js";

export {
  WorkerHost,
  WorkerTimeoutError,
  type Worker,
  type WorkerHostOptions,
  type WorkerRunRecord,
  type WorkerStatus,
} from "./workers/worker.js";

export {
  ORCHESTRATION_EVENT_KINDS,
  ResourceTracker,
  TraceRecorder,
  type ExecutionContext,
  type OrchestrationEvent,
  type OrchestrationEventKind,
  type ResourceUsage,
} from "./observability/trace.js";

export {
  EXTENSION_KINDS,
  ExtensionRegistry,
  type Extension,
  type ExtensionKind,
} from "./extensions/extension.js";

export {
  DEFAULT_ORCHESTRATION_CONFIG,
  loadOrchestrationConfig,
  orchestrationConfigFromApp,
  validateOrchestrationConfig,
  type AgentLimitsConfig,
  type MemoryConfig,
  type OrchestrationAgentsConfig,
  type OrchestrationConfig,
  type OrchestrationLearningConfig,
  type OrchestrationRufloConfig,
  type OrchestrationToolsConfig,
  type OrchestrationConfigIssue,
  type WorkerConfig,
} from "./config/orchestrationConfig.js";

export {
  loadOrchestrationConfigFromEnv,
  rawOrchestrationConfigFromEnv,
  type OrchestrationEnv,
} from "./config/env.js";

/**
 * PHASE 02: the composition root.
 *
 * The ONE place in `src/` permitted to assemble the orchestration layer.
 * `tests/compositionRoot.phase02.test.ts` enforces that, because a second assembly
 * point is how the four Phase 01 authorization defects stayed invisible for a
 * thousand green tests.
 */
export {
  approvalGatesFor,
  bootstrapRuntime,
  createRuntime,
  referenceGovernanceRules,
  RuntimeConfigurationError,
  type BootstrapOptions,
  type Runtime,
  type RuntimeDescription,
  type RuntimeIdentity,
  type RuntimeOptions,
} from "./composition.js";


// PHASE 08: the executive layer's port. Three capabilities - describe, observe, submit - and
// no vocabulary for advancing state, approving, governing or executing. The extension point a
// future Jarvis occupies; the implementation is deliberately not in this phase.
export {
  createExecutiveControl,
  executiveDescriptionOf,
  type ExecutiveControlDependencies,
  type ExecutiveControlPort,
  type ExecutiveDescription,
  type ExecutiveTaskObservation,
} from "./executive/index.js";

// PHASE 09: the skill subsystem. A registry of validated, versioned requirement bundles.
// Exported so a deployment can install and load them; nothing here confers authority, and
// see `skill/skill.ts` for why that is a missing capability rather than a promise.
export {
  SkillLoadError,
  SkillRegistry,
  SkillRegistryError,
  auditEvents,
  validateSkillDeclaration,
  type LoadedSkill,
  type SkillCaller,
  type SkillDeclaration,
  type SkillLoadRecord,
  type SkillLoadRefusal,
  type SkillLoadSink,
  type SkillRegistrationRefusal,
} from "./skill/skill.js";