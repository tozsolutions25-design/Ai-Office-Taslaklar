/**
 * Skills — a validated, versioned bundle of REQUIREMENTS.
 *
 * ## WHAT THIS IS NOT, AND WHY THE DISTINCTION IS THE DESIGN
 *
 * `DECISIONS.md` D-09 records that no skill subsystem existed and that the brief's "keep the
 * existing on-demand skill architecture" rested on a false premise. `TODO.md` PHASE 09 then
 * asked for the contract to be decided: what a skill IS, versus a capability, a tool and an
 * agent. The answer is a table, and it is the reason this is a new file rather than a mode of
 * an existing one:
 *
 * | Concept    | Cardinality        | Can reach authority            | Runs things |
 * ||------------|---------------------|-------------------------------|-------------|
 * | Capability | an atom (a name)    | no — it is a label             | no          |
 * | Tool       | ONE invokable call  | YES — `authorizeToolCall`      | yes         |
 * | Agent      | an executor         | YES — selectable, gets grants  | yes         |
 * | **Skill**  | a bundle of REQS    | **no — it can only ever refuse** | no        |
 *
 * A skill holds the capabilities it needs, the tools it needs, and the contract its input and
 * output obey. Loading it checks those requirements against a real caller and records the
 * attempt. That is the whole of it.
 *
 * ## WHY "IT DECLARES, IT DOES NOT CONFER" IS STRUCTURAL HERE
 *
 * `TODO.md` is explicit: "Skills must not become a way to grant authority. A skill declares
 * capabilities; it does not confer them." The dangerous implementation is the obvious one — a
 * skill that, when loaded, ADDS its capabilities to the caller's set — because then any skill
 * an operator installs is a privilege escalation, and the operator who installed it is the
 * operator who escalated.
 *
 * So the registry has no method that grants, confers, elevates or widens anything, and
 * `tests/skillContract.p09-evidence.test.ts` asserts that absence against the declaration. The
 * check runs in the safe direction only: loading can REFUSE, never confer.
 *
 * This is the same shape Phase 07 gave the memory trust floor (absent ⇒ `untrusted`) and Phase
 * 08 gave the executive port (forbidden actions are missing methods). It is the third time this
 * repository has had to write that rule down, which is itself the finding.
 *
 * ## WHY THERE IS NO BULK LOAD
 *
 * "On-demand loading only. Never bulk-load per task." A `loadAll()` would satisfy every word of
 * that sentence while violating it, so there is exactly one loading method and it takes one
 * skill. Also asserted structurally.
 *
 * ## WHY THIS PHASE BUILDS NO SKILL RUNTIME
 *
 * A skill here is a declaration plus an audited load. It does not execute, prompt a model, or
 * hold resources — because there is no runtime for it to execute in, and inventing one would be
 * the fabricated-capability shape `DECISIONS.md` D-53 and D-09 both exist to prevent. What is
 * real is the part that must be right before any runtime exists: the contract, the validation,
 * the direction of the authority check, and the audit record. A business workflow that actually
 * runs skills is PHASE 14.
 */

import type { CapabilitySet} from "../../capabilities/capability.js";
import { type Capability } from "../../capabilities/capability.js";
import { matchCapabilities } from "../../capabilities/match.js";
import { err, ok, type Result } from "../../core/result.js";

/* -------------------------------------------------------------------------- */
/* The declaration                                                              */
/* -------------------------------------------------------------------------- */

/** What a caller must already hold for a skill to be usable by them. */
export interface SkillCaller {
  /** What this caller can do. Checked; never extended. */
  readonly capabilities: CapabilitySet;
  /** Tool ids this caller may reach. Checked; never extended. */
  readonly toolIds: readonly string[];
  /** Workspace the load happened in, for the audit record. */
  readonly workspace: string;
}

/**
 * A skill, as declared.
 *
 * `requiredCapabilities` and `requiredTools` are REQUIREMENTS, and they are named that way in
 * the type on purpose: the field name is the first place a reader looks, and a field called
 * `capabilities` on something that confers nothing is how the confusion starts.
 */
