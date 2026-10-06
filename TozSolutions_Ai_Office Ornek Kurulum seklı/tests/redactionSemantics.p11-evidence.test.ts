/**
 * PHASE 11 EVIDENCE - redaction matches WORDS, and the boundary it draws is deliberate.
 *
 * ## WHAT TODO ASKED, AND WHAT WAS ACTUALLY TRUE
 *
 * `TODO.md` PHASE 11 item 10: "`isSensitiveKey` denylist has 19 entries and substring-matches,
 * so `sessionId` and `conversation` are redacted while a field like `secretariatName` would be
 * too. Review the substring semantics."
 *
 * Measured over a 47-key probe, that was half right, and the half that was wrong mattered more.
 * **`conversation` is NOT redacted** — which is correct; it is an innocent word. The real defect
 * ran the other way: substring matching redacted **18 innocent keys**, including
 * `secretariatName`, `tokenizerCount`, `tokenizerModel`, `sessionCount`, `passwordPolicy`,
 * `credentialStore` and `signaturesCollected`.
 *
 * ## WHY THAT IS WORTH FIXING
 *
 * A `[REDACTED]` where a count belonged is a **false record**. This repository has now found
 * that shape twice already — the retrieval engine reporting a semantic search it did not run,
 * and the scope table claiming a durability nothing provided — and both times the conclusion
 * was the same: a confidently wrong record is worse than an absent one, because it is believed.
 *
 * ## WHERE THE NEW LINE IS DRAWN, AND WHY IT IS NOT FURTHER
 *
 * Word-run matching: a sensitive name is a whole word or a whole run of adjacent words. That
 * removes every case where the fragment sits INSIDE a larger innocent word.
 *
 * It deliberately keeps redacting `tokenCount`, `sessionTotal` and `passwordPolicy`, because in
 * those the sensitive word stands WHOLE — and from the field name alone, `tokenCount` could hold
 * a token. The asymmetry decides it: a false positive loses a little metadata from an audit
 * trail, while a false negative puts a credential in one. Those are not comparable costs, so
 * the line is drawn where the name stops being informative, not where it stops being
 * inconvenient.
 *
 * That remainder is asserted below as INTENTIONAL, so the next reader does not "finish the job"
 * by moving the line and quietly reintroducing a leak.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isExactlySensitiveKey, isSensitiveKey, redact } from "../src/audit/redaction.js";

describe("PHASE 11 EVIDENCE - redaction name matching", () => {
  it("still redacts every sensitive name, in every spelling", () => {
    // The half that must not move. Each of these is a real credential field name, and the
    // spelling varies across codebases — so `apiKey`, `api_key` and `API-KEY` are one test.
    for (const key of [
      "apiKey",
      "api_key",
      "API-KEY",
      "authorization",
      "bearer",
      "cookie",
      "credential",
      "dsn",
      "passphrase",
      "password",
      "privateKey",
      "private_key",
      "secret",
      "session",
      "signature",
      "token",
    ]) {
      assert.equal(isSensitiveKey(key), true, `${key} must be redacted`);
    }
  });

  it("still redacts a compound name where a sensitive word stands WHOLE", () => {
    // The cases word-run matching has to earn rather than assume: the sensitive fragment is
    // separated by a boundary, so a naive "whole key equals a fragment" rule would miss these.
    for (const key of [
      "userPassword",
      "dbPassword",
      "authToken",
      "refreshToken",
      "sessionToken",
      "secretKey",
      "clientSecret",
      "connectionString",
      "connStr",
      "privateKeyPem",
      "awsSecretAccessKey",
      "idToken",
      "accessToken",
    ]) {
      assert.equal(isSensitiveKey(key), true, `${key} must be redacted — the sensitive word stands whole`);
    }
  });

  it("no longer redacts an innocent word that merely CONTAINS a fragment", () => {
    // The defect. Before Phase 11 every one of these was `[REDACTED]` in an audit trail.
    for (const key of [
      "secretariatName",
      "secretariat",
      "tokenizer",
      "tokenizerModel",
      "tokenizerVersion",
      "signaturesCollected",
      "conversation",
      "conversationId",
      "conversationCount",
    ]) {
      assert.equal(isSensitiveKey(key), false, `${key} contains a fragment but is not one, and must survive`);
    }
  });

  it("keeps redacting where the sensitive word stands whole, and says why", () => {
    // INTENTIONAL, and the reason is an asymmetry rather than an oversight: from the NAME alone
    // `tokenCount` could hold a token. A false positive costs a little audit metadata; a false
    // negative puts a credential in the trail. Those are not comparable, so the line is drawn
    // where the name stops being informative.
    for (const key of ["tokenCount", "sessionCount", "sessionTotal", "passwordPolicy", "credentialStore"]) {
      assert.equal(isSensitiveKey(key), true, `${key} keeps a whole sensitive word, so it stays redacted`);
    }
  });

  it("carries the same rule into nested structures and free-text values", () => {
    // `redact` is what callers actually use, so the key rule has to hold through it and not
    // only in isolation.
    const output = redact({
      secretariatName: "Jane Smith",
      userPassword: "hunter2",
      nested: { apiKey: "sk-live-abcdefghijklmnop", tokenizerCount: 4 },
      prose: "the tokenizer model has 4 tokens",
    }) as Record<string, unknown>;

    assert.equal(output["secretariatName"], "Jane Smith", "an innocent name survives");
    assert.equal(output["userPassword"], "[REDACTED]", "a real one does not");
    const nested = output["nested"] as Record<string, unknown>;
    assert.equal(nested["apiKey"], "[REDACTED]");
    assert.equal(nested["tokenizerCount"], 4, "and an innocent sibling inside it survives too");
    assert.match(String(output["prose"]), /tokenizer model has 4 tokens/, "prose is not a key and is left alone");
  });

  it("keeps the strict form working for a free-text value that IS a field name", () => {
    // `isExactlySensitiveKey` exists so an audit `changedFields` entry naming a credential
    // field is redacted while a sentence mentioning "token" is not. The fragment set changed
    // shape in Phase 11 (joined, no separators), so both spellings have to still arrive.
    for (const value of ["api_key", "apiKey", "API-KEY", "password", "private_key"]) {
      assert.equal(isExactlySensitiveKey(value), true, `${value} is exactly a sensitive name`);
    }
    for (const value of ["the user supplied a token", "tokenizer", "conversation"]) {
      assert.equal(isExactlySensitiveKey(value), false, `${value} is prose, not a field name`);
    }
  });
});
