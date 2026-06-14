/**
 * Timing Compiler
 *
 * Shared, pure HTML compilation that normalizes timing attributes.
 * Works in both Node.js and browser (no dependencies, regex-based).
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
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface UnresolvedElement {
  id: string;
  tagName: string;
  src?: string;
  start: number;
  end?: number;
  duration?: number;
  mediaStart: number;
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
  loop: boolean;
}

export interface CompilationResult {
  html: string;
  unresolved: UnresolvedElement[];
}

// ffprobe precision can differ slightly across local and CI media stacks.
const MEDIA_DURATION_CLAMP_EPSILON_SECONDS = 0.05;

export function shouldClampMediaDuration(declaredDuration: number, maxDuration: number): boolean {
  return declaredDuration > maxDuration + MEDIA_DURATION_CLAMP_EPSILON_SECONDS;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function getAttr(tag: string, attr: string): string | null {
  const match = tag.match(new RegExp(`${attr}=["']([^"']+)["']`));
  return match ? (match[1] ?? null) : null;
}

function hasAttr(tag: string, attr: string): boolean {
  return new RegExp(`\\s${attr}(?:\\s|=|>|/)`).test(tag);
}

function injectAttr(tag: string, attr: string, value: string): string {
  return tag.replace(/>$/, ` ${attr}="${value}">`);
}

/**
 * Parse a timing attribute (data-start, data-end, data-media-start),
 * treating unparsable values as `fallback`. Without the guard a typo like
 * data-start="abc" flows through as NaN and is serialized back into the
 * compiled HTML as data-end="NaN", which the parser then turns into a NaN
 * duration. Same policy extractResolvedMedia already applies to
 * data-duration.
 */
export function parseTimingAttr(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ── Core compilation ─────────────────────────────────────────────────────

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
  let start = parseFloat(startStr);
  if (!Number.isFinite(start)) {
    // Unparsable data-start: normalize the attribute to 0 in the output so
    // downstream consumers (parser, runtime) never see the garbage value.
    result = result.replace(/data-start=["'][^"']*["']/, 'data-start="0"');
    start = 0;
  }
  const mediaStart = parseTimingAttr(getAttr(result, "data-media-start"), 0);

  // Strip an unparsable data-end so the normal missing-data-end flow below
  // recomputes or resolves it instead of leaving the garbage value in place.
  // Single \s (not \s*): the attribute always has whitespace before it
  // inside a tag, and an unbounded prefix backtracks polynomially on
  // attacker-controlled input (CodeQL js/polynomial-redos).
  const dataEndStr = getAttr(result, "data-end");
  if (dataEndStr !== null && !Number.isFinite(parseFloat(dataEndStr))) {
    result = result.replace(/\sdata-end=["'][^"']*["']/, "");
  }

  // 1. Compute data-end from data-start + data-duration
  if (!hasAttr(result, "data-end")) {
    const durationStr = getAttr(result, "data-duration");
    const duration = durationStr !== null ? parseFloat(durationStr) : NaN;
    if (durationStr !== null && !Number.isFinite(duration)) {
      // Unparsable data-duration: drop it and fall through to the
      // unresolved path so the caller's resolver supplies the real one.
      // Single \s for the same reason as the data-end strip above.
      result = result.replace(/\sdata-duration=["'][^"']*["']/, "");
    }
    if (Number.isFinite(duration)) {
      const end = start + duration;
      result = injectAttr(result, "data-end", String(end));
    } else if (id) {
      // No data-duration: mark as unresolved so caller can provide it
      unresolved = {
        id,
        tagName: isVideo ? "video" : "audio",
        src: getAttr(result, "src") ?? undefined,
        start,
        mediaStart,
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

  // Process <video ...> tags
  html = html.replace(/<video[^>]*>/gi, (match) => {
    const { tag, unresolved: u } = compileTag(match, true, () => nextVideoId++);
    if (u) unresolved.push(u);
    return tag;
  });

  // Process <audio ...> tags
  html = html.replace(/<audio[^>]*>/gi, (match) => {
    const { tag, unresolved: u } = compileTag(match, false, () => nextAudioId++);
    if (u) unresolved.push(u);
    return tag;
  });

  // Identify unresolved timed elements (divs with data-start but no data-end/data-duration)
  // These are typically compositions whose duration depends on GSAP timelines
  html.replace(/<(?:div|section)[^>]*>/gi, (match) => {
    if (!hasAttr(match, "data-start")) return match;
    if (hasAttr(match, "data-end") || hasAttr(match, "data-duration")) return match;

    const id = getAttr(match, "id");
    const compositionSrc = getAttr(match, "data-composition-src");
    if (id) {
      const startStr = getAttr(match, "data-start");
      unresolved.push({
        id,
        tagName: "div",
        start: parseTimingAttr(startStr, 0),
        mediaStart: 0,
        compositionSrc: compositionSrc ?? undefined,
      });
    }

    return match;
  });

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
    const idPattern = new RegExp(`(<[^>]*id=["']${escapeRegex(id)}["'][^>]*>)`, "gi");

    html = html.replace(idPattern, (tag) => {
      let result = tag;

      // Add data-duration if missing
      if (!hasAttr(result, "data-duration")) {
        result = injectAttr(result, "data-duration", String(duration));
      }

      // Add data-end if missing
      if (!hasAttr(result, "data-end")) {
        const start = parseTimingAttr(getAttr(result, "data-start"), 0);
        result = injectAttr(result, "data-end", String(start + duration));
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

  const mediaRegex = /<(?:video|audio)[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = mediaRegex.exec(html)) !== null) {
    const tag = match[0];
    const id = getAttr(tag, "id");
    const durationStr = getAttr(tag, "data-duration");
    if (!id || durationStr === null) continue;

    const duration = parseFloat(durationStr);
    if (!Number.isFinite(duration) || duration <= 0) continue;

    const isVideo = /^<video/i.test(tag);
    const startStr = getAttr(tag, "data-start");
    const mediaStartStr = getAttr(tag, "data-media-start");

    resolved.push({
      id,
      tagName: isVideo ? "video" : "audio",
      src: getAttr(tag, "src") ?? undefined,
      start: parseTimingAttr(startStr, 0),
      duration,
      mediaStart: parseTimingAttr(mediaStartStr, 0),
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
    const idPattern = new RegExp(`(<[^>]*id=["']${escapeRegex(id)}["'][^>]*>)`, "gi");

    html = html.replace(idPattern, (tag) => {
      // Replace data-duration value
      tag = tag.replace(/data-duration=["'][^"']*["']/, `data-duration="${duration}"`);

      // Recompute data-end from data-start + clamped duration
      const start = parseTimingAttr(getAttr(tag, "data-start"), 0);
      tag = tag.replace(/data-end=["'][^"']*["']/, `data-end="${start + duration}"`);

      return tag;
    });
  }

  return html;
}
