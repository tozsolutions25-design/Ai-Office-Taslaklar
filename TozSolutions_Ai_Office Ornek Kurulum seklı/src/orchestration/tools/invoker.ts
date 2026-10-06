/**
 * Tool execution.
 *
 * PHASE 04 filtered agents on tool availability but never called a tool. This
 * file supplies the missing half: the place where a call is authorised, invoked,
 * bounded, and turned into evidence.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: tools are not granted, they are earned.
 *
 * An agent's authorised set is the INTERSECTION of what it declared it needs and
 * what policy permits for the caller. There is no "give the agent every
 * registered tool" path, because that would make the registry a permission list
 * by accident and would make an agent's declaration meaningless.
 *
 * No MCP client ships. `ToolInvoker` is a port, and a real integration is one
 * implementation of it. The reference invoker below is a genuinely local,
 * deterministic tool that needs no external service - it is a working tool, not a
 * stand-in pretending to be an MCP client.
 */

import { type ErrorClass } from "../../core/errors.js";
import { type Result, err, ok } from "../../core/result.js";
import { type EvidenceToolCall } from "../evidence/evidence.js";
import {
  authorizeToolCall,
  type ToolCallApproval,
  type ToolInvoker,
  type ToolInvocationRequest,
  type ToolInvocationResult,
  type ToolPermission,
  type ToolRecord,
  type ToolRegistry,
} from "./tool.js";

/** Why a tool call did not happen, or did not work. */
export interface ToolCallFailure {
  readonly toolId: string;
  readonly errorClass: ErrorClass;
  readonly reason: string;
  /** True when policy refused the call before any transport was involved. */
  readonly refused: boolean;
}

/** A completed call, in the shape evidence wants. */
export interface ToolCallEvidence {
  readonly call: EvidenceToolCall;
  readonly output: unknown;
  readonly sideEffects: readonly string[];
}

export interface ToolHostOptions {
  readonly registry: ToolRegistry;
  /** Invokers by tool id. A tool with no invoker is not executable. */
  readonly invokers: Readonly<Record<string, ToolInvoker>>;
  /** Per-call ceiling. */
  readonly defaultTimeoutMs?: number;
}

export interface AuthorisedToolRequest {
  readonly toolId: string;
  readonly subject: string;
  readonly input: unknown;
  readonly signal?: AbortSignal;
  readonly context?: Readonly<Record<string, unknown>>;
}

/** A tool call this host refused to vouch for, and why. */
export interface ToolCallRefusal {
  readonly toolId: string;
  readonly reason: string;
}

/** The outcome of checking a set of claims that a tool was called. */
export interface VerifiedToolCalls {
  /** Claims this host vouched for, carrying the REGISTRY's facts. */
  readonly verified: readonly EvidenceToolCall[];
  /** Claims it did not, each with a reason a caller can act on. */
  readonly refusals: readonly ToolCallRefusal[];
}

/** Why a claim was refused. Not an ErrorClass: this is a pre-execution refusal. */
const UNDECLARED = "the agent never declared this tool";

/**
 * Authorises and executes tool calls.
 *
 * Holds no reference to the orchestrator, the pool, or any registry beyond the
 * tool registry it was given. It cannot start work: it performs one call that was
 * handed to it, and returns the result.
 */
export class ToolExecutionHost {
  readonly #options: ToolHostOptions;
  readonly #defaultTimeoutMs: number;

