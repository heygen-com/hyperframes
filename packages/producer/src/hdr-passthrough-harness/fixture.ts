#!/usr/bin/env tsx
/**
 * Fixture generator for the HDR passthrough parity harness.
 *
 * Writes, under `--out` (default `$TMPDIR/hf-hdr-passthrough/`):
 *
 *   assets/<transfer>-<duration>s.mp4   10-bit HEVC HLG (or PQ) / BT.2020 source clip + AAC audio
 *   captions/                           full-bleed HDR video on track 0, N caption cues on track 1
 *   captions-offset/                    the captions fixture on a remux whose streams start 0.2 s in
 *   transformed/                        negative fixture: same, but the video carries a CSS transform
 *   ineligible-<case>/                  with `--ineligible`: one negative fixture per fallback class
 *   edge-<case>/                        with `--edge`: frame-rate, size, duration and seek edge cases
 *
 * Each composition directory is a HyperFrames project (`index.html` +
 * `hyperframes.json`) that `hyperframes render <dir>` accepts. Media is
 * hard-linked into each project so the render never reads outside it.
 *
 * Usage (from packages/producer):
 *   ../../node_modules/.bin/tsx src/hdr-passthrough-harness/fixture.ts                  # 20 s, 10 cues
 *   ../../node_modules/.bin/tsx src/hdr-passthrough-harness/fixture.ts --duration 180 --out /tmp/hdrpt-bench
 *   ../../node_modules/.bin/tsx src/hdr-passthrough-harness/fixture.ts --transfer pq --out /tmp/hdrpt-pq
 *   ../../node_modules/.bin/tsx src/hdr-passthrough-harness/fixture.ts --duration 3 --ineligible --out /tmp/hdrpt-neg
 *   ../../node_modules/.bin/tsx src/hdr-passthrough-harness/fixture.ts --duration 3 --edge --out /tmp/hdrpt-edge
 *
 * Nothing it writes is meant to be committed; the 3 min variant is ~150 MB.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, linkSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const FIXTURE_WIDTH = 1920;
const FIXTURE_HEIGHT = 1080;
export const FIXTURE_FPS = 30;
const DEFAULT_DURATION_SEC = 20;

export type FixtureTransfer = "hlg" | "pq";

/** ffmpeg / x265 names of each transfer function. */
const TRANSFER_TAGS: Record<FixtureTransfer, string> = {
  hlg: "arib-std-b67",
  pq: "smpte2084",
};

/**
 * Static HDR10 metadata for the PQ source: BT.2020 primaries and D65 in
 * x265's 0.00002 units, a 1000 nit / 0.0001 nit mastering display, and
 * MaxCLL / MaxFALL of 1000 / 400 nits.
 */
const PQ_STATIC_METADATA =
  "master-display=G(8500,39850)B(6550,2300)R(35400,14600)WP(15635,16450)L(10000000,1):max-cll=1000,400";

export function isFixtureTransfer(value: string): value is FixtureTransfer {
  return value === "hlg" || value === "pq";
}

export interface SourceClipOptions {
  outputPath: string;
  durationSec: number;
  width: number;
  height: number;
  /** Frame rate as ffmpeg takes it: `30` or `30000/1001`. */
  fps: number | string;
  /** libx265 CRF for the source. Low, so the source itself is near-lossless. */
  crf: number;
  /** Transfer function the clip is tagged with. Defaults to HLG. */
  transfer?: FixtureTransfer;
  /** Fixed keyframe interval in frames (no scene-cut keyframes); x265's default when unset. */
  gop?: number;
}

/**
 * ffmpeg arguments for the HLG source: a moving colour gradient (smooth
 * ramps, where 10-bit vs 8-bit handling shows) with `testsrc2` (motion,
 * hard edges, a frame counter) inset in the middle, and a 440 Hz tone.
 * The pixels are generated in signal space and tagged BT.2020 plus ARIB
 * STD-B67 (HLG) or SMPTE ST 2084 (PQ, with static HDR10 metadata) at both
 * the container and the HEVC VUI level, so the producer's HDR probe
 * classifies it exactly like a camera clip of that transfer.
 */
