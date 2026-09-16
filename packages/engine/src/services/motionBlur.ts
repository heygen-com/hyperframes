import type { Page } from "puppeteer-core";

export interface MotionBlurSettings {
  samples: number;
  shutterAngle: number;
  shutterPhase: number;
}

export function parseMotionBlurSettings(
  samples: string | null,
  angle: string | null,
  phase: string | null,
): MotionBlurSettings | undefined {
  if (samples === null || samples === "0" || samples === "1") return undefined;
  const settings = {
    samples: Number(samples),
    shutterAngle: angle === null ? 180 : Number(angle),
    shutterPhase: phase === null ? -90 : Number(phase),
  };
  if (!Number.isInteger(settings.samples) || settings.samples < 2 || settings.samples > 64) {
    throw new Error(
      "data-motion-blur-samples must be an integer from 2 to 64 (0 or 1 disables it)",
    );
  }
  if (
    !Number.isFinite(settings.shutterAngle) ||
    settings.shutterAngle <= 0 ||
    settings.shutterAngle > 720
  ) {
    throw new Error("data-shutter-angle must be greater than 0 and at most 720 degrees");
  }
  if (!Number.isFinite(settings.shutterPhase) || Math.abs(settings.shutterPhase) > 360) {
    throw new Error("data-shutter-phase must be between -360 and 360 degrees");
  }
  return settings;
}

export function motionBlurSampleTimes(
  time: number,
  fps: number,
  duration: number,
  settings: MotionBlurSettings,
): number[] {
  const start = time + settings.shutterPhase / 360 / fps;
  const shutter = settings.shutterAngle / 360 / fps;
  return Array.from({ length: settings.samples }, (_, i) =>
    Math.max(0, Math.min(duration, start + ((i + 0.5) / settings.samples) * shutter)),
  );
}

/** Keep the complete shutter inside the existing verified static interval, with a frame margin. */
export function motionBlurFrameIsStatic(
  staticFrames: ReadonlySet<number> | undefined,
  frame: number,
  settings: MotionBlurSettings,
  includePrevious = false,
): boolean {
  if (!staticFrames) return false;
  const first =
    Math.floor(frame - (includePrevious ? 1 : 0) + Math.min(0, settings.shutterPhase / 360)) - 1;
  const last =
    Math.ceil(frame + Math.max(0, (settings.shutterPhase + settings.shutterAngle) / 360)) + 1;
  for (let candidate = first; candidate <= last; candidate++) {
    if (!staticFrames.has(candidate)) return false;
  }
  return true;
}

/** Average premultiplied sRGB samples; alpha is averaged, not composited as stacked layers. */
export async function blendMotionBlurSamples(
  page: Page,
  samples: readonly Buffer[],
  format: "png" | "jpeg",
  quality: number,
): Promise<Buffer> {
  const encoded = await page.evaluate(
    async (inputs, outputFormat, outputQuality) => {
      // These helpers stay inside evaluate so Puppeteer serializes them with the browser work.
      function accumulate(sums: Float32Array, pixels: Uint8ClampedArray): void {
        for (let i = 0; i < pixels.length; i += 4) {
          const alpha = pixels[i + 3] ?? 0;
          for (let channel = 0; channel < 3; channel++) {
            sums[i + channel] = (sums[i + channel] ?? 0) + (pixels[i + channel] ?? 0) * alpha;
          }
          sums[i + 3] = (sums[i + 3] ?? 0) + alpha;
        }
      }
      function resolveAverage(pixels: Uint8ClampedArray, sums: Float32Array, count: number): void {
        for (let i = 0; i < pixels.length; i += 4) {
          const alpha = sums[i + 3] ?? 0;
          for (let channel = 0; channel < 3; channel++) {
            pixels[i + channel] = alpha ? (sums[i + channel] ?? 0) / alpha : 0;
          }
          pixels[i + 3] = alpha / count;
        }
      }
      function getContext(canvas: OffscreenCanvas) {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Motion blur requires an OffscreenCanvas 2D context");
        return ctx;
      }
      let canvas: OffscreenCanvas | undefined;
      let sums: Float32Array | undefined;
      for (const input of inputs) {
        const bytes = Uint8Array.from(atob(input), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        canvas ??= new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = getContext(canvas);
        if (bitmap.width !== canvas.width || bitmap.height !== canvas.height) {
          bitmap.close();
          throw new Error("Motion blur sample dimensions changed during capture");
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        sums ??= new Float32Array(pixels.length);
        accumulate(sums, pixels);
      }
      if (!canvas || !sums) throw new Error("Motion blur needs at least one capture");
      const ctx = getContext(canvas);
      const result = ctx.createImageData(canvas.width, canvas.height);
      resolveAverage(result.data, sums, inputs.length);
      ctx.putImageData(result, 0, 0);
      const blob = await canvas.convertToBlob({
        type: `image/${outputFormat}`,
        quality: outputQuality / 100,
      });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 32768) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      }
      return btoa(binary);
    },
    samples.map((sample) => sample.toString("base64")),
    format,
    quality,
  );
  return Buffer.from(encoded, "base64");
}
