export interface ResolvedPhases {
  in: number;
  hold: number;
  out: number;
  outAt: number;
  scale: number;
}

/**
 * Resolve IN/HOLD/OUT windows for authored primitive timelines.
 *
 * This follows compiler/timingResolver.ts's "never timescale animated
 * content" rule: normal durations keep authored in/out tween lengths and let
 * the elastic hold absorb slack. The deliberate exception is the pathological
 * short-duration branch where D < inBase + outBase; only there do we uniformly
 * compress in/out so the phases still sum to the host duration.
 */
export function resolvePhases(D: number, inBase: number, outBase: number): ResolvedPhases {
  const duration = Number.isFinite(D) ? D : 0;
  if (duration <= 0) {
    return { in: 0, hold: 0, out: 0, outAt: 0, scale: 0 };
  }

  const baseIn = Number.isFinite(inBase) ? Math.max(0, inBase) : 0;
  const baseOut = Number.isFinite(outBase) ? Math.max(0, outBase) : 0;
  const baseTotal = baseIn + baseOut;

  if (baseTotal === 0) {
    return { in: 0, hold: duration, out: 0, outAt: duration, scale: 1 };
  }

  if (duration >= baseTotal) {
    const hold = duration - baseIn - baseOut;
    return { in: baseIn, hold, out: baseOut, outAt: duration - baseOut, scale: 1 };
  }

  const scale = duration / baseTotal;
  const resolvedIn = baseIn * scale;
  const resolvedOut = baseOut * scale;
  return {
    in: resolvedIn,
    hold: 0,
    out: resolvedOut,
    outAt: duration - resolvedOut,
    scale,
  };
}
