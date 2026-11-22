#!/usr/bin/env tsx
/**
 * Fixture generator for the HDR passthrough parity harness.
 *
 * Writes, under `--out` (default `$TMPDIR/hf-hdr-passthrough/`):
 *
 *   assets/hlg-<duration>s.mp4   10-bit HEVC HLG / BT.2020 source clip + AAC audio
 *   captions/                    full-bleed HLG video on track 0, N caption cues on track 1
 *   transformed/                 negative fixture: same, but the video carries a CSS transform
 *
 * Each composition directory is a HyperFrames project (`index.html` +
 * `hyperframes.json`) that `hyperframes render <dir>` accepts. Media is
 * hard-linked into each project so the render never reads outside it.
 *
 * Usage (from packages/producer):
 *   ../../node_modules/.bin/tsx src/hdr-passthrough-harness/fixture.ts                  # 20 s, 10 cues
 *   ../../node_modules/.bin/tsx src/hdr-passthrough-harness/fixture.ts --duration 180 --out /tmp/hdrpt-bench
 *
 * Nothing it writes is meant to be committed; the 3 min variant is ~150 MB.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, linkSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const FIXTURE_WIDTH = 1920;
const FIXTURE_HEIGHT = 1080;
export const FIXTURE_FPS = 30;
const DEFAULT_DURATION_SEC = 20;

export interface SourceClipOptions {
  outputPath: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  /** libx265 CRF for the source. Low, so the source itself is near-lossless. */
  crf: number;
}

/**
 * ffmpeg arguments for the HLG source: a moving colour gradient (smooth
 * ramps, where 10-bit vs 8-bit handling shows) with `testsrc2` (motion,
 * hard edges, a frame counter) inset in the middle, and a 440 Hz tone.
 * The pixels are generated in signal space and tagged BT.2020 / ARIB
 * STD-B67 at both the container and the HEVC VUI level, so the producer's
 * HDR probe classifies it exactly like a camera HLG clip.
 */
export function buildSourceClipArgs(options: SourceClipOptions): string[] {
  const { width, height, fps, durationSec, crf } = options;
  const insetW = Math.round(width / 2 / 2) * 2;
  const insetH = Math.round(height / 2 / 2) * 2;
  const filter = [
    `gradients=size=${width}x${height}:rate=${fps}:speed=0.015:nb_colors=4:seed=7:duration=${durationSec}[bg]`,
    `testsrc2=size=${insetW}x${insetH}:rate=${fps}:duration=${durationSec}[fg]`,
    `[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2:format=auto,format=yuv420p10le[v]`,
    `sine=frequency=440:sample_rate=48000:duration=${durationSec}[a]`,
  ].join(";");
  return [
    "-hide_banner",
    "-v",
    "error",
    "-y",
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx265",
    "-preset",
    "fast",
    "-crf",
    String(crf),
    "-pix_fmt",
    "yuv420p10le",
    "-profile:v",
    "main10",
    "-x265-params",
    "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:range=limited:log-level=error",
    "-color_primaries",
    "bt2020",
    "-color_trc",
    "arib-std-b67",
    "-colorspace",
    "bt2020nc",
    "-color_range",
    "tv",
    "-tag:v",
    "hvc1",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-t",
    String(durationSec),
    options.outputPath,
  ];
}

export interface CaptionCue {
  id: string;
  text: string;
  startSec: number;
  durationSec: number;
}

const CAPTION_LINES = [
  "Ten-bit HLG under a static caption",
  "Captions change only at cue boundaries",
  "Semi-transparent box, soft alpha edges",
  "Every glyph is antialiased against video",
  "The video underneath keeps moving",
  "One state per cue, rendered once",
  "Overlay blends in HDR signal space",
  "Same encoder, same colour tags",
  "Gaps between cues have no overlay",
  "Last cue, then a short tail",
];

/**
 * `count` cues spread over `[0.5 s, duration - 0.5 s)`, each taking 70% of
 * its slot so there is a caption-free gap between cues (an empty overlay
 * state). Times are rounded to whole frames so a cue boundary never falls
 * between two frames.
 */
export function buildCaptionCues(durationSec: number, count: number, fps: number): CaptionCue[] {
  if (!(durationSec > 1)) throw new Error(`duration must be > 1 s, got ${durationSec}`);
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`cue count must be >= 1, got ${count}`);
  const span = durationSec - 1;
  const slot = span / count;
  const toFrame = (sec: number): number => Math.round(sec * fps) / fps;
  return Array.from({ length: count }, (_, index) => {
    const startSec = toFrame(0.5 + index * slot);
    const endSec = toFrame(0.5 + index * slot + slot * 0.7);
    return {
      id: `cue-${String(index + 1).padStart(3, "0")}`,
      text: `${CAPTION_LINES[index % CAPTION_LINES.length]} (${index + 1}/${count})`,
      startSec,
      durationSec: Number((endSec - startSec).toFixed(6)),
    };
  });
}

