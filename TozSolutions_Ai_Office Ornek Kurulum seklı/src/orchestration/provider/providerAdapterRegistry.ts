/**
 * Provider adapter registry.
 *
 * PHASE 01 declares the `ProviderAdapter` port and documents that no
 * implementation ships. That is still true: no provider is integrated in this
 * repository, and no OpenAI, Anthropic, Google, Qwen, DeepSeek or OpenRouter
 * client is added here. A fabricated wire format would be a fabricated
 * integration, and would need credentials to be exercised at all.
 *
 * What this file adds is the missing HALF of the existing port: somewhere the
 * orchestrator can ask "is there something that can actually serve this route?"
 * before it records a provider as though one served it.
 *
 * THE DEFECT THIS EXISTS TO CLOSE. Before PHASE 04.1 the orchestrator routed a
 * provider, recorded it in evidence, and then executed through the AGENT adapter
 * - so the route was never used for anything, and a task could be reported as
 * having run on a provider that had no adapter behind it at all. Now:
 *
 *   - an agent that declares `requiresModelRoute` is executed only through a
 *     registered provider adapter, and fails with a classified
 *     `configuration_error` when there is none
 *   - an agent that declares `requiresModelRoute: false` (a self-hosted
 *     specialist, such as an agency-hosted agent) is executed without one, and
 *     records its provider as null rather than borrowing someone else's
 */

import { ValidationError } from "../../core/errors.js";
import { type Result, err, ok } from "../../core/result.js";
import { type ProviderAdapter } from "../../providers/provider.js";

export class DuplicateProviderAdapterError extends Error {
  public readonly providerId: string;

  public constructor(providerId: string) {
    super(`Provider adapter already registered: ${providerId}`);
    this.name = "DuplicateProviderAdapterError";
    this.providerId = providerId;
  }
}

export class UnknownProviderAdapterError extends Error {
  public readonly providerId: string;

  public constructor(providerId: string) {
    super(`No provider adapter is registered for provider: ${providerId}`);
    this.name = "UnknownProviderAdapterError";
    this.providerId = providerId;
  }
}

export type ProviderAdapterRegistryError =
  | ValidationError
  | DuplicateProviderAdapterError
  | UnknownProviderAdapterError;

export class ProviderAdapterRegistry {
  readonly #adapters = new Map<string, ProviderAdapter>();

  public get size(): number {
    return this.#adapters.size;
  }

  /**
   * Registers an adapter.
   *
   * Rejects a duplicate rather than replacing, for the same reason the agent
   * registry does: replacing an adapter would change the meaning of every
   * decision already made about the provider behind it.
   */
  public register(adapter: ProviderAdapter): Result<ProviderAdapter, ProviderAdapterRegistryError> {
    if (typeof adapter.providerId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(adapter.providerId)) {
      return err(
        new ValidationError("Provider adapter registration failed", [
          "providerId must be 1-128 characters of letters, digits, dot, underscore or dash",
        ]),
      );
    }
    if (typeof adapter.execute !== "function" || typeof adapter.classifyError !== "function") {
      return err(
        new ValidationError("Provider adapter registration failed", [
          "an adapter must implement execute() and classifyError()",
        ]),
      );
    }
    if (this.#adapters.has(adapter.providerId)) {
      return err(new DuplicateProviderAdapterError(adapter.providerId));
    }
    this.#adapters.set(adapter.providerId, adapter);
    return ok(adapter);
  }

  public get(providerId: string): ProviderAdapter | null {
    return this.#adapters.get(providerId) ?? null;
  }

  public has(providerId: string): boolean {
    return this.#adapters.has(providerId);
  }

  public ids(): readonly string[] {
    return [...this.#adapters.keys()];
  }

  public require(providerId: string): Result<ProviderAdapter, UnknownProviderAdapterError> {
    const adapter = this.#adapters.get(providerId);
    return adapter ? ok(adapter) : err(new UnknownProviderAdapterError(providerId));
  }

  public clear(): void {
    this.#adapters.clear();
  }
}
