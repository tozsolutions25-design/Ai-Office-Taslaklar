/**
 * Agent adapter.
 *
 * The seam through which any external agent — Agency, Ruflo, a remote service,
 * a TOZ-native implementation — becomes visible to the orchestrator.
 *
 * THE RULE THIS FILE EXISTS TO ENFORGE: an adapter is a LEAF. It normalises one
 * external agent into the TOZ contract. It has no reference to the
 * orchestrator, the specialist pool, the router, the queue, or the registries,
 * and it cannot enqueue work or start a sibling agent.
 *
 *   Correct:   RufloAdapter implements AgentAdapter
 *   Incorrect: TozAgent extends RufloAgent      <- structurally impossible here
 *
 * Because the interface has no orchestrator reference, that incorrect shape
 * cannot be expressed. A `RemoteAgentAdapter` in PHASE 08, or a `RufloAdapter`,
 * adds capability without touching the core.
 *
 * No Ruflo package is installed and none is required. A fake Ruflo adapter would
 * assert an integration that does not exist, so none ships.
 */

import { type Capability, CapabilitySet } from "../../capabilities/capability.js";
import { type ErrorClass } from "../../core/errors.js";
import { type Result, err, ok } from "../../core/result.js";
import { type AgentCostClass } from "./trust.js";

/** A normalised capability declaration, as an adapter reports it. */
export interface AdapterCapabilities {
  /** The capabilities the external agent claims. */
  readonly supported: readonly Capability[];
  /**
   * Capabilities the external agent explicitly reports as absent.
   *
   * Kept separate from `supported` so an adapter can distinguish "absent" from
   * "not asked about", preserving the tri-state semantics of the core.
   */
  readonly unsupported?: readonly Capability[];
}

/** What the adapter says about itself, before it becomes an `AgentRecord`. */
export interface AdapterAgentDescriptor {
  readonly agentId: string;
  readonly name: string;
  readonly version: string;
  readonly capabilities: AdapterCapabilities;
  readonly costClass?: AgentCostClass;
  /** Adapter-measured latency. Omit rather than guess. */
  readonly measuredLatencyMs?: number | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentExecutionRequest {
  readonly taskId: string;
  readonly objective: string;
  readonly input: string;
  /** Capabilities the caller needs. The adapter may refuse if it cannot meet them. */
  readonly requiredCapabilities: readonly Capability[];
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /** Non-secret correlation data, forwarded for traceability. */
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface AgentExecutionResult {
  readonly taskId: string;
  readonly output: string;
  /** Wall-clock duration as measured by the adapter. null when unmeasured. */
  readonly durationMs: number | null;
  /** Token usage as reported by the adapter. null when the adapter cannot report it. */
  readonly inputTokens?: number | null;
  readonly outputTokens?: number | null;
  /** Provider/model the adapter actually used, when it can report them. */
  readonly providerId?: string | null;
  readonly modelId?: string | null;
  /** Names of tools the adapter invoked. */
  readonly toolCalls?: readonly string[];
  /** Non-secret sources the result rests on. */
  readonly sources?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A failure the adapter can describe precisely.
 *
 * Adapters MUST translate their framework's error into one of the core error
 * classes. An adapter that throws an unclassified error causes the orchestrator
 * to treat the failure as permanent, which is the safe default.
 */
export class AgentExecutionError extends Error {
  public readonly errorClass: ErrorClass;
  public readonly agentKey: string;

  public constructor(agentKey: string, errorClass: ErrorClass, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AgentExecutionError";
    this.errorClass = errorClass;
    this.agentKey = agentKey;
  }
}

/**
 * The adapter contract.
 *
 * Implementations normalise identity, capabilities, input, execution, output,
 * errors, lifecycle, health, metadata, and cost information where available.
 */
export interface AgentAdapter {
  /** Stable adapter identifier, referenced by `AgentRecord.adapter`. */
  readonly name: string;
  /** True when the adapter can run right now. */
  isAvailable(): Promise<boolean>;
  /** Describes an agent this adapter can execute. */
  describe(agentId: string, version: string): Promise<Result<AdapterAgentDescriptor, Error>>;
  /** Executes one request. Must not throw for an expected failure. */
  execute(agentId: string, request: AgentExecutionRequest): Promise<Result<AgentExecutionResult, AgentExecutionError>>;
  /** Optional teardown. */
  dispose?(): Promise<void>;
}

/** Converts an adapter descriptor into a capability set, preserving `unknown`. */
export function capabilitySetFromAdapter(descriptor: AdapterAgentDescriptor): CapabilitySet {
  const entries: Record<string, "supported" | "unsupported"> = {};
  for (const capability of descriptor.capabilities.supported) {
    entries[capability] = "supported";
  }
  for (const capability of descriptor.capabilities.unsupported ?? []) {
    // An explicit "absent" only stays absent if nothing claimed it.
    if (entries[capability] === undefined) {
      entries[capability] = "unsupported";
    }
  }
  return new CapabilitySet(entries);
}

/**
 * An adapter that has no external agent behind it.
 *
 * This is NOT a mock and NOT a fake success path: it is the honest
 * implementation of "no agent is available", which is the real state of the
 * system today. `execute` returns a classified `configuration_error`, never
 * `success: true`.
 */
export class UnavailableAgentAdapter implements AgentAdapter {
  public readonly name = "unavailable";

  // Not `async`: there is nothing to await, and the interface stays async so a
  // real HTTP-backed adapter can be dropped in unchanged.
  public isAvailable(): Promise<boolean> {
    return Promise.resolve(false);
  }

  public describe(_agentId: string, _version: string): Promise<Result<AdapterAgentDescriptor, Error>> {
    return Promise.resolve(
      err(new AgentExecutionError("unavailable", "configuration_error", "No agent backend is configured")),
    );
  }

  public execute(
    agentId: string,
    _request: AgentExecutionRequest,
  ): Promise<Result<AgentExecutionResult, AgentExecutionError>> {
    return Promise.resolve(
      err(
        new AgentExecutionError(
          agentId,
          "configuration_error",
          "No agent backend is configured; this adapter cannot execute",
        ),
      ),
    );
  }
}

/**
 * Adapters available to the orchestrator, by name.
 *
 * A registry rather than a hardcoded list, so adding an adapter is a
 * registration, not a change to the orchestrator.
 */
export class AdapterRegistry {
  readonly #adapters = new Map<string, AgentAdapter>();

  public register(adapter: AgentAdapter): Result<true, Error> {
    if (adapter.name.trim() === "") {
      return err(new Error("Adapter name must be a non-empty string"));
    }
    if (this.#adapters.has(adapter.name)) {
      return err(new Error(`Adapter already registered: ${adapter.name}`));
    }
    this.#adapters.set(adapter.name, adapter);
    return ok(true);
  }

  public get(name: string): AgentAdapter | null {
    return this.#adapters.get(name) ?? null;
  }

  public has(name: string): boolean {
    return this.#adapters.has(name);
  }

  public names(): readonly string[] {
    return [...this.#adapters.keys()];
  }

  public get size(): number {
    return this.#adapters.size;
  }
}
