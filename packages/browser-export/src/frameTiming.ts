/**
 * Quantize a time to the nearest frame boundary — the same contract the
 * producer's deterministic seek uses (see @hyperframes/core parityContract).
 */
export function quantizeTimeToFrame(timeSeconds: number, fps: number): number {
  if (!Number.isFinite(timeSeconds) || !Number.isFinite(fps) || fps <= 0) {
    return 0;
  }
  return Math.round(timeSeconds * fps) / fps;
}

export function frameCount(durationSeconds: number, fps: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return Math.max(1, Math.round(durationSeconds * fps));
}

export function frameTimestamp(frameIndex: number, fps: number): number {
  return frameIndex / fps;
}
