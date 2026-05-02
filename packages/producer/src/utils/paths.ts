/**
 * Path resolution utilities for the render pipeline.
 */

import {
  basename,
  join,
  resolve as nodeResolve,
  relative as nodeRelative,
  isAbsolute as nodeIsAbsolute,
} from "node:path";

export interface RenderPaths {
  absoluteProjectDir: string;
  absoluteOutputPath: string;
}

const DEFAULT_RENDERS_DIR =
  process.env.PRODUCER_RENDERS_DIR ??
  nodeResolve(new URL(import.meta.url).pathname, "../../..", "renders");

type PathModuleLike = {
  resolve: (...segments: string[]) => string;
  relative: (from: string, to: string) => string;
  isAbsolute: (path: string) => boolean;
};

type IsPathInsideOptions = {
  pathModule?: PathModuleLike;
};

/**
 * Cross-platform containment check.
 *
 * `child.startsWith(parent + "/")` breaks on Windows because the path
 * separator is `\`, not `/`. This helper uses `path.relative()` which
 * normalises separators per-platform and returns `..`-prefixed output
 * for out-of-tree paths — the canonical way to ask "is `child` inside
 * `parent`?" on every supported OS.
 *
 * Both inputs are normalised via `resolve()` so callers don't need to.
 * Equality counts as "inside" (a directory contains itself).
 */
export function isPathInside(
  childPath: string,
  parentPath: string,
  options: IsPathInsideOptions = {},
): boolean {
  const resolvePath = options.pathModule?.resolve ?? nodeResolve;
  const relativePath = options.pathModule?.relative ?? nodeRelative;
  const isPathAbsolute = options.pathModule?.isAbsolute ?? nodeIsAbsolute;
  const absChild = resolvePath(childPath);
  const absParent = resolvePath(parentPath);
  if (absChild === absParent) return true;
  const rel = relativePath(absParent, absChild);
  // `relative()` returns "" when paths are equal, ".." or "..\\foo" when child
  // is above the parent, and an absolute path when they live on different
  // drives/volumes (Windows) — none of which count as "inside".
  return rel !== "" && !rel.startsWith("..") && !isPathAbsolute(rel);
}

/**
 * Build a safe, cross-platform relative key for an absolute asset path
 * that lives outside the project directory.
 *
 * Windows absolute paths (`D:\coder\assets\segment.wav`) break two
 * downstream assumptions when passed as-is to `path.join(compileDir, key)`:
 *   1. The drive letter makes the path absolute, so `join()` silently
 *      discards `compileDir`.
 *   2. The backslashes and colon are invalid inside some OS sandboxes
 *      and HTTP URL encodings.
 *
 * We sanitise into `hf-ext/...` form using forward slashes, stripping
 * the colon after drive letters, the Windows extended-length prefix
 * (`\\?\`), and the UNC prefix (`\\server\share\`). The result is a
 * pure relative path that joins cleanly on every platform.
 *
 * Caller contract: `absPath` is expected to be canonical — typically
 * produced by `path.resolve()` upstream. This helper does NOT strip
 * `..` components on its own. `isPathInside` at copy time is the
 * defensive backstop.
 */
export function toExternalAssetKey(absPath: string): string {
  // Short-circuit if already a sanitised key — prevents double-wrap
  // producing `hf-ext/hf-ext/...`.
  if (absPath.startsWith("hf-ext/")) return absPath;

  // Normalise to forward slashes first so every subsequent pattern is
  // separator-agnostic.
  let normalised = absPath.replace(/\\/g, "/");

  // Windows extended-length prefix: `//?/` (was `\\?\`). Strip entirely —
  // the actual path follows. `//?/UNC/server/share/...` is the UNC
  // extended-length form; normalise to match the UNC branch below.
  normalised = normalised.replace(/^\/\/\?\/UNC\//i, "//");
  normalised = normalised.replace(/^\/\/\?\//, "");

  // UNC paths (`\\server\share\file`). Collapse to
  // `unc/server/share/file` so two different servers can't collide
  // under the same relative key.
  normalised = normalised.replace(/^\/\/([^/]+)\//, "unc/$1/");

  // Strip remaining leading forward slashes (Unix absolute).
  normalised = normalised.replace(/^\/+/, "");

  // Strip a leading drive-letter colon (Windows: "D:/coder" → "D/coder").
  normalised = normalised.replace(/^([A-Za-z]):\/?/, "$1/");

  return "hf-ext/" + normalised;
}

export function resolveRenderPaths(
  projectDir: string,
  outputPath: string | null | undefined,
  rendersDir: string = DEFAULT_RENDERS_DIR,
): RenderPaths {
  const absoluteProjectDir = nodeResolve(projectDir);
  const projectName = basename(absoluteProjectDir);
  const resolvedOutputPath = outputPath ?? join(rendersDir, `${projectName}.mp4`);
  const absoluteOutputPath = nodeResolve(resolvedOutputPath);

  return { absoluteProjectDir, absoluteOutputPath };
}
