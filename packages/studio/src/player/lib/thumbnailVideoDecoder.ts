import { TIMELINE_VIEWPORT_BUDGETS, type TimelineViewportBudgets } from "./timelineViewportBudgets";
import type { ThumbnailLoadedResult, ThumbnailValue } from "./thumbnailScheduler";

export interface VideoThumbnailDecodeRequest {
  source: string;
  sourceStart?: number;
  sourceRangeDuration?: number;
  frameCount: number;
  fit?: "contain" | "cover";
}

/**
 * The times a strip of `frameCount` frames shows: each frame's left edge, so a strip twice as long
 * holds every frame of this one and a zoom decodes only the new half. A poster is the midpoint.
 */
export function videoThumbnailTimestamps(
  start: number,
  duration: number,
  frameCount: number,
): number[] {
  const safeStart = Math.max(0, Number.isFinite(start) ? start : 0);
  const safeDuration = Math.max(0, Number.isFinite(duration) ? duration : 0);
  const count = Math.max(1, Number.isFinite(frameCount) ? Math.floor(frameCount) : 1);
  if (count === 1) return [safeStart + safeDuration / 2];
  return Array.from({ length: count }, (_, index) => safeStart + (safeDuration * index) / count);
}

/** A decoded frame shared by every strip of its source that shows that time. */
interface SharedFrame {
  url: string;
  users: number;
}

const sharedFrames = new Map<string, SharedFrame>();
const sourceInfos = new Map<string, SourceInfo>();

function takeSharedFrame(key: string): string | undefined {
  const frame = sharedFrames.get(key);
  if (frame) frame.users += 1;
  return frame?.url;
}

/** Shares a newly decoded frame, or the copy another strip decoded meanwhile. */
function shareFrame(key: string, url: string): string {
  const existing = takeSharedFrame(key);
  if (existing === undefined) {
    sharedFrames.set(key, { url, users: 1 });
    return url;
  }
  URL.revokeObjectURL(url);
  return existing;
}

function releaseSharedFrames(keys: string[]): void {
  for (const key of keys.splice(0)) {
    const frame = sharedFrames.get(key);
    if (!frame || --frame.users > 0) continue;
    sharedFrames.delete(key);
    URL.revokeObjectURL(frame.url);
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Video thumbnail encode failed"))),
        "image/jpeg",
        0.72,
      );
    });
  }
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 });
}

interface DecodedResources {
  /** One frame per slot of the strip; a slot the source could not decode stays empty. */
  urls: (string | undefined)[];
  /** The shared frames this strip holds, released when the strip is. */
  keys: string[];
  canvases: Set<HTMLCanvasElement | OffscreenCanvas>;
}

interface ThumbnailCanvasSink {
  canvasesAtTimestamps(
    timestamps: AsyncIterable<number>,
  ): AsyncIterable<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null>;
}

/** What a strip of a source needs before it can name its frames. */
interface SourceInfo {
  aspect: number;
  metadataDuration: number | null;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}

function releaseDecodedResources(resources: DecodedResources): void {
  resources.urls.length = 0;
  releaseSharedFrames(resources.keys);
  for (const canvas of resources.canvases) {
    canvas.width = 0;
    canvas.height = 0;
  }
  resources.canvases.clear();
}

function targetDimensions(
  aspect: number,
  budgets: Readonly<TimelineViewportBudgets>,
): { width: number; height: number } {
  const width = Math.max(
    1,
    Math.min(budgets.posterMaxPhysicalWidth, Math.round(budgets.posterMaxPhysicalHeight * aspect)),
  );
  return {
    width,
    height: Math.max(1, Math.min(budgets.posterMaxPhysicalHeight, Math.round(width / aspect))),
  };
}

/** The strip's source range and frame times, clamped to what the file holds. */
function stripTimes(
  request: VideoThumbnailDecodeRequest,
  info: SourceInfo,
  budgets: Readonly<TimelineViewportBudgets>,
) {
  const requestedStart = Math.max(0, request.sourceStart ?? 0);
  const sourceDuration = Math.max(
    0,
    info.metadataDuration ?? requestedStart + (request.sourceRangeDuration ?? 0),
  );
  const sourceStart = Math.min(requestedStart, sourceDuration);
  const requestedDuration =
    request.sourceRangeDuration ?? Math.max(0, sourceDuration - sourceStart);
  const duration = Math.min(
    Math.max(0, requestedDuration),
    Math.max(0, sourceDuration - sourceStart),
  );
  const timestamps = videoThumbnailTimestamps(
    sourceStart,
    duration,
    Math.min(request.frameCount, budgets.richPreviewFrameCount),
  );
  return { sourceStart, duration, timestamps };
}

/** Holds every frame of the strip already decoded; returns the slots still to decode. */
function takeDecodedFrames(
  timestamps: number[],
  keyOf: (time: number) => string,
  resources: DecodedResources,
): number[] {
  const missing: number[] = [];
  timestamps.forEach((time, slot) => {
    const url = takeSharedFrame(keyOf(time));
    if (url === undefined) return void missing.push(slot);
    resources.urls[slot] = url;
    resources.keys.push(keyOf(time));
  });
  return missing;
}

