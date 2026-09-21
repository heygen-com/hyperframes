/** Clip-edge fades: `data-fade-in` / `data-fade-out` in seconds, linear, multiplied on the resolved level. */

export const HF_AUDIO_FADE_IN_ATTR = "data-fade-in";
export const HF_AUDIO_FADE_OUT_ATTR = "data-fade-out";

export const HF_AUDIO_FADE_IN_DATA_KEY = HF_AUDIO_FADE_IN_ATTR.slice("data-".length);
export const HF_AUDIO_FADE_OUT_DATA_KEY = HF_AUDIO_FADE_OUT_ATTR.slice("data-".length);

export interface AudioFades {
  /** Seconds from the clip start over which gain rises 0 → 1. */
  fadeIn: number;
  /** Seconds before the clip end over which gain falls 1 → 0. */
  fadeOut: number;
}

export const NO_FADES: Readonly<AudioFades> = Object.freeze({ fadeIn: 0, fadeOut: 0 });

function finiteFadeSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Attribute text as seconds: finite and positive, else 0 (no fade). */
export function readFadeSeconds(raw: string | null | undefined): number {
  if (raw == null || raw === "") return 0;
  return finiteFadeSeconds(Number.parseFloat(raw));
}

export function readElementFades(el: { getAttribute(name: string): string | null }): AudioFades {
  return {
    fadeIn: readFadeSeconds(el.getAttribute(HF_AUDIO_FADE_IN_ATTR)),
    fadeOut: readFadeSeconds(el.getAttribute(HF_AUDIO_FADE_OUT_ATTR)),
  };
}

/** Scale fades that outrun the clip so they meet inside it. Infinite duration keeps them as authored. */
export function clampFadesToDuration(fades: AudioFades, duration: number): AudioFades {
  const fadeIn = finiteFadeSeconds(fades.fadeIn);
  const fadeOut = finiteFadeSeconds(fades.fadeOut);
  if (!Number.isFinite(duration) || duration <= 0) return { fadeIn, fadeOut };
  const total = fadeIn + fadeOut;
  if (total <= duration) return { fadeIn, fadeOut };
  const scale = duration / total;
  return { fadeIn: fadeIn * scale, fadeOut: fadeOut * scale };
}

/** Gain at `elapsed` into a clip of `duration`. 1 where no fade runs; the two multiply where they meet. */
export function fadeGain(elapsed: number, duration: number, fades: AudioFades): number {
  if (!Number.isFinite(elapsed)) return 1;
  const { fadeIn, fadeOut } = clampFadesToDuration(fades, duration);
  let gain = 1;
  if (fadeIn > 0) gain *= clamp01(elapsed / fadeIn);
  if (fadeOut > 0 && Number.isFinite(duration)) gain *= clamp01((duration - elapsed) / fadeOut);
  return gain;
}

/** Attribute text Studio writes: up to 2 decimals, no trailing zeros. */
export function formatFadeSeconds(seconds: number): string {
  const rounded = Math.round(finiteFadeSeconds(seconds) * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(2).replace(/0+$/, "");
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value > 1 ? 1 : value;
}
