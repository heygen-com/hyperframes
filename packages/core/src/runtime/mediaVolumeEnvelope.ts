import type { RuntimeTimelineLike } from "./types";
import { clampAudioGain, withUnclampedVolume } from "../audioGain.js";
import { parseStrictFiniteTimingNumber } from "./playbackRate";

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
      volume: clampAudioGain(k.volume),
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
    deduped.unshift({ time: 0, volume: clampAudioGain(baseVolume) });
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
  // The PCM baker intentionally inlines this lookup with a monotonic cursor
  // because calling this preview-oriented helper per sample would be O(N×M).
  // fallow-ignore-next-line code-duplication
  while (segment < envelope.length - 2 && t >= envelope[segment + 1]!.time) {
    segment += 1;
  }

  const a = envelope[segment]!;
  const b = envelope[segment + 1] ?? a;
  const span = b.time - a.time;
  const progress = span <= 0 ? 0 : Math.min(1, Math.max(0, (t - a.time) / span));
  return a.volume + (b.volume - a.volume) * progress;
}

function recordVolumeSample(
  keyframes: VolumeKeyframe[],
  previousSample: VolumeKeyframe | undefined,
  sample: VolumeKeyframe,
  isFinalSample: boolean,
): void {
  const last = keyframes.at(-1);
  if (!last || Math.abs(last.volume - sample.volume) > 0.0001) {
    // Change-only compression must retain the preceding real sample so a
    // flat run stays flat instead of being interpolated into the next value.
    // During a continuous ramp, that sample is already the last keyframe.
    if (last && previousSample && previousSample.time > last.time) {
      keyframes.push(previousSample);
    }
    keyframes.push(sample);
  } else if (isFinalSample && sample.time > last.time) {
    keyframes.push(sample);
  }
}

function parseVolumeNumber(value: string | undefined): number | undefined {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveVolumeProbeWindow(
  el: HTMLAudioElement | HTMLVideoElement,
  compositionDuration: number,
): { start: number; end: number; staticVolume: number } {
  const start = parseStrictFiniteTimingNumber(el.dataset.start) ?? 0;
  const endAttr = parseStrictFiniteTimingNumber(el.dataset.end) ?? undefined;
  const durAttr = parseStrictFiniteTimingNumber(el.dataset.duration) ?? undefined;
  let end = compositionDuration;
  if (durAttr !== undefined && durAttr > 0) {
    end = start + durAttr;
  } else if (endAttr !== undefined && endAttr > start) {
    end = endAttr;
  }
  const staticAttr = parseVolumeNumber(el.dataset.volume) ?? 1;
  return { start, end, staticVolume: clampAudioGain(staticAttr) };
}

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
  const { start, end, staticVolume } = resolveVolumeProbeWindow(el, compositionDuration);

  const step = 1 / Math.min(60, Math.max(1, sampleFps));
  const sampleStart = Math.max(0, start);
  const sampleEnd = Math.min(compositionDuration, end);

  const keyframes: VolumeKeyframe[] = withUnclampedVolume(el, () => {
    // Reset to data-volume so GSAP captures the correct FROM value. Above
    // unity that only survives because the shadow accessor is installed.
    el.volume = staticVolume;

    const samples: VolumeKeyframe[] = [];
    let previousSample: VolumeKeyframe | undefined;
    for (let t = sampleStart; t <= sampleEnd + 1e-6; t = Math.min(sampleEnd, t + step)) {
      seekTimeline(t);
      const raw = Number(el.volume);
      if (Number.isFinite(raw)) {
        const sample = {
          time: Number(t.toFixed(6)),
          volume: Number(clampAudioGain(raw).toFixed(6)),
        };
        recordVolumeSample(samples, previousSample, sample, t === sampleEnd);
        previousSample = sample;
      }
      if (t === sampleEnd) break;
    }
    return samples;
  });

  const hasAutomation = keyframes.some((kf) => Math.abs(kf.volume - staticVolume) > 0.0001);
  return hasAutomation ? keyframes : null;
}

export type RuntimeTimelineRef = Partial<Pick<RuntimeTimelineLike, "totalTime" | "seek">>;

export interface VolumeProbeOptions {
  /**
   * Render/probe pages must not sample the live visual timeline during runtime
   * initialization. The producer discovers audio automation in its own
   * isolated pass and bakes it before frame capture, so seeking here is both
   * redundant and capable of materializing future zero-duration GSAP state.
   *
   * Preview callers omit this option and retain live automation discovery.
   */
  allowLiveTimelineSeek?: boolean;
}

/**
 * Probe a media element and, if volume automation is detected, store a
 * NORMALISED envelope in `cache`. Safe to call with a null timeline — returns
 * early.
 *
 * `probeElementVolumeKeyframes` stamps each keyframe with the timeline seek
 * time it was sampled at. Everything downstream of this cache — like the
 * renderer's PCM baker — indexes an envelope by track-relative seconds, so the
 * rebase belongs here, at the one point that fills the cache, rather than at
 * each read.
 */
export function probeAndCacheElementVolume(
  mediaEl: HTMLMediaElement,
  timeline: RuntimeTimelineRef | null | undefined,
  compositionDuration: number,
  cache: WeakMap<HTMLMediaElement, VolumeKeyframe[]>,
  options: VolumeProbeOptions = {},
): void {
  if (options.allowLiveTimelineSeek === false) return;
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
    const { start, staticVolume } = resolveVolumeProbeWindow(mediaEl, compositionDuration);
    const envelope = normaliseEnvelope(keyframes, start, staticVolume);
    if (envelope.length > 0) cache.set(mediaEl, envelope);
  }
}
