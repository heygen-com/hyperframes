/**
 * Timing Compiler
 *
 * Shared, pure HTML compilation that normalizes timing attributes.
 * Works in both Node.js and browser (regex-based, no DOM).
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

import { parseNumeric } from "@hyperframes/parsers/composition-contract";
import {
  parseStrictFiniteTimingNumber,
  readElementPlaybackRate,
  readMediaStart,
} from "../runtime/playbackRate.js";
// ── Types ────────────────────────────────────────────────────────────────

export interface UnresolvedElement {
  id: string;
  tagName: string;
  src?: string;
  start: number;
  end?: number;
  duration?: number;
  mediaStart: number;
  playbackRate: number;
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
  playbackRate: number;
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

function getAttr(tag: string, attr: string): string | null {
  // `(?<![\w-])` anchors the attribute name to a fresh start. Without it,
  // `getAttr(tag, "id")` matches the trailing `id="…"` inside `data-hf-id="…"`
  // (and "src" inside `data-src`, etc.) and returns a phantom value. That bug
  // made compileTag believe a Studio-stamped `data-hf-id`-only element already
  // had an `id`, so it skipped its `hf-video-N` injection — leaving the element
  // with no real `el.id`, which the render pipeline keys off of (blank wash).
  const match = tag.match(new RegExp(`(?<![\\w-])${attr}=["']([^"']+)["']`));
  return match ? (match[1] ?? null) : null;
}

function hasAttr(tag: string, attr: string): boolean {
  return new RegExp(`\\s${attr}(?:\\s|=|>|/)`).test(tag);
}

function injectAttr(tag: string, attr: string, value: string): string {
  return tag.replace(/>$/, ` ${attr}="${value}">`);
}

function setAttr(tag: string, attr: string, value: string): string {
  if (!hasAttr(tag, attr)) return injectAttr(tag, attr, value);
  return tag.replace(new RegExp(`(${attr}=["'])[^"']*(["'])`), `$1${value}$2`);
}

// Real media/timing elements never live inside comments, <script>, or <style>.
// The tag regexes below aren't comment-aware, so a comment that merely mentions
// `<video>`/`<audio>` gets rewritten as if it were a real element (issue #1938).
// Mask those inert regions with placeholders (no `<`, so the tag regexes skip
// them) before scanning, then restore them verbatim.
// The NUL delimiters must stay as \u0000 escapes: raw 0x00 bytes make this file
// binary to git and are corrupted by Bun's transpiler when bundled (issue #2139).
function maskInertRegions(html: string): { masked: string; restore: (s: string) => string } {
  const stash: string[] = [];
  const parts: string[] = [];
  const opening = /<!--|<script\b|<style\b/gi;
  const closings = new Map([
    ["<!--", /--!?>/g],
    ["<script", /<\/script\s*>/gi],
    ["<style", /<\/style\s*>/gi],
  ]);
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(html)) !== null) {
    const kind = match[0].toLowerCase();
    const closing = closings.get(kind);
    if (!closing) continue;
    closing.lastIndex = opening.lastIndex;
    const end = closing.exec(html) ? closing.lastIndex : -1;
    if (end < 0) {
      // No later opener of this kind can close either. Search each unmatched
      // suffix only once, while still allowing other kinds of inert regions.
      closings.delete(kind);
      continue;
    }
    const token = `\u0000HFMASK${stash.length}\u0000`;
    parts.push(html.slice(cursor, match.index), token);
    stash.push(html.slice(match.index, end));
    cursor = end;
    opening.lastIndex = cursor;
  }
  parts.push(html.slice(cursor));
  const masked = parts.join("");
  const restore = (s: string): string =>
    // oxlint-disable-next-line no-control-regex -- NUL cannot appear in HTML, which is what makes it a safe mask delimiter
    s.replace(/\u0000HFMASK(\d+)\u0000/g, (_, i) => stash[Number(i)] ?? "");
  return { masked, restore };
}

// ── Core compilation ─────────────────────────────────────────────────────

function* iterateOpeningTags(html: string, prefix: RegExp) {
  let match: RegExpExecArray | null;
  while ((match = prefix.exec(html)) !== null) {
    const closing = html.indexOf(">", prefix.lastIndex);
    // Without a closer, no later prefix can form a complete tag either.
    if (closing < 0) break;
    const end = closing + 1;
    yield { tag: html.slice(match.index, end), index: match.index, end };
    prefix.lastIndex = end;
  }
}

function replaceOpeningTags(
  html: string,
  prefix: RegExp,
  replace: (tag: string) => string,
): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const { tag, index, end } of iterateOpeningTags(html, prefix)) {
    parts.push(html.slice(cursor, index), replace(tag));
    cursor = end;
  }
  parts.push(html.slice(cursor));
  return parts.join("");
}

function replaceIdTags(html: string, id: string, replace: (tag: string) => string): string {
  const idPattern = new RegExp(`id=["']${escapeRegex(id)}["']`, "gi");
  const lastClosing = html.lastIndexOf(">");
  const parts: string[] = [];
  let cursor = 0;
  let candidate = idPattern.exec(html);
  for (const { index, end } of iterateOpeningTags(html, /</g)) {
    if (index < cursor) continue;
    let targetEnd = -1;
    while (candidate && candidate.index < end) {
      const candidateEnd = candidate.index + candidate[0].length;
      if (candidate.index > index && candidateEnd <= lastClosing) targetEnd = candidateEnd;
      // Preserve the old greedy prefix's last matching ID, including overlaps.
      idPattern.lastIndex = candidate.index + 1;
      candidate = idPattern.exec(html);
    }
    if (targetEnd < 0) continue;
    // An authored ID can itself contain '>', so its closer may follow the
    // initial span. The lastClosing check guarantees a closing delimiter.
    const closing = html.indexOf(">", targetEnd) + 1;
    parts.push(html.slice(cursor, index), replace(html.slice(index, closing)));
    cursor = closing;
  }
  parts.push(html.slice(cursor));
  return parts.join("");
}

function compileTag(
  tag: string,
  isVideo: boolean,
  generateId: () => number,
): { tag: string; unresolved: UnresolvedElement | null } {
  let result = tag;
  let unresolved: UnresolvedElement | null = null;

  let id = getAttr(result, "id");
  if (!id) {
    id = `${isVideo ? "hf-video" : "hf-audio"}-${generateId()}`;
    result = injectAttr(result, "id", id);
  }
  let startStr = getAttr(result, "data-start");
  if (startStr === null) {
    result = injectAttr(result, "data-start", "0");
    result = injectAttr(result, "data-hf-auto-start", "");
    startStr = "0";
  }
  const start = parseNumeric(startStr);
  const attrReader = { getAttribute: (name: string) => getAttr(result, name) };
  const mediaStart = readMediaStart(attrReader);
  const playbackRate = readElementPlaybackRate(attrReader);

  // 1. Compute data-end from data-start + data-duration. Skip relative id-refs.
  if (!hasAttr(result, "data-end")) {
    const durationStr = getAttr(result, "data-duration");
    const duration = parseStrictFiniteTimingNumber(durationStr);
    if (duration != null) {
      if (start != null) {
        result = injectAttr(result, "data-end", String(start + duration));
      }
    } else if (id) {
      // No data-duration: mark as unresolved so caller can provide it
      unresolved = {
        id,
        tagName: isVideo ? "video" : "audio",
        src: getAttr(result, "src") ?? undefined,
        start: start ?? 0,
        mediaStart,
        playbackRate,
      };
    }
  }

  // 2. Add data-has-audio to <video> elements. Muted videos are visual-only by
  // contract; audible media should be represented by either an unmuted video
  // with data-has-audio="true" or a separate <audio> element.
  if (isVideo && !hasAttr(result, "data-has-audio")) {
    result = injectAttr(result, "data-has-audio", hasAttr(result, "muted") ? "false" : "true");
  }

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

  const { masked, restore } = maskInertRegions(html);
  html = masked;

  // Process <video ...> tags
  html = replaceOpeningTags(html, /<video/gi, (match) => {
    const { tag, unresolved: u } = compileTag(match, true, () => nextVideoId++);
    if (u) unresolved.push(u);
    return tag;
  });

  // Process <audio ...> tags
  html = replaceOpeningTags(html, /<audio/gi, (match) => {
    const { tag, unresolved: u } = compileTag(match, false, () => nextAudioId++);
    if (u) unresolved.push(u);
    return tag;
  });

  // Identify unresolved timed elements (divs with data-start but no data-end/data-duration)
  // These are typically compositions whose duration depends on GSAP timelines
  for (const { tag: match } of iterateOpeningTags(html, /<(?:div|section)/gi)) {
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

  return { html: restore(html), unresolved };
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract video/audio elements that already have data-duration set.
 * Used by callers to validate declared durations against actual source durations.
 */
