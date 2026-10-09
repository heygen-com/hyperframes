/**
 * Timing Compiler
 *
 * Shared, pure HTML compilation that normalizes timing attributes.
 * Works in both Node.js and browser without a DOM.
 *
 * Guarantees every timed element gets:
 * - id on media elements when missing
 * - data-end (computed from data-start + data-duration when possible)
 * - data-has-audio on <video> elements (false for muted visual-only videos)
 *
 * For elements without data-duration (e.g. videos relying on source duration),
 * this compiler identifies them as "unresolved" so the caller can provide
 * durations via an environment-specific resolver (ffprobe, el.duration, etc.)
 * and call injectDurations() to complete the compilation.
 *
 * Relative `data-start` (`intro`, `intro + 0.5`) is not numeric — leave
 * `data-end` off so extract can resolve the id-ref later.
 */

import { scanHtmlOpeningTags, decodeAuthoredAttribute } from "@hyperframes/parsers";
import { parseNumeric } from "@hyperframes/parsers/composition-contract";
import {
  parseStrictFiniteTimingNumber,
  readElementRateSpec,
  readMediaStart,
} from "../runtime/playbackRate.js";
import type { RateSpec } from "../speedRamp.js";
// ── Types ────────────────────────────────────────────────────────────────

export interface UnresolvedElement {
  id: string;
  tagName: string;
  src?: string;
  start: number;
  end?: number;
  duration?: number;
  mediaStart: number;
  playbackRate: RateSpec;
  compositionSrc?: string;
}

export interface ResolvedDuration {
  id: string;
  duration: number;
}

export interface ResolvedMediaElement {
  id: string;
  tagName: string;
  src?: string;
  start: number;
  duration: number;
  mediaStart: number;
  playbackRate: RateSpec;
  loop: boolean;
}

export interface CompilationResult {
  html: string;
  unresolved: UnresolvedElement[];
}

// ffprobe precision can differ slightly across local and CI media stacks, so
// avoid shortening authored audio for insignificant probe drift.
export const MEDIA_DURATION_CLAMP_EPSILON_SECONDS = 0.05;

export function shouldClampMediaDuration(declaredDuration: number, maxDuration: number): boolean {
  return declaredDuration > maxDuration + MEDIA_DURATION_CLAMP_EPSILON_SECONDS;
}

/**
 * Whether compilation should shorten an authored media slot to its source.
 *
 * Non-looping video intentionally keeps an explicit longer slot: browsers and
 * the render frame injector hold its final frame until that authored slot ends.
 * Audio has no frame to hold, so its slot remains bounded by playable source.
 */
export function shouldClampResolvedMediaDuration(
  tagName: ResolvedMediaElement["tagName"],
  declaredDuration: number,
  maxDuration: number,
): boolean {
  return tagName === "audio" && shouldClampMediaDuration(declaredDuration, maxDuration);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function sourceAttribute(tag: string, name: string) {
  return scanHtmlOpeningTags(tag)[0]?.attributes.find((attr) => attr.name === name);
}

function getAttr(tag: string, name: string): string | null {
  return tagAttrReader(tag).getAttribute(name);
}

function tagAttrReader(tag: string): Pick<Element, "getAttribute"> {
  const attributes = scanHtmlOpeningTags(tag)[0]?.attributes ?? [];
  return {
    getAttribute: (name) => {
      const attr = attributes.find((attr) => attr.name === name);
      return attr?.kind === "value" ? decodeAuthoredAttribute(attr.value) : null;
    },
  };
}

function hasAttr(tag: string, name: string): boolean {
  return sourceAttribute(tag, name) !== undefined;
}

function injectAttr(tag: string, attr: string, value: string): string {
  return tag.replace(/>$/, ` ${attr}="${value}">`);
}

function setAttr(tag: string, name: string, value: string): string {
  const attr = sourceAttribute(tag, name);
  if (!attr) return injectAttr(tag, name, value);
  return tag.slice(0, attr.start) + `${name}="${value}"` + tag.slice(attr.end);
}

function* iterateOpeningTags(html: string, names: readonly string[]) {
  for (const span of scanHtmlOpeningTags(html)) {
    if (span.closed && names.includes(span.name)) {
      yield { tag: html.slice(span.start, span.end), index: span.start, end: span.end };
    }
  }
}

function replaceOpeningTags(
  html: string,
  names: readonly string[],
  replace: (tag: string) => string,
): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const { tag, index, end } of iterateOpeningTags(html, names)) {
    parts.push(html.slice(cursor, index), replace(tag));
    cursor = end;
  }
  parts.push(html.slice(cursor));
  return parts.join("");
}

