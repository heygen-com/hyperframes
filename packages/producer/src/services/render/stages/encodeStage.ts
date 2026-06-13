/**
 * encodeStage — Stage 5 of `executeRenderJob`. Two paths share the stage:
 *
 *   1. png-sequence: no encoder. Captured PNGs are renamed to
 *      `frame_NNNNNN.png` and copied to `outputPath`. Audio (if any) is
 *      written as an `audio.aac` sidecar.
 *   2. gif: runs a two-pass FFmpeg palette encode and writes directly to
 *      `outputPath`. GIF has no mux/faststart stage and ignores audio.
 *   3. mp4 / webm / mov: invokes `encodeFramesFromDir` (or the chunked-
 *      concat variant when `enableChunkedEncode` is on) to produce
 *      `videoOnlyPath`. The mux + faststart pass lives in `assembleStage`.
 *
 * Skipped entirely when the streaming-encode fusion path
 * (`captureStreamingStage`) already produced `videoOnlyPath` — the
 * sequencer gates the call on `!streamingHandled`.
 *
 * Hard constraints preserved verbatim:
 *   - The "Writing PNG sequence" / "Encoding video" `updateJobStatus`
 *     payload fires at 75% from inside the stage.
 *   - The png-sequence path throws "png-sequence output requested but no
 *     PNGs were captured to ..." if `framesDir` is empty.
 *   - The png-sequence audio sidecar is only written when
 *     `hasAudio && existsSync(audioOutputPath)`.
 *   - For encoded output, `enableChunkedEncode` selects
 *     `encodeFramesChunkedConcat` vs `encodeFramesFromDir` — same
 *     branch + same args.
 *   - `Encoding failed: <err>` throws on the encoder's
 *     `success: false`.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  encodeFramesChunkedConcat,
  encodeFramesFromDir,
  formatFfmpegError,
  getEncoderPreset,
  resolveConfig,
  runFfmpeg,
  type EngineConfig,
  type EncodeResult,
} from "@hyperframes/engine";
import type { Fps } from "@hyperframes/core";
import type { ProducerLogger } from "../../../logger.js";
import { formatExportFrameName } from "../../../utils/paths.js";
import type { ProgressCallback, RenderJob } from "../../renderOrchestrator.js";
import {
  buildGifPalettegenArgs,
  buildGifPaletteuseArgs,
  type GifEncodeArgsInput,
} from "./gifEncodeArgs.js";
import { updateJobStatus } from "../shared.js";

export interface EncodeStageInput {
  job: RenderJob;
  log: ProducerLogger;
  /** Output path: a directory for png-sequence, a file for everything else. */
  outputPath: string;
  /** Where captured frames live on disk. */
  framesDir: string;
  /** Encoded video output (ignored on the png-sequence path). */
  videoOnlyPath: string;
  /** Output dimensions (post-deviceScaleFactor). */
  width: number;
  height: number;
  /** True when the output format requires an alpha channel; selects frame extension. */
  needsAlpha: boolean;
  /** True iff the composition has audio. Drives the sidecar copy. */
  hasAudio: boolean;
  /**
   * Path to the mixed audio. Required when `hasAudio` is `true` (the
   * png-sequence sidecar copy reads it); ignored when `hasAudio` is
   * `false`. Distributed chunk workers mux audio once at assemble time
   * and pass `hasAudio: false` here, so the field is left optional.
   */
  audioOutputPath?: string;
  /** Mp4 vs png-sequence vs … gates the entire stage branch. */
  isPngSequence: boolean;
  /** GIF writes directly to `outputPath` via a two-pass palette encode. */
  isGif: boolean;
  /** Encoder preset (codec, preset, pixelFormat, hdr). Only used on the non-png path. */
  preset: ReturnType<typeof getEncoderPreset>;
  effectiveQuality: number;
  effectiveBitrate: string | undefined;
  /** Producer config — enables the chunked-concat encoder when on. */
  enableChunkedEncode: boolean;
  chunkedEncodeSize: number;
  /** Already-resolved engine config from the orchestrator; direct callers fall back below. */
  engineConfig?: Pick<EngineConfig, "ffmpegEncodeTimeout">;
  abortSignal: AbortSignal | undefined;
  assertNotAborted: () => void;
  onProgress?: ProgressCallback;
  /**
   * Pass-through of `EncoderOptions.lockGopForChunkConcat`. When `true`,
   * the encode emits closed-GOP keyframes at every `gopSize` boundary so
   * downstream `ffmpeg -f concat -c copy` round-trips losslessly. Only the
   * distributed chunk worker (`renderChunk`) sets this — the in-process
   * renderer's call site omits it, preserving the existing open-GOP output.
   */
  lockGopForChunkConcat?: boolean;
  /** Required when `lockGopForChunkConcat === true`. Number of frames per GOP — set to the chunk's frame count by `renderChunk`. */
  gopSize?: number;
}

