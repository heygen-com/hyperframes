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
 * Hard constraints preserved verbatim:
 *   - The "Assembling final video" `updateJobStatus` payload fires at
 *     90% at the start of the stage.
 *   - "Audio muxing failed: <err>" / "Faststart failed: <err>" throw
 *     verbatim on the respective `success: false` results.
 */

import { applyFaststart, muxVideoWithAudio } from "@hyperframes/engine";
import type { ProgressCallback, RenderJob } from "../../renderOrchestrator.js";
import { updateJobStatus } from "../shared.js";

export interface AssembleStageInput {
  job: RenderJob;
  /** Encoded video produced by `encodeStage` or `captureStreamingStage`. */
  videoOnlyPath: string;
  /** Mixed audio path (only read when `hasAudio` is true). */
  audioOutputPath: string;
  /** Final on-disk output. */
  outputPath: string;
  hasAudio: boolean;
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
    abortSignal,
    assertNotAborted,
    onProgress,
  } = input;

  const stage6Start = Date.now();
  updateJobStatus(job, "assembling", "Assembling final video", 90, onProgress);

  if (hasAudio) {
    const muxResult = await muxVideoWithAudio(
      videoOnlyPath,
      audioOutputPath,
      outputPath,
      abortSignal,
      { audioCodec: "aac" },
      job.config.fps,
    );
    assertNotAborted();
    if (!muxResult.success) {
      throw new Error(`Audio muxing failed: ${muxResult.error}`);
    }
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
      throw new Error(`Faststart failed: ${faststartResult.error}`);
    }
  }

  return { assembleMs: Date.now() - stage6Start };
}