export interface SkillDeclaration {
  readonly skillId: string;
  readonly version: string;
  /** What the skill is for. Must be non-empty: an undescribed skill cannot be reviewed. */
  readonly summary: string;
  /** Capabilities a caller must ALREADY hold. */
  readonly requiredCapabilities: readonly Capability[];
  /** Tool ids a caller must ALREADY be able to reach. */
  readonly requiredTools: readonly string[];
  /** Free-form, non-authoritative. Recorded, never enforced. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Why a load was refused. Never `null` on a refusal, so a log always says something. */
export type SkillLoadRefusal =
  | "unknown_skill"
  | "capability_not_held"
  | "tool_not_reachable"
  | "not_validated";

/**
 * One attempt at one load.
 *
 * Both outcomes are recorded. A log of successes is a log of what worked, and the entry worth
 * having is the one that was refused.
 */
export interface SkillLoadRecord {
  readonly skillId: string;
  readonly version: string | null;
  readonly workspace: string;
  readonly outcome: "loaded" | "refused";
  readonly refusal: SkillLoadRefusal | null;
  /** Human-readable, and always present on a refusal. */
  readonly reason: string | null;
  /** What was missing, by name. Empty on a successful load. */
  readonly missing: readonly string[];
  readonly at: number;
}

/** Where load records go. A function, so the registry depends on nothing. */
export type SkillLoadSink = (record: SkillLoadRecord) => void;

/** Why a registration was refused. */
export type SkillRegistrationRefusal =
  | "invalid_declaration"
  | "already_registered";

/* -------------------------------------------------------------------------- */
/* Validation                                                                   */
/* -------------------------------------------------------------------------- */

/** Same shape as the agent registry's, deliberately: one house convention for ids. */
const SKILL_ID = /^[A-Za-z0-9._-]{1,128}$/;
const SKILL_VERSION = /^[A-Za-z0-9.+-]{1,64}$/;

/**
 * Validates a declaration.
 *
 * Returns the reasons rather than a boolean, so a refusal can name every problem at once. A
 * caller who fixes one field at a time against a single-reason error is a caller who will
 * discover the rest in production.
 */
export function validateSkillDeclaration(declaration: SkillDeclaration): readonly string[] {
  const issues: string[] = [];
  if (typeof declaration.skillId !== "string" || !SKILL_ID.test(declaration.skillId)) {
    issues.push("skillId must be 1-128 characters of letters, digits, dot, underscore or dash");
  }
  if (typeof declaration.version !== "string" || !SKILL_VERSION.test(declaration.version)) {
    issues.push("version must be 1-64 characters of letters, digits, dot, plus or dash");
  }
  if (typeof declaration.summary !== "string" || declaration.summary.trim() === "") {
    // Not cosmetic. A skill nobody can describe is a skill nobody can review before
    // installing, and review is the only control this subsystem has.
    issues.push("summary must be non-empty: a skill that cannot be described cannot be reviewed");
  }
  if (!Array.isArray(declaration.requiredCapabilities)) {
    issues.push("requiredCapabilities must be an array");
  } else {
    for (const capability of declaration.requiredCapabilities) {
      if (typeof capability !== "string" || capability.trim() === "") {
        issues.push("a required capability must be a non-empty name");
      }
    }
  }
  if (!Array.isArray(declaration.requiredTools)) {
    issues.push("requiredTools must be an array");
  } else {
    for (const tool of declaration.requiredTools) {
      if (typeof tool !== "string" || tool.trim() === "") {
        issues.push("a required tool must be a non-empty name");
      }
    }
  }
  return issues;
}

/* -------------------------------------------------------------------------- */
/* The registry                                                                 */
/* -------------------------------------------------------------------------- */

export class SkillRegistryError extends Error {
  public constructor(
    public readonly refusal: SkillRegistrationRefusal,
    public readonly skillId: string,
    message: string,
    public readonly issues: readonly string[] = [],
  ) {
    super(message);
    this.name = "SkillRegistryError";
  }
}

export class SkillLoadError extends Error {
  public constructor(
    public readonly refusal: SkillLoadRefusal,
    public readonly skillId: string,
    message: string,
    public readonly missing: readonly string[] = [],
  ) {
    super(message);
    this.name = "SkillLoadError";
  }
}

/** What a successful load yields: the validated declaration, and nothing more. */
export interface LoadedSkill {
  readonly skillId: string;
  readonly version: string;
  readonly summary: string;
  /**
   * The requirements, echoed back.
   *
   * Echoed rather than dropped so a caller can see what it was just checked against, and
   * emphatically NOT merged into anything: there is no handle here that could widen a
   * capability set, because a declaration is data.
   */
  readonly requiredCapabilities: readonly Capability[];
  readonly requiredTools: readonly string[];
}

/**
 * The single source of truth for skills. One registry, as `TODO.md` requires.
 *
 * Platform-scoped, like `CapabilityRegistry` and `AdapterRegistry`: a skill DECLARATION is
 * deployment configuration — "this bundle needs these things" — not customer data. The
 * ACTIVITY is not, which is why every load is handed to a sink rather than kept here: the
 * registry holds configuration, and the partitioned record of who loaded what belongs in the
 * partitioned audit trail that `Phase 06` already established.
 */
export class SkillRegistry {
  readonly #skills = new Map<string, SkillDeclaration>();
  readonly #clock: { nowMs(): number };
  readonly #sink: SkillLoadSink | undefined;

  public constructor(options: { clock?: { nowMs(): number }; sink?: SkillLoadSink } = {}) {
    this.#clock = options.clock ?? { nowMs: () => Date.now() };
    this.#sink = options.sink;
  }

