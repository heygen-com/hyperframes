import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect } from "vitest";
import { decodePng, getFfmpegBinary, resolveConfig } from "@hyperframes/engine";
import {
  compareTiles,
  type Differential,
  type Rgba,
} from "../../../../../engine/src/services/__fixtures__/blurDifferential.js";
import {
  FIXTURES,
  type BlurFixture,
} from "../../../../../engine/src/services/__fixtures__/motionBlur/fixtures.js";
import {
  INVARIANTS,
  RENDER_OUTSIDE_MAX_MAE,
} from "../../../../../engine/src/services/__fixtures__/motionBlur/thresholds.js";
import { createRenderJob, executeRenderJob } from "../../renderOrchestrator.js";
import { assemble } from "../assemble.js";
import { plan, type DistributedRenderConfig } from "../plan.js";
import { renderChunk } from "../renderChunk.js";

export const HAS_FFMPEG =
  spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;
const FPS = 30;
/** Four workers over 60 frames start at 0, 15, 30 and 45, so no block starts where a 20-frame chunk does. */
export const WHOLE_WORKERS = 4;
const CHUNK_SIZE = 20;
export const RENDER_TIMEOUT_MS = 600_000;

const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };

export const fixtureNamed = (name: string): BlurFixture => {
  const f = FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`missing fixture ${name}`);
  return f;
};

/** The fixture with its `data-motion-blur-tier` removed, so `auto` itself picks the tier (the filter tier). */
function withoutTierAttribute(f: BlurFixture): BlurFixture {
  const html = (blur: "on" | "off"): string => {
    const pinned = f.html(blur);
    const stripped = pinned.replace(/ data-motion-blur-tier="[a-z]+"/, "");
    if (blur === "on" && stripped === pinned) throw new Error(`${f.name} pins no tier to remove`);
    return stripped;
  };
  return { ...f, html };
}

/** A scratch directory for the suite, whose fontconfig draws grayscale text so DOM glyphs and the capture canvas agree. */
export function useBlurScratch(): () => string {
  let root = "";
  let prior: string | undefined;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "hf-blur-chunks-"));
    prior = process.env.FONTCONFIG_FILE;
    const conf = join(root, "fonts.conf");
    writeFileSync(
      conf,
      `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>
<include ignore_missing="yes">/etc/fonts/fonts.conf</include>
<match target="font"><edit name="rgba" mode="assign"><const>none</const></edit></match>
</fontconfig>`,
    );
    process.env.FONTCONFIG_FILE = conf;
  });
  afterAll(() => {
    if (prior === undefined) delete process.env.FONTCONFIG_FILE;
    else process.env.FONTCONFIG_FILE = prior;
    rmSync(root, { recursive: true, force: true });
  });
  return () => root;
}

function decodeFrames(dir: string): Rgba[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".png"))
    .sort()
    .map((file) => decodePng(readFileSync(join(dir, file))));
}

function writeProject(root: string, f: BlurFixture, blur: "on" | "off", tag: string) {
  const workDir = join(root, `${f.name}-${tag}`);
  const projectDir = join(workDir, "project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "index.html"), f.html(blur));
  return { workDir, projectDir };
}

/** The normal in-process render: the page's own `data-motion-blur` decides. */
export async function renderWhole(
  root: string,
  f: BlurFixture,
  blur: "on" | "off",
  workers: number,
): Promise<Rgba[]> {
  const { workDir, projectDir } = writeProject(root, f, blur, `whole-${blur}`);
  const outputDir = join(workDir, "frames");
  const job = createRenderJob({
    fps: FPS,
    format: "png-sequence",
    quality: "standard",
    hdrMode: "force-sdr",
    useGpu: false,
    workers,
    logger: quietLogger,
    producerConfig: resolveConfig({ browserGpuMode: "software" }),
  });
  await executeRenderJob(job, projectDir, outputDir);
  const frames = decodeFrames(outputDir);
  rmSync(workDir, { recursive: true, force: true });
  return frames;
}

/** plan() then renderChunk() per chunk then assemble(), the way a Lambda or Cloud Run fan-out runs. */
export async function renderChunked(
  root: string,
  f: BlurFixture,
  blur: "on" | "off",
  tag: string,
  config: Partial<DistributedRenderConfig> = {},
): Promise<Rgba[]> {
  const { workDir, projectDir } = writeProject(root, f, blur, tag);
  const planDir = join(workDir, "plan");
  const chunksDir = join(workDir, "chunks");
  const outputDir = join(workDir, "frames");
  mkdirSync(planDir, { recursive: true });
  mkdirSync(chunksDir, { recursive: true });
  const planned = await plan(
    projectDir,
    {
      fps: FPS,
      width: f.width,
      height: f.height,
      format: "png-sequence",
      chunkSize: CHUNK_SIZE,
      rejectOnSystemFonts: false,
      failClosedFontFetch: false,
      ...config,
    },
    planDir,
  );
  const chunkPaths: string[] = [];
  for (let i = 0; i < planned.chunkCount; i++) {
    const chunkPath = join(chunksDir, `chunk-${String(i).padStart(4, "0")}`);
    await renderChunk(planDir, i, chunkPath);
    chunkPaths.push(chunkPath);
  }
  await assemble(planDir, chunkPaths, null, outputDir);
  const frames = decodeFrames(outputDir);
  rmSync(workDir, { recursive: true, force: true });
  return frames;
}

const wholeFrameMask = (frame: Rgba): Uint8Array => new Uint8Array(frame.width * frame.height);

function at(frames: readonly Rgba[], n: number): Rgba {
  const frame = frames[n];
  if (!frame) throw new Error(`missing frame ${n}`);
  return frame;
}

/** Whole-frame tile comparison of every frame: no trail is masked out, chunk boundaries included. */
export function compareEveryFrame(
  reference: readonly Rgba[],
  actual: readonly Rgba[],
): { frame: number; differential: Differential }[] {
  if (actual.length !== reference.length) {
    throw new Error(`frame count ${actual.length} differs from ${reference.length}`);
  }
  return reference.map((frame, n) => ({
    frame: n,
    differential: compareTiles(frame, at(actual, n), wholeFrameMask(frame), "outside", {
      block: INVARIANTS.block,
      maxMae: RENDER_OUTSIDE_MAX_MAE,
    }),
  }));
}

export function worstMae(results: readonly { differential: Differential }[]): number {
  return Math.max(...results.map((x) => x.differential.worstMae));
}

export function expectEqualFrames(
  label: string,
  results: readonly { frame: number; differential: Differential }[],
): void {
  const firstBad = results
    .filter((x) => x.differential.bad.length > 0)
    .slice(0, 5)
    .map((x) => ({ frame: x.frame, bad: x.differential.bad.slice(0, 3) }));
  expect(
    results.flatMap((x) => x.differential.bad),
    `${label} ${JSON.stringify(firstBad)}`,
  ).toEqual([]);
}

/** The frames of plan() -> renderChunk() -> assemble() with blur on equal a whole in-process render with blur on. */
export async function expectChunksEqualWhole(
  root: string,
  name: string,
  tier: "capture" | "auto" = "capture",
): Promise<void> {
  const f = tier === "auto" ? withoutTierAttribute(fixtureNamed(name)) : fixtureNamed(name);
  const whole = await renderWhole(root, f, "on", WHOLE_WORKERS);
  const chunked = await renderChunked(root, f, "on", "chunked-on");
  expectEqualFrames(name, compareEveryFrame(whole, chunked));
}
