/// <reference types="@webgpu/types" />
/**
 * HDR Capture Service
 *
 * Captures HDR video frames via WebGPU float16 readback.
 *
 * The pipeline:
 * 1. FFmpeg extracts raw HDR pixels (rgba64le) from video sources
 * 2. Node converts HLG/PQ signal → linear light → float16
 * 3. writeTexture uploads float16 data to WebGPU rgba16float texture
 * 4. (Optional) WebGPU shader applies GSAP CSS transform
 * 5. readback extracts float16 RGBA via base64 transfer
 * 6. Node converts linear float16 → PQ signal → pipe to FFmpeg H.265
 *
 * Requirements:
 * - Headed Chrome (not headless) — WebGPU unavailable in headless mode
 * - GPU access (Metal on macOS, Vulkan+NVIDIA on Linux)
 *
 * Performance: ~6 fps at 1080x1920 via base64 transfer.
 */

import type { Page, Browser, PuppeteerNode } from "puppeteer-core";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ── PQ (SMPTE 2084) OETF ─────────────────────────────────────────────────────

const PQ_M1 = 0.1593017578125;
const PQ_M2 = 78.84375;
const PQ_C1 = 0.8359375;
const PQ_C2 = 18.8515625;
const PQ_C3 = 18.6875;
const PQ_MAX_NITS = 10000.0;
const SDR_NITS = 203.0;

function linearToPQ(L: number): number {
  const Lp = Math.max(0, (L * SDR_NITS) / PQ_MAX_NITS);
  const Lm1 = Math.pow(Lp, PQ_M1);
  return Math.pow((PQ_C1 + PQ_C2 * Lm1) / (1.0 + PQ_C3 * Lm1), PQ_M2);
}

