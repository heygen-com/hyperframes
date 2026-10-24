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
 * Join, audio mux and mp4 faststart run as one ffmpeg pass over the concat
 * demuxer, so disk holds the chunks plus one output copy. Audio is first
 * pad-or-trimmed to `frameCount / fps` (frames summed over the chunks) so
 * the mux adds no drift at the end of long renders.
 *
 * Pure function over local paths. No networking. The caller is responsible
 * for moving `outputPath` to its orchestration-level storage.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  appendRenderProvenanceArgs,
  describeFfmpegFailure,
  getEncoderPreset,
  MIXED_AUDIO_FILENAME,
  muxVideoWithAudio,
  resolveConfig,
  runFfmpeg,
  appendSoftwareEncoderThreadsArg,
  renameWithRetry,
} from "@hyperframes/engine";
import { fpsToFfmpegArg } from "@hyperframes/core";
import { defaultLogger, type ProducerLogger } from "../../logger.js";
import { formatExportFrameName } from "../../utils/paths.js";
import {
  defaultProbeVideoFrameInfo,
  padOrTrimAudioToVideoFrameCount,
  type ProbeVideoFrameInfo,
} from "../render/audioPadTrim.js";
import { encoderFailureError } from "../render/encoderInterruption.js";
import type { ChunkSliceJson, LockedRenderConfig } from "../render/stages/freezePlan.js";
import { DISTRIBUTED_RENDER_CAPABILITIES, readPlanProtocolV1 } from "./planProtocol.js";
import { writeStitchedMp4 } from "./mp4Stitch.js";
import { validatePlanV2MaterializedTarget } from "./planV2.js";
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
  protocol?: unknown;
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

export type AssembleChunkPaths = readonly (string | readonly string[])[];

type CfrRateControlSource = Partial<Pick<LockedRenderConfig, "quality" | "crf" | "bitrate">>;

export function cfrRateControlArgs(locked: CfrRateControlSource): string[] {
  const preset = getEncoderPreset(locked.quality ?? "standard", "mp4");
  if (locked.crf == null && locked.bitrate) {
    return ["-preset", preset.preset, "-b:v", locked.bitrate];
  }
  return ["-preset", preset.preset, "-crf", String(locked.crf ?? preset.quality)];
}

/**
 * Assemble the chunk outputs into a single deliverable.
 *
 * @param planDir — absolute path to the planDir produced by `plan()`.
 * @param chunkPaths — ordered chunk outputs, length === `chunks.json` length.
 *   For mp4/mov each entry is a path to an encoded chunk file; for
 *   png-sequence each entry is a path to a directory of frames. An entry
 *   may instead be the ordered parts of that chunk (see {@link AssembleChunkPaths}).
 * @param audioPath — `<planDir>/<MIXED_AUDIO_FILENAME>` for mux'd formats. Pass `null`
 *   when the composition has no audio (or `assemble` is being called for a
 *   format whose audio is muxed elsewhere). `assemble` always normalizes
 *   audio length against the assembled video's frame count when
 *   `audioPath` is non-null.
 * @param outputPath — final on-disk output (file for mp4/mov; directory
 *   for png-sequence — created if missing).
 */
