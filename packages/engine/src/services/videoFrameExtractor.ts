/**
 * Video Frame Extractor Service
 *
 * Pre-extracts video frames using FFmpeg for frame-accurate rendering.
 * Videos are replaced with <img> elements during capture.
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { parseHTML } from "linkedom";
import { extractVideoMetadata, type VideoMetadata } from "../utils/ffprobe.js";
import { downloadToTemp, isHttpUrl } from "../utils/urlDownloader.js";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";

export interface VideoElement {
  id: string;
  src: string;
  start: number;
  end: number;
  mediaStart: number;
  hasAudio: boolean;
}

export interface ExtractedFrames {
  videoId: string;
  srcPath: string;
  outputDir: string;
  framePattern: string;
  fps: number;
  totalFrames: number;
  metadata: VideoMetadata;
  framePaths: Map<number, string>;
}

export interface ExtractionOptions {
  fps: number;
  outputDir: string;
  quality?: number;
  format?: "jpg" | "png";
}

export interface ExtractionResult {
  success: boolean;
  extracted: ExtractedFrames[];
  errors: Array<{ videoId: string; error: string }>;
  totalFramesExtracted: number;
  durationMs: number;
}

export function parseVideoElements(html: string): VideoElement[] {
  const videos: VideoElement[] = [];
  const { document } = parseHTML(html);

  const videoEls = document.querySelectorAll("video[src]");
  let autoIdCounter = 0;
  for (const el of videoEls) {
    const src = el.getAttribute("src");
    if (!src) continue;
    // Generate a stable ID for videos without one — the producer needs IDs
    // to track extracted frames and composite them during encoding.
    const id = el.getAttribute("id") || `hf-video-${autoIdCounter++}`;
    if (!el.getAttribute("id")) {
      el.setAttribute("id", id);
    }

    const startAttr = el.getAttribute("data-start");
    const endAttr = el.getAttribute("data-end");
    const durationAttr = el.getAttribute("data-duration");
    const mediaStartAttr = el.getAttribute("data-media-start");
    const hasAudioAttr = el.getAttribute("data-has-audio");

    const start = startAttr ? parseFloat(startAttr) : 0;
    // Derive end from data-end → data-start+data-duration → Infinity (natural duration).
    // The caller (htmlCompiler) clamps Infinity to the composition's absoluteEnd.
    let end = 0;
    if (endAttr) {
      end = parseFloat(endAttr);
    } else if (durationAttr) {
      end = start + parseFloat(durationAttr);
    } else {
      end = Infinity; // no explicit bounds — play for the full natural video duration
    }

    videos.push({
      id,
      src,
      start,
      end,
      mediaStart: mediaStartAttr ? parseFloat(mediaStartAttr) : 0,
      hasAudio: hasAudioAttr === "true",
    });
  }

  return videos;
}

export async function extractVideoFramesRange(
  videoPath: string,
  videoId: string,
  startTime: number,
  duration: number,
  options: ExtractionOptions,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout">>,
): Promise<ExtractedFrames> {
  const ffmpegProcessTimeout = config?.ffmpegProcessTimeout ?? DEFAULT_CONFIG.ffmpegProcessTimeout;
  const { fps, outputDir, quality = 95, format = "jpg" } = options;

  const videoOutputDir = join(outputDir, videoId);
  if (!existsSync(videoOutputDir)) mkdirSync(videoOutputDir, { recursive: true });

  const metadata = await extractVideoMetadata(videoPath);
  const framePattern = `frame_%05d.${format}`;
  const outputPattern = join(videoOutputDir, framePattern);

  const args: string[] = [
    "-ss",
    String(startTime),
    "-i",
    videoPath,
    "-t",
    String(duration),
    "-vf",
    `fps=${fps}`,
    "-q:v",
    format === "jpg" ? String(Math.ceil((100 - quality) / 3)) : "0",
  ];
  if (format === "png") args.push("-compression_level", "6");
  args.push("-y", outputPattern);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args);
    let stderr = "";
    const onAbort = () => {
      ffmpeg.kill("SIGTERM");
    };
    if (signal) {
      if (signal.aborted) {
        ffmpeg.kill("SIGTERM");
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    const timer = setTimeout(() => {
      ffmpeg.kill("SIGTERM");
    }, ffmpegProcessTimeout);

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        reject(new Error("Video frame extraction cancelled"));
        return;
      }
      if (code !== 0) {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
        return;
      }

      const framePaths = new Map<number, string>();
      const files = readdirSync(videoOutputDir)
        .filter((f) => f.startsWith("frame_") && f.endsWith(`.${format}`))
        .sort();
      files.forEach((file, index) => {
        framePaths.set(index, join(videoOutputDir, file));
      });

      resolve({
        videoId,
        srcPath: videoPath,
        outputDir: videoOutputDir,
        framePattern,
        fps,
        totalFrames: framePaths.size,
        metadata,
        framePaths,
      });
    });

    ffmpeg.on("error", (err) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("[FFmpeg] ffmpeg not found"));
      } else {
        reject(err);
      }
    });
  });
}

export async function extractAllVideoFrames(
  videos: VideoElement[],
  baseDir: string,
  options: ExtractionOptions,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout">>,
): Promise<ExtractionResult> {
  const startTime = Date.now();
  const extracted: ExtractedFrames[] = [];
  const errors: Array<{ videoId: string; error: string }> = [];
  let totalFramesExtracted = 0;

  // Process videos in parallel for better performance
  const results = await Promise.all(
    videos.map(async (video) => {
      if (signal?.aborted) {
        throw new Error("Video frame extraction cancelled");
      }
      try {
        let videoPath = video.src;
        if (!videoPath.startsWith("/") && !isHttpUrl(videoPath)) {
          videoPath = join(baseDir, videoPath);
        }

        if (isHttpUrl(videoPath)) {
          const downloadDir = join(options.outputDir, "_downloads");
          mkdirSync(downloadDir, { recursive: true });
          videoPath = await downloadToTemp(videoPath, downloadDir);
        }

        if (!existsSync(videoPath)) {
          return { error: { videoId: video.id, error: `Video file not found: ${videoPath}` } };
        }

        let videoDuration = video.end - video.start;

        // Fallback: if no data-duration/data-end was specified (end is Infinity or 0),
        // probe the actual video file to get its natural duration.
        if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
          const metadata = await extractVideoMetadata(videoPath);
          const sourceDuration = metadata.durationSeconds - video.mediaStart;
          videoDuration = sourceDuration > 0 ? sourceDuration : metadata.durationSeconds;
          video.end = video.start + videoDuration;
        }

        const result = await extractVideoFramesRange(
          videoPath,
          video.id,
          video.mediaStart,
          videoDuration,
          options,
          signal,
          config,
        );

        return { result };
      } catch (err) {
        return {
          error: {
            videoId: video.id,
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }),
  );

  // Collect results and errors
  for (const item of results) {
    if ("error" in item && item.error) {
      errors.push(item.error);
    } else if ("result" in item) {
      extracted.push(item.result);
      totalFramesExtracted += item.result.totalFrames;
    }
  }

  return {
    success: errors.length === 0,
    extracted,
    errors,
    totalFramesExtracted,
    durationMs: Date.now() - startTime,
  };
}

export function getFrameAtTime(
  extracted: ExtractedFrames,
  globalTime: number,
  videoStart: number,
): string | null {
  const localTime = globalTime - videoStart;
  if (localTime < 0) return null;
  const frameIndex = Math.floor(localTime * extracted.fps);
  if (frameIndex < 0 || frameIndex >= extracted.totalFrames) return null;
  return extracted.framePaths.get(frameIndex) || null;
}

export class FrameLookupTable {
  private videos: Map<
    string,
    {
      extracted: ExtractedFrames;
      start: number;
      end: number;
      mediaStart: number;
    }
  > = new Map();
  private orderedVideos: Array<{
    videoId: string;
    extracted: ExtractedFrames;
    start: number;
    end: number;
    mediaStart: number;
  }> = [];
  private activeVideoIds: Set<string> = new Set();
  private startCursor = 0;
  private lastTime: number | null = null;

  addVideo(extracted: ExtractedFrames, start: number, end: number, mediaStart: number): void {
    this.videos.set(extracted.videoId, { extracted, start, end, mediaStart });
    this.orderedVideos = Array.from(this.videos.entries())
      .map(([videoId, video]) => ({ videoId, ...video }))
      .sort((a, b) => a.start - b.start);
    this.resetActiveState();
  }

  getFrame(videoId: string, globalTime: number): string | null {
    const video = this.videos.get(videoId);
    if (!video) return null;
    if (globalTime < video.start || globalTime >= video.end) return null;
    return getFrameAtTime(video.extracted, globalTime, video.start);
  }

  private resetActiveState(): void {
    this.activeVideoIds.clear();
    this.startCursor = 0;
    this.lastTime = null;
  }

  private refreshActiveSet(globalTime: number): void {
    if (this.lastTime == null || globalTime < this.lastTime) {
      this.activeVideoIds.clear();
      this.startCursor = 0;
      for (const entry of this.orderedVideos) {
        if (entry.start <= globalTime && globalTime < entry.end) {
          this.activeVideoIds.add(entry.videoId);
        }
        if (entry.start <= globalTime) {
          this.startCursor += 1;
        } else {
          break;
        }
      }
      this.lastTime = globalTime;
      return;
    }

    while (this.startCursor < this.orderedVideos.length) {
      const candidate = this.orderedVideos[this.startCursor];
      if (!candidate) break;
      if (candidate.start > globalTime) {
        break;
      }
      if (globalTime < candidate.end) {
        this.activeVideoIds.add(candidate.videoId);
      }
      this.startCursor += 1;
    }

    for (const videoId of Array.from(this.activeVideoIds)) {
      const video = this.videos.get(videoId);
      if (!video || globalTime < video.start || globalTime >= video.end) {
        this.activeVideoIds.delete(videoId);
      }
    }
    this.lastTime = globalTime;
  }

  getActiveFramePayloads(
    globalTime: number,
  ): Map<string, { framePath: string; frameIndex: number }> {
    const frames = new Map<string, { framePath: string; frameIndex: number }>();
    this.refreshActiveSet(globalTime);
    for (const videoId of this.activeVideoIds) {
      const video = this.videos.get(videoId);
      if (!video) continue;
      const localTime = globalTime - video.start;
      const frameIndex = Math.floor(localTime * video.extracted.fps);
      if (frameIndex < 0 || frameIndex >= video.extracted.totalFrames) continue;
      const framePath = video.extracted.framePaths.get(frameIndex);
      if (!framePath) continue;
      frames.set(videoId, { framePath, frameIndex });
    }
    return frames;
  }

  getActiveFrames(globalTime: number): Map<string, string> {
    const payloads = this.getActiveFramePayloads(globalTime);
    const frames = new Map<string, string>();
    for (const [videoId, payload] of payloads) {
      frames.set(videoId, payload.framePath);
    }
    return frames;
  }

  cleanup(): void {
    for (const video of this.videos.values()) {
      if (existsSync(video.extracted.outputDir)) {
        rmSync(video.extracted.outputDir, { recursive: true, force: true });
      }
    }
    this.videos.clear();
    this.orderedVideos = [];
    this.resetActiveState();
  }
}

export function createFrameLookupTable(
  videos: VideoElement[],
  extracted: ExtractedFrames[],
): FrameLookupTable {
  const table = new FrameLookupTable();
  const extractedMap = new Map<string, ExtractedFrames>();
  for (const ext of extracted) extractedMap.set(ext.videoId, ext);

  for (const video of videos) {
    const ext = extractedMap.get(video.id);
    if (ext) table.addVideo(ext, video.start, video.end, video.mediaStart);
  }

  return table;
}
