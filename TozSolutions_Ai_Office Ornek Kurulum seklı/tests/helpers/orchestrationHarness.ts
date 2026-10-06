/**
 * A full orchestration stack, assembled from the real components.
 *
 * Deliberately not a mock orchestrator: the only substituted pieces are the
 * model router (a fixed route, so a test does not need a live provider) and the
 * agent adapter. Everything the orchestrator owns - selection, ordering, state,
 * evidence, verification, feedback, resources - is the production code.
 */

import { ManualClock } from "../../src/core/clock.js";
import { type IdGenerator } from "../../src/core/ids.js";
import { type Capability } from "../../src/capabilities/capability.js";
import { AgentRegistry, type RegisteredAgent } from "../../src/orchestration/agent/registry.js";
import { type AgentRecordInput } from "../../src/orchestration/agent/record.js";
import { AdapterRegistry } from "../../src/orchestration/agent/adapter.js";
import { CapabilityRegistry } from "../../src/orchestration/capabilities/registry.js";
import { SpecialistPool } from "../../src/orchestration/pool/specialistPool.js";
import { type ModelRequirements, type ModelRoute, type ModelRoutingPort } from "../../src/orchestration/model/modelRouter.js";
import { ToolRegistry } from "../../src/orchestration/tools/tool.js";
import { EvidenceIntegrityVerifier, VerificationRunner } from "../../src/orchestration/verification/verifier.js";
import { InMemoryMemoryProvider, MemoryAccessPolicy, type MemoryScope } from "../../src/orchestration/memory/memory.js";
import { type MemoryService } from "../../src/orchestration/memory/service.js";
import { InMemoryFeedbackStore } from "../../src/orchestration/feedback/feedback.js";
import { ResourceTracker, TraceRecorder } from "../../src/orchestration/observability/trace.js";
import { DriftGuard } from "../../src/orchestration/policy/antiDrift.js";
import {
  PermissiveInputPolicy,
  PermissiveOutputPolicy,
  SecurityDecisionLog,
  type InputPolicy,
  type OutputPolicy,
} from "../../src/orchestration/policy/security.js";
import { type OrchestratorOptions, TozOrchestrator } from "../../src/orchestration/authority.js";
import { AuditLog } from "../../src/audit/events.js";
import { LocalAgentAdapter } from "./localAgentAdapter.js";
import type { ProviderAdapterRegistry } from "../../src/orchestration/provider/providerAdapterRegistry.js";
import { type AgentAdapter } from "../../src/orchestration/agent/adapter.js";
import { assertOk } from "../contracts/contracts.js";

/** A router that always returns the same route, or no route at all. */
export class FixedModelRouter implements ModelRoutingPort {
  readonly requests: ModelRequirements[] = [];
  readonly #providerId: string | null;
  readonly #modelId: string | null;

  public constructor(options: { providerId?: string | null; modelId?: string | null } = {}) {
    this.#providerId = options.providerId === undefined ? "test-provider" : options.providerId;
    this.#modelId = options.modelId === undefined ? "test-model" : options.modelId;
  }

  public async route(requirements: ModelRequirements): Promise<ModelRoute> {
    this.requests.push(requirements);
    return this.#providerId === null
      ? { providerId: null, modelId: null, decision: null, reason: "No provider is registered" }
      : {
          providerId: this.#providerId,
          modelId: this.#modelId,
          decision: null,
          reason: `Fixed route to ${this.#providerId}/${this.#modelId}`,
        };
  }
}

export interface HarnessOptions {
  readonly clock?: ManualClock;
  readonly models?: ModelRoutingPort;
  readonly inputPolicy?: InputPolicy;
  readonly outputPolicy?: OutputPolicy;
  readonly memoryPolicy?: MemoryAccessPolicy | null;
  readonly drift?: DriftGuard;
  readonly team?: OrchestratorOptions["team"];
  readonly withVerifier?: boolean;
  readonly adapter?: LocalAgentAdapter;
  readonly agentAdapterName?: string;
  /**
   * Register a provider adapter registry, to exercise the model-route gate.
   *
   * Absent by default, which matches a deployment where no provider is involved.
   */
  readonly providerAdapters?: ProviderAdapterRegistry;
  /** Extra adapters to register alongside the default one. */
  readonly extraAdapters?: readonly AgentAdapter[];
  /**
   * PHASE 05 memory service. Optional, exactly as in production.
   *
   * Absent by default, which is the point: a deployment with no memory service
   * must keep every capability it had before PHASE 05, so the default harness
   * does not quietly supply one.
   */
  readonly memoryService?: MemoryService | null;
  /** Scopes the orchestrator may recall from. No recall at all when empty. */
  readonly recallScopes?: readonly MemoryScope[];
  readonly recallLimit?: number;
  /**
   * PHASE 09: the control plane, wired into the real execution path.
   *
   * Optional, exactly as in production. The default harness supplies NO gate, so
   * every pre-existing test continues to exercise the deployment shape in which
   * governance is not installed - which is the compatibility claim PHASE 09 has to
   * keep true.
   */
  readonly governance?: OrchestratorOptions["governance"];
  /**
   * PHASE 05: the tool authority the orchestrator verifies reported tool calls
   * against. Receives the harness's OWN registry so the two cannot diverge.
   */
  readonly toolHost?: (tools: ToolRegistry) => OrchestratorOptions["toolHost"];
}

