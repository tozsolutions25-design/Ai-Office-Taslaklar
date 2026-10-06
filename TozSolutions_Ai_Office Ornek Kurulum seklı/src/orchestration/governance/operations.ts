/**
 * PHASE 08: the operation catalogue.
 *
 * THE REASON THIS FILE EXISTS.
 *
 * The audit found no centralised permission catalogue anywhere. Authorization was
 * decided with three unrelated vocabularies: `ToolPermission` in `tool.ts`,
 * `MemoryGrant` in `memory.ts`, and `approvalStatus` in `providers/registry.ts`.
 * Three shapes, one shared idea, and no way to ask "may this actor do this thing?"
 * in one vocabulary.
 *
 * Every operation a governed subsystem can be asked about is named here, once.
 * Nothing else in the codebase may mint an operation string: a permission checked
 * as `"tool.invoke"` in one place and `"tools:invoke"` in another is two
 * permissions with a typo between them, and the typo reads as a denial - or worse,
 * as an allowance.
 *
 * `SECURITY_SENSITIVE` marks the operations that are default-deny. That flag is
 * what keeps section 6 of the brief honest without imposing default-deny on
 * unrelated internal mechanics: `MemoryAccessPolicy` still answers memory
 * questions with PHASE 05's own rules, and governance adds a second gate rather
 * than replacing one that already works.
 */

/** Every governed operation, named once. */
export const OPERATIONS = [
  "agent.execute",
  "capability.execute",
  "tool.invoke",
  "provider.use",
  "model.use",
  "memory.read",
  "memory.write",
  "memory.capture",
  "workflow.create",
  "workflow.execute",
  "workflow.cancel",
  "workflow.configure",
  "approval.request",
  "approval.resolve",
  "resource.consume",
  "admin.configure",
] as const;

export type Operation = (typeof OPERATIONS)[number];

export function isOperation(value: unknown): value is Operation {
  return typeof value === "string" && (OPERATIONS as readonly string[]).includes(value);
}

/**
 * Operations that are DEFAULT-DENY.
 *
 * An unknown actor, an unknown permission, or a malformed context is refused
 * outright rather than allowed because nothing said otherwise. That is the whole
 * point: the safe reading of "nobody said" must be "no".
 *
 * Every operation in the catalogue is listed, rather than a subset, because every
 * one of them moves authority or data. A new operation added to `OPERATIONS`
 * without a decision here is therefore a compile-time-adjacent omission rather
 * than a silent pass - `assertCatalogueIsClassified` in the tests asserts the two
 * lists never drift apart.
 */
export const SECURITY_SENSITIVE_OPERATIONS: Readonly<Record<Operation, boolean>> = {
  "agent.execute": true,
  "capability.execute": true,
  "tool.invoke": true,
  "provider.use": true,
  "model.use": true,
  "memory.read": true,
  "memory.write": true,
  "memory.capture": true,
  "workflow.create": true,
  "workflow.execute": true,
  "workflow.cancel": true,
  "workflow.configure": true,
  "approval.request": true,
  "approval.resolve": true,
  "resource.consume": true,
  "admin.configure": true,
};

export function isSecuritySensitive(operation: Operation): boolean {
  return SECURITY_SENSITIVE_OPERATIONS[operation];
}

/**
 * Which trust floor each operation demands.
 *
 * Reuses the EXISTING `TRUST_LEVELS` ladder rather than inventing an authority
 * scale. The floors are a DEFAULT, and an operator can raise any of them through
 * policy; what is not negotiable is that `admin.configure` sits at `privileged`,
 * because a governance bypass reachable at low trust defeats the subsystem.
 */
export const DEFAULT_TRUST_FLOORS: Readonly<Record<Operation, string>> = {
  "agent.execute": "standard",
  "capability.execute": "standard",
  "tool.invoke": "standard",
  "provider.use": "standard",
  "model.use": "standard",
  "memory.read": "standard",
  "memory.write": "standard",
  "memory.capture": "standard",
  "workflow.create": "standard",
  "workflow.execute": "standard",
  "workflow.cancel": "standard",
  "workflow.configure": "high",
  "approval.request": "standard",
  "approval.resolve": "privileged",
  "resource.consume": "standard",
  // Configuring governance itself is the operation that must not be reachable
  // from a low-trust actor, or every other rule here is advisory.
  "admin.configure": "privileged",
};

/** Operations whose grant is required to be scoped rather than blanket. */
export const RESOURCE_BEARING_OPERATIONS: Readonly<Record<Operation, boolean>> = {
  "agent.execute": true,
  "capability.execute": true,
  "tool.invoke": true,
  "provider.use": true,
  "model.use": true,
  "memory.read": true,
  "memory.write": true,
  "memory.capture": true,
  "workflow.create": false,
  "workflow.execute": true,
  "workflow.cancel": true,
  "workflow.configure": false,
  "approval.request": true,
  "approval.resolve": true,
  "resource.consume": true,
  "admin.configure": false,
};

