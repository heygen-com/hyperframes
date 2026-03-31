/**
 * Render Orchestrator Service
 *
 * Coordinates the entire video rendering pipeline:
 * 1. Parse composition metadata
 * 2. Pre-extract video frames
 * 3. Pre-process audio tracks
 * 4. Parallel frame capture
 * 5. Video encoding
 * 6. Final assembly (audio mux + faststart)
 *
 * Heavy observability: every stage logs timing, errors include
 * full context, and failures produce a diagnostic summary.
 */

import {
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  appendFileSync,
} from "fs";
import { parseHTML } from "linkedom";
import {
  type EngineConfig,
  resolveConfig,
  extractAllVideoFrames,
  createFrameLookupTable,
  type VideoElement,
  FrameLookupTable,
  createCaptureSession,
  initializeSession,
  closeCaptureSession,
  captureFrame,
  captureFrameToBuffer,
  getCompositionDuration,
  prepareCaptureSessionForReuse,
  type CaptureOptions,
  type CaptureSession,
  createVideoFrameInjector,
  encodeFramesFromDir,
  encodeFramesChunkedConcat,
  muxVideoWithAudio,
  applyFaststart,
  getEncoderPreset,
  processCompositionAudio,
  type AudioElement,
  calculateOptimalWorkers,
  distributeFrames,
  executeParallelCapture,
  mergeWorkerFrames,
  spawnStreamingEncoder,
  createFrameReorderBuffer,
  type StreamingEncoder,
} from "@hyperframes/engine";
import { join, dirname, resolve } from "path";
import { randomUUID } from "crypto";
import { freemem } from "os";
import { fileURLToPath } from "url";
import { createFileServer, type FileServerHandle } from "./fileServer.js";
import {
  compileForRender,
  resolveCompositionDurations,
  recompileWithResolutions,
  discoverMediaFromBrowser,
  type CompiledComposition,
} from "./htmlCompiler.js";
import { defaultLogger, type ProducerLogger } from "../logger.js";

/**
 * Wrap a cleanup operation so it never throws, but logs any failure.
 */
