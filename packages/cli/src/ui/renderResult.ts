import {
  REFERENCE_BACKGROUND_FIELD,
  referenceBackgroundResult,
  type ReferenceBackgroundResult,
} from "@hyperframes/producer";
import type { PageMotionBlurSummary } from "@hyperframes/engine";
import { renderMotionBlurResult } from "../telemetry/renderMotionBlur.js";

export interface RenderMachineResultInput extends Partial<ReferenceBackgroundResult> {
  motionBlur?: PageMotionBlurSummary;
}

/** Versioned, content-free success line for a piped CLI: the background and motion blur counts the render measured, never a path or a word of the composition. */
export function renderMachineResult(result: RenderMachineResultInput, quiet: boolean): void {
  if (quiet || process.stdout.isTTY || process.env.HYPERFRAMES_STDOUT_IS_TTY === "1") return;
  const hasBackground = REFERENCE_BACKGROUND_FIELD in result;
  if (!hasBackground && !result.motionBlur) return;
  const line = {
    version: 1,
    operation: "render",
    ...(hasBackground ? referenceBackgroundResult(result[REFERENCE_BACKGROUND_FIELD]) : {}),
    ...(result.motionBlur ? { motion_blur: renderMotionBlurResult(result.motionBlur) } : {}),
  };
  process.stdout.write(`@hf-result ${JSON.stringify(line)}\n`);
}
