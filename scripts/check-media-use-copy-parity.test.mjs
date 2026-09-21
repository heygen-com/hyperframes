import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

const skillLibDir = resolve("skills/media-use/scripts/lib");
const cliLibDir = resolve("packages/cli/src/media-use/lib");

export const MEDIA_USE_COPY_NAMES = [
  "cutlist.mjs",
  "duck.mjs",
  "error-diffusion.mjs",
  "index-gen.mjs",
  "manifest.mjs",
  "media-fetch.mjs",
  "npx-sync.mjs",
  "parakeet-words.mjs",
  "prefs-store.mjs",
  "recipe-store.mjs",
  "telemetry.mjs",
  "words.mjs",
];

export const INTENTIONAL_MEDIA_USE_DIVERGENCES = new Map([
  [
    "media-fetch.mjs",
    "the standalone skill uses a shim because it cannot import the CLI package tree",
  ],
  [
    "npx-sync.mjs",
    "the standalone skill stays self-contained while the CLI copy uses the shared audio helper",
  ],
]);

function copyPaths(name, skillDir, cliDir) {
  return { skillPath: join(skillDir, name), cliPath: join(cliDir, name) };
}

export function findMediaUseCopyParityIssues({ skillDir = skillLibDir, cliDir = cliLibDir } = {}) {
  const missing = MEDIA_USE_COPY_NAMES.filter((name) => {
    const { skillPath, cliPath } = copyPaths(name, skillDir, cliDir);
    return !existsSync(skillPath) || !existsSync(cliPath);
  }).map((name) => `${name}: both media-use copies must exist`);
  const drifted = MEDIA_USE_COPY_NAMES.filter(
    (name) => !INTENTIONAL_MEDIA_USE_DIVERGENCES.has(name),
  )
    .filter((name) => {
      const { skillPath, cliPath } = copyPaths(name, skillDir, cliDir);
      return !readFileSync(skillPath).equals(readFileSync(cliPath));
    })
    .map((name) => `${name}: standalone and CLI copies differ without an allowlist reason`);
  return [...missing, ...drifted];
}

describe("media-use source parity", () => {
  it("keeps every standalone copy equal or explicitly allowlisted", () => {
    assert.deepEqual(findMediaUseCopyParityIssues(), []);
  });
});
