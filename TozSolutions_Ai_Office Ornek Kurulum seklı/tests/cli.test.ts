import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "..", "src", "cli", "validate-config.js");

describe("configuration CLI", () => {
  it("has been built", () => {
    assert.ok(existsSync(cli), `expected the CLI at ${cli}; run the build first`);
  });

  it("validates the shipped defaults", () => {
    const output = execFileSync(process.execPath, [cli, "--defaults"], { encoding: "utf8" });
    assert.match(output, /Configuration: VALID/);
  });

  it("reports a missing environment as invalid with a non-zero exit", () => {
    let exitCode = 0;
    let output = "";
    try {
      output = execFileSync(process.execPath, [cli], {
        encoding: "utf8",
        env: { PATH: process.env["PATH"] ?? "" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const asError = error as { status: number; stderr: Buffer };
      exitCode = asError.status;
      output = asError.stderr.toString();
    }
    assert.equal(exitCode, 1, "an absent TOZ_ENV must fail validation");
    assert.match(output, /app\.environment/);
  });

  it("never prints a configuration value", () => {
    const output = execFileSync(process.execPath, [cli, "--defaults"], { encoding: "utf8" });
    assert.equal(/sk-|password|token/i.test(output), false);
  });
});
