export {
  BUILTIN_CAPABILITY_SET,
  CAPABILITIES,
  CAPABILITY_STATUSES,
  CapabilitySet,
  isBuiltinCapability,
  isCapability,
  isCapabilityName,
  isCapabilityStatus,
  type BuiltinCapability,
  type Capability,
  type CapabilityStatus,
} from "./capability.js";

export {
  MATCH_VERDICTS,
  isStrictlyCompatible,
  matchCapabilities,
  matchCapabilitiesRequiringCertainty,
  unverifiedCapabilities,
  type CapabilityGap,
  type CapabilityMatch,
  type MatchVerdict,
} from "./match.js";
