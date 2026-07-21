export interface ObjectArrayKeyframeTiming {
  percentages: number[];
  totalDuration?: number;
}

/**
 * Resolve GSAP object-array keyframe positions exactly once for parsers and writers.
 * Authored per-step durations place each keyframe at its cumulative end; arrays
 * without durations are distributed evenly.
 */
export function getObjectArrayKeyframeTiming(
  durations: ReadonlyArray<number | undefined>,
): ObjectArrayKeyframeTiming {
  const totalDuration = durations.reduce<number>((sum, duration) => sum + (duration ?? 0), 0);
  if (totalDuration > 0) {
    let cumulative = 0;
    return {
      percentages: durations.map((duration) => {
        cumulative += duration ?? 0;
        return Math.round((cumulative / totalDuration) * 100);
      }),
      totalDuration,
    };
  }

  const lastIndex = durations.length - 1;
  return {
    percentages: durations.map((_, index) =>
      lastIndex > 0 ? Math.round((index / lastIndex) * 100) : 0,
    ),
  };
}

export function findObjectArrayKeyframeIndex(
  durations: ReadonlyArray<number | undefined>,
  percentage: number,
  tolerance: number,
): number | null {
  const { percentages } = getObjectArrayKeyframeTiming(durations);
  let match: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < percentages.length; index++) {
    const distance = Math.abs(percentages[index]! - percentage);
    if (distance <= tolerance && distance < bestDistance) {
      match = index;
      bestDistance = distance;
    }
  }
  return match;
}
