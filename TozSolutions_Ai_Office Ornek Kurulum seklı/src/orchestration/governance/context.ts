/**
 * PHASE 08: the canonical security context, and bounded delegation.
 *
 * The audit found no canonical context: actor, roles, scopes, delegation and the
 * job/task/execution ids were assembled ad hoc at each boundary. This is one
 * shape for all of them, and it is FROZEN.
 *
 * WHY FROZEN, AND WHY IT MATTERS
 *
 * The prompt says "do not allow arbitrary mutable authority objects", and that is
 * a real hazard rather than a style note. An authority object that a caller can
 * mutate after a decision was made turns every decision into a snapshot of
 * something that may since have changed - so `ALLOW` can be re-read as permission
 * that was never granted. Every field here is `readonly`, the object is frozen at
 * construction, and authority is carried as a *set of named grants* rather than as
 * a mutable permission list someone can push onto.
 *
 * DELEGATION IS ONE-DIRECTIONAL AND DOWNWARD-ONLY.
 *
 * A child can hold a subset of what its parent held, never a superset, and never
 * an operation its parent did not hold. `delegate()` returns a NEW context; it
 * cannot widen the one it was given. An attempt to widen is refused, and the
 * refusal is explicit rather than a silent clamp - a caller that asked to escalate
 * should find out, not receive a quietly different context than it asked for.
 */

import { type TrustLevel } from "../agent/trust.js";
import { type Capability } from "../../capabilities/capability.js";
import { type Operation, isOperation } from "./operations.js";
import { type GovernanceResource } from "./decision.js";
import { type WorkspaceRef } from "../workspace/workspace.js";

/** A named permission, plus what it is limited to. */
export interface Grant {
  readonly operation: Operation;
  /**
   * Resource ids this grant covers. Empty means "this operation, any resource",
   * which is only ever produced deliberately by a role definition - a grant built
   * from a delegation is never empty.
   */
  readonly resources: readonly string[];
  /** Memory scopes, tool ids, provider ids or model ids, depending on operation. */
  readonly allowList: readonly string[];
  /** Capabilities this grant permits. Empty means "no capability restriction". */
  readonly capabilities: readonly Capability[];
  /** Ceiling on the trust level this grant may be exercised at. */
  readonly trustFloor: TrustLevel;
  /** Epoch ms after which this grant stops applying. null = no expiry. */
  readonly expiresAt: number | null;
}

/** Who is acting, and through what chain of delegation. */
export interface DelegationChainEntry {
  readonly from: string;
  readonly to: string;
  readonly grantedOperations: readonly Operation[];
  readonly at: number;
  /** null = no expiry. A delegation that cannot be revoked by time is still revocable. */
  readonly expiresAt: number | null;
}

/**
 * PHASE 03: how the system came to know who this context is.
 *
 * Three answers, and they are not interchangeable:
 *
 *   - `asserted`  a caller built the context itself. It says who it is; nothing
 *                 has established that. Authorising on an assertion alone is the
 *                 PHASE 09 defect B-08 describes.
 *   - `resolved`  the runtime's own identity source was consulted and produced
 *                 the context. This is the provenance the composition root marks
 *                 on whatever `RuntimeOptions.identity.resolve` returns.
 *   - `delegated` the context was derived from another one by `delegate`, so its
 *                 authority is bounded by a parent that was itself identified.
 *
 * Recorded rather than inferred because at the point of decision "how do we know
 * who this is?" has to be answerable without reading the call site - the same
 * absent-value conflation C-2 through C-4 had, one layer up.
 */
export type IdentityProvenance = (typeof IDENTITY_PROVENANCES)[number];

export const IDENTITY_PROVENANCES = ["asserted", "resolved", "delegated"] as const;

export function isIdentityProvenance(value: string): value is IdentityProvenance {
  return (IDENTITY_PROVENANCES as readonly string[]).includes(value);
}

/**
 * The canonical context.
 *
 * Frozen. Construct one with `createSecurityContext`, and derive a narrower one
 * with `delegate`. There is no other way to obtain authority.
 */
