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

/** Sparse Mediabunny extraction with one pooled canvas and one cleanup owner. */
export async function decodeVideoThumbnail(
  request: VideoThumbnailDecodeRequest,
  signal: AbortSignal,
  budgets: Readonly<TimelineViewportBudgets> = TIMELINE_VIEWPORT_BUDGETS,
): Promise<ThumbnailLoadedResult> {
  const mediabunny = await import("mediabunny");
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  const input = new mediabunny.Input({
    source: new mediabunny.UrlSource(request.source),
    formats: mediabunny.ALL_FORMATS,
  });
  const urls: string[] = [];
  const canvases = new Set<HTMLCanvasElement | OffscreenCanvas>();
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("Video source has no decodable video track");
    const [displayWidth, displayHeight] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
    ]);
    if (!(displayWidth > 0 && displayHeight > 0)) {
      throw new Error("Video source has invalid dimensions");
    }
    const metadataDuration = await track.getDurationFromMetadata({ skipLiveWait: true });
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
    const targetWidth = Math.max(
      1,
      Math.min(
        budgets.posterMaxPhysicalWidth,
        Math.round(budgets.posterMaxPhysicalHeight * aspect),
      ),
    );
    const targetHeight = Math.max(
      1,
      Math.min(budgets.posterMaxPhysicalHeight, Math.round(targetWidth / aspect)),
    );
    const sink = new mediabunny.CanvasSink(track, {
      width: Math.max(1, targetWidth),
      height: Math.max(1, targetHeight),
      fit: request.fit ?? "cover",
      poolSize: 1,
    });

    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!wrapped) continue;
      canvases.add(wrapped.canvas);
      const blob = await canvasToBlob(wrapped.canvas);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      urls.push(URL.createObjectURL(blob));
    }
    if (urls.length === 0) throw new Error("Video source returned no thumbnail frames");

    const dispose = () => {
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
      for (const canvas of canvases) {
        canvas.width = 0;
        canvas.height = 0;
      }
      canvases.clear();
    };
    const firstUrl = urls[0];
    if (!firstUrl) throw new Error("Video source returned no thumbnail frames");
    const value: ThumbnailValue =
      urls.length === 1
        ? { kind: "image", url: firstUrl, aspect }
        : { kind: "filmstrip", urls: [...urls], aspect };
    return {
      value,
      weight: targetWidth * targetHeight * 4 * urls.length,
      dispose,
    };
  } catch (error) {
    for (const url of urls) URL.revokeObjectURL(url);
    for (const canvas of canvases) {
      canvas.width = 0;
      canvas.height = 0;
    }
    throw error;
  } finally {
    input.dispose();
  }
}
