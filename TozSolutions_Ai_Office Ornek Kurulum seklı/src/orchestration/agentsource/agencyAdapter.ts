/**
 * Agency agent adapter.
 *
 * The execution boundary for agents an external agency supplies.
 *
 * WHAT THIS IS NOT: it is not a claim that any agency is connected. No agency
 * transport exists in this repository, so with no transport configured this
 * adapter reports itself unavailable and returns a classified
 * `configuration_error`. That is the honest state, and it is the state the tests
 * assert. A stub that echoed a plausible answer would make an integration look
 * real, which is the specific failure this file is written to prevent.
 *
 * WHAT THIS IS: the port a real transport plugs into, plus the translation layer
 * that turns a transport's vocabulary and error shapes into TOZ's. An agency
 * integration is then a `AgencyTransport` implementation and nothing else - no
 * change to the orchestrator, the pool, or the registry.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: an adapter is a LEAF. It has no
 * reference to the orchestrator, the specialist pool, the router, the queue, or
 * any registry, and it cannot enqueue work or start a sibling agent. Because the
 * interface has no such slot, the inverted shape cannot be expressed.
 *
 *   Correct:   AgencyAgentAdapter implements AgentAdapter
 *   Incorrect: AgencyAgent extends AgencyOrchestrator   <- inexpressible here
 */

import { type ErrorClass } from "../../core/errors.js";
import { type Result, err, ok } from "../../core/result.js";
import {
  AdapterRegistry,
  type AdapterAgentDescriptor,
  type AgentAdapter,
  AgentExecutionError,
  type AgentExecutionRequest,
  type AgentExecutionResult,
} from "../agent/adapter.js";
import { type SourceAgentDescriptor } from "./source.js";

/**
 * One request to an agency's execution endpoint.
 *
 * A port, not a client. It carries no URL, no credential, and no wire format,
 * because none of those is decided in this repository: whoever owns the agency
 * decides them, and supplies the implementation.
 */
export interface AgencyInvocation {
  readonly externalAgentId: string;
  readonly taskId: string;
  readonly objective: string;
  readonly input: string;
  readonly requiredCapabilities: readonly string[];
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /** Non-secret correlation data. */
  readonly context?: Readonly<Record<string, unknown>>;
}

/** An agency's answer, in whatever vocabulary it uses. */
export interface AgencyResponse {
  readonly externalAgentId: string;
  readonly output: string;
  readonly durationMs?: number | null;
  readonly inputTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly toolCalls?: readonly string[];
  readonly sources?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** An error an agency's transport can observe. */
export interface AgencyTransportError {
  /** HTTP-like status, when the transport speaks HTTP. */
  readonly status?: number;
  /** Transport-specific code, e.g. `AGENT_NOT_FOUND`. */
  readonly code?: string;
  readonly message: string;
}

/** The transport an agency integration implements. */
export interface AgencyTransport {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  /**
   * Executes one request.
   *
   * MUST return a Result rather than throwing for an expected failure: an
   * adapter that throws an unclassified error is treated as permanently failed,
   * which is the safe default but a poor diagnosis.
   */
  invoke(request: AgencyInvocation): Promise<Result<AgencyResponse, AgencyTransportError>>;
}

/**
 * Maps a transport failure onto the core error taxonomy.
 *
 * Exported because the mapping is a decision, not a detail: an adapter that
 * cannot say what went wrong forces the orchestrator to treat every failure as
 * permanent, and an agency outage would then look like a permanent refusal to
 * work. Exported so that decision is visible and testable.
 */
export function classifyAgencyError(error: AgencyTransportError): ErrorClass {
  const code = (error.code ?? "").toUpperCase();
  if (code.includes("TIMEOUT") || code.includes("DEADLINE")) return "timeout";
  if (code.includes("RATE_LIMIT") || error.status === 429) return "rate_limit";
  if (code.includes("QUOTA") || code.includes("BILLING")) return "quota_exhausted";
  if (code.includes("UNAUTHENTICATED") || code.includes("FORBIDDEN")) return "authentication_failure";
  if (code.includes("NOT_FOUND")) return "invalid_request";
  if (code.includes("UNAVAILABLE") || code.includes("OVERLOADED")) return "temporary_outage";
  if (error.status !== undefined) {
    if (error.status >= 500) return "temporary_outage";
    if (error.status >= 400) return "invalid_request";
  }
  // Not classified: permanent by default, which is the safe direction.
  return "unknown";
}

export interface AgencyAdapterOptions {
  readonly transport: AgencyTransport | null;
  /** Descriptors the adapter can execute, keyed by external agent id. */
  readonly roster?: ReadonlyMap<string, SourceAgentDescriptor>;
}

/**
 * Executes agency-supplied agents.
 *
 * With no transport it is inert and says so through `isAvailable()`. It never
 * invents a result: `execute` without a transport returns
 * `configuration_error`, and with a transport it returns whatever that transport
 * actually returned, translated.
 */
export class AgencyAgentAdapter implements AgentAdapter {
  public readonly name = "agency";
  readonly #transport: AgencyTransport | null;
  readonly #roster: ReadonlyMap<string, SourceAgentDescriptor>;