  public constructor(options: ToolHostOptions) {
    this.#options = options;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  }

  /**
   * The registry this host authorises against.
   *
   * PHASE 02. Exposed so a caller can prove the host and the orchestrator share ONE
   * registry. Two registries would mean two answers to "which tools exist", and a
   * tool authorised by one would be invisible to the other.
   */
  public get registry(): ToolRegistry {
    return this.#options.registry;
  }

  /** The per-call ceiling applied when a request does not carry its own. */
  public get defaultTimeoutMs(): number {
    return this.#defaultTimeoutMs;
  }

  /**
   * The tools an agent may call.
   *
   * Takes the agent's DECLARED requirements and filters them by policy. An agent
   * that declares nothing gets nothing, and a tool that is not declared is not
   * offered even when it is available - a capability the agent never claimed
   * cannot be exercised.
   */
  public authorisedTools(
    declared: readonly string[],
    permission: ToolPermission,
    trustRank: (level: ToolRecord["minimumTrust"]) => number,
  ): readonly ToolRecord[] {
    const authorised: ToolRecord[] = [];
    for (const toolId of declared) {
      const decision = authorizeToolCall(this.#options.registry, permission, toolId, trustRank);
      if (decision.ok) {
        authorised.push(decision.value);
      }
    }
    return authorised;
  }

  /** Tool ids an agent may call, for a refusal message a caller can read. */
  public authorisedToolIds(
    declared: readonly string[],
    permission: ToolPermission,
    trustRank: (level: ToolRecord["minimumTrust"]) => number,
  ): readonly string[] {
    return this.authorisedTools(declared, permission, trustRank).map((tool) => tool.toolId);
  }

  /**
   * PHASE 05. Turns a set of CLAIMED tool calls into evidence, or into refusals.
   *
   * This is the method that did not exist, and its absence is the defect. Nothing in
   * `src/` invokes a tool on an agent's behalf, so an agent that genuinely used one
   * can only report it - and before this, that report was written straight into the
   * run's evidence with `sideEffecting: false` hardcoded and no check that the call
   * was ever allowed. The record meant to say what a run did was therefore written by
   * the thing being audited.
   *
   * Four rules, each of which the previous behaviour broke:
   *
   *   1. A tool the agent never DECLARED is refused. The declaration is the agent's
   *      own claim of what it needs, and a call it did not claim is a call nothing
   *      authorised.
   *   2. `sideEffecting` comes from the registry record. The claim carries a name and
   *      nothing else; the registry carries the fact.
   *   3. `durationMs` is `null`, because this host did not perform the call and has
   *      no measurement of it. A fabricated `0` would read as "instant".
   *   4. Refusals are returned, not thrown, and are counted by the caller. A partial
   *      success is not a success: recording two verified calls and dropping a
   *      refused third would let the refusal vanish from the evidence.
   *
   * It performs no call. Verification and execution stay separate verbs, so
   * checking a claim can never become performing it.
   */
  public verifyReported(
    declared: readonly string[],
    permission: ToolPermission,
    trustRank: (level: ToolRecord["minimumTrust"]) => number,
    reported: readonly string[],
    approval?: ToolCallApproval,
  ): VerifiedToolCalls {
    const verified: EvidenceToolCall[] = [];
    const refusals: ToolCallRefusal[] = [];
    for (const toolId of reported) {
      if (!declared.includes(toolId)) {
        refusals.push({ toolId, reason: UNDECLARED });
        continue;
      }
      const decision = authorizeToolCall(this.#options.registry, permission, toolId, trustRank, approval);
      if (!decision.ok) {
        refusals.push({ toolId, reason: decision.error.message });
        continue;
      }
      verified.push({
        toolId,
        // The host did not perform this call, so it has no measurement of it.
        durationMs: null,
        // The registry's fact, not the claimant's silence.
        sideEffecting: decision.value.sideEffecting,
      });
    }
    return { verified, refusals };
  }

  /**
   * Executes one tool call.
   *
   * The order is fixed and deliberate: policy first, then existence of an
   * implementation, then the call. A refusal is reported as a refusal
   * (`refused: true`) so a caller can distinguish "not allowed" from "tried and
   * failed", which are different facts and different remedies.
   */
  public async invoke(
    request: AuthorisedToolRequest,
    permission: ToolPermission,
    trustRank: (level: ToolRecord["minimumTrust"]) => number,
    approval?: ToolCallApproval,
  ): Promise<Result<ToolCallEvidence, ToolCallFailure>> {
    const decision = authorizeToolCall(this.#options.registry, permission, request.toolId, trustRank, approval);
    if (!decision.ok) {
      return err({
        toolId: request.toolId,
        // A refusal is a configuration problem: the tool exists, the caller may
        // not have it. Not a work failure, and not retryable.
        errorClass: "configuration_error",
        reason: decision.error.message,
        refused: true,
      });
    }
    const tool = decision.value;
    const invoker = this.#options.invokers[tool.toolId];
    if (invoker === undefined) {
      return err({
        toolId: tool.toolId,
        errorClass: "configuration_error",
        reason: `Tool "${tool.toolId}" is registered but has no invoker, so it cannot be executed`,
        refused: false,
      });
    }

    const timeoutMs = this.#defaultTimeoutMs;
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    timer.unref?.();
    const onCallerAbort = (): void => controller.abort();
    request.signal?.addEventListener("abort", onCallerAbort, { once: true });

    let result: Result<ToolInvocationResult, Error>;
    try {
      const invocation: ToolInvocationRequest = {
        toolId: tool.toolId,
        subject: permission.subject,
        input: request.input,
        timeoutMs,
        signal: controller.signal,
      };
      result = await invoker.invoke(invocation);
    } catch (error) {
      result = err(error instanceof Error ? error : new Error(String(error)));
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onCallerAbort);
    }

    if (!result.ok) {
      return err({
        toolId: tool.toolId,
        // Whether the call was cut short by a timeout is observable here, and
        // the classification reflects it rather than guessing.
        errorClass: controller.signal.aborted ? "timeout" : "unknown",
        reason: result.error.message,
        refused: false,
      });
    }
    const value = result.value;
    return ok({
      call: {
        toolId: tool.toolId,
        // The invoker's own measurement, or the host's wall clock when it
        // reported none. Never a fabricated zero.
        durationMs: value.durationMs ?? Date.now() - started,
        sideEffecting: tool.sideEffecting,
      },
      output: value.output,
      sideEffects: value.sideEffects,
    });
  }
}

/** A tool that reports the shape of its input. */
export interface TextStatInput {
  readonly text: string;
}

/**
 * The reference invoker: a real, local, deterministic tool.
 *
 * Chosen because it needs no network, no credential and no external service, so
 * it can be exercised honestly in a test. It is a working tool, not a stand-in
 * for an MCP client, and it is not presented as one. A real MCP integration is a
 * `ToolInvoker` implementation of the same shape.
 */
export class TextStatInvoker implements ToolInvoker {
  public readonly name = "text_stat";

  public invoke(request: ToolInvocationRequest): Promise<Result<ToolInvocationResult, Error>> {
    const input = request.input as Partial<TextStatInput> | null;
    if (input === null || typeof input !== "object" || typeof input.text !== "string") {
      return Promise.resolve(
        err(new Error('Tool "text_stat" requires an object with a string "text" property')),
      );
    }
    const text = input.text;
    const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
    return Promise.resolve(
      ok({
        toolId: request.toolId,
        output: {
          characters: text.length,
          words,
          lines: text === "" ? 0 : text.split("\n").length,
        },
        durationMs: 0,
        // Declared, not inferred: this tool only reads the value it is given.
        sideEffects: [],
      }),
    );
  }
}
