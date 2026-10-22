/**
 * Fail-fast gates for `chromaSubsampling: "444"`.
 *
 * 4:4:4 is only worth shipping when every stage keeps full-resolution colour: the
 * capture (PNG, see `resolveCaptureSurface`) and the encode (libx264 yuv444p). These
 * gates refuse the combinations where some stage would quietly drop back to 4:2:0,
 * because the output would look like a 4:4:4 master while carrying 4:2:0 colour.
 */

import type { ChromaSubsampling } from "@hyperframes/engine";

export interface ChromaSubsamplingRenderConfig {
  chromaSubsampling?: ChromaSubsampling;
  format?: string;
  hdrMode?: "auto" | "force-hdr" | "force-sdr";
  useGpu?: boolean;
}

/**
 * Reject the config combinations 4:4:4 cannot honor. No-op unless "444" is requested,
 * so this runs unconditionally at the top of `executeRenderJob`.
 */
export function validateChromaSubsamplingConfig(config: ChromaSubsamplingRenderConfig): void {
  if (config.chromaSubsampling !== "444") return;

  const format = config.format ?? "mp4";
  if (format !== "mp4") {
    throw new Error(
      `[Render] chromaSubsampling "444" supports format "mp4" only (got "${format}"). ` +
        `WebM, MOV and GIF use their own pixel formats, and HLS targets broad playback. ` +
        `Use --format mp4, or drop --chroma-subsampling 444.`,
    );
  }

  if (config.hdrMode === "force-hdr") {
    throw new Error(
      `[Render] chromaSubsampling "444" is SDR only; HDR output stays 10-bit 4:2:0 H.265. ` +
        `Drop --hdr, or drop --chroma-subsampling 444.`,
    );
  }

  // GPU encoders disagree on 4:4:4 (VAAPI uploads NV12, VideoToolbox and AMF H.264
  // have no 4:4:4 profile), so a GPU render would silently fall back to 4:2:0 on
  // some hosts and not others.
  if (config.useGpu === true) {
    throw new Error(
      `[Render] chromaSubsampling "444" requires the software encoder (libx264); ` +
        `GPU encoders do not reliably support 4:4:4. Re-run without --gpu.`,
    );
  }
}

/**
 * Reject 4:4:4 once auto HDR detection has found HDR sources, before any capture
 * runs. `validateChromaSubsamplingConfig` cannot see this: it depends on probing.
 */
export function assertChromaSubsamplingSdr(
  config: Pick<ChromaSubsamplingRenderConfig, "chromaSubsampling">,
  hasHdrContent: boolean,
): void {
  if (config.chromaSubsampling !== "444" || !hasHdrContent) return;
  throw new Error(
    `[Render] chromaSubsampling "444" is SDR only, but this composition has HDR sources. ` +
      `Re-run with --sdr (hdrMode "force-sdr"), or drop --chroma-subsampling 444.`,
  );
}
