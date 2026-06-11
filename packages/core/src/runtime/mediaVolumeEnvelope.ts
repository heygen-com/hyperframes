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

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.max(0, Math.min(1, volume));
}

function readNumberProperty(value: object, key: "time" | "volume"): number | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return typeof descriptor?.value === "number" && Number.isFinite(descriptor.value)
    ? descriptor.value
    : null;
}

function roundedPoint(time: number, volume: number): VolumeKeyframe {
  return {
    time: Number(time.toFixed(6)),
    volume: Number(clampVolume(volume).toFixed(6)),
  };
}

function compactVolumeKeyframes(keyframes: VolumeKeyframe[]): VolumeKeyframe[] {
  const sorted = keyframes
    .filter((kf) => Number.isFinite(kf.time) && Number.isFinite(kf.volume))
    .map((kf) => roundedPoint(kf.time, kf.volume))
    .sort((a, b) => a.time - b.time);

  const deduped: VolumeKeyframe[] = [];
  for (const point of sorted) {
    const previous = deduped.at(-1);
    if (previous && Math.abs(previous.time - point.time) < 0.000001) {
      previous.volume = point.volume;
    } else {
      deduped.push(point);
    }
  }

  if (deduped.length < 3) return deduped;

  const compacted: VolumeKeyframe[] = [];
  for (const point of deduped) {
    compacted.push(point);
    while (compacted.length >= 3) {
      const c = compacted.at(-1)!;
      const b = compacted.at(-2)!;
      const a = compacted.at(-3)!;
      const span = c.time - a.time;
      const expected =
        span <= 0 ? a.volume : a.volume + ((c.volume - a.volume) * (b.time - a.time)) / span;
      if (Math.abs(expected - b.volume) > 0.000001) break;
      compacted.splice(compacted.length - 2, 1);
    }
  }
  return compacted;
}

export function parseVolumeKeyframesAttribute(raw: string | null | undefined): VolumeKeyframe[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const keyframes: VolumeKeyframe[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const time = readNumberProperty(item, "time");
    const volume = readNumberProperty(item, "volume");
    if (time === null || volume === null) continue;
    keyframes.push({ time, volume });
  }
  return compactVolumeKeyframes(keyframes);
}

export function serializeVolumeKeyframesAttribute(keyframes: VolumeKeyframe[]): string {
  return JSON.stringify(compactVolumeKeyframes(keyframes));
}

export function multiplyVolumeKeyframeEnvelopes(params: {
  sourceKeyframes: VolumeKeyframe[];
  multiplierKeyframes: VolumeKeyframe[];
  trackStart: number;
  trackEnd: number;
  baseVolume: number;
}): VolumeKeyframe[] {
  const multiplier = compactVolumeKeyframes(params.multiplierKeyframes);
  if (multiplier.length === 0) return compactVolumeKeyframes(params.sourceKeyframes);

  const source = compactVolumeKeyframes(params.sourceKeyframes);
  if (source.length === 0) return multiplier;

  const baseVolume = clampVolume(params.baseVolume);
  const sourceEnvelope = normaliseEnvelope(source, params.trackStart, baseVolume);
  const multiplierEnvelope = normaliseEnvelope(multiplier, params.trackStart, baseVolume);
  if (sourceEnvelope.length === 0) return multiplier;
  if (multiplierEnvelope.length === 0) return source;

  const duration = Math.max(0, params.trackEnd - params.trackStart);
  const times = new Set<number>([0, duration]);
  for (const point of sourceEnvelope) {
    if (point.time >= 0 && point.time <= duration) times.add(point.time);
  }
  for (const point of multiplierEnvelope) {
    if (point.time >= 0 && point.time <= duration) times.add(point.time);
  }

  const sortedTimes = Array.from(times).sort((a, b) => a - b);
  const sampleTimes = new Set(sortedTimes);
  for (let i = 0; i < sortedTimes.length - 1; i += 1) {
    const a = sortedTimes[i]!;
    const b = sortedTimes[i + 1]!;
    if (b > a) sampleTimes.add((a + b) / 2);
  }

  const combined: VolumeKeyframe[] = [];
  for (const relativeTime of Array.from(sampleTimes).sort((a, b) => a - b)) {
    const sourceVolume = interpolateVolumeGain(sourceEnvelope, relativeTime);
    const multiplierVolume = interpolateVolumeGain(multiplierEnvelope, relativeTime);
    const multiplierGain = baseVolume > 0 ? multiplierVolume / baseVolume : 0;
    combined.push(roundedPoint(params.trackStart + relativeTime, sourceVolume * multiplierGain));
  }
  return compactVolumeKeyframes(combined);
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
      volume: clampVolume(k.volume),
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
    deduped.unshift({ time: 0, volume: clampVolume(baseVolume) });
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
  const staticVolume = Number.isFinite(staticAttr) ? clampVolume(staticAttr) : 1;

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
    const volume = clampVolume(raw);
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
  totalTime?: ((t: number, suppressEvents?: boolean) => unknown) | undefined;
  seek?: ((t: number, suppressEvents?: boolean) => unknown) | undefined;
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
  if (!(mediaEl instanceof HTMLAudioElement) && !(mediaEl instanceof HTMLVideoElement)) return;

  const start = Number.parseFloat(mediaEl.dataset.start ?? "0") || 0;
  const endAttr = Number.parseFloat(mediaEl.dataset.end ?? "");
  const durationAttr = Number.parseFloat(mediaEl.dataset.duration ?? "");
  const end =
    Number.isFinite(endAttr) && endAttr > start
      ? endAttr
      : Number.isFinite(durationAttr) && durationAttr > 0
        ? start + durationAttr
        : compositionDuration;
  const staticAttr = Number.parseFloat(mediaEl.dataset.volume ?? "");
  const staticVolume = Number.isFinite(staticAttr) ? clampVolume(staticAttr) : 1;
  const declarativeKeyframes = parseVolumeKeyframesAttribute(mediaEl.dataset.volumeKeyframes);
  const duckKeyframes = parseVolumeKeyframesAttribute(mediaEl.dataset.hfDuckKeyframes);

  const seekFn = (t: number) => {
    if (!timeline) return;
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

  const probedKeyframes =
    timeline && compositionDuration > 0
      ? probeElementVolumeKeyframes(mediaEl, seekFn, compositionDuration, 60)
      : null;

  let keyframes = probedKeyframes ?? declarativeKeyframes;
  if (duckKeyframes.length > 0) {
    keyframes = multiplyVolumeKeyframeEnvelopes({
      sourceKeyframes: keyframes,
      multiplierKeyframes: duckKeyframes,
      trackStart: start,
      trackEnd: end,
      baseVolume: staticVolume,
    });
  }
  if (keyframes.length > 0) cache.set(mediaEl, keyframes);
}
