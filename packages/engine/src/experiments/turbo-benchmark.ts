#!/usr/bin/env tsx
/**
 * Turbo Renderer Benchmark
 *
 * Uses Puppeteer's pipe transport (not WebSocket) with pipelined CDP commands
 * and direct FFmpeg streaming. Compares against baseline.
 */

import puppeteer from "puppeteer";
import { spawn, type ChildProcess } from "child_process";
import { mkdirSync, existsSync, statSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createServer, type Server } from "http";
import { readFileSync } from "fs";
import { extname } from "path";

const REPO_ROOT = resolve(import.meta.dirname ?? ".", "../../..");
const CHAT_FIXTURE = resolve(REPO_ROOT, "packages/producer/tests/chat/src");

// ── File Server ──────────────────────────────────────────────────────

function startFileServer(dir: string): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const filePath = join(dir, req.url === "/" ? "/index.html" : req.url!);
      try {
        const data = readFileSync(filePath);
        const ext = extname(filePath);
        const ct = ext === ".html" ? "text/html" : ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : "application/octet-stream";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("Not Found");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${addr.port}`, server });
    });
  });
}

const HEADLESS_SHELL = "/home/ubuntu/.cache/puppeteer/chrome-headless-shell/linux-146.0.7680.153/chrome-headless-shell-linux64/chrome-headless-shell";

// ── Baseline: Standard Puppeteer (WebSocket, sequential CDP) ─────────

async function runBaseline(
  url: string, outputDir: string, totalFrames: number, fps: number, width: number, height: number,
): Promise<{ captureMs: number; encodeMs: number; totalMs: number; avgFrameMs: number }> {
  const start = Date.now();

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: HEADLESS_SHELL,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader",
      "--deterministic-mode", "--enable-begin-frame-control",
      "--run-all-compositor-stages-before-draw",
      "--disable-threaded-animation", "--disable-threaded-scrolling",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-extensions", "--no-zygote",
      "--font-render-hinting=none", "--force-color-profile=srgb",
      `--window-size=${width},${height}`,
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width, height });
  const client = await page.createCDPSession();

  // Warmup + navigate
  let warmupTicks = 0;
  let warmupRunning = true;
  const interval = 1000 / fps;

  const warmup = (async () => {
    await client.send("HeadlessExperimental.enable");
    while (warmupRunning) {
      try {
        await client.send("HeadlessExperimental.beginFrame", {
          frameTimeTicks: warmupTicks * interval,
          interval,
          noDisplayUpdates: true,
        });
        warmupTicks++;
      } catch {}
      await new Promise(r => setTimeout(r, 30));
    }
  })();
  warmup.catch(() => {});

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Wait for __hf
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(`!!(window.__hf && typeof window.__hf.seek === "function" && window.__hf.duration > 0)`);
    if (ready) break;
    await new Promise(r => setTimeout(r, 100));
  }
  await page.evaluate("document.fonts?.ready");
  warmupRunning = false;

  const baseTicks = (warmupTicks + 10) * interval;

  // ── STANDARD CAPTURE: sequential seek → beginFrame ──
  const captureStart = Date.now();
  const framesDir = join(outputDir, "frames");
  mkdirSync(framesDir, { recursive: true });

  for (let i = 0; i < totalFrames; i++) {
    const time = Math.floor(i * 1000 / fps) / 1000;

    // Sequential: await seek, then await beginFrame
    await page.evaluate((t: number) => { window.__hf?.seek(t); }, time);

    const result = await client.send("HeadlessExperimental.beginFrame", {
      frameTimeTicks: baseTicks + i * interval,
      interval,
      screenshot: { format: "jpeg", quality: 80, optimizeForSpeed: true },
    }) as { screenshotData?: string };

    if (result.screenshotData) {
      writeFileSync(join(framesDir, `frame_${String(i).padStart(6, "0")}.jpg`), Buffer.from(result.screenshotData, "base64"));
    }
  }
  const captureMs = Date.now() - captureStart;

  // Encode
  const encodeStart = Date.now();
  const outPath = join(outputDir, "baseline.mp4");
  await new Promise<void>((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-framerate", String(fps), "-i", join(framesDir, "frame_%06d.jpg"),
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-pix_fmt", "yuv420p", "-y", outPath,
    ], { stdio: "pipe" });
    ff.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
    ff.on("error", reject);
  });
  const encodeMs = Date.now() - encodeStart;

  await browser.close();
  const totalMs = Date.now() - start;

  return { captureMs, encodeMs, totalMs, avgFrameMs: captureMs / totalFrames };
}

// ── Turbo: Pipelined CDP + direct FFmpeg pipe ────────────────────────

async function runTurbo(
  url: string, outputDir: string, totalFrames: number, fps: number, width: number, height: number,
): Promise<{ captureMs: number; encodeMs: number; totalMs: number; avgFrameMs: number }> {
  const start = Date.now();

  // Use pipe transport (faster than WebSocket)
  const browser = await puppeteer.launch({
    headless: true,
    pipe: true, // ← KEY: use pipe instead of WebSocket
    executablePath: HEADLESS_SHELL,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader",
      "--deterministic-mode", "--enable-begin-frame-control",
      "--run-all-compositor-stages-before-draw",
      "--disable-threaded-animation", "--disable-threaded-scrolling",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-extensions", "--no-zygote",
      "--font-render-hinting=none", "--force-color-profile=srgb",
      `--window-size=${width},${height}`,
      "--disk-cache-size=0",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width, height });
  const client = await page.createCDPSession();

  // Warmup + navigate (same as baseline)
  let warmupTicks = 0;
  let warmupRunning = true;
  const interval = 1000 / fps;

  const warmup = (async () => {
    await client.send("HeadlessExperimental.enable");
    while (warmupRunning) {
      try {
        await client.send("HeadlessExperimental.beginFrame", {
          frameTimeTicks: warmupTicks * interval,
          interval,
          noDisplayUpdates: true,
        });
        warmupTicks++;
      } catch {}
      await new Promise(r => setTimeout(r, 30));
    }
  })();
  warmup.catch(() => {});

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(`!!(window.__hf && typeof window.__hf.seek === "function" && window.__hf.duration > 0)`);
    if (ready) break;
    await new Promise(r => setTimeout(r, 100));
  }
  await page.evaluate("document.fonts?.ready");
  warmupRunning = false;

  const baseTicks = (warmupTicks + 10) * interval;

  // Spawn FFmpeg with pipe input BEFORE starting capture
  const outPath = join(outputDir, "turbo.mp4");
  const ffmpeg = spawn("ffmpeg", [
    "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", String(fps),
    "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "23",
    "-pix_fmt", "yuv420p", "-r", String(fps),
    "-movflags", "+faststart",
    "-y", outPath,
  ], { stdio: ["pipe", "pipe", "pipe"] });

  // ── TURBO CAPTURE: pipelined seek + beginFrame, stream to FFmpeg ──
  const captureStart = Date.now();
  let lastBuffer: Buffer | null = null;

  for (let i = 0; i < totalFrames; i++) {
    const time = Math.floor(i * 1000 / fps) / 1000;
    const frameTimeTicks = baseTicks + i * interval;

    // PIPELINED: fire seek WITHOUT awaiting
    const seekPromise = page.evaluate((t: number) => { window.__hf?.seek(t); }, time);

    // Immediately fire beginFrame
    const framePromise = client.send("HeadlessExperimental.beginFrame", {
      frameTimeTicks,
      interval,
      screenshot: { format: "jpeg", quality: 80, optimizeForSpeed: true },
    });

    const [, result] = await Promise.all([
      seekPromise.catch(() => {}),
      framePromise,
    ]) as [void, { screenshotData?: string; hasDamage?: boolean }];

    let buffer: Buffer;
    if (result.screenshotData) {
      buffer = Buffer.from(result.screenshotData, "base64");
      lastBuffer = buffer;
    } else if (lastBuffer) {
      buffer = lastBuffer;
    } else {
      continue;
    }

    // Stream directly to FFmpeg — no disk write
    if (ffmpeg.stdin && !ffmpeg.stdin.destroyed) {
      ffmpeg.stdin.write(buffer);
    }
  }
  const captureMs = Date.now() - captureStart;

  // Close FFmpeg and wait for encoding to finish
  const encodeStart = Date.now();
  await new Promise<void>(resolve => {
    if (ffmpeg.stdin && !ffmpeg.stdin.destroyed) {
      ffmpeg.stdin.end(() => resolve());
    } else {
      resolve();
    }
  });
  await new Promise<void>(resolve => ffmpeg.on("close", () => resolve()));
  const encodeMs = Date.now() - encodeStart;

  await browser.close();
  const totalMs = Date.now() - start;

  return { captureMs, encodeMs, totalMs, avgFrameMs: captureMs / totalFrames };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const width = 1080, height = 1920, fps = 30, duration = 15;
  const totalFrames = duration * fps; // 450

  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║  HyperFrames Turbo Renderer Benchmark                   ║");
  console.log("║  450 frames, 15s @ 30fps, 1080x1920                     ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  const { url, server } = await startFileServer(CHAT_FIXTURE);
  console.log(`File server: ${url}\n`);

  const workDir = join(tmpdir(), `turbo-bench-${Date.now()}`);
  mkdirSync(workDir, { recursive: true });

  try {
    // Run baseline
    console.log("━━━ BASELINE (WebSocket, sequential CDP, disk frames) ━━━");
    const baseline = await runBaseline(url, workDir, totalFrames, fps, width, height);
    console.log(`  Total:     ${baseline.totalMs}ms`);
    console.log(`  Capture:   ${baseline.captureMs}ms (${baseline.avgFrameMs.toFixed(1)}ms/frame)`);
    console.log(`  Encode:    ${baseline.encodeMs}ms`);

    // Run turbo
    console.log("\n━━━ TURBO (pipe transport, pipelined CDP, streaming encode) ━━━");
    const turbo = await runTurbo(url, workDir, totalFrames, fps, width, height);
    console.log(`  Total:     ${turbo.totalMs}ms`);
    console.log(`  Capture:   ${turbo.captureMs}ms (${turbo.avgFrameMs.toFixed(1)}ms/frame)`);
    console.log(`  Encode:    ${turbo.encodeMs}ms (drain time)`);

    // Compare
    const captureSpeedup = baseline.captureMs / turbo.captureMs;
    const totalSpeedup = baseline.totalMs / turbo.totalMs;

    console.log("\n╔═══════════════════════════════════════════════════════════╗");
    console.log("║  COMPARISON                                             ║");
    console.log("╠═══════════════════════════════════════════════════════════╣");
    console.log(`║  Baseline total:  ${String(baseline.totalMs).padStart(6)}ms                              ║`);
    console.log(`║  Turbo total:     ${String(turbo.totalMs).padStart(6)}ms                              ║`);
    console.log(`║  Capture speedup: ${captureSpeedup.toFixed(2).padStart(6)}x                              ║`);
    console.log(`║  Total speedup:   ${totalSpeedup.toFixed(2).padStart(6)}x                              ║`);
    console.log("╚═══════════════════════════════════════════════════════════╝");

    // Output file sizes
    for (const f of ["baseline.mp4", "turbo.mp4"]) {
      const p = join(workDir, f);
      if (existsSync(p)) {
        console.log(`  ${f}: ${(statSync(p).size / 1024 / 1024).toFixed(1)}MB`);
      }
    }

  } finally {
    server.close();
    console.log(`\nWork dir: ${workDir}`);
  }
}

main().catch(err => {
  console.error(`Fatal: ${err}`);
  process.exit(1);
});
