#!/usr/bin/env node
/**
 * Lint registry blocks/components the way a user actually receives them.
 *
 * `hyperframes lint <dir>` needs an `index.html`, but registry items ship as
 * `<name>.html`, so pointing the linter at an item directory fails with "No
 * composition found" — which means registry items were never linted at all.
 * Two `gsap_non_transform_motion` errors reached main that way.
 *
 * This installs each item into a throwaway project, every file its manifest
 * lists at the target `hyperframes add` would write it to, lints that, and
 * reports only findings for the item's own files so the host scaffold's noise
 * is ignored.
 *
 * Usage:
 *   node scripts/lint-registry-items.mjs                 # every item
 *   node scripts/lint-registry-items.mjs mk-background … # named items
 */
import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  realpathSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { isContainedIn } from "./registry-target-paths.mjs";

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

// The linter never looks inside compositions/components/, so a component is
// staged in a sibling folder at the same depth: its relative references then
// resolve exactly as they would where `hyperframes add` puts it.
const COMPONENTS_DIR = "compositions/components/";
const STAGED_COMPONENTS_DIR = "compositions/registry-components/";

export function discoverItems(registryRoot = join(repoRoot, "registry")) {
  const out = [];
  for (const kind of ["blocks", "components"]) {
    const dir = join(registryRoot, kind);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const html = join(dir, name, `${name}.html`);
      if (existsSync(html)) out.push({ name, kind, dir: join(dir, name) });
    }
  }
  return out;
}

function manifestFiles(item) {
  const manifest = join(item.dir, "registry-item.json");
  if (!existsSync(manifest)) return [];
  const { files } = JSON.parse(readFileSync(manifest, "utf-8"));
  return Array.isArray(files) ? files : [];
}

function stagedTarget(target) {
  return target.startsWith(COMPONENTS_DIR)
    ? STAGED_COMPONENTS_DIR + target.slice(COMPONENTS_DIR.length)
    : target;
}

/** Where a manifest entry is read from and written to, or null when it is malformed or escapes. */
function placement(item, project, file) {
  if (typeof file?.path !== "string" || typeof file?.target !== "string") return null;
  const target = stagedTarget(file.target);
  // The manifest is untrusted input, so neither side may leave its root.
  if (!isContainedIn(item.dir, file.path) || !isContainedIn(project, target)) return null;
  return { from: resolve(item.dir, file.path), to: resolve(project, target) };
}

/** Installs `item` into `project` and returns the paths of the repo files it installed. */
export function stageItem(item, project) {
  writeFileSync(join(project, "index.html"), HOST);
  const ownHtml = `${item.name}.html`;
  const files = manifestFiles(item);
  if (!files.some((file) => file?.path === ownHtml)) {
    files.push({ path: ownHtml, target: `compositions/${ownHtml}` });
  }

  const staged = new Set();
  let html;
  for (const file of files) {
    const place = placement(item, project, file);
    if (!place) continue;
    if (existsSync(place.from)) {
      mkdirSync(dirname(place.to), { recursive: true });
      copyFileSync(place.from, place.to);
      staged.add(place.to);
      if (file.path === ownHtml) html = place.to;
    } else if (typeof file.url === "string") {
      // A hosted file is downloaded by `hyperframes add`, not kept in the repo. An empty
      // stand-in passes the existence checks, and the media probes skip what they can't read.
      mkdirSync(dirname(place.to), { recursive: true });
      writeFileSync(place.to, "");
    }
  }
  if (!html) throw new Error(`${ownHtml} could not be staged from its manifest entry`);
  return staged;
}

function runLint(project) {
  return spawnSync("bun", [cli, "lint", project, "--json", "--include-unmounted"], {
    encoding: "utf-8",
  });
}

function parseReport({ stdout, stderr, status }) {
  try {
    const report = JSON.parse(stdout ?? "");
    if (report && typeof report === "object") return report;
  } catch {
    // Reported below with the linter's own output.
  }
  const output = `${stderr ?? ""}${stdout ?? ""}`.trim().split("\n").slice(-3).join(" | ");
  throw new Error(`lint did not return a JSON report (exit ${status}): ${output}`);
}

/**
 * Lints the staged project and returns the error findings in the item's own
 * files. Throws when the run proves nothing: a crash, or a report that never
 * scanned the item, would otherwise read as a pass. The exit code is not used,
 * because the IGNORED rules alone can make it fail.
 */
export function lintStagedItem(project, staged, run = runLint) {
  const report = parseReport(run(project));
  if (report.error) throw new Error(`lint failed: ${report.error.message ?? report.error.code}`);
  // index.html plus the item; fewer means the item was skipped.
  if (!(report.filesScanned >= 2)) {
    throw new Error(`lint did not scan the item (filesScanned: ${report.filesScanned})`);
  }
  return (report.findings ?? []).filter(
    (finding) =>
      finding.severity === "error" &&
      typeof finding.file === "string" &&
      staged.has(resolve(finding.file)) &&
      !IGNORED.includes(finding.code),
  );
}

function main(only) {
  const items = discoverItems().filter((i) => only.length === 0 || only.includes(i.name));
  if (items.length === 0) {
    console.error(
      only.length ? `No registry item matches: ${only.join(", ")}` : "No registry items found.",
    );
    process.exit(1);
  }

  let failed = 0;
  for (const item of items) {
    const project = realpathSync(mkdtempSync(join(tmpdir(), `hf-lint-${item.name}-`)));
    try {
      const errors = lintStagedItem(project, stageItem(item, project));
      if (errors.length) {
        failed++;
        console.error(`\n✗ ${item.kind}/${item.name}`);
        for (const e of errors) {
          console.error(`   ${e.code} in ${relative(project, e.file)}: ${e.message}`);
        }
      }
    } catch (error) {
      failed++;
      console.error(`\n✗ ${item.kind}/${item.name}\n   ${error.message}`);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }

  if (failed) {
    console.error(`\n${failed} registry item(s) have lint errors.`);
    process.exit(1);
  }
  console.log(`Registry item lint passed — ${items.length} item(s), 0 errors.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
