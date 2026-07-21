#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");
const OUTPUT = join(REPO_ROOT, "dist", "hyperframes-plugin.zip");
// Codex reports its upload limit in decimal MB.
const MAX_UPLOAD_BYTES = 100 * 1_000_000;
const pluginManifest = JSON.parse(readFileSync(join(REPO_ROOT, ".codex-plugin", "plugin.json")));
const assetPaths = new Set();

function collectAssetPaths(value) {
  if (Array.isArray(value)) {
    for (const entry of value) collectAssetPaths(entry);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectAssetPaths(entry);
    return;
  }
  if (typeof value !== "string") return;

  const assetPath = value.replace(/^\.\//, "");
  if (!assetPath.startsWith("assets/")) return;
  if (assetPath.split("/").includes("..")) {
    throw new Error(`Plugin manifest contains an unsafe asset path: ${value}`);
  }
  assetPaths.add(assetPath);
}

collectAssetPaths(pluginManifest);
const PLUGIN_PATHS = [".codex-plugin", ...[...assetPaths].sort(), "skills"];

for (const pluginPath of PLUGIN_PATHS) {
  execFileSync("git", ["cat-file", "-e", `HEAD:${pluginPath}`], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}

const dirtyCheck = spawnSync("git", ["diff", "--quiet", "HEAD", "--", ...PLUGIN_PATHS], {
  cwd: REPO_ROOT,
});
if (dirtyCheck.error || (dirtyCheck.status !== 0 && dirtyCheck.status !== 1)) {
  throw dirtyCheck.error ?? new Error("Unable to inspect the plugin working tree state.");
}
if (dirtyCheck.status === 1) {
  console.warn("Warning: packaging committed HEAD; uncommitted plugin changes are excluded.");
}

mkdirSync(join(REPO_ROOT, "dist"), { recursive: true });

execFileSync(
  "git",
  [
    "archive",
    "--format=zip",
    "--prefix=hyperframes/",
    "--output",
    OUTPUT,
    "HEAD",
    "--",
    ...PLUGIN_PATHS,
  ],
  { cwd: REPO_ROOT, stdio: "inherit" },
);

const bytes = statSync(OUTPUT).size;
if (bytes > MAX_UPLOAD_BYTES) {
  rmSync(OUTPUT);
  throw new Error(
    `Codex plugin archive is ${(bytes / 1_000_000).toFixed(1)} MB; the upload limit is 100 MB.`,
  );
}

console.log(`Wrote ${OUTPUT} (${(bytes / 1_000_000).toFixed(1)} MB).`);
