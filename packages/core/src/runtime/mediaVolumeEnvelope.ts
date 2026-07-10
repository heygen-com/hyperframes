/**
 * Shared volume-automation utilities used by both the renderer (offline PCM
 * baking in audioVolumeEnvelope.ts) and the preview runtime (per-tick gain
 * applied in syncRuntimeMedia).
 *
 * Keeping the two concerns in one place ensures preview and render derive the
 * envelope from the same logic and the same probe samples.
 */

export interface VolumeKeyframe {
  time: number;
  volume: number;
}

/**
 * Normalise raw keyframes to track-relative seconds: subtract `trackStart`,
 * clamp to [0,1], sort, de-duplicate, and prepend a `baseVolume` anchor at
 * t=0 when the first keyframe starts after the clip's begin.
 *
 * Returns an empty array when all keyframes are invalid — the caller should
 * treat an empty envelope as "no automation, use static volume."
 */
export function normaliseEnvelope(
  keyframes: VolumeKeyframe[],
  trackStart: number,
  baseVolume: number,
): VolumeKeyframe[] {
  const points = keyframes
    .filter((k) => Number.isFinite(k.time) && Number.isFinite(k.volume))
    .map((k) => ({
      time: Math.max(0, k.time - trackStart),
      volume: Math.max(0, Math.min(1, k.volume)),
    }))
    .sort((a, b) => a.time - b.time);

  const deduped: VolumeKeyframe[] = [];
  for (const point of points) {
    const previous = deduped.at(-1);
    if (previous && Math.abs(previous.time - point.time) < 1e-9) {
      previous.volume = point.volume;
    } else {
      deduped.push(point);
    }
  }

  if (deduped.length === 0) return deduped;
  if (deduped[0]!.time > 0) {
    deduped.unshift({ time: 0, volume: Math.max(0, Math.min(1, baseVolume)) });
  }
  return deduped;
}

/**
 * Linearly interpolate the gain at time `t` (track-relative seconds) from a
 * normalised envelope produced by `normaliseEnvelope`. Returns 1 when the
 * envelope is empty.
 */
export function interpolateVolumeGain(envelope: VolumeKeyframe[], t: number): number {
  if (envelope.length === 0) return 1;

  let segment = 0;
  while (segment < envelope.length - 2 && t >= envelope[segment + 1]!.time) {
    segment += 1;
  }

  const a = envelope[segment]!;
  const b = envelope[segment + 1] ?? a;
  const span = b.time - a.time;
  const progress = span <= 0 ? 0 : Math.min(1, Math.max(0, (t - a.time) / span));
  return a.volume + (b.volume - a.volume) * progress;
}

// fallow-ignore-next-line complexity
/**
 * Probe a single media element's volume automation by seeking a GSAP timeline
 * through the element's active window.
 *
 * Runs synchronously in the browser. The timeline is left at its current
 * position after the probe (the next transport tick re-seeks it to `t`).
 *
 * Returns null when the element has no detectable automation (volume never
 * changes from its initial `data-volume` value).
 */
export function probeElementVolumeKeyframes(
  el: HTMLAudioElement | HTMLVideoElement,
  seekTimeline: (t: number) => void,
  compositionDuration: number,
  sampleFps: number,
): VolumeKeyframe[] | null {
  const start = Number.parseFloat(el.dataset.start ?? "0") || 0;
  const endAttr = Number.parseFloat(el.dataset.end ?? "");
  const durAttr = Number.parseFloat(el.dataset.duration ?? "");
  const end =
    Number.isFinite(endAttr) && endAttr > start
      ? endAttr
      : Number.isFinite(durAttr) && durAttr > 0
        ? start + durAttr
        : compositionDuration;

  const staticAttr = Number.parseFloat(el.dataset.volume ?? "");
  const staticVolume = Number.isFinite(staticAttr) ? Math.max(0, Math.min(1, staticAttr)) : 1;

  // Reset to data-volume so GSAP captures the correct FROM value.
  el.volume = staticVolume;

  const step = 1 / Math.min(60, Math.max(1, sampleFps));
  const sampleStart = Math.max(0, start);
  const sampleEnd = Math.min(compositionDuration, end);

  const keyframes: VolumeKeyframe[] = [];
  for (let t = sampleStart; t <= sampleEnd + 1e-6; t += step) {
    const bounded = Math.min(sampleEnd, t);
    seekTimeline(bounded);
    const raw = Number(el.volume);
    if (!Number.isFinite(raw)) continue;
    const volume = Math.max(0, Math.min(1, raw));
    const last = keyframes.at(-1);
    if (!last || Math.abs(last.volume - volume) > 0.0001 || bounded === sampleEnd) {
      keyframes.push({ time: Number(bounded.toFixed(6)), volume: Number(volume.toFixed(6)) });
    }
    if (bounded === sampleEnd) break;
  }

  const hasAutomation = keyframes.some((kf) => Math.abs(kf.volume - staticVolume) > 0.0001);
  return hasAutomation ? keyframes : null;
}

export interface RuntimeTimelineRef {
  totalTime?: ((t?: number, suppressEvents?: boolean) => unknown) | undefined;
  seek?: ((t?: number, suppressEvents?: boolean) => unknown) | undefined;
}

/**
 * Probe a media element and, if volume automation is detected, store the
 * keyframes in `cache`. Safe to call with a null timeline — returns early.
 */
export function probeAndCacheElementVolume(
  mediaEl: HTMLMediaElement,
  timeline: RuntimeTimelineRef | null | undefined,
  compositionDuration: number,
  cache: WeakMap<HTMLMediaElement, VolumeKeyframe[]>,
): void {
  if (!timeline) return;
  if (!(mediaEl instanceof HTMLAudioElement) && !(mediaEl instanceof HTMLVideoElement)) return;
  if (compositionDuration <= 0) return;

  const seekFn = (t: number) => {
    try {
      if (typeof timeline.totalTime === "function") {
        timeline.totalTime(t, true);
      } else if (typeof timeline.seek === "function") {
        timeline.seek(t, true);
      }
    } catch {
      // ignore seek failures during probe
    }
  };
  // Sampling seeks the live timeline through the entire composition. Preserve
  // its playhead so the probe cannot perturb the first rendered frame (or any
  // user scrub in the preview).
  const originalTime =
    typeof timeline.totalTime === "function"
      ? Number(timeline.totalTime())
      : typeof timeline.seek === "function"
        ? Number(timeline.seek())
        : 0;
  const keyframes = probeElementVolumeKeyframes(mediaEl, seekFn, compositionDuration, 60);
  if (Number.isFinite(originalTime)) seekFn(originalTime);
  if (keyframes) {
    cache.set(mediaEl, keyframes);
  }
}
