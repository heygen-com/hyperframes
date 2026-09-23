/**
 * assembleStage — Stage 6 of `executeRenderJob`. Final mux + faststart.
 *
 * Skipped entirely for png-sequence (there's no container to mux; the
 * frames were copied directly to `outputPath` by `encodeStage`).
 *
 * When the composition has audio, runs `muxVideoWithAudio(videoOnlyPath,
 * audioOutputPath, outputPath)`. When it doesn't, runs
 * `applyFaststart(videoOnlyPath, outputPath)` to move the `moov` atom to
 * the front so the file plays from a partial download.
 *
 * `format: "hls"` replaces both with a single `packageHls` stream-copy into an
 * HLS VOD directory. The audio normalization above it is unchanged — the
 * packager needs the same frame-exact AAC sidecar the mp4 mux does.
 *
 * Hard constraints preserved verbatim:
 *   - The "Assembling final video" `updateJobStatus` payload fires at
 *     90% at the start of the stage.
 *   - "Audio muxing failed: <err>" / "Faststart failed: <err>" throw
 *     verbatim on the respective `success: false` results.
 */

import { applyFaststart, muxVideoWithAudio, packageHls } from "@hyperframes/engine";
import { extname } from "node:path";
import type { ProgressCallback, RenderJob } from "../../renderOrchestrator.js";
import { padOrTrimAudioToVideoFrameCount } from "../audioPadTrim.js";
import { encoderFailureError } from "../encoderInterruption.js";
import { DEFAULT_HLS_SEGMENT_SECONDS } from "../hlsConfig.js";
import type { RenderOutputFormat } from "../renderFormat.js";
import { updateJobStatus } from "../shared.js";

export interface AssembleStageInput {
  job: RenderJob;
  /** Encoded video produced by `encodeStage` or `captureStreamingStage`. */
  videoOnlyPath: string;
  /** Mixed audio path (only read when `hasAudio` is true). */
  audioOutputPath: string;
  /** Final on-disk output. A directory when `format` is `"hls"`. */
  outputPath: string;
  hasAudio: boolean;
  /**
   * Output container. Only `"hls"` changes this stage's behavior; every other
   * format (and `undefined`, for direct callers) takes the mux/faststart path.
   */
  format?: RenderOutputFormat;
  /** Segment length for `format: "hls"`. Defaults to {@link DEFAULT_HLS_SEGMENT_SECONDS}. */
  hlsSegmentSeconds?: number;
  abortSignal: AbortSignal | undefined;
  assertNotAborted: () => void;
  onProgress?: ProgressCallback;
}

export interface AssembleStageResult {
  /** Wall-clock ms for the assemble phase. */
  assembleMs: number;
}

export async function runAssembleStage(input: AssembleStageInput): Promise<AssembleStageResult> {
  const {
    job,
    videoOnlyPath,
    audioOutputPath,
    outputPath,
    hasAudio,
    format,
    abortSignal,
    assertNotAborted,
    onProgress,
  } = input;
  const isHls = format === "hls";

  const stage6Start = Date.now();
  updateJobStatus(job, "assembling", "Assembling final video", 90, onProgress);

  if (hasAudio) {
    const audioExtension = extname(audioOutputPath);
    const audioStem = audioExtension
      ? audioOutputPath.slice(0, -audioExtension.length)
      : audioOutputPath;
    const normalizedAudioPath = `${audioStem}.duration-normalized.m4a`;
    const normalizeResult = await padOrTrimAudioToVideoFrameCount({
      videoPath: videoOnlyPath,
      audioPath: audioOutputPath,
      outputPath: normalizedAudioPath,
      signal: abortSignal,
    });
    assertNotAborted();
    if (!normalizeResult.success) {
      throw encoderFailureError("Audio duration normalization failed", normalizeResult);
    }
    if (isHls) {
      await runHlsPackaging(input, normalizeResult.outputPath);
    } else {
      const muxResult = await muxVideoWithAudio(
        videoOnlyPath,
        normalizeResult.outputPath,
        outputPath,
        abortSignal,
        {
          audioCodec: "aac",
        },
        job.config.fps,
      );
      assertNotAborted();
      if (!muxResult.success) {
        throw encoderFailureError("Audio muxing failed", muxResult);
      }
    }
  } else if (isHls) {
    await runHlsPackaging(input, null);
  } else {
    const faststartResult = await applyFaststart(
      videoOnlyPath,
      outputPath,
      abortSignal,
      undefined,
      job.config.fps,
    );
    assertNotAborted();
    if (!faststartResult.success) {
      throw encoderFailureError("Faststart failed", faststartResult);
    }
  }

  return { assembleMs: Date.now() - stage6Start };
}

/**
 * Stream-copy the encoded video (plus the already-normalized AAC sidecar, when
 * there is one) into the HLS VOD directory at `outputPath`. No re-encode, so
 * this runs at copy speed regardless of composition length.
 */
async function runHlsPackaging(
  input: AssembleStageInput,
  normalizedAudioPath: string | null,
): Promise<void> {
  const packageResult = await packageHls(
    input.videoOnlyPath,
    normalizedAudioPath,
    input.outputPath,
    {
      segmentSeconds: input.hlsSegmentSeconds ?? DEFAULT_HLS_SEGMENT_SECONDS,
      signal: input.abortSignal,
    },
  );
  input.assertNotAborted();
  if (!packageResult.success) {
    throw encoderFailureError("HLS packaging failed", packageResult);
  }
}
