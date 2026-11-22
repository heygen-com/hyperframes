const measured = new WeakMap<object, { src: string; seconds: number }>();

/** Keeps a media element's measured source length, which any reload (the runtime letting go of a far clip) empties. */
export function rememberSourceLength(media: HTMLMediaElement): void {
  if (Number.isFinite(media.duration) && media.duration > 0)
    measured.set(media, { src: media.src, seconds: media.duration });
}

/** The source length: the element's own once loaded, else the one measured for the same `src`; NaN when unknown. */
export function sourceLengthOf(media: { duration: number; src?: string }): number {
  if (Number.isFinite(media.duration)) return media.duration;
  const kept = measured.get(media);
  return kept !== undefined && kept.src === media.src ? kept.seconds : Number.NaN;
}
