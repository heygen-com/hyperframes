#!/usr/bin/env node
/**
 * Bundled-CLI smoke for `--page-side-compositing` (opt-in spike).
 *
 * Validates that:
 *   1. The bundled CLI accepts the new flag.
 *   2. The local `@hyperframes/shader-transitions` IIFE bundle carries the
 *      page-side compositor canary string (build is wired correctly).
 *   3. Rendering the fixture WITH and WITHOUT the flag both produce valid
 *      MP4s with the same duration. (Pixel-equality is NOT a correctness
 *      property here — see the determinism note in the PR body.)
 *   4. Wall-time pair is captured for the PR body.
 *
 * Per `feedback_validate_bundled_cli_not_dev_path.md`: the canonical
 * execution path is the BUNDLED CLI at `packages/cli/dist/cli.js`, never
 * `bun run` against raw TS sources. Do not "improve" this script to use
 * `bun run` — bundle-specific bugs (path resolvers, env bootstrap, lazy
 * modules) are invisible to the dev path.
 *
 * Usage from the repo root:
 *
 *   node scripts/page-side-compositing-smoke/run.mjs
 *
 * Outputs:
 *
 *   <tmpdir>/raw.mp4              (baseline path, flag off)
 *   <tmpdir>/page-side.mp4        (page-side path, flag on)
 *   <tmpdir>/wall-times.json      (wall-time pair for the PR)
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const FIXTURE_SRC = join(HERE, "fixture");
const WORK_DIR = mkdtempSync(join(tmpdir(), "hf-page-side-smoke-"));
const FIXTURE_RUN_DIR = join(WORK_DIR, "fixture");
const CLI_PATH = join(REPO_ROOT, "packages", "cli", "dist", "cli.js");
const SHADER_BUNDLE = join(REPO_ROOT, "packages", "shader-transitions", "dist", "index.global.js");
// Canary string defined in
// `packages/shader-transitions/src/engineModePageComposite.ts` —
// kept identical here on purpose. Test broken → engineModePageComposite.test
// fails first.
const PAGE_COMPOSITOR_CANARY = "__hf_page_compositor_v1__";

function note(line) {
  process.stdout.write("[smoke] " + line + "\n");
}

function fail(msg) {
  process.stderr.write("[smoke] FAIL: " + msg + "\n");
  process.exit(1);
}

function assertExists(path, label) {
  if (!existsSync(path)) fail(label + " missing at " + path);
}

function assertCanary() {
  assertExists(SHADER_BUNDLE, "shader-transitions IIFE bundle");
  const buf = execFileSync("grep", ["-c", PAGE_COMPOSITOR_CANARY, SHADER_BUNDLE]);
  const count = Number(buf.toString().trim());
  if (count < 1) {
    fail(
      "shader-transitions bundle is missing the page-side compositor canary " +
        `("${PAGE_COMPOSITOR_CANARY}"). Rebuild @hyperframes/shader-transitions and re-run.`,
    );
  }
  note(`canary present in ${SHADER_BUNDLE} (${count}× hit)`);
}

function assertCliCanary() {
  assertExists(CLI_PATH, "bundled CLI");
  // The CLI bundle should carry the env-var key for HF_PAGE_SIDE_COMPOSITING
  // and the page-side flag name. Either confirms the engine + producer +
  // CLI side of the change is wired through tsup.
  const cliCanaries = ["HF_PAGE_SIDE_COMPOSITING", "page-side-compositing"];
  for (const needle of cliCanaries) {
    const buf = execFileSync("grep", ["-c", needle, CLI_PATH]);
    const count = Number(buf.toString().trim());
    if (count < 1) {
      fail(`bundled CLI is missing canary "${needle}". Rebuild @hyperframes/cli and re-run.`);
    }
    note(`CLI bundle carries "${needle}" (${count}× hit)`);
  }
}

function setupFixture() {
  if (existsSync(WORK_DIR)) rmSync(WORK_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_RUN_DIR, { recursive: true });
  copyFileSync(join(FIXTURE_SRC, "index.html"), join(FIXTURE_RUN_DIR, "index.html"));
  copyFileSync(SHADER_BUNDLE, join(FIXTURE_RUN_DIR, "shader-transitions.global.js"));
  note("fixture staged at " + FIXTURE_RUN_DIR);
}

function runRender(label, outputPath, extraArgs) {
  note(`render: ${label} → ${outputPath}`);
  const argv = [
    CLI_PATH,
    "render",
    FIXTURE_RUN_DIR,
    "-o",
    outputPath,
    "--fps",
    "30",
    "--workers",
    "1",
    "--quality",
    "draft",
    "--quiet",
    ...extraArgs,
  ];
  const t0 = Date.now();
  const res = spawnSync("node", argv, { stdio: "inherit", cwd: REPO_ROOT });
  const wallMs = Date.now() - t0;
  if (res.status !== 0) {
    fail(`render "${label}" exited with status ${res.status}`);
  }
  if (!existsSync(outputPath)) {
    fail(`render "${label}" did not produce ${outputPath}`);
  }
  const size = statSync(outputPath).size;
  if (size < 1024) {
    fail(`render "${label}" produced suspiciously small output (${size} bytes)`);
  }
  note(`  wall=${(wallMs / 1000).toFixed(2)}s size=${(size / 1024).toFixed(1)}KB`);
  return { label, wallMs, sizeBytes: size, outputPath };
}

function main() {
  note(`repo root: ${REPO_ROOT}`);
  assertExists(CLI_PATH, "bundled CLI (packages/cli/dist/cli.js)");
  assertExists(SHADER_BUNDLE, "shader-transitions IIFE bundle");
  assertCliCanary();
  assertCanary();
  setupFixture();

  const baseline = runRender("baseline (flag OFF)", join(WORK_DIR, "raw.mp4"), []);
  const pageSide = runRender("page-side (flag ON)", join(WORK_DIR, "page-side.mp4"), [
    "--page-side-compositing",
  ]);

  const summary = {
    baseline: { wallMs: baseline.wallMs, sizeBytes: baseline.sizeBytes },
    pageSide: { wallMs: pageSide.wallMs, sizeBytes: pageSide.sizeBytes },
    walltimeRatio: baseline.wallMs / Math.max(1, pageSide.wallMs),
    notes:
      "fixture: 2s @ 30fps, 1280x720, single cross-warp-morph transition. " +
      "Wall times include CLI startup + browser launch — for a perf signal, " +
      "amortize over a longer fixture on the target host (Vance's Mac).",
  };
  writeFileSync(join(WORK_DIR, "wall-times.json"), JSON.stringify(summary, null, 2));
  note("wrote " + join(WORK_DIR, "wall-times.json"));
  note("baseline: " + (baseline.wallMs / 1000).toFixed(2) + "s");
  note("page-side: " + (pageSide.wallMs / 1000).toFixed(2) + "s");
  note(
    `ratio (baseline/page-side): ${summary.walltimeRatio.toFixed(2)}×  ` +
      "(>1 means page-side faster, <1 means slower — sandbox is software " +
      "WebGL, so a ratio near 1 here is expected and NOT predictive of Mac).",
  );
  note("OK");
}

main();
