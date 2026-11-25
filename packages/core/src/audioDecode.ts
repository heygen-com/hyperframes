/** A whole decode in a page peaks at ~2x the file as stereo 48 kHz, whatever the context's rate (90 min: 4 GB). */

import { wallClearTimeout, wallSetTimeout } from "./runtime/wallClock";

const PEAK_BYTES_PER_SECOND = 48_000 * 2 * 4 * 2;
export const DECODE_PEAK_BUDGET_BYTES = 1.5 * 1024 ** 3;
export const decodePeakBytes = (seconds: number): number => seconds * PEAK_BYTES_PER_SECOND;

/** Analysis PCM rate: 48 kHz up to 20 minutes, 24 kHz past it, so a long file holds half the samples. */
export const pcmRateFor = (seconds: number): 48_000 | 24_000 =>
  seconds <= 20 * 60 ? 48_000 : 24_000;

export class AudioTooLong extends Error {
  constructor(readonly seconds: number | null) {
    super("This clip is too long to decode here.");
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

/** An unread length (a recorded blob reads Infinity): its bytes alone keep the peak in budget even at 8 kbps. */
export const UNREAD_LENGTH_MAX_BYTES = (DECODE_PEAK_BUDGET_BYTES / PEAK_BYTES_PER_SECOND) * 1_000;

/** Throws AudioTooLong when `url`'s length, from `knownSeconds` (the caller's own element) or the file's header, is
 * past DECODE_PEAK_BUDGET_BYTES. Resolves "unread" when neither gives a length: unreadFits judges its bytes. */
export async function assertDecodeFits(
  url: string,
  knownSeconds?: number,
): Promise<"read" | "unread"> {
  const seconds =
    knownSeconds !== undefined && Number.isFinite(knownSeconds) && knownSeconds > 0
      ? knownSeconds
      : await headerSeconds(url);
  if (seconds === null) return "unread";
  if (decodePeakBytes(seconds) > DECODE_PEAK_BUDGET_BYTES) throw new AudioTooLong(seconds);
  return "read";
}

export const unreadFits = (byteLength: number): boolean => byteLength <= UNREAD_LENGTH_MAX_BYTES;

/** `url` decoded whole into `context` within the budget: a read length past it is never fetched. */
export async function decodeAudioWithin(
  context: BaseAudioContext,
  url: string,
  options: { fetch?: (url: string) => Promise<Response>; knownSeconds?: number } = {},
): Promise<AudioBuffer> {
  const length = await assertDecodeFits(url, options.knownSeconds);
  const response = await (options.fetch ?? globalThis.fetch)(url);
  if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (length === "unread" && !unreadFits(bytes.byteLength)) throw new AudioTooLong(null);
  return context.decodeAudioData(bytes);
}
