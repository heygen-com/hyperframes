/**
 * Clip-edge fades for audio: `data-fade-in` / `data-fade-out`, in seconds.
 *
 * A fade is a gain ramp anchored to the clip's own edges — the fade-out ends
 * where the clip ends, however the clip is later trimmed — which is why it is
 * an attribute of its own rather than sugar over the `data-automation` volume
 * lane (whose points are clip-local but do not follow the end edge). The two
 * compose: the fade multiplies whatever `data-volume`, the volume lane, or the
 * probed keyframes resolve to at that moment.
 *
 * Linear in gain, on purpose: it is what ffmpeg's `afade` does by default
 * (`curve=tri`), so the preview transport and the rendered mix agree sample
 * for sample without either side carrying a curve table.
 */

export const HF_AUDIO_FADE_IN_ATTR = "data-fade-in";
export const HF_AUDIO_FADE_OUT_ATTR = "data-fade-out";

/** `dataset` / `dataAttributes` keys for the two attributes above. */
export const HF_AUDIO_FADE_IN_DATA_KEY = HF_AUDIO_FADE_IN_ATTR.slice("data-".length);
export const HF_AUDIO_FADE_OUT_DATA_KEY = HF_AUDIO_FADE_OUT_ATTR.slice("data-".length);

export interface AudioFades {
  /** Seconds from the clip's start over which gain rises 0 → 1. */
  fadeIn: number;
  /** Seconds before the clip's end over which gain falls 1 → 0. */
  fadeOut: number;
}

export const NO_FADES: Readonly<AudioFades> = Object.freeze({ fadeIn: 0, fadeOut: 0 });

/** A fade attribute's text as seconds: finite and non-negative, else 0. */
export function readFadeSeconds(raw: string | null | undefined): number {
  if (raw == null || raw === "") return 0;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Both fades off one element (anything with `getAttribute`). */
export function readElementFades(el: { getAttribute(name: string): string | null }): AudioFades {
  return {
    fadeIn: readFadeSeconds(el.getAttribute(HF_AUDIO_FADE_IN_ATTR)),
    fadeOut: readFadeSeconds(el.getAttribute(HF_AUDIO_FADE_OUT_ATTR)),
  };
}

/**
 * Fades that together outrun the clip are scaled down proportionally so they
 * still meet inside it instead of overlapping; a clip of unknown (infinite)
 * duration keeps them as authored.
 */
export function clampFadesToDuration(fades: AudioFades, duration: number): AudioFades {
  const fadeIn = Math.max(0, fades.fadeIn);
  const fadeOut = Math.max(0, fades.fadeOut);
  if (!Number.isFinite(duration) || duration <= 0) return { fadeIn, fadeOut };
  const total = fadeIn + fadeOut;
  if (total <= duration) return { fadeIn, fadeOut };
  const scale = duration / total;
  return { fadeIn: fadeIn * scale, fadeOut: fadeOut * scale };
}

/**
 * Gain multiplier at `elapsed` seconds into a clip of `duration` seconds.
 * 1 everywhere a fade is not running; the two fades multiply where they meet.
 */
export function fadeGain(elapsed: number, duration: number, fades: AudioFades): number {
  const { fadeIn, fadeOut } = clampFadesToDuration(fades, duration);
  let gain = 1;
  if (fadeIn > 0) gain *= clamp01(elapsed / fadeIn);
  if (fadeOut > 0 && Number.isFinite(duration)) gain *= clamp01((duration - elapsed) / fadeOut);
  return gain;
}

/** Seconds as the attribute text Studio writes: up to 2 decimals, no trailing zeros. */
export function formatFadeSeconds(seconds: number): string {
  const rounded = Math.round(Math.max(0, seconds) * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(2).replace(/0+$/, "");
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
