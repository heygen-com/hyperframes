import type { TimelineElement } from "../player";

const AUDIO_TIMELINE_TAGS = new Set(["audio", "music", "sfx", "sound", "narration"]);
const AUDIO_SOURCE_EXT_RE = /\.(aac|flac|m4a|mp3|ogg|opus|wav)(?:[?#].*)?$/i;
const MUSIC_ID_RE = /\b(music|bgm|soundtrack|background[-_]?music)\b/i;

function isAudioTimelineElement(
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
