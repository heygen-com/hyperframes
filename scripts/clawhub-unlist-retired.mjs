#!/usr/bin/env node
// `clawhub sync` never republishes a retired skill, but its last version stays listed until
// the owner hides it. Hiding is ClawHub's owner soft delete (`clawhub unhide` restores it), and
// the registry answers "Skill not found" for a hidden skill, which is what makes a rerun a no-op.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { RETIRED_SKILLS, retiredSkillNotice } from "../packages/cli/src/utils/skillsManifest.ts";

const OWNER_HANDLE = "heygen-com";
const NOT_FOUND = /Skill not found/;

function parsedOutput(result) {
  try {
    return JSON.parse(result.output);
  } catch {
    return null;
  }
}

/** "listed", "unlisted", or the inspect failure that settles neither. */
function listing(run, slug) {
  const inspected = run(["inspect", `${OWNER_HANDLE}/${slug}`, "--json"]);
  if (!inspected.ok) return NOT_FOUND.test(inspected.message) ? "unlisted" : inspected.message;
  const parsed = parsedOutput(inspected);
  if (!parsed) return `inspect printed no JSON: ${inspected.message}`;
  return parsed.skill ? "listed" : "unlisted";
}

/** Hides every retired skill ClawHub still lists; a dry run only names them. */
export function unlistRetired({ run, names, reasonFor, dryRun }) {
  const hidden = [];
  const pending = [];
  const errors = [];
  for (const slug of names) {
    const state = listing(run, slug);
    if (state === "unlisted") continue;
    if (state !== "listed") {
      errors.push(`${slug}: ${state}`);
      continue;
    }
    if (dryRun) {
      pending.push(slug);
      continue;
    }
    const hide = run(["hide", `${OWNER_HANDLE}/${slug}`, "--yes", "--reason", reasonFor(slug)]);
    if (hide.ok) hidden.push(slug);
    else errors.push(`${slug}: ${hide.message}`);
  }
  return { hidden, pending, errors };
}

function runClawhub(args) {
  const result = spawnSync("clawhub", args, { encoding: "utf8" });
  if (args[0] !== "inspect") {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  }
  return { ok: result.status === 0, output: result.stdout, message: result.stdout + result.stderr };
}

function main() {
  const dryRun = process.env.DRY_RUN === "true";
  const { hidden, pending, errors } = unlistRetired({
    run: runClawhub,
    names: RETIRED_SKILLS,
    reasonFor: retiredSkillNotice,
    dryRun,
  });
  if (hidden.length > 0) console.log(`Hid retired skills on ClawHub:\n${hidden.join("\n")}`);
  if (pending.length > 0)
    console.log(`Retired skills still listed on ClawHub (dry run):\n${pending.join("\n")}`);
  if (hidden.length + pending.length + errors.length === 0)
    console.log(`No retired skill is listed on ClawHub (${RETIRED_SKILLS.length} checked).`);
  for (const error of errors) console.error(`::error::${error}`);
  if (errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
