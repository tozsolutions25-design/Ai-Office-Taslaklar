/**
 * Security boundary.
 *
 * ```
 * INPUT -> POLICY -> ORCHESTRATOR -> AGENT -> TOOL -> OUTPUT -> VERIFICATION
 * ```
 *
 * THIS PHASE DELIBERATELY IMPLEMENTS NO SECURITY PRODUCT. No prompt-injection
 * detector, no PII scrubber, no sandbox, no redaction of model output, no
 * allow-list service. Each of those is a decision requiring threat modelling and
 * a real deployment context, and inventing one would create a false sense of
 * protection while adding a dependency.
 *
 * What PHASE 04 does provide is the SEAM. Each stage of that pipeline has an
 * interface with a permissive default, so a security control can be added later
 * without moving the boundary:
 *
 *   - `InputPolicy.screen`   sits before the orchestrator
 *   - `ToolPermission`       authorises each tool call
 *   - `trustLevel` on an agent gates selection for sensitive work
 *   - `OutputPolicy.screen`  sits between output and verification
 *   - the audit stream        already records every stage
 *
 * `PermissiveInputPolicy` is the honest default and is named as such: it allows
 * everything and is documented as the place a real control belongs.
 */

import { type Result, err, ok } from "../../core/result.js";

export type SecurityDecision =
  | { readonly allowed: true; readonly reason: string }
  | { readonly allowed: false; readonly reason: string };

const ALLOW_ALL: SecurityDecision = { allowed: true, reason: "No policy configured; input accepted unchanged" };

/**
 * Screens inbound work before the orchestrator plans it.
 *
 * A real implementation would detect injection attempts, redact secrets the
 * caller may not have sent, and enforce size limits. The interface exists so
 * adding one is a registration, not a change to the orchestrator.
 */
export interface InputPolicy {
  readonly name: string;
  screen(input: { readonly objective: string; readonly input: string }): Promise<SecurityDecision>;
}

/** Screens output before verification. */
export interface OutputPolicy {
  readonly name: string;
  screen(output: { readonly taskId: string; readonly output: string }): Promise<SecurityDecision>;
}

/**
 * The default. Allows everything, and says so in its reason.
 *
 * `screen` returns an already-settled promise rather than being `async`, because
 * these policies are synchronous by nature. The interface is async so a real
 * policy (a moderation API, a scanner) can be dropped in unchanged.
 */
export class PermissiveInputPolicy implements InputPolicy {
  public readonly name = "permissive";
  public screen(_input: { readonly objective: string; readonly input: string }): Promise<SecurityDecision> {
    return Promise.resolve(ALLOW_ALL);
  }
}

export class PermissiveOutputPolicy implements OutputPolicy {
  public readonly name = "permissive";
  public screen(_output: { readonly taskId: string; readonly output: string }): Promise<SecurityDecision> {
    return Promise.resolve({
      allowed: true,
      reason: "No output policy configured; output passed to verification unchanged",
    });
  }
}

/**
 * Denies everything.
 *
 * Exists so a deployment can fail closed while a real control is being built,
 * and so a test can prove the orchestrator honours a refusing policy rather than
 * only ever seeing a permissive one.
 */
export class DenyAllInputPolicy implements InputPolicy {
  public readonly name = "deny_all";
  public screen(input: { readonly objective: string; readonly input: string }): Promise<SecurityDecision> {
    return Promise.resolve({
      allowed: false,
      reason: `Input policy "${this.name}" refuses all work; objective was ${input.objective.length} characters`,
    });
  }
}

export class DenyAllOutputPolicy implements OutputPolicy {
  public readonly name = "deny_all";
  public screen(_output: { readonly taskId: string; readonly output: string }): Promise<SecurityDecision> {
    return Promise.resolve({ allowed: false, reason: `Output policy "${this.name}" refuses all output` });
  }
}

/**
 * Suggests that an objective looks like an injection attempt.
 *
 * A heuristic, offered as a READY-MADE `InputPolicy` for callers who want a
 * starting point. It is not a security control and is not enabled by default:
 * false positives here would block legitimate work that merely discusses
 * security, and a heuristic that is easy to bypass is worse than an honest
 * "no control configured".
 */
export class HeuristicInjectionInputPolicy implements InputPolicy {
  public readonly name = "heuristic_injection";
  static readonly PATTERNS: readonly RegExp[] = [
    /ignore (all )?(previous|prior|above) instructions/i,
    /disregard (all )?(previous|prior) instructions/i,
    /you are now (?:a|an|in) /i,
    /reveal (?:your )?(system|initial) prompt/i,
    /print (?:your )?(system )?prompt/i,
  ];

  public screen(input: { readonly objective: string; readonly input: string }): Promise<SecurityDecision> {
    const haystack = `${input.objective}\n${input.input}`;
    for (const pattern of HeuristicInjectionInputPolicy.PATTERNS) {
      if (pattern.test(haystack)) {
        return Promise.resolve({
          allowed: false,
          reason: `Input matched an injection heuristic (${pattern.source})`,
        });
      }
    }
    return Promise.resolve({ allowed: true, reason: "No injection heuristic matched" });
  }
}

/** The stage of the pipeline a decision applies to. */
export type PipelineStage = "input" | "orchestrator" | "agent" | "tool" | "output" | "verification";

/**
 * Records every security decision.
 *
 * Small on purpose: the point is that a decision is never invisible. The
 * orchestrator writes here, and a future audit reads from here.
 */
export class SecurityDecisionLog {
  readonly #entries: Array<{ stage: PipelineStage; decision: SecurityDecision; at: number; subject: string }> = [];

  public record(stage: PipelineStage, subject: string, decision: SecurityDecision, at: number): void {
    this.#entries.push({ stage, decision, at, subject });
  }

  public entries(): readonly { stage: PipelineStage; decision: SecurityDecision; at: number; subject: string }[] {
    return [...this.#entries];
  }

  public refusals(): readonly { stage: PipelineStage; decision: SecurityDecision; at: number; subject: string }[] {
    return this.#entries.filter((entry) => !entry.decision.allowed);
  }

  public get size(): number {
    return this.#entries.length;
  }

  public clear(): void {
    this.#entries.length = 0;
  }
}

/** Applies an input policy and records the outcome. */
export async function screenInput(
  policy: InputPolicy,
  log: SecurityDecisionLog,
  input: { readonly objective: string; readonly input: string },
  at: number,
): Promise<Result<true, SecurityDecision>> {
  const decision = await policy.screen(input);
  log.record("input", "task", decision, at);
  return decision.allowed ? ok(true) : err(decision);
}

/** Applies an output policy and records the outcome. */
export async function screenOutput(
  policy: OutputPolicy,
  log: SecurityDecisionLog,
  output: { readonly taskId: string; readonly output: string },
  at: number,
): Promise<Result<true, SecurityDecision>> {
  const decision = await policy.screen(output);
  log.record("output", output.taskId, decision, at);
  return decision.allowed ? ok(true) : err(decision);
}