export interface Harness {
  readonly orchestrator: TozOrchestrator;
  readonly agents: AgentRegistry;
  readonly capabilities: CapabilityRegistry;
  readonly adapters: AdapterRegistry;
  readonly memory: InMemoryMemoryProvider;
  readonly memoryPolicy: MemoryAccessPolicy | null;
  /** The PHASE 05 service, or null when the deployment has none. */
  readonly memoryService: MemoryService | null;
  readonly feedback: InMemoryFeedbackStore;
  readonly traces: TraceRecorder;
  readonly resources: ResourceTracker;
  readonly security: SecurityDecisionLog;
  readonly audit: AuditLog;
  readonly models: ModelRoutingPort;
  readonly providerAdapters: ProviderAdapterRegistry | null;
  readonly verification: VerificationRunner;
  readonly tools: ToolRegistry;
  readonly adapter: LocalAgentAdapter;
  readonly clock: ManualClock;
  readonly register: (input: Parameters<AgentRegistry["register"]>[0]) => void;
}

/** An id generator that is deterministic and readable in a failure message. */
function sequentialIds(): IdGenerator {
  let counter = 0;
  return {
    newId: (prefix: string) => `${prefix}-${(counter += 1)}`,
  };
}

export function buildHarness(options: HarnessOptions = {}): Harness {
  const clock = options.clock ?? new ManualClock(new Date("2026-01-01T00:00:00.000Z"));
  const agents = new AgentRegistry({ clock });
  const capabilities = new CapabilityRegistry();
  const adapters = new AdapterRegistry();
  const tools = new ToolRegistry({ clock });
  const verification = new VerificationRunner();
  if (options.withVerifier !== false) {
    assertOk(verification.register(new EvidenceIntegrityVerifier()), "evidence verifier registration");
  }
  const memory = new InMemoryMemoryProvider();
  const memoryPolicy = options.memoryPolicy === null ? null : (options.memoryPolicy ?? new MemoryAccessPolicy(clock));
  const feedback = new InMemoryFeedbackStore();
  const audit = new AuditLog({ clock });
  // The trace recorder writes into the shared audit log, so a run leaves one
  // history rather than two. This is how the orchestrator is meant to be wired.
  const traces = new TraceRecorder(audit);
  const resources = new ResourceTracker();
  const security = new SecurityDecisionLog();
  const models = options.models ?? new FixedModelRouter();

  const adapter =
    options.adapter ??
    new LocalAgentAdapter({
      name: options.agentAdapterName ?? "local",
      descriptor: {
        agentId: "research-agent",
        name: "Research agent",
        version: "1.0.0",
        capabilities: { supported: [...RESEARCH_CAPABILITIES], unsupported: [] },
      },
      inputTokensPerCall: 10,
      outputTokensPerCall: 20,
    });
  assertOk(adapters.register(adapter), "adapter registration");
  for (const extra of options.extraAdapters ?? []) {
    assertOk(adapters.register(extra), `adapter registration ${extra.name}`);
  }
  const providerAdapters = options.providerAdapters ?? null;

  // Candidates come from the registry, with each version's own lifecycle, so the
  // pool sees exactly what the registry believes.
  const pool = new SpecialistPool({
    candidates: () => agents.list().map((entry) => ({ agent: entry.record, lifecycle: entry.lifecycle })),
  });

  const orchestrator = new TozOrchestrator({
    agents,
    capabilities,
    pool,
    models,
    tools,
    ...(options.toolHost === undefined ? {} : { toolHost: options.toolHost(tools) }),
    verification,
    memory,
    ...(memoryPolicy === null ? {} : { memoryPolicy }),
    feedback,
    traces,
    resources,
    drift: options.drift ?? new DriftGuard(),
    security,
    inputPolicy: options.inputPolicy ?? new PermissiveInputPolicy(),
    outputPolicy: options.outputPolicy ?? new PermissiveOutputPolicy(),
    adapters,
    ...(options.team === undefined ? {} : { team: options.team }),
    ...(providerAdapters === null ? {} : { providerAdapters }),
    // Memory recall/capture is additive: absent, and the run behaves exactly as
    // it did before PHASE 05. Scopes are passed through as given, and the
    // orchestrator treats an empty list as "no recall", never as "all scopes".
    ...(options.memoryService === undefined || options.memoryService === null
      ? {}
      : { memoryService: options.memoryService }),
    ...(options.recallScopes === undefined ? {} : { recallScopes: options.recallScopes }),
    ...(options.recallLimit === undefined ? {} : { recallLimit: options.recallLimit }),
    // PHASE 09. Absent by default, so the opt-in nature of governance is the
    // default the whole suite runs against.
    ...(options.governance === undefined ? {} : { governance: options.governance }),
    clock,
    ids: sequentialIds(),
  });

  /** Registers an agent and walks it to `available`, the way onboarding does. */
  const register = (input: Omit<AgentRecordInput, "now">): void => {
    const registered = assertOk<RegisteredAgent>(agents.register(input), `agent registration ${input.agentId}`);
    capabilities.index(registered.record);
    for (const step of ["verified", "registered", "available"] as const) {
      assertOk(agents.transition(input.agentId, input.version, step), `agent ${step}`);
    }
  };

  return {
    orchestrator,
    agents,
    capabilities,
    adapters,
    providerAdapters,
    tools,
    memory,
    memoryPolicy,
    memoryService: options.memoryService ?? null,
    feedback,
    traces,
    resources,
    security,
    audit,
    models,
    verification,
    adapter,
    clock,
    register,
  };
}

export const RESEARCH_CAPABILITIES: readonly Capability[] = ["web_research", "source_verification"];
