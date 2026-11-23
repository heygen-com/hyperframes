/** Moving reported times onto measured ones, one at a time, and saying how far they moved. */

export interface SnapReport {
  /** What the times were moved onto. */
  reference: string;
  toleranceMs: number;
  /** Times moved onto a measured one. */
  snapped: number;
  /** Times with nothing measured within the tolerance, kept as reported. */
  unsnapped: number[];
  /** Median distance between a reported time and the measured one it moved to, in ms: low means they agreed. */
  medianShiftMs: number | null;
}

/** Index of the value in ascending `sorted` nearest `t`. */
function nearestIndex(sorted: readonly number[], t: number): number {
  let low = 0;
  let high = sorted.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid]! < t) low = mid + 1;
    else high = mid;
  }
  return low > 0 && t - sorted[low - 1]! <= sorted[low]! - t ? low - 1 : low;
}

export interface Snapper {
  snap: (t: number) => number;
  report: () => SnapReport;
}

/** Snaps each time to the nearest of `measured` (ascending) when one is within `toleranceSeconds`, else keeps it. */
export function snapper(
  measured: readonly number[],
  toleranceSeconds: number,
  reference: string,
): Snapper {
  const shifts: number[] = [];
  const unsnapped: number[] = [];
  return {
    snap(t) {
      const nearest = measured.length ? measured[nearestIndex(measured, t)]! : null;
      if (nearest === null || Math.abs(nearest - t) > toleranceSeconds) {
        unsnapped.push(t);
        return t;
      }
      shifts.push(Math.abs(nearest - t));
      return nearest;
    },
    report() {
      const sorted = [...shifts].sort((a, b) => a - b);
      const median = sorted.length ? sorted[sorted.length >> 1]! : null;
      return {
        reference,
        toleranceMs: Math.round(toleranceSeconds * 1000),
        snapped: shifts.length,
        unsnapped: [...unsnapped],
        medianShiftMs: median === null ? null : Math.round(median * 1000),
      };
    },
  };
}
