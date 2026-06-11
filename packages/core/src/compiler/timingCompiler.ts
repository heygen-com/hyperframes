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
const DUCK_KEYFRAMES_ATTR = "data-hf-duck-keyframes";
const DEFAULT_DUCK_FADE_SECONDS = 0.3;

interface Interval {
  start: number;
  end: number;
}

interface MediaTimingClip extends Interval {
  id: string;
  volume: number;
  muted: boolean;
  hasAudio: boolean;
  role: string | null;
  duckGain: number | null;
  duckFade: number;
}

export function shouldClampMediaDuration(declaredDuration: number, maxDuration: number): boolean {
  return declaredDuration > maxDuration + MEDIA_DURATION_CLAMP_EPSILON_SECONDS;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function getAttr(tag: string, attr: string): string | null {
  const match = tag.match(new RegExp(`(?:^|\\s)${attr}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match ? (match[2] ?? null) : null;
}

function hasAttr(tag: string, attr: string): boolean {
  return new RegExp(`\\s${attr}(?:\\s|=|>|/)`).test(tag);
}

function injectAttr(tag: string, attr: string, value: string): string {
  return tag.replace(/>$/, ` ${attr}="${value}">`);
}

function setAttr(tag: string, attr: string, value: string): string {
  const serialized = value.replace(/'/g, "&#39;");
  const pattern = new RegExp(`(\\s${attr}\\s*=\\s*)(["'])(.*?)\\2`, "i");
  if (pattern.test(tag)) {
    return tag.replace(pattern, (_match, prefix: string) => `${prefix}'${serialized}'`);
  }
  return tag.replace(/>$/, ` ${attr}='${serialized}'>`);
}

function removeAttr(tag: string, attr: string): string {
  return tag.replace(new RegExp(`\\s${attr}(?:\\s*=\\s*(["']).*?\\1)?`, "i"), "");
}

function parseFiniteNumber(raw: string | null): number | null {
  if (raw === null) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSeconds(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const value = raw.trim().toLowerCase().endsWith("s") ? raw.trim().slice(0, -1) : raw;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.max(0, Math.min(1, volume));
}

function parseDuckGain(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.endsWith("db")) {
    const db = Number.parseFloat(trimmed.slice(0, -2));
    return Number.isFinite(db) ? Math.pow(10, db / 20) : null;
  }
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value)) return null;
  return value < 0 ? Math.pow(10, value / 20) : value;
}

function clipEndFromAttrs(tag: string, start: number): number | null {
  const end = parseFiniteNumber(getAttr(tag, "data-end"));
  if (end !== null) return end;
  const duration = parseFiniteNumber(getAttr(tag, "data-duration"));
  return duration !== null ? start + duration : null;
}

function readMediaTimingClip(tag: string): MediaTimingClip | null {
  const id = getAttr(tag, "id");
  if (!id) return null;
  const start = parseFiniteNumber(getAttr(tag, "data-start"));
  if (start === null) return null;
  const end = clipEndFromAttrs(tag, start);
  if (end === null || end <= start) return null;

  const tagMatch = tag.match(/^<(audio|video)\b/i);
  const tagName = tagMatch?.[1]?.toLowerCase();
  if (tagName !== "audio" && tagName !== "video") return null;

  const volume = clampVolume(parseFiniteNumber(getAttr(tag, "data-volume")) ?? 1);
  const muted = hasAttr(tag, "muted");
  const hasAudio = tagName === "audio" || getAttr(tag, "data-has-audio") === "true";
  const role = getAttr(tag, "data-role")?.trim().toLowerCase() ?? null;
  const duckGain = parseDuckGain(getAttr(tag, "data-duck"));

  return {
    id,
    start,
    end,
    volume,
    muted,
    hasAudio,
    role,
    duckGain,
    duckFade: parseSeconds(getAttr(tag, "data-duck-fade"), DEFAULT_DUCK_FADE_SECONDS),
  };
}

function isAudibleClip(clip: MediaTimingClip): boolean {
  return clip.hasAudio && !clip.muted && clip.volume > 0;
}

function mergeIntervals(intervals: Interval[], maxGap: number): Interval[] {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end + maxGap) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function intersectIntervals(track: Interval, intervals: Interval[]): Interval[] {
  const overlaps: Interval[] = [];
  for (const interval of intervals) {
    const start = Math.max(track.start, interval.start);
    const end = Math.min(track.end, interval.end);
    if (end > start) overlaps.push({ start, end });
  }
  return overlaps;
}

function roundedKeyframe(time: number, volume: number): { time: number; volume: number } {
  return {
    time: Number(time.toFixed(6)),
    volume: Number(clampVolume(volume).toFixed(6)),
  };
}

function createDuckKeyframes(
  track: MediaTimingClip,
  voiceIntervals: Interval[],
): { time: number; volume: number }[] {
  if (track.duckGain === null) return [];
  const duckVolume = clampVolume(track.volume * track.duckGain);
  if (duckVolume >= track.volume - 0.000001) return [];

  const overlaps = mergeIntervals(intersectIntervals(track, voiceIntervals), track.duckFade * 2);
  const keyframes: { time: number; volume: number }[] = [];
  const add = (time: number, volume: number) => {
    const point = roundedKeyframe(time, volume);
    const previous = keyframes.at(-1);
    if (previous && Math.abs(previous.time - point.time) < 0.000001) {
      previous.volume = point.volume;
    } else {
      keyframes.push(point);
    }
  };

  for (const overlap of overlaps) {
    const duration = overlap.end - overlap.start;
    const fade = Math.min(track.duckFade, duration / 2);
    const rampStart = Math.max(track.start, overlap.start - fade);
    const rampEnd = Math.min(track.end, overlap.end + fade);

    if (rampStart < overlap.start) add(rampStart, track.volume);
    add(overlap.start, duckVolume);
    add(overlap.end, duckVolume);
    if (rampEnd > overlap.end) add(rampEnd, track.volume);
  }

  return keyframes;
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
  const start = parseFloat(startStr);
  const mediaStartStr = getAttr(result, "data-media-start");
  const mediaStart = mediaStartStr ? parseFloat(mediaStartStr) : 0;

  // 1. Compute data-end from data-start + data-duration
  if (!hasAttr(result, "data-end")) {
    const durationStr = getAttr(result, "data-duration");
    if (durationStr !== null) {
      const end = start + parseFloat(durationStr);
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
        start: startStr ? parseFloat(startStr) : 0,
        mediaStart: 0,
        compositionSrc: compositionSrc ?? undefined,
      });
    }

    return match;
  });

  return { html, unresolved };
}

