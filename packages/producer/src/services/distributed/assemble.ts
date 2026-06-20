/**
 * Activity C of the distributed render pipeline.
 *
 * `assemble(planDir, chunkPaths, audioPath, outputPath)` stitches per-chunk
 * outputs into the final deliverable. For mp4 / mov / webm this is
 * `ffmpeg -f concat -c copy` (free of re-encode loss because every
 * chunk's first frame is an IDR keyframe — the chunk encoder sets
 * `lockGopForChunkConcat` to enforce this, which for libvpx-vp9 also
 * disables alt-ref frames so concat seams remain independently
 * decodable). For png-sequence chunks (each chunk is a directory of
 * frames) this is a straight directory merge with global re-numbering.
 *
 * Mux + faststart for mp4 / mov / webm go through the engine's
 * `muxVideoWithAudio` + `applyFaststart` helpers — same path the
 * in-process renderer uses; we just feed concat output rather than
 * streaming-encoder output. (Faststart is a no-op for webm and mov —
 * applyFaststart copies the input verbatim.) Audio length is
 * pad-or-trimmed to `frameCount / fps` via
 * `padOrTrimAudioToVideoFrameCount` so the mux step doesn't introduce
 * sub-millisecond drift at the end of long renders.
 *
 * Pure function over local paths. No networking. The caller is responsible
 * for moving `outputPath` to its orchestration-level storage.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { applyFaststart, muxVideoWithAudio, runFfmpeg } from "@hyperframes/engine";
import { fpsToFfmpegArg } from "@hyperframes/core";
import { defaultLogger, type ProducerLogger } from "../../logger.js";
import { formatExportFrameName } from "../../utils/paths.js";
import { padOrTrimAudioToVideoFrameCount } from "../render/audioPadTrim.js";
import type { ChunkSliceJson } from "../render/stages/freezePlan.js";
import type { DistributedFormat } from "./shared.js";

/**
 * Result of {@link assemble}. `fileSize` reflects the final file on disk
 * (mp4/mov) or the cumulative byte total of the frame directory
 * (png-sequence).
 */
export interface AssembleResult {
  outputPath: string;
  durationMs: number;
  framesEncoded: number;
  fileSize: number;
}

/** Shape of the planDir's top-level `plan.json` — only the fields `assemble` needs. */
interface PlanJsonForAssemble {
  planHash: string;
  totalFrames: number;
  hasAudio: boolean;
  dimensions: {
    fpsNum: number;
    fpsDen: number;
    width: number;
    height: number;
    format: DistributedFormat;
  };
}

/**
 * Assemble the chunk outputs into a single deliverable.
 *
 * @param planDir — absolute path to the planDir produced by `plan()`.
 * @param chunkPaths — ordered chunk outputs, length === `chunks.json` length.
 *   For mp4/mov each entry is a path to an encoded chunk file; for
 *   png-sequence each entry is a path to a directory of frames.
 * @param audioPath — `<planDir>/audio.aac` for mux'd formats. Pass `null`
 *   when the composition has no audio (or `assemble` is being called for a
 *   format whose audio is muxed elsewhere). `assemble` always normalizes
 *   audio length against the assembled video's frame count when
 *   `audioPath` is non-null.
 * @param outputPath — final on-disk output (file for mp4/mov; directory
 *   for png-sequence — created if missing).
 */
