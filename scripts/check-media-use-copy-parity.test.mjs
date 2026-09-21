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

export function findMediaUseCopyParityIssues({ skillDir = skillLibDir, cliDir = cliLibDir } = {}) {
  return MEDIA_USE_COPY_NAMES.flatMap((name) => {
    const skillPath = join(skillDir, name);
    const cliPath = join(cliDir, name);
    if (!existsSync(skillPath) || !existsSync(cliPath)) {
      return [`${name}: both media-use copies must exist`];
    }
    if (
      !INTENTIONAL_MEDIA_USE_DIVERGENCES.has(name) &&
      !readFileSync(skillPath).equals(readFileSync(cliPath))
    ) {
      return [`${name}: standalone and CLI copies differ without an allowlist reason`];
    }
    return [];
  });
}

describe("media-use source parity", () => {
  it("keeps every standalone copy equal or explicitly allowlisted", () => {
    assert.deepEqual(findMediaUseCopyParityIssues(), []);
  });
});
