import { scanHtmlOpeningTags, decodeAuthoredAttribute } from "./htmlAttributeSpans.js";
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { decodeUrlPathVariants } from "./composition.js";

/** The subset of `node:path` that `isWithinProjectRoot` needs to run under
 * an injected platform (tests pass `path.win32` / `path.posix`). */
interface PathModuleLike {
  resolve: (...segments: string[]) => string;
  relative: (from: string, to: string) => string;
  isAbsolute: (path: string) => boolean;
  sep: string;
}

/**
 * Shared local-asset resolution helpers for every package that maps
 * composition asset URLs to files on disk (lint project rules, the HEVC
 * preview check, studio-server's media codec scan). Import via the
 * `@hyperframes/parsers/asset-resolution` subpath.
 */

export function isRemoteOrInlineUrl(url: string): boolean {
  return /^(https?:|data:|blob:|\/\/|#)/i.test(url);
}

/**
 * True when a URL still contains an unresolved templating placeholder —
 * `<<token>>`, `{{ token }}`, or `${token}` — that a build or templating step
 * substitutes before render. The static linter runs before that substitution,
 * so it cannot resolve such a value to a file on disk and must not report it as
 * a missing asset. Check the RAW url, before any `cleanAssetUrl()` step: that
 * splits on `?`/`#`, which also chops inside a `${...}` expression. (The `__UPPER__`
 * placeholder shape is combined with this in `isUnresolvedAssetPlaceholder` below, the
 * shared predicate asset-src sites skip on.)
 */
export function hasUnresolvedTemplatingToken(url: string): boolean {
  return /<<[^<>]+>>|\{\{[^{}]+\}\}|\$\{[^{}]+\}/.test(url);
}

/**
 * True when an asset src is a build-time placeholder rather than a resolvable path:
 * the `__UPPER__` shape (e.g. `__DURATION__`) or an unresolved templating token
 * (`<<...>>`, `{{...}}`, `${...}`). Pass the RAW src, before any `cleanAssetUrl()` step —
 * cleanAssetUrl splits on `?`/`#`, which would chop inside a `${...}` expression and defeat
 * the token match. Remote/inline URL handling is deliberately NOT folded in: call sites
 * differ (e.g. audio uses a narrower http/data/blob check), so each keeps its own.
 *
 * This is the single skip predicate every asset-src lint / codec / compile site should
 * route through, so the placeholder rules can't drift apart across call sites.
 */
export function isUnresolvedAssetPlaceholder(rawSrc: string): boolean {
  return /^__[A-Z_]+__$/.test(rawSrc.trim()) || hasUnresolvedTemplatingToken(rawSrc);
}

/**
 * Collect active, local composition paths in document order, including template content.
 * Paths are physical file names relative to the project root at every nesting level.
 */
export function collectSubCompositionSrcs(html: string): string[] {
  const srcs: string[] = [];
  const seen = new Set<string>();

  for (const tag of scanHtmlOpeningTags(html)) {
    if (!tag.closed) continue;
    const attribute = tag.attributes.find((attr) => attr.name === "data-composition-src");
    if (attribute?.kind !== "value") continue;
    const src = decodeAuthoredAttribute(attribute.value).trim();
    if (!src || seen.has(src)) continue;
    // __UPPER__ placeholder or late-bound templating token — not a real reference.
    if (isUnresolvedAssetPlaceholder(src)) continue;
    // A remote or inline mount names no file on disk. Every caller resolves
    // these against the project root, so letting one through produces a
    // nonsense path (`<projectDir>/https:/host/a.html`) that then reads as a
    // missing local file: a false "does not exist" for lint, and a wasted
    // visit against the telemetry walk's file budget.
    if (isRemoteOrInlineUrl(src)) continue;
    seen.add(src);
    srcs.push(src);
  }
  return srcs;
}

export function cleanAssetUrl(url: string): string {
  return url.trim().split(/[?#]/, 1)[0] ?? "";
}

/**
 * `pathModule` defaults to the host's native `node:path`, so every existing
 * caller gets its actual OS's separator and drive-letter rules unchanged.
 * Tests inject `path.win32` / `path.posix` to exercise both platforms' rules
 * from a single OS (same pattern as producer/fileServer.ts's `isPathInside`).
 */
export function isWithinProjectRoot(
  projectDir: string,
  candidate: string,
  pathModule: PathModuleLike = { resolve, relative, isAbsolute, sep },
): boolean {
  const projectRoot = pathModule.resolve(projectDir);
  const relativePath = pathModule.relative(projectRoot, candidate);
  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${pathModule.sep}`) &&
    !pathModule.isAbsolute(relativePath)
  );
}

function addCandidate(candidates: string[], candidate: string): void {
  if (!candidates.includes(candidate)) candidates.push(candidate);
}

export function resolveLocalAssetCandidates(projectDir: string, url: string): string[] {
  const cleanUrl = cleanAssetUrl(url);
  const projectRoot = resolve(projectDir);
  const candidates: string[] = [];

  for (const variant of decodeUrlPathVariants(cleanUrl)) {
    const projectRelative = variant.startsWith("/") ? variant.slice(1) : variant;
    const resolved = resolve(projectRoot, projectRelative);
    if (isWithinProjectRoot(projectRoot, resolved)) {
      addCandidate(candidates, resolved);
      continue;
    }

    const normalized = posix.normalize(projectRelative.replace(/\\/g, "/"));
    const clamped = normalized.replace(/^(\.\.\/)+/, "");
    if (clamped && clamped !== "..") {
      addCandidate(candidates, resolve(projectRoot, clamped));
    }
  }

  return candidates;
}

export function resolveExistingLocalAsset(
  projectDir: string,
  url: string,
): { resolved: string; rootRelativePath: string } | null {
  const projectRoot = resolve(projectDir);
  const resolved = resolveLocalAssetCandidates(projectRoot, url).find(existsSync);
  if (!resolved) return null;
  return { resolved, rootRelativePath: relative(projectRoot, resolved) };
}

// Candidates for a variant whose join escaped the project root, re-anchored at the root.
function reanchoredCandidates(variant: string, baseDir: string, compiledDir?: string): string[] {
  const baseAbs = resolve(baseDir);
  const joinedAbs = resolve(join(baseDir, variant));
  if (joinedAbs === baseAbs || joinedAbs.startsWith(baseAbs + sep)) return [];
  // Normalize before stripping, or `assets/../../assets/foo` becomes `assets/assets/foo`.
  const stripped = posix.normalize(variant.replace(/\\/g, "/")).replace(/^(\.\.\/)+/, "");
  if (!stripped || stripped === variant || stripped === "..") return [];
  return compiledDir
    ? [join(compiledDir, stripped), join(baseDir, stripped)]
    : [join(baseDir, stripped)];
}

/** Resolves a media `src` like a browser URL (`..` clamps at the project root); a miss returns the base-dir join. */
export function resolveProjectRelativeSrc(
  src: string,
  baseDir: string,
  compiledDir?: string,
): string {
  const cleanSrc = cleanAssetUrl(src);

  // A leading slash is an origin-root URL served from the project root, unless the absolute path exists.
  if (isAbsolute(cleanSrc) && existsSync(cleanSrc)) return cleanSrc;

  const candidates = new Set<string>();
  for (const variant of decodeUrlPathVariants(cleanSrc)) {
    for (const candidate of reanchoredCandidates(variant, baseDir, compiledDir)) {
      candidates.add(candidate);
    }
    if (compiledDir) candidates.add(join(compiledDir, variant));
    candidates.add(join(baseDir, variant));
  }
  return [...candidates].find(existsSync) ?? join(baseDir, cleanSrc);
}

function maskRange(src: string, pattern: RegExp): string {
  return src.replace(pattern, (m) => " ".repeat(m.length));
}

function maskHtmlComments(src: string): string {
  const chunks: string[] = [];
  let cursor = 0;

  while (true) {
    const start = src.indexOf("<!--", cursor);
    if (start === -1) break;
    const end = src.indexOf("-->", start + 4);
    if (end === -1) break;
    const afterComment = end + 3;
    chunks.push(src.slice(cursor, start), " ".repeat(afterComment - start));
    cursor = afterComment;
  }

  return chunks.length === 0 ? src : chunks.join("") + src.slice(cursor);
}

/** Blanks out comments, `<style>`, and `<script>` bodies so tag-scanning
 * regexes don't false-positive on commented-out or scripted markup. */
export function maskNonScannableRanges(html: string): string {
  let out = maskHtmlComments(html);
  out = maskRange(out, /<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi);
  out = maskRange(out, /<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi);
  return out;
}

export type ProjectFileRead =
  | { kind: "file"; text: string }
  | { kind: "folder" }
  | { kind: "missing" };

/** Reads through one descriptor, so the file-type check and the read see the same file. */
export function readProjectFile(path: string): ProjectFileRead {
  let fd: number;
  try {
    // Non-blocking so a named pipe is reported, not waited on; the mode never applies (no O_CREAT).
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0), 0o600);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (["EISDIR", "ENXIO"].includes(code)) return { kind: "folder" };
    if (["ENOENT", "ENOTDIR", "ELOOP", "ENAMETOOLONG"].includes(code)) return { kind: "missing" };
    throw error;
  }
  try {
    if (!fstatSync(fd).isFile()) return { kind: "folder" };
    return { kind: "file", text: readFileSync(fd, "utf-8") };
  } finally {
    closeSync(fd);
  }
}
