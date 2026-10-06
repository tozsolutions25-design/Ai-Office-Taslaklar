/**
 * Injectable clock.
 *
 * Every time-dependent component (retry backoff, health timestamps, audit
 * events, concurrency leases) takes a Clock. Tests inject a deterministic
 * clock so that timing behaviour is verifiable without real waiting.
 */

export interface Clock {
  now(): Date;
  nowMs(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowMs: () => Date.now(),
  sleep: (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms).unref?.();
    }),
};

/** Test clock: time only advances when the test advances it. */
export class ManualClock implements Clock {
  #current: number;
  #recordedSleeps: number[] = [];

  public constructor(start: Date | number = 0) {
    this.#current = typeof start === "number" ? start : start.getTime();
  }

  public now(): Date {
    return new Date(this.#current);
  }

  public nowMs(): number {
    return this.#current;
  }

  /** Records the requested delay and resolves immediately without waiting. */
  public sleep(ms: number): Promise<void> {
    this.#recordedSleeps.push(ms);
    this.#current += ms;
    return Promise.resolve();
  }

  public advance(ms: number): void {
    this.#current += ms;
  }

  public get recordedSleeps(): readonly number[] {
    return this.#recordedSleeps;
  }
}