async function decodeFrames(
  sink: ThumbnailCanvasSink,
  times: AsyncIterable<number>,
  slots: { slot: number; key: string }[],
  signal: AbortSignal,
  resources: DecodedResources,
): Promise<void> {
  let next = 0;
  for await (const wrapped of sink.canvasesAtTimestamps(times)) {
    throwIfAborted(signal);
    const target = slots[next++];
    if (!wrapped || !target) continue;
    resources.canvases.add(wrapped.canvas);
    const blob = await canvasToBlob(wrapped.canvas);
    throwIfAborted(signal);
    resources.urls[target.slot] = shareFrame(target.key, URL.createObjectURL(blob));
    resources.keys.push(target.key);
  }
  throwIfAborted(signal);
}

function loadedResult(
  resources: DecodedResources,
  aspect: number,
  budgets: Readonly<TimelineViewportBudgets>,
): ThumbnailLoadedResult {
  const urls = resources.urls.filter((url): url is string => url !== undefined);
  const firstUrl = urls[0];
  if (!firstUrl) throw new Error("Video source returned no thumbnail frames");
  const { width, height } = targetDimensions(aspect, budgets);
  const value: ThumbnailValue =
    urls.length === 1
      ? { kind: "image", url: firstUrl, aspect }
      : { kind: "filmstrip", urls, aspect };
  return {
    value,
    weight: width * height * 4 * urls.length,
    dispose: () => releaseDecodedResources(resources),
  };
}

/**
 * Sparse Mediabunny extraction with one pooled canvas and one cleanup owner. Frames another strip
 * of the source already shows are reused, so a zoom decodes only the frames that are new.
 */
export async function decodeVideoThumbnail(
  request: VideoThumbnailDecodeRequest,
  signal: AbortSignal,
  budgets: Readonly<TimelineViewportBudgets> = TIMELINE_VIEWPORT_BUDGETS,
): Promise<ThumbnailLoadedResult> {
  const fit = request.fit ?? "cover";
  const keyOf = (time: number) => `${request.source}\u0000${fit}\u0000${time}`;
  const resources: DecodedResources = { urls: [], keys: [], canvases: new Set() };
  const known = sourceInfos.get(request.source);
  try {
    if (known) {
      const { timestamps } = stripTimes(request, known, budgets);
      if (takeDecodedFrames(timestamps, keyOf, resources).length === 0) {
        throwIfAborted(signal);
        return loadedResult(resources, known.aspect, budgets);
      }
      releaseDecodedResources(resources);
    }
    return await decodeMissingFrames(request, signal, budgets, keyOf, resources);
  } catch (error) {
    releaseDecodedResources(resources);
    throw error;
  }
}

async function decodeMissingFrames(
  request: VideoThumbnailDecodeRequest,
  signal: AbortSignal,
  budgets: Readonly<TimelineViewportBudgets>,
  keyOf: (time: number) => string,
  resources: DecodedResources,
): Promise<ThumbnailLoadedResult> {
  const mediabunny = await import("mediabunny");
  throwIfAborted(signal);

  const input = new mediabunny.Input({
    source: new mediabunny.UrlSource(request.source),
    formats: mediabunny.ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    throwIfAborted(signal);
    if (!track) throw new Error("Video source has no decodable video track");
    const [displayWidth, displayHeight] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
    ]);
    throwIfAborted(signal);
    if (!(displayWidth > 0 && displayHeight > 0)) {
      throw new Error("Video source has invalid dimensions");
    }
    const metadataDuration = await track.getDurationFromMetadata({ skipLiveWait: true });
    throwIfAborted(signal);
    const info: SourceInfo = { aspect: displayWidth / displayHeight, metadataDuration };
    sourceInfos.set(request.source, info);
    const { sourceStart, duration, timestamps } = stripTimes(request, info, budgets);
    const slots = takeDecodedFrames(timestamps, keyOf, resources).map((slot) => ({
      slot,
      key: keyOf(timestamps[slot]!),
    }));
    if (slots.length > 0) {
      const keys = new mediabunny.EncodedPacketSink(track);
      const maxKeyframeLead = duration / Math.max(2, timestamps.length) / 2;
      async function* decodeTimesAtNearbyKeyframes() {
        for (const { slot } of slots) {
          const time = timestamps[slot]!;
          const key = await keys.getKeyPacket(time, { metadataOnly: true });
          if (signal.aborted) return;
          const near =
            key && key.timestamp >= sourceStart && time - key.timestamp <= maxKeyframeLead;
          yield near ? key.timestamp : time;
        }
      }
      const target = targetDimensions(info.aspect, budgets);
      const sink = new mediabunny.CanvasSink(track, {
        width: target.width,
        height: target.height,
        fit: request.fit ?? "cover",
        poolSize: 1,
      });
      await decodeFrames(sink, decodeTimesAtNearbyKeyframes(), slots, signal, resources);
    }
    return loadedResult(resources, info.aspect, budgets);
  } finally {
    input.dispose();
  }
}
