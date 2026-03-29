/**
 * Experiment 3: Xvfb Virtual Framebuffer Capture
 *
 * Bypasses CDP screenshot path entirely by:
 *   1. Running Chrome in headed mode inside a virtual X11 display (Xvfb)
 *   2. Using FFmpeg's x11grab to capture the framebuffer directly
 *   3. Using CDP only for seeking animations (page.evaluate), NOT for screenshots
 *
 * Two modes:
 *   - Deterministic: seek -> x11grab single frame -> repeat (frame-accurate)
 *   - Fast Draft: play animation, x11grab captures continuously (near-deterministic)
 */

import { spawn, execSync, type ChildProcess } from "child_process";
import { existsSync, readdirSync, statSync, mkdirSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { homedir, tmpdir } from "os";
import type { Browser, Page } from "puppeteer-core";

// ── Types ───────────────────────────────────────────────────────────────────

export interface XvfbCaptureOptions {
  serverUrl: string;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  durationSeconds: number;
  outputPath: string;
  quality?: number;
}

export interface XvfbCaptureResult {
  totalMs: number;
  captureMs: number;
  encodeMs: number;
  frameCount: number;
  outputPath: string;
  outputFileSize: number;
  perFrameMs: number[];
}

// ── Chrome Resolution ───────────────────────────────────────────────────────

function findChromeBinary(): string {
  // Look for Puppeteer-installed Chrome (NOT headless-shell)
  const baseDir = join(homedir(), ".cache", "puppeteer", "chrome");
  if (existsSync(baseDir)) {
    const versions = readdirSync(baseDir)
      .filter((d) => d.startsWith("linux-"))
      .sort()
      .reverse();
    for (const version of versions) {
      const binary = join(baseDir, version, "chrome-linux64", "chrome");
      if (existsSync(binary)) return binary;
    }
  }

  // Fallback: system Chrome
  try {
    const path = execSync("which google-chrome || which chromium-browser || which chromium", {
      encoding: "utf-8",
    }).trim();
    if (path) return path;
  } catch {
    // ignore
  }

  throw new Error("Could not find Chrome binary. Install via puppeteer or system package.");
}

// ── Xvfb Management ─────────────────────────────────────────────────────────

export interface XvfbInstance {
  process: ChildProcess;
  display: string;
  stop: () => void;
}

export function startXvfb(
  display: string,
  width: number,
  height: number,
  depth: number = 24,
): XvfbInstance {
  // Kill any existing Xvfb on this display
  try {
    execSync(`pkill -f "Xvfb ${display}" 2>/dev/null || true`, { encoding: "utf-8" });
  } catch {
    // ignore
  }

  const xvfbProc = spawn(
    "Xvfb",
    [display, "-screen", "0", `${width}x${height}x${depth}`, "-ac", "-nolisten", "tcp"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    },
  );

  // Wait a brief moment for Xvfb to start
  execSync("sleep 0.5");

  return {
    process: xvfbProc,
    display,
    stop: () => {
      try {
        xvfbProc.kill("SIGTERM");
      } catch {
        // already dead
      }
    },
  };
}

// ── Chrome in Headed Mode on Xvfb ──────────────────────────────────────────

export async function launchHeadedChrome(
  display: string,
  width: number,
  height: number,
): Promise<{ browser: Browser; page: Page }> {
  const chromePath = findChromeBinary();
  console.log(`[Exp3] Chrome binary: ${chromePath}`);

  // Import puppeteer-core for manual launch
  const puppeteer = await import("puppeteer-core");

  const chromeArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--font-render-hinting=none",
    "--force-color-profile=srgb",
    `--window-size=${width},${height}`,
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-media-suspend",
    "--disable-breakpad",
    "--disable-component-extensions-with-background-pages",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-hang-monitor",
    "--disable-ipc-flooding-protection",
    "--disable-popup-blocking",
    "--disable-sync",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--disable-print-preview",
    "--no-pings",
    "--no-zygote",
    "--force-gpu-mem-available-mb=4096",
    "--disk-cache-size=268435456",
    "--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process,Translate,BackForwardCache,IntensiveWakeUpThrottling",
    // Headed mode specifics: run fast, no frame rate limit
    "--disable-frame-rate-limit",
    "--disable-gpu-vsync",
    // Start with a specific window position to ensure we capture the right area
    "--window-position=0,0",
    // Kiosk mode to remove browser chrome (title bar, etc.)
    "--kiosk",
    "--start-fullscreen",
  ];

  const browser = await puppeteer.default.launch({
    headless: false,
    args: chromeArgs,
    executablePath: chromePath,
    defaultViewport: null,
    timeout: 60_000,
    protocolTimeout: 300_000,
    env: {
      ...process.env,
      DISPLAY: display,
    },
  });

  const page = await browser.newPage();
  await page.setViewport({
    width,
    height,
    deviceScaleFactor: 1,
  });

  return { browser, page };
}

