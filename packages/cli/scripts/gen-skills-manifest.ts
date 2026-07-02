// Generate (or verify) skills-manifest.json (repo root) — the published
// "latest" fingerprint of the HyperFrames skill bundle.
//
//   bun run --cwd packages/cli gen:skills-manifest          # write/update
//   bun run --cwd packages/cli gen:skills-manifest --check  # verify only (CI)
//
// The manifest is just per-skill content hashes (no version / timestamp), so it
// is fully deterministic: same skill content ⇒ byte-identical manifest. `--check`
// exits non-zero when the committed manifest doesn't match current skill content.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, MANIFEST_FILE, type SkillsManifest } from "../src/utils/skillsManifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", ".."); // packages/cli/scripts → repo root
const skillsRoot = join(repoRoot, "skills");
const outPath = join(repoRoot, MANIFEST_FILE);
const isCheck = process.argv.includes("--check");

/** Stable signature of the content hashes (order-independent). */
function signature(skills: SkillsManifest["skills"]): string {
  return Object.keys(skills)
    .sort()
    .map((name) => `${name}:${skills[name]!.hash}`)
    .join("\n");
}

function driftLine(name: string, oldHash?: string, newHash?: string): string | null {
  if (oldHash === newHash) return null;
  if (!oldHash) return `  + ${name} (new)`;
  if (!newHash) return `  - ${name} (removed)`;
  return `  ~ ${name} (${oldHash} → ${newHash})`;
}

function hashOf(skills: SkillsManifest["skills"], name: string): string | undefined {
  return skills[name]?.hash;
}

function reportDrift(fresh: SkillsManifest, committed: SkillsManifest | null): void {
  const oldSkills = committed === null ? {} : committed.skills;
  const names = [...new Set([...Object.keys(fresh.skills), ...Object.keys(oldSkills)])].sort();
  for (const name of names) {
    const line = driftLine(name, hashOf(oldSkills, name), hashOf(fresh.skills, name));
    if (line) console.log(line);
  }
}

const fresh = buildManifest(skillsRoot, { source: "heygen-com/hyperframes" });

// Read the committed manifest directly (no existsSync precheck) so there's no
// check-then-write race on outPath — a missing or unreadable file just means
// "no committed manifest yet", and we write a fresh one below.
let committed: SkillsManifest | null = null;
try {
  committed = JSON.parse(readFileSync(outPath, "utf8")) as SkillsManifest;
} catch {
  committed = null;
}

const inSync = committed !== null && signature(committed.skills) === signature(fresh.skills);
const count = Object.keys(fresh.skills).length;

if (isCheck) {
  if (inSync) {
    console.log(`✓ ${MANIFEST_FILE} is in sync (${count} skills)`);
    process.exit(0);
  }
  console.error(`✗ ${MANIFEST_FILE} is out of date — a skill changed without regenerating it.`);
  reportDrift(fresh, committed);
  console.error(
    `\nRun: bun run --cwd packages/cli gen:skills-manifest  (then commit ${MANIFEST_FILE})`,
  );
  process.exit(1);
}

// Write mode — churn-free: only rewrite when a content hash actually changed.
if (inSync) {
  console.log(`${MANIFEST_FILE} already in sync — no change (${count} skills)`);
  process.exit(0);
}

writeFileSync(outPath, JSON.stringify(fresh, null, 2) + "\n");
console.log(`Wrote ${outPath} (${count} skills)`);
reportDrift(fresh, committed);
