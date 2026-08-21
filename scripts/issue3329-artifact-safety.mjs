import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";

function rejectTraversal(raw) {
  if (raw.split(/[\\/]+/).includes("..")) {
    throw new Error("Artifact root must not contain traversal segments");
  }
}

function isForbiddenRoot(target, repo, artifactSpace) {
  return new Set([parse(target).root, resolve(homedir()), repo, artifactSpace]).has(target);
}

function isDedicatedDescendant(target, artifactSpace) {
  const rel = relative(artifactSpace, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function canonicalizeTarget(target) {
  const suffix = [];
  let ancestor = target;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      throw new Error("Artifact root has no canonical ancestor");
    }
    suffix.unshift(basename(ancestor));
    ancestor = parent;
  }
  return resolve(realpathSync(ancestor), ...suffix);
}

function rejectUnsafeTarget(target, repo, artifactSpace) {
  if (
    isForbiddenRoot(target, repo, artifactSpace) ||
    !isDedicatedDescendant(artifactSpace, repo) ||
    !isDedicatedDescendant(target, artifactSpace)
  ) {
    throw new Error(
      "Artifact root must be a dedicated descendant of the repository artifact space",
    );
  }
}

export function validateArtifactRoot(requestedPath, repoRoot) {
  const raw = String(requestedPath ?? "");
  rejectTraversal(raw);
  const repo = realpathSync(resolve(repoRoot));
  const artifactSpace = canonicalizeTarget(resolve(repo, ".artifacts"));
  const requestedTarget = resolve(repo, raw);
  const target = canonicalizeTarget(requestedTarget);
  rejectUnsafeTarget(target, repo, artifactSpace);
  return requestedTarget;
}
