/**
 * HLS render-config resolution and the fail-fast gates for `format: "hls"`.
 *
 * Kept out of `renderOrchestrator.ts` so the three things HLS needs from the
 * config — a validated segment length, the derived GOP size, and the
 * combinations it refuses — are testable without standing up a render.
 *
 * The load-bearing invariant: `-c copy -f hls` can only cut a segment at an
 * existing keyframe, so the encode must place an IDR exactly every
 * `segmentSeconds × fps` frames. `resolveHlsGopSize` computes that number and
 * the orchestrator hands it to the encoder as
 * `lockGopForChunkConcat: true, gopSize`.
 */

import { fpsToNumber, type Fps } from "@hyperframes/core";

/** ffmpeg's own `-hls_time` default is 2 s; 4 s is the VOD consumer's ask. */
export const DEFAULT_HLS_SEGMENT_SECONDS = 4;

export interface HlsRenderConfig {
  format?: string;
  hlsSegmentSeconds?: number;
  hdrMode?: "auto" | "force-hdr" | "force-sdr";
  useGpu?: boolean;
}

/**
 * Reject the config combinations HLS cannot honor. No-op for every other
 * format, so this runs unconditionally at the top of `executeRenderJob`.
 *
 * Both rejections are hard errors rather than warnings-with-fallback: each one
 * would otherwise produce a playable-looking directory that violates the
 * segment contract the consumer relies on, with nothing in the output to say so.
 */
export function validateHlsRenderConfig(config: HlsRenderConfig): void {
  if (config.format !== "hls") return;

  const segmentSeconds = config.hlsSegmentSeconds;
  if (segmentSeconds !== undefined && (!Number.isInteger(segmentSeconds) || segmentSeconds <= 0)) {
    throw new Error(
      `[Render] hlsSegmentSeconds must be a positive integer (got ${String(segmentSeconds)}). ` +
        `Whole seconds keep the integer #EXT-X-TARGETDURATION ffmpeg writes honest.`,
    );
  }

  if (config.hdrMode === "force-hdr") {
    throw new Error(
      `[Render] format "hls" does not support hdrMode "force-hdr". HLS v1 is SDR only ` +
        `(H.264 + AAC in MPEG-TS); HDR10 would need fMP4 segments and HEVC. ` +
        `Use --format mp4 for HDR10 output, or drop --hdr.`,
    );
  }

  // The GOP lock is software-encoder only (see `appendLockedGopArgs` in
  // @hyperframes/engine). A GPU encode ignores it and emits its own keyframe
  // cadence — nvenc's ~250-frame default gives 8 s segments at 30 fps instead
  // of 4 s, while videotoolbox's much denser keyframes happen to segment
  // correctly. That asymmetry means a GPU HLS render passes on a Mac and ships
  // wrong segment lengths from Linux, so refuse the combination outright.
  if (config.useGpu === true) {
    throw new Error(
      `[Render] format "hls" does not support GPU encoding. Fixed-length segments require ` +
        `the software encoder's forced-keyframe lock, which GPU encoders ignore. ` +
        `Re-run without --gpu.`,
    );
  }
}

/** The validated segment length, or the 4 s default. */
export function resolveHlsSegmentSeconds(config: HlsRenderConfig): number {
  return config.hlsSegmentSeconds ?? DEFAULT_HLS_SEGMENT_SECONDS;
}

/**
 * Frames per segment. `Math.round` (not floor) so fractional rates land on the
 * nearest whole frame: 30000/1001 × 4 → 120 frames → 4.004 s segments, which
 * still reports `#EXT-X-TARGETDURATION:4` because the spec rounds to nearest.
 * Clamped to >= 1 — the engine throws on a non-positive `gopSize`, and a
 * pathologically low fps must not turn that into a render-time crash.
 */
export function resolveHlsGopSize(fps: Fps, segmentSeconds: number): number {
  return Math.max(1, Math.round(fpsToNumber(fps) * segmentSeconds));
}

/**
 * The `EncoderOptions` pair that forces the keyframe cadence, ready to spread
 * into both encoder inputs.
 *
 * Returned as one object rather than two locals on purpose: the streaming
 * encoder and the disk/chunked encoder must receive *identical* values, and a
 * render that reaches only one of them still succeeds — it just produces
 * variable-length segments with nothing in the output to say so. Spreading one
 * value at both call sites makes them unable to disagree.
 *
 * Non-HLS formats get `lockGopForChunkConcat: false` and no `gopSize`, which
 * is what every encoder path already did before HLS existed.
 */
export function resolveHlsEncoderGopLock(
  outputFormat: string,
  fps: Fps,
  segmentSeconds: number | undefined,
): { lockGopForChunkConcat: boolean; gopSize: number | undefined } {
  if (outputFormat !== "hls") return { lockGopForChunkConcat: false, gopSize: undefined };
  return {
    lockGopForChunkConcat: true,
    gopSize: resolveHlsGopSize(fps, segmentSeconds ?? DEFAULT_HLS_SEGMENT_SECONDS),
  };
}
