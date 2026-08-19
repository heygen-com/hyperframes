export interface ObjectArrayKeyframeTiming {
  percentages: number[];
  totalDuration?: number;
}

const roundPercentage = (percentage: number): number => Math.round(percentage * 10) / 10;
const OBJECT_ARRAY_PERCENTAGE_TOLERANCE = 2;

/**
 * Resolve GSAP object-array keyframe positions exactly once for parsers and writers.
 * Authored per-step durations place each keyframe at its cumulative end; arrays
 * without durations are distributed evenly. A partially-authored or invalid duration
 * sequence is unresolved: callers must preserve the source rather than silently
 * invent different timing.
 */
export function getObjectArrayKeyframeTiming(
  durations: ReadonlyArray<unknown>,
): ObjectArrayKeyframeTiming | null {
  const hasAuthoredDuration = durations.some((duration) => duration !== undefined);
  if (hasAuthoredDuration) {
    if (
      !durations.every(
        (duration): duration is number =>
          typeof duration === "number" && Number.isFinite(duration) && duration > 0,
      )
    ) {
      return null;
    }
    const totalDuration = durations.reduce<number>((sum, duration) => sum + duration, 0);
    let cumulative = 0;
    return {
      percentages: durations.map((duration) => {
        cumulative += duration;
        return roundPercentage((cumulative / totalDuration) * 100);
      }),
      totalDuration,
    };
  }

  const lastIndex = durations.length - 1;
  return {
    percentages: durations.map((_, index) =>
      lastIndex > 0 ? roundPercentage((index / lastIndex) * 100) : 0,
    ),
  };
}

export function getCompatibleObjectArrayKeyframeTiming(
  durations: ReadonlyArray<unknown>,
  outerDuration: unknown,
): ObjectArrayKeyframeTiming | null {
  const timing = getObjectArrayKeyframeTiming(durations);
  if (!timing) return null;
  if (timing.totalDuration === undefined || outerDuration === undefined) return timing;
  if (
    typeof outerDuration === "number" &&
    Math.abs(outerDuration - timing.totalDuration) <= Number.EPSILON
  ) {
    return timing;
  }
  return null;
}

export function findObjectArrayKeyframeIndex(
  durations: ReadonlyArray<unknown>,
  percentage: number,
  options?: { fallbackToNearest?: boolean; tolerance?: number },
): number | null {
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) return null;
  const timing = getObjectArrayKeyframeTiming(durations);
  if (!timing) return null;
  const { percentages } = timing;
  let match: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < percentages.length; index++) {
    const distance = Math.abs(percentages[index]! - percentage);
    if (distance < bestDistance) {
      match = index;
      bestDistance = distance;
    }
  }
  const tolerance = options?.tolerance ?? OBJECT_ARRAY_PERCENTAGE_TOLERANCE;
  return bestDistance <= tolerance || options?.fallbackToNearest ? match : null;
}
