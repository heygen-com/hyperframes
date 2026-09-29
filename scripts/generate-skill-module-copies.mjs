import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflows = ["faceless-explainer", "pr-to-video", "product-launch-video"];
export const skillModuleCopies = [
  [
    "packages/cli/src/media-use/lib/media-fetch.mjs",
    ["skills/media-use/scripts/lib/media-fetch.mjs"],
  ],
  [
    "skills/media-use/audio/scripts/lib/bgm-volume.mjs",
    workflows.map((skill) => `skills/${skill}/scripts/lib/bgm-volume.mjs`),
  ],
  [
    "skills/hyperframes/scripts/lib/frame-packets-core.mjs",
    [...workflows, "general-video"].map(
      (skill) => `skills/${skill}/scripts/lib/frame-packets-core.mjs`,
    ),
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

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const drifted = generateSkillModuleCopies({ check: process.argv.includes("--check") });
  if (drifted.length) throw new Error("Regenerate skill module copies: " + drifted.join(", "));
  console.log("Skill module copies are in sync");
}
