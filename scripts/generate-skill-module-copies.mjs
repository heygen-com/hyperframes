import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const skillModuleCopies = [
  [
    "packages/cli/src/media-use/lib/media-fetch.mjs",
    ["skills/media-use/scripts/lib/media-fetch.mjs"],
  ],
  [
    "packages/cli/src/media-use/lib/openverse.mjs",
    ["skills/media-use/audio/scripts/lib/openverse.mjs"],
  ],
  [
    "skills/hyperframes/scripts/lib/main-module.mjs",
    [
      "skills/media-use/audio/scripts/lib/main-module.mjs",
      "packages/cli/src/media-use/lib/main-module.mjs",
    ],
  ],
];

function synchronizeCopy(content, target, check) {
  const path = resolve(root, target);
  if (check) return readFileSync(path, "utf8") !== content;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return false;
}

export function generateSkillModuleCopies({ check = false } = {}) {
  return skillModuleCopies.flatMap(([source, targets]) => {
    const content = readFileSync(resolve(root, source), "utf8");
    return targets.filter((target) => synchronizeCopy(content, target, check));
  });
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  const drifted = generateSkillModuleCopies({ check: process.argv.includes("--check") });
  if (drifted.length) throw new Error("Regenerate skill module copies: " + drifted.join(", "));
  console.log("Skill module copies are in sync");
}
