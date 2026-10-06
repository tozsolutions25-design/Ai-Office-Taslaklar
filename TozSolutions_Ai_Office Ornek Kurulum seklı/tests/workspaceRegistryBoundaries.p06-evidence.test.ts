/**
 * PHASE 06 EVIDENCE - registry boundaries.
 *
 * Three claims, each tested by reading the SOURCE rather than by asserting on a
 * value the code itself produced. A test that asserts a store is partitioned by
 * asking the store whether it is partitioned is a test that passes when the store is
 * wrong; these read the construction sites, because that is the only place the
 * partition is actually decided.
 *
 *   1. Every partitioned store keys EVERY access to its backing Map through one key
 *      function. (the unkeyed-access guard)
 *   2. The deployment-scoped inventory names the registries it shares, and each says
 *      what it holds and asserts it holds no customer data.
 *   3. No platform-scoped record type carries a workspace, a brand, or a customer
 *      identity - read from the declared types.
 *
 * CLAIM 1 exists because the bug is invisible to the compiler and to reading. During
 * this phase `ToolRegistry.setStatus` read through the key function and WROTE through
 * the bare id: it typechecked, it read correctly, and it made a record unreachable on
 * the next read - which surfaced only as an unrelated-looking `missing_tool` failure in
 * a PHASE 05 test. `ExecutionCoordinator.createJob` had the same shape in its duplicate
 * check, and that one silently defeated the check: a second `createJob` for an id
 * another workspace held would OVERWRITE it. Both were found by tests, neither by
 * inspection, and the ad-hoc script written to catch the first reported "0 remaining"
 * over the second because its regex alternation was malformed. So the check is here,
 * where it cannot have a broken regex.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createRuntime } from "../src/orchestration/composition.js";
import { workspaceRef } from "../src/orchestration/workspace/workspace.js";

/**
 * The repository root, not the compiled location.
 *
 * This suite reads SOURCE, because every claim it checks is about source structure -
 * which key function a Map access goes through is not visible in a compiled `.js`
 * file's behaviour, and a test that asserted on runtime values would be asserting that
 * the code agrees with itself.
 *
 * `process.cwd()` is the repo root when the suite runs, and resolving from
 * `import.meta.url` would point at `dist/`, where there is no `src/`.
 */
const ROOT = process.cwd();

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

/** Every .ts under a directory, recursively. */
function sourceFiles(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir))) {
    const full = path.join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(path.join(dir, entry)));
    } else if (entry.endsWith(".ts")) {
      out.push(path.join(dir, entry));
    }
  }
  return out;
}

const ALL_SRC = sourceFiles("src");

/**
 * The partitioned stores: the backing Map, and the name of the ONE key function every
 * access to it must go through.
 *
 * `#byId` in the approval store is deliberately absent: a gate id is a random
 * `gate_...` value and cannot collide, so it needs no partition. The index that CAN
 * collide, `#byTask`, is listed.
 */
const PARTITIONED_STORES: readonly {
  file: string;
  className: string;
  map: string;
  keyFns: readonly string[];
  label: string;
}[] = [
  { file: "src/queue/queue.ts", className: "TaskQueue", map: "#tasks", keyFns: ["#key"], label: "N-2 task queue" },
  {
    file: "src/orchestration/agent/registry.ts",
    className: "AgentRegistry",
    map: "#agents",
    keyFns: ["#key", "#partition"],
    label: "agent registry",
  },
  {
    file: "src/orchestration/agent/registry.ts",
    className: "AgentRegistry",
    map: "#byAgentId",
    keyFns: ["#partition"],
    label: "agent secondary index",
  },
  { file: "src/orchestration/tools/tool.ts", className: "ToolRegistry", map: "#tools", keyFns: ["#key"], label: "tool registry" },
  {
    file: "src/orchestration/workflow/coordinator.ts",
    className: "ExecutionCoordinator",
    map: "#jobs",
    // All three, not just `#jobKey`. `#taskKey` and `#idempotencyKey` both survived the
    // first battery run for exactly the reason `#jobKey`'s partner did, and a list
    // naming only one of them is what let that happen twice. `#idempotencyKey` matters
    // most: it replaced a bare `${jobId}:${taskId}:${attempts}`, so reverting it
    // reintroduces BOTH a missing partition and a delimiter collision.
    keyFns: ["#jobKey", "#taskKey", "#idempotencyKey"],
    label: "coordinator jobs",
  },
  {
    file: "src/orchestration/workflow/claims.ts",
    className: "ClaimRegistry",
    map: "#entries",
    keyFns: ["#claimKey"],
    label: "claims",
  },
  {
    file: "src/orchestration/workflow/claims.ts",
    className: "ClaimRegistry",
    map: "#claimCounts",
    keyFns: ["#claimKey"],
    label: "claim counts",
  },
  {
    file: "src/orchestration/workflow/gates.ts",
    className: "CheckpointStore",
    map: "#cache",
    keyFns: ["#key"],
    label: "checkpoint index",
  },
  {
    file: "src/orchestration/workflow/gates.ts",
    className: "InProcessApprovalRecordStore",
    map: "#byTask",
    keyFns: ["#key"],
    label: "approval index",
  },
  { file: "src/state/store.ts", className: "StateStore", map: "#entries", keyFns: ["#ns"], label: "state store" },
  {
    file: "src/state/store.ts",
    className: "StateStore",
    map: "#listeners",
    keyFns: ["#ns"],
    label: "state listeners",
  },
];

