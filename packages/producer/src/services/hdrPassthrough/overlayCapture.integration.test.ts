// HDR passthrough capture dedup through real renders: a small HLG clip under GSAP-driven captions,
// rendered once on the layered HDR path and once with the passthrough. The passthrough must fold
// the planner's candidate states into one state per distinct overlay, keep a one-frame change
// inside a held caption, and still match the layered output frame for frame.
// Needs Chrome + ffmpeg with libx265: integration lane.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveConfig } from "@hyperframes/engine";
import { buildSourceClipArgs } from "../../hdr-passthrough-harness/fixture.js";
import type { ProducerLogger } from "../../logger.js";
import { createRenderJob, executeRenderJob } from "../renderOrchestrator.js";
import { FFMPEG } from "../render/frameLevelsTestFixtures.js";

const WIDTH = 320;
const HEIGHT = 180;
const FPS = 30;
const DURATION = 3;
const FRAME_BYTES = WIDTH * HEIGHT * 3;

const HAS_X265 =
  spawnSync(FFMPEG, ["-hide_banner", "-encoders"], { encoding: "utf-8" }).stdout?.includes(
    "libx265",
  ) ?? false;

interface Cue {
  id: string;
  start: number;
  duration: number;
}

/** Three cues, each a clip window with redundant and no-op tweens stacked on its edges. */
const MULTI_TWEEN_CUES: Cue[] = [0, 1, 2].map((i) => ({
  id: `cue-${i}`,
  start: (9 + i * 27) / FPS,
  duration: 18 / FPS,
}));

const MULTI_TWEEN_SCRIPT = MULTI_TWEEN_CUES.map(({ id, start, duration }) =>
  [
    // Shown by its clip window and by a set() on the same frame.
    `tl.set("#${id}", { opacity: 1 }, ${start});`,
    // A short tween that writes the value the caption already has, every frame it runs.
    `tl.fromTo("#${id}", { opacity: 1 }, { opacity: 1, duration: 0.1, ease: "none" }, ${start + 0.2});`,
    // A set() that leaves the text the colour it already is.
    `tl.set("#${id} span", { color: "#ffffff" }, ${start + 0.4});`,
    // Hidden by its clip window and by a set() on the same frame.
    `tl.set("#${id}", { opacity: 0 }, ${start + duration});`,
  ].join("\n"),
).join("\n");

/** One held caption with changes a static guess would merge away. */
const HELD_CUE: Cue = { id: "held", start: 15 / FPS, duration: 60 / FPS };
/** The caption's text is one level darker on this frame only. */
const FLIP_FRAME = 30;
/** From this frame on, the caption is very slightly more transparent. */
const FADE_FRAME = 50;

const HELD_SCRIPT = [
  `tl.set("#held", { opacity: 1 }, ${HELD_CUE.start});`,
  `tl.set("#held span", { color: "#fefefe" }, ${FLIP_FRAME / FPS});`,
  `tl.set("#held span", { color: "#ffffff" }, ${(FLIP_FRAME + 1) / FPS});`,
  `tl.set("#held", { opacity: 0.99 }, ${FADE_FRAME / FPS});`,
].join("\n");

/** A counter rewritten by an `hf-seek` listener: changes no static analysis can see. */
const SEEK_LISTENER_HTML = `<div id="seek-counter" style="position:absolute;top:8px;right:8px;color:#fff;font:700 20px sans-serif">t=0</div>
  <script>
    window.addEventListener("hf-seek", (e) => {
      document.getElementById("seek-counter").textContent = "t=" + Math.floor(e.detail.time * 4) / 4;
    });
  </script>`;

/**
 * The video dimmed while one short clip is on screen, by a stylesheet rule alone: the clip's window
 * falls between eligibility's layout samples, and no tween or animation targets the video.
 */
const DIM_CLIP_HTML = `<style>#root:has(#dim:not([style*="hidden"])) #bg { opacity: 0.3; }</style>
  <div id="dim" data-start="1.4" data-duration="0.2" data-track-index="2"></div>`;

/**
 * A custom highlight the overlay fingerprint cannot read, toggled by a setter on the seek-time global
 * the WebGPU adapter assigns, and by an accessor a GSAP set() writes through.
 */
const HIGHLIGHT_STYLE = `<style>::highlight(hf) { background-color: #f00; color: #ff0; }</style>
  <div id="mark" style="position:absolute;top:8px;left:8px;color:#fff;font:700 20px sans-serif">MARK</div>`;
const HIGHLIGHT_APPLY = `const applyHighlight = (on) => {
      if (!on) return CSS.highlights.delete("hf");
      const range = new Range();
      range.selectNodeContents(document.getElementById("mark"));
      CSS.highlights.set("hf", new Highlight(range));
    };`;