async function safeCleanup(
  label: string,
  fn: () => Promise<void> | void,
  log: ProducerLogger = defaultLogger,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.debug(`Cleanup failed (${label})`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export type RenderStatus =
  | "queued"
  | "preprocessing"
  | "rendering"
  | "encoding"
  | "assembling"
  | "complete"
  | "failed"
  | "cancelled";

export interface RenderConfig {
  fps: 24 | 30 | 60;
  quality: "draft" | "standard" | "high";
  /** Output container format. WebM uses VP9+alpha for transparency. */
  format?: "mp4" | "webm";
  workers?: number;
  useGpu?: boolean;
  debug?: boolean;
  /** Entry HTML file relative to projectDir. Defaults to "index.html". */
  entryFile?: string;
  /** Full producer config. When provided, env vars are not read. */
  producerConfig?: EngineConfig;
  /** Custom logger. Defaults to console-based defaultLogger. */
  logger?: ProducerLogger;
}

export interface RenderPerfSummary {
  renderId: string;
  totalElapsedMs: number;
  fps: number;
  quality: string;
  workers: number;
  chunkedEncode: boolean;
  chunkSizeFrames: number | null;
  compositionDurationSeconds: number;
  totalFrames: number;
  resolution: { width: number; height: number };
  videoCount: number;
  audioCount: number;
  stages: Record<string, number>;
  captureAvgMs?: number;
  capturePeakMs?: number;
}

export interface RenderJob {
  id: string;
  config: RenderConfig;
  status: RenderStatus;
  progress: number;
  currentStage: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  outputPath?: string;
  duration?: number;
  totalFrames?: number;
  framesRendered?: number;
  perfSummary?: RenderPerfSummary;
  failedStage?: string;
  errorDetails?: {
    message: string;
    stack?: string;
    elapsedMs: number;
    freeMemoryMB: number;
    browserConsoleTail?: string[];
    perfStages?: Record<string, number>;
  };
}

export type ProgressCallback = (job: RenderJob, message: string) => void;

export class RenderCancelledError extends Error {
  reason: "user_cancelled" | "timeout" | "aborted";
  constructor(
    message: string = "render_cancelled",
    reason: "user_cancelled" | "timeout" | "aborted" = "aborted",
  ) {
    super(message);
    this.name = "RenderCancelledError";
    this.reason = reason;
  }
}

export interface CompositionMetadata {
  duration: number;
  videos: VideoElement[];
  audios: AudioElement[];
  width: number;
  height: number;
}

function updateJobStatus(
  job: RenderJob,
  status: RenderStatus,
  stage: string,
  progress: number,
  onProgress?: ProgressCallback,
): void {
  job.status = status;
  job.currentStage = stage;
  job.progress = progress;
  if (status === "failed" || status === "complete") job.completedAt = new Date();
  if (onProgress) onProgress(job, stage);
}

function installDebugLogger(logPath: string, log: ProducerLogger = defaultLogger): () => void {
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  const write = (prefix: string, args: unknown[]) => {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${prefix} ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`;
    try {
      appendFileSync(logPath, line);
    } catch (err) {
      log.debug("Debug log write failed", {
        logPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  console.log = (...args: unknown[]) => {
    write("LOG", args);
    origLog(...args);
  };
  console.error = (...args: unknown[]) => {
    write("ERR", args);
    origError(...args);
  };
  console.warn = (...args: unknown[]) => {
    write("WRN", args);
    origWarn(...args);
  };

  return () => {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
  };
}

/**
 * Write compiled HTML and sub-compositions to the work directory.
 */
function writeCompiledArtifacts(
  compiled: CompiledComposition,
  workDir: string,
  includeSummary: boolean,
): void {
  const compileDir = join(workDir, "compiled");
  mkdirSync(compileDir, { recursive: true });

  writeFileSync(join(compileDir, "index.html"), compiled.html, "utf-8");

  for (const [srcPath, html] of compiled.subCompositions) {
    const outPath = join(compileDir, srcPath);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html, "utf-8");
  }

  if (includeSummary) {
    const summary = {
      width: compiled.width,
      height: compiled.height,
      staticDuration: compiled.staticDuration,
      videos: compiled.videos.map((v) => ({
        id: v.id,
        src: v.src,
        start: v.start,
        end: v.end,
        mediaStart: v.mediaStart,
      })),
      audios: compiled.audios.map((a) => ({
        id: a.id,
        src: a.src,
        start: a.start,
        end: a.end,
        mediaStart: a.mediaStart,
      })),
      subCompositions: Array.from(compiled.subCompositions.keys()),
    };
    writeFileSync(join(compileDir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");
  }
}

export function createRenderJob(config: RenderConfig): RenderJob {
  return {
    id: randomUUID(),
    config,
    status: "queued",
    progress: 0,
    currentStage: "Queued",
    createdAt: new Date(),
  };
}

function normalizeCompositionSrcPath(srcPath: string): string {
  return srcPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Main render pipeline
 */

export function extractStandaloneEntryFromIndex(
  indexHtml: string,
  entryFile: string,
): string | null {
  const normalizedEntryFile = normalizeCompositionSrcPath(entryFile);
  const { document } = parseHTML(indexHtml);
  const body = document.querySelector("body");
  if (!body) return null;

  const hosts = Array.from(document.querySelectorAll("[data-composition-src]")) as Element[];
  const host = hosts.find(
    (candidate) =>
      normalizeCompositionSrcPath(candidate.getAttribute("data-composition-src") || "") ===
      normalizedEntryFile,
  );
  if (!host) return null;

  const root =
    (Array.from(body.children) as Element[]).find((candidate) =>
      candidate.hasAttribute("data-composition-id"),
    ) ?? null;
  if (!root) return null;

  const hostClone = host.cloneNode(true) as Element;
  hostClone.setAttribute("data-start", "0");

  body.innerHTML = "";

  if (root === host) {
    body.appendChild(hostClone);
    return document.toString();
  }

  const rootClone = root.cloneNode(false) as Element;
  rootClone.appendChild(hostClone);
  body.appendChild(rootClone);

  return document.toString();
}

export async function executeRenderJob(
  job: RenderJob,
  projectDir: string,
  outputPath: string,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
): Promise<void> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const producerRoot = process.env.PRODUCER_RENDERS_DIR
    ? resolve(process.env.PRODUCER_RENDERS_DIR, "..")
    : resolve(moduleDir, "../..");
  const debugDir = join(producerRoot, ".debug");
  const workDir = job.config.debug
    ? join(debugDir, job.id)
    : join(dirname(outputPath), `work-${job.id}`);
  const pipelineStart = Date.now();
  const log = job.config.logger ?? defaultLogger;
  let fileServer: FileServerHandle | null = null;
  let probeSession: CaptureSession | null = null;
  let lastBrowserConsole: string[] = [];
  let restoreLogger: (() => void) | null = null;
  const perfStages: Record<string, number> = {};
  const perfOutputPath = join(workDir, "perf-summary.json");
  const cfg = { ...(job.config.producerConfig ?? resolveConfig()) };
  const outputFormat = (job.config.format ?? "mp4") as "mp4" | "webm";
  const isWebm = outputFormat === "webm";
  // WebM/transparency requires screenshot mode — beginFrame doesn't support alpha channel
  if (isWebm) {
    cfg.forceScreenshot = true;
  }
  const enableChunkedEncode = cfg.enableChunkedEncode;
  const chunkedEncodeSize = cfg.chunkSizeFrames;
  const enableStreamingEncode = cfg.enableStreamingEncode;

  try {
    const assertNotAborted = () => {
      if (abortSignal?.aborted) {
        throw new RenderCancelledError("render_cancelled");
      }
    };

    job.startedAt = new Date();
    assertNotAborted();
    if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

    if (job.config.debug) {
      const logPath = join(workDir, "render.log");
      restoreLogger = installDebugLogger(logPath, log);
    }

    const entryFile = job.config.entryFile || "index.html";
    let htmlPath = join(projectDir, entryFile);
    if (!existsSync(htmlPath)) {
      throw new Error(`Entry file not found: ${htmlPath}`);
    }
    assertNotAborted();

    // If entryFile is a sub-composition (<template> wrapper), reuse the real
    // index.html shell and isolate the matching host instead of fabricating
    // a new standalone document.
    const rawEntry = readFileSync(htmlPath, "utf-8");
    if (entryFile !== "index.html" && rawEntry.trimStart().startsWith("<template")) {
      const wrapperPath = join(workDir, "standalone-entry.html");
      const projectIndexPath = join(projectDir, "index.html");
      if (!existsSync(projectIndexPath)) {
        throw new Error(
          `Template entry file "${entryFile}" requires a project index.html to extract its render shell.`,
        );
      }
      const standaloneHtml = extractStandaloneEntryFromIndex(
        readFileSync(projectIndexPath, "utf-8"),
        entryFile,
      );
      if (!standaloneHtml) {
        throw new Error(
          `Entry file "${entryFile}" is not mounted from index.html via data-composition-src, so it cannot be rendered independently.`,
        );
      }
      writeFileSync(wrapperPath, standaloneHtml, "utf-8");
      htmlPath = wrapperPath;
      log.info("Extracted standalone entry from index.html host context", {
        entryFile,
      });
    }

    // ── Stage 1: Compile ─────────────────────────────────────────────────
    const stage1Start = Date.now();
    updateJobStatus(job, "preprocessing", "Compiling composition", 5, onProgress);

    const compileStart = Date.now();
    let compiled = await compileForRender(projectDir, htmlPath, join(workDir, "downloads"));
    assertNotAborted();
    perfStages.compileOnlyMs = Date.now() - compileStart;
    writeCompiledArtifacts(compiled, workDir, Boolean(job.config.debug));

    log.info("Compiled composition metadata", {
      entryFile,
      staticDuration: compiled.staticDuration,
      width: compiled.width,
      height: compiled.height,
      videoCount: compiled.videos.length,
      audioCount: compiled.audios.length,
    });

    const composition: CompositionMetadata = {
      duration: compiled.staticDuration,
      videos: compiled.videos,
      audios: compiled.audios,
      width: compiled.width,
      height: compiled.height,
    };
    const { width, height } = composition;

    const probeStart = Date.now();
    const needsBrowser = composition.duration <= 0 || compiled.unresolvedCompositions.length > 0;

    if (needsBrowser) {
      const reasons = [];
      if (composition.duration <= 0) reasons.push("root duration unknown");
      if (compiled.unresolvedCompositions.length > 0)
        reasons.push(`${compiled.unresolvedCompositions.length} unresolved composition(s)`);

      fileServer = await createFileServer({
        projectDir,
        compiledDir: join(workDir, "compiled"),
        port: 0,
      });
      assertNotAborted();

      const captureOpts: CaptureOptions = {
        width,
        height,
        fps: job.config.fps,
        format: isWebm ? "png" : "jpeg",
        quality: isWebm ? undefined : 80,
      };
      probeSession = await createCaptureSession(
        fileServer.url,
        join(workDir, "probe"),
        captureOpts,
        null,
        cfg,
      );
      await initializeSession(probeSession);
      assertNotAborted();
      lastBrowserConsole = probeSession.browserConsoleBuffer;

      // Discover root composition duration
      if (composition.duration <= 0) {
        const discoveredDuration = await getCompositionDuration(probeSession);
        assertNotAborted();
        log.info("Probed composition duration from browser", {
          discoveredDuration,
          staticDuration: compiled.staticDuration,
        });
        composition.duration = discoveredDuration;
      } else {
        log.info("Using static duration from data-duration attribute", {
          duration: composition.duration,
        });
      }

      // Resolve unresolved composition durations via window.__timelines
      if (compiled.unresolvedCompositions.length > 0) {
        const resolutions = await resolveCompositionDurations(
          probeSession.page,
          compiled.unresolvedCompositions,
        );
        assertNotAborted();
        if (resolutions.length > 0) {
          compiled = await recompileWithResolutions(
            compiled,
            resolutions,
            projectDir,
            join(workDir, "downloads"),
          );
          assertNotAborted();
          // Update composition metadata with re-parsed media
          composition.videos = compiled.videos;
          composition.audios = compiled.audios;
          writeCompiledArtifacts(compiled, workDir, Boolean(job.config.debug));
        }
      }

      // Discover media elements from browser DOM (catches dynamically-set src)
      const browserMedia = await discoverMediaFromBrowser(probeSession.page);
      assertNotAborted();
      if (browserMedia.length > 0) {
        const existingVideoIds = new Set(composition.videos.map((v) => v.id));
        const existingAudioIds = new Set(composition.audios.map((a) => a.id));

        for (const el of browserMedia) {
          if (!el.src || el.src === "about:blank") continue;

          // Convert absolute localhost URLs back to relative paths
          let src = el.src;
          if (fileServer && src.startsWith(fileServer.url)) {
            src = src.slice(fileServer.url.length).replace(/^\//, "");
          }

          if (el.tagName === "video") {
            if (existingVideoIds.has(el.id)) {
              // Reconcile to browser/runtime media metadata (runtime src can differ from static HTML).
              const existing = composition.videos.find((v) => v.id === el.id);
              if (existing) {
                if (existing.src !== src) {
                  existing.src = src;
                }
                if (el.end > 0 && (existing.end <= 0 || Math.abs(existing.end - el.end) > 0.0001)) {
                  existing.end = el.end;
                }
                if (
                  el.mediaStart > 0 &&
                  (existing.mediaStart <= 0 ||
                    Math.abs(existing.mediaStart - el.mediaStart) > 0.0001)
                ) {
                  existing.mediaStart = el.mediaStart;
                }
                if (el.hasAudio && !existing.hasAudio) {
                  existing.hasAudio = true;
                }
              }
            } else {
              // New video discovered from browser
              composition.videos.push({
                id: el.id,
                src,
                start: el.start,
                end: el.end,
                mediaStart: el.mediaStart,
                hasAudio: el.hasAudio,
              });
              existingVideoIds.add(el.id);
            }
          } else if (el.tagName === "audio") {
            if (existingAudioIds.has(el.id)) {
              const existing = composition.audios.find((a) => a.id === el.id);
              if (existing) {
                if (existing.src !== src) {
                  existing.src = src;
                }
                if (el.end > 0 && (existing.end <= 0 || Math.abs(existing.end - el.end) > 0.0001)) {
                  existing.end = el.end;
                }
                if (
                  el.mediaStart > 0 &&
                  (existing.mediaStart <= 0 ||
                    Math.abs(existing.mediaStart - el.mediaStart) > 0.0001)
                ) {
                  existing.mediaStart = el.mediaStart;
                }
                if (el.volume > 0 && Math.abs((existing.volume ?? 1) - el.volume) > 0.0001) {
                  existing.volume = el.volume;
                }
              }
            } else {
              composition.audios.push({
                id: el.id,
                src,
                start: el.start,
                end: el.end,
                mediaStart: el.mediaStart,
                layer: 0,
                volume: el.volume,
                type: "audio",
              });
              existingAudioIds.add(el.id);
            }
          }
        }
      }
    }
    perfStages.browserProbeMs = Date.now() - probeStart;

    job.duration = composition.duration;
    job.totalFrames = Math.ceil(composition.duration * job.config.fps);

    if (job.duration <= 0) {
      throw new Error(
        "Invalid composition duration: " +
          job.duration +
          ". Check that GSAP timelines are registered.",
      );
    }

    perfStages.compileMs = Date.now() - stage1Start;

    // ── Stage 2: Video frame extraction ─────────────────────────────────
    const stage2Start = Date.now();
    updateJobStatus(job, "preprocessing", "Extracting video frames", 10, onProgress);

    let frameLookup: FrameLookupTable | null = null;

    if (composition.videos.length > 0) {
      const extractionResult = await extractAllVideoFrames(
        composition.videos,
        projectDir,
        { fps: job.config.fps, outputDir: join(workDir, "video-frames") },
        abortSignal,
      );
      assertNotAborted();

      if (extractionResult.extracted.length > 0) {
        frameLookup = createFrameLookupTable(composition.videos, extractionResult.extracted);
      }

      perfStages.videoExtractMs = Date.now() - stage2Start;

      // Auto-detect audio from video files via ffprobe metadata
      const existingAudioSrcs = new Set(composition.audios.map((a) => a.src));
      for (const ext of extractionResult.extracted) {
        if (ext.metadata.hasAudio) {
          const video = composition.videos.find((v) => v.id === ext.videoId);
          if (video && !existingAudioSrcs.has(video.src)) {
            composition.audios.push({
              id: `${video.id}-audio`,
              src: video.src,
              start: video.start,
              end: video.end,
              mediaStart: video.mediaStart,
              layer: 0,
              volume: 1.0,
              type: "video",
            });
            existingAudioSrcs.add(video.src);
          }
        }
      }
    } else {
      perfStages.videoExtractMs = Date.now() - stage2Start;
    }

    // ── Stage 3: Audio processing ───────────────────────────────────────
    const stage3Start = Date.now();
    updateJobStatus(job, "preprocessing", "Processing audio tracks", 20, onProgress);

    const audioOutputPath = join(workDir, "audio.aac");
    let hasAudio = false;

    if (composition.audios.length > 0) {
      const audioResult = await processCompositionAudio(
        composition.audios,
        projectDir,
        join(workDir, "audio-work"),
        audioOutputPath,
        job.duration,
        abortSignal,
      );
      assertNotAborted();

      hasAudio = audioResult.success;
      perfStages.audioProcessMs = Date.now() - stage3Start;
    } else {
      perfStages.audioProcessMs = Date.now() - stage3Start;
    }

    // ── Stage 4: Frame capture ──────────────────────────────────────────
    const stage4Start = Date.now();
    updateJobStatus(job, "rendering", "Starting frame capture", 25, onProgress);

    // Start file server (may already be running from duration discovery)
    if (!fileServer) {
      fileServer = await createFileServer({
        projectDir,
        compiledDir: join(workDir, "compiled"),
        port: 0,
      });
      assertNotAborted();
    }

    const framesDir = join(workDir, "captured-frames");
    if (!existsSync(framesDir)) mkdirSync(framesDir, { recursive: true });

    const captureOptions: CaptureOptions = {
      width,
      height,
      fps: job.config.fps,
      format: isWebm ? "png" : "jpeg",
      quality: isWebm ? undefined : job.config.quality === "draft" ? 80 : 95,
    };

    const workerCount = calculateOptimalWorkers(job.totalFrames!, job.config.workers, cfg);

    const videoExt = isWebm ? ".webm" : ".mp4";
    const videoOnlyPath = join(workDir, `video-only${videoExt}`);
    const preset = getEncoderPreset(job.config.quality, outputFormat);

    job.framesRendered = 0;

    // Streaming encode mode: pipe frame buffers directly to FFmpeg stdin,
    // skipping disk writes and the separate Stage 5 encode step.
    let streamingEncoder: StreamingEncoder | null = null;

    if (enableStreamingEncode) {
      streamingEncoder = await spawnStreamingEncoder(
        videoOnlyPath,
        {
          fps: job.config.fps,
          width,
          height,
          codec: preset.codec,
          preset: preset.preset,
          quality: preset.quality,
          pixelFormat: preset.pixelFormat,
          useGpu: job.config.useGpu,
          imageFormat: captureOptions.format || "jpeg",
        },
        abortSignal,
      );
      assertNotAborted();
    }

    if (enableStreamingEncode && streamingEncoder) {
      // ── Streaming capture + encode (Stage 4 absorbs Stage 5) ──────────
      const reorderBuffer = createFrameReorderBuffer(0, job.totalFrames!);
      const currentEncoder = streamingEncoder;

      if (workerCount > 1) {
        // Parallel capture → streaming encode
        const tasks = distributeFrames(job.totalFrames, workerCount, workDir);

        const onFrameBuffer = async (frameIndex: number, buffer: Buffer): Promise<void> => {
          await reorderBuffer.waitForFrame(frameIndex);
          currentEncoder.writeFrame(buffer);
          reorderBuffer.advanceTo(frameIndex + 1);
        };

        await executeParallelCapture(
          fileServer.url,
          workDir,
          tasks,
          captureOptions,
          () => createVideoFrameInjector(frameLookup),
          abortSignal,
          (progress) => {
            job.framesRendered = progress.capturedFrames;
            const frameProgress = progress.capturedFrames / progress.totalFrames;
            const progressPct = 25 + frameProgress * 55;

            if (
              progress.capturedFrames % 30 === 0 ||
              progress.capturedFrames === progress.totalFrames
            ) {
              updateJobStatus(
                job,
                "rendering",
                `Streaming frame ${progress.capturedFrames}/${progress.totalFrames} (${workerCount} workers)`,
                Math.round(progressPct),
                onProgress,
              );
            }
          },
          onFrameBuffer,
          cfg,
        );

        if (probeSession) {
          lastBrowserConsole = probeSession.browserConsoleBuffer;
          await closeCaptureSession(probeSession);
          probeSession = null;
        }
      } else {
        // Sequential capture → streaming encode

        const videoInjector = createVideoFrameInjector(frameLookup);
        const session =
          probeSession ??
          (await createCaptureSession(
            fileServer.url,
            framesDir,
            captureOptions,
            videoInjector,
            cfg,
          ));
        if (probeSession) {
          prepareCaptureSessionForReuse(session, framesDir, videoInjector);
          probeSession = null;
        }

        try {
          if (!session.isInitialized) {
            await initializeSession(session);
          }
          assertNotAborted();
          lastBrowserConsole = session.browserConsoleBuffer;

          for (let i = 0; i < job.totalFrames!; i++) {
            assertNotAborted();
            const time = i / job.config.fps;
            const { buffer } = await captureFrameToBuffer(session, i, time);
            await reorderBuffer.waitForFrame(i);
            currentEncoder.writeFrame(buffer);
            reorderBuffer.advanceTo(i + 1);
            job.framesRendered = i + 1;

            const frameProgress = (i + 1) / job.totalFrames!;
            const progress = 25 + frameProgress * 55;

            updateJobStatus(
              job,
              "rendering",
              `Streaming frame ${i + 1}/${job.totalFrames}`,
              Math.round(progress),
              onProgress,
            );
          }
        } finally {
          lastBrowserConsole = session.browserConsoleBuffer;
          await closeCaptureSession(session);
        }
      }

      // Close encoder and get result
      const encodeResult = await currentEncoder.close();
      assertNotAborted();

      if (!encodeResult.success) {
        throw new Error(`Streaming encode failed: ${encodeResult.error}`);
      }

      perfStages.captureMs = Date.now() - stage4Start;
      perfStages.encodeMs = encodeResult.durationMs; // Overlapped with capture
    } else {
      // ── Disk-based capture (original flow) ────────────────────────────
      if (workerCount > 1) {
        // Parallel capture
        const tasks = distributeFrames(job.totalFrames, workerCount, workDir);

        await executeParallelCapture(
          fileServer.url,
          workDir,
          tasks,
          captureOptions,
          () => createVideoFrameInjector(frameLookup),
          abortSignal,
          (progress) => {
            job.framesRendered = progress.capturedFrames;
            const frameProgress = progress.capturedFrames / progress.totalFrames;
            const progressPct = 25 + frameProgress * 45;

            if (
              progress.capturedFrames % 30 === 0 ||
              progress.capturedFrames === progress.totalFrames
            ) {
              updateJobStatus(
                job,
                "rendering",
                `Capturing frame ${progress.capturedFrames}/${progress.totalFrames} (${workerCount} workers)`,
                Math.round(progressPct),
                onProgress,
              );
            }
          },
          undefined,
          cfg,
        );

        await mergeWorkerFrames(workDir, tasks, framesDir);
        if (probeSession) {
          lastBrowserConsole = probeSession.browserConsoleBuffer;
          await closeCaptureSession(probeSession);
          probeSession = null;
        }
      } else {
        // Sequential capture

        const videoInjector = createVideoFrameInjector(frameLookup);
        const session =
          probeSession ??
          (await createCaptureSession(
            fileServer.url,
            framesDir,
            captureOptions,
            videoInjector,
            cfg,
          ));
        if (probeSession) {
          prepareCaptureSessionForReuse(session, framesDir, videoInjector);
          probeSession = null;
        }

        try {
          if (!session.isInitialized) {
            await initializeSession(session);
          }
          assertNotAborted();
          lastBrowserConsole = session.browserConsoleBuffer;

          for (let i = 0; i < job.totalFrames; i++) {
            assertNotAborted();
            const time = i / job.config.fps;
            await captureFrame(session, i, time);
            job.framesRendered = i + 1;

            const frameProgress = (i + 1) / job.totalFrames;
            const progress = 25 + frameProgress * 45;

            updateJobStatus(
              job,
              "rendering",
              `Capturing frame ${i + 1}/${job.totalFrames}`,
              Math.round(progress),
              onProgress,
            );
          }
        } finally {
          lastBrowserConsole = session.browserConsoleBuffer;
          await closeCaptureSession(session);
        }
      }

      perfStages.captureMs = Date.now() - stage4Start;

      // ── Stage 5: Encode ─────────────────────────────────────────────────
      const stage5Start = Date.now();
      updateJobStatus(job, "encoding", "Encoding video", 75, onProgress);

      const frameExt = isWebm ? "png" : "jpg";
      const framePattern = `frame_%06d.${frameExt}`;
      const encoderOpts = {
        fps: job.config.fps,
        width,
        height,
        codec: preset.codec,
        preset: preset.preset,
        quality: preset.quality,
        pixelFormat: preset.pixelFormat,
        useGpu: job.config.useGpu,
      };
      const encodeResult = enableChunkedEncode
        ? await encodeFramesChunkedConcat(
            framesDir,
            framePattern,
            videoOnlyPath,
            encoderOpts,
            chunkedEncodeSize,
            abortSignal,
          )
        : await encodeFramesFromDir(
            framesDir,
            framePattern,
            videoOnlyPath,
            encoderOpts,
            abortSignal,
          );
      assertNotAborted();

      if (!encodeResult.success) {
        throw new Error(`Encoding failed: ${encodeResult.error}`);
      }

      perfStages.encodeMs = Date.now() - stage5Start;
    }

    if (probeSession !== null) {
      const remainingProbeSession: CaptureSession = probeSession;
      lastBrowserConsole = remainingProbeSession.browserConsoleBuffer;
      await closeCaptureSession(remainingProbeSession);
      probeSession = null;
    }

    if (frameLookup) frameLookup.cleanup();

    // Stop file server
    fileServer.close();
    fileServer = null;

    // ── Stage 6: Assemble ───────────────────────────────────────────────
    const stage6Start = Date.now();
    updateJobStatus(job, "assembling", "Assembling final video", 90, onProgress);

    if (hasAudio) {
      const muxResult = await muxVideoWithAudio(
        videoOnlyPath,
        audioOutputPath,
        outputPath,
        abortSignal,
      );
      assertNotAborted();
      if (!muxResult.success) {
        throw new Error(`Audio muxing failed: ${muxResult.error}`);
      }
    } else {
      const faststartResult = await applyFaststart(videoOnlyPath, outputPath, abortSignal);
      assertNotAborted();
      if (!faststartResult.success) {
        throw new Error(`Faststart failed: ${faststartResult.error}`);
      }
    }

    perfStages.assembleMs = Date.now() - stage6Start;

    // ── Complete ─────────────────────────────────────────────────────────
    job.outputPath = outputPath;
    updateJobStatus(job, "complete", "Render complete", 100, onProgress);

    const totalElapsed = Date.now() - pipelineStart;

    const perfSummary: RenderPerfSummary = {
      renderId: job.id,
      totalElapsedMs: totalElapsed,
      fps: job.config.fps,
      quality: job.config.quality,
      workers: workerCount,
      chunkedEncode: enableChunkedEncode,
      chunkSizeFrames: enableChunkedEncode ? chunkedEncodeSize : null,
      compositionDurationSeconds: composition.duration,
      totalFrames: job.totalFrames!,
      resolution: { width, height },
      videoCount: composition.videos.length,
      audioCount: composition.audios.length,
      stages: perfStages,
      captureAvgMs:
        job.totalFrames! > 0
          ? Math.round((perfStages.captureMs ?? 0) / job.totalFrames!)
          : undefined,
    };
    job.perfSummary = perfSummary;
    if (job.config.debug) {
      try {
        writeFileSync(perfOutputPath, JSON.stringify(perfSummary, null, 2), "utf-8");
      } catch (err) {
        log.debug("Failed to write perf summary", {
          perfOutputPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Cleanup ─────────────────────────────────────────────────────────
    if (job.config.debug) {
      // Copy output MP4 into debug dir for easy access
      if (existsSync(outputPath)) {
        const debugOutput = join(workDir, isWebm ? "output.webm" : "output.mp4");
        copyFileSync(outputPath, debugOutput);
      }
    } else {
      await safeCleanup(
        "remove workDir",
        () => {
          rmSync(workDir, { recursive: true, force: true });
        },
        log,
      );
    }

    if (restoreLogger) restoreLogger();
  } catch (error) {
    if (error instanceof RenderCancelledError || abortSignal?.aborted) {
      job.error = error instanceof Error ? error.message : "render_cancelled";
      updateJobStatus(job, "cancelled", "Render cancelled", job.progress, onProgress);
      if (fileServer) {
        const fs = fileServer;
        await safeCleanup(
          "close file server (cancel)",
          () => {
            fs.close();
          },
          log,
        );
      }
      if (probeSession) {
        const session = probeSession;
        await safeCleanup("close probe session (cancel)", () => closeCaptureSession(session), log);
      }
      if (!job.config.debug) {
        await safeCleanup(
          "remove workDir (cancel)",
          () => {
            rmSync(workDir, { recursive: true, force: true });
          },
          log,
        );
      }
      if (restoreLogger) restoreLogger();
      throw error instanceof RenderCancelledError
        ? error
        : new RenderCancelledError("render_cancelled");
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Suggest single-worker retry on parallel capture timeout.
    // Video-heavy compositions often cause multi-worker timeouts because
    // Chrome can't seek multiple video elements simultaneously.
    const isTimeoutError =
      errorMessage.includes("Waiting failed") ||
      errorMessage.includes("timeout exceeded") ||
      errorMessage.includes("Navigation timeout");
    const wasParallel = job.config.workers !== 1;
    if (isTimeoutError && wasParallel) {
      log.warn(
        `Parallel capture timed out with ${job.config.workers ?? "auto"} workers. ` +
          `Video-heavy compositions often need sequential capture. Retry with --workers 1`,
      );
    }

    job.error = errorMessage;
    updateJobStatus(job, "failed", `Failed: ${errorMessage}`, job.progress, onProgress);

    // Diagnostic summary
    const elapsed = Date.now() - pipelineStart;
    const freeMemMB = Math.round(freemem() / (1024 * 1024));

    // Populate structured error details for downstream consumers (SSE, sync response)
    job.failedStage = job.currentStage;
    job.errorDetails = {
      message: errorMessage,
      stack: errorStack,
      elapsedMs: elapsed,
      freeMemoryMB: freeMemMB,
      browserConsoleTail: lastBrowserConsole.length > 0 ? lastBrowserConsole.slice(-30) : undefined,
      perfStages: Object.keys(perfStages).length > 0 ? { ...perfStages } : undefined,
    };

    // Cleanup
    if (fileServer) {
      const fs = fileServer;
      await safeCleanup(
        "close file server (error)",
        () => {
          fs.close();
        },
        log,
      );
    }
    if (probeSession) {
      const session = probeSession;
      await safeCleanup("close probe session (error)", () => closeCaptureSession(session), log);
    }

    if (!job.config.debug) {
      await safeCleanup(
        "remove workDir (error)",
        () => {
          if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
        },
        log,
      );
    }

    if (restoreLogger) restoreLogger();
    throw error;
  }
}