/** The body of one private member of one class, read from source. */
function privateMember(file: string, className: string, member: string): string {
  const text = read(file);
  const classAt = text.indexOf(`class ${className} `);
  assert.notEqual(classAt, -1, `${className} must exist in ${file}`);
  const nextClass = text.indexOf("\nexport class ", classAt + 1);
  const classBody = text.slice(classAt, nextClass === -1 ? text.length : nextClass);
  const at = classBody.indexOf(`\n  ${member}(`);
  assert.notEqual(at, -1, `${className} must define ${member}`);
  const rest = classBody.slice(at + 1);
  const nextMember = rest.search(/\n {2}(?:#|[a-zA-Z])/);
  return nextMember === -1 ? rest : rest.slice(0, nextMember);
}

/** The customer-data stores, each of which must accept a workspace in its constructor. */
const CUSTOMER_DATA_STORES: readonly { className: string; file: string; label: string }[] = [
  { className: "TaskQueue", file: "src/queue/queue.ts", label: "queue" },
  { className: "StateStore", file: "src/state/store.ts", label: "state" },
  { className: "AgentRegistry", file: "src/orchestration/agent/registry.ts", label: "agents" },
  { className: "ToolRegistry", file: "src/orchestration/tools/tool.ts", label: "tools" },
  { className: "InMemoryFeedbackStore", file: "src/orchestration/feedback/feedback.ts", label: "feedback" },
  { className: "MemoryStore", file: "src/orchestration/memory/store.ts", label: "memory" },
  { className: "AuditLog", file: "src/audit/events.ts", label: "audit" },
  { className: "ClaimRegistry", file: "src/orchestration/workflow/claims.ts", label: "claims" },
  { className: "CheckpointStore", file: "src/orchestration/workflow/gates.ts", label: "checkpoints" },
  {
    className: "InProcessApprovalRecordStore",
    file: "src/orchestration/workflow/gates.ts",
    label: "approval records",
  },
  { className: "ExecutionCoordinator", file: "src/orchestration/workflow/coordinator.ts", label: "workflow jobs" },
];

/** Field names that would make a platform-scoped record customer data. */
const CUSTOMER_IDENTITY_FIELDS = [
  "workspace",
  "brand",
  "tenant",
  "tenantId",
  "customer",
  "customerId",
  "userId",
  "accountId",
  "orgId",
  "organisationId",
  "organizationId",
] as const;

/** The declared type of each deployment-scoped registry's record. */
const PLATFORM_RECORD_TYPES: readonly { file: string; decl: string; label: string }[] = [
  { file: "src/config/schema.ts", decl: "interface ProviderConfig", label: "core.providers" },
  { file: "src/models/model.ts", decl: "interface ModelRecord", label: "core.models" },
  { file: "src/orchestration/verification/verifier.ts", decl: "interface Verifier", label: "verifiers" },
  { file: "src/providers/provider.ts", decl: "interface ProviderAdapter", label: "providerAdapters" },
];

/** Field names declared on one interface body, from its opening brace to its close. */
function interfaceFields(file: string, decl: string): readonly string[] {
  const text = read(file);
  const start = text.indexOf(decl);
  assert.notEqual(start, -1, `${decl} must exist in ${file}`);
  const open = text.indexOf("{", start);
  assert.notEqual(open, -1, `${decl} must have a body`);
  // Walk braces so a nested object type does not end the body early.
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return [...text.slice(open, i).matchAll(/(?:^|[\s;{])(?:readonly\s+)?(\w+)\??\s*[:?]/g)].map((m) => m[1]);
      }
    }
  }
  throw new Error(`unterminated body for ${decl}`);
}

