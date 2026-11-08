export interface PreviewVideoTiming {
  frameRate?: number;
  variableFrameRate?: boolean;
  sourceLead: number;
  inputLead: number;
  timeResolution: number;
}

const LEAD = 1e-5;
const FRAME_EPSILON = 1e-9;
const constantRate = (timing: PreviewVideoTiming) =>
  !timing.variableFrameRate && (timing.frameRate ?? 0) > 0;

/** Match export: floor the source-frame grid, then undo container tick rounding. */
export function previewDecodeTime(time: number, timing: PreviewVideoTiming): number {
  const { sourceLead, inputLead, timeResolution, frameRate = 0 } = timing;
  if (!constantRate(timing))
    return Math.max(inputLead, time - sourceLead + inputLead) + FRAME_EPSILON;
  const index = Math.max(0, Math.floor((time - sourceLead) * frameRate + FRAME_EPSILON));
  const ideal = inputLead + index / frameRate;
  return (timeResolution > 0 ? Math.round(ideal * timeResolution) / timeResolution : ideal) + LEAD;
}

export function previewPresentationTime(
  timestamp: number,
  requested: number,
  timing: PreviewVideoTiming,
) {
  const { frameRate = 0, sourceLead, inputLead } = timing;
  const logical = constantRate(timing)
    ? Math.round((timestamp - inputLead) * frameRate) / frameRate + sourceLead
    : timestamp - inputLead + sourceLead;
  const start = Math.min(requested, logical);
  // A decoded prior frame proves its coverage through this query, including a VFR gap.
  return {
    timestamp: start,
    duration: Math.max(constantRate(timing) ? 1 / frameRate : 0, requested - start + LEAD),
  };
}
