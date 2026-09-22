import type { TimelineElement } from "../store/timelineElement";

function mediaFileKey(src: string | undefined): string | null {
  if (!src) return null;
  const path = src.split(/[?#]/, 1)[0] ?? "";
  const segment = path.split(/[/\\]/).pop()?.trim().toLowerCase() ?? "";
  return segment.length > 0 ? segment : null;
}

export function audioPillFlags(
  audio: Pick<TimelineElement, "id" | "tag" | "src" | "hidden" | "audioGroupHidden">,
  elements: readonly Pick<TimelineElement, "id" | "tag" | "src">[],
): { muted: boolean; linked: boolean } {
  return {
    muted: audio.hidden === true || audio.audioGroupHidden === true,
    linked: isLinkedVideoAudio(audio, elements),
  };
}

/** An audio pill whose file is also a video clip on this timeline. */
export function isLinkedVideoAudio(
  audio: Pick<TimelineElement, "id" | "tag" | "src">,
  elements: readonly Pick<TimelineElement, "id" | "tag" | "src">[],
): boolean {
  if (audio.tag.trim().toLowerCase() !== "audio") return false;
  const key = mediaFileKey(audio.src);
  if (!key) return false;
  return elements.some((element) => {
    if (element.id === audio.id) return false;
    if (element.tag.trim().toLowerCase() !== "video") return false;
    return mediaFileKey(element.src) === key;
  });
}
