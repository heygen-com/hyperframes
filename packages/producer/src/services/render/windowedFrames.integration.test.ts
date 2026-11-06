// Windowed source-video frames (HF_VIDEO_FRAME_WINDOW), rendered for real: each case renders twice
// on the segmented route, once reading a segment's frames at a time and once extracting whole
// videos, and the two outputs must match frame for frame. Needs Chrome + ffmpeg: integration lane.
// Known gap: this test pins `browserGpuMode: "software"`, so every render here takes the screenshot
// path. Windowed drawElement output parity was measured by hand on real footage and has no automated
// guard.
//
// HF_TEST_RETRY_BROWSER_STALL=1 renders once more after Chrome dies, for an overloaded local host.
// Never set it in CI: a windowed render that needs the retry alone fails the case.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { resolveConfig, type MotionBlurOptions } from "@hyperframes/engine";
import {
  createRenderJob,
  executeRenderJob,
  resolveRenderWorkDirPrefix,
  type RenderJob,
} from "../renderOrchestrator.js";
import { FFMPEG, HAS_FFMPEG } from "./frameLevelsTestFixtures.js";

const WIDTH = 160;
const HEIGHT = 90;
const SEGMENT_FRAMES = 60;
const LOOSENESS = 1.2;

interface Clip {
  id: string;
  src: string;
  start: number;
  duration: number;
  mediaStart?: number;
  loop?: boolean;
  /** A `data-automation` rate lane, as the speed-ramp regression fixture writes one. */
  rate?: Array<{ t: number; v: number }>;
  /** Left and width in px; the whole frame when absent. */
  box?: { left: number; width: number };
}

interface Case {
  name: string;
  fps: { num: number; den: number };
  fpsAttribute: string;
  seconds: number;
  clips: Clip[];
  /** Absent: the orchestrator picks, and measures capture speed first. */
  workers?: number;
  motionBlur?: MotionBlurOptions;
  /** Whether the windowed render is expected to read frames a segment at a time. */
  windowed: boolean;
  /** Frames of the videos that are never deferred, which the windowed render still extracts whole. */
  upFrontFrames?: number;
  /** Set when the orchestrator measures capture speed before it captures. */
  calibrates?: boolean;
  /** Caps the worker count the orchestrator picks, to keep the Chromes it opens few. */
  maxWorkers?: number;
}

interface Run {
  frames: string[];
  mode: string;
  capturePath: string | undefined;
  videoFrameWindow: string | undefined;
  workerCount: number | undefined;
  /** The render died on Chrome and was rendered again (HF_TEST_RETRY_BROWSER_STALL). */
  retried: boolean;
  peakBytes: number | undefined;
  extractedFrames: number | undefined;
  calibration: string;
  /** Windowed renders only: what a poll of `segment-frames` saw while the render ran. */
  sampled: { peakBytes: number; largestFileBytes: number };
  /** `keepWorkDir` renders only: the entries left in `segment-frames` once the render closed. */
  leftInSegmentFrames: string[] | undefined;
}

let root: string;

