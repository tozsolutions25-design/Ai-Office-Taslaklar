/**
 * Tool registry.
 *
 * A tool is CALLABLE. An agent is not. Keeping them separate types is what makes
 * permissions expressible: a policy can say "this agent may call `web_search`"
 * without needing to know which agent it is attached to, and a tool can be
 * audited independently of whoever invoked it.
 *
 *   Agent -> ToolCapability -> ToolRegistry -> Tool
 *
 * NOT:
 *
 *   Agent = Tool
 */

import { type Clock, systemClock } from "../../core/clock.js";
import { type WorkspaceRef, workspaceKey } from "../workspace/workspace.js";
import { ValidationError } from "../../core/errors.js";
import { err, ok, type Result } from "../../core/result.js";

export const TOOL_KINDS = ["local", "mcp", "remote", "connector", "sandboxed"] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export const TOOL_STATUSES = ["registered", "available", "degraded", "unavailable", "retired"] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

export interface ToolRecord {
  readonly toolId: string;
  readonly name: string;
  readonly kind: ToolKind;
  readonly status: ToolStatus;
  /** Non-secret summary of what the tool does. */
  readonly description: string;
  /** Free-form input contract, adapter-defined. */
  readonly accepts: readonly string[];
  readonly produces: readonly string[];
  /** True when the tool has side effects the system cannot undo. */
  readonly sideEffecting: boolean;
  /** True when the tool reaches the network. */
  readonly network: boolean;
  /** Trust level required to invoke this tool. */
  readonly minimumTrust: "untrusted" | "low" | "standard" | "high" | "privileged";
  /** Average observed latency. null = never measured. */
  readonly measuredLatencyMs: number | null;
  readonly registeredAt: Date;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ToolRecordInput {
  readonly toolId: string;
  readonly name?: string;
  readonly kind: ToolKind;
  readonly description: string;
  readonly accepts?: readonly string[];
  readonly produces?: readonly string[];
  readonly sideEffecting?: boolean;
  readonly network?: boolean;
  readonly minimumTrust?: ToolRecord["minimumTrust"];
  readonly measuredLatencyMs?: number | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class DuplicateToolError extends Error {
  public readonly toolId: string;
  public constructor(toolId: string) {
    super(`Tool already registered: ${toolId}`);
    this.name = "DuplicateToolError";
    this.toolId = toolId;
  }
}

export class UnknownToolError extends Error {
  public readonly toolId: string;
  public constructor(toolId: string) {
    super(`Tool not found: ${toolId}`);
    this.name = "UnknownToolError";
    this.toolId = toolId;
  }
}

export class ToolPermissionError extends Error {
  public readonly toolId: string;
  public readonly reason: string;
  public constructor(toolId: string, reason: string) {
    super(`Tool "${toolId}" is not permitted: ${reason}`);
    this.name = "ToolPermissionError";
    this.toolId = toolId;
    this.reason = reason;
  }
}

export type ToolRegistryError = ValidationError | DuplicateToolError | UnknownToolError;

function buildTool(input: ToolRecordInput, now: Date): ToolRecord {
  return {
    toolId: input.toolId,
    name: input.name ?? input.toolId,
    kind: input.kind,
    status: "available",
    description: input.description,
    accepts: input.accepts ?? ["text/plain"],
    produces: input.produces ?? ["text/plain"],
    sideEffecting: input.sideEffecting ?? false,
    network: input.network ?? false,
    minimumTrust: input.minimumTrust ?? "standard",
    measuredLatencyMs: input.measuredLatencyMs ?? null,
    registeredAt: now,
    metadata: input.metadata ?? {},
  };
}

export class ToolRegistry {
  readonly #tools = new Map<string, ToolRecord>();
  readonly #clock: Clock;
  /**
   * PHASE 06: the workspace whose tools this registry holds.
   *
   * A tool record is not deployment configuration. It declares what a given
   * workspace's agent may reach, how risky that is (`sideEffecting`), and whether
   * it reaches the network - which is exactly the set of facts that must not be
   * visible to a workspace that was not granted the tool. So this registry is
   * partitioned, and deliberately absent from `PLATFORM_SCOPED_REGISTRIES` even
   * though a deployment usually wires a similar tool set for everyone: "usually
   * identical" is not "holds no customer data".
   */
  readonly #workspace: WorkspaceRef | null;

  public constructor(options: { clock?: Clock; workspace?: WorkspaceRef | null } = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#workspace = options.workspace ?? null;
  }

  /** The ONLY place this registry composes a store key. */
  #key(toolId: string): string {
    return workspaceKey(this.#workspace, toolId);
  }

  public get size(): number {
    return this.#tools.size;
  }

  /** Idempotent on re-registration: the existing record is returned unchanged. */
  public register(input: ToolRecordInput): Result<ToolRecord, ToolRegistryError> {
    if (typeof input.toolId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.toolId)) {
      return err(
        new ValidationError("Tool registration failed", [
          "toolId must be 1-128 characters of letters, digits, dot, underscore, colon or dash",
        ]),
      );
    }
    if (typeof input.description !== "string" || input.description.trim() === "") {
      return err(new ValidationError("Tool registration failed", ["description must be a non-empty string"]));
    }
    if (!(TOOL_KINDS as readonly string[]).includes(input.kind)) {
      return err(
        new ValidationError("Tool registration failed", [
          `kind must be one of: ${TOOL_KINDS.join(", ")}`,
        ]),
      );
    }
    const existing = this.#tools.get(this.#key(input.toolId));
    if (existing) {
      return ok(existing);
    }
    const record = buildTool(input, this.#clock.now());
    this.#tools.set(this.#key(input.toolId), record);
    return ok(record);
  }

  public get(toolId: string): ToolRecord | null {
    return this.#tools.get(this.#key(toolId)) ?? null;
  }

  public has(toolId: string): boolean {
    return this.#tools.has(this.#key(toolId));
  }

  public list(): readonly ToolRecord[] {
    return [...this.#tools.values()];
  }

  /**
   * The tool ids, NOT the internal keys.
   *
   * PHASE 06: derived from the records rather than from `#tools.keys()`. The keys
   * carry the workspace prefix, and `SpecialistPool` matches agent
   * `toolRequirements` against this list by bare tool id - so returning keys made
   * every agent with a tool requirement look like it was missing its tools. A key
   * reaching a caller is both a wrong answer and a disclosure of the partition.
   */
  public ids(): readonly string[] {
    return [...this.#tools.values()].map((record) => record.toolId);
  }

  public available(): readonly ToolRecord[] {
    return this.list().filter((tool) => tool.status === "available" || tool.status === "degraded");
  }

  public setStatus(toolId: string, status: ToolStatus): Result<ToolRecord, ToolRegistryError> {
    const existing = this.#tools.get(this.#key(toolId));
    if (!existing) {
      return err(new UnknownToolError(toolId));
    }
    const next = { ...existing, status };
    this.#tools.set(this.#key(toolId), next);
    return ok(next);
  }

  public retire(toolId: string): Result<ToolRecord, ToolRegistryError> {
    return this.setStatus(toolId, "retired");
  }

  /**
   * Every tool named in a requirement list is present and available.
   *
   * Used by `SpecialistPool` as a hard filter. A missing tool is a rejection,
   * never a warning.
   */
  public satisfiesAll(toolIds: readonly string[]): { satisfied: boolean; missing: readonly string[] } {
    const missing: string[] = [];
    for (const toolId of toolIds) {
      const tool = this.#tools.get(this.#key(toolId));
      if (!tool || (tool.status !== "available" && tool.status !== "degraded")) {
        missing.push(toolId);
      }
    }
    return { satisfied: missing.length === 0, missing };
  }
}

/**
 * Authorises one tool invocation.
 *
 * Separated from the registry so a future policy component (sandbox rules,
 * allow-lists per tenant) can be added without changing how tools are stored.
 */
export interface ToolPermission {
  readonly subject: string;
  readonly trustLevel: "untrusted" | "low" | "standard" | "high" | "privileged";
  /** When true, a side-effecting tool requires explicit per-call approval. */
  readonly requiresApprovalForSideEffects?: boolean;
  /** Tool ids this subject may never call. */
  readonly denied?: readonly string[];
}

/**
 * An approval that permits ONE side-effecting call.
 *
 * PHASE 05, closing B-13. The requirement that a side-effecting tool needs explicit
 * approval used to be unsatisfiable: `authorizeToolCall` refused, and nothing in the
 * system could ever produce the thing that would make the refusal go away. A
 * fail-closed setting that no input can satisfy is not a control, it is a permanently
 * closed door wearing a control's name.
 *
 * So the approval is now an ordinary value the ONE approval authority can issue, and
 * four things are load-bearing in it:
 *
 *   - It names a TOOL and a SUBJECT, never "side effects in general". An approval for
 *     `text_stat` must not release `web_publish`, and one issued to a different
 *     subject must not release this one's call. A blanket approval is a different
 *     product decision and is not what this type can express.
 *   - `approvedBy` must be a non-empty string. PHASE 04 made approvals attributable;
 *     an approval with no decider is the hole that content binding closed for
 *     workflow gates, and it must not reopen here.
 *   - `approvedAt` must be a real instant. An approval with no time cannot be aged
 *     out, which makes it permanent by accident.
 *   - It is NOT a claim. A caller may construct one, and the orchestrator may only
 *     pass one it obtained from its own gate - which is why the production path
 *     passes none at all rather than synthesising one.
 */
export interface ToolCallApproval {
  readonly toolId: string;
  readonly subject: string;
  readonly approvedBy: string;
  readonly approvedAt: Date;
}

/** True when `approval` genuinely covers this exact call. Fail closed on anything absent. */
function approvalCovers(approval: ToolCallApproval | undefined, toolId: string, subject: string): boolean {
  if (approval === undefined) {
    return false;
  }
  if (approval.toolId !== toolId || approval.subject !== subject) {
    return false;
  }
  if (typeof approval.approvedBy !== "string" || approval.approvedBy.trim() === "") {
    return false;
  }
  if (!(approval.approvedAt instanceof Date) || Number.isNaN(approval.approvedAt.getTime())) {
    return false;
  }
  return true;
}

export function authorizeToolCall(
  registry: ToolRegistry,
  permission: ToolPermission,
  toolId: string,
  trustRank: (level: ToolRecord["minimumTrust"]) => number,
  approval?: ToolCallApproval,
): Result<ToolRecord, ToolPermissionError> {
  const tool = registry.get(toolId);
  if (!tool) {
    return err(new ToolPermissionError(toolId, "the tool is not registered"));
  }
  if (tool.status === "retired") {
    return err(new ToolPermissionError(toolId, "the tool is retired"));
  }
  if (tool.status === "unavailable") {
    return err(new ToolPermissionError(toolId, "the tool is unavailable"));
  }
  if (permission.denied?.includes(toolId)) {
    return err(new ToolPermissionError(toolId, "the caller is denied this tool"));
  }
  if (trustRank(permission.trustLevel) < trustRank(tool.minimumTrust)) {
    return err(
      new ToolPermissionError(
        toolId,
        `requires trust "${tool.minimumTrust}" but the caller is "${permission.trustLevel}"`,
      ),
    );
  }
  if (tool.sideEffecting && permission.requiresApprovalForSideEffects === true) {
    // The refusal names how it is satisfied, because a refusal a caller cannot act
    // on is indistinguishable from a broken tool. B-13 was exactly that: the
    // requirement was real and the way to meet it did not exist.
    if (!approvalCovers(approval, toolId, permission.subject)) {
      return err(
        new ToolPermissionError(
          toolId,
          "the tool has side effects and requires explicit approval: supply a ToolCallApproval " +
            "issued by the approval authority for this tool and this subject",
        ),
      );
    }
  }
  return ok(tool);
}

export interface ToolInvocationRequest {
  readonly toolId: string;
  readonly subject: string;
  readonly input: unknown;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface ToolInvocationResult {
  readonly toolId: string;
  readonly output: unknown;
  readonly durationMs: number | null;
  /** Non-secret side-effect description, for evidence. */
  readonly sideEffects: readonly string[];
}

export interface ToolInvoker {
  readonly name: string;
  invoke(request: ToolInvocationRequest): Promise<Result<ToolInvocationResult, Error>>;
}
