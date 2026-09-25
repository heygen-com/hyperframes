import { TIMELINE_VIEWPORT_BUDGETS, type TimelineViewportBudgets } from "./timelineViewportBudgets";
import type { ThumbnailLoadedResult, ThumbnailValue } from "./thumbnailScheduler";

export interface VideoThumbnailDecodeRequest {
  source: string;
  sourceStart?: number;
  sourceRangeDuration?: number;
  frameCount: number;
  fit?: "contain" | "cover";
}

export function videoThumbnailTimestamps(
  start: number,
  duration: number,
  frameCount: number,
): number[] {
  const safeStart = Math.max(0, Number.isFinite(start) ? start : 0);
  const safeDuration = Math.max(0, Number.isFinite(duration) ? duration : 0);
  const count = Math.max(1, Number.isFinite(frameCount) ? Math.floor(frameCount) : 1);
  if (count === 1) return [safeStart + safeDuration / 2];
  return Array.from(
    { length: count },
    (_, index) => safeStart + (safeDuration * index) / (count - 1),
  );
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
  urls: string[];
  canvases: Set<HTMLCanvasElement | OffscreenCanvas>;
}

type Mediabunny = typeof import("mediabunny");
type VideoSample = InstanceType<Mediabunny["VideoSample"]>;
type ThumbnailFit = "contain" | "cover";

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}

function releaseDecodedResources(resources: DecodedResources): void {
  for (const url of resources.urls.splice(0)) URL.revokeObjectURL(url);
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

async function thumbnailSizedBitmap(
  sample: VideoSample,
  drawScale: number,
  pixelBuffer: (bytes: number) => Uint8ClampedArray<ArrayBuffer>,
): Promise<ImageBitmap | null> {
  const { width, height } = sample.visibleRect;
  if (sample.allocationSize({ format: "RGBA" }) !== width * height * 4) return null;
  const pixels = pixelBuffer(width * height * 4);
  await sample.copyTo(pixels, { format: "RGBA" });
  const scale = Math.min(1, drawScale);
  return createImageBitmap(new ImageData(pixels, width, height), {
    resizeWidth: Math.max(1, Math.round(sample.squarePixelWidth * scale)),
    resizeHeight: Math.max(1, Math.round(sample.squarePixelHeight * scale)),
    resizeQuality: "medium",
  });
}

async function drawThumbnailFrame(
  sample: VideoSample,
  context: CanvasRenderingContext2D,
  fit: ThumbnailFit,
  pixelBuffer: (bytes: number) => Uint8ClampedArray<ArrayBuffer>,
): Promise<void> {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);
  const quarterTurn = sample.rotation % 180 !== 0;
  const drawScale = (fit === "contain" ? Math.min : Math.max)(
    width / (quarterTurn ? sample.squarePixelHeight : sample.squarePixelWidth),
    height / (quarterTurn ? sample.squarePixelWidth : sample.squarePixelHeight),
  );
  const bitmap = await thumbnailSizedBitmap(sample, drawScale, pixelBuffer);
  if (!bitmap) {
    sample.drawWithFit(context, { fit });
    return;
  }
  const drawWidth = sample.squarePixelWidth * drawScale;
  const drawHeight = sample.squarePixelHeight * drawScale;
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate((sample.rotation * Math.PI) / 180);
  context.drawImage(bitmap, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
  bitmap.close();
}

async function decodeFrames(
  samples: AsyncIterable<VideoSample | null>,
  canvas: HTMLCanvasElement,
  fit: ThumbnailFit,
  signal: AbortSignal,
  resources: DecodedResources,
): Promise<void> {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Video thumbnail canvas is unavailable");
  resources.canvases.add(canvas);
  let pixels = new Uint8ClampedArray(new ArrayBuffer(0));
  const pixelBuffer = (bytes: number) =>
    pixels.length === bytes ? pixels : (pixels = new Uint8ClampedArray(new ArrayBuffer(bytes)));
  for await (const sample of samples) {
    if (!sample) continue;
    try {
      throwIfAborted(signal);
      await drawThumbnailFrame(sample, context, fit, pixelBuffer);
    } finally {
      sample.close();
    }
    const blob = await canvasToBlob(canvas);
    throwIfAborted(signal);
    resources.urls.push(URL.createObjectURL(blob));
  }
}

function loadedResult(
  resources: DecodedResources,
  aspect: number,
  width: number,
  height: number,
): ThumbnailLoadedResult {
  const firstUrl = resources.urls[0];
  if (!firstUrl) throw new Error("Video source returned no thumbnail frames");
  const value: ThumbnailValue =
    resources.urls.length === 1
      ? { kind: "image", url: firstUrl, aspect }
      : { kind: "filmstrip", urls: [...resources.urls], aspect };
  return {
    value,
    weight: width * height * 4 * resources.urls.length,
    dispose: () => releaseDecodedResources(resources),
  };
}

/** Sparse Mediabunny extraction with one pooled canvas and one cleanup owner. */
export async function decodeVideoThumbnail(
  request: VideoThumbnailDecodeRequest,
  signal: AbortSignal,
  budgets: Readonly<TimelineViewportBudgets> = TIMELINE_VIEWPORT_BUDGETS,
): Promise<ThumbnailLoadedResult> {
  const mediabunny = await import("mediabunny");
  throwIfAborted(signal);

  const input = new mediabunny.Input({
    source: new mediabunny.UrlSource(request.source),
    formats: mediabunny.ALL_FORMATS,
  });
  const resources: DecodedResources = { urls: [], canvases: new Set() };
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
    const sourceDuration = Math.max(0, metadataDuration ?? request.sourceRangeDuration ?? 0);
    const sourceStart = Math.min(Math.max(0, request.sourceStart ?? 0), sourceDuration);
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
    const aspect = displayWidth / displayHeight;
    const target = targetDimensions(aspect, budgets);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const samples = new mediabunny.VideoSampleSink(track).samplesAtTimestamps(timestamps);
    await decodeFrames(samples, canvas, request.fit ?? "cover", signal, resources);
    return loadedResult(resources, aspect, target.width, target.height);
  } catch (error) {
    releaseDecodedResources(resources);
    throw error;
  } finally {
    input.dispose();
  }
}
