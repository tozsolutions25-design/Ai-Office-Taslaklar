/**
 * A minimal, dependency-free Result type.
 *
 * The core deliberately avoids exceptions for *expected* failures (validation
 * errors, capability mismatches, invalid state transitions). Exceptions are
 * reserved for programmer error.
 */

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}