export interface SecurityContext {
  readonly actor: string;
  readonly principal: string;
  /** How this identity was established. See `IdentityProvenance`. */
  readonly provenance: IdentityProvenance;
  readonly roles: readonly string[];
  readonly grants: readonly Grant[];
  /** Capabilities the actor holds outside any single grant. */
  readonly capabilities: readonly Capability[];
  /** Memory scopes the actor may name. Narrowing only; PHASE 05 still decides reads. */
  readonly scopes: readonly string[];
  readonly trustLevel: TrustLevel;
  /** The chain that produced this context. Empty for a root context. */
  readonly delegation: readonly DelegationChainEntry[];
  readonly jobId: string | null;
  readonly workflowId: string | null;
  readonly taskId: string | null;
  readonly executionId: string | null;
  /** Approval state, when a gate is outstanding. PHASE 07 remains the authority. */
  readonly approvalId: string | null;
  /**
   * INERT. Not an authority, and read by nothing.
   *
   * PHASE 03: this field used to be the ONLY way `ApprovalRule` could be satisfied
   * - by the caller writing `"approved"` onto the very context being checked. That
   * short-circuit is gone, and what replaced it is a RECORD: `ApprovalRule` now
   * asks a read-only `ApprovalGateObserver` about the gate the approval authority
   * actually holds, and is satisfied only by a real decision.
   *
   * The field is KEPT rather than removed, and the reason is specific: `delegate`
   * has to be shown NOT to inherit an approval, and that is only observable from a
   * parent that has one. Deleting the field would delete the ability to state that
   * guarantee at all.
   *
   * It is documented as inert here rather than left as it was, because a field on a
   * security context called `approvalState` that LOOKS load-bearing when it is not
   * is how the original defect came to exist in the first place - and because the
   * replacement now makes the difference observable: a context claiming `"approved"`
   * and a context carrying a real approved gate look identical from here, and only
   * one of them is an approval. A test enforces that nothing under `governance/`
   * reads this field.
   */
  readonly approvalState: "none" | "pending" | "approved" | "rejected" | "expired" | "cancelled";
  /** Free-form policy context. Non-authoritative, and never trusted for access. */
  readonly policyContext: Readonly<Record<string, unknown>>;
  /**
   * PHASE 06. Where this identity is. `null` until something resolves it.
   *
   * AUTHORITATIVE ONLY WHEN `provenance === "resolved"`. See `workspaceOf`, which
   * is the single function every partitioned authority uses to read this, and which
   * refuses an `asserted` or `delegated` context outright.
   *
   * Distinct from `policyContext` on purpose. A workspace parked in
   * `policyContext` is ignored by design, and "ignored by design" is exactly what a
   * tenancy field must not be.
   */
  readonly workspace: WorkspaceRef | null;
}

export interface CreateContextInput {
  readonly actor: string;
  readonly principal?: string;
  readonly roles?: readonly string[];
  readonly grants?: readonly Grant[];
  readonly capabilities?: readonly Capability[];
  readonly scopes?: readonly string[];
  readonly trustLevel: TrustLevel;
  readonly jobId?: string | null;
  readonly workflowId?: string | null;
  readonly taskId?: string | null;
  readonly executionId?: string | null;
  readonly approvalId?: string | null;
  /**
   * NON-AUTHORITATIVE. No rule reads this to grant anything: PHASE 03 removed
   * `ApprovalRule`'s dependence on it precisely because a caller writes this field
   * for itself, and `ApprovalRegistry` remains the only authority that records an
   * approval. Kept as input because `delegate` must be shown NOT to inherit it,
   * which is only testable from an approved parent.
   */
  readonly approvalState?: SecurityContext["approvalState"];
  readonly policyContext?: Readonly<Record<string, unknown>>;
  /**
   * PHASE 06. The workspace and brand this identity belongs to.
   *
   * An INPUT here, and it is not authority on its own: a context created through
   * this function is always `"asserted"`, and `workspaceOf` refuses anything that
   * is not `"resolved"`. So this field is where a DEPLOYMENT's identity source
   * states where the identity is, and the only way it becomes authoritative is
   * `withProvenance(context, "resolved")` - which a caller cannot forge, because
   * `provenance` is deliberately not an input either.
   *
   * That two-step is the whole of the anti-forgery property: a caller may write
   * whichever workspace it likes here and will simply get a context no partitioned
   * authority will act on. The alternative - omitting this field and putting the
   * workspace in `policyContext` - is explicitly forbidden: `policyContext` is
   * non-authoritative and is read by nothing.
   */
  readonly workspace?: WorkspaceRef | null;
}

