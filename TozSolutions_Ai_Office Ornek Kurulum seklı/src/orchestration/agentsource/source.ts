/**
 * Agent sources.
 *
 * An agent source is a place agents come FROM. TOZ's own agents are declared in
 * this repository; an agency, a framework, or a remote service supplies agents
 * from outside. Both arrive through the same normalisation, so an external agent
 * is never a second-class citizen and never a special case in the core.
 *
 *   external source -> SourceAgentDescriptor -> normalise -> AgentRecordInput
 *                   -> AgentRegistry -> CapabilityRegistry -> SpecialistPool
 *                   -> Toz selection -> execution
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN: a list of agents.
 *
 * No Agency Agent roster exists in this repository. Inventing one would assert an
 * integration that does not exist and a set of capabilities nobody verified. A
 * source supplies descriptors; a roster is supplied by whoever owns it, and every
 * entry in it is either normalised onto the record or rejected here, with a
 * reason.
 *
 * An external description of an agent is a CLAIM about that agent. It is
 * therefore never allowed to grant high trust by itself, and an unmappable
 * capability name is a rejection rather than a silently dropped string.
 */

import { CapabilitySet, type Capability, isCapabilityName } from "../../capabilities/capability.js";
import { UNKNOWN_HEALTH } from "../../health/health.js";
import { type Result, err, ok } from "../../core/result.js";
import {
  AGENT_COST_CLASSES,
  TRUST_LEVELS,
  type AgentCostClass,
  type TrustLevel,
} from "../agent/trust.js";
import {
  AGENT_TYPES,
  EXECUTION_MODES,
  type AgentOriginKind,
  type AgentRecordInput,
  type AgentType,
  type ExecutionMode,
} from "../agent/record.js";
import { isMemoryScope, type MemoryScope } from "../memory/memory.js";

/**
 * What an external source says about an agent.
 *
 * Deliberately loose: this is the union of several frameworks' vocabularies, and
 * a rigid type here would mean rewriting it for every new source. Everything is
 * optional except the id, because a source may genuinely not know the rest, and a
 * fact that is absent must stay absent rather than being invented.
 */
export interface SourceAgentDescriptor {
  /** Identifier within the source. An agent with no id cannot be addressed. */
  readonly id: string;
  readonly name?: string;
  readonly version?: string;
  /**
   * Free-text role as the source states it, e.g. "research specialist".
   *
   * Recorded as a label in `metadata` and never used for eligibility. A role is
   * a self-description; a capability is a declaration the system can test. They
   * are different, which is why this is not the `type` field.
   */
  readonly role?: string;
  /** Agent type, validated against the declared vocabulary. */
  readonly type?: string;
  readonly description?: string;
  /** Capability names in the SOURCE's vocabulary, not necessarily TOZ's. */
  readonly capabilities?: readonly string[];
  /** Narrower roles, kept separate from capabilities for the same reason. */
  readonly specializations?: readonly string[];
  readonly tools?: readonly string[];
  readonly memoryScopes?: readonly string[];
  readonly trustLevel?: string;
  readonly costClass?: string;
  readonly executionMode?: string;
  /**
   * Whether executing this agent requires a routed provider and model.
   *
   * An agency-hosted specialist usually brings its own inference and declares
   * `false`. Absent means the stricter default: assume a route is required.
   */
  readonly requiresModelRoute?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** A place agents come from. */
export interface AgentSource {
  readonly kind: AgentOriginKind;
  /** Stable name of this source instance, used as the adapter id. */
  readonly name: string;
  /** True when the source can be read right now. */
  isAvailable(): Promise<boolean>;
  /**
   * Lists what the source offers.
   *
   * Returns descriptors, NOT records: normalisation happens once, in one place,
   * so every source is held to the same rules.
   */
  list(): Promise<Result<readonly SourceAgentDescriptor[], Error>>;
}

/**
 * Maps a source's capability vocabulary onto TOZ capabilities.
 *
 * A port rather than a lookup table inside the core, because the mapping is a
 * decision about one specific framework and TOZ must not encode a single
 * framework's naming as though it were universal. `null` means "this mapper does
 * not know that name", which is a rejection, not a passthrough.
 */
export interface CapabilityMapper {
  toCapability(externalName: string): Capability | null;
}

/**
 * Passes through names that are already valid TOZ capability names.
 *
 * Suitable when a source already speaks TOZ's vocabulary, and the natural
 * fallback half of any alias mapper. It invents nothing.
 */
export class IdentityCapabilityMapper implements CapabilityMapper {
  public toCapability(externalName: string): Capability | null {
    return isCapabilityName(externalName) ? externalName : null;
  }
}

/**
 * An explicit alias table over a fallback mapper.
 *
 * The table is the point: `{"web_research": "research.web"}` is a decision a
 * human made about a specific source, and it is visible here rather than hidden
 * in a naming convention. A name that is neither aliased nor accepted by the
 * fallback is unmappable, and the agent carrying it is rejected.
 */
export class AliasCapabilityMapper implements CapabilityMapper {
  readonly #aliases: ReadonlyMap<string, Capability>;
  readonly #fallback: CapabilityMapper;

