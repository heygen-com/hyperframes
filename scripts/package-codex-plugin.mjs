#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");
const OUTPUT = join(REPO_ROOT, "dist", "hyperframes-plugin.zip");
const MAX_UPLOAD_BYTES = 100 * 1_000_000;
const PLUGIN_PATHS = [".codex-plugin", "assets/icon.png", "assets/logo.png", "skills"];

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
