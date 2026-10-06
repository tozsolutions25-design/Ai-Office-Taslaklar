/**
 * PHASE 08 EVIDENCE - an agent's route is never silently unrecorded.
 *
 * ## THE DEFECT
 *
 * `AgentExecutionResult` carries `providerId` and `modelId`, documented as "Provider/model
 * the adapter actually used, when it can report them". Nothing in `src/` ever read them.
 *
 * On the routed path that is harmless: `TozOrchestrator` chose the route, so it knows it and
 * records it. On the SELF-HOSTED path - an agent declaring `requiresModelRoute: false` - the
 * orchestrator routes nothing, records `provider: null, model: null`, and then discards the
 * only account of what the adapter actually did.
 *
 * So an agent that reaches a provider anyway is recorded as having used no provider. That is
 * the defect class PHASE 07 removed twice (`RetrievalEngine` claiming a semantic search it
 * did not run; the scope table claiming a durability nothing provided): the record is
 * confidently wrong, and confidently wrong is worse than empty because it is believed.
 *
 * ## WHAT THIS FILE REQUIRES
 *
 * After an adapter returns, the orchestrator must reconcile what it ROUTED with what the
 * adapter REPORTED and record the difference:
 *
 *   - routed, and the adapter agrees        -> nothing to say
 *   - unrouted, and the adapter reports one -> record it, labelled as adapter-reported
 *   - routed, and the adapter reports other -> record the mismatch
 *
 * The adapter's report is a claim, not a fact, and this file does not pretend otherwise: it
 * is labelled `reported`, never `routed`. There is nothing to verify it against when TOZ did
 * not choose the route, so recording it as a claim is strictly better than recording `null`
 * and calling the run audited.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const readSource = (relative: string): string => readFileSync(path.join(ROOT, relative), "utf8");

describe("PHASE 08 EVIDENCE - agent route accounting", () => {
  it("reads what the adapter says it used", () => {
    const source = readSource("src/orchestration/authority.ts");
    // Two facts rather than one literal. The first draft of this assertion looked for
    // `execution.value.providerId` in the execution path and failed, because the value is
    // read inside `#recordReportedRoute`, which receives `execution.value`. Asserting the
    // spelling would have pinned the mechanism rather than the behaviour - and the wrong
    // mechanism here (reconciling silently in place) is one this phase deliberately rejected.
    assert.match(
      source,
      /#recordReportedRoute\([^)]*execution\.value/,
      "the adapter's result must reach the reconciliation",
    );
    assert.match(
      source,
      /readonly providerId\?: string \| null;/,
      "and the helper must read the provider field it is given",
    );
    assert.match(source, /value\.providerId \?\? null/, "reading it, not assuming it is present");
  });

  it("records an unrouted agent's reported route rather than losing it", () => {
    const source = readSource("src/orchestration/authority.ts");
    assert.match(
      source,
      /agent_reported_route/,
      "there must be an event kind for what an adapter reported when TOZ routed nothing",
    );
  });

  it("labels the adapter's account as reported, never as routed", () => {
    // `model_routed` means the orchestrator chose it. Reusing that kind for a value the
    // adapter supplied would make a claim indistinguishable from an authority decision in
    // the one place an auditor would look.
    const source = readSource("src/orchestration/authority.ts");
    assert.doesNotMatch(
      source,
      /kind:\s*"model_routed"[\s\S]{0,400}reported/,
      "a reported route must never be recorded under the routed kind",
    );
  });

  it("names the event kind in the trace's closed union", () => {
    // A kind passed to `#record` that is not in `ORCHESTRATION_EVENT_KINDS` would be a
    // compile error, but asserting it here means adding one cannot be forgotten in the
    // declaration and only appear at the call site.
    const kinds = readSource("src/orchestration/observability/trace.ts");
    assert.match(kinds, /"agent_reported_route"/, "the new kind must be declared, not only used");
  });
});
