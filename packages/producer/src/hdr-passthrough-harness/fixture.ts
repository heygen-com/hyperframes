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
type NegativeAsset =
  | "gsap"
  | "fake-gsap"
  | "tone"
  | "sdr-video"
  | "paint-worklet"
  | AnimatedImageFormat;

/** ffmpeg arguments for a 3 s mono sine tone: the audio an `<audio controls>` fixture plays. */
function buildToneArgs(outputPath: string): string[] {
  return [
    "-hide_banner",
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3",
    "-c:a",
    "aac",
    outputPath,
  ];
}

/** ffmpeg arguments for a small 3 s SDR H.264 clip: a second, self-playing video. */
function buildSdrVideoArgs(outputPath: string): string[] {
  return [
    "-hide_banner",
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=30:duration=3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ];
}

/** A CSS Paint worklet that keeps a paint count: page code that runs on every paint. */
const PAINT_WORKLET = `let paints = 0;
registerPaint("hf-counter", class { paint(ctx, size) { paints++; ctx.fillStyle = paints % 2 ? "#e33" : "#3a6"; ctx.fillRect(0, 0, size.width, size.height); } });
`;
const PAINT_WORKLET_FILE = "paint-counter.js";

/**
 * A highlight setter on the seek-time global, as script text: page code a
 * seek runs that keeps state across seeks. The highlight goes on the first
 * time a seek reaches 1 s and stays on, so the layered render lights it at
 * frame 30, while every capture probe after eligibility's first seek past
 * 1 s sees it lit and fingerprints the same (the fingerprint reads
 * highlights): only the record of page code that ran declines it.
 */
const HIGHLIGHT_SETTER = `(() => { let time; const apply = (on) => { if (!on) return CSS.highlights.delete("hf"); const range = new Range(); range.selectNodeContents(document.getElementById("hl")); CSS.highlights.set("hf", new Highlight(range)); }; Object.defineProperty(window, "__hfTypegpuTime", { configurable: true, get: () => time, set(t) { time = t; if (t >= 1) apply(true); } }); })();`;
const HIGHLIGHT_STYLE = "<style>::highlight(hf) { background-color: #f00; color: #ff0; }</style>";

/** The fake GSAP file: page code under a GSAP distribution file name. */
export const FAKE_GSAP_FILE = "gsap-core.js";

/**
 * The reasons a sticky seek-time setter declines with. It lights the
 * highlight on the first seek past 1 s that runs it: when capture's probes
 * see it go on, the verification probes decline (`overlay_unverified`);
 * when it was already on for every probe, the page code watch does
 * (`seek_callback`). Which one depends on the order the seeks took.
 */
const STICKY_SETTER_REASONS = "seek_callback|overlay_unverified";

/** `HIGHLIGHT_SETTER` compiled by the page some other way than as its own inline script. */
function highlightSetterCase(name: string, script: string): IneligibleCase {
  return {
    name,
    reason: STICKY_SETTER_REASONS,
    composition: {
      cues: [],
      headHtml: `${HIGHLIGHT_STYLE}${script}`,
      overlayHtml: `<div id="hl" style="${BADGE_STYLE};width:auto;color:#fff;font:700 40px sans-serif">HIGHLIGHT</div>`,
    },
  };
}

/** A popover the native-callback cases open; red, top left. */
const POPOVER_STYLE =
  "<style>[popover] { position: absolute; inset: auto; top: 48px; left: 48px; margin: 0; padding: 0 24px; border: 0; background: #e33; color: #fff; font: 700 40px sans-serif; }</style>";
const POPOVER_HTML = '<div id="pop" popover="manual">POPOVER</div>';
const POPOVER_TRIGGER =
  '<div id="trig" style="position:absolute;top:900px;left:48px;color:#fff;font:700 40px sans-serif">T</div>';
/** A builtin that opens the popover, bound so it takes no page code to call. */
const SHOW_POPOVER =
  'Reflect.apply.bind(null, HTMLElement.prototype.showPopover, document.getElementById("pop"), [])';

/**
 * A popover opened by a builtin the page hands to the browser or to GSAP, with
 * no page function on the stack: V8's call counts never see it, the popover
 * stays open on every later probe, and the layered path opens it only at
 * 1.5 s. `script` runs after the overlay is in the page, with `tl` in scope.
 */
