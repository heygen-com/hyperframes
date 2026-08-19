/**
 * Authoring gain for a media clip.
 *
 * HTMLMediaElement.volume is limited to 0..1, but HyperFrames' Web Audio
 * preview and FFmpeg render paths both support gain above unity. Keep the
 * shared ceiling here so Studio, preview, and render cannot drift.
 */
export const MAX_AUDIO_GAIN_DB = 12;
export const MAX_AUDIO_GAIN = 10 ** (MAX_AUDIO_GAIN_DB / 20);

/** Studio fader coordinates. Unity is deliberately the physical midpoint. */
export const AUDIO_GAIN_FADER_MIN = -100;
export const AUDIO_GAIN_FADER_MAX = 100;

const MIN_AUDIO_GAIN_DB = -60;

export function clampAudioGain(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(MAX_AUDIO_GAIN, value));
}

export function clampNativeMediaVolume(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

/**
 * Serialize an authored gain for `data-volume`.
 *
 * The fader travels in dB, so its stops are irrational (position -70 is
 * 10 ** (-42/20)). Rounding to two decimals — what the generic numeric
 * attribute formatter does — collapses the whole bottom of the fader onto
 * `"0"` (a hard mute) and makes the knob jump on release everywhere below
 * unity. Six decimals round-trip every integer fader stop back to itself.
 */
export function formatAudioGain(gain: number): string {
  return clampAudioGain(gain)
    .toFixed(6)
    .replace(/\.?0+$/, "");
}

/**
 * Run `probe` with `el.volume` shadowed by an accessor that keeps the authored
 * value instead of the spec's [0,1] clamp.
 *
 * `HTMLMediaElement.volume` cannot hold gain above unity, so a clip authored
 * at `data-volume="1.95"` reads back as 1 the moment the probe seeds it — and
 * a GSAP tween started from that seed fades from 0 dB rather than from the
 * authored boost. Both the FFmpeg mixer and the Web Audio transport carry gain
 * up to MAX_AUDIO_GAIN, so the clamp is a probe artefact, not a real ceiling.
 * The native setter still receives the clamped value, so nothing outside the
 * probe observes an out-of-range volume, and the shadow is removed afterwards.
 */
export function withUnclampedVolume<T>(el: HTMLMediaElement, probe: () => T): T {
  // Guarded for non-DOM runtimes: the probe that calls this is also reachable
  // from tests and tools that run outside a browser, where the clamped path is
  // the right (and only) answer.
  const descriptor =
    typeof HTMLMediaElement === "undefined"
      ? undefined
      : Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume");
  const nativeGet = descriptor?.get;
  const nativeSet = descriptor?.set;
  if (!nativeGet || !nativeSet) return probe();

  let authored = Number(nativeGet.call(el));
  Object.defineProperty(el, "volume", {
    configurable: true,
    get: () => authored,
    set: (value: number) => {
      authored = Number(value);
      nativeSet.call(el, clampNativeMediaVolume(authored));
    },
  });
  try {
    return probe();
  } finally {
    delete (el as unknown as Record<"volume", unknown>).volume;
    nativeSet.call(el, clampNativeMediaVolume(authored));
  }
}

export function audioFaderPositionToGain(position: number): number {
  const safe = Math.max(AUDIO_GAIN_FADER_MIN, Math.min(AUDIO_GAIN_FADER_MAX, position));
  if (safe === AUDIO_GAIN_FADER_MIN) return 0;
  const db =
    safe < 0
      ? (safe / Math.abs(AUDIO_GAIN_FADER_MIN)) * Math.abs(MIN_AUDIO_GAIN_DB)
      : (safe / AUDIO_GAIN_FADER_MAX) * MAX_AUDIO_GAIN_DB;
  return 10 ** (db / 20);
}

export function audioGainToFaderPosition(gain: number): number {
  const safe = clampAudioGain(gain);
  if (safe === 0) return AUDIO_GAIN_FADER_MIN;
  const db = 20 * Math.log10(safe);
  const position =
    db < 0
      ? (db / Math.abs(MIN_AUDIO_GAIN_DB)) * Math.abs(AUDIO_GAIN_FADER_MIN)
      : (db / MAX_AUDIO_GAIN_DB) * AUDIO_GAIN_FADER_MAX;
  return Math.max(AUDIO_GAIN_FADER_MIN, Math.min(AUDIO_GAIN_FADER_MAX, position));
}

export function audioGainToText(gain: number): string {
  const safe = clampAudioGain(gain);
  if (safe === 0) return "-∞ dB";
  const db = 20 * Math.log10(safe);
  const rounded = Math.abs(db) < 0.05 ? 0 : db;
  return (rounded > 0 ? "+" : "") + rounded.toFixed(1) + " dB";
}
