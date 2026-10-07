#!/usr/bin/env node
// `clawhub sync` bumps from the registry's `latest` tag, so a version the registry has hidden
// blocks the skill for good; an acknowledged one is published one patch past, then checked live.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const TAKEN_VERSION = /Version (\d+)\.(\d+)\.(\d+) already exists/;
// The registry hid this one version; any other taken version still fails the sync.
const SKIPPABLE_TAKEN = new Map([["hyperframes-creative", "1.0.13"]]);
const OWNER_HANDLE = "heygen-com";
const OWNER = ["--owner", OWNER_HANDLE];

function takenVersion(message) {
  const match = TAKEN_VERSION.exec(message);
  return match ? match.slice(1, 4).map(Number) : null;
}

function parsedOutput(result) {
  try {
    return JSON.parse(result.output);
  } catch {
    return null;
  }
}

function latestTag(run, slug) {
  return parsedOutput(run(["inspect", `${OWNER_HANDLE}/${slug}`, "--json"]))?.skill?.tags?.latest;
}

function failedSkills(sync) {
  return parsedOutput(sync)?.failed ?? [];
}

const syncArgs = (provenance, dryRun) =>
  ["sync", "--all", "--json", "--bump", "patch", ...OWNER, ...provenance].concat(
    dryRun ? ["--dry-run"] : [],
  );

function versionPastSkippable(slug, message) {
  const taken = takenVersion(message);
  if (!taken || SKIPPABLE_TAKEN.get(slug) !== taken.join(".")) return null;
  const [major, minor, patch] = taken;
  return `${major}.${minor}.${patch + 1}`;
}

function republishTaken(run, provenance, { slug, message }) {
  const version = versionPastSkippable(slug, message);
  if (!version) return `${slug}: ${message}`;
  const folder = `skills/${slug}`;
  const published = run(
    ["publish", folder, "--slug", slug, "--version", version, "--source-path", folder].concat(
      OWNER,
      provenance,
    ),
  );
  if (!published.ok) return `${slug}: ${published.message}`;
  const latest = latestTag(run, slug);
  if (latest !== version)
    return `${slug}: published ${version}, but the registry's latest is ${latest}`;
  console.log(`${slug}: ${SKIPPABLE_TAKEN.get(slug)} is taken, published ${version}`);
  return null;
}

export function syncSkills({ run, provenance, dryRun }) {
  const sync = run(syncArgs(provenance, dryRun));
  if (sync.ok) return [];
  const failed = dryRun ? [] : failedSkills(sync);
  if (failed.length === 0) return [sync.message];
  return failed.map((skill) => republishTaken(run, provenance, skill)).filter(Boolean);
}

function runClawhub(args) {
  const result = spawnSync("clawhub", args, { encoding: "utf8" });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return { ok: result.status === 0, output: result.stdout, message: result.stdout + result.stderr };
}

function main() {
  const env = process.env;
  const errors = syncSkills({
    run: runClawhub,
    dryRun: env.DRY_RUN === "true",
    provenance: [
      "--changelog",
      `Synced from ${env.GITHUB_SHA.slice(0, 7)} (${env.GITHUB_REF_NAME})`,
      "--source-repo",
      env.GITHUB_REPOSITORY,
      "--source-commit",
      env.GITHUB_SHA,
      "--source-ref",
      env.GITHUB_REF,
    ],
  });
  for (const error of errors) console.error(`::error::${error}`);
  if (errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
