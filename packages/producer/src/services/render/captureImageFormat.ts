import type { ChromaSubsampling, EngineConfig, MotionBlurOptions } from "@hyperframes/engine";

/**
 * The format a render captures its frames in.
 *
 * Three independent reasons force PNG, and conflating them is how the encoder ends up
 * hunting for `frame_%06d.jpg` against files written as `.png`:
 *
 * - the output container keeps alpha, which JPEG cannot carry;
 * - motion blur is on, because the sub-frame samples are averaged pixel by pixel and
 *   JPEG samples would be averaged after a lossy quantization;
 * - 4:4:4 output, because Chrome's quality-100 JPEG is already chroma-subsampled 4:2:0
 *   on beginFrame and screenshot capture, and drawElement can fall back to screenshot
 *   mid-render, so PNG is the only capture that keeps full-resolution colour.
 *
 * Every consumer of "is this render PNG" reads the resolved capture format rather than
 * re-deriving it from one of the reasons.
 */
export function resolveCaptureImageFormat(input: {
  needsAlpha: boolean;
  motionBlur: MotionBlurOptions | undefined;
  chromaSubsampling?: ChromaSubsampling;
}): "jpeg" | "png" {
  return input.needsAlpha || input.motionBlur || input.chromaSubsampling === "444" ? "png" : "jpeg";
}

/**
 * Below 100, Chrome's JPEG turns graded colour and grain into 8x8 chroma blotches that survive
 * the final encode. Draft keeps the smaller, faster frames.
 */
export function resolveCaptureJpegQuality(quality: EngineConfig["quality"]): number {
  return quality === "draft" ? 80 : 100;
}

/**
 * The capture fields every session of a render shares. The probe session is reused for
 * capture, so the probe and the main capture options both spread this.
 */
export function resolveCaptureSurface(
  input: Parameters<typeof resolveCaptureImageFormat>[0],
  quality: EngineConfig["quality"],
): { format: "jpeg" | "png"; quality: number | undefined; transparent: boolean } {
  const format = resolveCaptureImageFormat(input);
  return {
    format,
    quality: format === "png" ? undefined : resolveCaptureJpegQuality(quality),
    transparent: input.needsAlpha,
  };
}
