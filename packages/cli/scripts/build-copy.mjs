// Cross-platform replacement for the previous `mkdir -p … && cp -r …` shell
// chain, which failed on Windows because `cp` doesn't accept `-r` there.

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(CLI_ROOT, "..", "..");
const DIST = join(CLI_ROOT, "dist");

// Studio's vite build clears its dist before rewriting it; don't start the
// copy until both sentinels are present so we never observe a partial tree.
const STUDIO_WAIT_TIMEOUT_MS = 30_000;
const STUDIO_POLL_INTERVAL_MS = 250;

// fallow-ignore-next-line complexity
async function waitForStudioDist(dir) {
  const deadline = Date.now() + STUDIO_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const entries = new Set(readdirSync(dir));
      // vite emits `assets/` before rewriting `index.html` at the end of the
      // build — so once both are present, the tree is complete.
      if (entries.has("index.html") && entries.has("assets")) return;
    } catch {
      // dir doesn't exist yet — vite will create it
    }
    await sleep(STUDIO_POLL_INTERVAL_MS);
  }
  throw new Error(`[build-copy] timed out waiting for studio dist at ${dir}`);
}

function copyDir(src, dest) {
  cpSync(src, dest, { recursive: true, force: true });
}

function copyDirContents(src, dest) {
  for (const entry of readdirSync(src)) {
    cpSync(join(src, entry), join(dest, entry), {
      recursive: true,
      force: true,
    });
  }
}

function copyMdFiles(srcDir, destDir) {
  if (!existsSync(srcDir)) return;
  for (const name of readdirSync(srcDir)) {
    if (name.endsWith(".md")) {
      cpSync(join(srcDir, name), join(destDir, name));
    }
  }
}

// fallow-ignore-next-line complexity
async function main() {
  for (const sub of ["studio", "docs", "templates", "skills", "docker"]) {
    mkdirSync(join(DIST, sub), { recursive: true });
  }
  mkdirSync(join(DIST, "commands"), { recursive: true });

  const studioDist = resolve(CLI_ROOT, "..", "studio", "dist");
  await waitForStudioDist(studioDist);
  copyDirContents(studioDist, join(DIST, "studio"));

  for (const tmpl of ["blank", "_shared"]) {
    copyDir(join(CLI_ROOT, "src", "templates", tmpl), join(DIST, "templates", tmpl));
  }

  // Skills bundled into the published CLI. Branches don't all carry the same
  // skills/ tree (it gets restructured), so each entry is existsSync-guarded:
  // a missing skill dir warns + skips instead of crashing the build.
  for (const skill of ["hyperframes", "hyperframes-cli", "gsap"]) {
    const src = join(REPO_ROOT, "skills", skill);
    if (!existsSync(src)) {
      console.warn(`[build-copy] skill not found, skipping: skills/${skill}`);
      continue;
    }
    copyDir(src, join(DIST, "skills", skill));
  }

  const dockerfile = join(CLI_ROOT, "src", "docker", "Dockerfile.render");
  if (existsSync(dockerfile)) {
    cpSync(dockerfile, join(DIST, "docker", "Dockerfile.render"));
  }

  const layoutAuditScript = join(CLI_ROOT, "src", "commands", "layout-audit.browser.js");
  if (existsSync(layoutAuditScript)) {
    cpSync(layoutAuditScript, join(DIST, "commands", "layout-audit.browser.js"));
  }

  const contrastAuditScript = join(CLI_ROOT, "src", "commands", "contrast-audit.browser.js");
  if (existsSync(contrastAuditScript)) {
    cpSync(contrastAuditScript, join(DIST, "commands", "contrast-audit.browser.js"));
  }

  const motionSampleScript = join(CLI_ROOT, "src", "commands", "motion-sample.browser.js");
  if (existsSync(motionSampleScript)) {
    cpSync(motionSampleScript, join(DIST, "commands", "motion-sample.browser.js"));
  }

  copyMdFiles(join(CLI_ROOT, "src", "docs"), join(DIST, "docs"));

  console.log("[build-copy] done");
}

await main();