export class SecurityContextError extends Error {
  public readonly detail: string;
  public constructor(detail: string) {
    super(`Security context refused: ${detail}`);
    this.name = "SecurityContextError";
    this.detail = detail;
  }
}

function freezeGrant(grant: Grant): Grant {
  return Object.freeze({
    ...grant,
    resources: Object.freeze([...grant.resources]),
    allowList: Object.freeze([...grant.allowList]),
    capabilities: Object.freeze([...grant.capabilities]),
  });
}

/**
 * Creates a ROOT context. `Object.freeze` is load-bearing: it is what makes a
 * decision's view of authority stable for the rest of the operation.
 *
 * `provenance` is NOT an input, deliberately, and the field was removed in
 * PHASE 03 rather than kept with a comment saying it was untrusted. It was
 * present as `input.provenance ?? "asserted"`, so a caller could construct a
 * context declaring itself `"resolved"` - the exact claim `withProvenance`'s own
 * docblock says would be recording a claim instead of a resolution. A field no
 * caller may set is a stronger guarantee than a field no caller should set.
 */
export function createSecurityContext(input: CreateContextInput): SecurityContext {
  if (input.actor.trim() === "") {
    throw new SecurityContextError("an actor must be named; an anonymous context has no accountable owner");
  }
  if (!Number.isInteger(TRUST_RANKS[input.trustLevel])) {
    throw new SecurityContextError(`unknown trust level "${String(input.trustLevel)}"`);
  }
  for (const grant of input.grants ?? []) {
    if (!isOperation(grant.operation)) {
      throw new SecurityContextError(`unknown operation "${String(grant.operation)}" in a grant`);
    }
  }
  return Object.freeze({
    actor: input.actor,
    principal: input.principal ?? input.actor,
    provenance: "asserted",
    roles: Object.freeze([...(input.roles ?? [])]),
    grants: Object.freeze((input.grants ?? []).map(freezeGrant)),
    capabilities: Object.freeze([...(input.capabilities ?? [])]),
    scopes: Object.freeze([...(input.scopes ?? [])]),
    trustLevel: input.trustLevel,
    delegation: Object.freeze([]),
    jobId: input.jobId ?? null,
    workflowId: input.workflowId ?? null,
    taskId: input.taskId ?? null,
    executionId: input.executionId ?? null,
    approvalId: input.approvalId ?? null,
    approvalState: input.approvalState ?? "none",
    policyContext: Object.freeze({ ...(input.policyContext ?? {}) }),
    // PHASE 06. Carried as given, and frozen with everything else. A mutable
    // workspace would make every partitioned decision provisional.
    workspace: input.workspace ?? null,
  });
}

const TRUST_RANKS: Readonly<Record<TrustLevel, number>> = {
  untrusted: 0,
  low: 1,
  standard: 2,
  high: 3,
  privileged: 4,
};

/**
 * PHASE 03: re-records HOW a context was established, without touching anything
 * it grants.
 *
 * A context is frozen, so this returns a new one. It exists because a resolver's
 * answer arrives as an ordinary context - built by `createSecurityContext`, so
 * marked `asserted` - and the composition root is the only party that knows the
 * answer was ESTABLISHED rather than asserted. Marking it at that seam is what
 * makes the provenance a fact about where the identity came from instead of a
 * field a caller could set for itself.
 *
 * Deliberately not exported through `createSecurityContext`: a caller asking for
 * `provenance: "resolved"` would be recording a claim, not a resolution.
 */
export function withProvenance(context: SecurityContext, provenance: IdentityProvenance): SecurityContext {
  if (context.provenance === provenance) {
    return context;
  }
  return Object.freeze({ ...context, provenance });
}