function ffmpeg(args: string[]): void {
  const result = spawnSync(FFMPEG, ["-v", "error", "-y", ...args], { encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`fixture failed: ${result.stderr}`);
}

/** testsrc2 changes every frame, so a window off by one frame shows. */
function makeSource(name: string, rate: string, seconds: number, filter?: string): void {
  const path = join(root, "assets", name);
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${rate}:duration=${seconds}`,
    ...(filter ? ["-vf", filter, "-fps_mode", "vfr"] : []),
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "libx264",
    "-g",
    "1",
    path,
  ]);
}

function composition(testCase: Case): string {
  const videos = testCase.clips.map((clip, track) => {
    const box = clip.box ?? { left: 0, width: WIDTH };
    const attributes = [
      `id="${clip.id}"`,
      `class="clip"`,
      `src="${clip.src}"`,
      `data-start="${clip.start}"`,
      `data-duration="${clip.duration}"`,
      `data-track-index="${track}"`,
      clip.mediaStart === undefined ? "" : `data-media-start="${clip.mediaStart}"`,
      clip.loop ? "loop" : "",
      clip.rate
        ? `data-automation='${JSON.stringify({ version: 1, lanes: [{ target: "rate", points: clip.rate }] })}'`
        : "",
      `style="left:${box.left}px;width:${box.width}px"`,
      "muted playsinline",
    ];
    return `    <video ${attributes.filter(Boolean).join(" ")}></video>`;
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: #000; }
    video { position: absolute; top: 0; height: ${HEIGHT}px; object-fit: cover; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="windowed-frames" data-start="0" data-duration="${testCase.seconds}"
    data-width="${WIDTH}" data-height="${HEIGHT}" data-fps="${testCase.fpsAttribute}" data-no-timeline>
${videos.join("\n")}
  </div>
</body>
</html>
`;
}

function framemd5(path: string): string[] {
  const result = spawnSync(FFMPEG, ["-v", "error", "-i", path, "-f", "framemd5", "-"], {
    encoding: "utf-8",
    maxBuffer: 1 << 26,
  });
  if (result.status !== 0) throw new Error(`framemd5 failed: ${result.stderr}`);
  return result.stdout.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
}

function directoryBytes(path: string, onFile: (bytes: number) => void): number {
  let bytes = 0;
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = join(path, entry.name);
    try {
      if (entry.isDirectory()) bytes += directoryBytes(child, onFile);
      else {
        const size = statSync(child).size;
        bytes += size;
        onFile(size);
      }
    } catch {
      // A segment closing removes its files mid-walk.
    }
  }
  return bytes;
}

function firstDifference(left: string[], right: string[]): number {
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) if (left[i] !== right[i]) return i;
  return -1;
}

const ENV_KEYS = [
  "HF_SEGMENTED_CAPTURE",
  "HF_SEGMENT_FRAMES",
  "HF_VIDEO_FRAME_WINDOW",
  "KEEP_TEMP",
] as const;

/** Sets the render's env and returns the call that puts the caller's back. */
function setRenderEnv(windowed: boolean, keepWorkDir: boolean | undefined): () => void {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.HF_SEGMENTED_CAPTURE = "true";
  process.env.HF_SEGMENT_FRAMES = String(SEGMENT_FRAMES);
  if (windowed) process.env.HF_VIDEO_FRAME_WINDOW = "true";
  else delete process.env.HF_VIDEO_FRAME_WINDOW;
  if (keepWorkDir) process.env.KEEP_TEMP = "1";
  else delete process.env.KEEP_TEMP;
  return () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
}

function ownedByThisProcess(dir: string): boolean {
  try {
    return JSON.parse(readFileSync(join(dir, "owner.json"), "utf-8")).pid === process.pid;
  } catch {
    return false;
  }
}

/**
 * This render's work dir, where the orchestrator puts it on this platform: named by the job on
 * Linux, and a shared `hf-render-` prefix in the system temp dir elsewhere. The owner record's pid
 * rules out another process's render; renders in this process run serially and each snapshots the
 * directory before it starts, which is what tells one of them from another.
 */
function watchWorkDirs(output: string, jobId: string) {
  const prefix = resolveRenderWorkDirPrefix(output, jobId);
  const parent = dirname(prefix);
  const before = new Set(readdirSync(parent));
  const own = () =>
    readdirSync(parent)
      .filter((name) => name.startsWith(basename(prefix)) && !before.has(name))
      .map((name) => join(parent, name))
      .filter(ownedByThisProcess);
  return { own };
}

/** Polls `segment-frames` in the render's work dir for the most it holds at once. */
function sampleSegmentFrames(own: () => string[]) {
  const sampled = { peakBytes: 0, largestFileBytes: 0 };
  const poll = setInterval(() => {
    for (const workDir of own()) {
      const held = directoryBytes(join(workDir, "segment-frames"), (bytes) => {
        sampled.largestFileBytes = Math.max(sampled.largestFileBytes, bytes);
      });
      sampled.peakBytes = Math.max(sampled.peakBytes, held);
    }
  }, 50);
  return { sampled, stop: () => clearInterval(poll) };
}

