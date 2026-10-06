/**
 * PHASE 08 EVIDENCE - no declared-but-unreachable agent surface.
 *
 * ## THE RULE BEING ENFORCED
 *
 * `DECISIONS.md` D-53, from PHASE 07: *a declared-but-unreachable name is removed or
 * implemented, never left to accumulate.* A name in an exported union, a field on a
 * shipped configuration, or a constant named "the default" is a claim that something can
 * use it. PHASE 07 found two policy rules in exactly this state and removed them; the rule
 * is not phase-local, so it applies here.
 *
 * Three more existed in the agent subsystem, and the audit that preceded this file found
 * none of them in `src/`:
 *
 *  1. `DEFAULT_TRUST_REQUIREMENT` and the `AgentTrustRequirement` interface it belongs to.
 *     No caller anywhere, in `src/` or in any test. Its `requireFreshHealth` field has data
 *     behind it - `HealthObservation.observedAt` exists and `null` means never observed -
 *     but no rule reads it, because nobody has decided what counts as stale or over what
 *     window. Implementable, not implemented, and not decidable from the brief.
 *
 *  2. `"unhealthy"` in the pool's `REJECTION_REASONS`. `HEALTH_STATUSES` is
 *     `unknown | healthy | degraded | unavailable | disabled`; there is no `unhealthy`
 *     health status, so this reason cannot be produced by any input. `unavailable` and
 *     `disabled` health are both already reported as `agent_health_not_routable`.
 *
 *  3. `tools.grantUndeclaredTools`. Documented as "When false, an agent may call only the
 *     tools it declared", configurable, validated, settable by `TOZ_TOOL_GRANT_UNDECLARED`,
 *     and read NOWHERE. The boundary it names is not optional: `ToolExecutionHost
 *     .verifyReported` refuses an undeclared tool unconditionally, which is the PHASE 05
 *     rule that "tools are not granted, they are earned".
 *
 * ## WHY (3) IS REMOVED RATHER THAN WIRED
 *
 * Wiring it would make "an agent may call a tool it never declared" a configuration switch
 * with no authority behind it: no approval, no audit, no governance rule, and no operator
 * identity to attribute the risk acceptance to. B-05 - whose string may assert what, and
 * how that is evidenced - is still OPEN. Shipping the switch now would mean shipping the
 * ability to widen an authority boundary to whoever can edit an environment variable.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const readSource = (relative: string): string => readFileSync(path.join(ROOT, relative), "utf8");

/**
 * Every file that could reference a name: production source, and the repository's tests.
 *
 * `tests/` is walked only if it exists. The mutation harness's structural mode runs these
 * suites with a staged copy as `cwd`, and the first version of that staging copied only `src`
 * - so this file died with `ENOENT: scandir '<stage>/tests'` and the harness reported a BROKEN
 * structural control, which would have invalidated every verdict for a reason unrelated to the
 * architecture. Skipping the absent directory keeps the claim honest ("nothing in what is
 * present uses it") and lets the harness report a real finding.
 */
const ALL_FILES: readonly string[] = (() => {
  const found: string[] = [];
  for (const root of ["src", "tests"]) {
    const base = path.join(ROOT, root);
    if (!existsSync(base)) continue;
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith(".ts")) found.push(full);
      }
    };
    walk(base);
  }
  // This file is excluded, and had to be. A test that asserts "nothing uses X" necessarily
  // contains the string X, so a naive scan reports every such name as used and the
  // assertion passes for the wrong reason - twice over, once for the re-exports and once
  // for the test naming the symbol it is complaining about.
  return found.filter((file) => path.basename(file) !== "agentSurface.p08-evidence.test.ts");
})();

/**
 * Declared, exported, and referenced by nothing but its own declaration.
 *
 * Re-export lines do NOT count as uses. `export { DEFAULT_TRUST_REQUIREMENT } from
 * "./trust.js"` propagates a declaration; it is not a caller. The first version of this
 * helper counted re-exports, and `DEFAULT_TRUST_REQUIREMENT` "passed" for that reason
 * while still being dead - a test that passes for the wrong reason is worse than one that
 * fails, so the propagation case is now explicit.
 */