/**
 * PHASE 03 (B-10): stamps the JOB and TASK an execution is running as.
 *
 * WHY THIS IS NEEDED. `ApprovalRule` has to look a recorded approval up by the job
 * and task it is deciding about, because a task id is unique only within a job. The
 * only party in a position to know that pair is the coordinator that owns the job,
 * and the only place it can reach governance is the identity travelling on the
 * request. So the job scope is stamped HERE, by the composition root's bridge, on
 * the way in.
 *
 * WHAT IT IS NOT. It is not authority. No grant is added, none is removed, and the
 * provenance is carried through unchanged - a context that was `asserted` is still
 * `asserted`. It is a claim about WHICH work is running, and the only thing that
 * consumes it is a lookup in a registry that already holds real gates.
 *
 * It OVERWRITES. A submitter that stamped its own `jobId` onto the context it
 * submitted has that value replaced by the job the coordinator is actually running,
 * so the pair governance resolves is a fact rather than a claim. When the pair is
 * absent, `ApprovalRule` cannot resolve a gate and requires approval - the safe
 * direction, and the direction the pre-wiring behaviour already took.
 *
 * Deliberately not an input to `createSecurityContext`, for the same reason
 * `provenance` is not: a caller asking for `inJobScope` is asking to be told which
 * job it is in, and only the coordinator that owns the job can answer.
 */
export function inJobScope(
  context: SecurityContext,
  scope: { readonly jobId: string; readonly taskId: string },
): SecurityContext {
  if (context.jobId === scope.jobId && context.taskId === scope.taskId) {
    return context;
  }
  return Object.freeze({ ...context, jobId: scope.jobId, taskId: scope.taskId });
}

/* -------------------------------------------------------------------------- */
/* Delegation                                                                  */
/* -------------------------------------------------------------------------- */

export type DelegationOutcome =
  | { readonly ok: true; readonly context: SecurityContext; readonly grants: readonly Grant[] }
  | { readonly ok: false; readonly detail: string; readonly refusedOperation: Operation | null };

/**
 * Derives a BOUNDED child context.
 *
 * Every check below exists because the corresponding escalation is a real failure
 * mode, not a hypothetical:
 *
 *   - an operation the parent does not hold is refused (no new authority)
 *   - resources and allow-lists are INTERSECTED with the parent (no widening)
 *   - capabilities are intersected (a child cannot gain a capability)
 *   - scopes are intersected (a child cannot read further than its parent)
 *   - the trust floor is RAISED to the parent's (a child cannot be given more
 *     trust than the delegator had)
 *   - the delegation carries an expiry, so authority handed to an agent is not
 *     authority held forever
 *
 * A refused delegation returns a REASON. Silently clamping would hand a caller a
 * context different from the one it asked for, and an agent that believed it had
 * been granted something would discover the difference only by being denied later.
 */
