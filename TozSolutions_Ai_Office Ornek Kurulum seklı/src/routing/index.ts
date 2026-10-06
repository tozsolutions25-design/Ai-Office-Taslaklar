export {
  REJECTION_REASONS,
  VerifiedFactsScorer,
  computeVerifiedFactsRank,
  evaluateCandidate,
  type CandidateEvaluation,
  type CandidateSource,
  type ProviderRouter,
  type RejectionReason,
  type RoutingCandidate,
  type RoutingDecision,
  type RoutingRequest,
  type ScoreFactor,
  type ScoredCandidate,
  type Scorer,
} from "./router.js";

export { DefaultRouter, RegistryCandidateSource } from "./defaultRouter.js";

// PHASE 06: policies, controlled fallback, and honest usage accounting.
export {
  DEFAULT_ROUTING_POLICY_NAME,
  FACT_DIRECTIONS,
  ROUTING_POLICIES,
  ROUTE_FACT_KINDS,
  UnknownRoutingPolicyError,
  candidateKey,
  explainPolicy,
  orderByPolicy,
  resolvePolicy,
  routeFactsOf,
  type FactReading,
  type PolicyComparison,
  type PolicyExplanation,
  type RouteFact,
  type RouteFactKind,
  type RoutingPolicy,
} from "./policy.js";

export {
  DEFAULT_FALLBACK_LIMITS,
  HOP_REASONS,
  CooldownRegistry,
  FallbackPlanner,
  mayFallback,
  recordHopOutcome,
  type FallbackChain,
  type FallbackChainRequest,
  type FallbackLimits,
  type HopReason,
  type RouteHop,
} from "./fallback.js";

export {
  UsageLedger,
  validateReportedUsage,
  type LedgerSummary,
  type ProviderSummary,
  type ReportedUsage,
  type UsageRecord,
} from "./usage.js";
