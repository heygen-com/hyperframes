#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const VERSION_RE = /^\d+\.\d+\.\d+(?:-([0-9A-Za-z-]+)(?:\.[0-9A-Za-z-]+)*)?$/;
const STABLE_BRANCH_RE = /^origin\/(main|release\/v.+)$/;
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

export function validateReleaseChannel({ version, distTag, eventName, prHeadRef, remoteBranches }) {
  const errors = [];

  if (!VERSION_RE.test(version)) {
    errors.push(`Invalid release version "${version}". Expected x.y.z or x.y.z-channel.N.`);
    return errors;
  }

  const expectedTag = expectedDistTag(version);
  const isPrerelease = expectedTag !== "latest";

  if (distTag !== expectedTag) {
    errors.push(
      `Version "${version}" must publish with npm dist-tag "${expectedTag}", got "${distTag}".`,
    );
  }

  if (eventName === "pull_request") {
    if (!RELEASE_PR_RE.test(prHeadRef)) {
      errors.push(
        `Merged release PRs must come from release/vX.Y.Z branches, got "${prHeadRef || "<empty>"}".`,
      );
    }
    if (isPrerelease) {
      errors.push(
        "Merged release PRs publish stable releases only. Publish prereleases from next/alpha tags instead.",
      );
    }
    return errors;
  }

  if (eventName !== "push" && eventName !== "workflow_dispatch") {
    errors.push(`Unsupported publish event "${eventName}".`);
    return errors;
  }

  const allowedBranch = isPrerelease
    ? remoteBranches.some((branch) => PRERELEASE_BRANCH_RE.test(branch))
    : remoteBranches.some((branch) => STABLE_BRANCH_RE.test(branch));

  if (!allowedBranch) {
    const expectedBranches = isPrerelease
      ? "origin/next, origin/alpha, origin/beta, origin/rc, origin/canary, or origin/prerelease/*"
      : "origin/main or origin/release/v*";
    const actualBranches = remoteBranches.length > 0 ? remoteBranches.join(", ") : "<none>";
    errors.push(
      `Tag v${version} is on ${actualBranches}, but ${distTag} releases must be reachable from ${expectedBranches}.`,
    );
  }

  return errors;
}

function readRemoteBranchesContainingHead() {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const output = execFileSync("git", ["branch", "-r", "--contains", sha], {
    encoding: "utf8",
  });
  return normalizeRemoteBranches(output);
}

function main() {
  const version = process.env.VERSION ?? "";
  const distTag = process.env.DIST_TAG ?? "";
  const eventName = process.env.EVENT_NAME ?? "";
  const prHeadRef = process.env.PR_HEAD_REF ?? "";
  const remoteBranches = eventName === "pull_request" ? [] : readRemoteBranchesContainingHead();

  const errors = validateReleaseChannel({
    version,
    distTag,
    eventName,
    prHeadRef,
    remoteBranches,
  });

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`::error::${error}`);
    }
    process.exit(1);
  }

  const branches = remoteBranches.length > 0 ? remoteBranches.join(", ") : "not required";
  console.log(`Release channel validated for v${version} (${distTag}); branches: ${branches}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