function hasDeclarationOnly(name: string): boolean {
  let declared = 0;
  let used = 0;
  for (const file of ALL_FILES) {
    // A multi-line `export { ... }` block puts each name on its OWN line, so a
    // line-level `^export {` test is not enough - three passes of this helper found that
    // out in turn. Inside such a block a name is being propagated, not called.
    let insideExportBlock = false;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const text = line.trim();
      if (insideExportBlock) {
        if (text.startsWith("}")) insideExportBlock = false;
        continue;
      }
      if (text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")) continue;
      if (/^export\s*(type\s*)?\{/.test(text)) {
        if (!text.includes("}")) insideExportBlock = true;
        continue;
      }
      if (text.startsWith("export *")) continue;
      if (!text.includes(name)) continue;
      if (new RegExp(`export\\s+(const|interface|type|function|class)\\s+${name}\\b`).test(text)) declared += 1;
      else used += 1;
    }
  }
  return declared > 0 && used === 0;
}

describe("PHASE 08 EVIDENCE - no declared-but-unreachable agent surface", () => {
  it("keeps no trust requirement that nothing can require", () => {
    assert.equal(
      hasDeclarationOnly("DEFAULT_TRUST_REQUIREMENT"),
      false,
      "`DEFAULT_TRUST_REQUIREMENT` is declared and read by nothing; a constant named the default that no default uses",
    );
    assert.equal(
      hasDeclarationOnly("AgentTrustRequirement"),
      false,
      "`AgentTrustRequirement` describes a trust requirement no caller can express",
    );
  });

  it("keeps no rejection reason that no candidate can produce", () => {
    const source = readSource("src/orchestration/pool/specialistPool.ts");
    // Scoped to the union, not the file: the removal note beside it necessarily NAMES the
    // reason it removed, so a whole-file match would fail on its own documentation. The
    // first version of this assertion did exactly that.
    const union = /export const REJECTION_REASONS = \[([\s\S]*?)\] as const;/.exec(source);
    assert.ok(union !== null, "the reason union must be findable");
    assert.doesNotMatch(
      union[1],
      /"unhealthy"/,
      "`unhealthy` is not a HealthStatus, so no input can produce this reason",
    );
    // And the reason that DOES exist must still be the one that fires, or the removal
    // would have lost the report rather than the fiction.
    assert.match(union[1], /"agent_health_not_routable"/, "an unreachable health report must be replaced by a reachable one");
    assert.match(
      readSource("src/health/health.ts"),
      /HEALTH_STATUSES = \[\s*"unknown",\s*"healthy",\s*"degraded",\s*"unavailable",\s*"disabled",?\s*\]/,
      "the status set is unchanged: `unavailable` and `disabled` are still the cases",
    );
  });

  it("keeps no configuration switch that cannot change behaviour", () => {
    const config = readSource("src/orchestration/config/orchestrationConfig.ts");
    assert.doesNotMatch(
      config,
      /grantUndeclaredTools/,
      "a validated, environment-mappable switch that nothing reads is a fabricated capability",
    );
    assert.doesNotMatch(
      readSource("src/orchestration/config/env.ts"),
      /TOOL_GRANT_UNDECLARED/,
      "and the environment variable that set it",
    );
  });

  it("keeps the declared-tool boundary unconditional rather than optional", () => {
    // The reason (3) was removed instead of wired: the boundary itself must not become a
    // switch. If a future phase wires it legitimately - with an authority model and an
    // audit - THIS test is the thing that must change, and changing it should be a
    // deliberate act rather than a drive-by.
    const invoker = readSource("src/orchestration/tools/invoker.ts");
    assert.match(
      invoker,
      /if \(!declared\.includes\(toolId\)\)/,
      "an undeclared tool must still be refused at the only place that can refuse it",
    );
    assert.match(invoker, /UNDECLARED = "the agent never declared this tool"/, "and the refusal must still say why");
  });

  it("does not leave the trust floor weaker than PHASE 08 found it", () => {
    // Removing the declared-but-unused requirement interface must not remove the real
    // enforcement. Two independent gates remain, and this asserts both are still wired.
    assert.match(
      readSource("src/orchestration/pool/specialistPool.ts"),
      /trust_below_floor/,
      "the pool still refuses a candidate below the requested floor",
    );
    assert.match(
      readSource("src/orchestration/governance/policy.ts"),
      /meetsTrustFloor/,
      "and governance still enforces a floor independently",
    );
  });
});
