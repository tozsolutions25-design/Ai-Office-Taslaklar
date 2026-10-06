/**
 * Agent ingestion.
 *
 * The only path by which an external agent enters the system.
 *
 *   source.list() -> normalise -> register -> index in the capability registry
 *                 -> IngestReport
 *
 * TWO PROPERTIES THIS FILE EXISTS TO GUARANTEE:
 *
 * 1. Ingestion is never a decision. It registers records; it does not enable
 *    them, select them, or schedule them. An external agent arrives disabled and
 *    stays that way until the same lifecycle promotion any TOZ agent goes
 *    through. A source cannot hand us something that runs.
 *
 * 2. Ingestion is always reported. Every descriptor is either registered or
 *    rejected with a reason, and every capability rename is recorded. A source
 *    that quietly failed to contribute three of its five agents would otherwise
 *    look exactly like a source that contributed five and lost to selection.
 */

import { type Result, ok } from "../../core/result.js";
import { type AgentRegistry, type RegisteredAgent } from "../agent/registry.js";
import { type AgentOriginKind } from "../agent/record.js";
import { type CapabilityRegistry } from "../capabilities/registry.js";
import {
  AgentNormalisationError,
  type AgentSource,
  type CapabilityMapper,
  IdentityCapabilityMapper,
  normaliseSourceAgent,
  type SourceAgentDescriptor,
} from "./source.js";
import { type Clock, systemClock } from "../../core/clock.js";

/** A descriptor the system refused, and why. */
export interface IngestRejection {
  readonly externalId: string;
  readonly reason: string;
}

export interface IngestReport {
  readonly source: AgentOriginKind;
  readonly sourceName: string;
  /** Newly registered agents. */
  readonly registered: readonly RegisteredAgent[];
  /**
   * Descriptors whose agent was already present.
   *
   * Counted separately rather than as a rejection: re-reading a roster is normal,
   * and a refresh must not look like a failure.
   */
  readonly existing: readonly string[];
  readonly rejections: readonly IngestRejection[];
  /** external name -> TOZ capability, for every rename the mapper performed. */
  readonly capabilityRenames: Readonly<Record<string, string>>;
  /** True when the source could not be read at all. */
  readonly sourceUnavailable: boolean;
}

export interface AgentIngestorOptions {
  readonly agents: AgentRegistry;
  readonly capabilities: CapabilityRegistry;
  readonly mapper?: CapabilityMapper;
  /** Trust ceiling for every source this ingestor reads. */
  readonly maximumTrustLevel?: "untrusted" | "low" | "standard" | "high" | "privileged";
  /**
   * Walk every accepted agent to `available`.
   *
   * Off by default, and deliberately so: promotion is a trust decision, and
   * baking it into ingestion would let a source grant itself availability.
   */
  readonly promoteToAvailable?: boolean;
  readonly clock?: Clock;
  /**
   * PHASE 11: where ingestion is recorded.
   *
   * OPTIONAL, and the absence is a limitation rather than a convenience: with no recorder
   * supplied, an external agent enters the system and nothing says so. That is the one event
   * in this subsystem an operator most needs, because ingestion is the only path by which an
   * agent the repository did not write becomes reachable at all.
   *
   * It is a narrow port rather than a `TraceRecorder` so this class keeps no dependency on the
   * observability vocabulary, and so a caller can record ingestion somewhere other than the
   * orchestration trace without this module knowing.
   */
  readonly onIngested?: (record: {
    readonly agentId: string;
    readonly version: string;
    readonly source: string;
    readonly status: string;
    readonly trustLevel: string;
    readonly promotedToAvailable: boolean;
    readonly refused: readonly { readonly agentId: string; readonly reason: string }[];
  }) => void;
}

export class AgentIngestor {
  readonly #options: AgentIngestorOptions;
  readonly #clock: Clock;

  public constructor(options: AgentIngestorOptions) {
    this.#options = options;
    this.#clock = options.clock ?? systemClock;
  }

  /**
   * Reads one source and registers what it offers.
   *
   * Never throws for an expected problem: an unreadable source, a malformed
   * descriptor, and a duplicate are all outcomes the caller must be able to see.
   */
  public async ingest(source: AgentSource): Promise<IngestReport> {
    const mapper = this.#options.mapper ?? new IdentityCapabilityMapper();
    const base = {
      source: source.kind,
      sourceName: source.name,
      registered: [] as RegisteredAgent[],
      existing: [] as string[],
      rejections: [] as IngestRejection[],
      capabilityRenames: {} as Record<string, string>,
      sourceUnavailable: false,
    };

    const listed = await source.list();
    if (!listed.ok) {
      return { ...base, sourceUnavailable: true, rejections: [{ externalId: source.name, reason: listed.error.message }] };
    }
    return this.ingestDescriptors(source, listed.value, mapper);
  }

