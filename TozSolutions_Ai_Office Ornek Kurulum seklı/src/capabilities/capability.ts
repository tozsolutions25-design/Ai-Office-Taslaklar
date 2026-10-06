/**
 * Normalized capability model.
 *
 * A capability is a tri-state fact, not a boolean:
 *
 *   "supported"   - positively verified.
 *   "unsupported" - positively verified as absent.
 *   "unknown"     - not verified. Treated as NOT guaranteed.
 *
 * The `unknown` state is the reason the matcher can return a
 * "needs verification" verdict instead of silently guessing.
 */

/**
 * The built-in capability names.
 *
 * These are the capabilities the core itself understands. The list is
 * deliberately NOT the complete set of names a system may use: an agent can
 * declare its own (see `Capability` below). The list exists so the design system
 * and the site can reason about a known, finite set.
 */
export const CAPABILITIES = [
  "text_generation",
  "coding",
  "debugging",
  "reasoning",
  "research",
  "vision",
  "structured_output",
  "tool_calling",
  "browser_automation",
  "document_processing",
  "long_context",
  "ui_design",
] as const;

/** A capability the core knows about. */
export type BuiltinCapability = (typeof CAPABILITIES)[number];

/**
 * Any capability name.
 *
 * Open, because an agent must be able to declare a capability the core has never
 * heard of — `web_research`, `entity_extraction`, `source_verification` — and
 * have it registered, matched and indexed without a code change to the core.
 *
 * The `string & {}` form preserves autocomplete for the built-ins while
 * admitting any other string, so this stays backward compatible: every existing
 * use of a literal keeps its literal type.
 */
export type Capability = BuiltinCapability | (string & {});

/** The built-in names, as a plain array of strings. */
export const BUILTIN_CAPABILITY_SET: ReadonlySet<string> = new Set<string>(CAPABILITIES);

/** True for one of the built-in capability names. */
export function isBuiltinCapability(value: unknown): value is BuiltinCapability {
  return typeof value === "string" && BUILTIN_CAPABILITY_SET.has(value);
}

/**
 * A syntactically valid capability name.
 *
 * Custom names must be namespaced and lowercase, so a typo in an agent
 * declaration is caught at registration rather than silently producing a
 * capability nothing can ever match.
 */
export function isCapabilityName(value: unknown): value is Capability {
  if (typeof value !== "string") {
    return false;
  }
  if (isBuiltinCapability(value)) {
    return true;
  }
  // A custom name must be namespaced: at least two lowercase segments joined by
  // underscores, e.g. `web_research`. This keeps a bare English word from
  // silently becoming a capability name nothing can meaningfully match.
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(value);
}

export const CAPABILITY_STATUSES = ["supported", "unsupported", "unknown"] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

/**
 * True for any valid capability name, built-in or custom.
 *
 * Retains the name used throughout PHASE 01, when capability names were a
 * closed set. It now admits custom names as well, so a caller validating a
 * declared capability is not forced to know the built-in list.
 */
export function isCapability(value: unknown): value is Capability {
  return isCapabilityName(value);
}

export function isCapabilityStatus(value: unknown): value is CapabilityStatus {
  return typeof value === "string" && (CAPABILITY_STATUSES as readonly string[]).includes(value);
}

/**
 * A capability profile.
 *
 * Absent capabilities are deliberately represented as `unknown` rather than
 * `unsupported`, because absence of a declaration is not evidence of absence
 * of the capability.
 */
export class CapabilitySet {
  readonly #statuses: ReadonlyMap<Capability, CapabilityStatus>;

  public constructor(entries: Partial<Record<Capability, CapabilityStatus>> = {}) {
    // Every built-in capability is present, defaulting to `unknown`, so
    // `uncertainties()` and the PHASE 01 tests behave exactly as before. Custom
    // names are added only when explicitly declared, so an undeclared custom
    // capability is reported as `unknown` by `statusOf` rather than appearing
    // as a surprise entry.
    const map = new Map<Capability, CapabilityStatus>();
    for (const capability of CAPABILITIES) {
      const status = entries[capability];
      map.set(capability, status === undefined ? "unknown" : status);
    }
    for (const [capability, status] of Object.entries(entries)) {
      if (status !== undefined) {
        map.set(capability, status);
      }
    }
    this.#statuses = map;
  }

  /** An all-`unknown` profile. The correct starting point for a new provider. */
  public static unknown(): CapabilitySet {
    return new CapabilitySet();
  }

  public static of(entries: Partial<Record<Capability, CapabilityStatus>>): CapabilitySet {
    return new CapabilitySet(entries);
  }

  /**
   * Builds a profile from a list of positively supported capabilities.
   * Everything else becomes `unknown` (not `unsupported`).
   */
  public static supporting(...capabilities: readonly Capability[]): CapabilitySet {
    const entries: Partial<Record<Capability, CapabilityStatus>> = {};
    for (const capability of capabilities) {
      entries[capability] = "supported";
    }
    return new CapabilitySet(entries);
  }

  public statusOf(capability: Capability): CapabilityStatus {
    return this.#statuses.get(capability) ?? "unknown";
  }

  public isSupported(capability: Capability): boolean {
    return this.statusOf(capability) === "supported";
  }

  /** True only when positively supported. `unknown` is not support. */
  public isKnownToSupport(capability: Capability): boolean {
    return this.isSupported(capability);
  }

  public isKnownUnsupported(capability: Capability): boolean {
    return this.statusOf(capability) === "unsupported";
  }

  public isUnknown(capability: Capability): boolean {
    return this.statusOf(capability) === "unknown";
  }

  /** Every capability that is not positively supported. */
  public uncertainties(): Capability[] {
    return CAPABILITIES.filter((capability) => this.isUnknown(capability));
  }

  public entries(): ReadonlyMap<Capability, CapabilityStatus> {
    return this.#statuses;
  }

  public toJSON(): Record<Capability, CapabilityStatus> {
    const out = {} as Record<Capability, CapabilityStatus>;
    for (const [capability, status] of this.#statuses) {
      out[capability] = status;
    }
    return out;
  }
}