// Flat field mapping: the `?.` and `??` are fallbacks for a summary that may lack a field, not logic.
// fallow-ignore-next-line complexity
function describeRun(
  job: RenderJob,
  output: string,
  trace: Array<Record<string, unknown>>,
): Omit<Run, "sampled" | "leftInSegmentFrames"> {
  const perf = job.perfSummary;
  const capture = perf?.observability?.capture;
  const calibration = trace.find(
    (event) => event.phase === "capture_calibration" && event.status === "checkpoint",
  );
  return {
    frames: framemd5(output),
    mode: [
      capture?.captureMode,
      `drawElement=${perf?.drawElement?.mode ?? "none"}`,
      `forceScreenshot=${String(capture?.forceScreenshot)}`,
      `selfVerifyFallback=${String(perf?.drawElement?.selfVerifyFallback ?? false)}`,
    ].join(" "),
    capturePath: capture?.capturePath,
    videoFrameWindow: capture?.videoFrameWindow,
    workerCount: capture?.workerCount,
    retried: false,
    peakBytes: capture?.videoFrameWindowPeakBytes,
    extractedFrames: perf?.observability?.extraction?.totalFramesExtracted,
    calibration: String(calibration?.message ?? "not reached"),
  };
}

const RETRY_BROWSER_DEATH = process.env.HF_TEST_RETRY_BROWSER_STALL === "1";
const BROWSER_DEATH = /Connection closed|Chrome started and kept running/;

interface RenderOptions {
  /** Leaves the work dir behind (KEEP_TEMP) and reports what `segment-frames` held at the end. */
  keepWorkDir?: boolean;
  /** Polls `segment-frames` while the render runs. */
  sampleFolder?: boolean;
}

/** A render; with HF_TEST_RETRY_BROWSER_STALL=1, rendered once more if Chrome died under it. */
async function render(
  testCase: Case,
  windowed: boolean,
  options: RenderOptions = {},
): Promise<Run> {
  try {
    return await renderOnce(testCase, windowed, options);
  } catch (error) {
    if (!RETRY_BROWSER_DEATH || !BROWSER_DEATH.test(String(error))) throw error;
    console.log(`[windowedFrames] ${String(error).slice(0, 160)}; rendering it again`);
    return { ...(await renderOnce(testCase, windowed, options)), retried: true };
  }
}

function createJob(testCase: Case, trace: Array<Record<string, unknown>>): RenderJob {
  return createRenderJob({
    fps: testCase.fps,
    quality: "draft",
    format: "mp4",
    hdrMode: "force-sdr",
    workers: testCase.workers,
    motionBlur: testCase.motionBlur,
    logger: {
      info(message: string, meta?: Record<string, unknown>) {
        if (message === "[Render:trace]" && meta) trace.push(meta);
      },
      warn() {},
      error() {},
      debug() {},
    },
    producerConfig: resolveConfig({
      browserGpuMode: "software",
      concurrency: testCase.maxWorkers ?? "auto",
    }),
  });
}

const NO_SAMPLER = { sampled: { peakBytes: 0, largestFileBytes: 0 }, stop: () => {} };

/** What a kept work dir's `segment-frames` still holds, or undefined when there is no such folder. */
function leftInSegmentFrames(workDirs: string[]): string[] | undefined {
  const folder = workDirs.map((workDir) => join(workDir, "segment-frames")).find(existsSync);
  return folder ? readdirSync(folder) : undefined;
}

/** Renders the case on the segmented route with or without the window. */
async function renderOnce(testCase: Case, windowed: boolean, options: RenderOptions): Promise<Run> {
  const label = `${testCase.name.replace(/\W+/g, "-")}-${windowed ? "windowed" : "full"}`;
  writeFileSync(join(root, "index.html"), composition(testCase));
  const trace: Array<Record<string, unknown>> = [];
  const job = createJob(testCase, trace);
  const restoreEnv = setRenderEnv(windowed, options.keepWorkDir);
  const output = join(root, `${label}.mp4`);
  const { own } = watchWorkDirs(output, job.id);
  const sampler = options.sampleFolder ? sampleSegmentFrames(own) : NO_SAMPLER;
  const kept: string[] = [];
  try {
    await executeRenderJob(job, root, output).catch((error: unknown) => {
      throw new Error(`${label} failed: ${String(error)}`, { cause: error });
    });
    if (options.keepWorkDir) kept.push(...own());
    return {
      ...describeRun(job, output, trace),
      sampled: sampler.sampled,
      leftInSegmentFrames: leftInSegmentFrames(kept),
    };
  } finally {
    sampler.stop();
    restoreEnv();
    for (const workDir of kept) rmSync(workDir, { recursive: true, force: true });
  }
}

