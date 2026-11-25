import { createJobSlots, JobAbandonedError } from "./jobSlots.js";

export type DecodeAudio = (mediaPath: string, signal: AbortSignal) => Promise<number[]>;

export const AUDIO_DECODE_LIMIT = 4;
export const AUDIO_DECODE_TIMEOUT_MS = 10 * 60_000;

export class AudioDecodeTimeoutError extends Error {
  constructor() {
    super("audio decode took too long");
    this.name = "AudioDecodeTimeoutError";
  }
}

const runDecode = createJobSlots(AUDIO_DECODE_LIMIT);

export const inAudioDecodeSlot = (run: () => Promise<unknown>, signal: AbortSignal) =>
  runDecode(run, signal);

interface SharedDecode {
  result: Promise<number[]>;
  waiting: number;
  stop: AbortController;
}

const inFlight = new Map<string, SharedDecode>();

function decodeWithTimeout(mediaPath: string, decode: DecodeAudio, stop: AbortSignal) {
  const timedOut = new AbortController();
  const timer = setTimeout(
    () => timedOut.abort(new AudioDecodeTimeoutError()),
    AUDIO_DECODE_TIMEOUT_MS,
  );
  return decode(mediaPath, AbortSignal.any([stop, timedOut.signal])).finally(() =>
    clearTimeout(timer),
  );
}

function startDecode(key: string, mediaPath: string, decode: DecodeAudio): SharedDecode {
  const stop = new AbortController();
  const result = runDecode(
    () => decodeWithTimeout(mediaPath, decode, stop.signal),
    stop.signal,
  ).finally(() => {
    if (inFlight.get(key) === shared) inFlight.delete(key);
  });
  // Each request attaches its own handlers; this only keeps a decode nobody waits for from an unhandled rejection.
  result.catch(() => undefined);
  const shared: SharedDecode = { result, waiting: 0, stop };
  inFlight.set(key, shared);
  return shared;
}

/**
 * One decode per cache entry, shared by its requests, in slots shared by the waveform and peaks routes.
 * When the last request waiting on a decode goes away, its ffmpeg is killed or it leaves the queue.
 */
export function decodeShared(
  key: string,
  mediaPath: string,
  decode: DecodeAudio,
  signal?: AbortSignal,
): Promise<number[]> {
  const shared = inFlight.get(key) ?? startDecode(key, mediaPath, decode);
  shared.waiting++;
  return new Promise((resolve, reject) => {
    const leave = () => {
      shared.waiting--;
      if (shared.waiting === 0) {
        if (inFlight.get(key) === shared) inFlight.delete(key);
        shared.stop.abort();
      }
      reject(new JobAbandonedError());
    };
    if (signal?.aborted) return leave();
    signal?.addEventListener("abort", leave, { once: true });
    shared.result.then(
      (peaks) => {
        signal?.removeEventListener("abort", leave);
        resolve(peaks);
      },
      (error: unknown) => {
        signal?.removeEventListener("abort", leave);
        reject(error);
      },
    );
  });
}
