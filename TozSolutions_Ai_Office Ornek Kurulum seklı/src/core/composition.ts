import { AuditLog, NullAuditLog, type AuditSink } from "../audit/events.js";
import { ConcurrencyManager } from "../concurrency/limiter.js";
import { type AppConfig, DEFAULT_CONFIG } from "../config/schema.js";
import { InMemoryHealthMonitor } from "../health/monitor.js";
import { type KnowledgeProvider, NullKnowledgeProvider } from "../knowledge/port.js";
import { ModelRegistry } from "../models/registry.js";
import { ProviderRegistry } from "../providers/registry.js";
import { TaskQueue } from "../queue/queue.js";
import { DefaultRouter, RegistryCandidateSource } from "../routing/defaultRouter.js";
import type { ProviderRouter } from "../routing/router.js";
import { RetryExecutor } from "../retry/executor.js";
import { StateStore } from "../state/store.js";
import { systemClock, type Clock } from "../core/clock.js";
import { uuidIdGenerator, type IdGenerator } from "../core/ids.js";

/**
 * Composition root.
 *
 * The single place where infrastructure is wired together. Everything else
 * takes its collaborators as constructor arguments, which is what keeps the
 * core testable and keeps provider specifics at the edges.
 *
 * PHASE 01 wires NO provider adapters and registers NO providers or models.
 * `createCore()` therefore starts with empty registries â€” which is the honest
 * state, not a placeholder.
 */

export interface CoreOptions {
  readonly config?: AppConfig;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  /** Optional knowledge layer. Defaults to the unavailable no-op. */
  readonly knowledge?: KnowledgeProvider;
  /** Override the audit sink (e.g. a NullAuditLog when disabled). */
  readonly audit?: AuditSink;
  /**
   * PHASE 06. The workspace the core's DATA-PLANE stores partition by.
   *
   * A structural `{ workspace, brand }` shape, not the orchestration layer's
   * `WorkspaceRef`, because `core` must not import `orchestration` and a test
   * enforces that boundary. The composition root passes the already-verified value.
   *
   * It reaches three stores and NOT the registries: `queue`, `state` and the default
   * `AuditLog` hold customer data and are partitioned; `providers`, `models`,
   * `concurrency` and `health` are deployment configuration and deliberately are not.
   *
   * Before this existed, a runtime that declared a workspace still built an
   * unattributed queue, an unattributed state store, and - the one that mattered
   * most - an audit log that stamped every event `workspace: null`. The declared
   * workspace reached the orchestrator and the memory store but not the three stores
   * built underneath it, so `describe()` reported `"partitioned"` while the audit
   * history it then read was empty.
   */
  readonly workspace?: { readonly workspace: string | null; readonly brand: string | null } | null;
}

export interface Core {
  readonly config: AppConfig;
  /**
   * The clock every core component reads.
   *
   * PHASE 02: exposed so a composition root built on the core can PROVE it reuses
   * the core's clock rather than constructing a second one. Two clocks would mean
   * two different answers to "now", which makes every recorded timestamp and every
   * expiry a comparison between two realities.
   */
  readonly clock: Clock;
  readonly providers: ProviderRegistry;
  readonly models: ModelRegistry;
  readonly queue: TaskQueue;
  readonly concurrency: ConcurrencyManager;
  readonly audit: AuditSink;
  readonly health: InMemoryHealthMonitor;
  readonly state: StateStore;
  readonly router: ProviderRouter;
  readonly retry: RetryExecutor;
  readonly knowledge: KnowledgeProvider;
}

export function createCore(options: CoreOptions = {}): Core {
  const config = options.config ?? DEFAULT_CONFIG;
  const clock = options.clock ?? systemClock;
  const workspace = options.workspace ?? null;

  const audit: AuditSink =
    options.audit ??
    (config.logging.auditEnabled
      ? new AuditLog({
          maxEvents: config.logging.auditMaxEvents,
          clock,
          workspace: workspace?.workspace ?? null,
          brand: workspace?.brand ?? null,
        })
      : new NullAuditLog());

  const providers = new ProviderRegistry({ clock });
  const models = new ModelRegistry({ clock, providers });
  const queue = new TaskQueue({
    maxTasks: config.queue.maxTasks,
    clock,
    ids: options.ids ?? uuidIdGenerator,
    workspace,
  });

  const concurrency = new ConcurrencyManager({
    globalLimit: config.concurrency.globalLimit,
    globalMaxWaiting: config.concurrency.globalMaxWaiting,
    providerLimits: {
      ...config.concurrency.providerLimits,
      ...fromProviderConfigs(config),
    },
    providerMaxWaiting: config.concurrency.providerMaxWaiting,
    modelLimits: config.concurrency.modelLimits,
    modelMaxWaiting: config.concurrency.modelMaxWaiting,
  });

  // PHASE 11: the health monitor records its transitions into the shared audit sink.
  // `provider_health_changed` was declared in two vocabularies and emitted by neither; the
  // audit-side event is now produced here, by the component that computes the transition.
  // Wired to `audit` — the ONE sink — because a second history would mean two answers to
  // "what is this provider's health", which is the question the event exists to answer.
  const health = new InMemoryHealthMonitor({ clock, sink: audit });
  const state = new StateStore({ clock, workspace });

  const candidates = new RegistryCandidateSource({
    providers: () => providers.list(),
    modelsByProvider: (providerId) => models.listByProvider(providerId),
    lifecycleOf: (providerId) => providers.lifecycleOf(providerId)?.state ?? "discovered",
  });

  const router = new DefaultRouter({
    candidates,
    allowUnknownCapabilities: config.routing.allowUnknownCapabilities,
  });

  return {
    config,
    clock,
    providers,
    models,
    queue,
    concurrency,
    audit,
    health,
    state,
    router,
    retry: new RetryExecutor({ policy: config.retry, clock }),
    knowledge: options.knowledge ?? new NullKnowledgeProvider(),
  };
}

function fromProviderConfigs(config: AppConfig): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, provider] of Object.entries(config.providers)) {
    if (provider.maxConcurrentRequests !== null) {
      out[id] = provider.maxConcurrentRequests;
    }
  }
  return out;
}
