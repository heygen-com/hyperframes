/**
 * Segment planning for long-form capture (spec §5 Phase 2). A segment is a
 * half-open frame range captured into its own closed-GOP encoder process so
 * a crash costs one segment, not the render, and scratch is encoded video.
 */
export interface SegmentSlice {
  index: number;
  startFrame: number;
  /** Exclusive. */
  endFrame: number;
}

/** ~100 s at 30 fps. Below the 10k-frame band where field crash rates pass 4 % (spec §2.5). */
export const DEFAULT_SEGMENT_FRAMES = 3000;
/** Tiny GOPs cost bitrate and per-encoder spawn overhead; 1 s at 30 fps is the floor. */
export const MIN_SEGMENT_FRAMES = 30;

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`[segmentPlan] ${name} must be a positive integer (got ${String(value)})`);
  }
}

export function planSegments(totalFrames: number, segmentFrames: number): SegmentSlice[] {
  assertPositiveInteger("totalFrames", totalFrames);
  assertPositiveInteger("segmentFrames", segmentFrames);
  const slices: SegmentSlice[] = [];
  for (let start = 0, index = 0; start < totalFrames; start += segmentFrames, index += 1) {
    slices.push({
      index,
      startFrame: start,
      endFrame: Math.min(totalFrames, start + segmentFrames),
    });
  }
  return slices;
}

export function resolveSegmentFrames(env: NodeJS.ProcessEnv): number {
  const raw = env.HF_SEGMENT_FRAMES;
  if (raw === undefined || raw.trim() === "") return DEFAULT_SEGMENT_FRAMES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return DEFAULT_SEGMENT_FRAMES;
  return Math.max(MIN_SEGMENT_FRAMES, parsed);
}
