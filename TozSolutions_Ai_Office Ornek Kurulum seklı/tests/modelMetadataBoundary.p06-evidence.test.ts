/**
 * PHASE 06 EVIDENCE - model metadata is closed.
 *
 * `ModelRecord.metadata` was `Readonly<Record<string, unknown>>`. `core.models` is
 * deployment-scoped, so that bag was the one place in the shared inventory where a
 * customer identifier could be written and then read by every workspace in the
 * process. PHASE 06's claim about that registry - that it holds no customer data -
 * was unfalsifiable while the bag existed, because a field-name check cannot see
 * inside a `Record`.
 *
 * Three controls, because the guarantee has three distinct attack surfaces:
 *
 *   POSITIVE   a sanctioned key is accepted and round-trips.
 *   NEGATIVE   customer identity, workspace, brand, task, job and actor keys are
 *              REJECTED - first by the compiler (`@ts-expect-error`, so this file
 *              fails `tsc` if they ever become legal), then by the runtime validator
 *              for the case the compiler cannot cover: a cast.
 *   MUTATION   a widened allowlist or a removed validation call is caught by
 *              `tests/workspaceRegistryBoundaries.p06-evidence.test.ts`, which
 *              asserts the key set is closed and that nothing populates the bag.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MODEL_METADATA_KEYS,
  ModelRegistry,
  QUALITY_TIER_METADATA_KEY,
  declaredQualityTier,
  validateModelMetadata,
  type ModelMetadata,
} from "../src/models/index.js";
import { ManualClock } from "../src/core/clock.js";
import { ProviderRegistry } from "../src/providers/index.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const CLOCK = new ManualClock(NOW);

/** Every name a caller might reach for when smuggling customer data into the bag. */
const CUSTOMER_DATA_KEYS = [
  "workspace",
  "brand",
  "tenantId",
  "customerId",
  "userId",
  "accountId",
  "orgId",
  "taskId",
  "jobId",
  "actor",
  "principal",
  "subject",
  "objective",
  "input",
  "document",
  "prompt",
  "email",
  "apiKey",
  "secret",
  "token",
] as const;

function registry(): ModelRegistry {
  const providers = new ProviderRegistry({ clock: CLOCK });
  const models = new ModelRegistry({ clock: CLOCK, providers });
  assert.equal(providers.register({ providerId: "p-1", type: "managed", enabled: true }).ok, true, "fixture provider");
  return models;
}