export function buildSourceClipArgs(options: SourceClipOptions): string[] {
  const { width, height, fps, durationSec, crf } = options;
  const transfer = options.transfer ?? "hlg";
  const trc = TRANSFER_TAGS[transfer];
  const x265Params = [
    `colorprim=bt2020:transfer=${trc}:colormatrix=bt2020nc:range=limited`,
    ...(transfer === "pq" ? [PQ_STATIC_METADATA] : []),
    ...(options.gop === undefined
      ? []
      : [`keyint=${options.gop}:min-keyint=${options.gop}:scenecut=0`]),
    "log-level=error",
  ].join(":");
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
    x265Params,
    "-color_primaries",
    "bt2020",
    "-color_trc",
    trc,
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

/**
 * Seconds the `captions-offset` source's streams start into the file. Under
 * the 1 s at which the layered path hides the video before its first frame,
 * so the passthrough must hold the first frame for the lead, as layered does.
 */
export const STREAM_OFFSET_SECONDS = 0.2;

/**
 * ffmpeg arguments that remux `inputPath` (no re-encode) with every stream's
 * timestamps shifted `offsetSec` later: the file a camera or a transport
 * stream remux without an edit list gives, whose first frame is not at 0.
 */
export function buildStreamOffsetArgs(
  inputPath: string,
  outputPath: string,
  offsetSec: number,
): string[] {
  return [
    "-hide_banner",
    "-v",
    "error",
    "-y",
    "-i",
    inputPath,
    "-map",
    "0",
    "-c",
    "copy",
    "-output_ts_offset",
    String(offsetSec),
    outputPath,
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
  /** Inline style on the video; set only for negative fixtures. */
  videoStyle?: string;
  /** Seconds into the source the video starts (`data-media-start`). Defaults to 0. */
  mediaStart?: number;
  /** When set, the video sits in a full-canvas `<div>` with this inline style. */
  videoWrapperStyle?: string;
  /** Raw markup appended to `<head>` (styles or scripts a negative fixture needs). */
  headHtml?: string;
  /** Raw markup on track 2, after the captions (extra overlay content). */
  overlayHtml?: string;
  /**
   * Body of a GSAP timeline script: `tl` is a paused timeline registered as
   * the composition's timeline, and `assets/gsap.min.js` is loaded. Without
   * it the composition has no timeline (`data-no-timeline`).
   */
  timelineScript?: string;
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
  const { compositionId, videoSrc, durationSec, width, height, cues, timelineScript } = options;
  const videoStyle = options.videoStyle ? ` style="${escapeHtml(options.videoStyle)}"` : "";
  const captions = cues
    .map(
      (cue) =>
        `      <div id="${cue.id}" class="clip caption" data-start="${cue.startSec}" data-duration="${cue.durationSec}" data-track-index="1"><span>${escapeHtml(cue.text)}</span></div>`,
    )
    .join("\n");
  const headExtra = [
    timelineScript === undefined ? "" : `    <script src="assets/gsap.min.js"></script>\n`,
    options.headHtml === undefined ? "" : `    ${options.headHtml}\n`,
  ].join("");
  const video = `<video
        id="hdr-source"
        class="clip"
        src="${escapeHtml(videoSrc)}"
        data-start="0"
        data-duration="${durationSec}"
        data-media-start="${options.mediaStart ?? 0}"
        data-track-index="0"
        data-has-audio="true"
        playsinline${videoStyle}
      ></video>`;
  const videoBlock =
    options.videoWrapperStyle === undefined
      ? video
      : `<div id="hdr-frame" style="${escapeHtml(options.videoWrapperStyle)}">\n      ${video}\n      </div>`;
  const overlay =
    options.overlayHtml === undefined
      ? ""
      : `      <div id="extra-overlay" class="clip" data-start="0" data-duration="${durationSec}" data-track-index="2">${options.overlayHtml}</div>\n`;
  const noTimeline = timelineScript === undefined ? "\n      data-no-timeline" : "";
  const timeline =
    timelineScript === undefined
      ? ""
      : `    <script>
      const tl = gsap.timeline({ paused: true });
      ${timelineScript}
      window.__timelines = window.__timelines || {};
      window.__timelines[${JSON.stringify(compositionId)}] = tl;
    </script>
`;
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
${headExtra}  </head>
  <body>
    <div
      id="root"
      data-composition-id="${escapeHtml(compositionId)}"
      data-start="0"
      data-duration="${durationSec}"
      data-width="${width}"
      data-height="${height}"${noTimeline}
    >
      ${videoBlock}
${captions}
${overlay}    </div>
${timeline}  </body>
</html>
`;
}

/** Animated image formats the negative fixtures embed, by file extension. */
export type AnimatedImageFormat = "gif" | "webp" | "apng" | "avif";

const ANIMATED_IMAGE_FILES: Record<AnimatedImageFormat, string> = {
  gif: "animated.gif",
  webp: "animated.webp",
  apng: "animated.png",
  avif: "animated.avif",
};

/**
 * ffmpeg arguments for a small 2 s, 10 fps looping animated image: the
 * negative fixtures need an image that animates on the browser's own clock.
 */
export function buildAnimatedImageArgs(format: AnimatedImageFormat, outputPath: string): string[] {
  const codec: Record<AnimatedImageFormat, string[]> = {
    gif: ["-c:v", "gif", "-loop", "0"],
    webp: ["-c:v", "libwebp_anim", "-loop", "0", "-lossless", "1"],
    apng: ["-c:v", "apng", "-plays", "0", "-f", "apng"],
    avif: ["-c:v", "libaom-av1", "-cpu-used", "8", "-still-picture", "0", "-f", "avif"],
  };
  return [
    "-hide_banner",
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=128x128:rate=10:duration=2",
    ...(format === "avif" ? ["-pix_fmt", "yuv420p"] : format === "gif" ? [] : ["-pix_fmt", "rgba"]),
    ...codec[format],
    outputPath,
  ];
}

/** Extra project content a negative fixture needs beyond its composition options. */
type NegativeAsset = "gsap" | AnimatedImageFormat;

/** One class of composition the passthrough must decline, and the reason it must log. */
export interface IneligibleCase {
  name: string;
  /** `PassthroughIneligibleReason` the flag-on render must log. */
  reason: string;
  /** Overrides on the `captions` composition; `cues: []` drops the captions. */
  composition: Pick<
    CompositionOptions,
    "videoStyle" | "videoWrapperStyle" | "headHtml" | "overlayHtml" | "timelineScript"
  > &
    Partial<Pick<CompositionOptions, "cues">>;
  assets?: readonly NegativeAsset[];
}

const BADGE_STYLE = "position:absolute;top:48px;right:48px;width:128px;height:128px";

function imageBadge(format: AnimatedImageFormat): string {
  return `<img src="assets/${ANIMATED_IMAGE_FILES[format]}" alt="" style="${BADGE_STYLE}" />`;
}

/**
 * One negative fixture per class the passthrough cannot reproduce: each
 * changes one thing about the `captions` fixture. The video-geometry cases
 * fail the layout gates; the animation cases have overlay pixels that change
 * on a clock the planner cannot see (or on every frame).
 */
export const INELIGIBLE_CASES: readonly IneligibleCase[] = [
  {
    // The layout probe wants the video's box to be exactly the canvas, so an
    // enlarged video fails coverage before the transform gate looks at it.
    name: "video-scaled",
    reason: "not_full_canvas",
    composition: { videoStyle: "transform: scale(1.1)" },
  },
  {
    // A mirror keeps the box on the canvas, so the transform gate catches it.
    name: "video-mirrored",
    reason: "transform_or_filter",
    composition: { videoStyle: "transform: scaleX(-1)" },
  },
  {
    name: "video-filter",
    reason: "transform_or_filter",
    composition: { videoStyle: "filter: saturate(1.4)" },
  },
  {
    name: "rounded-video",
    reason: "clip_or_mask",
    composition: { videoStyle: "border-radius: 48px" },
  },
  {
    name: "rounded-ancestor",
    reason: "clip_or_mask",
    composition: {
      videoWrapperStyle: "position:absolute;inset:0;overflow:hidden;border-radius:48px",
    },
  },
  {
    name: "css-animation",
    reason: "overlay_non_gsap_animation",
    composition: {
      headHtml:
        "<style>@keyframes hf-pulse { from { opacity: 1 } to { opacity: 0.2 } } .pulse { animation: hf-pulse 0.5s infinite alternate; }</style>",
      overlayHtml: `<div class="pulse" style="${BADGE_STYLE};background:#e33"></div>`,
    },
  },
  {
    name: "gsap-continuous",
    reason: "overlay_continuous_animation",
    composition: {
      overlayHtml: `<div id="spinner" style="${BADGE_STYLE};background:#3a6"></div>`,
      timelineScript: 'tl.to("#spinner", { rotation: 360, duration: 2, ease: "none" }, 0);',
    },
    assets: ["gsap"],
  },
  {
    name: "lottie-player",
    reason: "overlay_non_gsap_animation",
    composition: { overlayHtml: `<dotlottie-player style="${BADGE_STYLE}"></dotlottie-player>` },
  },
  {
    name: "three",
    reason: "overlay_non_gsap_animation",
    composition: { headHtml: '<script>window.THREE = { REVISION: "fixture" };</script>' },
  },
  {
    name: "webgpu",
    reason: "overlay_non_gsap_animation",
    composition: { overlayHtml: `<div data-requires-webgpu style="${BADGE_STYLE}"></div>` },
  },
  {
    name: "svg-smil",
    reason: "overlay_non_gsap_animation",
    composition: {
      overlayHtml: `<svg viewBox="0 0 10 10" style="${BADGE_STYLE}"><circle cx="5" cy="5" r="4" fill="#fc0"><animate attributeName="r" values="1;4;1" dur="1s" repeatCount="indefinite" /></circle></svg>`,
    },
  },
  {
    // The runtime dispatches `hf-seek` on window on every seek; a listener can
    // rewrite the overlay on any frame, which no static walk sees.
    name: "hf-seek-listener",
    reason: "overlay_non_gsap_animation",
    composition: {
      headHtml: `<script>window.addEventListener("hf-seek", (e) => { const el = document.getElementById("seek-counter"); if (el) el.textContent = "t=" + Math.floor(e.detail.time * 4) / 4; });</script>`,
      overlayHtml: `<div id="seek-counter" style="${BADGE_STYLE};color:#fff;font:700 40px sans-serif">t=0</div>`,
    },
  },
  {
    // A seek-driven write with no listener at all: a setter on the seek-time
    // global the WebGPU adapter assigns on every seek. Only the capture's
    // verification probes can see it.
    name: "seek-time-setter",
    reason: "overlay_unverified",
    composition: {
      headHtml: `<script>(() => { let time; Object.defineProperty(window, "__hfTypegpuTime", { configurable: true, get: () => time, set(t) { time = t; const el = document.getElementById("seek-counter"); if (el) el.textContent = "t=" + Math.floor(t * 4) / 4; } }); })();</script>`,
      overlayHtml: `<div id="seek-counter" style="${BADGE_STYLE};color:#fff;font:700 40px sans-serif">t=0</div>`,
    },
  },
  // A three-frame flash (frames 50-52 at 30 fps) with no caption cues, so the
  // whole composition is one candidate state and the flash sits far from its
  // ends and capture frame. Only a probe of every frame sees it.
  {
    // A raw requestAnimationFrame loop: rAF runs on virtual time on every seek.
    name: "flash-raf",
    reason: "overlay_unverified",
    composition: {
      cues: [],
      headHtml: `<script>requestAnimationFrame(function loop(now) { const el = document.getElementById("seek-counter"); if (el) el.textContent = (now >= 1650 && now < 1750) ? "FLASH" : ""; requestAnimationFrame(loop); });</script>`,
      overlayHtml: `<div id="seek-counter" style="${BADGE_STYLE};color:#fff;font:700 40px sans-serif"></div>`,
    },
  },
  {
    name: "flash-setter",
    reason: "overlay_unverified",
    composition: {
      cues: [],
      headHtml: `<script>(() => { let time; Object.defineProperty(window, "__hfTypegpuTime", { configurable: true, get: () => time, set(t) { time = t; const el = document.getElementById("seek-counter"); if (el) el.textContent = (t >= 1.65 && t < 1.75) ? "FLASH" : ""; } }); })();</script>`,
      overlayHtml: `<div id="seek-counter" style="${BADGE_STYLE};color:#fff;font:700 40px sans-serif"></div>`,
    },
  },
  {
    name: "canvas",
    reason: "canvas",
    composition: {
      overlayHtml: `<canvas width="128" height="128" style="${BADGE_STYLE}"></canvas>`,
    },
  },
  ...(["gif", "webp", "apng", "avif"] as const).map(
    (format): IneligibleCase => ({
      name: `animated-${format}`,
      // The compiler turns an animated GIF into a video, so a GIF overlay
      // makes a second video; the other formats stay images and are sniffed.
      reason: format === "gif" ? "video_count" : "overlay_non_gsap_animation",
      composition: { overlayHtml: imageBadge(format) },
      assets: [format],
    }),
  ),
];

/**
 * One composition that varies what the `captions` fixture holds fixed: the
 * source's rate, size or keyframe interval, the composition's rate, canvas
 * size, duration or `mediaStart`. Each must either decode to the same frames
 * as the layered render or fall back with `expectReason`.
 */
export interface EdgeCase {
  name: string;
  source: {
    width: number;
    height: number;
    /** ffmpeg rate: `30`, `30000/1001`, `24000/1001`. */
    fps: string;
    durationSec: number;
    /** Fixed keyframe interval in frames. */
    gop?: number;
  };
  canvas: { width: number; height: number };
  /** Composition rate as the CLI takes it. */
  fps: string;
  durationSec: number;
  mediaStart?: number;
  expect: "passthrough" | "fallback";
  expectReason?: string;
}

const FULL_HD = { width: FIXTURE_WIDTH, height: FIXTURE_HEIGHT };

export const EDGE_CASES: readonly EdgeCase[] = [
  {
    // NTSC source on an integer grid: some output frames repeat a source frame.
    name: "src2997-comp30",
    source: { ...FULL_HD, fps: "30000/1001", durationSec: 6 },
    canvas: FULL_HD,
    fps: "30",
    durationSec: 5,
    expect: "passthrough",
  },
  {
    name: "src2997-comp2997",
    source: { ...FULL_HD, fps: "30000/1001", durationSec: 6 },
    canvas: FULL_HD,
    fps: "30000/1001",
    durationSec: 5,
    expect: "passthrough",
  },
  {
    name: "src23976-comp30",
    source: { ...FULL_HD, fps: "24000/1001", durationSec: 6 },
    canvas: FULL_HD,
    fps: "30",
    durationSec: 5,
    expect: "passthrough",
  },
  {
    // A 4:2:0 source cannot be odd-sized; 1280x720 is within the aspect
    // tolerance of 1279x719, so the video is scaled onto the canvas.
    name: "odd-canvas",
    source: { width: 1280, height: 720, fps: "30", durationSec: 6 },
    canvas: { width: 1279, height: 719 },
    fps: "30",
    durationSec: 5,
    expect: "passthrough",
  },
  {
    // 4:3 under object-fit: cover on a 16:9 canvas crops the source.
    name: "cover-4x3",
    source: { width: 1440, height: 1080, fps: "30", durationSec: 6 },
    canvas: FULL_HD,
    fps: "30",
    durationSec: 5,
    expect: "fallback",
    expectReason: "object_fit",
  },
  {
    // 210.3 frames: the render writes 211, the last one only partly inside the duration.
    name: "fractional-duration",
    source: { ...FULL_HD, fps: "30", durationSec: 8 },
    canvas: FULL_HD,
    fps: "30",
    durationSec: 7.01,
    expect: "passthrough",
  },
  {
    // A seek between frames, 13 s past the only earlier keyframe.
    name: "deep-seek-long-gop",
    source: { ...FULL_HD, fps: "30", durationSec: 20, gop: 300 },
    canvas: FULL_HD,
    fps: "30",
    durationSec: 5,
    mediaStart: 13.37,
    expect: "passthrough",
  },
];

/** Asset file name of an edge case's source, shared by cases with the same source. */
export function edgeSourceName(transfer: FixtureTransfer, source: EdgeCase["source"]): string {
  const rate = source.fps.replace("/", "-");
  const gop = source.gop === undefined ? "" : `-g${source.gop}`;
  return `${transfer}-${source.width}x${source.height}-${rate}fps-${source.durationSec}s${gop}.mp4`;
}

/** Frame rate value of a CLI / ffmpeg rate string (`30`, `30000/1001`). */
function rateValue(rate: string): number {
  const [num, den = "1"] = rate.split("/");
  return Number(num) / Number(den);
}

/** Reason the `transformed` fixture must report (the layout probe runs before the transform gate). */
const TRANSFORMED_REASON = "not_full_canvas";

interface FixtureProject {
  name: string;
  /** What the flag-on render is expected to do. */
  expect: "passthrough" | "fallback";
  /** For `fallback`: the reason the flag-on render must log. */
  expectReason?: string;
  dir: string;
  /** The project's own render rate and duration, when they differ from the manifest's. */
  fps?: number | string;
  durationSec?: number;
}

interface GeneratedFixtures {
  sourcePath: string;
  durationSec: number;
  fps: number;
  transfer: FixtureTransfer;
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

interface ProjectSpec {
  root: string;
  name: string;
  sourcePath: string;
  assetName: string;
  html: string;
  fps: number | string;
  /** Canvas size written to `hyperframes.json`; the fixture's 1920x1080 when unset. */
  width?: number;
  height?: number;
  /** Files copied (or linked) into the project's `assets/`, by target name. */
  extraAssets?: ReadonlyArray<{ source: string; name: string }>;
}

function writeProject(spec: ProjectSpec): string {
  const dir = join(spec.root, spec.name);
  mkdirSync(join(dir, "assets"), { recursive: true });
  linkOrCopy(spec.sourcePath, join(dir, "assets", spec.assetName));
  for (const asset of spec.extraAssets ?? []) {
    linkOrCopy(asset.source, join(dir, "assets", asset.name));
  }
  writeFileSync(join(dir, "index.html"), spec.html);
  writeFileSync(
    join(dir, "hyperframes.json"),
    `${JSON.stringify({ name: spec.name, fps: spec.fps, width: spec.width ?? FIXTURE_WIDTH, height: spec.height ?? FIXTURE_HEIGHT }, null, 2)}\n`,
  );
  return dir;
}

interface GenerateOptions {
  outDir: string;
  durationSec: number;
  cueCount: number;
  transfer: FixtureTransfer;
  ineligible: boolean;
  edge: boolean;
  ffmpegPath: string;
  force: boolean;
}

function runFfmpegOrThrow(ffmpegPath: string, args: string[], what: string): void {
  const result = spawnSync(ffmpegPath, args, { stdio: ["ignore", "inherit", "inherit"] });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed generating ${what} (exit ${result.status ?? "signal"})`);
  }
}

