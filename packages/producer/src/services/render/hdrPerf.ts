/**
 * HDR-pipeline perf instrumentation.
 *
 * `HdrPerfCollector` accumulates per-phase wall-clock ms for the
 * layered HDR / shader-transition composite path; `finalizeHdrPerf`
 * converts the running totals into the `HdrPerfSummary` shape that
 * lands in `RenderPerfSummary.hdrPerf`.
 */

export type HdrPerfTimingKey =
  | "frameSeekMs"
  | "frameInjectMs"
  | "stackingQueryMs"
  | "canvasClearMs"
  | "normalCompositeMs"
  | "transitionCompositeMs"
  | "encoderWriteMs"
  | "hdrVideoReadDecodeMs"
  | "hdrVideoTransferMs"
  | "hdrVideoBlitMs"
  | "hdrImageTransferMs"
  | "hdrImageBlitMs"
  | "domLayerSeekMs"
  | "domLayerInjectMs"
  | "domMaskApplyMs"
  | "domScreenshotMs"
  | "domMaskRemoveMs"
  | "domPngDecodeMs"
  | "domBlitMs";

export interface HdrPerfCollector {
  frames: number;
  normalFrames: number;
  transitionFrames: number;
  domLayerCaptures: number;
  hdrVideoLayerBlits: number;
  hdrImageLayerBlits: number;
  timings: Record<HdrPerfTimingKey, number>;
}

export interface HdrPerfSummary {
  frames: number;
  normalFrames: number;
  transitionFrames: number;
  domLayerCaptures: number;
  hdrVideoLayerBlits: number;
  hdrImageLayerBlits: number;
  timings: Record<string, number>;
  avgMs: Record<string, number>;
}

export function createHdrPerfCollector(): HdrPerfCollector {
  return {
    frames: 0,
    normalFrames: 0,
    transitionFrames: 0,
    domLayerCaptures: 0,
    hdrVideoLayerBlits: 0,
    hdrImageLayerBlits: 0,
    timings: {
      frameSeekMs: 0,
      frameInjectMs: 0,
      stackingQueryMs: 0,
      canvasClearMs: 0,
      normalCompositeMs: 0,
      transitionCompositeMs: 0,
      encoderWriteMs: 0,
      hdrVideoReadDecodeMs: 0,
      hdrVideoTransferMs: 0,
      hdrVideoBlitMs: 0,
      hdrImageTransferMs: 0,
      hdrImageBlitMs: 0,
      domLayerSeekMs: 0,
      domLayerInjectMs: 0,
      domMaskApplyMs: 0,
      domScreenshotMs: 0,
      domMaskRemoveMs: 0,
      domPngDecodeMs: 0,
      domBlitMs: 0,
    },
  };
}

export function addHdrTiming(
  perf: HdrPerfCollector | undefined,
  key: HdrPerfTimingKey,
  startMs: number,
) {
  if (!perf) return;
  perf.timings[key] += Date.now() - startMs;
}

export function timeHdrPhase<T>(
  perf: HdrPerfCollector | undefined,
  key: HdrPerfTimingKey,
  fn: () => T,
): T {
  if (!perf) return fn();
  const start = Date.now();
  const result = fn();
  addHdrTiming(perf, key, start);
  return result;
}

export async function timeHdrPhaseAsync<T>(
  perf: HdrPerfCollector | undefined,
  key: HdrPerfTimingKey,
  fn: () => Promise<T>,
): Promise<T> {
  if (!perf) return fn();
  const start = Date.now();
  const result = await fn();
  addHdrTiming(perf, key, start);
  return result;
}

function averageTiming(totalMs: number, count: number): number {
  return count > 0 ? Math.round((totalMs / count) * 100) / 100 : 0;
}

export function finalizeHdrPerf(perf: HdrPerfCollector): HdrPerfSummary {
  const avgMs: Record<string, number> = {};
  const perFrameKeys: HdrPerfTimingKey[] = [
    "frameSeekMs",
    "frameInjectMs",
    "stackingQueryMs",
    "canvasClearMs",
    "encoderWriteMs",
  ];
  for (const key of perFrameKeys) avgMs[key] = averageTiming(perf.timings[key], perf.frames);
  avgMs.normalCompositeMs = averageTiming(perf.timings.normalCompositeMs, perf.normalFrames);
  avgMs.transitionCompositeMs = averageTiming(
    perf.timings.transitionCompositeMs,
    perf.transitionFrames,
  );

  const perDomLayerKeys: HdrPerfTimingKey[] = [
    "domLayerSeekMs",
    "domLayerInjectMs",
    "domMaskApplyMs",
    "domScreenshotMs",
    "domMaskRemoveMs",
    "domPngDecodeMs",
    "domBlitMs",
  ];
  for (const key of perDomLayerKeys) {
    avgMs[key] = averageTiming(perf.timings[key], perf.domLayerCaptures);
  }

  const perHdrVideoKeys: HdrPerfTimingKey[] = [
    "hdrVideoReadDecodeMs",
    "hdrVideoTransferMs",
    "hdrVideoBlitMs",
  ];
  for (const key of perHdrVideoKeys) {
    avgMs[key] = averageTiming(perf.timings[key], perf.hdrVideoLayerBlits);
  }

  const perHdrImageKeys: HdrPerfTimingKey[] = ["hdrImageTransferMs", "hdrImageBlitMs"];
  for (const key of perHdrImageKeys) {
    avgMs[key] = averageTiming(perf.timings[key], perf.hdrImageLayerBlits);
  }

  return {
    frames: perf.frames,
    normalFrames: perf.normalFrames,
    transitionFrames: perf.transitionFrames,
    domLayerCaptures: perf.domLayerCaptures,
    hdrVideoLayerBlits: perf.hdrVideoLayerBlits,
    hdrImageLayerBlits: perf.hdrImageLayerBlits,
    timings: { ...perf.timings },
    avgMs,
  };
}