export async function assemble(
  planDir: string,
  chunkOutputs: AssembleChunkPaths,
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
     * quality loss (at the chunks' own CRF or bitrate, non-zero). Default
     * `false` preserves the existing `-c copy` behavior. mp4 only
     * (libx264); webm / mov pass through unchanged because their
     * stream-copy paths don't exhibit the same avg-frame-rate drift.
     */
    cfr?: boolean;
  },
): Promise<AssembleResult> {
  const start = Date.now();
  const log = options?.logger ?? defaultLogger;
  const cfr = options?.cfr === true;

  const plan = readAssemblePlan(planDir, chunkOutputs);
  const chunkPaths = chunkOutputs.flat();
  if (plan.dimensions.format === "png-sequence") {
    // ── 2a. png-sequence: merge frame directories with global re-numbering
    return mergePngFrameDirs(chunkPaths, outputPath, plan.totalFrames, audioPath, start);
  }

  if (chunksAreStitchedMp4(planDir, cfr)) {
    const separateAudio = stitchesSeparateAudio(planDir) && audioPath !== null;
    await writeStitchedMp4(chunkPaths, outputPath, separateAudio ? audioPath : undefined);
    return {
      outputPath,
      durationMs: Date.now() - start,
      framesEncoded: plan.totalFrames,
      fileSize: statSync(outputPath).size,
    };
  }

  // ── 2b. mp4 / mov / webm: join + audio mux + faststart in one pass ─────
  const format = plan.dimensions.format;
  const cfrEncoder = cfr ? readCfrEncoder(planDir, format) : null;
  if (!existsSync(dirname(outputPath))) {
    mkdirSync(dirname(outputPath), { recursive: true });
  }
  const workDir = mkdtempSync(`${outputPath}.assemble-work-`);
  const fps = { num: plan.dimensions.fpsNum, den: plan.dimensions.fpsDen };
  const stageMs: Record<string, number> = {};
  const ctx: JoinContext = {
    workDir,
    format,
    fps,
    fpsArg: fpsToFfmpegArg(fps),
    signal: options?.abortSignal,
    timeout: resolveConfig().ffmpegProcessTimeout,
    log,
    timed: async (stage, run) => {
      const stageStart = Date.now();
      const result = await run();
      stageMs[stage] = Date.now() - stageStart;
      return result;
    },
  };

  try {
    const videoSources = cfrEncoder ? [await reencodeCfr(ctx, chunkPaths, cfrEncoder)] : chunkPaths;
    const finalPath = join(workDir, `output.${format}`);
    const audio = audioPath !== null && existsSync(audioPath) ? audioPath : null;
    await writeJoined(ctx, videoSources, audio, finalPath);
    renameWithRetry(finalPath, outputPath);
    log.info("[assemble] stage timings", {
      ...stageMs,
      chunks: chunkPaths.length,
      totalMs: Date.now() - start,
    });
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

function readAssemblePlan(planDir: string, chunkPaths: AssembleChunkPaths): PlanJsonForAssemble {
  // ── 1. Validate planDir manifest matches chunkPaths shape ──────────────
  const planJsonPath = join(planDir, "plan.json");
  const chunksJsonPath = join(planDir, "meta", "chunks.json");
  if (!existsSync(planJsonPath)) {
    throw new Error(`[assemble] planDir missing plan.json: ${planJsonPath}`);
  }
  const plan = JSON.parse(readFileSync(planJsonPath, "utf-8")) as PlanJsonForAssemble;
  readPlanProtocolV1(plan, DISTRIBUTED_RENDER_CAPABILITIES.roles.assembler);
  validatePlanV2MaterializedTarget(planDir, { role: "assembler" });
  if (!existsSync(chunksJsonPath)) {
    throw new Error(`[assemble] planDir missing meta/chunks.json: ${chunksJsonPath}`);
  }
  const chunks = JSON.parse(readFileSync(chunksJsonPath, "utf-8")) as ChunkSliceJson[];
  if (chunkPaths.length !== chunks.length) {
    throw new Error(
      `[assemble] chunkPaths length (${chunkPaths.length}) does not match ` +
        `chunks.json length (${chunks.length}). Adapters must pass one path ` +
        `per chunk, ordered by index.`,
    );
  }
  for (const [index, entry] of chunkPaths.entries()) {
    if (typeof entry !== "string" && entry.length === 0) {
      throw new Error(`[assemble] chunk ${index} has an empty list of parts`);
    }
  }
  for (const path of chunkPaths.flat()) {
    if (!existsSync(path)) {
      throw new Error(`[assemble] chunk path does not exist: ${path}`);
    }
  }

  return plan;
}

interface JoinContext {
  workDir: string;
  format: DistributedFormat;
  fps: { num: number; den: number };
  fpsArg: string;
  signal: AbortSignal | undefined;
  timeout: number;
  log: ProducerLogger;
  timed: <T>(stage: string, run: () => Promise<T>) => Promise<T>;
}

// A one-entry concat list ignores the input-side `-r` (observed `359/12` in the
// container), so a single file is read directly; every write also sets output `-r`.
function videoInputArgs(ctx: JoinContext, videoSources: readonly string[]): string[] {
  return videoSources.length === 1
    ? ["-i", videoSources[0]!]
    : concatDemuxerInput(videoSources, ctx.workDir, ctx.fpsArg);
}

export function cfrEncodeArgs(
  inputArgs: string[],
  encoder: CfrRateControlSource,
  fpsArg: string,
): string[] {
  const args = [
    ...inputArgs,
    "-c:v",
    "libx264",
    ...cfrRateControlArgs(encoder),
    "-pix_fmt",
    "yuv420p",
    "-fps_mode",
    "cfr",
    "-r",
    fpsArg,
  ];
  appendSoftwareEncoderThreadsArg(args, "libx264");
  return args;
}

// ── 2c. Optional exact-CFR re-encode ──────────────────────────────────
// Lands the stream-level `avg_frame_rate` (PTS-derived under stream copy)
// on the requested rational, for consumers that strict-check it.
async function reencodeCfr(
  ctx: JoinContext,
  chunkPaths: readonly string[],
  encoder: CfrRateControlSource,
): Promise<string> {
  const cfrOutputPath = join(ctx.workDir, `cfr.${ctx.format}`);
  const cfrArgs = cfrEncodeArgs(videoInputArgs(ctx, chunkPaths), encoder, ctx.fpsArg);
  appendRenderProvenanceArgs(cfrArgs, cfrOutputPath);
  cfrArgs.push("-y", cfrOutputPath);
  await ctx.timed("cfrMs", () =>
    runAssembleFfmpeg(cfrArgs, "cfr re-encode", ctx.signal, ctx.timeout),
  );
  ctx.log.info("[assemble] cfr re-encode applied", {
    format: ctx.format,
    fpsNum: ctx.fps.num,
    fpsDen: ctx.fps.den,
  });
  return cfrOutputPath;
}

// ── 3. Audio pad-or-trim, then one write of the deliverable ──────────
async function writeJoined(
  ctx: JoinContext,
  videoSources: readonly string[],
  audioPath: string | null,
  finalPath: string,
): Promise<void> {
  if (audioPath === null) {
    const joinArgs = [...videoInputArgs(ctx, videoSources), "-c", "copy"];
    if (ctx.format === "mp4") joinArgs.push("-movflags", "+faststart");
    appendRenderProvenanceArgs(joinArgs, finalPath);
    joinArgs.push("-r", ctx.fpsArg, "-y", finalPath);
    await ctx.timed("joinMs", () =>
      runAssembleFfmpeg(joinArgs, "concat-copy", ctx.signal, ctx.timeout),
    );
    return;
  }
  const paddedAudioPath = join(ctx.workDir, "audio-padded.m4a");
  const padTrimResult = await ctx.timed("audioMs", () =>
    padOrTrimAudioToVideoFrameCount({
      videoPath: videoSources[0]!,
      probeVideoFrameInfo: () => probeJoinedFrameInfo(videoSources, ctx.fps, ctx.signal),
      audioPath,
      outputPath: paddedAudioPath,
      signal: ctx.signal,
      timeoutMs: ctx.timeout,
    }),
  );
  if (!padTrimResult.success) {
    throw encoderFailureError("[assemble] audio pad/trim failed", padTrimResult);
  }
  ctx.log.info("[assemble] audio normalized for mux", {
    operation: padTrimResult.operation,
    targetDurationSeconds: padTrimResult.targetDurationSeconds,
    sourceDurationSeconds: padTrimResult.sourceDurationSeconds,
  });
  const muxResult = await ctx.timed("joinMs", () =>
    muxVideoWithAudio(
      videoSources[0]!,
      paddedAudioPath,
      finalPath,
      ctx.signal,
      {
        audioCodec: "aac",
        ffmpegProcessTimeout: ctx.timeout,
        videoInputArgs: videoInputArgs(ctx, videoSources),
      },
      ctx.fps,
    ),
  );
  if (!muxResult.success) {
    throw encoderFailureError("[assemble] audio mux failed", muxResult);
  }
}

/** Concat-demuxer input args; `-r` keeps the demuxer from PTS-averaging the rate. */
function concatDemuxerInput(
  chunkPaths: readonly string[],
  workDir: string,
  fpsArg: string,
): string[] {
  // ffmpeg's concat list escapes a single quote as `'\''`.
  const listPath = join(workDir, "concat-list.txt");
  const body = chunkPaths.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join("\n");
  writeFileSync(listPath, `${body}\n`, "utf-8");
  return ["-r", fpsArg, "-f", "concat", "-safe", "0", "-i", listPath];
}

/** What a probe of the joined file would report: the chunks' frames at the plan's rate. */
async function probeJoinedFrameInfo(
  videoPaths: readonly string[],
  fps: { num: number; den: number },
  signal: AbortSignal | undefined,
): Promise<ProbeVideoFrameInfo> {
  const infos = await Promise.all(
    videoPaths.map((path) => defaultProbeVideoFrameInfo(path, signal)),
  );
  return {
    frameCount: infos.reduce((sum, info) => sum + info.frameCount, 0),
    fpsNum: fps.num,
    fpsDen: fps.den,
  };
}

async function runAssembleFfmpeg(
  args: string[],
  step: string,
  signal: AbortSignal | undefined,
  timeout: number,
): Promise<void> {
  const result = await runFfmpeg(args, { signal, timeout });
  if (!result.success) {
    throw encoderFailureError(`[assemble] ffmpeg ${step} failed`, {
      error: describeFfmpegFailure(result, timeout),
      failureReason: result.failureReason,
    });
  }
}

/** Mp4 chunks carrying audio, or with it as a separate file, stitch under one index like S3's. */
export function chunksAreStitchedMp4(planDir: string, cfr: boolean): boolean {
  const { chunksCarryAudio, separateAudio } = lockedAudio(planDir);
  if (!chunksCarryAudio && !separateAudio) return false;
  if (planFormat(planDir) !== "mp4") return false;
  if (cfr) {
    throw new Error("[assemble] cfr=true cannot re-encode a plan whose mp4 chunks are stitched");
  }
  return true;
}

export function stitchesSeparateAudio(planDir: string): boolean {
  return lockedAudio(planDir).separateAudio === true;
}

function planFormat(planDir: string): DistributedFormat {
  const plan = JSON.parse(readFileSync(join(planDir, "plan.json"), "utf-8")) as PlanJsonForAssemble;
  return plan.dimensions.format;
}

function lockedAudio(
  planDir: string,
): Pick<LockedRenderConfig, "chunksCarryAudio" | "separateAudio"> {
  const encoderJsonPath = join(planDir, "meta", "encoder.json");
  if (!existsSync(encoderJsonPath)) return {};
  return JSON.parse(readFileSync(encoderJsonPath, "utf-8")) as LockedRenderConfig;
}

/**
 * The cfr re-encode hardcodes `-c:v libx264`: reject non-mp4 formats and h265
 * chunks (which it would silently transcode) before any ffmpeg runs.
 */
function readCfrEncoder(planDir: string, format: DistributedFormat): CfrRateControlSource {
  if (format !== "mp4") {
    throw new Error(
      `[assemble] cfr=true is only supported for format="mp4" (got ` +
        `"${format}"). Stream-copy paths for webm and mov ` +
        `already produce exact avg_frame_rate; cfr re-encode is not needed.`,
    );
  }
  const encoderJsonPath = join(planDir, "meta", "encoder.json");
  if (!existsSync(encoderJsonPath)) {
    throw new Error(`[assemble] planDir missing meta/encoder.json: ${encoderJsonPath}`);
  }
  const encoderJson = JSON.parse(readFileSync(encoderJsonPath, "utf-8")) as CfrRateControlSource & {
    encoder?: string;
  };
  if (encoderJson.encoder === "libx265-software") {
    throw new Error(
      `[assemble] cfr=true is not yet supported with codec: "h265". The ` +
        `cfr re-encode pass uses libx264 and would silently transcode the ` +
        `h265 chunks. Either disable cfr or render with codec: "h264".`,
    );
  }
  return encoderJson;
}

/**
 * Merge per-chunk PNG frame directories into a single directory with
 * globally-incrementing frame numbers. Each chunk's `frame_NNNNNN.png` files
 * (which `renderChunk` writes normalized to zero per chunk) are re-numbered
 * into the merged output so consumers see one continuous numbered sequence.
 *
 * Audio is intentionally NOT muxed here — png-sequence has no container.
 * If `audioPath` is non-null we copy it alongside under the engine's mixed-audio
 * filename so callers who need to re-mux later (After Effects, Nuke, ffmpeg
 * image2 + audio) can find it.
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
    const sidecar = join(outputPath, MIXED_AUDIO_FILENAME);
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
