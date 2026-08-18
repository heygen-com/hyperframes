#!/usr/bin/env node
/**
 * Fail if this branch would delete files that exist on the base.
 *
 * Written after a scare that turned out to be a measurement error, which is
 * the reason it uses the three-dot form. Comparing tip to tip (two dots) on a
 * branch that is a month behind reports every file main added since the merge
 * base as a deletion: 1,284 of them, including an entire skills tree. None of
 * that is real. A merge keeps main's side, and a pull request shows the
 * three-dot diff, which reported zero.
 *
 * So this exists to catch deletions a branch genuinely proposes, and to make
 * the distinction hard to get wrong again. If it ever disagrees with a manual
 * git diff, check which form the manual one used before believing it.
 *
 * Renames are reported separately. In a name-only diff a rename is
 * indistinguishable from a deletion, so treating them alike would either mask
 * real loss or block every legitimate move.
 *
 *   node scripts/check-no-main-deletions.mjs [--base origin/main]
 */

import { execFileSync } from "node:child_process";

const BASE_FLAG = "--base";

/**
 * Deletions this repository has already agreed to, each with the reason.
 *
 * A blanket escape hatch (a flag, an env var, `--force`) would turn the guard
 * off exactly when it matters, because the branch deleting something by
 * accident is also the branch that would reach for it. Naming each path here
 * instead keeps the default absolute and makes every intentional removal a
 * reviewable line in a diff.
 *
 * Entries are for deletions that are NOT renames — git already pairs those on
 * its own. Remove an entry once its deletion has landed on the base.
 */
export const ALLOWED_DELETIONS = new Map([
  [
    "docs/catalog/components/ai-generation-canvas.mdx",
    "owner-directed removal of the AI Generation Canvas catalog item and its generated documentation",
  ],
  [
    "docs/catalog/components/ai-prompt-flow.mdx",
    "owner-directed removal of the AI Prompt Flow catalog item and its generated documentation",
  ],
  [
    "docs/public/catalog/components/ai-generation-canvas.json",
    "owner-directed removal of the AI Generation Canvas catalog item and its generated public payload",
  ],
  [
    "docs/public/catalog/components/ai-prompt-flow.json",
    "owner-directed removal of the AI Prompt Flow catalog item and its generated public payload",
  ],
  [
    "registry/components/ai-generation-canvas/ai-generation-canvas.html",
    "owner-directed removal of the AI Generation Canvas catalog source component",
  ],
  [
    "registry/components/ai-generation-canvas/demo.html",
    "owner-directed removal of the AI Generation Canvas catalog preview source",
  ],
  [
    "registry/components/ai-generation-canvas/registry-item.json",
    "owner-directed removal of the AI Generation Canvas catalog registry entry",
  ],
  [
    "registry/components/ai-prompt-flow/ai-prompt-flow.html",
    "owner-directed removal of the AI Prompt Flow catalog source component",
  ],
  [
    "registry/components/ai-prompt-flow/demo.html",
    "owner-directed removal of the AI Prompt Flow catalog preview source",
  ],
  [
    "registry/components/ai-prompt-flow/registry-item.json",
    "owner-directed removal of the AI Prompt Flow catalog registry entry",
  ],
  [
    "packages/studio/src/components/StudioFeedbackBar.tsx",
    "replaced by components/feedback/StudioFeedbackCard.tsx; too little shared content for git to pair as a rename",
  ],
  [
    "skills/embedded-captions/references/test-set.md",
    "#3219: orphaned in the shipped skill (zero inbound references across all 140 files) and its corpus lives only at ~/Downloads/heygen_relevant_videos/, so it was neither reachable nor runnable on any install",
  ],
  [
    "skills/embedded-captions/themes/PORTING.md",
    "#3219: same, zero inbound references; a theme-authoring procedure whose inputs (cap_fx3 demos, frame corpora, CONTRACT.md) are not distributed with the skill",
  ],
  [
    "packages/core/scripts/build-audio-fx-runtime.ts",
    "merged into build-inline-artifact.ts: this and build-position-edits-render.ts were a byte-for-byte clone differing only in five names, which fallow's duplication check kept re-flagging on every unrelated line shift",
  ],
  [
    "packages/core/scripts/build-position-edits-render.ts",
    "merged into build-inline-artifact.ts, same reason as build-audio-fx-runtime.ts above",
  ],
  [
    "packages/core/scripts/build-inline-artifact.ts",
    "a later branch in this stack (wa-20b2-lfo-fixes) independently deduped the same two build scripts a different way — buildInjectedArtifact.ts plus two thin per-target files — before this consolidation and that one had merged; this branch's tree keeps that shape instead, so build-inline-artifact.ts is the one that goes.",
  ],
]);

export function parseBase(argv, fallback = "origin/main") {
  const index = argv.indexOf(BASE_FLAG);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${BASE_FLAG} needs a ref, for example ${BASE_FLAG} origin/main`);
  }
  return value;
}

/**
 * Split a `--name-status` diff into deletions and renames.
 *
 * Git reports a rename as `R<score>\told\tnew`. Reading only the first column
 * would file that under "deleted", which is the false alarm this guards
 * against being noisy enough to ignore.
 */
// one branch per git status code
// fallow-ignore-next-line complexity
export function classify(nameStatus) {
  const deleted = [];
  const renamed = [];
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const [status, ...paths] = line.split("\t");
    if (status.startsWith("R")) renamed.push({ from: paths[0], to: paths[1] });
    else if (status === "D") deleted.push(paths[0]);
  }
  return { deleted, renamed };
}

// a script entry point
// fallow-ignore-next-line complexity
function main() {
  const base = parseBase(process.argv.slice(2));
  let diff;
  try {
    diff = execFileSync("git", ["diff", "--name-status", "-M", `${base}...HEAD`], {
      encoding: "utf8",
    });
  } catch (error) {
    // An unreachable base is not a pass. Reporting "no deletions" because the
    // ref was misspelled is the exact failure this exists to prevent.
    console.error(`cannot diff against ${base}: ${error.message.trim()}`);
    process.exit(2);
  }

  const { deleted: allDeleted, renamed } = classify(diff);
  const agreed = allDeleted.filter((path) => ALLOWED_DELETIONS.has(path));
  const deleted = allDeleted.filter((path) => !ALLOWED_DELETIONS.has(path));

  if (agreed.length > 0) {
    console.log(`${agreed.length} deletion(s) agreed in ALLOWED_DELETIONS:`);
    for (const path of agreed) console.log(`  ${path} — ${ALLOWED_DELETIONS.get(path)}`);
  }
  if (renamed.length > 0) {
    console.log(`${renamed.length} renamed (allowed):`);
    for (const { from, to } of renamed.slice(0, 10)) console.log(`  ${from} -> ${to}`);
    if (renamed.length > 10) console.log(`  … and ${renamed.length - 10} more`);
  }

  if (deleted.length === 0) {
    console.log(`No files from ${base} are deleted by this branch.`);
    return;
  }

  console.error(`This branch deletes ${deleted.length} files that exist on ${base}:`);
  for (const path of deleted.slice(0, 25)) console.error(`  ${path}`);
  if (deleted.length > 25) console.error(`  … and ${deleted.length - 25} more`);
  console.error("\nIf a deletion is intended, remove this check for that path deliberately.");
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
