/**
 * PHASE 08 env allow-list.
 *
 * Split out of `env.ts` because the governance block is long enough that inline
 * it buried the surrounding sections, and because the values here are the ones a
 * deployment is most likely to get wrong.
 *
 * Every value is passed through as written and validated by
 * `validateOrchestrationConfig`. In particular `TOZ_GOVERNANCE_ENFORCED` is NOT
 * coerced into a default: a deployment that spells it wrongly must be told, not
 * silently given a control plane it did not choose.
 */

import { type OrchestrationEnv } from "./env.js";

export function governanceSectionFromEnv(env: OrchestrationEnv): Record<string, unknown> {
  const raw = (key: string): string | undefined => {
    const value = env[key];
    return value === undefined || value === "" ? undefined : value;
  };
  const bool = (key: string): boolean | undefined => {
    const value = raw(key);
    if (value === undefined) {
      return undefined;
    }
    // Passed through as a STRING when it is neither "true" nor "false", so the
    // validator reports the bad value instead of treating it as false.
    return value === "true" ? true : value === "false" ? false : (value as unknown as boolean);
  };
  const list = (key: string): readonly string[] | undefined => {
    const value = raw(key);
    return value === undefined
      ? undefined
      : value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry !== "");
  };

  const governance: Record<string, unknown> = {};
  if (bool("TOZ_GOVERNANCE_ENFORCED") !== undefined) {
    governance["enforced"] = bool("TOZ_GOVERNANCE_ENFORCED");
  }
  if (bool("TOZ_GOVERNANCE_BLOCK_ON_UNKNOWN_COST") !== undefined) {
    governance["blockOnUnknownCost"] = bool("TOZ_GOVERNANCE_BLOCK_ON_UNKNOWN_COST");
  }
  if (list("TOZ_GOVERNANCE_APPROVAL_REQUIRED") !== undefined) {
    governance["approvalRequired"] = list("TOZ_GOVERNANCE_APPROVAL_REQUIRED");
  }
  if (list("TOZ_GOVERNANCE_DEFER_TO_SUBSYSTEM") !== undefined) {
    governance["deferToSubsystem"] = list("TOZ_GOVERNANCE_DEFER_TO_SUBSYSTEM");
  }
  if (raw("TOZ_GOVERNANCE_MAX_CONCURRENT") !== undefined) {
    governance["maxConcurrent"] = raw("TOZ_GOVERNANCE_MAX_CONCURRENT");
  }
  if (raw("TOZ_GOVERNANCE_MAX_ATTEMPTS_PER_ACTOR") !== undefined) {
    governance["maxAttemptsPerActor"] = raw("TOZ_GOVERNANCE_MAX_ATTEMPTS_PER_ACTOR");
  }
  if (raw("TOZ_GOVERNANCE_MAX_RUNTIME_MS") !== undefined) {
    governance["maxRuntimeMsPerActor"] = raw("TOZ_GOVERNANCE_MAX_RUNTIME_MS");
  }
  return governance;
}
