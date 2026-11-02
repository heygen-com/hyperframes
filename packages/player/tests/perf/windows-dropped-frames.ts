#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Frame, Page } from "puppeteer-core";
import {
  percentile,
  summarizeSceneFrames,
  type SceneFrameWindow,
} from "./dropped-frame-metrics.ts";
import { launchBrowser, loadHostPage, repoPlayerDir, waitForPlayerAssetsReady } from "./runner.ts";
import { startServer } from "./server.ts";

const FIXTURE = "heavy-16x1080";
const RUNS = 3;
const SAMPLE_MS = 6_000;
const FRAME_LOOKUP_TIMEOUT_MS = 10_000;
const PLAY_CONFIRM_TIMEOUT_MS = 60_000;

type FrameSample = {
  mediaTime: number;
  presentedFrames: number;
  decoderMs: number | null;
  callbackDelayMs: number;
};

type AnimationFrameSample = {
  duration: number;
  blockingDuration: number;
  renderStart: number;
  styleAndLayoutStart: number;
  scripts: Array<{
    sourceURL: string;
    invoker: string;
    duration: number;
    forcedStyleAndLayoutDuration: number;
  }>;
};

type ScriptCost = {
  sourceURL: string;
  invoker: string;
  count: number;
  totalDurationMs: number;
  totalForcedStyleAndLayoutMs: number;
};

declare global {
  interface Window {
    __droppedFrameSamples?: Record<string, FrameSample[]>;
    __droppedFrameActive?: boolean;
    __longAnimationFrames?: AnimationFrameSample[] | null;
  }
}

async function getFixtureFrame(page: Page): Promise<Frame> {
  const expected = `/fixtures/${FIXTURE}/`;
  const deadline = Date.now() + FRAME_LOOKUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const frame = page.frames().find((candidate) => candidate.url().includes(expected));
    if (frame) return frame;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`[windows-dropped-frames] fixture frame not found: ${FIXTURE}`);
}

function aggregateScriptCosts(frames: AnimationFrameSample[]): ScriptCost[] {
  const costs = new Map<string, ScriptCost>();
  for (const frame of frames) {
    for (const script of frame.scripts) {
      const key = `${script.sourceURL}\u0000${script.invoker}`;
      const cost = costs.get(key) ?? {
        sourceURL: script.sourceURL,
        invoker: script.invoker,
        count: 0,
        totalDurationMs: 0,
        totalForcedStyleAndLayoutMs: 0,
      };
      cost.count++;
      cost.totalDurationMs += script.duration;
      cost.totalForcedStyleAndLayoutMs += script.forcedStyleAndLayoutDuration;
      costs.set(key, cost);
    }
  }
  return [...costs.values()]
    .sort((left, right) => right.totalDurationMs - left.totalDurationMs)
    .slice(0, 10);
}

