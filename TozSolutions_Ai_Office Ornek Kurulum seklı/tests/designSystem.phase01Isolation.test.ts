import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { createCore } from "../src/index.js";
import * as designSystem from "../src/design-system/index.js";
import * as coreCapabilities from "../src/capabilities/index.js";
import { CapabilitySet } from "../src/capabilities/capability.js";
import { ProviderRegistry } from "../src/providers/index.js";
import { ModelRegistry } from "../src/models/index.js";
import { ManualClock } from "../src/core/clock.js";
import { SequentialIdGenerator } from "../src/core/ids.js";
import { validateWorkload } from "../src/workload/index.js";
import { TaskQueue } from "../src/queue/index.js";
import { ConcurrencyManager } from "../src/concurrency/index.js";
import { RetryExecutor, DEFAULT_RETRY_POLICY } from "../src/retry/index.js";
import { InMemoryHealthMonitor, UNKNOWN_HEALTH } from "../src/health/index.js";
import { DefaultRouter } from "../src/routing/index.js";
import { AuditLog } from "../src/audit/index.js";
import { StateStore } from "../src/state/index.js";
import { loadConfig } from "../src/config/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..", "..", "src");

function collect(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...collect(absolute));
    } else if (absolute.endsWith(".ts")) {
      found.push(absolute);
    }
  }
  return found;
}

const allSourceFiles = collect(srcRoot);

/**
 * The four source trees, partitioned by directory.
 *
 * PHASE 03 added `src/site`, which the site is ALLOWED to depend on and which
 * depends on nothing else. PHASE 04 added `src/orchestration`, which composes the
 * core and may not be imported by it. Partitioning by explicit membership rather
 * than by "everything that is not the design system" keeps this correct as trees
 * are added, instead of silently widening `coreFiles` to include the site.
 */
const designSystemRoot = path.resolve(srcRoot, "design-system");
const siteRoot = path.resolve(srcRoot, "site");
const orchestrationRoot = path.resolve(srcRoot, "orchestration");

