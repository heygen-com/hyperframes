/**
 * HDR passthrough composite: one ffmpeg run that overlays the cached state
 * PNGs onto the source HDR video and encodes the video-only output.
 */

import type { CompositeRequest, CompositeResult } from "./types.js";

/**
 * Contract (pure; exported for argument-level unit tests):
 *
 * Builds the full ffmpeg argv (without the binary) for `compositeAndEncode`.
 *   - Input 0: the source video, seeked to `video.mediaStart` with the same
 *     seek normalization the HDR extraction uses (`ffmpegSeekSeconds`,
 *     `captureHdrResources.ts` extractHdrVideoFrames), `-t video.duration`.
 *   - Input 1: the overlay PNG sequence via the concat demuxer
 *     (`-f concat -safe 0 -i <concatListPath>`), one `file` + `duration`
 *     per state (`(endFrame - startFrame) / fps`), last file repeated per
 *     concat-demuxer convention.
 *   - Filter: video → `fps=<fps>` → same scale/crop as the extraction when
 *     the source size differs from the canvas → `format=gbrp16le`
 *     (signal-space RGB, the same rgb48le the layered blend works in);
 *     overlays → `format=rgba64le`; `overlay=format=gbrp16le` (straight
 *     alpha, `eof_action=pass`, `shortest` off); then
 *     `hdrFrameTagsFilter(transfer)` and `format=<preset.pixelFormat>`.
 *   - Encoder: identical to the layered stage's `spawnStreamingEncoder`
 *     options (codec, preset, crf/bitrate, delivery caps, GOP lock, GPU
 *     selection, `-x265-params` from `getHdrEncoderColorParams`, colour tags
 *     `bt2020` / `arib-std-b67|smpte2084` / `bt2020nc`, `-tag:v hvc1`);
 *     reuse the encoder half of engine `buildStreamingArgs` rather than
 *     re-deriving it. `-frames:v plan.totalFrames`, `-an`, `-y outputPath`.
 *
 * Exported for compositeAndEncode and its tests; drop the fallow suppression once it is used.
 */
// fallow-ignore-next-line unused-export
export function buildCompositeArgs(request: CompositeRequest, concatListPath: string): string[] {
  void request;
  void concatListPath;
  throw new Error("hdrPassthrough: buildCompositeArgs not implemented");
}

/**
 * Contract:
 *
 * Writes the concat list into `request.workDir`, runs ffmpeg with
 * `buildCompositeArgs` under `request.abortSignal` (engine `runFfmpeg` with
 * `-progress` parsing), forwards ffmpeg's encoded-frame count to
 * `onFramesEncoded`, and resolves with timing + size. Throws (caller falls
 * back) on non-zero exit, on `framesEncoded !== plan.totalFrames`, or when
 * `outputPath` is missing/empty. Rethrows aborts unchanged.
 */
export async function compositeAndEncode(request: CompositeRequest): Promise<CompositeResult> {
  void request;
  throw new Error("hdrPassthrough: compositeAndEncode not implemented");
}
