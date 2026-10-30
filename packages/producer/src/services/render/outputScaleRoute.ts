/**
 * One owner for "does this capture route honour an output resolution other than the composition's".
 * The scale is Chrome's deviceScaleFactor; a route that sizes its own buffers and encoder from the
 * composition would encode at native size while the render reports the requested one.
 */

import type { CapturePlan } from "./capturePlan.js";

/** Why a capture route cannot scale its output, or null when it can. */
const UNSUPPORTED_REASON: Record<CapturePlan["kind"], string | null> = {
  sdr_streaming: null,
  sdr_disk: null,
  sdr_segmented: null,
  hdr_layered:
    "the layered compositor, used for HDR content and for shader transitions in webm and mov, " +
    "sizes its layers and its encoder from the composition",
};

/** Throw a named error when an output resolution other than the composition's meets a route that ignores it. */
export function assertOutputScaleSupported(
  deviceScaleFactor: number,
  route: CapturePlan["kind"],
): void {
  if (deviceScaleFactor === 1) return;
  const reason = UNSUPPORTED_REASON[route];
  if (reason === null) return;
  throw new Error(
    `[Render] --resolution other than the composition's size is not supported on the "${route}" ` +
      `capture route: ${reason}. Render at the composition's size; or, for HDR footage, add --sdr to ` +
      "render this size in standard colour; or, for shader transitions, render as mp4.",
  );
}