function float16Decode(h: number): number {
  const sign = (h >> 15) & 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return (sign ? -1 : 1) * Math.pow(2, -14) * (frac / 1024);
  if (exp === 31) return frac ? NaN : sign ? -Infinity : Infinity;
  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

// ── Browser-side interface ────────────────────────────────────────────────────

interface HdrCaptureRuntime {
  uploadAndReadback(float16Base64: string): Promise<{ base64: string; bytesPerRow: number }>;
}

// ── Initialization ────────────────────────────────────────────────────────────

/**
 * Inject the WebGPU HDR readback runtime into the page.
 *
 * Creates an rgba16float render texture that accepts writeTexture uploads
 * and provides readback via base64 transfer.
 */
export async function initHdrReadback(page: Page, width: number, height: number): Promise<boolean> {
  return page.evaluate(
    async (w: number, h: number): Promise<boolean> => {
      if (!navigator.gpu) return false;

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;

      const device = await adapter.requestDevice();

      const bytesPerPixel = 8; // rgba16float = 4 channels × 2 bytes
      const bytesPerRow = Math.ceil((w * bytesPerPixel) / 256) * 256;

      // Render texture — includes COPY_DST for writeTexture uploads
      const renderTexture = device.createTexture({
        size: [w, h],
        format: "rgba16float",
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.TEXTURE_BINDING,
      });

      const readBuffer = device.createBuffer({
        size: bytesPerRow * h,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      const captureRuntime = {
        device,
        renderTexture,
        readBuffer,
        bytesPerRow,
        width: w,
        height: h,

        /**
         * Upload pre-converted float16 RGBA data and read it back.
         * The float16 data must be row-aligned to bytesPerRow.
         *
         * Input: base64-encoded Uint16Array (float16 RGBA, row-padded)
         * Output: base64-encoded readback of the same texture
         */
        async uploadAndReadback(
          float16Base64: string,
        ): Promise<{ base64: string; bytesPerRow: number }> {
          // Decode base64 → Uint8Array
          const binary = atob(float16Base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

          // Upload to texture
          device.queue.writeTexture(
            { texture: renderTexture },
            bytes.buffer,
            { bytesPerRow, rowsPerImage: h },
            [w, h],
          );

          // Readback
          const encoder = device.createCommandEncoder();
          encoder.copyTextureToBuffer(
            { texture: renderTexture },
            { buffer: readBuffer, bytesPerRow },
            [w, h],
          );
          device.queue.submit([encoder.finish()]);

          await readBuffer.mapAsync(GPUMapMode.READ);
          const readBytes = new Uint8Array(readBuffer.getMappedRange().slice(0));
          readBuffer.unmap();

          // Base64 encode in chunks
          let b64 = "";
          const chunkSize = 32768;
          for (let i = 0; i < readBytes.length; i += chunkSize) {
            const slice = readBytes.subarray(i, Math.min(i + chunkSize, readBytes.length));
            b64 += String.fromCharCode(...slice);
          }

          return { base64: btoa(b64), bytesPerRow };
        },
      };

      (window as unknown as Record<string, unknown>).__hfHdrCapture = captureRuntime;
      return true;
    },
    width,
    height,
  );
}

// ── HDR frame conversion ──────────────────────────────────────────────────────

// ── Frame upload + readback ───────────────────────────────────────────────────

/**
 * Upload a float16 frame to WebGPU and read it back.
 * Call after converting with convertHdrFrameToFloat16Base64.
 */
export async function uploadAndReadbackHdrFrame(
  page: Page,
  float16Base64: string,
): Promise<{ rawBuffer: Buffer; bytesPerRow: number }> {
  const result = await page.evaluate(
    async (b64: string): Promise<{ base64: string; bytesPerRow: number }> => {
      const hdr = (window as unknown as Record<string, unknown>).__hfHdrCapture as
        | HdrCaptureRuntime
        | undefined;
      if (!hdr) throw new Error("HDR capture not initialized");
      return hdr.uploadAndReadback(b64);
    },
    float16Base64,
  );

  return {
    rawBuffer: Buffer.from(result.base64, "base64"),
    bytesPerRow: result.bytesPerRow,
  };
}

// ── PQ conversion ─────────────────────────────────────────────────────────────

/**
 * Convert float16 RGBA readback to PQ-encoded rgb48le for FFmpeg.
 */
export function float16ToPqRgb(
  rawBuffer: Buffer,
  bytesPerRow: number,
  width: number,
  height: number,
): Buffer {
  const data = new Uint16Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength / 2);
  const channelsPerRow = bytesPerRow / 2;
  const output = Buffer.alloc(width * height * 6);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = y * channelsPerRow + x * 4;
      const r = float16Decode(data[srcIdx] ?? 0);
      const g = float16Decode(data[srcIdx + 1] ?? 0);
      const b = float16Decode(data[srcIdx + 2] ?? 0);

      const dstIdx = (y * width + x) * 6;
      output.writeUInt16LE(Math.round(Math.min(1.0, linearToPQ(r)) * 65535), dstIdx);
      output.writeUInt16LE(Math.round(Math.min(1.0, linearToPQ(g)) * 65535), dstIdx + 2);
      output.writeUInt16LE(Math.round(Math.min(1.0, linearToPQ(b)) * 65535), dstIdx + 4);
    }
  }

  return output;
}

// ── Chrome launch ─────────────────────────────────────────────────────────────

function resolveHeadedChromePath(): string | undefined {
  const baseDir = join(homedir(), ".cache", "puppeteer", "chrome");
  if (!existsSync(baseDir)) return undefined;
  const versions = readdirSync(baseDir).sort().reverse();
  for (const version of versions) {
    const candidates = [
      join(
        baseDir,
        version,
        "chrome-mac-arm64",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing",
      ),
      join(
        baseDir,
        version,
        "chrome-mac-x64",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing",
      ),
      join(baseDir, version, "chrome-linux64", "chrome"),
      join(baseDir, version, "chrome-win64", "chrome.exe"),
    ];
    for (const binary of candidates) {
      if (existsSync(binary)) return binary;
    }
  }
  return undefined;
}

/**
 * Launch a headed Chrome browser with WebGPU enabled.
 */
export async function launchHdrBrowser(
  width: number,
  height: number,
): Promise<{ browser: Browser; page: Page }> {
  let ppt: PuppeteerNode | undefined;
  try {
    const mod = await import("puppeteer" as string);
    ppt = mod.default;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") {
      throw err;
    }
    const mod = await import("puppeteer-core");
    ppt = mod.default;
  }
  if (!ppt) throw new Error("Neither puppeteer nor puppeteer-core found");

  const chromePath = resolveHeadedChromePath();
  if (!chromePath) {
    throw new Error(
      "[HDR] No Chrome binary found. Install: npx @puppeteer/browsers install chrome@stable",
    );
  }

  const browser = await ppt.launch({
    headless: false,
    executablePath: chromePath,
    args: buildHdrChromeArgs(width, height),
  });

  const page = await browser.newPage();
  await page.setViewport({ width, height });

  return { browser, page };
}

export function buildHdrChromeArgs(width: number, height: number): string[] {
  return [
    "--enable-unsafe-webgpu",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--window-position=-10000,-10000",
    `--window-size=${width},${height}`,
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-media-suspend",
    "--disable-extensions",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
    "--no-zygote",
    "--force-gpu-mem-available-mb=4096",
    "--autoplay-policy=no-user-gesture-required",
  ];
}
