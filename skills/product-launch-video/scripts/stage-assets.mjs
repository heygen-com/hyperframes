#!/usr/bin/env node
// stage-assets.mjs — copy each frame's named asset_candidates from capture/ into
// assets/ so Step 5 frame workers reference real files and the live preview
// (Step 3 / Step 6) shows them. Runs at Step 4 close, once visual design is
// locked. assemble-index.mjs re-runs the same staging idempotently as a backstop.
//
// Reads:  --storyboard STORYBOARD.md, --hyperframes <project root>.
// Writes: assets/<basename> for each named, found asset.
// Exit 0 always once the storyboard parses — a missing asset is a non-fatal
// anomaly (the frame would 404 it), not a contract break.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseStoryboard } from "./lib/storyboard.mjs";
import { stageAssets } from "./lib/assets.mjs";

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
function die(msg) {
  console.error(`✗ stage-assets.mjs: ${msg}`);
  process.exit(1);
}

const hyperframesDir = resolve(flag("hyperframes", "."));
const storyboardPath = resolve(flag("storyboard", join(hyperframesDir, "STORYBOARD.md")));

if (!existsSync(storyboardPath)) die(`STORYBOARD.md not found at ${storyboardPath}`);
const manifest = parseStoryboard(readFileSync(storyboardPath, "utf8"));

const { staged, wanted, anomalies } = stageAssets({ hyperframesDir, frames: manifest.frames });

console.log(`✓ staged ${staged}/${wanted.size} asset(s) into assets/`);
if (anomalies.length) {
  console.log(`\nanomalies (non-fatal):`);
  for (const a of anomalies) console.log(`  - ${a}`);
}
