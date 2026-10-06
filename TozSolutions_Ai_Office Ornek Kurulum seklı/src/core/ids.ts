import { randomUUID } from "node:crypto";

/**
 * Identifier generation.
 *
 * Kept behind an interface so that tests can produce stable identifiers and
 * so that identifier format stays a single decision rather than scattered
 * `crypto.randomUUID()` calls.
 */

export interface IdGenerator {
  newId(prefix?: string): string;
}

export const uuidIdGenerator: IdGenerator = {
  newId: (prefix?: string) => (prefix ? `${prefix}_${randomUUID()}` : randomUUID()),
};

/** Monotonic generator for deterministic tests. */
export class SequentialIdGenerator implements IdGenerator {
  #counter = 0;

  public constructor(private readonly prefix = "id") {}

  public newId(suffix?: string): string {
    this.#counter += 1;
    const base = `${this.prefix}-${this.#counter}`;
    return suffix ? `${base}-${suffix}` : base;
  }
}