function nativePopoverCase(
  name: string,
  script: string,
  overlayHtml = POPOVER_TRIGGER,
): IneligibleCase {
  return {
    name,
    reason: "seek_callback",
    composition: {
      cues: [],
      headHtml: POPOVER_STYLE,
      overlayHtml: `${overlayHtml}${POPOVER_HTML}`,
      timelineScript: script,
    },
    assets: ["gsap"],
  };
}

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
  /**
   * The case paints on the wall clock, so its layered render is not repeatable
   * (two flag-off renders share no frame): the parity harness checks only the
   * fallback and its reason, not the pixels.
   */
  wallClock?: true;
  /**
   * The passthrough must take this composition and match the layered render:
   * the page reads back what an in-page record would have changed (the
   * observer constructors' source text), so it checks that nothing the
   * passthrough does is visible to the page.
   */
  takesPassthrough?: true;
}

const BADGE_STYLE = "position:absolute;top:48px;right:48px;width:128px;height:128px";

/** A badge GSAP fades in and recolours, as in `captions-gsap`. */
const GSAP_BADGE: Pick<CompositionOptions, "overlayHtml" | "timelineScript"> = {
  overlayHtml: `<div id="badge" style="position:absolute;top:48px;left:900px;width:128px;height:128px;background:#36f"></div>`,
  timelineScript: [
    'tl.from("#badge", { left: 200, opacity: 0, duration: 0.3, immediateRender: false }, 1);',
    'tl.set("#badge", { backgroundColor: "#f63" }, 2);',
  ].join("\n      "),
};

/**
 * A `javascript:` URL running `code`, named like a DevTools evaluation: it
 * compiles with nothing on the stack and no embedding document, as the
 * renderer's own evaluations do, so only its text tells it apart.
 */
function javascriptUrl(code: string): string {
  return `javascript:${encodeURIComponent(`${code} void 0;\n//# sourceURL=pptr:evaluate`)}`;
}

/**
 * The builtins an in-page fingerprint collector calls, replaced with
 * builtins that return a constant: every probe would hash the same.
 */
function fingerprintBuiltinCase(name: string, swap: string): IneligibleCase {
  return {
    name,
    reason: "seek_callback",
    composition: { headHtml: `<script>${swap}</script>`, ...GSAP_BADGE },
    assets: ["gsap"],
  };
}