/** True when `file` is inside `root`, by path parts rather than substring. */
function isInside(file: string, root: string): boolean {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const designSystemFiles = allSourceFiles.filter((file) => isInside(file, designSystemRoot));
const siteFiles = allSourceFiles.filter((file) => isInside(file, siteRoot));
const orchestrationFiles = allSourceFiles.filter((file) => isInside(file, orchestrationRoot));
const coreFiles = allSourceFiles.filter(
  (file) =>
    !isInside(file, designSystemRoot) &&
    !isInside(file, siteRoot) &&
    !isInside(file, orchestrationRoot),
);

describe("PHASE 02 does not couple the core to the UI", () => {
  it("has all four source trees available to check", () => {
    assert.ok(designSystemFiles.length > 20, "expected a substantial design system");
    assert.ok(coreFiles.length > 30, "expected the PHASE 01 core to be intact");
    assert.ok(siteFiles.length > 5, "expected the PHASE 03 site layer");
    assert.ok(orchestrationFiles.length > 15, "expected the PHASE 04 orchestration layer");
    // The partition must be disjoint, or the independence checks below would
    // pass or fail for the wrong reason.
    const all = new Set([...designSystemFiles, ...siteFiles, ...orchestrationFiles, ...coreFiles]);
    assert.equal(all.size, allSourceFiles.length, "the four trees must partition the source");
  });

  it("keeps the core free of any dependency on the orchestration layer", () => {
    // The dependency arrow points core <- orchestration. An import the other way
    // would make the composition root depend on the thing it composes, and would
    // let an orchestration decision reach in and change core behaviour.
    for (const file of coreFiles) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
        assert.doesNotMatch(
          match[1] ?? "",
          /(^|\/)orchestration(\/|$)/,
          `${path.relative(srcRoot, file)} imports the orchestration layer: ${match[1]}`,
        );
      }
    }
  });

  it("keeps the site free of any dependency on the orchestration layer", () => {
    // A marketing page must never end up behind the runtime.
    for (const file of siteFiles) {
      const source = readFileSync(file, "utf8");
      assert.equal(
        /from\s+"[^"]*orchestration[^"]*"/.test(source),
        false,
        `${path.relative(srcRoot, file)} must not import the orchestration layer`,
      );
    }
  });

  it("keeps every design-system file free of imports from the core", () => {
    // A design system that imported the registries, the router or the audit log
    // would make presentation a dependency of orchestration, which is exactly
    // the coupling this phase must avoid.
    //
    // Relative specifiers are RESOLVED against the importing file, because
    // `../utils/html.js` is a design-system-internal import while
    // `../core/secretRef.js` is an escape into the core.
    const designSystemRoot = path.resolve(srcRoot, "design-system");
    const offenders: string[] = [];
    for (const file of designSystemFiles) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
        const specifier = match[1];
        if (!specifier.startsWith(".")) {
          continue;
        }
        const resolved = path.resolve(path.dirname(file), specifier.replace(/\.js$/, ".ts"));
        const relativeToDesignSystem = path.relative(designSystemRoot, resolved);
      const escapes = relativeToDesignSystem.startsWith("..") || path.isAbsolute(relativeToDesignSystem);
        if (escapes) {
          offenders.push(`${path.relative(srcRoot, file)} imports ${specifier}`);
        }
      }
    }
    assert.deepEqual(offenders, [], `design system must not import from the core:\n${offenders.join("\n")}`);
  });

  it("actually resolves internal design-system imports rather than rejecting all relatives", () => {
    // Guards the guard: if the check above passed simply because it matched
    // nothing, it would be worthless. These imports must NOT be flagged.
    const designSystemRoot = path.resolve(srcRoot, "design-system");
    const samples = [
      path.join(designSystemRoot, "primitives", "button.ts"),
      path.join(designSystemRoot, "layout", "primitives.ts"),
    ];
    for (const file of samples) {
      const source = readFileSync(file, "utf8");
      const relatives = [...source.matchAll(/from\s+"(\.[^"]+)"/g)].map((match) => match[1]);
      assert.ok(relatives.length > 0, `${path.basename(file)} should have relative imports`);
      for (const specifier of relatives) {
        const resolved = path.resolve(path.dirname(file), specifier.replace(/\.js$/, ".ts"));
        const relative = path.relative(designSystemRoot, resolved);
        assert.ok(
          !relative.startsWith(".."),
          `${path.basename(file)} -> ${specifier} should stay inside the design system`,
        );
      }
    }
  });

  it("keeps every core file free of imports from the design system", () => {
    const offenders: string[] = [];
    for (const file of coreFiles) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/from\s+"([^"]*design-system[^"]*)"/g)) {
        offenders.push(`${path.relative(srcRoot, file)} imports ${match[1]}`);
      }
    }
    assert.deepEqual(offenders, [], `the core must not import the design system:\n${offenders.join("\n")}`);
  });

  it("does not re-export the design system from the main core entry point", () => {
    // The core stays a headless library; the UI is a separate entry point.
    const entry = readFileSync(path.join(srcRoot, "index.ts"), "utf8");
    assert.equal(entry.includes("design-system"), false);
  });

  it("names no provider anywhere in the design system or the site", () => {
    const forbidden = ["openrouter", "nvidia", "ollama", "anythingllm", "n8n", "telegram"];
    const offenders: string[] = [];
    for (const file of [...designSystemFiles, ...siteFiles]) {
      const source = readFileSync(file, "utf8").toLowerCase();
      for (const name of forbidden) {
        if (source.includes(name)) {
          offenders.push(`${path.relative(srcRoot, file)} mentions ${name}`);
        }
      }
    }
    assert.deepEqual(offenders, [], `no integration may be named in the design system:\n${offenders.join("\n")}`);
  });

  it("exposes the design system as a separate public entry point", () => {
    const manifest = JSON.parse(readFileSync(path.resolve(srcRoot, "..", "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    assert.ok("./design-system" in manifest.exports, "the design system needs its own entry point");
  });

  it("keeps the design system free of emoji used as UI icons", () => {
    // Emoji were explicitly excluded as UI icons.
    const offenders: string[] = [];
    for (const file of designSystemFiles) {
      if (file.endsWith("styles.css") === false && file.endsWith(".ts")) {
        const source = readFileSync(file, "utf8");
        if (/\p{Extended_Pictographic}/u.test(source)) {
          offenders.push(path.relative(srcRoot, file));
        }
      }
    }
    assert.deepEqual(offenders, [], `emoji must not be used as icons:\n${offenders.join("\n")}`);
  });

  it("adds no runtime dependency for the UI", () => {
    const manifest = JSON.parse(readFileSync(path.resolve(srcRoot, "..", "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    assert.equal(manifest.dependencies, undefined, "the core must remain dependency-free at runtime");
    // No UI framework, bundler, CSS engine, icon set, animation or DOM-emulation
    // library may have been added.
    const forbidden = [
      "react",
      "react-dom",
      "vue",
      "svelte",
      "@angular/core",
      "next",
      "vite",
      "webpack",
      "rollup",
      "esbuild",
      "postcss",
      "tailwindcss",
      "styled-components",
      "emotion",
      "framer-motion",
      "gsap",
      "lucide-react",
      "react-icons",
      "jsdom",
      "happy-dom",
      "linkedom",
      "playwright",
      "@playwright/test",
      "puppeteer",
      "cypress",
      "@testing-library/react",
    ];
    const added = Object.keys(manifest.devDependencies).filter((name) =>
      forbidden.some((entry) => name === entry || name.startsWith(`${entry}/`)),
    );
    assert.deepEqual(added, [], `no UI or browser dependency may be added, found: ${added.join(", ")}`);
  });

  it("exports components from the design system entry point", () => {
    for (const name of [
      "button",
      "link",
      "card",
      "badge",
      "input",
      "textarea",
      "select",
      "checkbox",
      "radio",
      "switchControl",
      "fieldset",
      "field",
      "form",
      "alert",
      "emptyState",
      "progress",
      "metric",
      "healthIndicator",
      "dialog",
      "confirmDialog",
      "popover",
      "tooltip",
      "header",
      "nav",
      "mobileNav",
      "container",
      "section",
      "grid",
      "stack",
      "cluster",
    ]) {
      assert.equal(typeof (designSystem as Record<string, unknown>)[name], "function", `${name} must be exported`);
    }
  });
});

describe("PHASE 01 core remains functional", () => {
  it("still composes the whole core", () => {
    const core = createCore();
    for (const key of ["config", "providers", "models", "queue", "concurrency", "audit", "health", "state", "router", "retry", "knowledge"]) {
      assert.ok((core as unknown as Record<string, unknown>)[key] !== undefined, `${key} missing from the composed core`);
    }
  });

  it("still validates configuration", () => {
    const result = loadConfig({ TOZ_ENV: "production" });
    assert.equal(result.ok, true);
  });

  it("still registers providers through the lifecycle", () => {
    const clock = new ManualClock(0);
    const providers = new ProviderRegistry({ clock });
    assert.equal(providers.register({ providerId: "p1" }).ok, true);
    // A duplicate must still be refused rather than overwriting the record.
    assert.equal(providers.register({ providerId: "p1" }).ok, false);
    assert.equal(providers.size, 1);
    assert.equal(providers.has("p1"), true);
    for (const step of ["verified", "probed", "classified", "awaiting_approval", "approved", "registered", "health_monitored", "production_pool"] as const) {
      assert.equal(providers.transition("p1", step).ok, true, `lifecycle step ${step} must still work`);
    }
    assert.equal(providers.lifecycleOf("p1")?.state, "production_pool");
  });

  it("still enforces model-to-provider integrity", () => {
    const clock = new ManualClock(0);
    const providers = new ProviderRegistry({ clock });
    const models = new ModelRegistry({ clock, providers });
    providers.register({ providerId: "p1" });
    assert.equal(models.register({ modelId: "m1", providerId: "p1" }).ok, true);
    assert.equal(models.register({ modelId: "m2", providerId: "ghost" }).ok, false);
  });

  it("still matches capabilities and reports unknown as unknown", () => {
    // Asserted against the CORE matcher, not a design-system copy: the design
    // system must not own a duplicate of this logic.
    const { matchCapabilities } = coreCapabilities;
    assert.equal(matchCapabilities(["coding"], CapabilitySet.supporting("coding")).verdict, "compatible");
    assert.equal(matchCapabilities(["vision"], CapabilitySet.of({ vision: "unsupported" })).verdict, "incompatible");
    assert.equal(matchCapabilities(["reasoning"], CapabilitySet.unknown()).verdict, "unknown");
  });

  it("still validates workloads", () => {
    assert.equal(validateWorkload({ class: "coding", requiredCapabilities: ["coding"] }).ok, true);
    assert.equal(validateWorkload({ class: "nope" }).ok, false);
  });

  it("still enforces queue capacity", () => {
    const queue = new TaskQueue({ maxTasks: 1, clock: new ManualClock(0), ids: new SequentialIdGenerator() });
    assert.equal(queue.enqueue({ taskId: "a", workload: "coding", input: "x" }).ok, true);
    assert.equal(queue.enqueue({ taskId: "b", workload: "coding", input: "x" }).ok, false);
  });

  it("still enforces concurrency limits", async () => {
    const manager = new ConcurrencyManager({ globalLimit: 1, globalMaxWaiting: 0 });
    const lease = await manager.acquire({ providerId: "p", modelId: "m" });
    assert.equal(manager.globalInFlight, 1);
    await assert.rejects(manager.acquire({ providerId: "p", modelId: "m" }));
    lease.release();
    assert.equal(manager.globalInFlight, 0);
  });

  it("still classifies retryable errors and stops on permanent ones", async () => {
    const executor = new RetryExecutor({ policy: DEFAULT_RETRY_POLICY, clock: new ManualClock(0) });
    let calls = 0;
    const outcome = await executor.execute(async () => {
      calls += 1;
      throw new (await import("../src/core/errors.js")).ClassifiedError("authentication_failure", "bad key");
    });
    assert.equal(calls, 1);
    assert.equal(outcome.succeeded, false);
  });

  it("still reports health as unknown until observed", () => {
    const monitor = new InMemoryHealthMonitor({ clock: new ManualClock(0) });
    assert.equal(monitor.current("p1").status, "unknown");
    assert.equal(monitor.current("p1").observedAt, null);
    assert.equal(UNKNOWN_HEALTH.status, "unknown");
  });

  it("still routes deterministically and withholds unverified capability", async () => {
    const clock = new ManualClock(0);
    const providers = new ProviderRegistry({ clock });
    const models = new ModelRegistry({ clock, providers });
    providers.register({ providerId: "p1", enabled: true, capabilities: CapabilitySet.unknown() });
    for (const step of ["verified", "probed", "classified", "awaiting_approval", "approved", "registered", "health_monitored", "production_pool"] as const) {
      providers.transition("p1", step);
    }
    const router = new DefaultRouter({
      candidates: {
        candidates: () => providers.list().map((provider) => ({ provider, model: null, lifecycleState: "production_pool" as const })),
      },
    });
    const decision = await router.select({
      requirements: {
        requiredCapabilities: ["coding"],
        minContextTokens: null,
        requiredTools: [],
        reliability: "standard",
        latencyPreference: "balanced",
        costPreference: "balanced",
        fallbackRequired: false,
      },
    });
    assert.equal(decision.selected, null, "an unverified capability must still be withheld");
    assert.ok(models.size === 0);
  });

  it("still records audit events and redacts them", () => {
    const audit = new AuditLog({ maxEvents: 10, clock: new ManualClock(0) });
    audit.append({ kind: "task_enqueued", taskId: "t1", workload: "coding" });
    assert.equal(audit.size, 1);
    const redacted = audit.append({
      kind: "config_reloaded",
      environment: "test",
      changedFields: ["token"],
    });
    assert.deepEqual(redacted.changedFields, ["[REDACTED]"]);
  });

  it("still rejects credentials in the state store", () => {
    const state = new StateStore({ clock: new ManualClock(0) });
    assert.throws(() => state.set("c", "k", { apiKey: "sk-realsecret" }));
    state.set("c", "k", { authEnvVarName: "ACME_API_KEY" });
    assert.equal(state.has("c", "k"), true);
  });
});
