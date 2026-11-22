const measured = new WeakMap<object, { src: string; seconds: number }>();

export function rememberSourceLength(media: HTMLMediaElement): void {
  if (Number.isFinite(media.duration) && media.duration > 0)
    measured.set(media, { src: media.src, seconds: media.duration });
}

/** The source length: the element's own, else the one measured for the same `src` before a reload emptied it; NaN. */
export function sourceLengthOf(media: { duration: number; src?: string }): number {
  if (Number.isFinite(media.duration)) return media.duration;
  const kept = measured.get(media);
  return kept !== undefined && kept.src === media.src ? kept.seconds : Number.NaN;
}