/* -------------------------------------------------------------------------- */
/* Which operations the brief says need a human                                */
/* -------------------------------------------------------------------------- */

/**
 * PHASE 04: the brief's six categories, mapped onto the catalogue.
 *
 * `MASTER_PLAN.md` §2.6 names them in prose - "Publishing, spending, sending,
 * irreversible external change, binding acts, privilege escalation" - and §8.6
 * makes it a requirement of done: "A human approval is required for every
 * irreversible or outbound action". Prose is not something a policy engine can
 * consult, so each category is mapped onto real operations here.
 *
 * THIS IS A CLASSIFICATION, NOT A SWITCH. `governance.approvalRequired` remains the
 * only thing that turns an operation into `REQUIRE_APPROVAL`, exactly as it was
 * before this map existed, and `ApprovalRule` reads nothing from here. What the map
 * is for is the opposite direction: it makes it measurable whether a deployment has
 * turned on the operations the brief names, so "the brief says a human is required"
 * and "this deployment requires a human" cannot be mistaken for each other.
 * `describe()` reports both sets and the gap between them.
 */
export interface HumanApprovalCategory {
  /** The brief's own words, lowercased and hyphenated for stability. */
  readonly category: string;
  /** The catalogue operations that satisfy this category. */
  readonly operations: readonly Operation[];
}

/**
 * THE RULE, stated once so the `false` entries are decisions rather than omissions.
 *
 * An operation needs a human when performing it **commits the organisation to
 * something outside the system**: an outbound call to a third party, an irreversible
 * mutation of external state, spend of a resource, or a change to the authority
 * that governs all of it.
 *
 * Everything the system does to ITSELF is not in that set, and the brief says why:
 * imposing approval on unrelated internal mechanics turns a control into an
 * obstacle, and a gate that fires on everything is a gate nobody answers.
 *
 * The `false` entries, each with its reason, because these are the debatable ones:
 *
 *   - `workflow.execute` is the VEHICLE, not the act. A job that runs research and
 *     a job that spends money both execute a workflow; what they are allowed to do is
 *     governed at `tool.invoke` and `resource.consume`. Requiring approval here
 *     would mean approving every job in order to approve any of them.
 *   - `workflow.cancel` is a SAFETY action. It is irreversible, and that is
 *     precisely why nobody should have to ask permission to stop work.
 *   - `memory.write`, `memory.read`, `memory.capture` are internal. A memory that
 *     cannot be un-remembered is not an irreversible EXTERNAL change.
 *   - `agent.execute` and `capability.execute` are internal mechanics; the outward
 *     act a capability performs is governed at the operation that performs it.
 *   - `approval.request` is asking, not deciding. Requiring a human in order to ask
 *     a human is a deadlock, not a control.
 *   - `workflow.create` is drafting work, not committing to it.
 */
export const HUMAN_APPROVAL_CATEGORIES: readonly HumanApprovalCategory[] = [
  { category: "publishing", operations: ["tool.invoke", "provider.use"] },
  { category: "spending", operations: ["resource.consume", "provider.use"] },
  { category: "sending", operations: ["tool.invoke", "provider.use"] },
  { category: "irreversible-external-change", operations: ["tool.invoke", "provider.use", "model.use"] },
  { category: "binding-acts", operations: ["admin.configure", "workflow.configure"] },
  { category: "privilege-escalation", operations: ["approval.resolve", "admin.configure"] },
];

/**
 * Every operation in the catalogue, classified.
 *
 * Listed in full rather than as a subset, for the same reason
 * `SECURITY_SENSITIVE_OPERATIONS` is: an operation added to `OPERATIONS` without a
 * decision here would otherwise read as "no approval needed" silently, and a test
 * asserts the two lists never drift apart.
 */
export const HUMAN_APPROVAL_OPERATIONS: Readonly<Record<Operation, boolean>> = {
  "agent.execute": false,
  "capability.execute": false,
  // The system's door to the outside: a tool may publish, send or spend.
  "tool.invoke": true,
  // Outbound to a third party - egress of data and of money.
  "provider.use": true,
  "model.use": true,
  "memory.read": false,
  "memory.write": false,
  "memory.capture": false,
  "workflow.create": false,
  // The vehicle, not the act. See the rule above.
  "workflow.execute": false,
  // A safety action. See the rule above.
  "workflow.cancel": false,
  "workflow.configure": true,
  // Asking, not deciding. See the rule above.
  "approval.request": false,
  // Grants authority: the escalation the brief names.
  "approval.resolve": true,
  "resource.consume": true,
  // Changes the authority itself.
  "admin.configure": true,
};

export function isHumanApprovalOperation(operation: Operation): boolean {
  return HUMAN_APPROVAL_OPERATIONS[operation];
}
