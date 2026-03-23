import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import puppeteer, { type Page } from "puppeteer-core";
import { MEDIA_VISUAL_STYLE_PROPERTIES, quantizeTimeToFrame } from "./utils/parityContract.js";

type ParityHarnessOptions = {
  previewUrl: string;
  producerUrl: string;
  width: number;
  height: number;
  fps: number;
  checkpoints: number[];
  allowMismatchRatio: number;
  artifactsDir: string;
  emulateProducerSwap: boolean;
};

function parseNumberArg(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function parseArgs(argv: string[]): ParityHarnessOptions {
  const args = new Map<string, string>();
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token || !token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, "true");
      continue;
    }
    args.set(key, next);
    i += 1;
  }

  const previewUrl = args.get("preview-url") || "";
  const producerUrl = args.get("producer-url") || "";
  if (!previewUrl || !producerUrl) {
    throw new Error(
      'Missing required args. Usage: --preview-url "<url>" --producer-url "<url>" [--checkpoints "0,1,2"] [--fps 30] [--width 1920] [--height 1080] [--allow-mismatch-ratio 0]',
    );
  }

  const checkpointsRaw = args.get("checkpoints") || "0,1,2,3,5";
  const checkpoints = checkpointsRaw
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (checkpoints.length === 0) {
    throw new Error("No valid checkpoints provided.");
  }

  return {
    previewUrl,
    producerUrl,
    width: parseNumberArg(args.get("width"), 1920),
    height: parseNumberArg(args.get("height"), 1080),
    fps: parseNumberArg(args.get("fps"), 30),
    checkpoints,
    allowMismatchRatio: Math.max(
      0,
      Math.min(1, parseNumberArg(args.get("allow-mismatch-ratio"), 0)),
    ),
    artifactsDir: resolve(args.get("artifacts-dir") || ".debug/parity-harness"),
    emulateProducerSwap: (args.get("emulate-producer-swap") || "false").toLowerCase() === "true",
  };
}

async function waitForParityReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const win = window as unknown as { __playerReady?: boolean; __renderReady?: boolean };
      return Boolean(win.__playerReady && win.__renderReady);
    },
    { timeout: 30_000 },
  );
  await page.evaluate(() => document.fonts.ready);
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function writeBinary(path: string, data: Buffer): void {
  ensureDir(dirname(path));
  writeFileSync(path, data);
}

function writeJson(path: string, data: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

function writeImageDiff(basePath: string, comparePath: string, outputPath: string): void {
  const ffmpeg = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      basePath,
      "-i",
      comparePath,
      "-filter_complex",
      "[0:v][1:v]blend=all_mode=difference",
      outputPath,
    ],
    { stdio: "pipe" },
  );
  if (ffmpeg.status !== 0) {
    const stderr = (ffmpeg.stderr || Buffer.from("")).toString("utf-8");
    throw new Error(`ffmpeg diff failed: ${stderr}`);
  }
}

async function captureStyleSnapshot(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    (properties: string[]) => {
      const targets = Array.from(
        document.querySelectorAll(
          "video[data-start], img.__render_frame__, img.__preview_render_frame__, img.__parity_render_frame__",
        ),
      ) as HTMLElement[];
      return {
        location: window.location.href,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio,
        },
        media: targets.map((el) => {
          const style = window.getComputedStyle(el);
          const values: Record<string, string> = {};
          for (const property of properties) {
            values[property] = style.getPropertyValue(property);
          }
          return {
            id: el.id || null,
            tagName: el.tagName.toLowerCase(),
            className: el.className || null,
            values,
          };
        }),
      };
    },
    [...MEDIA_VISUAL_STYLE_PROPERTIES],
  );
}

async function emulateProducerVideoSwap(page: Page): Promise<void> {
  await page.evaluate(
    (properties: string[]) => {
      const videos = Array.from(
        document.querySelectorAll("video[data-start]"),
      ) as HTMLVideoElement[];
      for (const video of videos) {
        let img = video.nextElementSibling as HTMLImageElement | null;
        if (!img || !img.classList.contains("__parity_render_frame__")) {
          img = document.createElement("img");
          img.className = "__parity_render_frame__";
          video.parentNode?.insertBefore(img, video.nextSibling);
        }

        const style = window.getComputedStyle(video);
        const sourceIsStatic = !style.position || style.position === "static";
        if (!sourceIsStatic) {
          img.style.position = style.position;
          img.style.top = style.top;
          img.style.left = style.left;
          img.style.right = style.right;
          img.style.bottom = style.bottom;
        } else {
          img.style.position = "absolute";
          img.style.top = "0px";
          img.style.left = "0px";
          img.style.right = "0px";
          img.style.bottom = "0px";
        }
        for (const property of properties) {
          if (
            sourceIsStatic &&
            (property === "top" ||
              property === "left" ||
              property === "right" ||
              property === "bottom" ||
              property === "inset")
          ) {
            continue;
          }
          const value = style.getPropertyValue(property);
          if (value) {
            img.style.setProperty(property, value);
          }
        }
        img.style.pointerEvents = "none";
        img.style.visibility = "visible";

        try {
          const width = Math.max(2, video.videoWidth || video.clientWidth || 2);
          const height = Math.max(2, video.videoHeight || video.clientHeight || 2);
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d", { alpha: false });
          if (!ctx) {
            continue;
          }
          ctx.drawImage(video, 0, 0, width, height);
          img.src = canvas.toDataURL("image/png");
          video.style.setProperty("visibility", "hidden", "important");
          video.style.setProperty("opacity", "0", "important");
        } catch {
          video.style.removeProperty("visibility");
          video.style.removeProperty("opacity");
        }
      }
    },
    [...MEDIA_VISUAL_STYLE_PROPERTIES],
  );
}

