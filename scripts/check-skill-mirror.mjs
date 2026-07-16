#!/usr/bin/env node
// Verifies .claude/skills/ and .agents/skills/ are byte-identical mirrors.
//
// The two dirs deliver the same skill set to Claude Code and Codex CLI
// respectively (each CLI reads only its own path). They must stay in lockstep
// or one CLI will silently ship a stale skill. This check enforces that
// invariant at CI time.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

const REPO_ROOT = join(import.meta.dirname, "..");
const A = join(REPO_ROOT, ".claude", "skills");
const B = join(REPO_ROOT, ".agents", "skills");

// The two top-level READMEs deliberately differ (one addresses CC users, one
// addresses Codex CLI users). Skill CONTENT must mirror; per-CLI docs need not.
const MIRROR_EXCLUDE = new Set(["README.md"]);

function collectFile(dir, entry, base) {
  if (!entry.isFile()) return [];
  const rel = relative(base, join(dir, entry.name));
  if (MIRROR_EXCLUDE.has(rel)) return [];
  return [rel];
}

function walk(dir, base) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const out = entries.flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name), base) : collectFile(dir, entry, base),
  );
  return out.sort();
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const aFiles = walk(A, A);
const bFiles = walk(B, B);

const problems = [];

const aSet = new Set(aFiles);
const bSet = new Set(bFiles);

for (const rel of aFiles) {
  if (!bSet.has(rel)) {
    problems.push(`only in .claude/skills/: ${rel}`);
  }
}
for (const rel of bFiles) {
  if (!aSet.has(rel)) {
    problems.push(`only in .agents/skills/: ${rel}`);
  }
}

for (const rel of aFiles) {
  if (!bSet.has(rel)) continue;
  const aHash = hashFile(join(A, rel));
  const bHash = hashFile(join(B, rel));
  if (aHash !== bHash) {
    problems.push(
      `content differs: ${rel} (.claude=${aHash.slice(0, 8)} .agents=${bHash.slice(0, 8)})`,
    );
  }
}

if (problems.length > 0) {
  console.error("Skill mirror out of sync between .claude/skills/ and .agents/skills/:\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nRebuild the mirror: cp -r .claude/skills/. .agents/skills/  (or vice-versa)");
  process.exit(1);
}

console.log(
  `Skill mirror OK: ${aFiles.length} file(s) match byte-for-byte across .claude/skills/ and .agents/skills/.`,
);
