/**
 * One owner for "does this capture route support sub-frame motion blur".
 *
 * The question has been answered implicitly three times and come out wrong and silent
 * each time, because whichever capture path happened to run decided it. The engine's own
 * guard covers what the engine can see, the capture mode and the frame format, but it
 * cannot see which producer route built the session. This module holds that half.
 *
 * The route is the capture plan's own `kind`, which is already the single value the capture
 * stages consume, so this cannot drift from the route that actually runs. A new plan kind
 * with no entry in the table below fails the typecheck, which forces an explicit answer
 * instead of inheriting silence.
 *
 * Out of scope on purpose: distributed renders. `DistributedRenderConfig` has no
 * `motionBlur` field and is not built from `RenderConfig`, so motion blur cannot be
 * requested on one. There is nothing to reject, and threading it through the frozen plan
 * is a feature rather than a fix.
 */

import type { MotionBlurOptions } from "@hyperframes/engine";
import type { CapturePlan } from "./capturePlan.js";

/** Why a capture route cannot honour motion blur, or null when it can. */
const UNSUPPORTED_REASON: Record<CapturePlan["kind"], string | null> = {
  sdr_streaming: null,
  sdr_disk: null,
  // Segmented capture runs the same per-frame capture loop as sdr_streaming;
  // only the encoder lifetime and the frame range differ, and neither is
  // visible to sub-frame accumulation.
  sdr_segmented: null,
  // Named for HDR but reached by shader transitions with no HDR content at all
  // (`shouldUseLayeredComposite`), so the reason must not blame HDR for a composition
  // that has none.
  hdr_layered:
    "the layered compositor, used for HDR content and for shader transitions, runs its " +
    "own capture loop, seeking and blitting each layer itself, so a frame never reaches " +
    "the sub-frame accumulation branch",
};

/**
 * Throw a named error when motion blur was asked for on a route that cannot deliver it.
 *
 * Failing loudly is the whole point: the alternative, which is what main did until now,
 * is a render that accepts `motionBlur` and returns frames with no blur in them.
 */
export function assertMotionBlurSupported(
  motionBlur: MotionBlurOptions | undefined,
  route: CapturePlan["kind"],
): void {
  if (!motionBlur) return;
  const reason = UNSUPPORTED_REASON[route];
  if (reason === null) return;
  throw new Error(
    `[MotionBlur] sub-frame motion blur is not supported on the "${route}" capture route: ${reason}`,
  );
}
