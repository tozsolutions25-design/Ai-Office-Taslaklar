/**
 * Copies non-TypeScript build inputs into `dist/`.
 *
 * `tsc` only emits JavaScript, so the design system's CSS layers would be
 * absent from a published build. This script copies them with Node's standard
 * library only — no copy utility dependency is added for this.
 */

import { cpSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const source = path.join(projectRoot, "src");
const destination = path.join(projectRoot, "dist", "src");

/** File extensions that must be present in the build output verbatim. */
const ASSET_EXTENSIONS = new Set([".css"]);

function collect(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...collect(absolute));
    } else if (ASSET_EXTENSIONS.has(path.extname(entry))) {
      found.push(absolute);
    }
  }
  return found;
}
const assets = collect(source);
if (assets.length === 0) {
  console.error("build:assets found no assets to copy; expected CSS under src/.");
  process.exitCode = 1;
} else {
  for (const asset of assets) {
    const target = path.join(destination, path.relative(source, asset));
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(asset, target);
  }
  console.log(
    `build:assets copied ${assets.length} asset(s) into dist/ (${[...new Set(assets.map((asset) => path.relative(source, asset)))].join(", ")})`,
  );
}
