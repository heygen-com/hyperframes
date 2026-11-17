#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const VERSION_RE = /^\d+\.\d+\.\d+(?:-([0-9A-Za-z-]+)(?:\.[0-9A-Za-z-]+)*)?$/;
const PRERELEASE_BRANCH_RE = /^origin\/(next|alpha|beta|rc|canary|prerelease\/.+)$/;
const RELEASE_PR_RE = /^release\/v\d+\.\d+\.\d+$/;

export function getPrereleaseId(version) {
  const match = VERSION_RE.exec(version);
  if (!match) {
    return null;
  }
  return match[1] ?? null;
}

export function expectedDistTag(version) {
  const prereleaseId = getPrereleaseId(version);
  return prereleaseId ?? "latest";
}

export function normalizeRemoteBranches(output) {
  return output
    .split("\n")
    .map((line) => line.replace(/^[* ]+/, "").trim())
    .filter((line) => line && !line.includes("HEAD ->"));
}

function validateDistTag(version, distTag) {
  const expectedTag = expectedDistTag(version);
  if (distTag === expectedTag) return [];
  return [
    `Version "${version}" must publish with npm dist-tag "${expectedTag}", got "${distTag}".`,
  ];
}

function validateMergedReleasePr({ version, releaseRef }) {
  const errors = [];
  if (!RELEASE_PR_RE.test(releaseRef)) {
    errors.push(
      `Merged release PRs must come from release/vX.Y.Z branches, got "${releaseRef || "<empty>"}".`,
    );
  }
  if (expectedDistTag(version) !== "latest") {
    errors.push(
      "Merged release PRs publish stable releases only. Publish prereleases from next/alpha tags instead.",
    );
  }
  return errors;
}

function validatePrereleaseTagPush({ version, distTag, remoteBranches }) {
  if (expectedDistTag(version) === "latest") {
    return [
      "Stable tag publishing is disabled. Merge a reviewed release/vX.Y.Z PR into main; to recover, rerun the failed jobs of the publish run on that merge.",
    ];
  }

  const allowedBranch = remoteBranches.some((branch) => PRERELEASE_BRANCH_RE.test(branch));
  if (allowedBranch) return [];
  const actualBranches = remoteBranches.length > 0 ? remoteBranches.join(", ") : "<none>";
  return [
    `Tag v${version} is on ${actualBranches}, but ${distTag} releases must be reachable from origin/next, origin/alpha, origin/beta, origin/rc, origin/canary, or origin/prerelease/*.`,
  ];
}

const SOURCE_VALIDATORS = new Map([
  ["release-pr", validateMergedReleasePr],
  ["tag", validatePrereleaseTagPush],
]);

function validateReleaseSource(input) {
  const validator = SOURCE_VALIDATORS.get(input.source);
  return validator ? validator(input) : [`Unsupported release source "${input.source}".`];
}

export function validateReleaseChannel(input) {
  if (!VERSION_RE.test(input.version)) {
    return [`Invalid release version "${input.version}". Expected x.y.z or x.y.z-channel.N.`];
  }

  return [...validateDistTag(input.version, input.distTag), ...validateReleaseSource(input)];
}

function readRemoteBranchesContainingHead() {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const output = execFileSync("git", ["branch", "-r", "--contains", sha], {
    encoding: "utf8",
  });
  return normalizeRemoteBranches(output);
}

function readEnv(name) {
  return process.env[name] ?? "";
}

function readRemoteBranchesForSource(source) {
  return source === "tag" ? readRemoteBranchesContainingHead() : [];
}

function readValidationInput() {
  const source = readEnv("SOURCE");
  return {
    version: readEnv("VERSION"),
    distTag: readEnv("DIST_TAG"),
    source,
    releaseRef: readEnv("RELEASE_REF"),
    remoteBranches: readRemoteBranchesForSource(source),
  };
}

function reportValidation(input, errors) {
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`::error::${error}`);
    }
    process.exitCode = 1;
    return;
  }

  const branches =
    input.remoteBranches.length > 0 ? input.remoteBranches.join(", ") : "not required";
  console.log(
    `Release channel validated for v${input.version} (${input.distTag}); branches: ${branches}`,
  );
}

function main() {
  const input = readValidationInput();
  reportValidation(input, validateReleaseChannel(input));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