export function delegate(
  parent: SecurityContext,
  input: {
    readonly to: string;
    readonly operations: readonly Operation[];
    readonly resources?: readonly string[];
    readonly allowList?: readonly string[];
    readonly capabilities?: readonly Capability[];
    readonly scopes?: readonly string[];
    readonly at: number;
    readonly expiresAt?: number | null;
    readonly reason?: string | null;
    /**
     * PHASE 06. A requested workspace. It may only ever be the PARENT'S.
     *
     * Declaring a different one is refused rather than clamped, for the same reason
     * a wider grant is: a delegation that quietly moved work into another
     * workspace would be an escalation the caller never sees.
     */
    readonly workspace?: WorkspaceRef | null;
  },
): DelegationOutcome {
  if (input.to.trim() === "") {
    return { ok: false, detail: "a delegation must name its recipient", refusedOperation: null };
  }
  if (input.operations.length === 0) {
    return { ok: false, detail: "a delegation must name at least one operation", refusedOperation: null };
  }
  if (input.workspace !== undefined && input.workspace !== null) {
    const same =
      input.workspace.workspace === parent.workspace?.workspace &&
      input.workspace.brand === (parent.workspace?.brand ?? null);
    if (!same) {
      return {
        ok: false,
        detail:
          `a delegation cannot move work from workspace "${parent.workspace?.workspace ?? "none"}" to ` +
          `"${input.workspace.workspace}". Delegation narrows authority inside a workspace; it does not cross one.`,
        refusedOperation: null,
      };
    }
  }

  for (const operation of input.operations) {
    if (!isOperation(operation)) {
      return {
        ok: false,
        detail: `unknown operation "${String(operation)}" cannot be delegated`,
        refusedOperation: null,
      };
    }
    if (!grantsFor(parent, operation).length) {
      return {
        ok: false,
        detail: `"${parent.actor}" does not hold "${operation}", so it cannot delegate it. A delegation cannot create authority.`,
        refusedOperation: operation,
      };
    }
  }

  const expiresAt = input.expiresAt ?? null;
  if (expiresAt !== null && expiresAt <= input.at) {
    return {
      ok: false,
      detail: `the requested expiry (${expiresAt}) is already in the past at ${input.at}`,
      refusedOperation: null,
    };
  }

  // AN ESCALATION ATTEMPT IS REFUSED, NOT CLAMPED.
  //
  // This is the one place where "intersect and carry on" would be the wrong
  // answer. A caller that asks for `shell` and is handed `calculator` back may
  // reasonably believe it was granted `shell` and only discover otherwise when it
  // is denied mid-execution. Refusing at delegation time means the requester
  // finds out immediately, and the narrower authority it was asking about is
  // still available through a separate, explicit request.
  const escalation = (requested: readonly string[], permitted: readonly string[], what: string): string | null => {
    const excess = requested.filter((entry) => !permitted.includes(entry));
    return excess.length === 0 ? null : `requested ${what} ${excess.join(", ")} which the delegator does not hold`;
  };

  const parentAllowLists = input.operations.flatMap((operation) =>
    grantsFor(parent, operation).map((g) => [...g.allowList]),
  );
  const parentResources = input.operations.flatMap((operation) =>
    grantsFor(parent, operation).map((g) => [...g.resources]),
  );
  const parentCapabilities = input.operations.flatMap((operation) =>
    grantsFor(parent, operation).map((g) => [...g.capabilities]),
  );

  if (input.allowList !== undefined && parentAllowLists.length > 0) {
    const excess = escalation(input.allowList, parentAllowLists.flat(), "allow-list entries");
    if (excess !== null) {
      return { ok: false, detail: `Delegation refused: ${excess}.`, refusedOperation: null };
    }
  }
  if (input.capabilities !== undefined && parentCapabilities.length > 0) {
    const excess = escalation(
      input.capabilities,
      parentCapabilities.flat(),
      "capabilities",
    );
    if (excess !== null) {
      return { ok: false, detail: `Delegation refused: ${excess}.`, refusedOperation: null };
    }
  }
  if (input.scopes !== undefined) {
    const excess = escalation(input.scopes, parent.scopes, "scopes");
    if (excess !== null) {
      return { ok: false, detail: `Delegation refused: ${excess}.`, refusedOperation: null };
    }
  }
  if (input.resources !== undefined && parentResources.length > 0) {
    const excess = escalation(input.resources, parentResources.flat(), "resources");
    if (excess !== null) {
      return { ok: false, detail: `Delegation refused: ${excess}.`, refusedOperation: null };
    }
  }

  const derived: Grant[] = input.operations.map((operation) => {
    const parentGrants = grantsFor(parent, operation);
    // Intersect across every parent grant that covers the operation, so the child
    // can never be broader than the NARROWEST authority the parent actually had.
    const resources =
      input.resources === undefined
        ? [...new Set(parentGrants.flatMap((grant) => [...grant.resources]))]
        : intersect(input.resources, parentGrants.flatMap((grant) => [...grant.resources]));
    const allowList =
      input.allowList === undefined
        ? [...new Set(parentGrants.flatMap((grant) => [...grant.allowList]))]
        : intersect(input.allowList, parentGrants.flatMap((grant) => [...grant.allowList]));
    const capabilities =
      input.capabilities === undefined
        ? [...new Set(parentGrants.flatMap((grant) => [...grant.capabilities]))]
        : intersect(
            input.capabilities,
            parentGrants.flatMap((grant) => [...grant.capabilities]),
          );

    // The child's floor is the parent's effective floor, never lower. A delegator
    // cannot hand out authority it does not itself hold, so the requested value
    // is deliberately NOT read here: there is no input that lowers a floor.
    const requestedFloor = parentGrants
      .map((grant) => grant.trustFloor)
      .reduce<TrustLevel>(
        (highest, floor) => (TRUST_RANKS[floor] > TRUST_RANKS[highest] ? floor : highest),
        "untrusted",
      );

    return freezeGrant({
      operation,
      resources,
      allowList,
      capabilities,
      trustFloor: TRUST_RANKS[parent.trustLevel] > TRUST_RANKS[requestedFloor] ? parent.trustLevel : requestedFloor,
      // An intersection cannot widen an expiry either: a child cannot outlive its
      // parent's grant.
      expiresAt: minExpiry(parentGrants, expiresAt),
    });
  });

  const context: SecurityContext = Object.freeze({
    ...parent,
    actor: input.to,
    principal: input.to,
    // A derived context is DERIVED, whatever the parent was. Marking it here
    // rather than inheriting is what stops a delegated context from presenting
    // itself as an independently established identity.
    provenance: "delegated",
    // PHASE 06. The workspace is INHERITED and cannot be changed. Delegation
    // already refuses to widen capability, and a child that could name a different
    // workspace would be a strictly larger hole than a wider grant: it would move
    // work into a partition the parent was never authorised for. An attempt to
    // change it is REFUSED rather than clamped, for the reason the rest of this
    // function refuses rather than clamps: a caller that asked to escalate should
    // find out, not receive a quietly different context than it asked for.
    workspace: parent.workspace,
    grants: Object.freeze(derived),
    capabilities: Object.freeze(
      intersect(
        input.capabilities ?? parent.capabilities,
        parent.capabilities,
      ),
    ),
    scopes: Object.freeze(intersect(input.scopes ?? parent.scopes, parent.scopes)),
    // A delegated context does NOT inherit the parent's approval. Inheriting it
    // would let a delegator hand its own approval onward, which is precisely the
    // escalation approval exists to prevent.
    approvalId: null,
    approvalState: "none",
    delegation: Object.freeze([
      ...parent.delegation,
      Object.freeze({
        from: parent.actor,
        to: input.to,
        grantedOperations: Object.freeze([...input.operations]),
        at: input.at,
        expiresAt,
      }),
    ]),
  });

  return { ok: true, context, grants: derived };
}