export interface EncodeStageResult {
  /** Wall-clock ms for the encode (or png-copy) phase. */
  encodeMs: number;
}

function resolveGifLoop(loop: number | undefined): number {
  const resolved = loop ?? 0;
  if (!Number.isInteger(resolved) || resolved < 0 || resolved > 65_535) {
    throw new Error(`[Render] gifLoop must be an integer between 0 and 65535 (got ${resolved})`);
  }
  return resolved;
}

async function encodeGifFromDir(
  framesDir: string,
  framePattern: string,
  outputPath: string,
  input: {
    fps: Fps;
    loop: number;
    palettePath: string;
    signal?: AbortSignal;
    timeout: number;
  },
): Promise<EncodeResult> {
  const startTime = Date.now();
  const files = readdirSync(framesDir).filter((file) => file.match(/\.(jpg|jpeg|png)$/i));
  const frameCount = files.length;
  if (frameCount === 0) {
    return {
      success: false,
      outputPath,
      durationMs: Date.now() - startTime,
      framesEncoded: 0,
      fileSize: 0,
      error: "[FFmpeg] No frame files found in directory",
    };
  }

  const argsInput: GifEncodeArgsInput = {
    framesDir,
    framePattern,
    palettePath: input.palettePath,
    outputPath,
    fps: input.fps,
    loop: input.loop,
  };
  try {
    const paletteResult = await runFfmpeg(buildGifPalettegenArgs(argsInput), {
      signal: input.signal,
      timeout: input.timeout,
    });
    if (!paletteResult.success) {
      return {
        success: false,
        outputPath,
        durationMs: Date.now() - startTime,
        framesEncoded: 0,
        fileSize: 0,
        error: formatFfmpegError(paletteResult.exitCode, paletteResult.stderr),
      };
    }

    const gifResult = await runFfmpeg(buildGifPaletteuseArgs(argsInput), {
      signal: input.signal,
      timeout: input.timeout,
    });
    if (!gifResult.success) {
      return {
        success: false,
        outputPath,
        durationMs: Date.now() - startTime,
        framesEncoded: 0,
        fileSize: 0,
        error: formatFfmpegError(gifResult.exitCode, gifResult.stderr),
      };
    }

    const fileSize = existsSync(outputPath) ? statSync(outputPath).size : 0;
    return {
      success: true,
      outputPath,
      durationMs: Date.now() - startTime,
      framesEncoded: frameCount,
      fileSize,
    };
  } finally {
    // The GIF palette is a temp file; remove it after success or any encode failure.
    rmSync(input.palettePath, { force: true });
  }
}