  public constructor(
    aliases: Readonly<Record<string, Capability>>,
    fallback: CapabilityMapper = new IdentityCapabilityMapper(),
  ) {
    this.#aliases = new Map(Object.entries(aliases));
    this.#fallback = fallback;
  }

  public toCapability(externalName: string): Capability | null {
    return this.#aliases.get(externalName) ?? this.#fallback.toCapability(externalName);
  }
}

/** One capability as the source stated it, and as TOZ understands it. */
export interface CapabilityMapping {
  readonly external: string;
  readonly capability: Capability;
}

/** A normalised agent, plus the decisions taken to normalise it. */
export interface NormalisedAgent {
  readonly record: AgentRecordInput;
  readonly mappings: readonly CapabilityMapping[];
  /**
   * Whether any capability name had to be renamed to fit TOZ's vocabulary.
   *
   * Recorded so a reader can see that a source's "web_research" became
   * "research.web" without hunting through the mapper.
   */
  readonly renamed: boolean;
}

/** A rejection, with a reason a human can act on. */
export class AgentNormalisationError extends Error {
  public readonly externalId: string;
  public readonly issues: readonly string[];

  public constructor(externalId: string, issues: readonly string[]) {
    super(`Agent "${externalId}" was rejected: ${issues.join("; ")}`);
    this.name = "AgentNormalisationError";
    this.externalId = externalId;
    this.issues = issues;
  }
}

const ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const VERSION_PATTERN = /^[A-Za-z0-9.+-]{1,64}$/;

/**
 * Turns a source descriptor into an `AgentRecordInput`.
 *
 * Rejects, rather than repairs, anything it cannot represent honestly:
 *
 *   - a missing or malformed id, because an unaddressable agent cannot be
 *     selected, executed, or referred to in evidence
 *   - a capability name the mapper does not know, because dropping it would
 *     produce an agent that silently cannot do what its source advertises
 *   - a memory scope that is not a real scope, for the same reason
 *   - an unknown cost class, execution mode or role, because coercing them to a
 *     default would state a fact the source never gave
 *   - a trust level above the source's ceiling, because an external
 *     self-description is a claim, not a measurement of trustworthiness
 *
 * A descriptor with NO capabilities is NOT rejected. It normalises to an unknown
 * capability set, which the specialist pool withholds unless a caller explicitly
 * waives verification. That is the existing tri-state rule, applied rather than
 * reinvented.
 */
export function normaliseSourceAgent(
  descriptor: SourceAgentDescriptor,
  options: NormalisationOptions,
): Result<NormalisedAgent, AgentNormalisationError> {
  const id = typeof descriptor.id === "string" ? descriptor.id.trim() : "";
  const issues: string[] = [];

  if (id === "" || !ID_PATTERN.test(id)) {
    // Nothing downstream can refer to this agent, so there is nothing to salvage.
    return err(
      new AgentNormalisationError(String(descriptor.id), [
        "id must be 1-128 characters of letters, digits, dot, underscore or dash",
      ]),
    );
  }
  const version = descriptor.version ?? "0.0.0";
  if (!VERSION_PATTERN.test(version)) {
    issues.push(`version "${version}" is not a valid version`);
  }

  const mappings: CapabilityMapping[] = [];
  const entries: Record<string, "supported"> = {};
  const unmappable: string[] = [];
  let renamed = false;
  for (const external of descriptor.capabilities ?? []) {
    const capability = options.mapper.toCapability(external);
    if (capability === null) {
      unmappable.push(external);
      continue;
    }
    mappings.push({ external, capability });
    if (capability !== external) {
      renamed = true;
    }
    entries[capability] = "supported";
  }
  if (unmappable.length > 0) {
    issues.push(
      `declares capability name(s) this system cannot map: ${unmappable.join(", ")}. ` +
        "Map them explicitly rather than dropping them, or the agent would silently be less capable than advertised.",
    );
  }

  const scopes: MemoryScope[] = [];
  for (const scope of descriptor.memoryScopes ?? []) {
    if (!isMemoryScope(scope)) {
      issues.push(`requires unknown memory scope "${scope}"`);
      continue;
    }
    scopes.push(scope);
  }

  const costClass = readMember(descriptor.costClass, AGENT_COST_CLASSES, "costClass", issues);
  const executionMode = readMember(descriptor.executionMode, EXECUTION_MODES, "executionMode", issues);
  const type = readMember(descriptor.type, AGENT_TYPES, "type", issues);

  if (issues.length > 0) {
    return err(new AgentNormalisationError(id, issues));
  }

  const ceiling = options.maximumTrustLevel ?? "standard";
  const trustLevel = clampTrust(descriptor.trustLevel, ceiling);

  const record: AgentRecordInput = {
    agentId: id,
    name: descriptor.name ?? id,
    version,
    // An external agent arrives DISABLED. It becomes selectable only after a
    // human or a verification step promotes it, exactly like any other record:
    // a source that could hand us a live agent would be a source that could
    // choose what runs.
    status: "disabled",
    type: (type ?? "specialist") as AgentType,
    capabilities: new CapabilitySet(entries),
    specializations: descriptor.specializations ?? [],
    toolRequirements: descriptor.tools ?? [],
    memoryScopes: scopes,
    trustLevel,
    costClass: (costClass ?? "unknown") as AgentCostClass,
    latencyClass: "unknown",
    // Latency is not carried across from a source. A number the source did not
    // measure under our conditions would rank as a real measurement.
    measuredLatencyMs: null,
    executionMode: (executionMode ?? "in_process") as ExecutionMode,
    health: UNKNOWN_HEALTH,
    adapter: options.source.name,
    source: { kind: options.source.kind, ref: id },
    requiresModelRoute: descriptor.requiresModelRoute ?? true,
    now: options.now,
    metadata: {
      ...(descriptor.metadata ?? {}),
      // Kept for the audit trail. Never used for eligibility: a role is a label,
      // and a label is not a capability.
      sourceRole: descriptor.role ?? null,
      sourceDescription: descriptor.description ?? null,
    },
  };
  return ok({ record, mappings, renamed });
}

export interface NormalisationOptions {
  readonly source: { readonly kind: AgentOriginKind; readonly name: string };
  readonly mapper: CapabilityMapper;
  /** Trust ceiling for this source. Defaults to `standard`. */
  readonly maximumTrustLevel?: TrustLevel;
  readonly now: Date;
}

/**
 * Clamps a claimed trust level to the source's ceiling.
 *
 * An unrecognised level is treated as no claim at all, so it takes the ceiling
 * rather than defaulting to something higher.
 */
function clampTrust(claimed: string | undefined, ceiling: TrustLevel): TrustLevel {
  if (claimed === undefined || !(TRUST_LEVELS as readonly string[]).includes(claimed)) {
    return ceiling;
  }
  const level = claimed as TrustLevel;
  return TRUST_LEVELS.indexOf(level) <= TRUST_LEVELS.indexOf(ceiling) ? level : ceiling;
}

function readMember(
  value: string | undefined,
  allowed: readonly string[],
  field: string,
  issues: string[],
): string | null {
  if (value === undefined) {
    return null;
  }
  if (!(allowed).includes(value)) {
    issues.push(`${field} "${value}" is not one of: ${allowed.join(", ")}`);
    return null;
  }
  return value;
}