// ── Page Setup ──────────────────────────────────────────────────────────────

export async function navigateAndWait(page: Page, serverUrl: string): Promise<void> {
  const url = `${serverUrl}/index.html`;
  console.log(`[Exp3] Navigating to ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Wait for __hf readiness
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(
      `!!(window.__hf && typeof window.__hf.seek === "function" && window.__hf.duration > 0)`,
    );
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const pageReady = await page.evaluate(
    `!!(window.__hf && typeof window.__hf.seek === "function" && window.__hf.duration > 0)`,
  );
  if (!pageReady) {
    throw new Error("[Exp3] window.__hf not ready after 30s");
  }

  await page.evaluate(`document.fonts?.ready`);
  console.log("[Exp3] Page ready, __hf protocol active");
}

// ── Quantize helper ─────────────────────────────────────────────────────────

function quantizeTimeToFrame(timeSeconds: number, fps: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const safeTime = Number.isFinite(timeSeconds) && timeSeconds > 0 ? timeSeconds : 0;
  const frameIndex = Math.floor(safeTime * safeFps + 1e-9);
  return frameIndex / safeFps;
}

// ── Mode A: Deterministic Per-Frame Capture ─────────────────────────────────

/**
 * Deterministic capture: for each frame, seek via CDP, then grab
 * one frame from the X11 display with ffmpeg x11grab.
 */
export async function captureXvfbDeterministic(
  opts: XvfbCaptureOptions,
  display: string,
  page: Page,
): Promise<XvfbCaptureResult> {
  const { width, height, fps, totalFrames, outputPath } = opts;
  const perFrameMs: number[] = [];
  const overallStart = Date.now();

  // Create temp dir for individual frame captures
  const framesDir = join(tmpdir(), `exp3-det-frames-${Date.now()}`);
  mkdirSync(framesDir, { recursive: true });

  console.log(`[Exp3-Det] Capturing ${totalFrames} frames deterministically...`);

  const captureStart = Date.now();

  for (let i = 0; i < totalFrames; i++) {
    const frameStart = Date.now();
    const time = quantizeTimeToFrame(i / fps, fps);

    // Seek via CDP (the only CDP call we make)
    await page.evaluate((t: number) => {
      if (window.__hf && typeof window.__hf.seek === "function") {
        window.__hf.seek(t);
      }
    }, time);

    // Brief pause to let the render propagate to the X display
    await new Promise((r) => setTimeout(r, 5));

    // Grab one frame from X11 display
    const framePath = join(framesDir, `frame_${String(i).padStart(6, "0")}.jpg`);
    const grabCmd = [
      "ffmpeg",
      "-y",
      "-f", "x11grab",
      "-video_size", `${width}x${height}`,
      "-i", `${display}+0,0`,
      "-frames:v", "1",
      "-q:v", "2",
      framePath,
    ];

    try {
      execSync(grabCmd.join(" "), { stdio: "pipe", timeout: 5000 });
    } catch (err) {
      console.error(`[Exp3-Det] Frame ${i} grab failed:`, err instanceof Error ? err.message : err);
    }

    const frameMs = Date.now() - frameStart;
    perFrameMs.push(frameMs);

    if (i % 100 === 0 || i === totalFrames - 1) {
      console.log(`[Exp3-Det] Frame ${i}/${totalFrames} (${frameMs}ms)`);
    }
  }

  const captureMs = Date.now() - captureStart;

  // Encode all frames to video
  console.log("[Exp3-Det] Encoding frames to video...");
  const encodeStart = Date.now();

  const encodeCmd = [
    "ffmpeg", "-y",
    "-framerate", String(fps),
    "-i", join(framesDir, "frame_%06d.jpg"),
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ];

  try {
    execSync(encodeCmd.join(" "), { stdio: "pipe", timeout: 120_000 });
  } catch (err) {
    console.error("[Exp3-Det] Encode failed:", err instanceof Error ? err.message : err);
  }

  const encodeMs = Date.now() - encodeStart;
  const totalMs = Date.now() - overallStart;

  // Get output file size
  let outputFileSize = 0;
  if (existsSync(outputPath)) {
    outputFileSize = statSync(outputPath).size;
  }

  // Cleanup temp frames
  try {
    const files = readdirSync(framesDir);
    for (const f of files) unlinkSync(join(framesDir, f));
    execSync(`rmdir "${framesDir}"`, { stdio: "pipe" });
  } catch {
    // ignore cleanup errors
  }

  return {
    totalMs,
    captureMs,
    encodeMs,
    frameCount: totalFrames,
    outputPath,
    outputFileSize,
    perFrameMs,
  };
}

// ── Mode B: Fast Draft Continuous Capture ───────────────────────────────────

/**
 * Fast draft: start ffmpeg x11grab continuously capturing at fps,
 * then play the animation in real-time. Near-deterministic output.
 *
 * Option C enhancement: use --disable-frame-rate-limit to render
 * faster than real-time when possible.
 */
export async function captureXvfbFastDraft(
  opts: XvfbCaptureOptions,
  display: string,
  page: Page,
): Promise<XvfbCaptureResult> {
  const { width, height, fps, totalFrames, durationSeconds, outputPath } = opts;
  const overallStart = Date.now();

  console.log(`[Exp3-Draft] Fast draft capture: ${durationSeconds}s @ ${fps}fps`);

  // Start ffmpeg x11grab in the background, capturing continuously
  const ffmpegArgs = [
    "-y",
    "-f", "x11grab",
    "-video_size", `${width}x${height}`,
    "-framerate", String(fps),
    "-i", `${display}+0,0`,
    "-t", String(durationSeconds + 0.5), // capture slightly longer to ensure we get all frames
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ];

  console.log(`[Exp3-Draft] Starting ffmpeg x11grab...`);
  const ffmpegProc = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, DISPLAY: display },
  });

  let ffmpegStderr = "";
  ffmpegProc.stderr?.on("data", (data: Buffer) => {
    ffmpegStderr += data.toString();
  });

  // Small delay to let ffmpeg initialize
  await new Promise((r) => setTimeout(r, 200));

  // Drive the animation by seeking frame by frame as fast as possible
  // (rather than real-time playback, we step through deterministically
  // but rely on x11grab to capture what's on screen)
  const captureStart = Date.now();
  const perFrameMs: number[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const frameStart = Date.now();
    const time = quantizeTimeToFrame(i / fps, fps);

    await page.evaluate((t: number) => {
      if (window.__hf && typeof window.__hf.seek === "function") {
        window.__hf.seek(t);
      }
    }, time);

    // In fast draft mode, we don't wait for x11grab per frame.
    // We just seek as fast as possible and rely on the continuous capture.
    // A minimal yield lets the renderer paint.
    await new Promise((r) => setTimeout(r, 1));

    perFrameMs.push(Date.now() - frameStart);

    if (i % 100 === 0 || i === totalFrames - 1) {
      console.log(`[Exp3-Draft] Seeked frame ${i}/${totalFrames}`);
    }
  }

  const captureMs = Date.now() - captureStart;

  // Wait for ffmpeg to finish
  console.log("[Exp3-Draft] Waiting for ffmpeg to finish encoding...");
  const encodeWaitStart = Date.now();

  // Send EOF to ffmpeg stdin to signal we're done (if capture is faster than real-time)
  ffmpegProc.stdin?.end();

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ffmpegProc.kill("SIGTERM");
      resolve();
    }, 30_000);

    ffmpegProc.on("close", () => {
      clearTimeout(timeout);
      resolve();
    });

    ffmpegProc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  const encodeMs = Date.now() - encodeWaitStart;
  const totalMs = Date.now() - overallStart;

  // Get output file size
  let outputFileSize = 0;
  if (existsSync(outputPath)) {
    outputFileSize = statSync(outputPath).size;
  }

  if (!existsSync(outputPath) || outputFileSize === 0) {
    console.error("[Exp3-Draft] FFmpeg output missing or empty.");
    console.error("[Exp3-Draft] FFmpeg stderr (last 500 chars):", ffmpegStderr.slice(-500));
  }

  return {
    totalMs,
    captureMs,
    encodeMs,
    frameCount: totalFrames,
    outputPath,
    outputFileSize,
    perFrameMs,
  };
}

// ── Mode B2: Continuous capture with per-frame sync ─────────────────────────

/**
 * Hybrid approach: continuously pipe from x11grab, but sync each frame
 * by seeking then waiting for a full frame interval before next seek.
 * More deterministic than pure fast draft, but still avoids per-frame
 * ffmpeg process spawn overhead.
 */
export async function captureXvfbSyncedDraft(
  opts: XvfbCaptureOptions,
  display: string,
  page: Page,
): Promise<XvfbCaptureResult> {
  const { width, height, fps, totalFrames, durationSeconds, outputPath } = opts;
  const overallStart = Date.now();
  const frameIntervalMs = 1000 / fps;

  console.log(`[Exp3-Synced] Synced draft capture: ${durationSeconds}s @ ${fps}fps (${frameIntervalMs.toFixed(1)}ms/frame)`);

  // Start ffmpeg x11grab at exact framerate
  const ffmpegArgs = [
    "-y",
    "-f", "x11grab",
    "-video_size", `${width}x${height}`,
    "-framerate", String(fps),
    "-draw_mouse", "0",
    "-i", `${display}+0,0`,
    "-frames:v", String(totalFrames),
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ];

  const ffmpegProc = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, DISPLAY: display },
  });

  let ffmpegStderr = "";
  ffmpegProc.stderr?.on("data", (data: Buffer) => {
    ffmpegStderr += data.toString();
  });

  // Wait for ffmpeg to connect to X display
  await new Promise((r) => setTimeout(r, 300));

  const captureStart = Date.now();
  const perFrameMs: number[] = [];

  // Seek each frame with timing synchronized to the frame interval
  for (let i = 0; i < totalFrames; i++) {
    const frameStart = Date.now();
    const time = quantizeTimeToFrame(i / fps, fps);

    // Seek via CDP
    await page.evaluate((t: number) => {
      if (window.__hf && typeof window.__hf.seek === "function") {
        window.__hf.seek(t);
      }
    }, time);

    // Wait enough for the frame to be captured by x11grab's framerate timer
    const elapsed = Date.now() - frameStart;
    const waitMs = Math.max(0, frameIntervalMs - elapsed);
    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }

    perFrameMs.push(Date.now() - frameStart);

    if (i % 100 === 0 || i === totalFrames - 1) {
      console.log(`[Exp3-Synced] Frame ${i}/${totalFrames} (${(Date.now() - frameStart).toFixed(0)}ms)`);
    }
  }

  const captureMs = Date.now() - captureStart;

  // Wait for ffmpeg to finish
  console.log("[Exp3-Synced] Waiting for ffmpeg to finish...");
  const encodeWaitStart = Date.now();
  ffmpegProc.stdin?.end();

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      ffmpegProc.kill("SIGTERM");
      resolve();
    }, 30_000);

    ffmpegProc.on("close", () => {
      clearTimeout(timeout);
      resolve();
    });

    ffmpegProc.on("error", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  const encodeMs = Date.now() - encodeWaitStart;
  const totalMs = Date.now() - overallStart;

  let outputFileSize = 0;
  if (existsSync(outputPath)) {
    outputFileSize = statSync(outputPath).size;
  }

  if (!existsSync(outputPath) || outputFileSize === 0) {
    console.error("[Exp3-Synced] Output missing or empty.");
    console.error("[Exp3-Synced] FFmpeg stderr (last 500 chars):", ffmpegStderr.slice(-500));
  }

  return {
    totalMs,
    captureMs,
    encodeMs,
    frameCount: totalFrames,
    outputPath,
    outputFileSize,
    perFrameMs,
  };
}
