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

import {
  applyFaststart,
  muxVideoWithAudio,
  serializeFfmetadataChapters,
  type FfmetadataChapter,
} from "@hyperframes/engine";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import type { ProgressCallback, RenderJob } from "../../renderOrchestrator.js";
import { padOrTrimAudioToVideoFrameCount } from "../audioPadTrim.js";
import { encoderFailureError } from "../encoderInterruption.js";
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
  /** Authored chapters to mux into MP4/MOV. Empty or omitted skips the extra input. */
  chapters?: readonly FfmetadataChapter[];
}

export interface AssembleStageResult {
  /** Wall-clock ms for the assemble phase. */
  assembleMs: number;
}

function warnChapterMuxFailure(job: RenderJob, error: string | undefined): void {
  const message = `Chapter metadata mux failed; writing video without chapters${error ? `: ${error}` : ""}`;
  const logger = job.config.logger;
  if (logger && typeof logger.warn === "function") logger.warn(message);
  else console.warn(message);
}

function writeChaptersFfmetadata(
  videoOnlyPath: string,
  chapters: readonly FfmetadataChapter[] | undefined,
  durationSeconds: number,
): string | undefined {
  if (!chapters || chapters.length === 0) return undefined;
  const chaptersPath = `${videoOnlyPath}.chapters.ffmetadata`;
  writeFileSync(chaptersPath, serializeFfmetadataChapters(chapters, durationSeconds));
  return chaptersPath;
}

function removeChaptersFfmetadata(chaptersPath: string | undefined): void {
  if (!chaptersPath || !existsSync(chaptersPath)) return;
  try {
    unlinkSync(chaptersPath);
  } catch {
    /* temp file cleanup is best-effort */
  }
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
    chapters,
  } = input;

  const stage6Start = Date.now();
  updateJobStatus(job, "assembling", "Assembling final video", 90, onProgress);

  const chaptersPath = writeChaptersFfmetadata(videoOnlyPath, chapters, job.duration);
  try {
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
      let muxResult = await muxVideoWithAudio(
        videoOnlyPath,
        normalizeResult.outputPath,
        outputPath,
        abortSignal,
        {
          audioCodec: "aac",
          ...(chaptersPath ? { chaptersFfmetadataPath: chaptersPath } : {}),
        },
        job.config.fps,
      );
      if (
        !muxResult.success &&
        chaptersPath &&
        muxResult.failureReason !== "external_interruption"
      ) {
        warnChapterMuxFailure(job, muxResult.error);
        muxResult = await muxVideoWithAudio(
          videoOnlyPath,
          normalizeResult.outputPath,
          outputPath,
          abortSignal,
          { audioCodec: "aac" },
          job.config.fps,
        );
      }
      assertNotAborted();
      if (!muxResult.success) {
        throw encoderFailureError("Audio muxing failed", muxResult);
      }
    } else {
      let faststartResult = await applyFaststart(
        videoOnlyPath,
        outputPath,
        abortSignal,
        chaptersPath ? { chaptersFfmetadataPath: chaptersPath } : undefined,
        job.config.fps,
      );
      if (
        !faststartResult.success &&
        chaptersPath &&
        faststartResult.failureReason !== "external_interruption"
      ) {
        warnChapterMuxFailure(job, faststartResult.error);
        faststartResult = await applyFaststart(
          videoOnlyPath,
          outputPath,
          abortSignal,
          undefined,
          job.config.fps,
        );
      }
      assertNotAborted();
      if (!faststartResult.success) {
        throw encoderFailureError("Faststart failed", faststartResult);
      }
    }
  } finally {
    removeChaptersFfmetadata(chaptersPath);
  }

  return { assembleMs: Date.now() - stage6Start };
}
