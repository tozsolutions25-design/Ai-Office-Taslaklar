/**
 * Secret references.
 *
 * PHASE 01 hard rule: a secret VALUE never lives in a domain record, in the
 * configuration object, in an audit event, or in the repository. A record
 * only ever carries a *reference* describing where the value should be
 * obtained from at execution time.
 *
 * Two reference kinds are modelled:
 *  - `env`  : read from a named environment variable.
 *  -store  : read from a named slot in an injected secret store adapter.
 *
 * Both are opaque handles. Resolution happens at the provider-adapter
 * boundary in a later phase, and the resolved value is never propagated into
 * registries, routing decisions, or audit events.
 */

export const SECRET_REF_KINDS = ["env", "store"] as const;
export type SecretRefKind = (typeof SECRET_REF_KINDS)[number];

export interface SecretRef {
  readonly kind: SecretRefKind;
  /** Environment variable name, or secret-store key. Never the secret itself. */
  readonly key: string;
  /** Optional non-sensitive hint, e.g. "bearer" or "header:X-Api-Key". */
  readonly hint?: string;
}

export function envSecretRef(key: string, hint?: string): SecretRef {
  return hint === undefined ? { kind: "env", key } : { kind: "env", key, hint };
}

export function storeSecretRef(key: string, hint?: string): SecretRef {
  return hint === undefined ? { kind: "store", key } : { kind: "store", key, hint };
}

export function isSecretRef(value: unknown): value is SecretRef {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<SecretRef>;
  return (
    (candidate.kind === "env" || candidate.kind === "store") && typeof candidate.key === "string"
  );
}

/**
 * A secret store boundary. No implementation ships in PHASE 01; the core only
 * depends on this interface so that secret resolution stays pluggable and
 * testable.
 */
export interface SecretStore {
  /** Returns the secret value. Callers must not log or persist the result. */
  read(ref: SecretRef): Promise<string | null>;
}

/** A secret store that holds no secrets. Safe default when none is configured. */
export class EmptySecretStore implements SecretStore {
  public read(_ref: SecretRef): Promise<string | null> {
    return Promise.resolve(null);
  }
}