/** Text the page paints, read from what the renderer could have changed in it. */
const TEXT_STYLE = "position:absolute;top:48px;left:48px;color:#fff;font:700 28px sans-serif";

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
    composition: {
      overlayHtml: `<dotlottie-player style="${BADGE_STYLE}"></dotlottie-player>`,
    },
  },
  {
    name: "three",
    reason: "overlay_non_gsap_animation",
    composition: {
      headHtml: '<script>window.THREE = { REVISION: "fixture" };</script>',
    },
  },
  {
    name: "webgpu",
    reason: "overlay_non_gsap_animation",
    composition: {
      overlayHtml: `<div data-requires-webgpu style="${BADGE_STYLE}"></div>`,
    },
  },
  {
    name: "svg-smil",
    // SMIL runs on the document's own clock: two flag-off renders share no frame.
    wallClock: true,
    reason: "overlay_non_gsap_animation",
    composition: {
      overlayHtml: `<svg viewBox="0 0 10 10" style="${BADGE_STYLE}"><circle cx="5" cy="5" r="4" fill="#fc0"><animate attributeName="r" values="1;4;1" dur="1s" repeatCount="indefinite" /></circle></svg>`,
    },
  },
  {
    // A CSS animation inside an open shadow root: `document.getAnimations()` does not list it, so
    // the runtime never seeks it and it plays on the wall clock, flag on or off.
    name: "shadow-css-animation",
    // The runtime never seeks an animation in a shadow root: it plays on the wall clock.
    wallClock: true,
    reason: "overlay_non_gsap_animation",
    composition: {
      overlayHtml: `<div id="shadow-host" style="${BADGE_STYLE}"></div><script>document.getElementById("shadow-host").attachShadow({ mode: "open" }).innerHTML = "<style>@keyframes hf-pulse { from { opacity: 1 } to { opacity: 0.2 } } div { width: 128px; height: 128px; background: #e33; animation: hf-pulse 0.5s infinite alternate; }</style><div></div>";</script>`,
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
    // Eligibility declines any animation-frame callback of the page's own
    // (`seek_callback`) before capture's probes would see the flash.
    name: "flash-raf",
    reason: "seek_callback",
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
  // Drivers whose output depends on the order or number of seeks, not on the
  // time alone. The layered path seeks every frame once, in order; the
  // passthrough probes frames out of order and more than once, so the state
  // such a driver keeps differs between the two.
  {
    // One more on every requestAnimationFrame callback, i.e. on every seek.
    name: "raf-counter",
    reason: "seek_callback",
    composition: {
      cues: [],
      headHtml: `<script>let n = 0; requestAnimationFrame(function loop() { n++; const el = document.getElementById("seek-counter"); if (el) el.textContent = "n=" + n; requestAnimationFrame(loop); });</script>`,
      overlayHtml: `<div id="seek-counter" style="${BADGE_STYLE};color:#fff;font:700 40px sans-serif"></div>`,
    },
  },
  {
    // The same counter, shown only for its first three callbacks: by the time
    // the passthrough probes, it never changes again.
    name: "raf-warmup",
    reason: "seek_callback",
    composition: {
      cues: [],
      headHtml: `<script>let n = 0; requestAnimationFrame(function loop() { n++; const el = document.getElementById("seek-counter"); if (el) el.textContent = n <= 3 ? "WAIT" : ""; requestAnimationFrame(loop); });</script>`,
      overlayHtml: `<div id="seek-counter" style="${BADGE_STYLE};color:#fff;font:700 40px sans-serif"></div>`,
    },
  },
  {
    // A film-time interval (started from the first animation frame, as the
    // timers-on-film-time regression does) that appends a mark every 0.5 s.
    // A seek fires every timer due by then and a backward seek un-fires none.
    name: "timer-append",
    reason: "seek_callback",
    composition: {
      cues: [],
      headHtml: `<script>requestAnimationFrame(() => { setInterval(() => { const el = document.getElementById("seek-counter"); if (el) el.textContent += "#"; }, 500); });</script>`,
      overlayHtml: `<div id="seek-counter" style="${BADGE_STYLE};width:auto;color:#fff;font:700 40px sans-serif"></div>`,
    },
  },
  {
    // A GSAP .from() with lazy init (immediateRender: false) reads the box's
    // \`left\` the first time the playhead reaches it, and a seek-time setter
    // (no GSAP, no listener) writes that \`left\` too.
    name: "gsap-from-lazy",
    reason: "overlay_unverified",
    composition: {
      headHtml: `<script>(() => { let time; Object.defineProperty(window, "__hfTypegpuTime", { configurable: true, get: () => time, set(t) { time = t; const el = document.getElementById("box"); if (el) el.style.left = t < 1 ? "200px" : "900px"; } }); })();</script>`,
      overlayHtml: `<div id="box" style="position:absolute;top:48px;left:200px;width:128px;height:128px;background:#36f"></div>`,
      timelineScript:
        'tl.from("#box", { left: 0, opacity: 0, duration: 0.3, immediateRender: false }, 1.5);',
    },
    assets: ["gsap"],
  },
  // Overlay content the capture fingerprint cannot read: a tween there changes
  // pixels and no fingerprint, so frames that render differently would merge.
  {
    // A fade inside a closed shadow root (`shadowRoot` is null to page script).
    name: "closed-shadow-root",
    reason: "overlay_unreadable",
    composition: {
      overlayHtml: `<div id="host" style="${BADGE_STYLE}"></div>`,
      timelineScript:
        'const inner = (() => { const root = document.getElementById("host").attachShadow({ mode: "closed" }); root.innerHTML = \'<div id="inner" style="width:128px;height:128px;background:#36f;opacity:0"></div>\'; return root.getElementById("inner"); })(); tl.to(inner, { opacity: 1, duration: 0.3 }, 1);',
    },
    assets: ["gsap"],
  },
  {
    // A fade inside an <object>'s SVG document, which the fingerprint walk never enters. The
    // document is another realm, which declines before the DOM snapshot would.
    name: "embedded-document",
    reason: "seek_callback",
    composition: {
      overlayHtml: `<object id="host" type="image/svg+xml" data="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Crect id='r' width='128' height='128' fill='%2336f' opacity='0'/%3E%3C/svg%3E" style="${BADGE_STYLE}"></object>`,
      timelineScript:
        'const host = document.getElementById("host"); const build = () => { const r = host.contentDocument && host.contentDocument.getElementById("r"); if (r && tl.getChildren().length === 0) tl.to(r, { opacity: 1, duration: 0.3 }, 1); }; host.addEventListener("load", build); build();',
    },
    assets: ["gsap"],
  },
  {
    // A gsap.delayedCall: GSAP's global timeline fires it on the ticker's own
    // clock (the seeks so far), not at its film time, and drops it once fired.
    name: "gsap-delayed-call",
    reason: "seek_callback",
    composition: {
      overlayHtml: `<div id="badge" style="${BADGE_STYLE};background:#36f"></div>`,
      timelineScript:
        'gsap.delayedCall(1.5, () => { document.getElementById("badge").style.background = "#f63"; });',
    },
    assets: ["gsap"],
  },
  // The video's own layer changing after eligibility: a stylesheet rule that reaches the video
  // through a selector dims it while a cue is up. The cue's window (frames 42-47) falls between
  // eligibility's layout samples, and nothing tweens or animates the video itself.
  {
    // On a clip window, with no script at all.
    name: "video-dim-clip",
    reason: "video_animated",
    composition: {
      cues: [{ id: "dimcue", text: "DIM", startSec: 1.4, durationSec: 0.2 }],
      headHtml:
        '<style>#root:has(#dimcue:not([style*="hidden"])) #hdr-source { opacity: 0.3; }</style>',
    },
  },
  {
    // On a GSAP set() of another element's attribute.
    name: "video-dim-gsap",
    reason: "video_animated",
    composition: {
      cues: [],
      headHtml: '<style>#root:has(#flag[data-on="1"]) #hdr-source { opacity: 0.3; }</style>',
      overlayHtml: '<div id="flag" data-on="0"></div>',
      timelineScript:
        'tl.set("#flag", { attr: { "data-on": "1" } }, 1.4); tl.set("#flag", { attr: { "data-on": "0" } }, 1.6);',
    },
    assets: ["gsap"],
  },
  // Page code that runs on seeks and keeps what it painted across them (a custom highlight that
  // stays lit once a seek reaches 1 s). Every probe after eligibility's seeks fingerprints equal,
  // so only the record of page code that ran during capture declines it.
  // A setter on the seek-time global the WebGPU adapter assigns on every seek.
  highlightSetterCase("setter-highlight", `<script>${HIGHLIGHT_SETTER}</script>`),
  {
    // An accessor on a plain object a GSAP set() on the registered timeline writes through.
    name: "gsap-proxy-highlight",
    reason: "seek_callback",
    composition: {
      cues: [],
      headHtml: `<style>::highlight(hf) { background-color: #f00; color: #ff0; }</style><script>(() => { let on = 0; const apply = (lit) => { if (!lit) return CSS.highlights.delete("hf"); const range = new Range(); range.selectNodeContents(document.getElementById("hl")); CSS.highlights.set("hf", new Highlight(range)); }; window.highlightProxy = {}; Object.defineProperty(window.highlightProxy, "on", { get: () => on, set(v) { on = v; apply(v === 1); } }); })();</script>`,
      overlayHtml: `<div id="hl" style="${BADGE_STYLE};width:auto;color:#fff;font:700 40px sans-serif">HIGHLIGHT</div>`,
      timelineScript:
        "tl.set(window.highlightProxy, { on: 1 }, 1.0); tl.set(window.highlightProxy, { on: 0 }, 2.0);",
    },
    assets: ["gsap"],
  },
  // The same setter, compiled in each way that reports an empty script URL or a name the page
  // chose. The page code watch goes by how V8 compiled a script, never by its name.
  highlightSetterCase(
    "dynamic-inline-setter",
    `<script>{ const s = document.createElement("script"); s.textContent = ${JSON.stringify(HIGHLIGHT_SETTER)}; document.head.appendChild(s); }</script>`,
  ),
  highlightSetterCase("eval-setter", `<script>eval(${JSON.stringify(HIGHLIGHT_SETTER)});</script>`),
  highlightSetterCase(
    "new-function-setter",
    `<script>new Function(${JSON.stringify(HIGHLIGHT_SETTER)})();</script>`,
  ),
  highlightSetterCase(
    "renderer-named-setter",
    `<script>${HIGHLIGHT_SETTER}\n//# sourceURL=hyperframes://injected/0</script>`,
  ),
  highlightSetterCase(
    "devtools-named-setter",
    `<script>eval(${JSON.stringify(`${HIGHLIGHT_SETTER}\n//# sourceURL=pptr:evaluate;x`)});</script>`,
  ),
  // A string timer compiles page code with nothing on the stack, as DevTools evaluations are: its
  // text is not one the renderer sent, so it declines when it registers.
  {
    ...highlightSetterCase(
      "string-timer-setter",
      `<script>setTimeout(${JSON.stringify(`${HIGHLIGHT_SETTER}\n//# sourceURL=pptr:evaluate;x`)}, 0);</script>`,
    ),
    reason: "seek_callback",
  },
  {
    // Page code in a file named like GSAP's core build.
    ...highlightSetterCase(
      "fake-gsap-filename",
      `<script src="assets/${FAKE_GSAP_FILE}"></script>`,
    ),
    assets: ["fake-gsap"],
  },
  {
    // The accessor a GSAP set() writes through, defined in a dynamically inserted script.
    name: "dynamic-inline-gsap-proxy",
    reason: "seek_callback",
    composition: {
      cues: [],
      headHtml: `${HIGHLIGHT_STYLE}<script>{ const s = document.createElement("script"); s.textContent = ${JSON.stringify('(() => { let on = 0; const apply = (lit) => { if (!lit) return CSS.highlights.delete("hf"); const range = new Range(); range.selectNodeContents(document.getElementById("hl")); CSS.highlights.set("hf", new Highlight(range)); }; window.highlightProxy = {}; Object.defineProperty(window.highlightProxy, "on", { get: () => on, set(v) { on = v; apply(v === 1); } }); })();')}; document.head.appendChild(s); }</script>`,
      overlayHtml: `<div id="hl" style="${BADGE_STYLE};width:auto;color:#fff;font:700 40px sans-serif">HIGHLIGHT</div>`,
      timelineScript:
        "tl.set(window.highlightProxy, { on: 1 }, 1.0); tl.set(window.highlightProxy, { on: 0 }, 2.0);",
    },
    assets: ["gsap"],
  },
  {
    // A page that replaces the builtins a shim could parse stacks and keep lists with, and shows
    // how many ran while its own requestAnimationFrame / setTimeout / setInterval calls were in
    // progress, i.e. inside the shim's wrappers: zero with the shim as it is without the feature.
    // It declines on its animation-frame loop; the flag-on render's layered fallback must still
    // match the flag-off render frame for frame, so nothing the passthrough does may call them.
    // (It counts only calls inside the wrappers: a fallback render seeks its page a different
    // number of times before frame 0, see the README's limitations.)
    name: "builtins-counter",
    reason: "seek_callback",
    composition: {
      cues: [],
      headHtml: `<script>(() => { let inside = false; window.__leaks = 0; const watch = (owner, key) => { const original = owner[key]; owner[key] = function () { if (inside) window.__leaks++; return original.apply(this, arguments); }; }; for (const key of ["indexOf", "includes", "lastIndexOf"]) watch(Array.prototype, key); for (const key of ["split", "indexOf", "lastIndexOf", "slice"]) watch(String.prototype, key); for (const key of ["test", "exec"]) watch(RegExp.prototype, key); Error.prepareStackTrace = function (error) { if (inside) window.__leaks++; return String(error); }; const register = (fn, ...args) => { inside = true; try { return fn(...args); } finally { inside = false; } }; const noop = () => {}; requestAnimationFrame(function loop() { const el = document.getElementById("seek-counter"); if (el) el.textContent = "leaks=" + window.__leaks; register(requestAnimationFrame, loop); clearTimeout(register(setTimeout, noop, 1e9)); clearInterval(register(setInterval, noop, 1e9)); }); })();</script>`,
      overlayHtml: `<div id="seek-counter" style="${BADGE_STYLE};width:auto;color:#fff;font:700 40px sans-serif"></div>`,
    },
  },
  // Builtins as callbacks: an observer, a listener, an `on*` handler, a custom element reaction, an
  // accessor and a Proxy trap on a tween target, a function-based tween value.
  nativePopoverCase(
    "observer-popover",
    `tl.set("#trig", { attr: { "data-k": "1" } }, 1.5); new MutationObserver(HTMLElement.prototype.showPopover.bind(document.getElementById("pop"))).observe(document.getElementById("trig"), { attributes: true });`,
  ),
  nativePopoverCase(
    "listener-popover",
    `tl.set("#det", { attr: { open: "" } }, 1.5); document.getElementById("det").addEventListener("toggle", ${SHOW_POPOVER});`,
    '<details id="det" style="position:absolute;top:900px;left:48px;color:#fff;font:700 40px sans-serif"><summary>D</summary>x</details>',
  ),
  {
    // A text selection, which paints and no fingerprint read before, from an `on*` handler.
    name: "handler-selection",
    reason: "seek_callback",
    composition: {
      cues: [],
      headHtml:
        "<style>#sel { position: absolute; top: 48px; left: 48px; color: #fff; font: 700 60px sans-serif; } ::selection { background: #3a6; color: #000; }</style>",
      overlayHtml:
        '<details id="det" style="position:absolute;top:900px;left:48px;color:#fff;font:700 40px sans-serif"><summary>D</summary>x</details><div id="sel">SELECTED</div>',
      timelineScript: `tl.set("#det", { attr: { open: "" } }, 1.5); document.getElementById("det").ontoggle = Selection.prototype.selectAllChildren.bind(getSelection(), document.getElementById("sel"));`,
    },
    assets: ["gsap"],
  },
  nativePopoverCase(
    "custom-element-popover",
    `class HfPop extends HTMLElement { static observedAttributes = ["data-k"]; } HfPop.prototype.attributeChangedCallback = HTMLElement.prototype.showPopover; customElements.define("hf-pop", HfPop); tl.set("#ce-pop", { attr: { "data-k": "1" } }, 1.5);`,
    '<hf-pop id="ce-pop" popover="manual">ELEMENT</hf-pop>',
  ),
  nativePopoverCase(
    "tween-native-setter",
    `const target = {}; Object.defineProperty(target, "on", { get: Number, set: ${SHOW_POPOVER} }); tl.set(target, { on: 1 }, 1.5);`,
  ),
  nativePopoverCase(
    "tween-proxy-trap",
    `tl.set(new Proxy({ on: 0 }, { get: ${SHOW_POPOVER} }), { on: 1 }, 1.5);`,
  ),
  nativePopoverCase(
    "tween-function-value",
    `tl.set("#trig", { attr: { "data-k": ${SHOW_POPOVER} } }, 1.5);`,
  ),
  // Content that paints on its own clock or from state the runtime drives, where the page's
  // fingerprint reads nothing: the controls of an audio element the runtime seeks, user-agent
  // shadow trees that animate, images painted by a pseudo-element or inside a shadow root, a
  // video in a shadow root, and a paint worklet.
  {
    name: "audio-controls",
    reason: "overlay_non_gsap_animation",
    composition: {
      overlayHtml: `<audio class="clip" src="assets/tone.m4a" data-start="0" data-duration="3" data-track-index="3" data-volume="0" controls style="${BADGE_STYLE};width:640px;height:64px"></audio>`,
    },
    assets: ["tone"],
  },
  {
    name: "marquee",
    wallClock: true,
    reason: "overlay_non_gsap_animation",
    composition: {
      overlayHtml: `<marquee scrollamount="40" truespeed style="${BADGE_STYLE};width:640px;color:#ff0;font:700 60px sans-serif">MARQUEE</marquee>`,
    },
  },
  {
    name: "indeterminate-progress",
    wallClock: true,
    reason: "overlay_non_gsap_animation",
    composition: { overlayHtml: `<progress style="${BADGE_STYLE};width:640px"></progress>` },
  },
  {
    name: "pseudo-element-gif",
    wallClock: true,
    reason: "overlay_non_gsap_animation",
    composition: {
      headHtml: `<style>#badge::before { content: url(assets/${ANIMATED_IMAGE_FILES.gif}); }</style>`,
      overlayHtml: `<div id="badge" style="${BADGE_STYLE}"></div>`,
    },
    assets: ["gif"],
  },
  {
    name: "shadow-root-gif",
    wallClock: true,
    reason: "overlay_non_gsap_animation",
    composition: {
      overlayHtml: `<div id="host" style="${BADGE_STYLE}"></div>`,
      timelineScript: `document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = '<img src="assets/${ANIMATED_IMAGE_FILES.gif}">';`,
    },
    assets: ["gsap", "gif"],
  },
  {
    name: "shadow-root-video",
    wallClock: true,
    reason: "video_count",
    composition: {
      overlayHtml: `<div id="host" style="${BADGE_STYLE}"></div>`,
      timelineScript: `document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = '<video autoplay muted loop playsinline src="assets/sdr.mp4" style="width:320px;height:180px"></video>';`,
    },
    assets: ["gsap", "sdr-video"],
  },
  {
    name: "paint-worklet",
    wallClock: true,
    // The worklet module is a registration; `paint()` in the CSS would decline it too.
    reason: "seek_callback",
    composition: {
      headHtml: `<style>#painted { background-image: paint(hf-counter); }</style><script>CSS.paintWorklet.addModule("assets/${PAINT_WORKLET_FILE}");</script>`,
      overlayHtml: `<div id="painted" style="${BADGE_STYLE}"></div>`,
    },
    assets: ["paint-worklet"],
  },
  // The builtins the fingerprint collector would call if it ran in the page's own world, replaced
  // by builtins that return constants: the fingerprint runs in an isolated world, and a page that
  // replaced a builtin with anything but script declines.
  fingerprintBuiltinCase(
    "fingerprint-digest",
    "SubtleCrypto.prototype.digest = Promise.resolve.bind(Promise, new ArrayBuffer(32));",
  ),
  fingerprintBuiltinCase(
    "fingerprint-encode",
    "TextEncoder.prototype.encode = Uint8Array.of.bind(Uint8Array);",
  ),
  fingerprintBuiltinCase("fingerprint-json", 'JSON.stringify = String.bind(null, "x");'),
  // The seek-time setter, compiled from a `javascript:` URL named like a DevTools evaluation, from
  // `location.href` and from a clicked anchor: trusted only by exact text, it declines.
  {
    ...highlightSetterCase(
      "jsurl-location-setter",
      `<script>location.href = ${JSON.stringify(javascriptUrl(HIGHLIGHT_SETTER))};</script>`,
    ),
    reason: "seek_callback",
  },
  {
    ...highlightSetterCase("jsurl-anchor-setter", ""),
    reason: "seek_callback",
    composition: {
      ...highlightSetterCase("jsurl-anchor-setter", "").composition,
      timelineScript: `{ const a = document.createElement("a"); a.href = ${JSON.stringify(javascriptUrl(HIGHLIGHT_SETTER))}; document.body.appendChild(a); a.click(); a.remove(); }`,
    },
    assets: ["gsap"],
  },
  {
    // Getters on `Error.prototype` that paint when anything formats an error, and an animation
    // frame loop. The loop declines; the fallback must match the flag-off render, so nothing the
    // passthrough adds to the render may format an error in the page.
    name: "error-getters-raf",
    reason: "seek_callback",
    composition: {
      cues: [],
      headHtml: `<script>for (const key of ["name", "message"]) Object.defineProperty(Error.prototype, key, { configurable: true, get() { const t = document.getElementById("touched"); if (t) t.textContent = "TOUCHED " + key; return key === "name" ? "Error" : ""; } });</script>`,
      overlayHtml: `<div id="touched" style="${TEXT_STYLE}">untouched</div>`,
      timelineScript: "(function loop() { requestAnimationFrame(loop); })();",
    },
    assets: ["gsap"],
  },
  {
    // The page paints the observer constructors' and the registry's source text. Nothing the
    // passthrough does is in the page, so it takes the passthrough and matches the layered render.
    name: "tostring-painter",
    reason: "",
    takesPassthrough: true,
    composition: {
      overlayHtml: `<div id="printed" style="${TEXT_STYLE}"></div>`,
      timelineScript: `document.getElementById("printed").textContent = String(MutationObserver) + " " + String(IntersectionObserver).length + " " + String(customElements.define);`,
    },
    assets: ["gsap"],
  },
  // Animated images in pseudo-elements no list of pseudo-elements named: declined by the image's
  // own bytes and by the CSS and element allowlists.
  {
    name: "picker-icon-gif",
    wallClock: true,
    reason: "overlay_unsupported",
    composition: {
      headHtml: `<style>select { appearance: base-select; position: absolute; top: 48px; right: 48px; width: 300px; height: 160px; font: 40px sans-serif; } select::picker-icon { content: url(assets/${ANIMATED_IMAGE_FILES.gif}); }</style>`,
      overlayHtml: "<select><option>A</option></select>",
    },
    assets: ["gif"],
  },
  {
    name: "scroll-button-gif",
    wallClock: true,
    reason: "overlay_unsupported",
    composition: {
      headHtml: `<style>#sc { position: absolute; top: 48px; right: 48px; width: 400px; height: 160px; overflow: auto; scrollbar-width: none; } #sc::scroll-button(right) { content: url(assets/${ANIMATED_IMAGE_FILES.gif}); }</style>`,
      overlayHtml: '<div id="sc"><div style="width:2000px;height:100px"></div></div>',
    },
    assets: ["gif"],
  },
  {
    // A worker draws a counter into a canvas inside an open shadow root, on its own clock.
    name: "shadow-worker-canvas",
    wallClock: true,
    reason: "seek_callback",
    composition: {
      overlayHtml: `<div id="host" style="${BADGE_STYLE};width:400px;height:200px"></div>`,
      timelineScript: `{ const root = document.getElementById("host").attachShadow({ mode: "open" }); root.innerHTML = '<canvas width="400" height="200"></canvas>'; const off = root.querySelector("canvas").transferControlToOffscreen(); const src = 'onmessage = (e) => { const g = e.data.getContext("2d"); let n = 0; setInterval(() => { n++; g.fillStyle = "#000"; g.fillRect(0, 0, 400, 200); g.fillStyle = "#fff"; g.font = "bold 80px sans-serif"; g.fillText(String(n), 20, 120); }, 16); };'; const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" }))); worker.postMessage(off, [off]); }`,
    },
    assets: ["gsap"],
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
      // An animated image plays on the wall clock: two flag-off renders share no frame.
      ...(format === "gif" ? {} : { wallClock: true as const }),
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

/**
 * The `captions-gsap` fixture's additions: a badge that a lazily initialised
 * GSAP `.from()` (`immediateRender: false`, so it reads its end values the
 * first time the playhead reaches it) slides in at 1 s, and a `set()` that
 * recolours it at 2 s. GSAP is the only writer, so the end values it reads
 * are the same however the frames are seeked: flag on must take the
 * passthrough, and the GSAP ticker's own animation frame must not count as a
 * history-dependent driver.
 */
const CAPTIONS_GSAP: Pick<CompositionOptions, "overlayHtml" | "timelineScript"> = {
  overlayHtml: `<div id="badge" style="position:absolute;top:48px;left:900px;width:128px;height:128px;background:#36f"></div>`,
  timelineScript: [
    'tl.from("#badge", { left: 200, opacity: 0, duration: 0.3, immediateRender: false }, 1);',
    'tl.set("#badge", { backgroundColor: "#f63" }, 2);',
  ].join("\n      "),
};

/** Reason the `transformed` fixture must report (the layout probe runs before the transform gate). */
const TRANSFORMED_REASON = "not_full_canvas";

interface FixtureProject {
  name: string;
  /** What the flag-on render is expected to do. */
  expect: "passthrough" | "fallback";
  /** For `fallback`: the reason the flag-on render must log. */
  expectReason?: string;
  /** `false` when the layered render itself is not repeatable: no pixel checks. */
  repeatable?: false;
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
  const result = spawnSync(ffmpegPath, args, {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed generating ${what} (exit ${result.status ?? "signal"})`);
  }
}

/** GSAP as the fixtures load it (`assets/gsap.min.js`), from the core package's dependency. */
function gsapAsset(): { source: string; name: string } {
  const require = createRequire(import.meta.url);
  const source = require.resolve("gsap/dist/gsap.min.js", {
    paths: [resolve(fileURLToPath(new URL("../../../core", import.meta.url)))],
  });
  return { source, name: "gsap.min.js" };
}

/** Source path of each negative-fixture asset, generating the animated images once. */
function negativeAssetSources(
  outDir: string,
  ffmpegPath: string,
): Record<NegativeAsset, { source: string; name: string }> {
  const images = {} as Record<AnimatedImageFormat, { source: string; name: string }>;
  for (const format of ["gif", "webp", "apng", "avif"] as const) {
    const name = ANIMATED_IMAGE_FILES[format];
    const source = join(outDir, "assets", name);
    if (!existsSync(source) || statSync(source).size === 0) {
      runFfmpegOrThrow(ffmpegPath, buildAnimatedImageArgs(format, source), source);
    }
    images[format] = { source, name };
  }
  const fakeGsap = join(outDir, "assets", FAKE_GSAP_FILE);
  writeFileSync(fakeGsap, `${HIGHLIGHT_SETTER}\n`);
  const worklet = join(outDir, "assets", PAINT_WORKLET_FILE);
  writeFileSync(worklet, PAINT_WORKLET);
  const generated = (name: string, args: (path: string) => string[]) => {
    const source = join(outDir, "assets", name);
    if (!existsSync(source) || statSync(source).size === 0) {
      runFfmpegOrThrow(ffmpegPath, args(source), source);
    }
    return { source, name };
  };
  return {
    gsap: gsapAsset(),
    "fake-gsap": { source: fakeGsap, name: FAKE_GSAP_FILE },
    tone: generated("tone.m4a", buildToneArgs),
    "sdr-video": generated("sdr.mp4", buildSdrVideoArgs),
    "paint-worklet": { source: worklet, name: PAINT_WORKLET_FILE },
    ...images,
  };
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
        html: buildCompositionHtml({
          ...base,
          compositionId: "hdr-passthrough-captions",
        }),
      }),
    },
    {
      name: "captions-offset",
      expect: "passthrough",
      dir: writeProject({
        ...project,
        sourcePath: offsetSourcePath,
        name: "captions-offset",
        html: buildCompositionHtml({
          ...base,
          compositionId: "hdr-passthrough-captions-offset",
        }),
      }),
    },
    {
      name: "captions-gsap",
      expect: "passthrough",
      dir: writeProject({
        ...project,
        name: "captions-gsap",
        html: buildCompositionHtml({
          ...base,
          ...CAPTIONS_GSAP,
          compositionId: "hdr-passthrough-captions-gsap",
        }),
        extraAssets: [gsapAsset()],
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
        ...(negative.takesPassthrough
          ? { expect: "passthrough" as const }
          : { expect: "fallback" as const, expectReason: negative.reason }),
        ...(negative.wallClock ? { repeatable: false as const } : {}),
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
  const manifest: GeneratedFixtures = {
    sourcePath,
    durationSec,
    fps,
    transfer,
    projects,
  };
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