async function waitForVideoReadiness(frame: Frame): Promise<void> {
  try {
    await frame.waitForFunction(
      () =>
        Array.from(document.querySelectorAll<HTMLVideoElement>("video[data-track-index]")).every(
          (video) => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
        ),
      { timeout: 60_000 },
    );
  } catch (error) {
    const states = await frame.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLVideoElement>("video[data-track-index]")).map(
        (video) => ({
          scene: `tile-${video.dataset.trackIndex ?? "unknown"}`,
          readyState: video.readyState,
        }),
      ),
    );
    throw new Error(
      `[windows-dropped-frames] videos did not become frame-ready: ${JSON.stringify(states)} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

async function readPlaybackState(frame: Frame) {
  return frame.evaluate(() => ({
    playerPresent: window.__player !== undefined,
    isPlaying: window.__player?.isPlaying?.() ?? null,
    time: window.__player?.getTime?.() ?? null,
    videos: Array.from(document.querySelectorAll<HTMLVideoElement>("video[data-track-index]")).map(
      (video) => ({
        scene: `tile-${video.dataset.trackIndex ?? "unknown"}`,
        paused: video.paused,
        readyState: video.readyState,
        currentTime: video.currentTime,
      }),
    ),
  }));
}

async function installFrameSamplers(
  frame: Frame,
): Promise<{ videoCount: number; targetFps: number }> {
  return frame.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#root[data-fps]");
    const targetFps = Number(root?.dataset.fps);
    const videos = Array.from(
      document.querySelectorAll<HTMLVideoElement>("video[data-track-index]"),
    );
    window.__droppedFrameSamples = {};
    window.__droppedFrameActive = true;
    window.__longAnimationFrames = null;

    const supported = PerformanceObserver.supportedEntryTypes.includes("long-animation-frame");
    if (supported) {
      window.__longAnimationFrames = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const longFrame = entry as PerformanceEntry & {
            blockingDuration?: number;
            renderStart?: number;
            styleAndLayoutStart?: number;
            scripts?: Array<{
              sourceURL?: string;
              invoker?: string;
              duration?: number;
              forcedStyleAndLayoutDuration?: number;
            }>;
          };
          window.__longAnimationFrames!.push({
            duration: longFrame.duration,
            blockingDuration: longFrame.blockingDuration ?? 0,
            renderStart: longFrame.renderStart ?? 0,
            styleAndLayoutStart: longFrame.styleAndLayoutStart ?? 0,
            scripts: (longFrame.scripts ?? []).map((script) => ({
              sourceURL: script.sourceURL ?? "",
              invoker: script.invoker ?? "",
              duration: script.duration ?? 0,
              forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration ?? 0,
            })),
          });
        }
      });
      observer.observe({ type: "long-animation-frame", buffered: true });
    }

    let installed = 0;
    for (const video of videos) {
      const track = video.dataset.trackIndex;
      if (track === undefined || typeof video.requestVideoFrameCallback !== "function") continue;
      const scene = `tile-${track}`;
      window.__droppedFrameSamples[scene] = [];
      const tick: VideoFrameRequestCallback = (now, metadata) => {
        if (!window.__droppedFrameActive) return;
        const decoderMs =
          typeof metadata.processingDuration === "number"
            ? metadata.processingDuration * 1_000
            : null;
        const callbackDelayMs = Math.max(0, now - metadata.expectedDisplayTime);
        window.__droppedFrameSamples![scene]!.push({
          mediaTime: metadata.mediaTime,
          presentedFrames: metadata.presentedFrames,
          decoderMs,
          callbackDelayMs,
        });
        video.requestVideoFrameCallback(tick);
      };
      video.requestVideoFrameCallback(tick);
      installed++;
    }
    return { videoCount: installed, targetFps };
  });
}

function summarizeFrames(
  sampleMap: Record<string, FrameSample[]>,
  sampleDurationMs: number,
  targetFps: number,
): ReturnType<typeof summarizeSceneFrames> {
  const windows: SceneFrameWindow[] = Object.entries(sampleMap).map(([scene, samples]) => {
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!first || !last || samples.length < 2) {
      throw new Error(
        `[windows-dropped-frames] too few video frame samples for ${scene}: ${samples.length}`,
      );
    }
    const mediaDuration = Math.max(0, last.mediaTime - first.mediaTime);
    const submittedFrames = Math.max(0, last.presentedFrames - first.presentedFrames);
    const decoderMs = samples.flatMap((sample) =>
      sample.decoderMs === null ? [] : [sample.decoderMs],
    );
    return {
      scene,
      durationMs: sampleDurationMs,
      expectedFrames: Math.max(1, Math.round(mediaDuration * targetFps)),
      presentedFrames: submittedFrames,
      decoderMs,
      callbackDelayMs: samples.map((sample) => sample.callbackDelayMs),
    };
  });
  return summarizeSceneFrames(windows, targetFps);
}

async function run(): Promise<void> {
  const server = startServer();
  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  try {
    browser = await launchBrowser({ width: 1920, height: 1080 });
    const browserInfo = await browser.userAgent();
    const runs = [];
    for (let runIndex = 0; runIndex < RUNS; runIndex++) {
      const context = await browser.createBrowserContext();
      try {
        const page = await context.newPage();
        await loadHostPage(page, server.origin, { fixture: FIXTURE, readyTimeoutMs: 60_000 });
        await waitForPlayerAssetsReady(page, 60_000);
        const frame = await getFixtureFrame(page);
        await waitForVideoReadiness(frame);

        await page.evaluate(() => {
          const player = document.getElementById("player") as
            | (HTMLElement & { play: () => void })
            | null;
          if (!player) throw new Error("player host element is missing");
          player.play();
        });
        try {
          await frame.waitForFunction(() => window.__player?.isPlaying?.() === true, {
            timeout: PLAY_CONFIRM_TIMEOUT_MS,
          });
        } catch (error) {
          const state = await readPlaybackState(frame);
          throw new Error(
            `[windows-dropped-frames] playback did not start: ${JSON.stringify(state)} (${error instanceof Error ? error.message : String(error)})`,
          );
        }
        const { videoCount, targetFps } = await installFrameSamplers(frame);
        if (videoCount !== 16) {
          throw new Error(
            `[windows-dropped-frames] expected 16 sampled videos, installed ${videoCount}`,
          );
        }
        if (!Number.isFinite(targetFps) || targetFps <= 0) {
          throw new Error(
            `[windows-dropped-frames] fixture has invalid target frame rate: ${targetFps}`,
          );
        }

        const startedAt = performance.now();
        await new Promise((resolvePromise) => setTimeout(resolvePromise, SAMPLE_MS));
        const sampleDurationMs = performance.now() - startedAt;
        const result = await frame.evaluate(() => {
          window.__droppedFrameActive = false;
          return {
            samples: window.__droppedFrameSamples ?? {},
            longAnimationFrames: window.__longAnimationFrames,
          };
        });
        let scenes: ReturnType<typeof summarizeSceneFrames>;
        try {
          scenes = summarizeFrames(result.samples, sampleDurationMs, targetFps);
        } catch (error) {
          const state = await readPlaybackState(frame);
          throw new Error(
            `[windows-dropped-frames] frame sampling failed: ${JSON.stringify(state)}; sampleCounts=${JSON.stringify(Object.fromEntries(Object.entries(result.samples).map(([scene, samples]) => [scene, samples.length])))} (${error instanceof Error ? error.message : String(error)})`,
          );
        }
        const longFrames = result.longAnimationFrames ?? null;
        const mainThread =
          longFrames === null
            ? null
            : {
                count: longFrames.length,
                totalDurationMs: longFrames.reduce((sum, entry) => sum + entry.duration, 0),
                totalBlockingMs: longFrames.reduce((sum, entry) => sum + entry.blockingDuration, 0),
                longest: percentile(
                  longFrames.map((entry) => entry.duration),
                  0.95,
                ),
                topScripts: aggregateScriptCosts(longFrames),
              };
        const gl = await page.evaluate(() => {
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("webgl");
          if (!context) return null;
          const extension = context.getExtension("WEBGL_debug_renderer_info");
          return extension ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL) : "unknown";
        });
        runs.push({ run: runIndex + 1, sampleDurationMs, scenes, mainThread, webglRenderer: gl });
        console.log(
          `[windows-dropped-frames] run=${runIndex + 1} renderer=${gl ?? "unavailable"} ` +
            scenes
              .map(
                (scene) =>
                  `${scene.scene}:missed=${scene.missedFps.toFixed(1)}/s (${scene.missedPercent.toFixed(1)}%) decoderP95=${scene.decoderP95Ms?.toFixed(1) ?? "MISSING"}ms callbackDelayP95=${scene.callbackDelayP95Ms?.toFixed(1) ?? "MISSING"}ms`,
              )
              .join(" | "),
        );
        if (mainThread === null) {
          console.log("[windows-dropped-frames] Long Animation Frame API unavailable");
        } else {
          console.log(
            `[windows-dropped-frames] main-thread long-frames=${mainThread.count} ` +
              `total=${mainThread.totalDurationMs.toFixed(1)}ms blocking=${mainThread.totalBlockingMs.toFixed(1)}ms p95=${mainThread.longest?.toFixed(1) ?? "MISSING"}ms`,
          );
        }
        await page.evaluate(() => {
          const player = document.getElementById("player") as
            | (HTMLElement & { pause: () => void })
            | null;
          player?.pause();
        });
      } finally {
        await context.close();
      }
    }

    const output = resolve(repoPlayerDir(), "tests/perf/results/windows-dropped-frames.json");
    mkdirSync(resolve(output, ".."), { recursive: true });
    writeFileSync(
      output,
      JSON.stringify(
        {
          schemaVersion: 1,
          fixture: FIXTURE,
          browserInfo,
          browserArgs: ["--use-gl=angle", "--use-angle=swiftshader"],
          targetFps: 30,
          runs,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`[windows-dropped-frames] wrote ${output}`);
  } finally {
    await browser?.close();
    await server.stop();
  }
}

await run();