const rendered = new Map<string, Promise<{ windowed: Run; full: Run }>>();

/** Both renders of a case, once per run of this file. Serial: Chrome is the machine's to share. */
function renderPair(testCase: Case): Promise<{ windowed: Run; full: Run }> {
  let pair = rendered.get(testCase.name);
  if (!pair) {
    pair = (async () => {
      const full = await render(testCase, false);
      const windowed = await render(testCase, true, {
        keepWorkDir: testCase.name === PEAK_CASE,
        sampleFolder: testCase.name === PEAK_CASE,
      });
      if (windowed.retried && !full.retried) {
        throw new Error(`${testCase.name}: only the windowed render needed a retry`);
      }
      console.log(
        `[windowedFrames] ${testCase.name}: retried windowed=${windowed.retried} full=${full.retried}; mode=${windowed.mode} (full: ${full.mode}); ` +
          `window=${windowed.videoFrameWindow}; workers=${windowed.workerCount}; calibration=${windowed.calibration}; ` +
          `frames=${windowed.frames.length}; peak=${windowed.peakBytes ?? "n/a"} B; ` +
          `extracted frames windowed=${windowed.extractedFrames} full=${full.extractedFrames}`,
      );
      return { windowed, full };
    })();
    rendered.set(testCase.name, pair);
  }
  return pair;
}

const PEAK_CASE = "2 workers";
// Four segments for two workers, so the window has something to hold back.
const PEAK_SECONDS = 8;
const CFR = "assets/cfr.mp4";

function cases(): Case[] {
  const thirty = { num: 30, den: 1 };
  const base = { fps: thirty, fpsAttribute: "30", workers: 1, windowed: true };
  return [
    {
      ...base,
      name: "a mid-clip start",
      seconds: 5,
      clips: [{ id: "clip", src: CFR, start: 1.2, duration: 3, mediaStart: 2 }],
    },
    {
      ...base,
      name: "NTSC 24000/1001",
      fps: { num: 24000, den: 1001 },
      fpsAttribute: "24000/1001",
      seconds: 5,
      clips: [{ id: "clip", src: "assets/ntsc.mp4", start: 0.5, duration: 3.5, mediaStart: 0.7 }],
    },
    {
      ...base,
      name: "a loop crossing a slice edge",
      seconds: 5.5,
      clips: [{ id: "clip", src: "assets/short.mp4", start: 0, duration: 5.5, loop: true }],
    },
    {
      ...base,
      name: "a playback-rate ramp",
      seconds: 3,
      clips: [
        {
          id: "clip",
          src: CFR,
          start: 0,
          duration: 3,
          rate: [
            { t: 0, v: 1 },
            { t: 1.5, v: 3 },
            { t: 3, v: 0.5 },
          ],
        },
      ],
    },
    {
      ...base,
      name: "a held tail",
      seconds: 4,
      clips: [{ id: "clip", src: "assets/short.mp4", start: 0, duration: 4 }],
    },
    {
      ...base,
      name: "two clips of one file in different slices",
      seconds: 5,
      clips: [
        { id: "first", src: CFR, start: 0, duration: 2 },
        { id: "second", src: CFR, start: 3, duration: 2, mediaStart: 3 },
      ],
    },
    {
      ...base,
      name: "a VFR source beside a CFR one",
      upFrontFrames: 90,
      seconds: 3,
      clips: [
        { id: "vfr", src: "assets/vfr.mp4", start: 0, duration: 3, box: { left: 0, width: 80 } },
        { id: "cfr", src: CFR, start: 0, duration: 3, box: { left: 80, width: 80 } },
      ],
    },
    {
      ...base,
      name: PEAK_CASE,
      workers: 2,
      seconds: PEAK_SECONDS,
      clips: [{ id: "clip", src: "assets/long.mp4", start: 0, duration: PEAK_SECONDS }],
    },
    {
      ...base,
      name: "motion blur, which declines the window",
      motionBlur: { samplesPerFrame: 2 },
      windowed: false,
      seconds: 3,
      clips: [{ id: "clip", src: CFR, start: 0, duration: 3 }],
    },
    {
      ...base,
      name: "the orchestrator choosing workers",
      workers: undefined,
      calibrates: true,
      maxWorkers: 2,
      seconds: 4,
      clips: [{ id: "clip", src: CFR, start: 0, duration: 4 }],
    },
  ];
}