function replaceIdTags(html: string, id: string, replace: (tag: string) => string): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const span of scanHtmlOpeningTags(html)) {
    if (!span.closed) continue;
    const tag = html.slice(span.start, span.end);
    const attr = span.attributes.find((attr) => attr.name === "id");
    if (attr?.kind !== "value" || decodeAuthoredAttribute(attr.value) !== id) continue;
    parts.push(html.slice(cursor, span.start), replace(tag));
    cursor = span.end;
  }
  parts.push(html.slice(cursor));
  return parts.join("");
}

function withDefaultTimingAttrs(tag: string, tagName: string, generateId: () => number) {
  let result = tag;
  let id = getAttr(result, "id");
  if (!id) {
    id = `hf-${tagName}-${generateId()}`;
    result = injectAttr(result, "id", id);
  }
  let startStr = getAttr(result, "data-start");
  if (startStr === null) {
    result = injectAttr(result, "data-start", "0");
    result = injectAttr(result, "data-hf-auto-start", "");
    startStr = "0";
  }
  return { tag: result, id, start: parseNumeric(startStr) };
}

function withVideoAudioFlag(tag: string, isVideo: boolean): string {
  if (!isVideo || hasAttr(tag, "data-has-audio")) return tag;
  return injectAttr(tag, "data-has-audio", hasAttr(tag, "muted") ? "false" : "true");
}

function compileTag(
  tag: string,
  isVideo: boolean,
  generateId: () => number,
): { tag: string; unresolved: UnresolvedElement | null } {
  const tagName = isVideo ? "video" : "audio";
  const defaults = withDefaultTimingAttrs(tag, tagName, generateId);
  let result = defaults.tag;
  let unresolved: UnresolvedElement | null = null;
  const { id, start } = defaults;
  const attrReader = tagAttrReader(result);
  const mediaStart = readMediaStart(attrReader);
  const playbackRate = readElementRateSpec(attrReader);

  // 1. Compute data-end from data-start + data-duration. Skip relative id-refs.
  if (!hasAttr(result, "data-end")) {
    const durationStr = getAttr(result, "data-duration");
    const duration = parseStrictFiniteTimingNumber(durationStr);
    if (duration != null) {
      if (start != null) {
        result = injectAttr(result, "data-end", String(start + duration));
      }
    } else {
      // No data-duration: mark as unresolved so caller can provide it
      unresolved = {
        id,
        tagName,
        src: getAttr(result, "src") ?? undefined,
        start: start ?? 0,
        mediaStart,
        playbackRate,
      };
    }
  }

  result = withVideoAudioFlag(result, isVideo);

  return { tag: result, unresolved };
}

/**
 * Compile timing attributes in HTML.
 *
 * Phase 1 (static): Adds data-end where data-duration exists,
 * adds data-has-audio on videos.
 *
 * Returns the compiled HTML and a list of elements that could not be
 * resolved statically (missing data-duration). The caller should resolve
 * these via ffprobe / el.duration and call injectDurations().
 */
