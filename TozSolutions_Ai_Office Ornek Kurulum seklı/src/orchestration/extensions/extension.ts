/**
 * Extension model.
 *
 * A new agent, provider, tool, memory backend, verifier, routing factor or
 * worker is an EXTENSION, registered rather than spliced in.
 *
 * The rule that matters: an extension cannot bypass the policy layer. Every
 * orchestration path still passes through trust filtering, capability
 * verification, and verification, whatever an extension contributes. An
 * extension that could skip them would not be an extension; it would be a
 * back door, and the drift controls in `antiDrift.ts` would be advisory.
 *
 * An extension also cannot contribute a second orchestrator. See
 * `forbidsAuthority`, which makes that a registration-time rejection rather than
 * a review comment.
 */

import { type Result, err, ok } from "../../core/result.js";

export const EXTENSION_KINDS = [
  "agent",
  "provider",
  "tool",
  "memory",
  "verification",
  "routing",
  "worker",
] as const;

export type ExtensionKind = (typeof EXTENSION_KINDS)[number];

export interface Extension {
  /** Stable id. Unique across all kinds. */
  readonly id: string;
  readonly kind: ExtensionKind;
  readonly version: string;
  /**
   * True when the extension wants to influence orchestration decisions
   * directly.
   *
   * Declared rather than assumed, so a reviewer can see it in the manifest. An
   * extension that sets this is rejected at registration: authority belongs to
   * the orchestrator alone.
   */
  readonly claimsAuthority?: boolean;
  /** Capabilities the extension contributes, for the capability index. */
  readonly provides?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class ExtensionRegistry {
  readonly #extensions = new Map<string, Extension>();

  public register(extension: Extension): Result<true, Error> {
    if (typeof extension.id !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(extension.id)) {
      return err(new Error("Extension id must be 1-128 characters of letters, digits, dot, underscore or dash"));
    }
    if (typeof extension.version !== "string" || extension.version.trim() === "") {
      return err(new Error(`Extension "${extension.id}" must declare a version`));
    }
    if (!(EXTENSION_KINDS as readonly string[]).includes(extension.kind)) {
      return err(new Error(`Extension "${extension.id}" has an unknown kind: ${extension.kind}`));
    }
    if (this.#extensions.has(extension.id)) {
      return err(new Error(`Extension already registered: ${extension.id}`));
    }
    // Enforced, not documented: one brain.
    if (extension.claimsAuthority === true) {
      return err(
        new Error(
          `Extension "${extension.id}" claims orchestration authority. Authority belongs to the TOZ Orchestrator; an extension may contribute, not decide.`,
        ),
      );
    }
    this.#extensions.set(extension.id, extension);
    return ok(true);
  }

  public get(id: string): Extension | null {
    return this.#extensions.get(id) ?? null;
  }

  public byKind(kind: ExtensionKind): readonly Extension[] {
    return [...this.#extensions.values()].filter((extension) => extension.kind === kind);
  }

  public list(): readonly Extension[] {
    return [...this.#extensions.values()];
  }

  public get size(): number {
    return this.#extensions.size;
  }

  /** Extensions that contribute a given capability, for the capability index. */
  public providing(capability: string): readonly Extension[] {
    return [...this.#extensions.values()].filter((extension) =>
      extension.provides?.includes(capability),
    );
  }

  public unregister(id: string): boolean {
    return this.#extensions.delete(id);
  }

  public clear(): void {
    this.#extensions.clear();
  }
}
