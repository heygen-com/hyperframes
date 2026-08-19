/**
 * Rewrite relative asset paths in sub-composition content so they resolve
 * correctly after the content is inlined into the root document.
 *
 * A sub-composition at "compositions/scene.html" referencing "../icon.svg"
 * means the project root — but after inlining into root index.html, the
 * "../" escapes the project directory and causes 404s. This function
 * resolves each relative path against the sub-composition's directory,
 * then normalizes it to be relative to the project root.
 *
 * Used by both the core bundler (preview) and the producer compiler (render)
 * to ensure consistent behavior.
 */

// URL paths in HTML output are POSIX regardless of host OS — use the `posix`
// submodule so Windows builds don't emit backslash-separated paths (or worse,
// drive-letter-prefixed artifacts from `resolve("/", ...)`).
import { posix } from "path";
const { join, resolve, dirname } = posix;

import { CSS_URL_RE, PATH_ATTRS, isNonRelativeUrl } from "./assetPaths.js";

const isAbsoluteOrSpecial = isNonRelativeUrl;

/**
 * Returns true only for paths that traverse up with `../`.
 * Plain relative paths like `assets/foo.svg` are ambiguous: two conventions are
 * in the wild, and only the filesystem can tell them apart — see `AssetExists`.
 */
function needsRewrite(val: string): boolean {
  return val.startsWith("../") || val === "..";
}

/**
 * Probe for "does this project-root-relative path exist?", supplied by callers
 * that can see the filesystem (the studio preview builder, the bundler, the
 * producer). Keeps this module free of `node:fs` so it stays browser-safe.
 *
 * It disambiguates the two conventions for a plain relative path authored in a
 * sub-composition that lives in a subdirectory:
 *
 *   1. A SIBLING file — `<link href="_shared.css">` next to the composition.
 *      This is what a browser resolves when the file is opened directly, and
 *      what an author means. Once the content moves into the project-root
 *      document it must become `design/styleframes/_shared.css` or it 404s.
 *   2. A PROJECT-ROOT asset — registry blocks are installed into a
 *      subdirectory but reference `assets/logo.png` at the root. Already
 *      correct in the root document; rewriting would break it.
 *
 * A sibling that exists on disk means (1); anything else is left as authored.
 * Without a probe the behavior is unchanged — plain relative paths pass through.
 */
export type AssetExists = (projectRelativePath: string) => boolean;

/** Split `foo.png?v=2#frag` into its path and its `?`/`#` suffix. */
function splitPathSuffix(value: string): [string, string] {
  const marker = value.search(/[?#]/);
  return marker === -1 ? [value, ""] : [value.slice(0, marker), value.slice(marker)];
}

/**
 * Rewrite a single relative path from a sub-composition's context to the
 * project root context.
 *
 * @param compSrcPath - The `data-composition-src` value (e.g. "compositions/scene.html")
 * @param relativePath - The asset path to rewrite (e.g. "../icon.svg")
 * @param assetExists - Optional filesystem probe; see `AssetExists`.
 * @returns The rewritten path relative to project root (e.g. "icon.svg"), or
 *          the original path if no rewriting is needed.
 */
export function rewriteAssetPath(
  compSrcPath: string,
  relativePath: string,
  assetExists?: AssetExists,
): string {
  if (isAbsoluteOrSpecial(relativePath)) return relativePath;
  const compDir = dirname(compSrcPath);
  if (!compDir || compDir === ".") return relativePath;
  if (!needsRewrite(relativePath)) {
    if (!assetExists) return relativePath;
    const [filePart, suffix] = splitPathSuffix(relativePath);
    if (!filePart) return relativePath;
    const sibling = resolve("/", join(compDir, filePart)).slice(1);
    return assetExists(sibling) ? sibling + suffix : relativePath;
  }
  const resolved = join(compDir, relativePath);
  const normalized = resolve("/", resolved).slice(1);
  return normalized;
}

/**
 * Rewrite all relative `src` and `href` attributes on elements within a
 * DOM tree, adjusting paths from the sub-composition's directory context
 * to the project root.
 *
 * @param elements - Iterable of DOM elements to scan (e.g. from querySelectorAll)
 * @param compSrcPath - The `data-composition-src` value
 * @param getAttr - Function to read an attribute from an element
 * @param setAttr - Function to set an attribute on an element
 */
export function rewriteAssetPaths<T>(
  elements: Iterable<T>,
  compSrcPath: string,
  getAttr: (el: T, attr: string) => string | null | undefined,
  setAttr: (el: T, attr: string, value: string) => void,
  assetExists?: AssetExists,
): void {
  for (const el of elements) {
    for (const attr of PATH_ATTRS) {
      const val = (getAttr(el, attr) || "").trim();
      const rewritten = rewriteAssetPath(compSrcPath, val, assetExists);
      if (rewritten !== val) {
        setAttr(el, attr, rewritten);
      }
    }
  }
}

/**
 * Rewrite CSS url(...) references inside inline style attributes.
 */
export function rewriteInlineStyleAssetUrls<T>(
  elements: Iterable<T>,
  compSrcPath: string,
  getStyle: (el: T) => string | null | undefined,
  setStyle: (el: T, value: string) => void,
  assetExists?: AssetExists,
): void {
  const compDir = dirname(compSrcPath);
  if (!compDir || compDir === ".") return;

  for (const el of elements) {
    const style = getStyle(el);
    if (!style) continue;
    const rewritten = rewriteCssAssetUrls(style, compSrcPath, assetExists);
    if (rewritten !== style) {
      setStyle(el, rewritten);
    }
  }
}

/**
 * Rewrite CSS url(...) references in a sub-composition's inline styles so
 * ../foo.woff2 remains valid after the CSS is hoisted into the root document.
 */
export function rewriteCssAssetUrls(
  cssText: string,
  compSrcPath: string,
  assetExists?: AssetExists,
): string {
  if (!cssText) return cssText;
  return cssText.replace(CSS_URL_RE, (full, quote: string, rawUrl: string) => {
    const urlValue = (rawUrl || "").trim();
    const rewritten = rewriteAssetPath(compSrcPath, urlValue, assetExists);
    if (rewritten === urlValue) return full;
    return `url(${quote || ""}${rewritten}${quote || ""})`;
  });
}
