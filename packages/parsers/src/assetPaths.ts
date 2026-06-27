/**
 * Shared primitives for scanning and rewriting asset paths in HTML/CSS.
 *
 * Used by: rewriteSubCompPaths (core), collectExternalAssets (producer),
 * localizeExternalAssets (CLI publish).
 */

import { isAbsolute, relative, resolve } from "node:path";

/** Regex matching CSS `url(...)` references — captures the quote style and the raw URL. */
export const CSS_URL_RE = /\burl\(\s*(["']?)([^)"']+)\1\s*\)/g;

/** Attributes that may contain relative asset paths. */
export const PATH_ATTRS = ["src", "href"] as const;

/** Returns true for URLs/prefixes that should never be rewritten. */
export function isNonRelativeUrl(val: string): boolean {
  return (
    !val ||
    val.startsWith("http://") ||
    val.startsWith("https://") ||
    val.startsWith("//") ||
    val.startsWith("data:") ||
    val.startsWith("#") ||
    val.startsWith("/")
  );
}

/**
 * Cross-platform containment check: is `childPath` inside `parentPath`?
 * Equality counts as "inside".
 */
export function isPathInside(childPath: string, parentPath: string): boolean {
  const absChild = resolve(childPath);
  const absParent = resolve(parentPath);
  if (absChild === absParent) return true;
  const rel = relative(absParent, absChild);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