  /**
   * Registers descriptors directly.
   *
   * Separate from `ingest` so a caller with a roster already in hand - a JSON
   * file, a database table, a test fixture - goes through the identical
   * normalisation without inventing a source object to hold it.
   */
  public ingestDescriptors(
    source: Pick<AgentSource, "kind" | "name">,
    descriptors: readonly SourceAgentDescriptor[],
    mapper: CapabilityMapper = this.#options.mapper ?? new IdentityCapabilityMapper(),
  ): IngestReport {
    const registered: RegisteredAgent[] = [];
    const existing: string[] = [];
    const rejections: IngestRejection[] = [];
    const renames: Record<string, string> = {};

    for (const descriptor of descriptors) {
      const normalised = normaliseSourceAgent(descriptor, {
        source,
        mapper,
        maximumTrustLevel: this.#options.maximumTrustLevel ?? "standard",
        now: this.#clock.now(),
      });
      if (!normalised.ok) {
        rejections.push({
          externalId: descriptor.id,
          reason: normalised.error instanceof AgentNormalisationError ? normalised.error.message : String(normalised.error),
        });
        continue;
      }
      for (const mapping of normalised.value.mappings) {
        if (mapping.external !== mapping.capability) {
          renames[mapping.external] = mapping.capability;
        }
      }

      // Whether this agent is new is decided BEFORE registering, by asking the
      // registry. Re-reading a roster is normal, and a refresh must not be
      // reported as a failure - nor re-indexed, which would silently reset the
      // capability index for an agent whose record did not change.
      if (this.#options.agents.has(normalised.value.record.agentId, normalised.value.record.version)) {
        existing.push(normalised.value.record.agentId);
        continue;
      }
      const added = this.#options.agents.register(normalised.value.record);
      if (!added.ok) {
        rejections.push({ externalId: descriptor.id, reason: added.error.message });
        continue;
      }
      this.#options.capabilities.index(added.value.record);
      registered.push(added.value);
    }

    if (this.#options.promoteToAvailable === true) {
      for (const entry of registered) {
        this.#options.agents.setStatus(entry.record.agentId, entry.record.version, "active");
        for (const step of ["verified", "registered", "available"] as const) {
          this.#options.agents.transition(entry.record.agentId, entry.record.version, step);
        }
      }
    }

    // PHASE 11: `agent_source_ingested`, declared since PHASE 04 and never emitted. Ingestion
    // is the ONLY path by which an agent this repository did not write becomes reachable, so
    // its absence from the trail was the most consequential of the ten.
    //
    // Refusals are included in the same record because "an external roster offered three
    // agents and all three were refused" is the answer to a question an operator actually
    // asks, and it was previously visible only in the returned report.
    if (this.#options.onIngested !== undefined) {
      const promoted = this.#options.promoteToAvailable === true;
      for (const entry of registered) {
        this.#options.onIngested({
          agentId: entry.record.agentId,
          version: entry.record.version,
          source: source.name,
          status: entry.record.status,
          trustLevel: entry.record.trustLevel,
          promotedToAvailable: promoted,
          refused: rejections.map((rejection) => ({ agentId: rejection.externalId, reason: rejection.reason })),
        });
      }
      if (registered.length === 0) {
        // Still reported: a source that offered nothing, or whose whole roster was refused, is
        // a fact. An event only on success would make an empty ingestion invisible.
        this.#options.onIngested({
          agentId: "",
          version: "",
          source: source.name,
          status: "none-registered",
          trustLevel: "n/a",
          promotedToAvailable: false,
          refused: rejections.map((rejection) => ({ agentId: rejection.externalId, reason: rejection.reason })),
        });
      }
    }

    return {
      source: source.kind,
      sourceName: source.name,
      registered,
      existing,
      rejections,
      capabilityRenames: renames,
      sourceUnavailable: false,
    };
  }
}

/** One agent as offered by a declared roster, before normalisation. */
export class DeclaredAgentSource implements AgentSource {
  readonly kind: AgentOriginKind;
  readonly name: string;
  readonly #descriptors: readonly SourceAgentDescriptor[];
  #available: boolean;

  /**
   * A source over a roster supplied by whoever owns it.
   *
   * The roster is DATA, not code, which is the point: adding an agency is a
   * configuration and registration event, not a change to this repository. With
   * an empty roster this source contributes nothing and says so, rather than
   * pretending to be an integration.
   */
  public constructor(options: {
    readonly kind: AgentOriginKind;
    readonly name: string;
    readonly descriptors: readonly SourceAgentDescriptor[];
    readonly available?: boolean;
  }) {
    this.kind = options.kind;
    this.name = options.name;
    this.#descriptors = options.descriptors;
    this.#available = options.available ?? true;
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(this.#available);
  }

  public list(): Promise<Result<readonly SourceAgentDescriptor[], Error>> {
    return Promise.resolve(ok(this.#descriptors));
  }

  public get size(): number {
    return this.#descriptors.length;
  }
}
