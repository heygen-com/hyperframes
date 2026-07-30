import { existsSync } from "node:fs";
import { isAbsolute, posix, relative, resolve } from "node:path";
import { decodeUrlPathVariants } from "./composition.js";

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
 * splits on `?`/`#`, which also chops inside a `${...}` expression. (The older
 * `__UPPER__` placeholder shape predates this and keeps its own inline check at
 * each call site.)
 */
export function hasUnresolvedTemplatingToken(url: string): boolean {
  return /<<[^<>]+>>|\{\{[^{}]+\}\}|\$\{[^{}]+\}/.test(url);
}

export function cleanAssetUrl(url: string): string {
  return url.trim().split(/[?#]/, 1)[0] ?? "";
}

export function isWithinProjectRoot(projectDir: string, candidate: string): boolean {
  const projectRoot = resolve(projectDir);
  const relativePath = relative(projectRoot, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
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
    if (clamped && !clamped.startsWith("..")) {
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