/** Source path of each negative-fixture asset, generating the animated images once. */
function negativeAssetSources(
  outDir: string,
  ffmpegPath: string,
): Record<NegativeAsset, { source: string; name: string }> {
  const require = createRequire(import.meta.url);
  const gsapPath = require.resolve("gsap/dist/gsap.min.js", {
    paths: [resolve(fileURLToPath(new URL("../../../core", import.meta.url)))],
  });
  const images = {} as Record<AnimatedImageFormat, { source: string; name: string }>;
  for (const format of ["gif", "webp", "apng", "avif"] as const) {
    const name = ANIMATED_IMAGE_FILES[format];
    const source = join(outDir, "assets", name);
    if (!existsSync(source) || statSync(source).size === 0) {
      runFfmpegOrThrow(ffmpegPath, buildAnimatedImageArgs(format, source), source);
    }
    images[format] = { source, name };
  }
  return { gsap: { source: gsapPath, name: "gsap.min.js" }, ...images };
}

/** Run ffmpeg to write `path` unless it already exists (non-empty) and `--force` is off. */
function ensureGenerated(
  options: Pick<GenerateOptions, "ffmpegPath" | "force">,
  path: string,
  args: () => string[],
): void {
  if (!options.force && existsSync(path) && statSync(path).size > 0) {
    console.log(`asset: ${path} (reused)`);
    return;
  }
  const started = Date.now();
  runFfmpegOrThrow(options.ffmpegPath, args(), path);
  console.log(`asset: ${path} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

function generateEdgeFixtures(options: GenerateOptions): FixtureProject[] {
  const { outDir, transfer } = options;
  return EDGE_CASES.map((edge) => {
    const assetName = edgeSourceName(transfer, edge.source);
    const sourcePath = join(outDir, "assets", assetName);
    ensureGenerated(options, sourcePath, () =>
      buildSourceClipArgs({
        outputPath: sourcePath,
        ...edge.source,
        crf: 12,
        transfer,
      }),
    );
    const fps = rateValue(edge.fps);
    const name = `edge-${edge.name}`;
    const cues = buildCaptionCues(
      edge.durationSec,
      Math.max(2, Math.round(edge.durationSec / 2)),
      fps,
    );
    const dir = writeProject({
      root: outDir,
      name,
      sourcePath,
      assetName,
      fps: edge.fps,
      width: edge.canvas.width,
      height: edge.canvas.height,
      html: buildCompositionHtml({
        compositionId: `hdr-passthrough-${name}`,
        videoSrc: `assets/${assetName}`,
        durationSec: edge.durationSec,
        width: edge.canvas.width,
        height: edge.canvas.height,
        cues,
        mediaStart: edge.mediaStart,
      }),
    });
    return {
      name,
      expect: edge.expect,
      ...(edge.expectReason === undefined ? {} : { expectReason: edge.expectReason }),
      dir,
      fps: edge.fps,
      durationSec: edge.durationSec,
    };
  });
}

function generateFixtures(options: GenerateOptions): GeneratedFixtures {
  const { outDir, durationSec, cueCount, transfer, ffmpegPath } = options;
  const fps = FIXTURE_FPS;
  mkdirSync(join(outDir, "assets"), { recursive: true });
  const sourcePath = join(outDir, "assets", `${transfer}-${durationSec}s.mp4`);
  ensureGenerated(options, sourcePath, () =>
    buildSourceClipArgs({
      outputPath: sourcePath,
      durationSec,
      width: FIXTURE_WIDTH,
      height: FIXTURE_HEIGHT,
      fps,
      crf: 12,
      transfer,
    }),
  );
  const offsetSourcePath = join(outDir, "assets", `${transfer}-${durationSec}s-offset.mp4`);
  ensureGenerated(options, offsetSourcePath, () =>
    buildStreamOffsetArgs(sourcePath, offsetSourcePath, STREAM_OFFSET_SECONDS),
  );

  const cues = buildCaptionCues(durationSec, cueCount, fps);
  const assetName = `${transfer}-source.mp4`;
  const base = {
    videoSrc: `assets/${assetName}`,
    durationSec,
    width: FIXTURE_WIDTH,
    height: FIXTURE_HEIGHT,
    cues,
  };
  const project = { root: outDir, sourcePath, assetName, fps };
  const projects: FixtureProject[] = [
    {
      name: "captions",
      expect: "passthrough",
      dir: writeProject({
        ...project,
        name: "captions",
        html: buildCompositionHtml({ ...base, compositionId: "hdr-passthrough-captions" }),
      }),
    },
    {
      name: "captions-offset",
      expect: "passthrough",
      dir: writeProject({
        ...project,
        sourcePath: offsetSourcePath,
        name: "captions-offset",
        html: buildCompositionHtml({ ...base, compositionId: "hdr-passthrough-captions-offset" }),
      }),
    },
    {
      name: "transformed",
      expect: "fallback",
      expectReason: TRANSFORMED_REASON,
      dir: writeProject({
        ...project,
        name: "transformed",
        html: buildCompositionHtml({
          ...base,
          compositionId: "hdr-passthrough-transformed",
          videoStyle: "transform: scale(0.9) rotate(1.5deg)",
        }),
      }),
    },
  ];
  if (options.ineligible) {
    const assets = negativeAssetSources(outDir, ffmpegPath);
    for (const negative of INELIGIBLE_CASES) {
      const name = `ineligible-${negative.name}`;
      projects.push({
        name,
        expect: "fallback",
        expectReason: negative.reason,
        dir: writeProject({
          ...project,
          name,
          html: buildCompositionHtml({
            ...base,
            ...negative.composition,
            compositionId: `hdr-passthrough-${name}`,
          }),
          extraAssets: (negative.assets ?? []).map((asset) => assets[asset]),
        }),
      });
    }
  }
  if (options.edge) projects.push(...generateEdgeFixtures(options));
  const manifest: GeneratedFixtures = { sourcePath, durationSec, fps, transfer, projects };
  writeFileSync(join(outDir, "fixtures.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      out: { type: "string", default: join(tmpdir(), "hf-hdr-passthrough") },
      duration: { type: "string", default: String(DEFAULT_DURATION_SEC) },
      cues: { type: "string" },
      transfer: { type: "string", default: "hlg" },
      ineligible: { type: "boolean", default: false },
      edge: { type: "boolean", default: false },
      ffmpeg: { type: "string", default: process.env.FFMPEG_PATH ?? "ffmpeg" },
      force: { type: "boolean", default: false },
    },
  });
  const durationSec = Number(values.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 1) {
    throw new Error(`--duration must be a number > 1, got ${values.duration}`);
  }
  const transfer = values.transfer;
  if (!isFixtureTransfer(transfer)) throw new Error(`--transfer must be hlg|pq, got ${transfer}`);
  // ~1 cue per 2 s: 10 cues for the 20 s fixture, 90 for the 3 min one.
  const cueCount = values.cues ? Number(values.cues) : Math.max(1, Math.round(durationSec / 2));
  const manifest = generateFixtures({
    outDir: resolve(values.out),
    durationSec,
    cueCount,
    transfer,
    ineligible: values.ineligible,
    edge: values.edge,
    ffmpegPath: values.ffmpeg,
    force: values.force,
  });
  for (const project of manifest.projects) {
    const expectation = project.expectReason
      ? `${project.expect} (${project.expectReason})`
      : project.expect;
    console.log(`${project.name.padEnd(28)} ${project.dir} (flag on: expect ${expectation})`);
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) main();
