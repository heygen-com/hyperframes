import type { HfColorGradingTarget } from "../../colorGrading";
import { colorGradingTarget, gradingRuntime, isRecord } from "./color-grading-status";

/** Plays the target video muted and looping for a live preview; null stops the one playing. */
export type ColorGradingPlaybackRequest = {
  params: { target: HfColorGradingTarget | null };
  result: { started: boolean };
};

// One preview plays at a time, as Studio hovers one card at a time.
let stopPlaying: (() => void) | null = null;

export function parseColorGradingPlaybackParams(
  params: unknown,
): ColorGradingPlaybackRequest["params"] | null {
  if (!isRecord(params) || Object.keys(params).join() !== "target") return null;
  const { target } = params;
  if (target === null) return { target };
  const parsed = colorGradingTarget(target);
  return parsed ? { target: parsed } : null;
}

export function colorGradingPlayback({
  target,
}: ColorGradingPlaybackRequest["params"]): ColorGradingPlaybackRequest["result"] {
  stopPlaying?.();
  stopPlaying = target ? (gradingRuntime()?.startPreviewPlayback(target) ?? null) : null;
  return { started: stopPlaying !== null };
}
