/** The slice of a Mediabunny video sample the strip reads. */
interface FrameSample {
  rotation: number;
  flipped?: boolean;
  toVideoFrame(): VideoFrame;
  drawWithFit(
    context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    options: { fit: "contain" | "cover" },
  ): void;
  close(): void;
}

interface FrameSampleSink {
  samplesAtTimestamps(timestamps: AsyncIterable<number>): AsyncIterable<FrameSample | null>;
}

type FrameCanvas = HTMLCanvasElement | OffscreenCanvas;
type Box = { width: number; height: number };

function newCanvas({ width, height }: Box): FrameCanvas {
  if (typeof document === "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The part of a source that fills a box of the target's shape, centred. */
function coverCrop(source: Box, target: Box) {
  const scale = Math.max(target.width / source.width, target.height / source.height);
  const width = Math.min(source.width, target.width / scale);
  const height = Math.min(source.height, target.height / scale);
  return { x: (source.width - width) / 2, y: (source.height - height) / 2, width, height };
}

async function drawScaled(
  sample: FrameSample,
  context: CanvasRenderingContext2D,
  target: Box,
  fit: "contain" | "cover",
): Promise<void> {
  const frame = sample.toVideoFrame();
  const source = { width: frame.displayWidth, height: frame.displayHeight };
  const crop = fit === "cover" ? coverCrop(source, target) : { x: 0, y: 0, ...source };
  const bitmap = await createImageBitmap(frame, crop.x, crop.y, crop.width, crop.height, {
    resizeWidth: target.width,
    resizeHeight: target.height,
    resizeQuality: "medium",
  }).finally(() => frame.close());
  try {
    context.drawImage(bitmap, 0, 0, target.width, target.height);
  } finally {
    bitmap.close();
  }
}

/**
 * Strip frames cropped and scaled by the browser off the main thread: drawing a 4K frame onto a strip-sized canvas
 * holds the main thread for 100 ms or more. Turned or flipped frames keep the sample's own draw, which turns them.
 */
export async function* scaledFrames(
  sink: FrameSampleSink,
  times: AsyncIterable<number>,
  target: Box,
  fit: "contain" | "cover",
): AsyncGenerator<{ canvas: FrameCanvas } | null> {
  for await (const sample of sink.samplesAtTimestamps(times)) {
    if (!sample) {
      yield null;
      continue;
    }
    try {
      const canvas = newCanvas(target);
      const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
      if (!context) throw new Error("Thumbnail canvas has no 2d context");
      if (sample.rotation === 0 && !sample.flipped) await drawScaled(sample, context, target, fit);
      else sample.drawWithFit(context, { fit });
      yield { canvas };
    } finally {
      sample.close();
    }
  }
}
