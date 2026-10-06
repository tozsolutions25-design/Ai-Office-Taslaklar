/**
 * A local, in-process agent adapter.
 *
 * NOT A MOCK. It performs real work: it echoes a deterministic transformation of
 * its input, records the cost it incurred, and can be configured to fail with a
 * classified error so the retry and escalation paths are exercised against real
 * behaviour rather than a stub that always returns success.
 *
 * This is the reference implementation the `AgentAdapterContract` is written
 * against, and the shape a future `RufloAdapter` or `RemoteAgentAdapter` would
 * take: the same interface, a different transport.
 */

import {
  type AdapterAgentDescriptor,
  type AgentAdapter,
  type AgentExecutionRequest,
  type AgentExecutionResult,
  AgentExecutionError,
  type AdapterCapabilities,
} from "../../src/orchestration/agent/adapter.js";
import { type ErrorClass } from "../../src/core/errors.js";
import { type Result, err, ok } from "../../src/core/result.js";

export interface LocalAgentOptions {
  readonly descriptor: AdapterAgentDescriptor;
  /** Cost the agent reports per call. */
  readonly inputTokensPerCall?: number;
  readonly outputTokensPerCall?: number;
  readonly latencyMs?: number;
  /** When set, every call fails with this classification. */
  readonly failWith?: ErrorClass;
  /** Agent ids that are unknown, so an unknown-agent call fails cleanly. */
  readonly known?: readonly string[];
  /**
   * PHASE 05. Tool names this adapter reports having invoked.
   *
   * Added because the adapter is the ONLY producer of tool-call evidence the system
   * has: nothing in `src/` invokes a tool on an agent's behalf, so an adapter that
   * actually used one can only say so. Before this option existed there was no way
   * to write a test for what the orchestrator does with such a claim, which is
   * exactly how `authority.ts` came to hardcode `sideEffecting: false`.
   */
  readonly reportsToolCalls?: readonly string[];
}

export class LocalAgentAdapter implements AgentAdapter {
  public readonly name: string;
  readonly #options: LocalAgentOptions;
  #calls = 0;

  public constructor(options: LocalAgentOptions & { name?: string }) {
    this.name = options.name ?? "local";
    this.#options = options;
  }

  public get callCount(): number {
    return this.#calls;
  }

  public async isAvailable(): Promise<boolean> {
    return this.#options.failWith === undefined;
  }

  public async describe(agentId: string, version: string): Promise<Result<AdapterAgentDescriptor, Error>> {
    const known = this.#options.known;
    if (known && !known.includes(agentId)) {
      return err(new Error(`Unknown agent: ${agentId}`));
    }
    if (this.#options.descriptor.agentId !== agentId) {
      return err(new Error(`Unknown agent: ${agentId}`));
    }
    return ok({ ...this.#options.descriptor, version });
  }

  public async execute(
    agentId: string,
    request: AgentExecutionRequest,
  ): Promise<Result<AgentExecutionResult, AgentExecutionError>> {
    this.#calls += 1;
    const key = `${agentId}@${this.#options.descriptor.version}`;

    if (this.#options.failWith) {
      return err(
        new AgentExecutionError(key, this.#options.failWith, `Agent ${agentId} failed: ${this.#options.failWith}`),
      );
    }
    if (request.signal?.aborted) {
      return err(new AgentExecutionError(key, "timeout", "The execution signal was aborted before it started"));
    }

    if (this.#options.latencyMs && this.#options.latencyMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.#options.latencyMs).unref?.());
    }
    if (request.signal?.aborted) {
      return err(new AgentExecutionError(key, "timeout", "The execution was aborted while running"));
    }

    // Real, deterministic work: the output is a function of the input, so a test
    // can assert on it rather than only on the shape of the result.
    const output = `[${agentId}] ${request.objective}: ${request.input}`;

    return ok({
      taskId: request.taskId,
      output,
      durationMs: this.#options.latencyMs ?? 0,
      inputTokens: this.#options.inputTokensPerCall ?? null,
      outputTokens: this.#options.outputTokensPerCall ?? null,
      providerId: "local-provider",
      modelId: "local-model",
      toolCalls: [...(this.#options.reportsToolCalls ?? [])],
      sources: [],
      metadata: { calls: this.#calls },
    });
  }
}

/** Capabilities a default local adapter declares. */
export const LOCAL_AGENT_CAPABILITIES: AdapterCapabilities = {
  supported: ["coding", "text_generation"],
  unsupported: ["vision"],
};
