import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CapacityError } from "../src/core/errors.js";
import { ConcurrencyManager } from "../src/concurrency/index.js";

describe("concurrency limiter", () => {
  it("enforces a global limit", async () => {
    const manager = new ConcurrencyManager({ globalLimit: 2, globalMaxWaiting: 0 });
    const first = await manager.acquire({ providerId: "acme", modelId: "m" });
    const second = await manager.acquire({ providerId: "acme", modelId: "m" });
    assert.equal(manager.globalInFlight, 2);
    await assert.rejects(
      manager.acquire({ providerId: "acme", modelId: "m" }),
      CapacityError,
    );
    first.release();
    second.release();
    assert.equal(manager.globalInFlight, 0);
  });

  it("releases a slot when a lease is released", async () => {
    const manager = new ConcurrencyManager({ globalLimit: 1, globalMaxWaiting: 0 });
    const lease = await manager.acquire({ providerId: "acme", modelId: "m" });
    assert.equal(manager.stats().global.inFlight, 1);
    lease.release();
    assert.equal(manager.stats().global.inFlight, 0);
    const again = await manager.acquire({ providerId: "acme", modelId: "m" });
    assert.equal(again !== null, true);
    again.release();
  });

  it("treats a repeated release as a no-op", async () => {
    const manager = new ConcurrencyManager({ globalLimit: 1, globalMaxWaiting: 0 });
    const lease = await manager.acquire({ providerId: "acme", modelId: "m" });
    lease.release();
    lease.release();
    lease.release();
    assert.equal(manager.stats().global.inFlight, 0);
  });

  it("enforces a provider-specific limit below the global limit", async () => {
    const manager = new ConcurrencyManager({
      globalLimit: 10,
      globalMaxWaiting: 0,
      providerLimits: { acme: 1 },
    });
    const held = await manager.acquire({ providerId: "acme", modelId: "m" });
    await assert.rejects(manager.acquire({ providerId: "acme", modelId: "m" }), CapacityError);
    // A different provider is unaffected by acme's limit.
    const other = await manager.acquire({ providerId: "globex", modelId: "m" });
    assert.ok(other);
    held.release();
    other.release();
  });

  it("enforces a model-specific limit", async () => {
    const manager = new ConcurrencyManager({
      globalLimit: 10,
      globalMaxWaiting: 0,
      modelLimits: { "acme/m1": 1 },
    });
    const held = await manager.acquire({ providerId: "acme", modelId: "m1" });
    await assert.rejects(manager.acquire({ providerId: "acme", modelId: "m1" }), CapacityError);
    const other = await manager.acquire({ providerId: "acme", modelId: "m2" });
    assert.ok(other, "a different model must not be blocked");
    held.release();
    other.release();
  });

  it("bounds the number of requests waiting for a slot", async () => {
    const manager = new ConcurrencyManager({
      globalLimit: 1,
      globalMaxWaiting: 1,
      providerLimits: { acme: 1 },
    });
    const running = await manager.acquire({ providerId: "acme", modelId: "m" });
    // Exactly one request may wait at the gate.
    const parked = manager.acquire({ providerId: "acme", modelId: "m" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(manager.stats().global.waiting, 1);

    // A further request is refused rather than joining an unbounded wait list.
    await assert.rejects(
      manager.acquire({ providerId: "acme", modelId: "m" }),
      /wait queue for global is full/,
    );

    running.release();
    const parkedLease = await parked;
    parkedLease.release();
    assert.equal(manager.stats().global.inFlight, 0);
    assert.equal(manager.stats().providers["acme"]?.inFlight, 0, "every layer must be returned");
  });

  it("holds an upstream layer while parked on a downstream one, and releases it on failure", async () => {
    // Documented cost of the fixed global -> provider -> model ordering: a
    // request parked on the provider layer still holds its global slot. The
    // bound above is what keeps that set finite.
    const manager = new ConcurrencyManager({
      globalLimit: 4,
      globalMaxWaiting: 5,
      providerLimits: { acme: 1 },
    });
    const running = await manager.acquire({ providerId: "acme", modelId: "m" });
    const parked = manager.acquire({ providerId: "acme", modelId: "m" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(manager.stats().global.inFlight, 2, "the parked request holds its global slot");
    assert.equal(manager.stats().providers["acme"]?.inFlight, 1, "but not a second provider slot");

    // Force the downstream wait to fail; the upstream slot must be given back.
    manager.close("test shutdown");
    await assert.rejects(parked, /test shutdown/);
    assert.equal(manager.stats().global.inFlight, 1, "a failed acquisition must not leak its global slot");

    running.release();
    assert.equal(manager.stats().global.inFlight, 0);
  });

  it("fails fast rather than growing an unbounded wait queue", async () => {
    const manager = new ConcurrencyManager({ globalLimit: 1, globalMaxWaiting: 1 });
    const held = await manager.acquire({ providerId: "acme", modelId: "m" });
    const waiting = manager.acquire({ providerId: "acme", modelId: "m" });
    await assert.rejects(manager.acquire({ providerId: "acme", modelId: "m" }), CapacityError);
    held.release();
    (await waiting).release();
  });

  it("hands a released slot to the next waiter", async () => {
    const manager = new ConcurrencyManager({ globalLimit: 1, globalMaxWaiting: 2 });
    const first = await manager.acquire({ providerId: "acme", modelId: "m" });
    const order: string[] = [];
    const secondPromise = manager.acquire({ providerId: "acme", modelId: "m" }).then((lease) => {
      order.push("second");
      return lease;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, []);
    first.release();
    const second = await secondPromise;
    assert.deepEqual(order, ["second"]);
    second.release();
  });

  it("supports a non-blocking tryAcquire", () => {
    const manager = new ConcurrencyManager({ globalLimit: 1, globalMaxWaiting: 0 });
    const lease = manager.tryAcquire({ providerId: "acme", modelId: "m" });
    assert.ok(lease);
    assert.equal(manager.tryAcquire({ providerId: "acme", modelId: "m" }), null);
    lease.release();
    const again = manager.tryAcquire({ providerId: "acme", modelId: "m" });
    assert.ok(again);
    again.release();
  });

  it("keeps logical representation separate from physical enforcement", () => {
    // A large logical task count is safe because only the physical limit is
    // enforced. The logical numbers are configuration, not semaphores.
    const manager = new ConcurrencyManager({ globalLimit: 2, globalMaxWaiting: 0 });
    assert.equal(manager.globalLimit, 2);
    const stats = manager.stats();
    assert.equal(stats.providers["acme"], undefined, "no provider semaphore exists before first use");
  });

  it("exposes per-layer statistics after use", async () => {
    const manager = new ConcurrencyManager({ globalLimit: 4, globalMaxWaiting: 0 });
    const lease = await manager.acquire({ providerId: "acme", modelId: "m" });
    const stats = manager.stats();
    assert.equal(stats.global.inFlight, 1);
    assert.equal(stats.providers["acme"]?.inFlight, 1);
    assert.equal(stats.models["acme/m"]?.inFlight, 1);
    lease.release();
  });

  it("rejects an invalid limit at construction", () => {
    assert.throws(() => new ConcurrencyManager({ globalLimit: 0 }), /positive integer/);
    assert.throws(() => new ConcurrencyManager({ globalLimit: -3 }), /positive integer/);
  });

  it("rejects further acquisitions after close", async () => {
    const manager = new ConcurrencyManager({ globalLimit: 2, globalMaxWaiting: 1 });
    manager.close("test shutdown");
    await assert.rejects(manager.acquire({ providerId: "acme", modelId: "m" }), /test shutdown/);
  });

  it("holds many logical tasks while capping physical calls", async () => {
    const manager = new ConcurrencyManager({ globalLimit: 3, globalMaxWaiting: 100 });
    let maxObserved = 0;
    let running = 0;
    const run = async (): Promise<void> => {
      const lease = await manager.acquire({ providerId: "acme", modelId: "m" });
      running += 1;
      maxObserved = Math.max(maxObserved, running);
      await Promise.resolve();
      running -= 1;
      lease.release();
    };
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => run()));
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    assert.equal(fulfilled.length, 20, "20 logical tasks must all be representable");
    assert.ok(maxObserved <= 3, `physical concurrency exceeded the limit: ${maxObserved}`);
    assert.equal(manager.stats().global.inFlight, 0, "every slot must be returned");
  });
});
