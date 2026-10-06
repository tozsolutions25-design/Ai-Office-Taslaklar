import {
  DEFAULT_BACKOFF,
  DEFAULT_RETRY_POLICY,
  type BackoffKind,
  type RetryPolicy,
} from "../retry/policy.js";
import {
  DEFAULT_HEALTH_THRESHOLDS,
  type HealthThresholds,
} from "../health/health.js";
import { DEFAULT_CONCURRENCY, type ConcurrencyLayerConfig } from "../concurrency/limiter.js";

/**
 * Centralised configuration schema.
 *
 * Every runtime knob the core reads lives here, and nowhere else. Secrets are
 * referenced by environment-variable NAME, never by value, and the config
 * layer is the last place that would ever be tempted to read a value.
 */

export const APP_ENVIRONMENTS = ["development", "test", "staging", "production"] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export const LOG_LEVELS = ["silent", "error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** A provider's configuration. Credentials are a variable NAME, not a value. */
export interface ProviderConfig {
  readonly name: string;
  /** Type label. Free-form; no provider type is privileged in the core. */
  readonly type: string;
  readonly enabled: boolean;
  readonly endpoint: string | null;
  /** Environment variable NAME holding the credential. null = no auth configured. */
  readonly authEnvVarName: string | null;
  /** Physical ceiling for simultaneous requests to this provider. */
  readonly maxConcurrentRequests: number | null;
  readonly costClass: "free" | "low" | "standard" | "premium" | "unknown";
  readonly freeTierStatus: "unknown" | "available" | "not_available" | "exhausted";
}

export interface AppConfig {
  readonly app: {
    readonly name: string;
    readonly environment: AppEnvironment;
    readonly instanceId: string;
  };
  readonly logging: {
    readonly level: LogLevel;
    readonly auditEnabled: boolean;
    readonly auditMaxEvents: number;
  };
  readonly queue: {
    readonly maxTasks: number;
    /** Logical capacity. Representation only; not enforced as concurrency. */
    readonly logical: {
      readonly maxAgents: number;
      readonly maxConcurrentWorkflows: number;
    };
  };
  readonly concurrency: ConcurrencyLayerConfig;
  readonly retry: RetryPolicy;
  readonly health: HealthThresholds & { readonly intervalMs: number };
  readonly routing: {
    /**
     * When false (the default), candidates with `unknown` capability verdicts
     * are withheld from production routing.
     */
    readonly allowUnknownCapabilities: boolean;
  };
  readonly request: {
    readonly timeoutMs: number;
  };
  readonly providers: Readonly<Record<string, ProviderConfig>>;
  /**
   * Raw orchestration settings, owned by PHASE 04.
   *
   * Carried here, unvalidated and untyped, so there is ONE configuration
   * object for the whole application rather than a second one that can drift.
   * The core cannot validate these fields without importing the orchestration
   * layer, which would invert the dependency direction, so this section is a
   * passthrough: `orchestrationConfigFromApp` in `src/orchestration/config`
   * validates it with the schema that does understand it, and a caller that
   * skips that call has not configured orchestration at all.
   */
  readonly orchestration: Readonly<Record<string, unknown>>;
}

export const DEFAULT_CONFIG: AppConfig = {
  app: {
    name: "toz-ai-office",
    environment: "development",
    instanceId: "local",
  },
  logging: {
    level: "info",
    auditEnabled: true,
    auditMaxEvents: 10_000,
  },
  queue: {
    maxTasks: 10_000,
    logical: {
      maxAgents: 32,
      maxConcurrentWorkflows: 64,
    },
  },
  concurrency: {
    globalLimit: DEFAULT_CONCURRENCY.globalLimit,
    globalMaxWaiting: DEFAULT_CONCURRENCY.globalMaxWaiting,
    providerLimits: {},
    providerMaxWaiting: {},
    modelLimits: {},
    modelMaxWaiting: {},
  },
  retry: DEFAULT_RETRY_POLICY,
  health: {
    ...DEFAULT_HEALTH_THRESHOLDS,
    intervalMs: 60_000,
  },
  routing: {
    allowUnknownCapabilities: false,
  },
  request: {
    timeoutMs: 120_000,
  },
  // PHASE 01 ships zero provider configurations. Providers are added only
  // after a real integration exists and a human approves it.
  providers: {},
  // PHASE 04 settings default to nothing here: the orchestration layer applies
  // its own defaults when it reads this section, so the core states no opinion
  // about limits it does not enforce.
  orchestration: {},
};

export type BackoffConfig = {
  kind: BackoffKind;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
};

export { DEFAULT_BACKOFF, DEFAULT_RETRY_POLICY };
