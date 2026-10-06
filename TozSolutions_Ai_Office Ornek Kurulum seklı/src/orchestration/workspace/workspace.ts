/**
 * PHASE 06 - Workspace / brand identity.
 *
 * WHY THIS MODULE EXISTS, AND WHY IT IS THIS SMALL
 *
 * `docs/FINAL_ARCHITECTURE.md` §23 classified the system **D - unsafe for
 * multi-tenant deployment**: unpartitioned *and* undeclared, so the failure was
 * silent. This module is the whole of the *identity* half of the answer. The
 * *enforcement* half lives where the data is, because enforcement that lives in
 * one place and is applied in another is the exact defect PHASE 01 found as C-1
 * ("the exclusion is applied somewhere" is not "the exclusion is applied on the
 * path").
 *
 * So: this module answers ONE question - "which workspace and brand is this?"
 * - and provides the one function every partitioned store uses to build a key.
 * It deliberately holds no registry, resolves nothing, and reads no environment,
 * no filename, no global and no ambient state. A workspace can only be obtained
 * from a SECURITY CONTEXT, and only a resolved one (see `workspaceOf`).
 *
 * WHY IT IS NOT UNDER `governance/`
 *
 * Two architectural tests constrain this:
 *   - the workflow layer must contain zero references to `governance/`, and
 *   - the memory layer must contain zero references to the word `governance`.
 * Both layers need the workspace key, so the type lives in neither of theirs.
 *
 * WHY A `brand` MAY BE NULL
 *
 * A workspace is the unit that must be present for any partitioned decision; a
 * brand is a subdivision a deployment may not use. `null` brand therefore means
 * "the whole workspace", and it is NOT a wildcard: a brandless key and a
 * brand-specific key are different keys, so a brandless grant cannot read a
 * branded memory entry. That asymmetry is deliberate and is asserted by test.
 */

import { ValidationError } from "../../core/errors.js";

/**
 * The authoritative workspace and brand.
 *
 * FROZEN at construction, like every other authority object in this repository,
 * because a workspace that can be mutated after a decision has been made turns
 * that decision into a snapshot of something that has since changed.
 */
export interface WorkspaceRef {
  /** Non-empty, and the unit of partition. */
  readonly workspace: string;
  /** `null` means "the whole workspace", never "any workspace". */
  readonly brand: string | null;
}

const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;

export class WorkspaceRefError extends ValidationError {
  public constructor(message: string, issues: readonly string[]) {
    super(message, issues);
    this.name = "WorkspaceRefError";
  }
}

/**
 * Builds a frozen `WorkspaceRef`, refusing anything free-form.
 *
 * A workspace id that could be an arbitrary string would be a caller-supplied
 * identifier asserting membership, which is the thing this phase exists to
 * prevent. The character set is the same one the tool registry uses for ids, and
 * a blank or whitespace-only value is a refusal rather than a trim: silently
 * normalising an identity is how " acme" and "acme" become two workspaces.
 */
export function workspaceRef(workspace: string, brand?: string | null): WorkspaceRef {
  const issues: string[] = [];
  if (typeof workspace !== "string" || !IDENTIFIER.test(workspace)) {
    issues.push(
      `workspace must be 1-128 characters of letters, digits, dot, underscore, colon or dash: ${JSON.stringify(workspace)}`,
    );
  }
  const hasBrand = brand !== undefined && brand !== null;
  if (hasBrand && (typeof brand !== "string" || !IDENTIFIER.test(brand))) {
    issues.push(
      `brand must be 1-128 characters of letters, digits, dot, underscore, colon or dash: ${JSON.stringify(brand)}`,
    );
  }
  if (issues.length > 0) {
    throw new WorkspaceRefError("Workspace reference is invalid", issues);
  }
  return Object.freeze({ workspace, brand: hasBrand ? brand : null });
}

export function isWorkspaceRef(value: unknown): value is WorkspaceRef {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { workspace?: unknown; brand?: unknown };
  return (
    typeof candidate.workspace === "string" &&
    IDENTIFIER.test(candidate.workspace) &&
    (candidate.brand === null || (typeof candidate.brand === "string" && IDENTIFIER.test(candidate.brand)))
  );
}

