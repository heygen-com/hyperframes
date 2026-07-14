#!/usr/bin/env node

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function safeSegment(value) {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("Invalid GitHub PR reference: owner/repository is empty after sanitization");
  }
  return normalized;
}

export function parsePrReference(raw) {
  const input = String(raw ?? "").trim();
  let match = input.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i);
  if (!match) match = input.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/);
  if (!match) {
    throw new Error(`Invalid GitHub PR reference: ${JSON.stringify(input)}`);
  }
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`Invalid GitHub PR reference: ${JSON.stringify(input)}`);
  }
  return { owner: safeSegment(match[1]), repo: safeSegment(match[2]), number };
}

export function resolvePrToVideoProjectDir({
  pr,
  explicitDir,
  cwd = process.cwd(),
  env = process.env,
}) {
  if (explicitDir?.trim()) return resolve(cwd, explicitDir.trim());
  const ref = parsePrReference(pr);
  const cacheRoot = env.XDG_CACHE_HOME?.trim()
    ? resolve(env.XDG_CACHE_HOME)
    : join(env.HOME?.trim() ? resolve(env.HOME) : homedir(), ".cache");
  return join(
    cacheRoot,
    "hyperframes",
    "pr-to-video",
    ref.owner,
    ref.repo,
    `${ref.repo}-pr-${ref.number}`,
  );
}

function flag(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main() {
  const argv = process.argv.slice(2);
  const pr = flag(argv, "pr");
  if (!pr) {
    console.error('usage: node project-dir.mjs --pr "<github PR>" [--project-dir <path>]');
    process.exit(2);
  }
  try {
    console.log(
      resolvePrToVideoProjectDir({
        pr,
        explicitDir: flag(argv, "project-dir") ?? process.env.PR_TO_VIDEO_PROJECT_DIR,
      }),
    );
  } catch (error) {
    console.error(`✗ project-dir: ${error.message}`);
    process.exit(1);
  }
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) main();
