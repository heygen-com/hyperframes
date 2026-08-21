import type { TimelineElement } from "../player";

const AUDIO_TIMELINE_TAGS = new Set(["audio", "music", "sfx", "sound", "narration"]);
const AUDIO_SOURCE_EXT_RE = /\.(aac|flac|m4a|mp3|ogg|opus|wav)(?:[?#].*)?$/i;
const MUSIC_ID_RE = /\b(music|bgm|soundtrack|background[-_]?music)\b/i;

export function isAudioTimelineElement(
  element: Pick<TimelineElement, "tag" | "src"> | null | undefined,
): boolean {
  if (!element) return false;
  const tag = element.tag.trim().toLowerCase();
  if (AUDIO_TIMELINE_TAGS.has(tag)) return true;
  return Boolean(element.src && AUDIO_SOURCE_EXT_RE.test(element.src));
}

/** True for the music track: an audio element with data-timeline-role="music",
 *  or — when no role is set — an id matching the music regex. Voiceover/other
 *  audio (explicit non-music role) is excluded. */
export function isMusicTrack(
  element:
    | Pick<TimelineElement, "tag" | "src" | "id" | "domId" | "timelineRole">
    | null
    | undefined,
): boolean {
  if (!element) return false;
  if (!isAudioTimelineElement(element)) return false;
  if (element.timelineRole === "music") return true;
  if (element.timelineRole && element.timelineRole !== "music") return false;
  const id = element.domId ?? element.id ?? "";
  return MUSIC_ID_RE.test(id);
}

/**
 * Resolve the best audio source for beat analysis. An explicitly tagged or
 * named music track wins; when none is present (e.g. an audio file dropped
 * from Finder with a generic id), the LONGEST untagged audio clip is used as a
 * fallback. Ties on duration resolve to the FIRST such clip encountered (the loop
 * keeps the current best on `>` only), i.e. discovery/DOM order wins.
 * Returns the element and whether it was found via the fallback path.
 *
 * The `isMusicTrack` predicate is unchanged so beat-snap and drag-exclusion
 * logic remain unaffected by this fallback.
 */
export function resolveBeatSourceTrack(
  elements: readonly Pick<
    TimelineElement,
    "tag" | "src" | "id" | "domId" | "timelineRole" | "duration"
  >[],
): { element: (typeof elements)[number]; isFallback: boolean } | null {
  const explicit = elements.find(isMusicTrack);
  if (explicit) return { element: explicit, isFallback: false };

  // Fallback: pick the longest audio clip (skipping explicitly non-music roles
  // like "sfx" or "voiceover" to avoid triggering beat analysis on those).
  let best: (typeof elements)[number] | null = null;
  for (const el of elements) {
    if (!isAudioTimelineElement(el)) continue;
    if (el.timelineRole && el.timelineRole !== "music") continue;
    if (!best || el.duration > best.duration) best = el;
  }
  return best ? { element: best, isFallback: true } : null;
}