describe("PHASE 06 EVIDENCE - model metadata is a closed type", () => {
  /* -------------------------------------------------------------- positive -- */

  it("accepts the one sanctioned key and round-trips it", () => {
    const models = registry();
    const written = models.register({
      modelId: "m-tiered",
      providerId: "p-1",
      metadata: { [QUALITY_TIER_METADATA_KEY]: "strong" },
    });
    assert.equal(written.ok, true, "a sanctioned key must be accepted");
    if (!written.ok) return;
    assert.equal(written.value.metadata[QUALITY_TIER_METADATA_KEY], "strong");
    assert.equal(declaredQualityTier(written.value.metadata), "strong");
  });

  it("accepts no metadata at all", () => {
    const models = registry();
    const written = models.register({ modelId: "m-bare", providerId: "p-1" });
    assert.equal(written.ok, true);
    if (!written.ok) return;
    assert.deepEqual(written.value.metadata, {});
    assert.equal(declaredQualityTier(written.value.metadata), "unverified");
  });

  it("declares exactly one sanctioned key, and it is the quality tier", () => {
    // Spread: `MODEL_METADATA_KEYS` is a frozen `as const` tuple and the expected
    // value is a plain array, so `deepStrictEqual` rejects them on prototype even
    // though the contents match.
    assert.deepEqual([...MODEL_METADATA_KEYS], [QUALITY_TIER_METADATA_KEY]);
    // `deepEqual`, not `equal`: these are distinct array instances and `assert.equal`
    // compares them by reference.
    assert.deepEqual(validateModelMetadata({}), [], "absent metadata is not an error");
    assert.deepEqual(validateModelMetadata(undefined), [], "absent metadata is not an error");
    assert.deepEqual(
      validateModelMetadata({ [QUALITY_TIER_METADATA_KEY]: "adequate" }),
      [],
      "the one sanctioned key with a valid value is accepted",
    );
  });

  /* -------------------------------------------------------------- negative -- */

  it("refuses every customer-data key the compiler allows to be attempted", () => {
    // Compile-time half. Each literal below is written AS a ModelMetadata, with no
    // cast, so each one is a real type error. `@ts-expect-error` stops matching if
    // the closed type is ever widened to admit one, and `tsc` then fails - which is
    // what makes the guarantee structural rather than a comment.
    const workspace = {
      // @ts-expect-error PHASE 06: a customer key must not typecheck as metadata.
      workspace: "acme-corp",
    } satisfies ModelMetadata;
    const tenant = {
      // @ts-expect-error PHASE 06: a customer key must not typecheck as metadata.
      tenantId: "acme",
    } satisfies ModelMetadata;
    const task = {
      // @ts-expect-error PHASE 06: a customer key must not typecheck as metadata.
      taskId: "task-1",
    } satisfies ModelMetadata;

    for (const attempt of [workspace, tenant, task]) {
      assert.ok(
        validateModelMetadata(attempt).length > 0,
        "an unsanctioned key must be refused by the validator as well as the compiler",
      );
    }
  });

  it("shows that the closed type is bypassable by a cast, which is why the validator exists", () => {
    // This test exists to record WHY there are two halves to this guarantee.
    //
    // `as ModelMetadata` compiles with no error and no `@ts-expect-error`, because a
    // cast is a request the compiler grants. The type stops a caller who writes an
    // object literal; it does not stop a caller who asserts one, and asserting is the
    // obvious next move when the type says no. So the runtime allowlist is the half
    // that actually holds, and this test is the control that would fail if someone
    // deleted `validateModelMetadata` believing the type was enough.
    const asserted = { workspace: "acme-corp", customerId: "c-1" } as unknown as ModelMetadata;
    assert.ok(validateModelMetadata(asserted).length > 0, "a cast must not buy a customer-data key");
  });

  it("refuses an unsanctioned key on a real model registration", () => {
    const models = registry();
    const written = models.register({
      modelId: "m-smuggled",
      providerId: "p-1",
      // The cast is the point: it is what a caller reaches for when the type says no.
      metadata: { workspace: "acme-corp", tenantId: "acme" } as unknown as ModelMetadata,
    });
    assert.equal(written.ok, false, "a customer-data key must not reach a deployment-scoped record");
    if (written.ok) return;
    const detail = JSON.stringify(written.error);
    assert.match(detail, /workspace/, "the refusal must name the offending key");
    assert.match(detail, /tenantId/, "every offending key is reported, not just the first");
    assert.match(detail, /toz\.qualityTier/, "the refusal must name what IS permitted");
  });

  it("refuses a nested object behind a sanctioned key", () => {
    // A primitive check alone is not enough: `{ toz.qualityTier: { workspace: "acme" } }`
    // would pass a key-only check and still carry customer data.
    const written = validateModelMetadata({ [QUALITY_TIER_METADATA_KEY]: { workspace: "acme" } });
    assert.ok(written.length > 0, "a structured value behind a sanctioned key must be refused");
  });

  it("refuses a value outside the declared tier union", () => {
    assert.ok(
      validateModelMetadata({ [QUALITY_TIER_METADATA_KEY]: "excellent" }).length > 0,
      "an undeclared tier is not a tier",
    );
    assert.ok(validateModelMetadata({ [QUALITY_TIER_METADATA_KEY]: 7 }).length > 0);
    assert.ok(validateModelMetadata({ [QUALITY_TIER_METADATA_KEY]: null }).length > 0);
  });

  it("refuses a non-object metadata value", () => {
    for (const value of ["strong", 7, true, ["strong"], null]) {
      assert.ok(
        validateModelMetadata(value).length > 0,
        `metadata must be an object; ${JSON.stringify(value)} is not`,
      );
    }
  });

  it("refuses every customer-data key by name, from a bag assembled by string key", () => {
    // The registry's validator, over the whole list of names a caller might reach for.
    // This is the half that holds against a cast, so it is the half that runs over
    // every name rather than three representative ones.
    for (const key of CUSTOMER_DATA_KEYS) {
      const attempt = { [key]: "customer-data" };
      const issues = validateModelMetadata(attempt);
      assert.ok(
        issues.length > 0,
        `metadata key "${key}" must be refused, but was accepted`,
      );
      assert.match(
        issues.join(" "),
        new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `the refusal for "${key}" must name the offending key`,
      );
    }
  });
});
