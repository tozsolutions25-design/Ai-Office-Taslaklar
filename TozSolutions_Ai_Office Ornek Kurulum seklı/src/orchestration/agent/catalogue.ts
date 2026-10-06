/**
 * The agent catalogue - the roster `MASTER_PLAN.md` 5 asks for, as DECLARATIONS.
 *
 * ## WHAT THIS IS, AND WHAT IT IS NOT
 *
 * `MASTER_PLAN.md` 5 names an MVP set of five agents and a production core of ten, and
 * `TODO.md` PHASE 08 item 1 asks for them to be added. The audit that preceded this phase
 * found the catalogue was **empty**: no `agentId` literal anywhere in `src/`, no caller of
 * `AgentRegistry.register` outside `AgentIngestor`, and no `Hermes` string in `src/` at all.
 *
 * This module adds the roster as DATA, and nothing more. Every entry here is a declaration
 * of what an agent would be, reviewed by a human before it runs. None of them can execute:
 * they register with `status: "disabled"` and lifecycle `discovered`, the same state an
 * ingested external agent arrives in, and promotion to `available` is a separate, explicit
 * act. This is the PHASE 04.1 N rule - ship features switched off - applied to agents.
 *
 * ## HERMES IS NOT IN HERE, AND CANNOT BE
 *
 * `MASTER_PLAN.md` 5 lists "Hermes Coordinator - the single orchestration authority" as MVP
 * agent 1. In this repository that role is held **structurally** by `TozOrchestrator`, which
 * is not an `AgentRecord` and was never going to be one: registering Hermes as an agent would
 * put a second component in the registry that the pool could select and the orchestrator
 * could invoke, which is precisely the "two components each believe they decide what runs"
 * failure `authority.ts` opens by warning about - and it would make Hermes an agent that
 * could be rejected by a trust floor, disabled by an operator, or drained. An authority that
 * can be switched off by a registry is not an authority.
 *
 * `TODO.md` PHASE 08 item 2 asked for the sole-sequencer claim to be made structural, and
 * `tests/agentAuthority.p08-evidence.test.ts` now proves the narrow, true version of it. This
 * module is the other half of that answer: the coordinator is not an agent here, and the
 * absence is deliberate rather than an oversight.
 *
 * ## WHY THE REMAINING NINE ARE HERE AT ALL
 *
 * Because a deployment should not have to invent an agent's trust level, capability profile
 * and memory reach at the moment it needs one. Every field below is a decision that can be
 * reviewed, argued with and changed before anything runs, rather than a value discovered while
 * something is already executing.
 *
 * They are NOT working agents and nothing claims they are. `registerCatalogue` reports how
 * many it registered and how many it promoted, and a roster that cannot be executed through
 * the honest `UnavailableAgentAdapter` fails with a configuration error naming the adapter -
 * which is the Phase 05 behaviour, not a new one.
 */

import { CapabilitySet, type Capability } from "../../capabilities/capability.js";
import type { MemoryScope } from "../memory/memory.js";
import type {
  AgentCostClass,
  AgentLatencyClass,
  AgentRecordInput,
  ExecutionMode,
  TrustLevel,
} from "./record.js";
import { NATIVE_ORIGIN } from "./record.js";

/**
 * The origin every catalogue entry carries.
 *
 * `NATIVE_ORIGIN` - not an external origin. These are the system's own declared roles, not
 * something ingested from elsewhere, and the origin is part of the record an auditor reads.
 *
 * The existing constant is used rather than a literal shaped like it, for the reason PHASE 07
 * applied to `SCOPE_BREADTH`: a second copy of an origin value is a second thing that can
 * disagree. The first draft of this file spelled out `{ kind: "native", reference: ... }`,
 * which had the wrong field name as well as being a duplicate - `AgentOrigin` calls it `ref`.
 */
const NATIVE = NATIVE_ORIGIN;

/** Every catalogue entry declares this, so the roster is honest about running in-process. */
const ADAPTER = "unavailable";

/**
 * The MVP roster, minus Hermes - see the header.
 *
 * Four entries, because the plan's fifth is the orchestrator.
 */
