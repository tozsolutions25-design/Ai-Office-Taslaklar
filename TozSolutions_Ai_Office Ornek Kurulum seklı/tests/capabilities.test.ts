import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CAPABILITIES,
  CapabilitySet,
  isBuiltinCapability,
  isCapability,
  isStrictlyCompatible,
  matchCapabilities,
  matchCapabilitiesRequiringCertainty,
  unverifiedCapabilities,
} from "../src/capabilities/index.js";

describe("capability model", () => {
  it("defaults every capability to unknown", () => {
    const set = CapabilitySet.unknown();
    for (const capability of CAPABILITIES) {
      assert.equal(set.statusOf(capability), "unknown", `${capability} should default to unknown`);
    }
    assert.equal(set.uncertainties().length, CAPABILITIES.length);
  });

  it("marks declared capabilities supported and leaves the rest unknown", () => {
    const set = CapabilitySet.supporting("coding", "vision");
    assert.equal(set.isSupported("coding"), true);
    assert.equal(set.isSupported("vision"), true);
    assert.equal(set.isUnknown("reasoning"), true);
    assert.equal(set.isKnownUnsupported("reasoning"), false, "unknown is not unsupported");
  });

  it("records an explicit unsupported status", () => {
    const set = CapabilitySet.of({ reasoning: "unsupported" });
    assert.equal(set.isKnownUnsupported("reasoning"), true);
    assert.equal(set.isSupported("reasoning"), false);
  });

  it("validates built-in capability names", () => {
    assert.equal(isBuiltinCapability("coding"), true);
    assert.equal(isBuiltinCapability("web_research"), false);
    assert.equal(isBuiltinCapability(42), false);
  });

  it("admits custom, namespaced capability names", () => {
    // PHASE 04 widened the capability type so an agent can declare a capability
    // the core has never heard of. `isCapability` accepts any valid name; the
    // narrower `isBuiltinCapability` answers "does the core know this one?".
    assert.equal(isCapability("coding"), true);
    assert.equal(isCapability("web_research"), true);
    assert.equal(isCapability("entity_extraction"), true);
    assert.equal(isCapability("telepathy"), false, "a single word is not namespaced");
    assert.equal(isCapability("Web_Research"), false, "names are lowercase");
    assert.equal(isCapability("9lives"), false, "a name may not start with a digit");
    assert.equal(isCapability(42), false);
  });

  it("records a declared custom capability and reports it as supported", () => {
    const set = CapabilitySet.supporting("web_research");
    assert.equal(set.isSupported("web_research"), true);
    assert.equal(set.isUnknown("web_research"), false);
    // The built-in uncertainties are unaffected by the custom declaration.
    assert.equal(set.uncertainties().length, CAPABILITIES.length);
  });

  it("reports an undeclared custom capability as unknown, not unsupported", () => {
    const set = CapabilitySet.unknown();
    assert.equal(set.isUnknown("web_research"), true);
    assert.equal(set.isKnownUnsupported("web_research"), false);
  });

  it("round-trips through toJSON", () => {
    const set = CapabilitySet.of({ coding: "supported", vision: "unsupported" });
    const json = set.toJSON();
    assert.equal(json.coding, "supported");
    assert.equal(json.vision, "unsupported");
    assert.equal(json.reasoning, "unknown");
  });
});

describe("capability matching", () => {
  it("matches a positively supported capability", () => {
    const result = matchCapabilities(["coding"], CapabilitySet.supporting("coding"));
    assert.equal(result.verdict, "compatible");
    assert.deepEqual(result.satisfied, ["coding"]);
    assert.equal(result.gaps.length, 0);
  });

  it("rejects a positively unsupported capability", () => {
    const result = matchCapabilities(["vision"], CapabilitySet.of({ vision: "unsupported" }));
    assert.equal(result.verdict, "incompatible");
    assert.equal(result.gaps[0]?.capability, "vision");
    assert.equal(result.gaps[0]?.actual, "unsupported");
  });

  it("returns unknown, not support, for an unverified capability", () => {
    const result = matchCapabilities(["reasoning"], CapabilitySet.unknown());
    assert.equal(result.verdict, "unknown");
    assert.equal(result.gaps[0]?.actual, "unknown");
    assert.equal(isStrictlyCompatible(result), false, "unknown must not count as compatible");
  });

  it("never treats unknown as guaranteed support", () => {
    const strict = matchCapabilitiesRequiringCertainty(["reasoning"], CapabilitySet.unknown());
    assert.equal(strict, "incompatible");
  });

  it("lets one unsupported requirement dominate unknown ones", () => {
    const profile = CapabilitySet.of({ reasoning: "unknown", vision: "unsupported" });
    const result = matchCapabilities(["reasoning", "vision"], profile);
    assert.equal(result.verdict, "incompatible", "a definite failure outranks an unverified gap");
  });

  it("returns unknown when any requirement is unverified and none fail", () => {
    const profile = CapabilitySet.of({ coding: "supported", vision: "unknown" });
    const result = matchCapabilities(["coding", "vision"], profile);
    assert.equal(result.verdict, "unknown");
    assert.deepEqual(result.satisfied, ["coding"]);
  });

  it("matches everything when no capabilities are required", () => {
    const result = matchCapabilities([], CapabilitySet.unknown());
    assert.equal(result.verdict, "compatible");
  });

  it("is deterministic across repeated calls", () => {
    const profile = CapabilitySet.of({ coding: "supported", vision: "unknown" });
    const first = matchCapabilities(["coding", "vision"], profile);
    for (let i = 0; i < 20; i += 1) {
      assert.deepEqual(matchCapabilities(["coding", "vision"], profile), first);
    }
  });

  it("does not mutate the observed profile", () => {
    const profile = CapabilitySet.of({ coding: "supported" });
    matchCapabilities(["vision", "reasoning"], profile);
    assert.equal(profile.statusOf("vision"), "unknown");
    assert.equal(profile.uncertainties().length, CAPABILITIES.length - 1);
  });

  it("lists unverified capabilities for a partially declared profile", () => {
    const unverified = unverifiedCapabilities(CapabilitySet.supporting("coding"));
    assert.equal(unverified.includes("coding"), false);
    assert.ok(unverified.includes("vision"));
  });
});
