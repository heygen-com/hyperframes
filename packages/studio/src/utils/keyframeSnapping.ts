export type SnapType = "frame" | "keyframe" | "beat" | null;

export interface SnapResult {
  snappedTime: number;
  snapType: SnapType;
}

export function snapKeyframe(
  time: number,
  options: {
    fps: number;
    keyframeTimes: number[];
    beatTimes?: number[];
    threshold: number;
    disabled?: boolean;
  },
): SnapResult {
  if (options.disabled) return { snappedTime: time, snapType: null };

  const { fps, keyframeTimes, beatTimes = [], threshold } = options;

  let bestDist = threshold;
  let bestTime = time;
  let bestType: SnapType = null;

  // Priority: cross-element keyframes > beat markers > frame boundaries
  // Higher priority snaps use strict < so they win on equal distance
  if (fps > 0) {
    const frameDuration = 1 / fps;
    const nearestFrame = Math.round(time / frameDuration) * frameDuration;
    const dist = Math.abs(time - nearestFrame);
    if (dist < bestDist) {
      bestDist = dist;
      bestTime = nearestFrame;
      bestType = "frame";
    }
  }

  for (const bt of beatTimes) {
    const dist = Math.abs(time - bt);
    if (dist <= bestDist) {
      bestDist = dist;
      bestTime = bt;
      bestType = "beat";
    }
  }

  for (const kt of keyframeTimes) {
    const dist = Math.abs(time - kt);
    if (dist <= bestDist) {
      bestDist = dist;
      bestTime = kt;
      bestType = "keyframe";
    }
  }

  return { snappedTime: bestTime, snapType: bestType };
}

export function computeSnapThreshold(pixelsPerSecond: number, baseThresholdPx: number = 5): number {
  if (pixelsPerSecond <= 0) return 0.1;
  return baseThresholdPx / pixelsPerSecond;
}