  /**
   * Registers a VALIDATED declaration.
   *
   * Validation happens HERE, at registration, and an invalid declaration is not stored at all.
   * The alternative — store it, check at load — leaves a window in which an invalid skill
   * exists in the registry and appears in `names()`, which is exactly the window a reviewer
   * would be looking at.
   */
  public register(declaration: SkillDeclaration): Result<true, SkillRegistryError> {
    const issues = validateSkillDeclaration(declaration);
    if (issues.length > 0) {
      return err(
        new SkillRegistryError(
          "invalid_declaration",
          typeof declaration.skillId === "string" ? declaration.skillId : "",
          `Skill "${String(declaration.skillId)}" was refused: ${issues.join("; ")}`,
          issues,
        ),
      );
    }
    const key = skillKey(declaration.skillId, declaration.version);
    if (this.#skills.has(key)) {
      return err(
        new SkillRegistryError(
          "already_registered",
          declaration.skillId,
          `Skill "${declaration.skillId}"@${declaration.version} is already registered; a re-registration must be a version change, because a silent replace would let an installed skill change under a caller who already reviewed the old one`,
        ),
      );
    }
    this.#skills.set(key, Object.freeze({ ...declaration }));
    return ok(true);
  }

  /** Whether a skill is registered. Says nothing about whether anyone may load it. */
  public has(skillId: string, version: string): boolean {
    return this.#skills.has(skillKey(skillId, version));
  }

  /** The declaration, or `null`. Not a load: this confers nothing and checks nothing. */
  public get(skillId: string, version: string): SkillDeclaration | null {
    return this.#skills.get(skillKey(skillId, version)) ?? null;
  }

  public names(): readonly string[] {
    return [...this.#skills.keys()];
  }

  public get size(): number {
    return this.#skills.size;
  }

  /**
   * Loads ONE skill for ONE caller, if that caller already holds what it needs.
   *
   * The only loading path, and it takes one skill. Every outcome — loaded, refused for a
   * missing capability, refused for a missing tool, refused because the skill is unknown — is
   * reported to the sink. Nothing here adds a capability to anything.
   */
  public load(skillId: string, version: string, caller: SkillCaller): Result<LoadedSkill, SkillLoadError> {
    const declaration = this.#skills.get(skillKey(skillId, version));

    if (declaration === undefined) {
      return this.#refuse(caller, skillId, version, "unknown_skill", `Skill "${skillId}"@${version} is not registered`, []);
    }

    // Direction of the check: the CALLER's capabilities against the skill's REQUIREMENTS.
    // Never the other way round, and never a merge. The reused matcher means "unknown"
    // behaves identically here and in agent selection, which is the point of having one
    // matcher.
    const match = matchCapabilities(declaration.requiredCapabilities, caller.capabilities);
    const missingCapabilities = [...match.gaps.map((gap) => gap.capability)];
    if (missingCapabilities.length > 0) {
      return this.#refuse(
        caller,
        skillId,
        version,
        "capability_not_held",
        `Caller does not hold the capabilities this skill requires: ${missingCapabilities.join(", ")}. A skill declares what a caller must already have; loading one never grants it.`,
        missingCapabilities,
      );
    }

    const reachable = new Set(caller.toolIds);
    const missingTools = declaration.requiredTools.filter((tool) => !reachable.has(tool));
    if (missingTools.length > 0) {
      return this.#refuse(
        caller,
        skillId,
        version,
        "tool_not_reachable",
        `Caller cannot reach the tools this skill requires: ${missingTools.join(", ")}`,
        missingTools,
      );
    }

    this.#sink?.({
      skillId,
      version,
      workspace: caller.workspace,
      outcome: "loaded",
      refusal: null,
      reason: null,
      missing: [],
      at: this.#clock.nowMs(),
    });

    return ok({
      skillId: declaration.skillId,
      version: declaration.version,
      summary: declaration.summary,
      requiredCapabilities: [...declaration.requiredCapabilities],
      requiredTools: [...declaration.requiredTools],
    });
  }

  #refuse(
    caller: SkillCaller,
    skillId: string,
    version: string,
    refusal: SkillLoadRefusal,
    reason: string,
    missing: readonly string[],
  ): Result<never, SkillLoadError> {
    this.#sink?.({
      skillId,
      version,
      workspace: caller.workspace,
      outcome: "refused",
      refusal,
      reason,
      missing: [...missing],
      at: this.#clock.nowMs(),
    });
    return err(new SkillLoadError(refusal, skillId, reason, missing));
  }
}

function skillKey(skillId: string, version: string): string {
  return `${skillId}@${version}`;
}

/**
 * A collector sink, for a caller that wants the records in memory.
 *
 * Exported because the audit record is a first-class shape and a caller should not have to
 * write a closure to hold one — and because the probe builds its own with it rather than
 * importing a test fixture.
 */
export function auditEvents(): { records: SkillLoadRecord[]; sink: SkillLoadSink } {
  const records: SkillLoadRecord[] = [];
  return {
    records,
    sink: (record: SkillLoadRecord): void => {
      records.push(record);
    },
  };
}
