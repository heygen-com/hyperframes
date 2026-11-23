/** A page decodes a whole audio file only up to ten minutes (~230 MB decoded): an hour is ~1.4 GB and kills it. */

import { wallClearTimeout, wallSetTimeout } from "./runtime/wallClock";

export const DECODE_MAX_SECONDS = 10 * 60;

export class AudioTooLong extends Error {
  constructor(readonly seconds: number | null) {
    super("This clip is too long for this. Up to 10 minutes.");
    this.name = "AudioTooLong";
  }
}

const HEADER_READ_MS = 10_000;

/** The length a media element reads from the file's header (metadata only, no audio decoded); null when unread. */
export function headerSeconds(url: string): Promise<number | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    // timer-ok: a stalled header read counts as unread. Wall clock: a render runs page timers on film time.
    const late = wallSetTimeout(() => done(null), HEADER_READ_MS);
    const done = (seconds: number | null) => {
      wallClearTimeout(late);
      audio.onloadedmetadata = audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
      resolve(seconds);
    };
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done(null);
    audio.src = url;
    audio.load();
  });
}

/** Throws AudioTooLong unless `url` is known to last at most DECODE_MAX_SECONDS: `knownSeconds` when the caller's own
 * media element has read it, else the file's header. A length that cannot be read counts as too long. */
export async function assertDecodableLength(url: string, knownSeconds?: number): Promise<void> {
  const seconds =
    knownSeconds !== undefined && Number.isFinite(knownSeconds) && knownSeconds > 0
      ? knownSeconds
      : await headerSeconds(url);
  if (seconds === null || seconds > DECODE_MAX_SECONDS) throw new AudioTooLong(seconds);
}

/** `url` decoded whole into `context`, after assertDecodableLength: over the bound, nothing is fetched or decoded. */
export async function decodeAudioWithin(
  context: BaseAudioContext,
  url: string,
  options: { fetch?: (url: string) => Promise<Response>; knownSeconds?: number } = {},
): Promise<AudioBuffer> {
  await assertDecodableLength(url, options.knownSeconds);
  const response = await (options.fetch ?? globalThis.fetch)(url);
  if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
  return context.decodeAudioData(await response.arrayBuffer());
}
