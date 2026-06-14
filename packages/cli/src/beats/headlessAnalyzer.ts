// Run the shared beat detection (@hyperframes/core/beats) in a headless Chrome
// so results match the Studio exactly — same Web Audio decode + same
// bpm-detective. Used by the `beats` CLI command to write the beat file before
// the Studio is ever opened.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "puppeteer-core";

const require = createRequire(import.meta.url);

// The detection is browser code. We need it as an IIFE that exposes
// analyzeMusicFromBuffer on the page. Prefer the artifact prebuilt at CLI build
// time (shipped in dist); fall back to bundling from core source at runtime
// (dev/monorepo, where core's src is on disk).
let bundlePromise: Promise<string> | null = null;

function findPrebuiltBundle(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "beat-analyzer.global.js"), // dist root (tsup-bundled cli)
    join(here, "../beat-analyzer.global.js"), // dist/beats → dist
    join(here, "../dist/beat-analyzer.global.js"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function buildFromCoreSource(): Promise<string> {
  const esbuild = await import("esbuild");
  const coreRoot = dirname(require.resolve("@hyperframes/core/package.json"));
  const entry = join(coreRoot, "src/beats/beatDetection.ts");
  const result = await esbuild.build({
    stdin: {
      contents:
        `import { analyzeMusicFromBuffer } from ${JSON.stringify(entry)};\n` +
        `globalThis.__hfAnalyze = analyzeMusicFromBuffer;`,
      resolveDir: coreRoot,
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    write: false,
  });
  const out = result.outputFiles?.[0];
  if (!out) throw new Error("Failed to bundle beat analyzer");
  return out.text;
}

function buildAnalyzerBundle(): Promise<string> {
  if (bundlePromise) return bundlePromise;
  bundlePromise = (async () => {
    const prebuilt = findPrebuiltBundle();
    if (prebuilt) return readFileSync(prebuilt, "utf8");
    return buildFromCoreSource();
  })().catch((err) => {
    bundlePromise = null; // don't poison the process with a cached rejection
    throw err;
  });
  return bundlePromise;
}

export interface HeadlessBeatResult {
  beatTimes: number[];
  beatStrengths: number[];
  bpm: number | null;
  bpmConfidence: string;
}

// Guard against pathological inputs that would blow CDP message limits when
// transferred to the page as base64 (≈ +33% over the raw bytes).
const MAX_AUDIO_BYTES = 80 * 1024 * 1024;

// Runs inside the headless page: decode the base64 audio and analyze it.
function inPageAnalyze(data: string) {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const win = window as unknown as {
    AudioContext: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
    __hfAnalyze?: (buffer: AudioBuffer) => Promise<HeadlessBeatResult>;
  };
  if (typeof win.__hfAnalyze !== "function") throw new Error("beat analyzer not loaded");
  const ctx = new (win.AudioContext || win.webkitAudioContext!)();
  return (
    ctx
      .decodeAudioData(bytes.buffer)
      .then((buf) => win.__hfAnalyze!(buf))
      // analyzeMusicFromBuffer also returns the decoded PCM (channelData) + sampleRate;
      // project to only the fields we need so page.evaluate doesn't serialize an
      // ~8-million-element Float32Array back across the CDP boundary.
      .then((r) => ({
        beatTimes: r.beatTimes,
        beatStrengths: r.beatStrengths,
        bpm: r.bpm,
        bpmConfidence: r.bpmConfidence,
      }))
      .finally(() => ctx.close())
  );
}

// Load the analyzer bundle into the page, run analysis, and surface in-page
// errors (decode/codec failures, missing global) instead of an opaque rejection.
async function detectOnPage(page: Page, bundle: string, b64: string): Promise<HeadlessBeatResult> {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => {
    pageErrors.push((e as Error).message);
  });
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text());
  });
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: bundle });
  try {
    return (await page.evaluate(inPageAnalyze, b64)) as HeadlessBeatResult;
  } catch (err) {
    const detail = pageErrors.length ? ` (${pageErrors.join("; ")})` : "";
    throw new Error(`${err instanceof Error ? err.message : String(err)}${detail}`);
  }
}

/** Decode + analyze the given audio bytes in headless Chrome. */
export async function analyzeBeatsHeadless(audioBytes: Buffer): Promise<HeadlessBeatResult> {
  if (audioBytes.length > MAX_AUDIO_BYTES) {
    const mb = Math.round(audioBytes.length / 1e6);
    throw new Error(
      `Audio file too large for headless analysis (${mb}MB > ${MAX_AUDIO_BYTES / 1e6}MB).`,
    );
  }
  const bundle = await buildAnalyzerBundle();
  const { ensureBrowser } = await import("../browser/manager.js");
  const puppeteer = await import("puppeteer-core");
  const browser = await ensureBrowser();
  const chrome: Browser = await puppeteer.default.launch({
    headless: true,
    executablePath: browser.executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = await chrome.newPage();
    return await detectOnPage(page, bundle, audioBytes.toString("base64"));
  } finally {
    await chrome.close();
  }
}
