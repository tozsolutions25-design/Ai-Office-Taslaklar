/**
 * TOZ AI Office — public core API.
 *
 * PHASE 01 scope: infrastructure only. No provider adapters, no provider
 * registry entries, no model registry entries, no live discovery, no
 * orchestration loop.
 */

export { createCore, type Core, type CoreOptions } from "./core/composition.js";

export {
  CapacityError,
  ClassifiedError,
  ERROR_CLASSES,
  InvalidTransitionError,
  ValidationError,
  isErrorClass,
  isRetryableErrorClass,
  type ErrorClass,
} from "./core/errors.js";

export { ManualClock, systemClock, type Clock } from "./core/clock.js";
export { SequentialIdGenerator, uuidIdGenerator, type IdGenerator } from "./core/ids.js";
export { err, ok, type Err, type Ok, type Result } from "./core/result.js";
export {
  EmptySecretStore,
  SECRET_REF_KINDS,
  envSecretRef,
  isSecretRef,
  storeSecretRef,
  type SecretRef,
  type SecretRefKind,
  type SecretStore,
} from "./core/secretRef.js";

export * from "./capabilities/index.js";
export * from "./workload/index.js";
export * from "./health/index.js";
export * from "./providers/index.js";
export * from "./models/index.js";
export * from "./queue/index.js";
export * from "./concurrency/index.js";
export * from "./retry/index.js";
export * from "./routing/index.js";
export * from "./audit/index.js";
export * from "./state/index.js";
export * from "./config/index.js";
export * from "./knowledge/index.js";