/**
 * Compile declarative audio ducking into an internal volume multiplier envelope.
 *
 * `data-duck` stays authored source-of-truth. The generated
 * `data-hf-duck-keyframes` attribute is intentionally internal so repeated
 * compilation can replace it without multiplying the duck curve twice.
 */
export function compileAudioDucking(html: string): string {
  const mediaTags = Array.from(html.matchAll(/<(?:audio|video)\b[^>]*>/gi), (match) => match[0]);
  const clips = mediaTags
    .map((tag) => readMediaTimingClip(tag))
    .filter((clip): clip is MediaTimingClip => clip !== null);
  const voiceIntervals = mergeIntervals(
    clips
      .filter((clip) => clip.role === "voice" && isAudibleClip(clip))
      .map((clip) => ({ start: clip.start, end: clip.end })),
    0,
  );

  const duckKeyframesById = new Map<string, { time: number; volume: number }[]>();
  for (const clip of clips) {
    if (clip.duckGain === null || !isAudibleClip(clip)) continue;
    const keyframes = createDuckKeyframes(clip, voiceIntervals);
    if (keyframes.length > 0) duckKeyframesById.set(clip.id, keyframes);
  }

  return html.replace(/<(?:audio|video)\b[^>]*>/gi, (tag) => {
    const id = getAttr(tag, "id");
    const keyframes = id ? duckKeyframesById.get(id) : undefined;
    if (keyframes && keyframes.length > 0) {
      return setAttr(tag, DUCK_KEYFRAMES_ATTR, JSON.stringify(keyframes));
    }
    return hasAttr(tag, DUCK_KEYFRAMES_ATTR) ? removeAttr(tag, DUCK_KEYFRAMES_ATTR) : tag;
  });
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
        const startStr = getAttr(result, "data-start");
        const start = startStr ? parseFloat(startStr) : 0;
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
      start: startStr !== null ? parseFloat(startStr) : 0,
      duration,
      mediaStart: mediaStartStr ? parseFloat(mediaStartStr) : 0,
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
      const startStr = getAttr(tag, "data-start");
      const start = startStr ? parseFloat(startStr) : 0;
      tag = tag.replace(/data-end=["'][^"']*["']/, `data-end="${start + duration}"`);

      return tag;
    });
  }

  return html;
}
