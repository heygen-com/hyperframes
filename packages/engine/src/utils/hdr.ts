/**
 * HDR Color Space Utilities
 *
 * Centralized HDR detection, transfer type handling, and FFmpeg color
 * parameter generation for the HDR rendering pipeline.
 */

import type { VideoColorSpace } from "./ffprobe.js";

export type HdrTransfer = "hlg" | "pq";

/**
 * Check if a video's color space indicates HDR content.
 * Re-exported from videoFrameExtractor for backward compatibility.
 */
export function isHdrColorSpace(cs: VideoColorSpace | null): boolean {
  if (!cs) return false;
  // BT.2020 describes a color gamut/matrix, not a dynamic range. SDR media
  // can legitimately carry BT.2020 primaries with a BT.709 transfer. Only
  // the transfer function distinguishes HDR here: PQ (SMPTE 2084) or HLG.
  return cs.colorTransfer === "smpte2084" || cs.colorTransfer === "arib-std-b67";
}

/**
 * Determine the HDR transfer function from a video's color space metadata.
 *
 * IMPORTANT: Callers must gate on `isHdrColorSpace(cs)` first. This function
 * assumes the input has already been classified as HDR and defaults ambiguous
 * inputs to "hlg" — calling it with an SDR color space silently returns "hlg",
 * which is wrong for SDR.
 *
 * Returns "pq" for SMPTE 2084, "hlg" for ARIB STD-B67, defaults to "hlg".
 */
export function detectTransfer(cs: VideoColorSpace | null): HdrTransfer {
  if (cs?.colorTransfer === "smpte2084") return "pq";
  return "hlg";
}

/**
 * HDR static metadata for the encoded stream.
 *
 * `masterDisplay` is the SMPTE ST 2086 mastering-display color volume string
 * accepted by x265 (`G(Gx,Gy)B(Bx,By)R(Rx,Ry)WP(WPx,WPy)L(Lmax,Lmin)`).
 * Chromaticity values are scaled by 50000 (0.00002 cd/m² per unit) and
 * luminance values by 10000 (0.0001 cd/m² per unit).
 *
 * `maxCll` is the CTA-861.3 Content Light Level pair `MaxCLL,MaxFALL` in
 * cd/m². Without these SEI messages, downstream players (Apple QuickTime,
 * YouTube, HDR TVs) treat the stream as SDR BT.2020 and tone-map incorrectly
 * — see packages/producer/scripts/hdr-smoke.ts for the regression assertion.
 */
export interface HdrMasteringMetadata {
  masterDisplay: string;
  maxCll: string;
}

/**
 * Default HDR10 mastering metadata: P3-D65 primaries inside a BT.2020
 * container, mastered for 0.0001–1000 cd/m² with MaxCLL=1000, MaxFALL=400.
 *
 * These are conservative defaults that match how most HDR10 grading suites
 * (Premiere, DaVinci Resolve) tag content when per-frame measured values
 * aren't available. A future PR can plumb measured MaxCLL through `--hdr-opt`.
 */
export const DEFAULT_HDR10_MASTERING: HdrMasteringMetadata = {
  masterDisplay: "G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1)",
  maxCll: "1000,400",
};

export interface HdrEncoderColorParams {
  colorPrimaries: string;
  colorTrc: string;
  colorspace: string;
  pixelFormat: string;
  /**
   * Full x265-params string including color tagging and HDR static metadata.
   * Pass directly to `-x265-params` (concatenate with other options via `:`).
   */
  x265ColorParams: string;
  /** The mastering metadata that was baked into `x265ColorParams`. */
  mastering: HdrMasteringMetadata;
}

/**
 * Get FFmpeg encoder color parameters for a given HDR transfer function.
 *
 * The returned `x265ColorParams` includes both color tagging
 * (`colorprim`/`transfer`/`colormatrix`) and HDR static metadata
 * (`master-display`/`max-cll`). Without the static metadata the encoded
 * stream is rejected as SDR by most HDR-aware players and CDNs.
 */
export function getHdrEncoderColorParams(
  transfer: HdrTransfer,
  mastering: HdrMasteringMetadata = DEFAULT_HDR10_MASTERING,
): HdrEncoderColorParams {
  const colorTrc = transfer === "pq" ? "smpte2084" : "arib-std-b67";
  const tagging = `colorprim=bt2020:transfer=${colorTrc}:colormatrix=bt2020nc`;
  const metadata = `master-display=${mastering.masterDisplay}:max-cll=${mastering.maxCll}`;
  return {
    colorPrimaries: "bt2020",
    colorTrc,
    colorspace: "bt2020nc",
    pixelFormat: "yuv420p10le",
    x265ColorParams: `${tagging}:${metadata}`,
    mastering,
  };
}

export interface CompositionHdrInfo {
  hasHdr: boolean;
  dominantTransfer: HdrTransfer | null;
}

/**
 * Analyze a set of video color spaces to determine if the composition
 * contains HDR content and what the dominant transfer function is.
 */
export function analyzeCompositionHdr(
  colorSpaces: Array<VideoColorSpace | null>,
): CompositionHdrInfo {
  let hasPq = false;
  let hasHdr = false;

  for (const cs of colorSpaces) {
    if (!isHdrColorSpace(cs)) continue;
    hasHdr = true;
    if (cs?.colorTransfer === "smpte2084") hasPq = true;
  }

  if (!hasHdr) return { hasHdr: false, dominantTransfer: null };

  // PQ takes priority — it's the more common HDR10 format
  const dominantTransfer: HdrTransfer = hasPq ? "pq" : "hlg";
  return { hasHdr: true, dominantTransfer };
}
