import type { HfColorGradingTarget } from "../../colorGrading";
import {
  colorGradingTarget,
  gradingRuntime,
  isRecord,
  type GradingPreviewBatch,
  type GradingPreviewCandidate,
} from "./color-grading-status";

const MAX_GRADING_CANDIDATES = 64;
const MAX_CANDIDATE_ID = 64;
/** The runtime draws previews no larger than this on their long side. */
const MAX_PREVIEW_DIMENSION = 320;

/** Each candidate drawn over the element's current frame; null when nothing could be drawn. */
export type ColorGradingPreviewsRequest = {
  params: {
    target: HfColorGradingTarget;
    candidates: GradingPreviewCandidate[];
    maxDimension: number;
    useMediaTime: boolean;
  };
  result: { batch: GradingPreviewBatch | null };
};

function candidate(value: unknown): GradingPreviewCandidate | null {
  if (!isRecord(value) || Object.keys(value).sort().join() !== "grading,id") return null;
  const { id, grading } = value;
  if (typeof id !== "string" || !id || id.length > MAX_CANDIDATE_ID) return null;
  return grading === null || isRecord(grading) ? { id, grading } : null;
}

export function parseColorGradingPreviewsParams(
  params: unknown,
): ColorGradingPreviewsRequest["params"] | null {
  if (!isRecord(params)) return null;
  if (Object.keys(params).sort().join() !== "candidates,maxDimension,target,useMediaTime") {
    return null;
  }
  const { candidates, maxDimension, useMediaTime } = params;
  const target = colorGradingTarget(params.target);
  if (!target || typeof useMediaTime !== "boolean" || !Array.isArray(candidates)) return null;
  if (!candidates.length || candidates.length > MAX_GRADING_CANDIDATES) return null;
  const valid = Number.isFinite(maxDimension) && (maxDimension as number) > 0;
  if (!valid || (maxDimension as number) > MAX_PREVIEW_DIMENSION) return null;
  const parsed = candidates.map(candidate);
  if (parsed.includes(null)) return null;
  return {
    target,
    candidates: parsed as GradingPreviewCandidate[],
    maxDimension: maxDimension as number,
    useMediaTime,
  };
}

export async function colorGradingPreviews({
  target,
  candidates,
  maxDimension,
  useMediaTime,
}: ColorGradingPreviewsRequest["params"]): Promise<ColorGradingPreviewsRequest["result"]> {
  const runtime = gradingRuntime();
  if (!runtime) return { batch: null };
  return {
    batch: await runtime.renderPreviews(target, candidates, { maxDimension, useMediaTime }),
  };
}
