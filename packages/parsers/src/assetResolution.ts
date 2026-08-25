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

/** `data-composition-src="..."`, matched within a single already-delimited tag. */
const COMPOSITION_SRC_ATTR = /\bdata-composition-src\s*=\s*["']([^"']+)["']/i;

/**
 * Every `data-composition-src` reference in one composition file's raw text, in
 * document order, deduped. The single owner of "which sub-compositions does
 * this file mount", so lint, telemetry, and any future scanner cannot drift
 * apart on the answer.
 *
 * Text-scanning rather than DOM-walking, and that is the load-bearing choice.
 * Every sub-composition except the render entry is authored inside a
 * `<template>` (the root index.html is forbidden from using that wrapper;
 * everything else prefers it). Template content is inert: it lives under
 * `template.content`, not the live document, so `document.querySelectorAll`
 * on a raw sub-composition file finds nothing and every nested reference
 * disappears. The renderer only gets away with a DOM scan because it recurses
 * on COMPILED html, where the wrapper is already gone.
 *
 * Callers must resolve each value against the PROJECT ROOT, never the
 * referencing file's directory: `data-composition-src` is root-relative at
 * every nesting level (see `parseSubCompositions` in htmlCompiler.ts).
 *
 * Comments, `<style>`, and `<script>` bodies are masked first so a
 * commented-out mount is not counted as a real one. Build-time placeholders and
 * remote or inline URLs are dropped: neither names a file on disk, and every
 * caller resolves what comes back against the project root.
 *
 * The scan walks tag by tag with `indexOf` rather than running one regex with
 * two open-ended `[^>]*` spans across the whole file. That shape is quadratic:
 * on input full of `<` with no `>`, every `<` starts a scan to end-of-string
 * that then backtracks, measured at 41ms / 165ms / 660ms / 2640ms for 10k /
 * 20k / 40k / 80k characters. This function runs on every render (via the
 * render plan), so a truncated download or a blob full of stray `<` would hang
 * the plan step before any video is produced. Bounding each regex to one
 * already-delimited tag makes the whole scan linear.
 */
export function collectSubCompositionSrcs(html: string): string[] {
  const scannable = maskNonScannableRanges(html);
  const srcs: string[] = [];
  const seen = new Set<string>();

  let cursor = 0;
  while (cursor < scannable.length) {
    const open = scannable.indexOf("<", cursor);
    if (open === -1) break;
    const close = scannable.indexOf(">", open + 1);
    // An unterminated final tag is not a tag. The previous whole-file regex
    // also required a closing `>`, so this drops nothing it used to find.
    if (close === -1) break;
    cursor = close + 1;

    const match = COMPOSITION_SRC_ATTR.exec(scannable.slice(open, cursor));
    if (!match) continue;
    const src = (match[1] ?? "").trim();
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