const SETTER_HIGHLIGHT_HTML = `${HIGHLIGHT_STYLE}
  <script>
    ${HIGHLIGHT_APPLY}
    let seekTime;
    Object.defineProperty(window, "__hfTypegpuTime", {
      configurable: true,
      get: () => seekTime,
      set(t) { seekTime = t; applyHighlight(t >= 1 && t < 2); },
    });
  </script>`;
const PROXY_HIGHLIGHT_HTML = `${HIGHLIGHT_STYLE}
  <script>
    ${HIGHLIGHT_APPLY}
    let lit = 0;
    window.highlightProxy = {};
    Object.defineProperty(highlightProxy, "on", { get: () => lit, set(v) { lit = v; applyHighlight(v === 1); } });
  </script>`;
const PROXY_HIGHLIGHT_SCRIPT =
  "tl.set(highlightProxy, { on: 1 }, 1.0); tl.set(highlightProxy, { on: 0 }, 2.0);";

function compositionHtml(cues: readonly Cue[], script: string, extraHtml = ""): string {
  const captions = cues
    .map(
      ({ id, start, duration }) =>
        `<div id="${id}" class="caption" data-start="${start}" data-duration="${duration}" data-track-index="1"><span>Caption ${id}</span></div>`,
    )
    .join("\n    ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <script src="assets/gsap.min.js"></script>
  <style>
    html, body { margin: 0; padding: 0; background: #000; }
    #root { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #000; }
    #bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
    .caption { position: absolute; left: 0; right: 0; bottom: 20px; text-align: center; opacity: 0; }
    .caption span {
      display: inline-block; padding: 6px 12px; border-radius: 8px;
      background: rgba(12, 14, 20, 0.58); box-shadow: 0 0 8px 2px rgba(12, 14, 20, 0.35);
      color: #fff; font: 700 20px "DejaVu Sans", Arial, sans-serif;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
    }
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${DURATION}"
    data-width="${WIDTH}" data-height="${HEIGHT}">
    <video id="bg" src="assets/hlg.mp4" data-start="0" data-duration="${DURATION}"
      data-media-start="0" data-track-index="0" playsinline></video>
    ${captions}
    ${extraHtml}
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    ${script}
    window.__timelines["main"] = tl;
  </script>
</body>
</html>
`;
}

interface CaptureStats {
  states: number;
  candidates: number;
  captures: number;
  unique: number;
}

interface RenderResult {
  output: string;
  messages: string[];
  capture: CaptureStats | undefined;
}

let root: string;

const PROJECTS = ["multi", "held", "seek", "dim", "setter", "proxy"];

function recordingLogger(messages: string[], onCapture: (stats: CaptureStats) => void) {
  const logger: ProducerLogger = {
    error: (message) => messages.push(message),
    warn: (message) => messages.push(message),
    info: (message, meta) => {
      messages.push(message);
      if (message.includes("HDR passthrough: overlay states captured") && meta) {
        onCapture(meta as unknown as CaptureStats);
      }
    },
    debug: () => {},
  };
  return logger;
}

async function render(project: string, passthrough: boolean): Promise<RenderResult> {
  const messages: string[] = [];
  let capture: CaptureStats | undefined;
  const job = createRenderJob({
    fps: FPS,
    quality: "draft",
    format: "mp4",
    workers: 1,
    logger: recordingLogger(messages, (stats) => {
      capture = stats;
    }),
    producerConfig: resolveConfig({
      browserGpuMode: "software",
      experimentalHdrPassthrough: passthrough,
    }),
  });
  const output = join(root, `${project}-${passthrough ? "on" : "off"}.mp4`);
  await executeRenderJob(job, join(root, project), output);
  return { output, messages, capture };
}

/** Every frame of an encoded video as 8-bit RGB, one buffer per frame. */
function decodeFrames(videoPath: string): Buffer[] {
  const raw = spawnSync(
    FFMPEG,
    ["-v", "error", "-i", videoPath, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  if (raw.status !== 0) throw new Error(`decode failed: ${String(raw.stderr)}`);
  const frames: Buffer[] = [];
  for (let offset = 0; offset + FRAME_BYTES <= raw.stdout.length; offset += FRAME_BYTES) {
    frames.push(raw.stdout.subarray(offset, offset + FRAME_BYTES));
  }
  return frames;
}

/** Bit-exact comparison of the decoded 10-bit planes. */
function sameVideo(a: string, b: string): boolean {
  const decode = (path: string) =>
    spawnSync(
      FFMPEG,
      ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "yuv420p10le", "-"],
      {
        maxBuffer: 256 * 1024 * 1024,
      },
    ).stdout;
  return decode(a).equals(decode(b));
}

function writeProject(name: string, html: string): void {
  const dir = join(root, name);
  mkdirSync(join(dir, "assets"), { recursive: true });
  copyFileSync(join(root, "hlg.mp4"), join(dir, "assets", "hlg.mp4"));
  copyFileSync(
    resolve(import.meta.dirname, "../../../../core/node_modules/gsap/dist/gsap.min.js"),
    join(dir, "assets", "gsap.min.js"),
  );
  writeFileSync(join(dir, "index.html"), html);
}

describe.skipIf(!HAS_X265)("HDR passthrough capture dedup through real renders", () => {
  const results = new Map<string, RenderResult>();

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "hf-hdrpt-dedup-"));
    const clip = spawnSync(
      FFMPEG,
      buildSourceClipArgs({
        outputPath: join(root, "hlg.mp4"),
        durationSec: DURATION,
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        crf: 12,
      }),
      { encoding: "utf-8" },
    );
    if (clip.status !== 0) throw new Error(`HLG clip failed: ${clip.stderr}`);
    writeProject("multi", compositionHtml(MULTI_TWEEN_CUES, MULTI_TWEEN_SCRIPT));
    writeProject("held", compositionHtml([HELD_CUE], HELD_SCRIPT));
    writeProject("seek", compositionHtml([HELD_CUE], HELD_SCRIPT, SEEK_LISTENER_HTML));
    writeProject("dim", compositionHtml([HELD_CUE], HELD_SCRIPT, DIM_CLIP_HTML));
    writeProject("setter", compositionHtml([], "", SETTER_HIGHLIGHT_HTML));
    writeProject("proxy", compositionHtml([], PROXY_HIGHLIGHT_SCRIPT, PROXY_HIGHLIGHT_HTML));
    for (const project of PROJECTS) {
      for (const passthrough of [false, true]) {
        results.set(`${project}-${passthrough}`, await render(project, passthrough));
      }
    }
  }, 600_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("takes the passthrough on both compositions", () => {
    for (const project of ["multi", "held"]) {
      const on = results.get(`${project}-true`)!;
      expect(on.messages.filter((m) => m.includes("HDR passthrough off"))).toEqual([]);
      expect(on.capture).toBeDefined();
      expect(results.get(`${project}-false`)!.capture).toBeUndefined();
    }
  });

  it("captures one state per distinct overlay for multi-tween cues", () => {
    const stats = results.get("multi-true")!.capture!;
    // A caption-free gap, then each cue and the gap after it.
    expect(stats.states).toBe(2 * MULTI_TWEEN_CUES.length + 1);
    expect(stats.unique).toBe(MULTI_TWEEN_CUES.length + 1);
    // Every tween edge and clip cut is a candidate; only distinct fingerprints are captured.
    expect(stats.candidates).toBeGreaterThan(4 * stats.states);
    expect(stats.captures).toBeLessThan(stats.candidates / 3);
  });

  it("keeps a one-frame change and a tiny persistent change inside a held caption", () => {
    const stats = results.get("held-true")!.capture!;
    // gap, caption, the darker frame, caption, slightly faded caption, gap.
    expect(stats.states).toBe(6);
    expect(stats.unique).toBe(4);
    const frames = decodeFrames(results.get("held-true")!.output);
    expect(frames).toHaveLength(DURATION * FPS);
    expect(frames[FLIP_FRAME]!.equals(frames[FLIP_FRAME - 1]!)).toBe(false);
    expect(frames[FLIP_FRAME]!.equals(frames[FLIP_FRAME + 1]!)).toBe(false);
  });

  it("declines a composition whose hf-seek listener rewrites the overlay", () => {
    const on = results.get("seek-true")!;
    expect(on.capture).toBeUndefined();
    expect(on.messages).toContain(
      "[Render] HDR passthrough off: overlay_non_gsap_animation (hf-seek listener (1))",
    );
  });

  it("falls back when a stylesheet rule dims the video during a clip window", () => {
    const on = results.get("dim-true")!;
    expect(on.messages).toContain(
      "[Render] HDR passthrough off: video_animated (hdrPassthrough: the video's layer changes at frame 42 (opacity 0.3))",
    );
  });

  it.each([
    ["a seek-time setter", "setter"],
    ["an accessor a GSAP set() writes through", "proxy"],
  ])("falls back when %s changes state the fingerprint cannot read", (_name, project) => {
    const on = results.get(`${project}-true`)!;
    expect(on.messages).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^\\[Render\\] HDR passthrough off: seek_callback \\(\\d+ page function\\(s\\) ran after load, first .+ in hyperframes-composition://body\\)$`,
        ),
      ),
    );
  });

  it("matches the layered HDR path bit for bit", () => {
    for (const project of PROJECTS) {
      const off = results.get(`${project}-false`)!.output;
      const on = results.get(`${project}-true`)!.output;
      expect(sameVideo(off, on)).toBe(true);
    }
  });
});
