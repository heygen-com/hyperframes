import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { generateSkillModuleCopies } from "./generate-skill-module-copies.mjs";

const skillLibDir = resolve("skills/media-use/scripts/lib");
const cliLibDir = resolve("packages/cli/src/media-use/lib");

export const MEDIA_USE_COPY_NAMES = [
  "config-lock.mjs",
  "credit-limit.mjs",
  "cutlist.mjs",
  "duck.mjs",
  "error-diffusion.mjs",
  "index-gen.mjs",
  "manifest.mjs",
  "media-fetch.mjs",
  "media-home.mjs",
  "npx-sync.mjs",
  "parakeet-words.mjs",
  "prefs-store.mjs",
  "recipe-store.mjs",
  "telemetry.mjs",
  "transcriptCutFade.mjs",
  "words.mjs",
];

export const INTENTIONAL_MEDIA_USE_DIVERGENCES = new Map([
  [
    "npx-sync.mjs",
    "the standalone skill stays self-contained while the CLI copy uses the shared audio helper",
  ],
]);

function copyPaths(name, skillDir, cliDir) {
  return { skillPath: join(skillDir, name), cliPath: join(cliDir, name) };
}

export function findMediaUseCopyParityIssues({ skillDir = skillLibDir, cliDir = cliLibDir } = {}) {
  const missingNames = MEDIA_USE_COPY_NAMES.filter((name) => {
    const { skillPath, cliPath } = copyPaths(name, skillDir, cliDir);
    return !existsSync(skillPath) || !existsSync(cliPath);
  });
  const missing = missingNames.map((name) => `${name}: both media-use copies must exist`);
  const drifted = MEDIA_USE_COPY_NAMES.filter(
    (name) => !missingNames.includes(name) && !INTENTIONAL_MEDIA_USE_DIVERGENCES.has(name),
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

  it("reports a missing copy without reading it as drift", () => {
    const root = mkdtempSync(join(tmpdir(), "media-use-parity-"));
    const skillDir = join(root, "skill");
    const cliDir = join(root, "cli");
    try {
      const name = MEDIA_USE_COPY_NAMES[0];
      mkdirSync(skillDir, { recursive: true });
      mkdirSync(cliDir, { recursive: true });
      writeFileSync(join(skillDir, name), "same");
      const issues = findMediaUseCopyParityIssues({ skillDir, cliDir });
      assert.equal(issues[0], `${name}: both media-use copies must exist`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

it("keeps generated standalone modules equal to their owners", () => {
  assert.deepEqual(generateSkillModuleCopies({ check: true }), []);
});

function publishedScripts(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || path === skillLibDir ? [] : publishedScripts(path);
    }
    return /\.mjs$/.test(entry.name) && !/\.test\.mjs$/.test(entry.name) ? [path] : [];
  });
}

// The CLI build swaps the published media-use scripts/lib for the CLI's lib folder.
it("finds every scripts/lib module a published media-use script imports in the CLI lib", () => {
  const skillRoot = resolve("skills/media-use");
  const engineEntry = join(skillRoot, "scripts", "resolve.mjs");
  const missing = publishedScripts(skillRoot)
    .filter((file) => file !== engineEntry)
    .flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/(?:from\s+|import\s*\(?\s*)["'](\.[^"']+)["']/g)]
        .map((match) => resolve(dirname(file), match[1]))
        .filter((target) => dirname(target) === skillLibDir)
        .filter((target) => !existsSync(join(cliLibDir, basename(target))))
        .map((target) => `${relative(skillRoot, file)} -> ${basename(target)}`),
    );
  assert.deepEqual(missing, []);
});
