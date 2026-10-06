/**
 * Capability registry.
 *
 * Answers "which agents can perform this capability?" â€” the capability question â€”
 * rather than "which agent should I call?", which is the selection question and
 * belongs to `SpecialistPool`.
 *
 * Does NOT re-implement matching. The tri-state verdict comes from the existing
 * `matchCapabilities`, so a capability that is undeclared stays `unknown` here
 * exactly as it does everywhere else in the core. A capability index that
 * disagreed with the matcher would be a correctness bug waiting to happen.
 */

import { type Capability, isCapabilityName } from "../../capabilities/capability.js";
import { matchCapabilities, type CapabilityMatch } from "../../capabilities/match.js";
import { type AgentRecord, agentSupports } from "../agent/record.js";

/** Why a capability may be unavailable across the whole registry. */
export type CapabilityAvailability =
  | "available"
  | "unverified"
  | "declared_absent"
  | "no_agent_declares";

export interface CapabilityReport {
  readonly capability: Capability;
  readonly availability: CapabilityAvailability;
  /** Agent keys that positively support the capability. */
  readonly supporters: readonly string[];
  /** Agent keys that explicitly report it absent. */
  readonly opposers: readonly string[];
  /**
   * Agents that did not declare the capability at all.
   *
   * Tracked explicitly so "unknown" is never silently conflated with "absent".
   */
  readonly undeclared: number;
  readonly reason: string;
}

/** An index from capability to the agents that declare it. */
export class CapabilityRegistry {
  readonly #index = new Map<Capability, Set<string>>();
  readonly #declared = new Map<string, AgentRecord>();

  public get size(): number {
    return this.#index.size;
  }

  public capabilities(): readonly Capability[] {
    return [...this.#index.keys()];
  }

  /**
   * Indexes one agent, replacing any previous index entry for the same key.
   *
   * Re-indexing is idempotent, so a caller can refresh an agent's capabilities
   * without first removing it.
   */
  public index(record: AgentRecord): void {
    const key = `${record.agentId}@${record.version}`;
    this.remove(key);
    this.#declared.set(key, record);
    for (const [capability, status] of record.capabilities.entries()) {
      if (status === "unknown") {
        // An undeclared capability is not indexed as a claim in either
        // direction; it remains discoverable as "unverified" instead.
        continue;
      }
      let bucket = this.#index.get(capability);
      if (!bucket) {
        bucket = new Set<string>();
        this.#index.set(capability, bucket);
      }
      bucket.add(key);
    }
  }

  public remove(agentKey: string): void {
    this.#declared.delete(agentKey);
    for (const bucket of this.#index.values()) {
      bucket.delete(agentKey);
    }
  }

  /** Agent keys that have declared this capability in either direction. */
  public declaring(capability: Capability): readonly string[] {
    return [...(this.#index.get(capability) ?? [])];
  }

  /** Agent keys that positively support the capability. */
  public supportersOf(capability: Capability): readonly string[] {
    return [...(this.#index.get(capability) ?? [])].filter((key) => {
      const record = this.#declared.get(key);
      return record !== undefined && agentSupports(record, capability);
    });
  }

  /** Agent keys that explicitly report the capability absent. */
  public opposersOf(capability: Capability): readonly string[] {
    return [...(this.#index.get(capability) ?? [])].filter((key) => {
      const record = this.#declared.get(key);
      return record !== undefined && record.capabilities.isKnownUnsupported(capability);
    });
  }

  public hasCapability(capability: Capability): boolean {
    return this.#index.has(capability);
  }

  /**
   * Explains the state of a capability across the registry.
   *
   * `unverified` is a first-class outcome: the registry knows of agents that
   * were asked and did not answer, and says so rather than reporting the
   * capability as absent.
   */
  public report(capability: Capability, universeSize: number): CapabilityReport {
    const supporters = this.supportersOf(capability);
    const opposers = this.opposersOf(capability);
    const declaredCount = supporters.length + opposers.length;

    if (supporters.length > 0) {
      return {
        capability,
        availability: "available",
        supporters,
        opposers,
        undeclared: Math.max(0, universeSize - declaredCount),
        reason: `${supporters.length} agent(s) positively support this capability`,
      };
    }
    if (opposers.length > 0) {
      return {
        capability,
        availability: "declared_absent",
        supporters,
        opposers,
        undeclared: Math.max(0, universeSize - declaredCount),
        reason: `${opposers.length} agent(s) explicitly report this capability as absent`,
      };
    }
    if (universeSize > 0) {
      return {
        capability,
        availability: "unverified",
        supporters,
        opposers,
        undeclared: universeSize,
        reason: `No agent declares this capability; ${universeSize} agent(s) are unverified for it`,
      };
    }
    return {
      capability,
      availability: "no_agent_declares",
      supporters,
      opposers,
      undeclared: 0,
      reason: "No agents are registered",
    };
  }

  /**
   * The match verdict for a capability, computed by the existing matcher.
   *
   * Exposed so a caller gets the identical verdict the rest of the core would
   * produce, instead of a second implementation that could drift.
   */
  public matchFor(record: AgentRecord, required: readonly Capability[]): CapabilityMatch {
    return matchCapabilities(required, record.capabilities);
  }

  /** Validates a capability name before it is registered. */
  public static assertValidName(capability: string): boolean {
    return isCapabilityName(capability);
  }

  public clear(): void {
    this.#index.clear();
    this.#declared.clear();
  }
}