export const MVP_AGENT_CATALOGUE: readonly CatalogueEntry[] = [
  {
    agentId: "qa-reviewer",
    name: "Independent QA Reviewer",
    role: "review",
    summary:
      "Reviews work produced by another agent. Structurally cannot approve its own work: it is not the agent that ran the task, and the approval gate is held by the coordinator, not by this record.",
    capabilities: ["reasoning", "coding", "debugging", "long_context"],
    // A reviewer needs to see what was decided, not the memory that produced it.
    memoryScopes: ["task", "agent"],
    trustLevel: "standard",
    costClass: "standard",
    latencyClass: "standard",
    executionMode: "in_process",
  },
  {
    agentId: "briefing-approval-officer",
    name: "Briefing / Approval Officer",
    role: "approval",
    summary:
      "Prepares work for a human decision and states what is being asked for. Holds NO approval authority: the gate is decided through the coordinator, and no agent record can decide one.",
    capabilities: ["reasoning", "structured_output", "long_context"],
    memoryScopes: ["task", "team"],
    trustLevel: "high",
    costClass: "standard",
    latencyClass: "standard",
    executionMode: "in_process",
    requiresModelRoute: false,
  },
  {
    agentId: "research-analyst",
    name: "Research Analyst",
    role: "research",
    summary:
      "Gathers and summarises material. Source references are its output, so every source it reports is recorded as evidence rather than trusted as content.",
    capabilities: ["research", "reasoning", "browser_automation", "long_context"],
    memoryScopes: ["task", "agent", "project"],
    trustLevel: "standard",
    costClass: "standard",
    latencyClass: "slow",
    executionMode: "in_process",
  },
  {
    agentId: "content-strategist",
    name: "Content Strategist / Drafter",
    role: "content",
    summary:
      "Drafts and revises text. Output passes the output policy before it can reach an answer, because a draft is the one agent output a human may act on directly.",
    capabilities: ["text_generation", "structured_output", "reasoning"],
    memoryScopes: ["task", "agent"],
    trustLevel: "standard",
    costClass: "low",
    latencyClass: "standard",
    executionMode: "in_process",
  },
];

/**
 * The production core, minus the MVP four - see the header.
 */
export const PRODUCTION_CORE_AGENT_CATALOGUE: readonly CatalogueEntry[] = [
  {
    agentId: "brand-guardian",
    name: "Brand Guardian",
    role: "governance",
    summary:
      "Checks output against brand rules before publication. Cannot approve publication: it advises, and the approval gate remains a human decision.",
    capabilities: ["reasoning", "structured_output", "long_context"],
    memoryScopes: ["task", "team", "organization"],
    trustLevel: "high",
    costClass: "standard",
    latencyClass: "standard",
    executionMode: "in_process",
    requiresModelRoute: false,
  },
  {
    agentId: "compliance-checker",
    name: "Compliance Checker",
    role: "governance",
    summary:
      "Screens for regulatory and contractual obligations. Its verdict is recorded as evidence and is a CLAIM about the text, not a legal determination.",
    capabilities: ["reasoning", "document_processing", "long_context"],
    memoryScopes: ["task", "team", "organization"],
    trustLevel: "high",
    costClass: "standard",
    latencyClass: "slow",
    executionMode: "in_process",
    requiresModelRoute: false,
  },
  {
    agentId: "measurement-analyst",
    name: "Data / Measurement Analyst",
    role: "analysis",
    summary: "Reads data and reports what it shows, including that a measurement is unavailable.",
    capabilities: ["reasoning", "structured_output", "coding"],
    memoryScopes: ["task", "agent", "project"],
    trustLevel: "standard",
    costClass: "standard",
    latencyClass: "standard",
    executionMode: "in_process",
  },
  {
    agentId: "budget-controller",
    name: "Budget Controller",
    role: "governance",
    summary:
      "Answers whether work may proceed against a budget. READ-ONLY over the budget: it reports, and the coordinator's own budget gate is what decides.",
    capabilities: ["reasoning", "structured_output"],
    memoryScopes: ["task", "team"],
    trustLevel: "high",
    costClass: "low",
    latencyClass: "fast",
    executionMode: "in_process",
    requiresModelRoute: false,
  },
  {
    agentId: "operations-agent",
    name: "CRM / Operations Agent",
    role: "operations",
    summary:
      "Placeholder role for the external systems that PHASE 13 introduces. It declares no tools, because no external tool boundary exists yet - and an agent that named tools it cannot reach would fail selection with a refusal rather than a reason a reader could act on.",
    capabilities: ["reasoning", "structured_output", "tool_calling"],
    toolRequirements: [],
    memoryScopes: ["task", "agent"],
    trustLevel: "standard",
    costClass: "standard",
    latencyClass: "standard",
    executionMode: "in_process",
    requiresModelRoute: false,
  },
];