export function compileTimingAttrs(html: string): CompilationResult {
  const unresolved: UnresolvedElement[] = [];
  let nextVideoId = 0;
  let nextAudioId = 0;

  // Process <video ...> tags
  html = replaceOpeningTags(html, ["video"], (match) => {
    const { tag, unresolved: u } = compileTag(match, true, () => nextVideoId++);
    if (u) unresolved.push(u);
    return tag;
  });

  // Process <audio ...> tags
  html = replaceOpeningTags(html, ["audio"], (match) => {
    const { tag, unresolved: u } = compileTag(match, false, () => nextAudioId++);
    if (u) unresolved.push(u);
    return tag;
  });

  // Identify unresolved timed elements (divs with data-start but no data-end/data-duration)
  // These are typically compositions whose duration depends on GSAP timelines
  for (const { tag: match } of iterateOpeningTags(html, ["div", "section"])) {
    if (!hasAttr(match, "data-start")) continue;
    if (hasAttr(match, "data-end") || hasAttr(match, "data-duration")) continue;

    const id = getAttr(match, "id");
    const compositionSrc = getAttr(match, "data-composition-src");
    if (id) {
      const startStr = getAttr(match, "data-start");
      unresolved.push({
        id,
        tagName: "div",
        start: parseNumeric(startStr) ?? 0,
        mediaStart: 0,
        playbackRate: 1,
        compositionSrc: compositionSrc ?? undefined,
      });
    }
  }

  return { html, unresolved };
}

/**
 * Inject resolved durations into compiled HTML.
 *
 * For each resolved element, adds data-duration and data-end attributes.
 * Call this after resolving durations via ffprobe, el.duration, or
 * GSAP timeline queries.
 */
export function injectDurations(html: string, resolutions: ResolvedDuration[]): string {
  for (const { id, duration } of resolutions) {
    // Match the element's opening tag by id
    html = replaceIdTags(html, id, (tag) => {
      let result = tag;

      // Add data-duration if missing
      if (parseStrictFiniteTimingNumber(getAttr(result, "data-duration")) == null) {
        result = setAttr(result, "data-duration", String(duration));
      }

      // Add data-end if missing. Skip relative id-refs.
      if (!hasAttr(result, "data-end")) {
        const start = parseNumeric(getAttr(result, "data-start"));
        if (start != null) {
          result = injectAttr(result, "data-end", String(start + duration));
        }
      }

      return result;
    });
  }

  return html;
}

/**
 * Extract video/audio elements that already have data-duration set.
 * Used by callers to validate declared durations against actual source durations.
 */
export function extractResolvedMedia(html: string): ResolvedMediaElement[] {
  const resolved: ResolvedMediaElement[] = [];

  for (const { tag } of iterateOpeningTags(html, ["video", "audio"])) {
    const id = getAttr(tag, "id");
    const durationStr = getAttr(tag, "data-duration");
    if (!id || durationStr === null) continue;

    const duration = parseStrictFiniteTimingNumber(durationStr);
    if (duration == null || duration <= 0) continue;

    const isVideo = /^<video/i.test(tag);
    const startStr = getAttr(tag, "data-start");
    const attrReader = tagAttrReader(tag);

    resolved.push({
      id,
      tagName: isVideo ? "video" : "audio",
      src: getAttr(tag, "src") ?? undefined,
      start: parseNumeric(startStr) ?? 0,
      duration,
      mediaStart: readMediaStart(attrReader),
      playbackRate: readElementRateSpec(attrReader),
      loop: hasAttr(tag, "loop"),
    });
  }

  return resolved;
}

/**
 * Clamp existing data-duration and data-end on media elements.
 * For each resolution, replaces the declared duration with the clamped value
 * and recomputes data-end accordingly.
 */
export function clampDurations(html: string, clamps: ResolvedDuration[]): string {
  for (const { id, duration } of clamps) {
    html = replaceIdTags(html, id, (tag) => {
      // Replace data-duration value
      if (hasAttr(tag, "data-duration")) tag = setAttr(tag, "data-duration", String(duration));

      const start = parseNumeric(getAttr(tag, "data-start"));
      if (start != null && hasAttr(tag, "data-end")) {
        tag = setAttr(tag, "data-end", String(start + duration));
      }

      return tag;
    });
  }

  return html;
}
