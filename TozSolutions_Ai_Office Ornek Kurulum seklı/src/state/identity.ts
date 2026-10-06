/**
 * PHASE 12: restart-safe identifiers.
 *
 * ## WHAT THIS REPLACES, AND WHY IT WAS A REAL DEFECT
 *
 * Two identity sources in this repository were process-local counters:
 *
 *   `CheckpointStore`:  `checkpointId: `cp-${this.#counter}``      (gates.ts)
 *   `ClaimRegistry`:    `token: `claim-${taskId}-${counter}``       (claims.ts)
 *
 * Both were measured, not assumed. The Phase 12 discovery probe opened a fresh `CheckpointStore`
 * and wrote its first checkpoint, and it was `cp-1` - the same identity the pre-restart store had
 * already minted. Two different checkpoints, one id.
 *
 * A counter is fine for identity only when nothing outlives the process. These two things are
 * persisted, so their identity has to survive the process too.
 *
 * ## WHY A HASH AND NOT A RANDOM STRING
 *
 * `randomUUID()` would also be unique, and it was rejected for a specific reason: the identity
 * would carry NO relationship to what it names. The contract the design approved asks for an
 * identity that is restart-safe, collision-resistant AND traceable to job/task ownership.
 *
 * Deriving it means the id can be recomputed from the durable row, verified without a lookup,
 * and - the reason this matters - an id that turns up attached to the WRONG job is detectable,
 * because recomputing it from that job produces a different value.
 *
 * ## WHY HMAC AND NOT A BARE HASH
 *
 * The inputs are predictable (a workspace, a job id, a sequence number), so a bare SHA-256 would
 * let anyone who can guess the inputs forge an id for a checkpoint they did not write. HMAC with
 * a secret key means the mapping is not computable without the key.
 *
 * The key is supplied by the caller rather than generated here on purpose: a key generated in
 * this module would be new on every start, which would make every id from a previous run
 * unverifiable - the exact failure being fixed.
 */

import { createHmac, randomBytes } from "node:crypto";

/**
 * Crockford-style base32, lowercase, no padding.
 *
 * Chosen over hex because an id appears in log lines and URLs where `i`/`l`/`o`/`u` are
 * ambiguous, and over base64 because `+`, `/` and `=` are not URL-safe. The alphabet omits them.
 */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function base32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Length-prefixed field join.
 *
 * The same shape `workspaceKey` and `StateStore.#ns` use, and for the same reason: without it
 * `("ab", "c")` and `("a", "bc")` hash identically, so two different (job, task) pairs could
 * derive the same checkpoint id.
 */
function fields(parts: readonly (string | number)[]): string {
  return parts.map((part) => `${String(part).length}:${String(part)}`).join("\0");
}

/** Number of base32 characters kept. 20 chars is 100 bits - far past any collision worry here. */
const ID_LENGTH = 20;

export interface IdentityKey {
  /** The secret. Supplied by the caller so it can outlive the process. */
  readonly secret: string;
  /** The durable schema version, so an id cannot survive a schema change it was not minted under. */
  readonly schemaVersion: number;
}

/**
 * A checkpoint id.
 *
 * Restart-safe because nothing in the inputs is a process counter: `sequence` comes from
 * `nextCheckpointSequence`, which is read from the durable rows.
 */
export function checkpointIdentity(key: IdentityKey, parts: { workspace: string; jobId: string; taskId: string; sequence: number; executionId: string }): string {
  const digest = createHmac("sha256", key.secret)
    .update(fields([key.schemaVersion, parts.workspace, parts.jobId, parts.taskId, parts.sequence, parts.executionId]))
    .digest();
  return `cp_${base32(digest).slice(0, ID_LENGTH)}`;
}

/**
 * A claim token.
 *
 * Uniqueness comes from a random nonce, and that is a correction rather than the original plan.
 * The approved design derived the token from `acquiredAt`, which is restart-safe - and the
 * restart test caught the hole: with a frozen clock, a released-then-reacquired claim in the same
 * millisecond derives the SAME token as the one before it. `verify()` compares tokens, so the
 * stale worker would have been accepted. A deterministic derivation cannot fix that, because the
 * inputs really are identical.
 *
 * So the token is a CAPABILITY rather than a derivation: a nonce makes each one distinct, and
 * traceability does not depend on the token at all - the durable claim row already records which
 * job, task and worker a token belongs to, which is what an auditor actually reads.
 *
 * `acquiredAt` stays in the inputs because it costs nothing and keeps tokens from one restart
 * window distinguishable from another.
 */
export function claimToken(key: IdentityKey, parts: { workspace: string; jobId: string; taskId: string; workerId: string; acquiredAt: number }): string {
  const nonce = randomBytes(8).toString("hex");
  const digest = createHmac("sha256", key.secret)
    .update(fields([key.schemaVersion, parts.workspace, parts.jobId, parts.taskId, parts.workerId, parts.acquiredAt, nonce]))
    .digest();
  return `clm_${base32(digest).slice(0, ID_LENGTH)}`;
}