#!/usr/bin/env node
// stage-assets.mjs — copy user-supplied media into the project's assets/ so scene
// files (and lint/validate/render) can reference them locally. Only needed when
// the user provides images/videos for asset treatments (montage.md). First-wins,
// idempotent, safe to run twice. Never fetches remote URLs.
//
// Usage: node stage-assets.mjs --from <srcDir> --hyperframes <projectRoot>
//        [--into public]   (subdir under assets/; default copies flat into assets/)
//
// Copies common media extensions only; reports what landed.

import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { extname, join, resolve, basename } from "node:path";

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
function die(m) {
  console.error(`✗ stage-assets.mjs: ${m}`);
  process.exit(1);
}

const fromDir = flag("from", null);
if (!fromDir) die("missing --from <srcDir>");
const fromAbs = resolve(fromDir);
if (!existsSync(fromAbs) || !statSync(fromAbs).isDirectory())
  die(`--from is not a directory: ${fromAbs}`);
const hyperframesDir = resolve(flag("hyperframes", "."));
const into = flag("into", "");
const destDir = join(hyperframesDir, "assets", into);

const MEDIA = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".mov", ".webm", ".m4v"]);

mkdirSync(destDir, { recursive: true });
let staged = 0,
  skipped = 0;
const landed = [];
for (const name of readdirSync(fromAbs)) {
  const src = join(fromAbs, name);
  if (!statSync(src).isFile()) continue;
  if (!MEDIA.has(extname(name).toLowerCase())) continue;
  const dest = join(destDir, basename(name));
  if (existsSync(dest)) {
    skipped++;
    continue;
  } // first-wins
  copyFileSync(src, dest);
  staged++;
  landed.push(join("assets", into, basename(name)));
}

console.log(
  `✓ stage-assets: ${staged} copied, ${skipped} already present → ${join("assets", into)}/`,
);
for (const l of landed) console.log(`  ${l}`);
if (staged === 0 && skipped === 0) console.log(`  (no media files found in ${fromAbs})`);