export async function assemble(
  planDir: string,
  chunkPaths: readonly string[],
  audioPath: string | null,
  outputPath: string,
  options?: {
    logger?: ProducerLogger;
    abortSignal?: AbortSignal;
    /**
     * Opt-in exact-CFR re-encode. When `true`, the assembled video is
     * re-encoded once at the end of the concat/single-chunk step with
     * `-fps_mode cfr -r <fps>` so the stream-level `avg_frame_rate`
     * matches the container's `r_frame_rate` exactly (and the file's
     * duration lands on the requested `frameCount / fps` to ms
     * precision, with no PTS-derived drift). Trade-off: ~2-5x the
     * stitch time for a 60s 1080p clip plus second-generation H.264
     * quality loss (negligible at `-crf 18` but non-zero). Default
     * `false` preserves the existing `-c copy` behavior. mp4 only
     * (libx264); webm / mov pass through unchanged because their
     * stream-copy paths don't exhibit the same avg-frame-rate drift.
     */
    cfr?: boolean;
  },
): Promise<AssembleResult> {
  const start = Date.now();
  const log = options?.logger ?? defaultLogger;
  const abortSignal = options?.abortSignal;
  const cfr = options?.cfr === true;

  // ── 1. Validate planDir manifest matches chunkPaths shape ──────────────
  const planJsonPath = join(planDir, "plan.json");
  const chunksJsonPath = join(planDir, "meta", "chunks.json");
  if (!existsSync(planJsonPath)) {
    throw new Error(`[assemble] planDir missing plan.json: ${planJsonPath}`);
  }
  if (!existsSync(chunksJsonPath)) {
    throw new Error(`[assemble] planDir missing meta/chunks.json: ${chunksJsonPath}`);
  }
  const plan = JSON.parse(readFileSync(planJsonPath, "utf-8")) as PlanJsonForAssemble;
  const chunks = JSON.parse(readFileSync(chunksJsonPath, "utf-8")) as ChunkSliceJson[];
  if (chunkPaths.length !== chunks.length) {
    throw new Error(
      `[assemble] chunkPaths length (${chunkPaths.length}) does not match ` +
        `chunks.json length (${chunks.length}). Adapters must pass one path ` +
        `per chunk, ordered by index.`,
    );
  }
  for (const path of chunkPaths) {
    if (!existsSync(path)) {
      throw new Error(`[assemble] chunk path does not exist: ${path}`);
    }
  }

  if (plan.dimensions.format === "png-sequence") {
    // ── 2a. png-sequence: merge frame directories with global re-numbering
    return mergePngFrameDirs(chunkPaths, outputPath, plan.totalFrames, audioPath, start);
  }

  // ── 2b. mp4 / mov / webm: concat-copy then mux + faststart ────────────
  if (!existsSync(dirname(outputPath))) {
    mkdirSync(dirname(outputPath), { recursive: true });
  }
  const workDir = `${outputPath}.assemble-work`;
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  try {
    const concatOutputPath = join(workDir, `concat.${plan.dimensions.format}`);
    const fpsArg = fpsToFfmpegArg({
      num: plan.dimensions.fpsNum,
      den: plan.dimensions.fpsDen,
    });

    // Single-chunk renders bypass the concat demuxer entirely. ffmpeg's
    // concat demuxer with a one-entry list re-runs as a straight remux of
    // the single source, and in that path the input-side `-r` flag does
    // not consistently override the source's PTS-derived r_frame_rate
    // (observed: `359/12` carrying through to the output container while
    // the equivalent multi-chunk path produces `30/1` exact). Running a
    // direct `-c copy` remux with `-r <fps>` as an output flag gives the
    // muxer the authoritative rate to stamp into the container without
    // touching the encoded stream. Multi-chunk renders continue through
    // the concat demuxer where the existing `-r` input flag works.
    if (chunkPaths.length === 1) {
      const remuxArgs = ["-i", chunkPaths[0]!, "-c", "copy", "-r", fpsArg, "-y", concatOutputPath];
      const remuxResult = await runFfmpeg(remuxArgs, { signal: abortSignal });
      if (!remuxResult.success) {
        throw new Error(
          `[assemble] ffmpeg single-chunk remux failed (exit ${remuxResult.exitCode}): ` +
            `${remuxResult.stderr.slice(-400)}`,
        );
      }
    } else {
      // Concat list file — one `file '<path>'` per chunk, in order. ffmpeg's
      // concat demuxer escapes single quotes via `'\''`; we replicate that
      // here so chunk paths containing quotes don't break the parser.
      const concatListPath = join(workDir, "concat-list.txt");
      const concatBody = chunkPaths
        .map((path) => `file '${path.replace(/'/g, "'\\''")}'`)
        .join("\n");
      writeFileSync(concatListPath, `${concatBody}\n`, "utf-8");

      // Set the exact input framerate so the concat demuxer doesn't
      // PTS-average a fractional rational like `360000/12001` instead
      // of `30/1` into the output container metadata. `-c copy` is
      // retained; no re-encode.
      const concatArgs = [
        "-r",
        fpsArg,
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatListPath,
        "-c",
        "copy",
        "-y",
        concatOutputPath,
      ];
      const concatResult = await runFfmpeg(concatArgs, { signal: abortSignal });
      if (!concatResult.success) {
        throw new Error(
          `[assemble] ffmpeg concat-copy failed (exit ${concatResult.exitCode}): ` +
            `${concatResult.stderr.slice(-400)}`,
        );
      }
    }

    // ── 2c. Optional exact-CFR re-encode ──────────────────────────────────
    // The concat / single-chunk step produces a stream-copy intermediate
    // whose container `r_frame_rate` is exact but whose stream-level
    // `avg_frame_rate` stays PTS-derived (concat-copy carries each chunk's
    // original PTS unmodified). For consumers that strict-check
    // `avg_frame_rate` or ms-precision duration (broadcast workflows,
    // frame-accurate compositors, some third-party transcoders), an
    // opt-in re-encode with `-fps_mode cfr -r <fps>` lands the stream's
    // avg-frame-rate on the requested rational exactly. Restricted to
    // mp4 / libx264 — webm and mov go through their own stream-copy
    // paths that don't exhibit the same avg-frame-rate drift, and h265
    // mp4 would silently transcode to h264 under the hardcoded
    // `-c:v libx264` re-encode (a typed throw is preferable to silent
    // codec loss).
    let postConcatPath = concatOutputPath;
    if (cfr) {
      if (plan.dimensions.format !== "mp4") {
        throw new Error(
          `[assemble] cfr=true is only supported for format="mp4" (got ` +
            `"${plan.dimensions.format}"). Stream-copy paths for webm and mov ` +
            `already produce exact avg_frame_rate; cfr re-encode is not needed.`,
        );
      }
      // Read `meta/encoder.json` to detect the chunk encoder. The cfr
      // re-encode hardcodes `-c:v libx264`; pairing it with h265 chunks
      // would silently transcode them to h264. Throw a typed error so the
      // caller surfaces the conflict instead of producing a wrong-codec
      // deliverable.
      const encoderJsonPath = join(planDir, "meta", "encoder.json");
      if (!existsSync(encoderJsonPath)) {
        throw new Error(`[assemble] planDir missing meta/encoder.json: ${encoderJsonPath}`);
      }
      const encoderJson = JSON.parse(readFileSync(encoderJsonPath, "utf-8")) as {
        encoder?: string;
      };
      if (encoderJson.encoder === "libx265-software") {
        throw new Error(
          `[assemble] cfr=true is not yet supported with codec: "h265". The ` +
            `cfr re-encode pass uses libx264 and would silently transcode the ` +
            `h265 chunks. Either disable cfr or render with codec: "h264".`,
        );
      }
      const cfrOutputPath = join(workDir, `cfr.${plan.dimensions.format}`);
      const cfrArgs = [
        "-i",
        concatOutputPath,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-fps_mode",
        "cfr",
        "-r",
        fpsArg,
        "-y",
        cfrOutputPath,
      ];
      const cfrResult = await runFfmpeg(cfrArgs, { signal: abortSignal });
      if (!cfrResult.success) {
        throw new Error(
          `[assemble] ffmpeg cfr re-encode failed (exit ${cfrResult.exitCode}): ` +
            `${cfrResult.stderr.slice(-400)}`,
        );
      }
      postConcatPath = cfrOutputPath;
      log.info("[assemble] cfr re-encode applied", {
        format: plan.dimensions.format,
        fpsNum: plan.dimensions.fpsNum,
        fpsDen: plan.dimensions.fpsDen,
      });
    }

    // ── 3. Audio: pad-or-trim then mux ────────────────────────────────────
    let audioForMux: string | null = null;
    if (audioPath !== null && existsSync(audioPath)) {
      const paddedAudioPath = join(workDir, "audio-padded.aac");
      const padTrimResult = await padOrTrimAudioToVideoFrameCount({
        videoPath: postConcatPath,
        audioPath,
        outputPath: paddedAudioPath,
      });
      if (!padTrimResult.success) {
        throw new Error(`[assemble] audio pad/trim failed: ${padTrimResult.error}`);
      }
      audioForMux = paddedAudioPath;
      log.info("[assemble] audio normalized for mux", {
        operation: padTrimResult.operation,
        targetDurationSeconds: padTrimResult.targetDurationSeconds,
        sourceDurationSeconds: padTrimResult.sourceDurationSeconds,
      });
    }

    // mux + faststart paths mirror `runAssembleStage` for in-process renders
    // (`render/stages/assembleStage.ts`). We can't call that stage directly
    // because it operates on a `RenderJob` and emits `updateJobStatus`
    // payloads — the distributed activity has no job to thread through.
    const muxOutputPath =
      audioForMux !== null ? join(workDir, `mux.${plan.dimensions.format}`) : postConcatPath;
    if (audioForMux !== null) {
      const muxResult = await muxVideoWithAudio(
        postConcatPath,
        audioForMux,
        muxOutputPath,
        abortSignal,
        { audioCodec: "aac" },
        { num: plan.dimensions.fpsNum, den: plan.dimensions.fpsDen },
      );
      if (!muxResult.success) {
        throw new Error(`[assemble] audio mux failed: ${muxResult.error}`);
      }
    }

    // applyFaststart is a no-op for `.mov` (it copies the input to output);
    // we still call it so the success path produces `outputPath` regardless.
    const faststartResult = await applyFaststart(
      muxOutputPath,
      outputPath,
      abortSignal,
      undefined,
      {
        num: plan.dimensions.fpsNum,
        den: plan.dimensions.fpsDen,
      },
    );
    if (!faststartResult.success) {
      throw new Error(`[assemble] faststart failed: ${faststartResult.error}`);
    }
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch (err) {
      log.warn("[assemble] failed to remove work dir", {
        workDir,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const fileSize = existsSync(outputPath) ? statSync(outputPath).size : 0;
  return {
    outputPath,
    durationMs: Date.now() - start,
    framesEncoded: plan.totalFrames,
    fileSize,
  };
}

/**
 * Merge per-chunk PNG frame directories into a single directory with
 * globally-incrementing frame numbers. Each chunk's `frame_NNNNNN.png` files
 * (which `renderChunk` writes normalized to zero per chunk) are re-numbered
 * into the merged output so consumers see one continuous numbered sequence.
 *
 * Audio is intentionally NOT muxed here — png-sequence has no container.
 * If `audioPath` is non-null we copy it alongside as `audio.aac` so callers
 * who need to re-mux later (After Effects, Nuke, ffmpeg image2 + audio) can
 * find it.
 */
function mergePngFrameDirs(
  chunkPaths: readonly string[],
  outputPath: string,
  totalFrames: number,
  audioPath: string | null,
  startTimeMs: number,
): AssembleResult {
  if (existsSync(outputPath)) rmSync(outputPath, { recursive: true, force: true });
  mkdirSync(outputPath, { recursive: true });

  let globalIdx = 0;
  for (const chunkDir of chunkPaths) {
    if (!statSync(chunkDir).isDirectory()) {
      throw new Error(
        `[assemble] png-sequence chunk must be a directory: ${chunkDir} (got a file)`,
      );
    }
    const frames = readdirSync(chunkDir)
      .filter((name) => name.endsWith(".png"))
      .sort();
    if (frames.length === 0) {
      throw new Error(`[assemble] png-sequence chunk has no frames: ${chunkDir}`);
    }
    for (const frame of frames) {
      const dst = join(outputPath, formatExportFrameName(globalIdx, "png"));
      cpSync(join(chunkDir, frame), dst);
      globalIdx += 1;
    }
  }

  if (globalIdx !== totalFrames) {
    // Don't throw — surface as a warning. Some compositions report total
    // frame count via the duration math (`ceil(duration * fps)`) but the
    // actual captured frame count can differ by ±1 across hosts in edge
    // cases. The merged sequence is still complete; consumers should rely
    // on the on-disk count.
    console.warn(
      `[assemble] png-sequence frame count mismatch: merged ${globalIdx} frames vs ` +
        `plan.totalFrames=${totalFrames}. Using on-disk count.`,
    );
  }

  // Pad-or-trim is encoder-side (audio length normalization for muxed
  // containers); png-sequence has no encoder, so we copy the audio
  // verbatim. The sidecar matches the in-process png-sequence convention.
  if (audioPath !== null && existsSync(audioPath)) {
    const sidecar = join(outputPath, "audio.aac");
    cpSync(audioPath, sidecar);
  }

  let fileSize = 0;
  for (const name of readdirSync(outputPath)) {
    try {
      fileSize += statSync(join(outputPath, name)).size;
    } catch {
      // ignore
    }
  }

  return {
    outputPath,
    durationMs: Date.now() - startTimeMs,
    framesEncoded: globalIdx,
    fileSize,
  };
}