export function extractResolvedMedia(html: string): ResolvedMediaElement[] {
  const resolved: ResolvedMediaElement[] = [];

  html = maskInertRegions(html).masked;
  for (const { tag } of iterateOpeningTags(html, /<(?:video|audio)/gi)) {
    const id = getAttr(tag, "id");
    const durationStr = getAttr(tag, "data-duration");
    if (!id || durationStr === null) continue;

    const duration = parseStrictFiniteTimingNumber(durationStr);
    if (duration == null || duration <= 0) continue;

    const isVideo = /^<video/i.test(tag);
    const startStr = getAttr(tag, "data-start");
    const attrReader = { getAttribute: (name: string) => getAttr(tag, name) };

    resolved.push({
      id,
      tagName: isVideo ? "video" : "audio",
      src: getAttr(tag, "src") ?? undefined,
      start: parseNumeric(startStr) ?? 0,
      duration,
      mediaStart: readMediaStart(attrReader),
      playbackRate: readElementPlaybackRate(attrReader),
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
      tag = tag.replace(/data-duration=["'][^"']*["']/, `data-duration="${duration}"`);

      const start = parseNumeric(getAttr(tag, "data-start"));
      if (start != null) {
        tag = tag.replace(/data-end=["'][^"']*["']/, `data-end="${start + duration}"`);
      }

      return tag;
    });
  }

  return html;
}
