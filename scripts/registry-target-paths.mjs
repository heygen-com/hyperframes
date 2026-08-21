/**
 * Containment for registry manifest paths.
 *
 * `registry-item.json` is untrusted input. `catalog-previews.yml` runs on
 * `pull_request` for any change under `registry/blocks/**` or
 * `registry/components/**`, so a contributor's own manifest reaches the preview
 * renderer, and the job then uploads `docs/images/catalog/` as an artifact.
 *
 * Two escapes, and the second is why this is not a one-line check:
 *
 *   Lexical — `join()` walks out of its first argument, so `files[].path` of
 *   `../../../../etc/passwd` reads an arbitrary runner file into the project and
 *   `files[].target` of the same shape writes an arbitrary runner path.
 *
 *   Symbolic — `resolve()` and `relative()` are pure string operations and do
 *   not follow links. The registry item is copied in recursively with symlinks
 *   preserved, so a PR shipping `escape -> /tmp/outside` and declaring
 *   `target: "escape/pwned.txt"` passes any lexical test; `mkdirSync` then
 *   follows the link and `cpSync` writes outside the project.
 *
 * So containment is filesystem-aware: no existing component of a candidate may
 * be a symlink, and the candidate's real location — resolved through its
 * deepest existing ancestor — must sit under the project's own real path.
 * Both fields are checked, not just the one that looks like input.
 */

import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** True when `candidate` is `root` itself or lexically beneath it. */
function isBeneath(root, candidate) {
  const step = relative(root, candidate);
  return step === "" || (!step.startsWith(`..${sep}`) && step !== ".." && !isAbsolute(step));
}

/** Every directory from `root` down to `candidate`, inclusive. */
function componentsUnder(root, candidate) {
  const chain = [];
  for (let current = candidate; current !== root && isBeneath(root, current); ) {
    chain.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return chain;
}

/** `candidate` with symlinks resolved as far as the filesystem knows it. */
function realLocation(candidate) {
  const existing = componentsUnder("", candidate).find((part) => existsSync(part));
  if (!existing) return candidate;
  return resolve(realpathSync(existing), relative(existing, candidate));
}

/**
 * True when `candidate` really lands inside `root`.
 *
 * Lexical containment first, then a refusal of any existing component that is a
 * symlink, then a real-path check — a link is rejected outright rather than
 * followed, so a link pointing back inside the project is still refused. That
 * is deliberate: nothing in the registry needs one, and allowing it would mean
 * trusting the link target not to change between the check and the copy.
 */
export function isContainedIn(root, candidate) {
  const realRoot = realpathSync(resolve(root));
  const absolute = resolve(realRoot, candidate);
  if (!isBeneath(realRoot, absolute)) return false;
  if (componentsUnder(realRoot, absolute).some(isSymlink)) return false;
  return isBeneath(realRoot, realLocation(absolute));
}

function isSymlink(target) {
  return (
    existsSync(dirname(target)) && lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()
  );
}

/**
 * The `[from, to]` pairs safe to copy, dropping any that escape `projectDir`.
 *
 * `exists` is injected so a caller can test the containment rule without a
 * fixture tree — the traversal decision must not depend on whether the target
 * happens to be present on the runner.
 */
export function resolveContainedCopies(projectDir, files, exists) {
  const root = realpathSync(resolve(projectDir));
  return (files ?? [])
    .filter((file) => file?.path && file?.target)
    .filter((file) => isContainedIn(root, file.path) && isContainedIn(root, file.target))
    .map((file) => [resolve(root, file.path), resolve(root, file.target)])
    .filter(([from, to]) => from !== to && exists(from));
}
