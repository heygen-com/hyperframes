#!/usr/bin/env node
/**
 * Lint registry blocks/components the way a user actually receives them.
 *
 * `hyperframes lint <dir>` needs an `index.html`, but registry items ship as
 * `<name>.html`, so pointing the linter at an item directory fails with "No
 * composition found" — which means registry items were never linted at all.
 * Two `gsap_non_transform_motion` errors reached main that way.
 *
 * This mounts each item into a throwaway project (exactly where `hyperframes
 * add` would put it) and lints that, reporting only findings for the item's
 * own file so the host scaffold's noise is ignored.
 *
 * Usage:
 *   node scripts/lint-registry-items.mjs                 # every item
 *   node scripts/lint-registry-items.mjs mk-background … # named items
 */
import {
  readdirSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(repoRoot, "packages/cli/src/cli.ts");

// A deliberately boring host: one clip, one registered timeline, so the only
// findings that can appear are the item's own.
const HOST = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="5">
      <section id="host-slot" class="clip" data-start="0" data-duration="5" data-track-index="1"></section>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.to("#host-slot", { opacity: 1, duration: 0.1 }, 0);
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;

/**
 * Rules that assume a standalone composition. Many components ship as
 * paste-able fragments with no root element at all, so these fire on ~47
 * long-standing items and would drown the signal. The host provides the root;
 * the item is not supposed to.
 */
const IGNORED = [
  "root_missing_composition_id",
  "root_missing_dimensions",
  "multiple_root_compositions",
];

function discover() {
  const out = [];
  for (const kind of ["blocks", "components"]) {
    const dir = join(repoRoot, "registry", kind);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const html = join(dir, name, `${name}.html`);
      if (existsSync(html)) out.push({ name, kind, html });
    }
  }
  return out;
}

const only = process.argv.slice(2);
const items = discover().filter((i) => only.length === 0 || only.includes(i.name));
if (items.length === 0) {
  console.error(
    only.length ? `No registry item matches: ${only.join(", ")}` : "No registry items found.",
  );
  process.exit(1);
}

let failed = 0;
for (const item of items) {
  const proj = mkdtempSync(join(tmpdir(), `hf-lint-${item.name}-`));
  try {
    mkdirSync(join(proj, "compositions"), { recursive: true });
    writeFileSync(join(proj, "index.html"), HOST);
    copyFileSync(item.html, join(proj, "compositions", `${item.name}.html`));

    const res = spawnSync("bun", [cli, "lint", proj], { encoding: "utf-8" });
    const lines = `${res.stdout ?? ""}${res.stderr ?? ""}`.split("\n");
    // Only the item's own file — the host scaffold is not under review.
    const hits = lines.filter(
      (l) =>
        l.includes("✗") && l.includes(`${item.name}.html`) && !IGNORED.some((r) => l.includes(r)),
    );
    if (hits.length) {
      failed++;
      console.error(`\n✗ ${item.kind}/${item.name}`);
      for (const h of hits) console.error(`   ${h.trim()}`);
    }
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
}

if (failed) {
  console.error(`\n${failed} registry item(s) have lint errors.`);
  process.exit(1);
}
console.log(`Registry item lint passed — ${items.length} item(s), 0 errors.`);