export interface CompositionOptions {
  compositionId: string;
  videoSrc: string;
  durationSec: number;
  width: number;
  height: number;
  cues: readonly CaptionCue[];
  /** CSS transform on the video; set only for the negative fixture. */
  videoTransform?: string;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * A composition with the HLG clip full-bleed on track 0 (`object-fit: cover`
 * at the clip's own size, so it maps 1:1) and one caption clip per cue on
 * track 1. No timeline script: every overlay change is a clip boundary.
 */
export function buildCompositionHtml(options: CompositionOptions): string {
  const { compositionId, videoSrc, durationSec, width, height, cues, videoTransform } = options;
  const videoStyle = videoTransform ? ` style="transform: ${escapeHtml(videoTransform)}"` : "";
  const captions = cues
    .map(
      (cue) =>
        `      <div id="${cue.id}" class="clip caption" data-start="${cue.startSec}" data-duration="${cue.durationSec}" data-track-index="1"><span>${escapeHtml(cue.text)}</span></div>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(compositionId)}</title>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        background: #000;
      }
      #root {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #000;
      }
      #hdr-source {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .caption {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 96px;
        text-align: center;
      }
      .caption span {
        display: inline-block;
        max-width: 80%;
        padding: 18px 34px;
        border-radius: 18px;
        background: rgba(12, 14, 20, 0.58);
        box-shadow: 0 0 24px 6px rgba(12, 14, 20, 0.35);
        color: #fff;
        font-family: "DejaVu Sans", Arial, sans-serif;
        font-size: 54px;
        font-weight: 700;
        line-height: 1.2;
        letter-spacing: 0.01em;
        text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="${escapeHtml(compositionId)}"
      data-start="0"
      data-duration="${durationSec}"
      data-width="${width}"
      data-height="${height}"
      data-no-timeline
    >
      <video
        id="hdr-source"
        class="clip"
        src="${escapeHtml(videoSrc)}"
        data-start="0"
        data-duration="${durationSec}"
        data-media-start="0"
        data-track-index="0"
        data-has-audio="true"
        playsinline${videoStyle}
      ></video>
${captions}
    </div>
  </body>
</html>
`;
}

interface FixtureProject {
  name: "captions" | "transformed";
  /** What the flag-on render is expected to do. */
  expect: "passthrough" | "fallback";
  dir: string;
}

interface GeneratedFixtures {
  sourcePath: string;
  durationSec: number;
  fps: number;
  projects: FixtureProject[];
}

function linkOrCopy(source: string, destination: string): void {
  if (existsSync(destination)) return;
  try {
    linkSync(source, destination);
  } catch {
    copyFileSync(source, destination);
  }
}

function writeProject(
  root: string,
  name: FixtureProject["name"],
  sourcePath: string,
  html: string,
  fps: number,
): string {
  const dir = join(root, name);
  mkdirSync(join(dir, "assets"), { recursive: true });
  const assetName = "hlg-source.mp4";
  const target = join(dir, "assets", assetName);
  linkOrCopy(sourcePath, target);
  writeFileSync(join(dir, "index.html"), html);
  writeFileSync(
    join(dir, "hyperframes.json"),
    `${JSON.stringify({ name, fps, width: FIXTURE_WIDTH, height: FIXTURE_HEIGHT }, null, 2)}\n`,
  );
  return dir;
}

interface GenerateOptions {
  outDir: string;
  durationSec: number;
  cueCount: number;
  ffmpegPath: string;
  force: boolean;
}

function generateFixtures(options: GenerateOptions): GeneratedFixtures {
  const { outDir, durationSec, cueCount, ffmpegPath } = options;
  const fps = FIXTURE_FPS;
  mkdirSync(join(outDir, "assets"), { recursive: true });
  const sourcePath = join(outDir, "assets", `hlg-${durationSec}s.mp4`);
  if (options.force || !existsSync(sourcePath) || statSync(sourcePath).size === 0) {
    const started = Date.now();
    const result = spawnSync(
      ffmpegPath,
      buildSourceClipArgs({
        outputPath: sourcePath,
        durationSec,
        width: FIXTURE_WIDTH,
        height: FIXTURE_HEIGHT,
        fps,
        crf: 12,
      }),
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    if (result.status !== 0) {
      throw new Error(`ffmpeg failed generating ${sourcePath} (exit ${result.status ?? "signal"})`);
    }
    console.log(`source clip: ${sourcePath} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  } else {
    console.log(`source clip: ${sourcePath} (reused)`);
  }

  const cues = buildCaptionCues(durationSec, cueCount, fps);
  const base = {
    videoSrc: "assets/hlg-source.mp4",
    durationSec,
    width: FIXTURE_WIDTH,
    height: FIXTURE_HEIGHT,
    cues,
  };
  const projects: FixtureProject[] = [
    {
      name: "captions",
      expect: "passthrough",
      dir: writeProject(
        outDir,
        "captions",
        sourcePath,
        buildCompositionHtml({ ...base, compositionId: "hdr-passthrough-captions" }),
        fps,
      ),
    },
    {
      name: "transformed",
      expect: "fallback",
      dir: writeProject(
        outDir,
        "transformed",
        sourcePath,
        buildCompositionHtml({
          ...base,
          compositionId: "hdr-passthrough-transformed",
          videoTransform: "scale(0.9) rotate(1.5deg)",
        }),
        fps,
      ),
    },
  ];
  const manifest: GeneratedFixtures = { sourcePath, durationSec, fps, projects };
  writeFileSync(join(outDir, "fixtures.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      out: { type: "string", default: join(tmpdir(), "hf-hdr-passthrough") },
      duration: { type: "string", default: String(DEFAULT_DURATION_SEC) },
      cues: { type: "string" },
      ffmpeg: { type: "string", default: process.env.FFMPEG_PATH ?? "ffmpeg" },
      force: { type: "boolean", default: false },
    },
  });
  const durationSec = Number(values.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 1) {
    throw new Error(`--duration must be a number > 1, got ${values.duration}`);
  }
  // ~1 cue per 2 s: 10 cues for the 20 s fixture, 90 for the 3 min one.
  const cueCount = values.cues ? Number(values.cues) : Math.max(1, Math.round(durationSec / 2));
  const manifest = generateFixtures({
    outDir: resolve(values.out),
    durationSec,
    cueCount,
    ffmpegPath: values.ffmpeg,
    force: values.force,
  });
  for (const project of manifest.projects) {
    console.log(`${project.name.padEnd(12)} ${project.dir} (flag on: expect ${project.expect})`);
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) main();