describe("PHASE 06 EVIDENCE - registry boundaries", () => {
  /* ---------------------------------------------------------------- claim 1 -- */

  it("routes every access to a partitioned store's Map through its one key function", () => {
    const offenders: string[] = [];
    for (const store of PARTITIONED_STORES) {
      const lines = read(store.file).split(/\r?\n/);
      const call = new RegExp(`this\\.${store.map}\\.(?:get|set|has|delete)\\(([^)]*)`, "g");
      lines.forEach((line, index) => {
        for (const match of line.matchAll(call)) {
          // FIRST argument only. `set(key, value)` has two, and capturing up to the
          // first ")" swallows the second and makes a correct call look unkeyed.
          const first = match[1].split(",")[0].trim();
          // Allowed: the key function, or a variable that IS already a full key -
          // `pruneCompleted` iterates entries(), so `id` needs no recomposition.
          const keyed = store.keyFns.some((fn) => first.startsWith(`this.${fn}(`)) || first === "id" || first === "key";
          if (!keyed) {
            offenders.push(`${store.file}:${index + 1} ${store.label}: ${line.trim()}`);
          }
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      `every Map access in a partitioned store must go through ${[...new Set(PARTITIONED_STORES.flatMap((s) => s.keyFns))].join("/")}`,
    );
  });

  it("gives each partitioned store exactly the key functions it declares, and no others", () => {
    // Not "exactly one" per class: `AgentRegistry` legitimately has two (`#key` for the
    // record map, `#partition` for the secondary index), and forcing one would have made
    // them share a key function across two different maps.
    //
    // The assertion is therefore the stronger of the two possible ones: every declared
    // key function reaches its workspace, AND the class defines no key-composing method
    // beyond those declared. A NEW key function introduced without being added here is
    // a partition nobody is checking, and it fails.
    //
    // Grouped per CLASS rather than per row: `AgentRegistry` appears twice above (once
    // for each map it owns) and the two rows name different subsets of its key
    // functions. Asserting per row would have demanded that each row list all of them.
    const byClass = new Map<string, { file: string; keyFns: Set<string> }>();
    for (const store of PARTITIONED_STORES) {
      const entry = byClass.get(store.className) ?? {
        file: store.file,
        keyFns: new Set<string>(),
      };
      for (const keyFn of store.keyFns) entry.keyFns.add(keyFn);
      byClass.set(store.className, entry);
    }

    for (const [className, { file, keyFns }] of byClass) {
      for (const keyFn of keyFns) {
        const body = privateMember(file, className, keyFn);
        // PHASE 12: the partition moved. `CheckpointStore` and `ClaimRegistry` used to read a
        // `workspace` field of their own; they now read it from the repository they answer
        // through, which is a stronger place for it - one scope, applied by every call the
        // repository makes, instead of by each store re-deriving it.
        //
        // So BOTH spellings satisfy this check. What it still forbids is a key function that
        // composes no partition at all, which is the failure that matters: two workspaces then
        // share one entry and neither can tell.
        const partitioned = body.includes("this.#workspace") || body.includes("this.#repository.scope");
        assert.ok(
          partitioned,
          `${className}: ${keyFn} must incorporate this.#workspace or this.#repository.scope, or the key carries no partition`,
        );
      }

      const text = read(file);
      const classAt = text.indexOf(`class ${className} `);
      assert.notEqual(classAt, -1, `${className} must exist in ${file}`);
      const nextClass = text.indexOf("\nexport class ", classAt + 1);
      const classBody = text.slice(classAt, nextClass === -1 ? text.length : nextClass);
      const privateMethods = [...classBody.matchAll(/^ {2}#([A-Za-z][\w]*)\(/gm)].map((m) => `#${m[1]}`);

      const keyish = [...new Set(privateMethods.filter((name) => /key|Key|partition|^#ns$/.test(name)))];
      assert.deepEqual(
        keyish.sort(),
        [...keyFns].sort(),
        `${className}: every key-composing private method must be listed here, or it is unchecked`,
      );
    }
  });

  it("wires every partitioned store's key function to its OWN workspace", () => {
    // WHY THIS EXISTS, AND WHY IT IS NOT A COMMENT.
    //
    // The cross-boundary suite proves that two stores in two workspaces do not see each
    // other. It cannot prove they would not see each other IF THEY SHARED A MAP - and
    // they do not share a map, because each store instance belongs to exactly one
    // workspace. So for the per-instance stores the partition is enforced by the
    // INSTANCE, and the workspace inside the key is defence-in-depth: real, load-bearing
    // the moment one instance serves two workspaces, and completely invisible to a
    // behavioural test today.
    //
    // That made nine mutations of exactly these key functions SURVIVE a full test run.
    // The mutations were not wrong - removing `this.#workspace` from `#key` really does
    // strip the partition - they were merely unobservable, because nothing can call the
    // private function and no two instances collide.
    //
    // A mutation that cannot be seen is not a passing test; it is a gap in what the
    // suite asserts. So the wiring is asserted here, from source: each key function
    // must reach its own workspace field. Reverting any of those mutations removes the
    // reference and fails here, which makes them catchable for the reason they exist.
    for (const store of PARTITIONED_STORES) {
      const text = read(store.file);
      const classAt = text.indexOf(`class ${store.className} `);
      assert.notEqual(classAt, -1, `${store.className} must exist in ${store.file}`);
      const nextClass = text.indexOf("\nexport class ", classAt + 1);
      const classBody = text.slice(classAt, nextClass === -1 ? text.length : nextClass);

      for (const keyFn of store.keyFns) {
        const fnAt = classBody.indexOf(`\n  ${keyFn}(`);
        assert.notEqual(fnAt, -1, `${store.className} must define ${keyFn}`);
        const rest = classBody.slice(fnAt + 1);
        const nextMember = rest.search(/\n {2}(?:#|[a-zA-Z])/);
        const fnBody = nextMember === -1 ? rest : rest.slice(0, nextMember);

        assert.ok(
          fnBody.includes("this.#workspace") || fnBody.includes("this.#repository.scope"),
          `${store.label}: ${keyFn} must incorporate this.#workspace or this.#repository.scope, or the key carries no partition`,
        );
      }
    }
  });

  it("makes the state store's key return the partition it computed", () => {
    // The one store whose key function is not a single `workspaceKey` call: it builds a
    // `head` and concatenates it. So "the body mentions `this.#workspace`" is not enough
    // - a mutant could compute the partition and then leave it out of the return value,
    // which is exactly what mutation M15 does. The return statement must use it.
    const text = read("src/state/store.ts");
    const at = text.indexOf("\n  #ns(");
    assert.notEqual(at, -1, "StateStore must define #ns");
    const rest = text.slice(at + 1);
    const nextMember = rest.search(/\n {2}(?:#|[a-zA-Z])/);
    const fnBody = nextMember === -1 ? rest : rest.slice(0, nextMember);

    assert.match(fnBody, /const head =/, "#ns must compute the partition head");
    assert.ok(fnBody.includes("this.#workspace") || fnBody.includes("this.#repository.scope"), "#ns must derive the head from this.#workspace");
    assert.match(
      fnBody,
      /return\s+`\$\{head\}/,
      "#ns must RETURN the head it computed; a computed-but-unreturned partition is dead code",
    );
  });

  /* ---------------------------------------------------------------- claim 2 -- */

  it("names every registry it shares, with what it holds and an explicit no-customer-data assertion", () => {
    const described = createRuntime({ workspace: workspaceRef("p06-boundaries", "brand-a") }).describe();
    const shared = new Map(described.platformScopedRegistries.map((entry) => [entry.name, entry]));

    for (const name of ["core.providers", "core.models", "capabilities", "verifiers", "providerAdapters"]) {
      assert.ok(shared.has(name), `${name} is deployment-scoped and must be listed`);
    }
    for (const [name, entry] of shared) {
      assert.equal(entry.customerData, false, `${name} must assert it holds no customer data`);
      assert.ok(
        entry.holds.trim().length > 0,
        `${name} must say what it holds - a shared registry with no stated reason is the mistake to catch`,
      );
    }
  });

  it("keeps every customer-data store out of the shared list, and proves it by constructor", () => {
    const described = createRuntime({ workspace: workspaceRef("p06-boundaries", "brand-a") }).describe();
    const shared = new Set(described.platformScopedRegistries.map((entry) => entry.name));

    for (const store of CUSTOMER_DATA_STORES) {
      assert.ok(!shared.has(store.label), `${store.label} holds customer data and must not be deployment-scoped`);
      const text = read(store.file);
      const at = text.indexOf(`class ${store.className} `);
      assert.notEqual(at, -1, `${store.className} must exist in ${store.file}`);
      // Positive proof of partitioning: the store CAN be told which workspace it is
      // for. Absence from the shared list alone would be satisfied by a store that
      // was simply forgotten.
      const body = text.slice(at, text.indexOf("\n}", at));
      assert.ok(
        /workspace\??\s*:/.test(body),
        `${store.className} must accept a workspace, or "not in the shared list" only means "not mentioned"`,
      );
    }
  });

  it("states the deployment-scoped decision and its non-guarantee where a reader will find it", () => {
    const source = read("src/orchestration/composition.ts");
    const at = source.indexOf("PLATFORM_SCOPED_REGISTRIES");
    assert.notEqual(at, -1, "the inventory must be a named constant, not inlined into describe()");
    const comment = source.slice(Math.max(0, at - 4_000), at);
    // The decision, the reason, and the thing it does NOT claim. A list with no stated
    // non-guarantee reads as a guarantee.
    assert.match(comment, /non-guarantee/i, "the inventory must state what it does not guarantee");
    assert.match(comment, /deployment configuration/i, "the inventory must state the reason it is safe");
    assert.match(comment, /second registry authority/i, "the inventory must rule out a second authority");
  });

  it("constructs each deployment-scoped registry in exactly one place", () => {
    // Condition 5: no second registry authority. A registry built twice is two answers
    // to the same question, and only one of them would be in `describe()`'s inventory.
    for (const className of [
      "ProviderRegistry",
      "ModelRegistry",
      "CapabilityRegistry",
      "ProviderAdapterRegistry",
    ]) {
      const sites = ALL_SRC.filter((file) => new RegExp(`new ${className}\\(`).test(read(file)));
      assert.deepEqual(
        sites.map((s) => path.relative(ROOT, path.join(ROOT, s))),
        sites.length === 1 ? sites.map((s) => path.relative(ROOT, path.join(ROOT, s))) : [],
        `${className} must be constructed in exactly one place; found ${sites.length}`,
      );
    }
  });

  /* ---------------------------------------------------------------- claim 3 -- */

  it("gives no platform-scoped record type a workspace, a brand, or a customer identity", () => {
    for (const record of PLATFORM_RECORD_TYPES) {
      const fields = interfaceFields(record.file, record.decl);
      for (const banned of CUSTOMER_IDENTITY_FIELDS) {
        assert.ok(
          !fields.includes(banned),
          `${record.label} declares "${banned}", so it holds customer data and must not be deployment-scoped`,
        );
      }
    }
  });

  it("holds provider credentials by env var NAME, and never resolves one in src/", () => {
    // The documented non-guarantee, made specific. A deployment-scoped registry may
    // hold credentials because it describes the installation; what it must not do is
    // carry the secret VALUE, or resolve the name into one.
    const fields = interfaceFields("src/config/schema.ts", "interface ProviderConfig");
    assert.ok(
      fields.includes("authEnvVarName"),
      "providers must reference a credential by env var name, not hold it",
    );
    assert.ok(
      !fields.some((f) => /^(apiKey|secret|token|password|credential)$/i.test(f)),
      "ProviderConfig must not carry a credential VALUE",
    );

    // Nobody in src/ indexes an environment BY that name. An earlier version of this
    // test grepped for `authEnvVarName` followed by `??` or `.`, which flagged the
    // config VALIDATOR - it legitimately inspects the name to type-check it. The
    // claim being made is narrower: the name is never turned into a value here.
    const resolvers = ALL_SRC.filter((file) =>
      /(?:env|process\.env)\s*\[\s*authEnvVarName\s*\]/.test(read(file)),
    );
    assert.deepEqual(
      resolvers.map((r) => path.relative(ROOT, path.join(ROOT, r))),
      [],
      "no module in src/ may resolve authEnvVarName into a credential",
    );

    // Computed environment access - `env[key]` rather than `env["TOZ_X"]` - exists in
    // exactly three places, and each is a small typed accessor (`str`, `bool`, `num`)
    // whose callers pass string literals. An earlier version of this test asserted
    // there was NO computed env read anywhere, which was simply false: the accessors
    // are the mechanism. Asserting the exact set instead means a new computed read
    // anywhere else fails, and the three known ones stay accounted for.
    const computedEnvReaders = ALL_SRC.filter((file) => /(?:env|process\.env)\s*\[\s*key\s*\]/.test(read(file)));
    assert.deepEqual(
      computedEnvReaders.map((r) => path.relative(ROOT, path.join(ROOT, r))).sort(),
      ["src\\config\\load.ts", "src\\orchestration\\config\\env.ts", "src\\orchestration\\config\\governanceEnv.ts"],
      "only the three typed env accessors may read the environment by a variable key",
    );

    // And their callers pass literals, so the key is never a request-supplied string.
    // The three accessor modules are exempt: `bool` and `num` delegate to `str` with
    // the same `key` they were handed, which is the mechanism working, not a
    // computed key reaching the environment.
    const ACCESSORS = new Set([
      "src\\config\\load.ts",
      "src\\orchestration\\config\\env.ts",
      "src\\orchestration\\config\\governanceEnv.ts",
    ]);
    for (const accessor of ["str", "bool", "num"]) {
      const callers = ALL_SRC.filter((file) => {
        const relative = path.relative(ROOT, path.join(ROOT, file));
        if (ACCESSORS.has(relative)) return false;
        return new RegExp(`${accessor}\\(\\s*env\\s*,\\s*[^"'\`)]`).test(read(file));
      });
      assert.deepEqual(
        callers.map((c) => path.relative(ROOT, path.join(ROOT, c))),
        [],
        `${accessor}(env, ...) must be called with a literal variable name outside the accessors`,
      );
    }
  });

  it("closes ModelRecord.metadata instead of caveating it", () => {
    // FOUND DURING THIS PHASE, and the reason condition 3 needed a decision rather
    // than a footnote. `ModelRecord.metadata` was `Record<string, unknown>`: a free-form
    // bag that `createModelRecord` passed straight through, inside a registry
    // `describe()` calls deployment-scoped. Nothing in the type system stopped a
    // caller filing a customer id under it, and a field-name check cannot see inside
    // a `Record`.
    //
    // It is now a CLOSED type plus a runtime allowlist, so the statement
    // "core.models holds no customer data" is checkable rather than plausible.
    // `tests/modelMetadataBoundary.p06-evidence.test.ts` carries the positive,
    // negative and cast-bypass controls; this asserts the two halves are WIRED, so
    // deleting either fails here too.
    const model = read("src/models/model.ts");

    // No bag anywhere in the model record or its input.
    assert.doesNotMatch(
      model,
      /metadata\??\s*:\s*Readonly<Record<string,\s*unknown>>/,
      "ModelRecord.metadata must not be Record<string, unknown> again",
    );
    assert.match(
      model,
      /export type ModelMetadata = \{ readonly \[K in ModelMetadataKey\]\?: QualityTier \}/,
      "ModelMetadata must stay a closed mapped type with no index signature",
    );

    // The allowlist is a closed union, and it holds exactly the quality tier.
    assert.match(model, /export const MODEL_METADATA_KEYS = \[QUALITY_TIER_METADATA_KEY\] as const;/);

    // And it is enforced at runtime, which is the half that survives a cast.
    assert.match(model, /issues\.push\(\.\.\.validateModelMetadata\(input\.metadata\)\);/);

    // And nothing in src/ populates it.
    const writers = ALL_SRC.filter((file) =>
      /createModelRecord\(\s*\{[^}]*metadata\s*:/s.test(read(file)),
    );
    assert.deepEqual(
      writers.map((w) => path.relative(ROOT, path.join(ROOT, w))),
      [],
      "no production module may populate ModelRecord.metadata; only the quality tier is sanctioned",
    );
  });
});
