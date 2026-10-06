import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // These are plain Node build scripts, not part of the typed source tree, so
    // they are outside the project service and the type-aware rulesets.
    //
    // PHASE 05 added two entries, and both exist because of a defect this phase ran
    // into rather than a preference. `.mutation-*` and `.probe-selftest` are the
    // harness working copies, and they sit INSIDE the repository because some
    // pre-existing test suites resolve `src/` relative to their own compiled
    // location. Leaving them un-ignored meant that running a mutation battery made
    // `npm run lint` fail with hundreds of "file not found by the project service"
    // errors - a check that appears to run against the code and does not, which is
    // the same shape of defect D-03 recorded in PHASE 01.
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "eslint.config.mjs",
      "scripts/**",
      ".mutation-*",
      ".probe-selftest/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
    },
  },
  {
    // Entry points print to stdout on purpose: their entire job is to report what
    // the system composed. `src/orchestration/cli` is here for the same reason as
    // `src/cli` - it is an entry point, not library code.
    files: ["src/cli/**/*.ts", "src/orchestration/cli/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // node:test's `describe`/`it` return promises that are never awaited by
    // design, and several tests must supply `async` callbacks to satisfy a
    // production signature that returns `Promise<T>`. Both make the
    // floating-promise and require-await checks produce only false positives
    // here. Type correctness in tests is enforced by `npm run typecheck`.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
);
