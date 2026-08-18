import { homedir } from "node:os";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";

export function validateArtifactRoot(requestedPath, repoRoot) {
  const repo = resolve(repoRoot);
  const artifactSpace = resolve(repo, ".artifacts");
  const raw = String(requestedPath ?? "");
  if (raw.split(/[\\/]+/).includes("..")) {
    throw new Error("Artifact root must not contain traversal segments");
  }
  const target = resolve(repo, raw);
  const rel = relative(artifactSpace, target);
  const forbidden = new Set([parse(target).root, resolve(homedir()), repo, artifactSpace]);
  if (
    forbidden.has(target) ||
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  ) {
    throw new Error(
      "Artifact root must be a dedicated descendant of the repository artifact space",
    );
  }
  return target;
}