/** What a catalogue entry is allowed to say, beyond what an agent record holds. */
export interface CatalogueEntry {
  readonly agentId: string;
  readonly name: string;
  /** Coarse role, recorded as metadata so a roster can be sorted and read. */
  readonly role: string;
  /** What the role is FOR. Recorded, never enforced - enforcement is the registry's job. */
  readonly summary: string;
  readonly capabilities: readonly Capability[];
  /** Memory reach this role needs. Checked against the ACTOR's grants at selection. */
  readonly memoryScopes: readonly MemoryScope[];
  // The DOMAIN types, not literal unions spelled out here. The first draft of this interface
  // declared `executionMode: "in_process" | "subprocess" | "remote"` and
  // `latencyClass: ... | "batch"`, and both invented members do not exist in the domain -
  // `EXECUTION_MODES` is `local | remote | in_process | sandboxed` and `AGENT_LATENCY_CLASSES`
  // has no `batch`. Re-declaring the unions is what let a roster drift away from the types it
  // is supposed to inhabit; the compiler now refuses that outright.
  readonly trustLevel: TrustLevel;
  readonly costClass: AgentCostClass;
  readonly latencyClass: AgentLatencyClass;
  readonly executionMode: ExecutionMode;
  readonly toolRequirements?: readonly string[];
  readonly providerRequirements?: readonly string[];
  readonly requiresModelRoute?: boolean;
}

/**
 * Converts an entry into a registry input.
 *
 * Two things are deliberately NOT passed in, and both would be a second place that could
 * disagree with an existing default:
 *
 *   - `status`, because `buildAgentRecord`'s own default is `disabled`, which is what a
 *     declaration wants. Stating it here would mean two places to change.
 *   - `now`, because `AgentRegistry.register` takes `Omit<AgentRecordInput, "now">` and
 *     supplies the clock. This function's first draft took a `now: Date` parameter and
 *     ignored it, which is how the compiler caught it.
 */
export function catalogueEntryToRecordInput(entry: CatalogueEntry): Omit<AgentRecordInput, "now"> {
  return {
    agentId: entry.agentId,
    name: entry.name,
    version: "1.0.0",
    adapter: ADAPTER,
    type: "specialist",
    capabilities: CapabilitySet.supporting(...entry.capabilities),
    toolRequirements: entry.toolRequirements ?? [],
    providerRequirements: entry.providerRequirements ?? [],
    memoryScopes: entry.memoryScopes,
    trustLevel: entry.trustLevel,
    costClass: entry.costClass,
    latencyClass: entry.latencyClass,
    executionMode: entry.executionMode,
    requiresModelRoute: entry.requiresModelRoute ?? true,
    source: NATIVE,
    metadata: { role: entry.role, summary: entry.summary, catalogue: "toz-agent-catalogue" },
  };
}

/** The full roster: MVP first, then the production core. */
export function fullCatalogue(): readonly CatalogueEntry[] {
  return [...MVP_AGENT_CATALOGUE, ...PRODUCTION_CORE_AGENT_CATALOGUE];
}

/** The adapter every catalogue entry names, exported so a test can name it without a literal. */
export const CATALOGUE_ADAPTER = ADAPTER;