/**
 * The composite key every partitioned store is built on.
 *
 * WHY A KEY AND NOT A FILTER. Row-level scoping means every query is a chance to
 * forget the filter, and this repository has already shipped that bug twice (C-1
 * discarded a denial list before it reached the router; PHASE 05 found a routing
 * policy that governed the chain but not the primary). Putting the workspace in
 * the KEY means a cross-workspace lookup is not filtered out - it **misses**,
 * because there is no un-partitioned key to find it with. The failure mode
 * becomes a wrong answer rather than a right answer applied too widely.
 *
 * The separator is U+0000 and the segments are length-prefixed, so no pair of
 * values can produce the same key: `workspace("a:b", "c")` and
 * `workspace("a", "b:c")` are different keys, which a bare join would have made
 * identical.
 *
 * `null` is the UNATTRIBUTED partition and gets its own head - `0:` - which no real
 * workspace can produce, because `workspace` is a non-empty identifier. So a store
 * composed without a workspace holds unattributed entries and does not answer for a
 * real one, and the two can never collide.
 */
export function workspaceKey(workspace: WorkspaceRef | null, ...parts: readonly string[]): string {
  const head =
    workspace === null
      ? "0:\u0000-"
      : `${workspace.workspace.length}:${workspace.workspace}\u0000${
          workspace.brand === null ? "-" : `${workspace.brand.length}:${workspace.brand}`
        }`;
  return [head, ...parts].join("\u0001");
}

/** Raised when partitioned work is attempted with no verified workspace. */
export class WorkspaceIsolationError extends Error {
  public readonly reason: "no-workspace" | "unresolved-provenance" | "no-context";
  public constructor(reason: "no-workspace" | "unresolved-provenance" | "no-context", detail: string) {
    super(detail);
    this.name = "WorkspaceIsolationError";
    this.reason = reason;
  }
}

/** The shape this module needs. Structural, so it depends on no other layer. */
export interface WorkspaceBearing {
  readonly provenance: string;
  readonly workspace?: WorkspaceRef | null;
}

/**
 * The ONLY way a partitioned authority obtains a workspace.
 *
 * Four rules, each of which closes a specific hole:
 *
 *  1. No context at all is a refusal. Absent is not "the default workspace".
 *  2. No workspace on the context is a refusal. A context that says who without
 *     saying where cannot authorise partitioned work.
 *  3. `provenance` must be `"resolved"`. This is the rule that stops a caller
 *     asserting membership by supplying an id: an `asserted` context is a
 *     CLAIM about a workspace, and a claim is not an identity. There is no
 *     authentication in this repository (B-05 is open), so "resolved" means "the
 *     deployment's identity source said so" - which is the strongest statement
 *     available without inventing one, and is recorded as such.
 *  4. The workspace must be a well-formed, frozen `WorkspaceRef`. A hand-rolled
 *     object shaped like one is refused rather than trusted.
 *
 * A DELEGATED context is refused by rule 3, and that is a real limitation rather
 * than an oversight: delegation narrows *capability* and cannot establish
 * *identity*, so a delegated context has no verified workspace of its own. Until
 * B-05 gives delegation a provenance of its own, delegated work is refused for
 * partitioned operations.
 */
export function workspaceOf(context: WorkspaceBearing | null | undefined): WorkspaceRef {
  if (context === null || context === undefined) {
    throw new WorkspaceIsolationError(
      "no-context",
      "Partitioned work requires a security context, and none was supplied. " +
        "An absent identity is not an identity.",
    );
  }
  if (context.provenance !== "resolved") {
    throw new WorkspaceIsolationError(
      "unresolved-provenance",
      `Partitioned work requires an identity this system resolved, and this context is "${context.provenance}". ` +
        "A caller cannot assert membership in a workspace merely by supplying its id.",
    );
  }
  const workspace = context.workspace;
  if (workspace === null || workspace === undefined) {
    throw new WorkspaceIsolationError(
      "no-workspace",
      `Identity "${context.provenance}" carries no workspace. A context that says who without saying where ` +
        "cannot authorise partitioned work.",
    );
  }
  if (!isWorkspaceRef(workspace) || !Object.isFrozen(workspace)) {
    throw new WorkspaceIsolationError(
      "no-workspace",
      "The workspace reference on this context is not a frozen, well-formed WorkspaceRef. " +
        "Partitioned work refuses a hand-rolled one rather than trusting its shape.",
    );
  }
  return workspace;
}

/** Non-throwing form, for call sites that return a `Result`. */
export function tryWorkspaceOf(
  context: WorkspaceBearing | null | undefined,
): { ok: true; workspace: WorkspaceRef } | { ok: false; error: WorkspaceIsolationError } {
  try {
    return { ok: true, workspace: workspaceOf(context) };
  } catch (error) {
    if (error instanceof WorkspaceIsolationError) {
      return { ok: false, error };
    }
    throw error;
  }
}