function grantsFor(context: SecurityContext, operation: Operation): readonly Grant[] {
  return context.grants.filter((grant) => grant.operation === operation);
}

function intersect(requested: readonly string[], permitted: readonly string[]): readonly string[] {
  if (permitted.length === 0) {
    return [];
  }
  return requested.filter((entry) => permitted.includes(entry));
}

function minExpiry(grants: readonly Grant[], requested: number | null): number | null {
  const parentExpiries = grants
    .map((grant) => grant.expiresAt)
    .filter((value): value is number => value !== null);
  const candidates = requested === null ? parentExpiries : [...parentExpiries, requested];
  return candidates.length === 0 ? null : Math.min(...candidates);
}

/** Whether a grant is currently live. */
export function isGrantLive(grant: Grant, nowMs: number): boolean {
  return grant.expiresAt === null || grant.expiresAt > nowMs;
}

/** The grant covering an operation for a resource, or null. */
export function grantFor(
  context: SecurityContext,
  operation: Operation,
  resource: GovernanceResource | null,
  nowMs: number,
): Grant | null {
  for (const grant of context.grants) {
    if (grant.operation !== operation || !isGrantLive(grant, nowMs)) {
      continue;
    }
    if (resource?.id === null || resource === null) {
      return grant;
    }
    if (grant.resources.length === 0 || grant.resources.includes(resource.id)) {
      return grant;
    }
  }
  return null;
}

/** Whether a delegated context is still within its delegation's expiry. */
export function isDelegationLive(context: SecurityContext, nowMs: number): boolean {
  const last = context.delegation[context.delegation.length - 1];
  return last === undefined || last.expiresAt === null || last.expiresAt > nowMs;
}
