import type { MotionBlurOptions } from "@hyperframes/engine";

/**
 * The format a render captures its frames in.
 *
 * Two independent reasons force PNG, and conflating them is how the encoder ends up
 * hunting for `frame_%06d.jpg` against files written as `.png`:
 *
 * - the output container keeps alpha, which JPEG cannot carry;
 * - motion blur is on, because the sub-frame samples are averaged pixel by pixel and
 *   JPEG samples would be averaged after a lossy quantization.
 *
 * Every consumer of "is this render PNG" reads the resolved capture format rather than
 * re-deriving it from one of the reasons.
 */
export function resolveCaptureImageFormat(input: {
  needsAlpha: boolean;
  motionBlur: MotionBlurOptions | undefined;
}): "jpeg" | "png" {
  return input.needsAlpha || input.motionBlur ? "png" : "jpeg";
}