export async function runEncodeStage(input: EncodeStageInput): Promise<EncodeStageResult> {
  const {
    job,
    log,
    outputPath,
    framesDir,
    videoOnlyPath,
    width,
    height,
    needsAlpha,
    hasAudio,
    audioOutputPath,
    isPngSequence,
    isGif,
    preset,
    effectiveQuality,
    effectiveBitrate,
    enableChunkedEncode,
    chunkedEncodeSize,
    abortSignal,
    assertNotAborted,
    onProgress,
  } = input;

  const stage5Start = Date.now();

  if (isPngSequence) {
    // ── Stage 5 (png-sequence): copy captured PNGs to outputDir ──────
    // No encoder, no mux, no faststart — captured frames already carry
    // alpha and are the deliverable. We rename to `frame_NNNNNN.png`
    // (zero-padded) so consumers (After Effects, Nuke, Fusion, ffmpeg
    // image2 demuxer) can globbed-import without surprises.
    updateJobStatus(job, "encoding", "Writing PNG sequence", 75, onProgress);
    if (!existsSync(outputPath)) mkdirSync(outputPath, { recursive: true });
    const captured = readdirSync(framesDir)
      .filter((name) => name.endsWith(".png"))
      .sort();
    if (captured.length === 0) {
      throw new Error(
        `[Render] png-sequence output requested but no PNGs were captured to ${framesDir}`,
      );
    }
    captured.forEach((name, i) => {
      const dst = join(outputPath, formatExportFrameName(i, "png"));
      copyFileSync(join(framesDir, name), dst);
    });
    if (hasAudio && audioOutputPath && existsSync(audioOutputPath)) {
      // Sidecar audio for callers that need to re-mux later. png-sequence
      // has no container of its own, so this is the only place audio
      // can land alongside the frames.
      copyFileSync(audioOutputPath, join(outputPath, "audio.aac"));
      log.info(`[Render] png-sequence: audio.aac sidecar written to ${outputPath}/audio.aac`);
    }
    return { encodeMs: Date.now() - stage5Start };
  }

  const engineCfg = input.engineConfig ?? job.config.producerConfig ?? resolveConfig();

  if (isGif) {
    // ── Stage 5 (gif): two-pass palette encode ───────────────────────
    updateJobStatus(job, "encoding", "Encoding GIF", 75, onProgress);
    if (hasAudio) {
      log.warn("[Render] GIF output does not support audio; audio tracks will be ignored.");
    }
    const framePattern = "frame_%06d.jpg";
    const loop = resolveGifLoop(job.config.gifLoop);
    const encodeResult = await encodeGifFromDir(framesDir, framePattern, outputPath, {
      fps: job.config.fps,
      loop,
      palettePath: join(dirname(videoOnlyPath), "gif-palette.png"),
      signal: abortSignal,
      timeout: engineCfg.ffmpegEncodeTimeout,
    });
    assertNotAborted();
    if (!encodeResult.success) {
      throw new Error(`Encoding failed: ${encodeResult.error}`);
    }
    return { encodeMs: Date.now() - stage5Start };
  }

  // ── Stage 5: Encode ───────────────────────────────────────────────
  updateJobStatus(job, "encoding", "Encoding video", 75, onProgress);

  const frameExt = needsAlpha ? "png" : "jpg";
  const framePattern = `frame_%06d.${frameExt}`;
  const encoderOpts = {
    fps: job.config.fps,
    width,
    height,
    codec: preset.codec,
    preset: preset.preset,
    quality: effectiveQuality,
    bitrate: effectiveBitrate,
    pixelFormat: preset.pixelFormat,
    useGpu: job.config.useGpu,
    hdr: preset.hdr,
    // Distributed chunk renders pass these so the encoder writes closed-GOP
    // keyframes that survive `-f concat -c copy` at assemble time. In-process
    // renders leave both undefined → preserves the existing open-GOP output.
    lockGopForChunkConcat: input.lockGopForChunkConcat === true,
    gopSize: input.gopSize,
  };
  const encodeResult = enableChunkedEncode
    ? await encodeFramesChunkedConcat(
        framesDir,
        framePattern,
        videoOnlyPath,
        encoderOpts,
        chunkedEncodeSize,
        abortSignal,
        engineCfg,
      )
    : await encodeFramesFromDir(
        framesDir,
        framePattern,
        videoOnlyPath,
        encoderOpts,
        abortSignal,
        engineCfg,
      );
  assertNotAborted();

  if (!encodeResult.success) {
    throw new Error(`Encoding failed: ${encodeResult.error}`);
  }

  return { encodeMs: Date.now() - stage5Start };
}