/** What the windowed render read up front, and whether capture calibration ran, against the case. */
function expectWindowing(testCase: Case, windowed: Run, full: Run): void {
  if (testCase.windowed) {
    expect(windowed.peakBytes ?? 0).toBeGreaterThan(0);
    // Deferred videos are left out of the count, so a window that deferred nothing would tie.
    expect(windowed.extractedFrames ?? 0).toBeLessThan(full.extractedFrames ?? 0);
    // What is still extracted up front is exactly the videos that cannot be deferred.
    expect(windowed.extractedFrames).toBe(testCase.upFrontFrames ?? 0);
  }
  if (testCase.calibrates) {
    expect(windowed.calibration).toBe("resolved");
    expect(full.calibration).toBe("resolved");
  }
}

describe.skipIf(!HAS_FFMPEG)("windowed source-video frames — real render", () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "hf-windowed-frames-"));
    mkdirSync(join(root, "assets"), { recursive: true });
    makeSource("cfr.mp4", "30", 6);
    makeSource("short.mp4", "30", 2.5);
    makeSource("long.mp4", "30", PEAK_SECONDS);
    makeSource("ntsc.mp4", "24000/1001", 5);
    // Half the frames dropped in each second keeps the timestamps' gaps: r_frame_rate 30, average 15.
    makeSource("vfr.mp4", "30", 6, "select='lt(mod(n\\,30)\\,15)'");
  });

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  for (const testCase of cases()) {
    it(`renders ${testCase.name} frame for frame like a full extraction`, async () => {
      const { windowed, full } = await renderPair(testCase);

      const difference = firstDifference(windowed.frames, full.frames);
      expect(difference === -1 ? "identical" : `first differs at output frame ${difference}`).toBe(
        "identical",
      );
      expect(windowed.frames).toEqual(full.frames);
      expect(full.frames.length).toBeGreaterThan(30);

      for (const run of [windowed, full]) expect(run.capturePath).toBe("segmented");
      expect(full.videoFrameWindow).toBe("off");
      expect(windowed.videoFrameWindow).toBe(testCase.windowed ? "on" : "off");
      // A fall back to a different capture mode is the failure a parity pass would hide.
      expect(windowed.mode).toBe(full.mode);
      expectWindowing(testCase, windowed, full);
    }, 600_000);
  }

  it("never holds more than workers x segment frames of source frames", async () => {
    const testCase = cases().find((candidate) => candidate.name === PEAK_CASE)!;
    const { windowed } = await renderPair(testCase);
    const { sampled } = windowed;

    // A poll that saw no frame file would pass every bound below.
    expect(sampled.largestFileBytes).toBeGreaterThan(0);
    // The count the render ran with, which a clamp could have lowered from the one asked for.
    expect(windowed.workerCount).toBe(testCase.workers);
    const bound = windowed.workerCount! * SEGMENT_FRAMES * sampled.largestFileBytes * LOOSENESS;
    expect(sampled.peakBytes).toBeGreaterThan(0);
    expect(sampled.peakBytes).toBeLessThanOrEqual(bound);
    expect(windowed.peakBytes ?? 0).toBeGreaterThan(0);
    expect(windowed.peakBytes!).toBeLessThanOrEqual(bound);
    // The whole clip is what a full extraction holds; the bound must sit below it to mean anything.
    expect(bound).toBeLessThan(PEAK_SECONDS * 30 * sampled.largestFileBytes);
    expect(windowed.leftInSegmentFrames).toEqual([]);
    console.log(
      `[windowedFrames] ${PEAK_CASE}: sampled peak=${sampled.peakBytes} B, ` +
        `reported peak=${windowed.peakBytes} B, largest frame file=${sampled.largestFileBytes} B, ` +
        `bound=${bound} B`,
    );
  }, 600_000);
});