  public constructor(options: AgencyAdapterOptions) {
    this.#transport = options.transport;
    this.#roster = options.roster ?? new Map();
  }

  /** True only when a transport is attached AND reports itself available. */
  public isAvailable(): Promise<boolean> {
    if (this.#transport === null) {
      return Promise.resolve(false);
    }
    return this.#transport.isAvailable();
  }

  public describe(agentId: string, version: string): Promise<Result<AdapterAgentDescriptor, Error>> {
    const descriptor = this.#roster.get(agentId);
    if (!descriptor) {
      return Promise.resolve(err(new Error(`Unknown agency agent: ${agentId}`)));
    }
    return Promise.resolve(
      ok({
        agentId,
        name: descriptor.name ?? agentId,
        version: descriptor.version ?? version,
        // A capability the descriptor does not name stays `unknown`; the
        // normaliser decides, not the adapter.
        capabilities: { supported: descriptor.capabilities ?? [], unsupported: [] },
        costClass: undefined,
        measuredLatencyMs: null,
        metadata: { agencyRole: descriptor.role ?? null },
      }),
    );
  }

  public execute(
    agentId: string,
    request: AgentExecutionRequest,
  ): Promise<Result<AgentExecutionResult, AgentExecutionError>> {
    const key = `${agentId}`;
    if (this.#transport === null) {
      return Promise.resolve(
        err(
          new AgentExecutionError(
            key,
            "configuration_error",
            "No agency transport is configured. This adapter is the declared boundary for an agency integration; " +
              "no agency is connected, so it cannot execute. Attach an AgencyTransport to make this real.",
          ),
        ),
      );
    }
    return this.#invoke(key, request);
  }

  async #invoke(
    key: string,
    request: AgentExecutionRequest,
  ): Promise<Result<AgentExecutionResult, AgentExecutionError>> {
    const transport = this.#transport;
    if (transport === null) {
      // Unreachable: `execute` checks. Kept so the narrowing is local and a
      // future edit cannot turn it into a null dereference.
      return err(new AgentExecutionError(key, "configuration_error", "No agency transport is configured"));
    }
    let responded: Result<AgencyResponse, AgencyTransportError>;
    try {
      responded = await transport.invoke({
        externalAgentId: key,
        taskId: request.taskId,
        objective: request.objective,
        input: request.input,
        requiredCapabilities: request.requiredCapabilities,
        timeoutMs: request.timeoutMs,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        ...(request.context === undefined ? {} : { context: request.context }),
      });
    } catch (error) {
      // A transport that throws is a transport that cannot classify itself. The
      // adapter classifies on its behalf rather than letting the orchestrator
      // treat an outage as a permanent refusal.
      const message = error instanceof Error ? error.message : String(error);
      return err(
        new AgentExecutionError(key, classifyAgencyError({ message }), `Agency transport threw: ${message}`, error),
      );
    }

    if (!responded.ok) {
      return err(
        new AgentExecutionError(
          key,
          classifyAgencyError(responded.error),
          `Agency execution failed: ${responded.error.message}`,
          responded.error,
        ),
      );
    }
    const response = responded.value;
    return ok({
      taskId: request.taskId,
      output: response.output,
      // An agency that does not measure duration reports null, not zero.
      durationMs: response.durationMs ?? null,
      inputTokens: response.inputTokens ?? null,
      outputTokens: response.outputTokens ?? null,
      // An agency-hosted agent brings its own inference, so it names no provider.
      providerId: null,
      modelId: null,
      toolCalls: response.toolCalls ?? [],
      sources: response.sources ?? [],
      ...(response.metadata === undefined ? {} : { metadata: response.metadata }),
    });
  }
}

/**
 * A registry holding only this adapter.
 *
 * Convenience for a composition root that has exactly one agency integration, and
 * a small honest example of the real `AdapterRegistry`: the adapter is the thing
 * being registered, and nothing else is reachable through it.
 */
export class AgencyAdapterSet {
  readonly #registry = new AdapterRegistry();

  public constructor(adapter: AgencyAgentAdapter) {
    const registered = this.#registry.register(adapter);
    if (!registered.ok) {
      throw new Error(registered.error.message);
    }
  }

  public get(name: string): AgencyAgentAdapter | null {
    const found = this.#registry.get(name);
    return found === null ? null : (found as AgencyAgentAdapter);
  }
}
