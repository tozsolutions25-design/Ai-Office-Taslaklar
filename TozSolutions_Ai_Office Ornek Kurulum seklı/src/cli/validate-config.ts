#!/usr/bin/env node
/**
 * Configuration validation CLI.
 *
 * Loads configuration from the environment (or an explicit JSON file), runs
 * full validation, and prints only field PATHS and messages. No configuration
 * VALUES are printed, so running this in a pipeline cannot leak a secret.
 *
 * Exit codes: 0 = valid, 1 = invalid, 2 = usage/read error.
 */

import { readFileSync } from "node:fs";
import { diffFromDefaults, loadConfig, loadConfigFromObject } from "../config/load.js";
import type { Result } from "../core/result.js";
import type { AppConfig } from "../config/schema.js";
import type { ConfigValidationError } from "../config/validate.js";

function main(argv: readonly string[]): number {
  if (argv.includes("--help")) {
    console.log("Usage: validate-config [path/to/config.json] [--defaults]");
    return 0;
  }

  const fileArg = argv.find((arg) => !arg.startsWith("--"));

  if (argv.includes("--defaults")) {
    // Proves the shipped defaults plus the minimum required field are
    // self-consistent.
    return report(loadConfigFromObject({ app: { environment: "development" } }));
  }

  if (fileArg) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(fileArg, "utf8"));
    } catch (error) {
      console.error(`Could not read config file: ${error instanceof Error ? error.message : String(error)}`);
      return 2;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.error("Config file must contain a JSON object");
      return 2;
    }
    return report(loadConfigFromObject(parsed as Record<string, unknown>));
  }

  return report(loadConfig(process.env));
}

function report(result: Result<AppConfig, ConfigValidationError>): number {
  if (result.ok) {
    const changed = diffFromDefaults(result.value);
    console.log("Configuration: VALID");
    console.log(`  environment: ${result.value.app.environment}`);
    console.log(`  providers configured: ${Object.keys(result.value.providers).length}`);
    if (changed.length > 0) {
      console.log(`  overridden fields (${changed.length}):`);
      for (const field of changed) {
        console.log(`    - ${field}`);
      }
    }
    return 0;
  }
  console.error(`Configuration: INVALID (${result.error.issues.length} issue(s))`);
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.field}: ${issue.message}`);
  }
  return 1;
}

process.exitCode = main(process.argv.slice(2));
