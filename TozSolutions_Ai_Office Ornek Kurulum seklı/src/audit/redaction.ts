/**
 * Secret-safe redaction.
 *
 * Defence in depth. PHASE 01 should never be handed a secret in the first
 * place (secrets live behind SecretRef), but the audit layer must not become a
 * leak if a future caller gets that wrong.
 *
 * Two independent mechanisms:
 *  1. Key-name matching - case-insensitive, on WORD RUNS. See `wordRuns`.
 *  2. Value-shape detection - catches obvious token formats in free text.
 *
 * ## PHASE 11: WHY IT IS WORD RUNS AND NOT SUBSTRINGS
 *
 * `TODO.md` PHASE 11 item 10 asked for the substring semantics to be reviewed, on the theory
 * that `sessionId` and `conversation` were being redacted. Measured, that was half right and the
 * half that was wrong mattered more: `conversation` is **not** redacted, which is correct — it
 * is an innocent word. The real defect ran the OTHER way.
 *
 * Substring matching over-redacted 18 innocent keys in a 47-key probe:
 * `secretariatName`, `tokenizerCount`, `tokenizerModel`, `sessionCount`, `sessionTotal`,
 * `passwordPolicy`, `passwordRules`, `cookiePolicy`, `bearerCapacity`, `dsnName`,
 * `credentialStore`, `signaturesCollected`, `passphraseLength`, `authorizationHeader`,
 * `apiKeyCount` and more. Every one of those became `[REDACTED]` in an audit trail, which is a
 * **false record** rather than a leak — and this repository has now twice found that a
 * confidently wrong record is worse than an absent one (the retrieval engine claiming a
 * semantic search, the scope table claiming a durability).
 *
 * Word-run matching keeps every true positive and drops every false one: a sensitive name is
 * a whole word or a whole run of adjacent words (`awsSecretAccessKey` → `secret`;
 * `privateKeyPem` → `privatekey`; `apiKey` → `api`+`key` → `apikey`), and an innocent word that
 * merely CONTAINS one is left alone.
 */

const REDACTED = "[REDACTED]";

/**
 * Sensitive name fragments, in JOINED form.
 *
 * No separators: `wordRuns` produces runs with the separators removed, so `apiKey` and
 * `api_key` both arrive as `apikey` and match one entry. Keeping both spellings in this list
 * would be two entries that can never match.
 */
const SENSITIVE_KEY_FRAGMENTS: ReadonlySet<string> = new Set([
  "apikey",
  "authorization",
  // PHASE 10. `bearer` was previously covered only as a VALUE shape
  // ("Bearer eyJ..."), so a field literally named `bearer` holding a raw token was
  // recorded verbatim. Both are ordinary field names in an auth payload.
  "bearer",
  // PHASE 10. A connection string embeds a password, a host and often an API
  // key, and is a routine field in provider config. It was absent entirely.
  "connectionstring",
  "connstr",
  "cookie",
  "credential",
  "dsn",
  "passphrase",
  "password",
  "privatekey",
  "secret",
  "session",
  "signature",
  "token",
]);

/** Longest run of adjacent words considered, so `awsSecretAccessKey` can match `secret`. */
const MAX_RUN_WORDS = 3;

/**
 * Every contiguous run of up to `MAX_RUN_WORDS` adjacent words, joined without separators.
 *
 * camelCase is split first, so `apiKey` yields `api` + `key` and therefore the run `apikey`;
 * `awsSecretAccessKey` yields `aws` + `secret` + `access` + `key` and yields `secret`. A key
 * with no separators and no case change (`apikey`) yields itself.
 */
function wordRuns(key: string): readonly string[] {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
  const runs: string[] = [];
  for (let start = 0; start < words.length; start += 1) {
    let joined = "";
    for (let end = start; end < words.length && end - start < MAX_RUN_WORDS; end += 1) {
      joined += words[end];
      runs.push(joined);
    }
  }
  return runs;
}

export function isSensitiveKey(key: string): boolean {
  return wordRuns(key).some((run) => SENSITIVE_KEY_FRAGMENTS.has(run));
}

/**
 * Strict form: the string is EXACTLY a sensitive name, not merely containing
 * one. Used for free-text values, where substring matching would redact an
 * entire sentence just because it mentions "token".
 */
export function isExactlySensitiveKey(value: string): boolean {
  // Separators are removed for the same reason `wordRuns` removes them: the fragment set is in
  // joined form, so `api_key`, `api-key` and `apiKey` must all reach it as `apikey`.
  return SENSITIVE_KEY_FRAGMENTS.has(value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ""));
}

/** Value patterns for well-known credential formats. */
const VALUE_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // sk- style provider keys
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/g, // Authorization headers
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWTs
];

export function redactString(value: string): string {
  // A string that IS exactly a sensitive field name (e.g. an audit
  // `changedFields` entry naming a credential field) is redacted, because
  // recording the name of a credential field is itself worth flagging. The
  // strict check is used so ordinary prose mentioning "token" is not
  // wholesale redacted.
  if (isExactlySensitiveKey(value)) {
    return REDACTED;
  }
  let out = value;
  for (const pattern of VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

const MAX_DEPTH = 8;
const MAX_STRING_LENGTH = 2_000;

/**
 * Recursively redacts a value for safe inclusion in an audit event.
 * Cycles are replaced with "[Circular]"; long strings are truncated.
 */
export function redact(value: unknown, keyHint?: string, depth = 0, seen = new WeakSet<object>()): unknown {
  if (keyHint !== undefined && isSensitiveKey(keyHint)) {
    return REDACTED;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    const redacted = redactString(value);
    return redacted.length > MAX_STRING_LENGTH
      ? `${redacted.slice(0, MAX_STRING_LENGTH)}...[truncated]`
      : redacted;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) {
      return "[MaxDepth]";
    }
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    if (Array.isArray(value)) {
      return value.map((entry) => redact(entry, undefined, depth + 1, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redact(entry, key, depth + 1, seen);
    }
    return out;
  }
  // Functions, symbols, bigints: not serialisable, so record the type only.
  return `[${typeof value}]`;
}

export interface RedactionReport {
  readonly value: unknown;
  readonly redactedFields: readonly string[];
}

export function redactWithReport(value: unknown): RedactionReport {
  const redactedFields: string[] = [];
  const walk = (node: unknown, keyHint: string | undefined, depth: number, seen: WeakSet<object>): unknown => {
    if (keyHint !== undefined && isSensitiveKey(keyHint)) {
      redactedFields.push(keyHint);
      return REDACTED;
    }
    if (typeof node === "string") {
      return redactString(node);
    }
    if (node === null || typeof node !== "object") {
      return node;
    }
    if (depth >= MAX_DEPTH) {
      return "[MaxDepth]";
    }
    if (seen.has(node)) {
      return "[Circular]";
    }
    seen.add(node);
    if (Array.isArray(node)) {
      return node.map((entry) => walk(entry, undefined, depth + 1, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(node as Record<string, unknown>)) {
      out[key] = walk(entry, key, depth + 1, seen);
    }
    return out;
  };
  return { value: walk(value, undefined, 0, new WeakSet<object>()), redactedFields };
}