async function captureCheckpoint(
  page: Page,
  checkpointSec: number,
  fps: number,
  emulateProducerSwap: boolean,
): Promise<Buffer> {
  const quantized = quantizeTimeToFrame(checkpointSec, fps);
  await page.evaluate(
    ({ time, targetFps }) => {
      const win = window as unknown as {
        __player?: { renderSeek?(t: number): void; seek?(t: number): void };
        gsap?: { ticker?: { tick(): void } };
      };
      const player = win.__player;
      if (!player) return;
      const safe = Math.max(0, Number(time) || 0);
      const frame = Math.floor(safe * targetFps + 1e-9);
      const quantized = frame / targetFps;
      if (typeof player.renderSeek === "function") {
        player.renderSeek(quantized);
      } else if (typeof player.seek === "function") {
        player.seek(quantized);
      }
      if (win.gsap?.ticker?.tick) {
        win.gsap.ticker.tick();
      }
    },
    { time: quantized, targetFps: fps },
  );
  if (emulateProducerSwap) {
    await emulateProducerVideoSwap(page);
  }
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  return (await page.screenshot({ type: "png" })) as Buffer;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv);
  console.log(`[ParityHarness] options=${JSON.stringify(options)}`);
  ensureDir(options.artifactsDir);

  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: true,
    defaultViewport: {
      width: options.width,
      height: options.height,
      deviceScaleFactor: 1,
    },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--font-render-hinting=none",
      "--force-color-profile=srgb",
      `--window-size=${options.width},${options.height}`,
    ],
  });

  try {
    const previewPage = await browser.newPage();
    const producerPage = await browser.newPage();

    await Promise.all([
      previewPage.goto(options.previewUrl, {
        waitUntil: ["load", "networkidle2"],
        timeout: 60_000,
      }),
      producerPage.goto(options.producerUrl, {
        waitUntil: ["load", "networkidle2"],
        timeout: 60_000,
      }),
    ]);
    await Promise.all([waitForParityReady(previewPage), waitForParityReady(producerPage)]);

    let mismatches = 0;
    const results: Array<{
      checkpointSec: number;
      previewHash: string;
      producerHash: string;
      match: boolean;
      previewImagePath: string;
      producerImagePath: string;
      diffImagePath: string | null;
      previewStylesPath: string;
      producerStylesPath: string;
    }> = [];

    for (const checkpointSec of options.checkpoints) {
      const checkpointKey = checkpointSec.toFixed(3).replace(/\./g, "_");
      const artifactDir = join(options.artifactsDir, `checkpoint_${checkpointKey}s`);
      ensureDir(artifactDir);
      const [previewBuffer, producerBuffer] = await Promise.all([
        captureCheckpoint(previewPage, checkpointSec, options.fps, false),
        captureCheckpoint(producerPage, checkpointSec, options.fps, options.emulateProducerSwap),
      ]);
      const previewHash = sha256(previewBuffer);
      const producerHash = sha256(producerBuffer);
      const match = previewHash === producerHash;
      if (!match) mismatches += 1;
      const previewImagePath = join(artifactDir, "preview.png");
      const producerImagePath = join(artifactDir, "producer.png");
      const diffImagePath = match ? null : join(artifactDir, "diff.png");
      writeBinary(previewImagePath, previewBuffer);
      writeBinary(producerImagePath, producerBuffer);
      if (diffImagePath) {
        writeImageDiff(previewImagePath, producerImagePath, diffImagePath);
      }
      const [previewStyles, producerStyles] = await Promise.all([
        captureStyleSnapshot(previewPage),
        captureStyleSnapshot(producerPage),
      ]);
      const previewStylesPath = join(artifactDir, "preview-styles.json");
      const producerStylesPath = join(artifactDir, "producer-styles.json");
      writeJson(previewStylesPath, previewStyles);
      writeJson(producerStylesPath, producerStyles);
      const row = {
        checkpointSec,
        previewHash,
        producerHash,
        match,
        previewImagePath,
        producerImagePath,
        diffImagePath,
        previewStylesPath,
        producerStylesPath,
      };
      results.push(row);
      console.log(`[ParityHarness] checkpoint=${JSON.stringify(row)}`);
    }

    const total = results.length;
    const mismatchRatio = total > 0 ? mismatches / total : 0;
    const summary = {
      totalCheckpoints: total,
      mismatches,
      mismatchRatio,
      allowMismatchRatio: options.allowMismatchRatio,
      pass: mismatchRatio <= options.allowMismatchRatio,
      artifactsDir: options.artifactsDir,
    };
    writeJson(join(options.artifactsDir, "summary.json"), { summary, results });
    console.log(`[ParityHarness] summary=${JSON.stringify(summary)}`);

    if (!summary.pass) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ParityHarness] fatal=${JSON.stringify({ message })}`);
  process.exitCode = 1;
});
