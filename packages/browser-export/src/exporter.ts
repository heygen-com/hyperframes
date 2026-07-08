// fallow-ignore-file complexity
// Browser-only orchestration (canvas capture + WebCodecs), not coverable by
// Node unit tests; the CRAP score is inflated by the missing coverage.
import { collectAudioClips } from "./audioClips.js";
import { mixAudioClips } from "./audioMix.js";
import {
  findCompositionRoot,
  readCompositionMeta,
  type CompositionMeta,
} from "./compositionMeta.js";
import { createEncoder, type Encoder } from "./encoder.js";
import { createFrameCapturer, type FrameCapturer } from "./frameCapture.js";
import { frameCount, frameTimestamp } from "./frameTiming.js";
import { seekMediaElements } from "./mediaSeek.js";
import {
  resolveDuration,
  resolveTimelineRegistry,
  seekTimelines,
  type TimelineRegistry,
} from "./timelineSeek.js";
import type { ExportOptions, ExportResult } from "./types.js";

const DEFAULT_FPS = 30;
const DEFAULT_KEYFRAME_INTERVAL_SECONDS = 2;

interface ExportPlan {
  root: HTMLElement;
  meta: CompositionMeta;
  registry: TimelineRegistry;
  fps: number;
  durationSeconds: number;
  totalFrames: number;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("Export aborted");
}

function planExport(target: HTMLElement | Document, options: ExportOptions): ExportPlan {
  const root = findCompositionRoot(target);
  if (!root) {
    throw new Error(
      "No composition root found — expected an element with [data-composition-id] or #root",
    );
  }
  const meta = readCompositionMeta(root);
  const registry = resolveTimelineRegistry(root);
  const fps = options.fps ?? DEFAULT_FPS;
  const durationSeconds = resolveDuration(registry, meta.id, options.duration);
  if (durationSeconds <= 0) {
    throw new Error(
      "Could not resolve composition duration — register a GSAP timeline in window.__timelines or pass options.duration",
    );
  }
  return {
    root: root as HTMLElement,
    meta,
    registry,
    fps,
    durationSeconds,
    totalFrames: frameCount(durationSeconds, fps),
  };
}

async function prepareAudio(plan: ExportPlan, options: ExportOptions): Promise<AudioBuffer | null> {
  if (options.includeAudio === false) return null;
  options.onProgress?.({
    phase: "audio",
    renderedFrames: 0,
    totalFrames: plan.totalFrames,
    fraction: 0,
  });
  const scope = plan.root.ownerDocument ?? plan.root;
  return mixAudioClips(collectAudioClips(scope), plan.durationSeconds);
}

async function encodeFrames(
  plan: ExportPlan,
  capturer: FrameCapturer,
  encoder: Encoder,
  options: ExportOptions,
): Promise<void> {
  const interval = options.keyFrameIntervalSeconds ?? DEFAULT_KEYFRAME_INTERVAL_SECONDS;
  const keyFrameEvery = Math.max(1, Math.round(interval * plan.fps));
  for (let frame = 0; frame < plan.totalFrames; frame += 1) {
    throwIfAborted(options.signal);
    const timestamp = frameTimestamp(frame, plan.fps);
    seekTimelines(plan.registry, timestamp, plan.fps);
    await seekMediaElements(plan.root, timestamp);
    await capturer.capture();
    await encoder.addFrame(timestamp, 1 / plan.fps, frame % keyFrameEvery === 0);
    options.onProgress?.({
      phase: "video",
      renderedFrames: frame + 1,
      totalFrames: plan.totalFrames,
      fraction: (frame + 1) / plan.totalFrames,
    });
  }
}

/**
 * Render a live composition to MP4/WebM entirely in the browser — no server,
 * no FFmpeg, no headless Chrome. Frames are sampled with the same quantized
 * deterministic seek the producer uses, rasterized via SVG foreignObject and
 * encoded with WebCodecs through mediabunny.
 */
export async function exportComposition(
  target: HTMLElement | Document,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const plan = planExport(target, options);
  const audioBuffer = await prepareAudio(plan, options);
  const capturer = await createFrameCapturer(
    plan.root,
    plan.meta.width,
    plan.meta.height,
    options.pixelRatio ?? 1,
  );
  const encoder = await createEncoder(capturer.canvas, {
    format: options.format ?? "mp4",
    fps: plan.fps,
    videoBitrate: options.videoBitrate,
    audioBitrate: options.audioBitrate,
    withAudio: audioBuffer != null,
  });
  if (audioBuffer) await encoder.addAudio(audioBuffer);
  await encodeFrames(plan, capturer, encoder, options);
  options.onProgress?.({
    phase: "finalize",
    renderedFrames: plan.totalFrames,
    totalFrames: plan.totalFrames,
    fraction: 1,
  });
  const blob = await encoder.finalize();
  return {
    blob,
    mimeType: encoder.mimeType,
    width: plan.meta.width,
    height: plan.meta.height,
    fps: plan.fps,
    durationSeconds: plan.durationSeconds,
    frameCount: plan.totalFrames,
    compositionId: plan.meta.id,
  };
}
