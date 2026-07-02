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
 * Plain relative paths like `assets/foo.svg` are already correct from the
 * root perspective — the browser resolves them against the served root, which
 * is the project root, so they don't need rewriting.
 */
function needsRewrite(val: string): boolean {
  return val.startsWith("../") || val === "..";
}

/**
 * Rewrite a single relative path from a sub-composition's context to the
 * project root context.
 *
 * @param compSrcPath - The `data-composition-src` value (e.g. "compositions/scene.html")
 * @param relativePath - The asset path to rewrite (e.g. "../icon.svg")
 * @returns The rewritten path relative to project root (e.g. "icon.svg"), or
 *          the original path if no rewriting is needed.
 */
export function rewriteAssetPath(compSrcPath: string, relativePath: string): string {
  if (isAbsoluteOrSpecial(relativePath)) return relativePath;
  if (!needsRewrite(relativePath)) return relativePath;
  const compDir = dirname(compSrcPath);
  if (!compDir || compDir === ".") return relativePath;
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
): void {
  for (const el of elements) {
    for (const attr of PATH_ATTRS) {
      const val = (getAttr(el, attr) || "").trim();
      const rewritten = rewriteAssetPath(compSrcPath, val);
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
): void {
  const compDir = dirname(compSrcPath);
  if (!compDir || compDir === ".") return;

  for (const el of elements) {
    const style = getStyle(el);
    if (!style) continue;
    const rewritten = rewriteCssAssetUrls(style, compSrcPath);
    if (rewritten !== style) {
      setStyle(el, rewritten);
    }
  }
}

/**
 * Rewrite CSS url(...) references in a sub-composition's inline styles so
 * ../foo.woff2 remains valid after the CSS is hoisted into the root document.
 */
export function rewriteCssAssetUrls(cssText: string, compSrcPath: string): string {
  if (!cssText) return cssText;
  return cssText.replace(CSS_URL_RE, (full, quote: string, rawUrl: string) => {
    const urlValue = (rawUrl || "").trim();
    const rewritten = rewriteAssetPath(compSrcPath, urlValue);
    if (rewritten === urlValue) return full;
    return `url(${quote || ""}${rewritten}${quote || ""})`;
  });
}
