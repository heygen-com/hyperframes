/**
 * Audio clip metadata parsed from <audio>/<video> elements — the same
 * data-start / data-duration / data-media-start / data-volume contract the
 * producer's audioExtractor reads before building its FFmpeg filter graph.
 */
export interface AudioClip {
  src: string;
  start: number;
  /** Playback window in seconds; null = play the remainder of the file. */
  duration: number | null;
  /** Offset into the media file (trim start), in seconds. */
  mediaStart: number;
  /** Gain in [0, 1]. */
  volume: number;
}

function parseNumber(value: string | null): number | null {
  const parsed = value == null ? Number.NaN : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampVolume(value: number | null): number {
  if (value == null) return 1;
  return Math.min(1, Math.max(0, value));
}

function resolveDuration(element: Element, start: number): number | null {
  const explicit = parseNumber(element.getAttribute("data-duration"));
  if (explicit != null) return Math.max(0, explicit);
  const end = parseNumber(element.getAttribute("data-end"));
  return end != null ? Math.max(0, end - start) : null;
}

function clipFromElement(element: Element): AudioClip | null {
  const src = element.getAttribute("src");
  if (!src) return null;
  const volume = clampVolume(parseNumber(element.getAttribute("data-volume")));
  if (volume <= 0 || element.hasAttribute("muted")) return null;
  const start = Math.max(0, parseNumber(element.getAttribute("data-start")) ?? 0);
  return {
    src,
    start,
    duration: resolveDuration(element, start),
    mediaStart: Math.max(0, parseNumber(element.getAttribute("data-media-start")) ?? 0),
    volume,
  };
}

export function collectAudioClips(scope: ParentNode): AudioClip[] {
  const clips: AudioClip[] = [];
  for (const element of Array.from(scope.querySelectorAll("audio[src], video[src]"))) {
    const clip = clipFromElement(element);
    if (clip) clips.push(clip);
  }
  return clips;
}
