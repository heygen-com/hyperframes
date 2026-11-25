// Hand keypoints through a stretch of video: where the palm, the index
// fingertip or the pinch (thumb and index tips together) is, frame by frame, from MediaPipe's hand landmarker. A hand
// closes, turns and spreads its fingers, which loses a colour or patch tracker; landmarks follow the hand itself.
//
// The landmarker is MediaPipe's own WebAssembly build with the model the Python package uses, so both give the same
// numbers. It draws each frame through a WebGL canvas, which Node has not, so it runs in the CLI's headless Chrome on a
// page whose every request is answered from disk. Neither is shipped in the CLI: the first use downloads them, pinned
// by size and sha256, into ~/.cache/hyperframes/mediapipe/<version>/.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HTTPRequest, Page } from "puppeteer-core";
import { trustedCacheRoot } from "@hyperframes/core/cache-dir";
import { ffmpegInput, Fix, guardedCwd, round, runFfmpeg, type VideoInfo } from "./media.js";
import { ensurePinnedFiles, type PinnedFile } from "./pinnedFiles.js";

const VERSION = "1.0.0";
const CODE_ROOT = trustedCacheRoot();
export const MEDIAPIPE_DIR = join(CODE_ROOT, "mediapipe", VERSION);

interface Served extends PinnedFile {
  type: string;
}

// The code is @mediapipe/tasks-vision 1.0.0 and the model is MediaPipe's float16 hand landmarker (both Apache-2.0).
const TASKS_VISION = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const FILES: readonly Served[] = [
  {
    name: "vision_bundle.mjs",
    bytes: 154_839,
    sha256: "54ad628b478853dadb23261c1c7d14cfe3760b363ccf62b8c02ef73e5c7fb87a",
    url: `${TASKS_VISION}/vision_bundle.mjs`,
    type: "text/javascript",
  },
  {
    name: "vision_wasm_internal.js",
    bytes: 323_343,
    sha256: "e2da04fe2ab9f58eb2aeb8f8724c80ad8919d31d7f5fb99057565879f05f51ca",
    url: `${TASKS_VISION}/wasm/vision_wasm_internal.js`,
    type: "text/javascript",
  },
  {
    name: "vision_wasm_internal.wasm",
    bytes: 11_532_084,
    sha256: "c266c65f3789bea74ab12dd6609edc96c68655da4540d6097d0732d8be80b742",
    url: `${TASKS_VISION}/wasm/vision_wasm_internal.wasm`,
    type: "application/wasm",
  },
  {
    name: "hand_landmarker.task",
    bytes: 7_819_105,
    sha256: "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1",
    url: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    type: "application/octet-stream",
  },
];

export const HAND_POINTS = ["palm", "index_tip", "pinch"] as const;
export type HandPoint = (typeof HAND_POINTS)[number];
export const HAND_CHOICES = ["largest", "left", "right"] as const;
export type WhichHand = (typeof HAND_CHOICES)[number];

// The wrist and the four knuckles: the palm's middle, which stays put while the fingers move.
const PALM = [0, 5, 9, 13, 17];
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const LANDMARKS = 21;
const MAX_HANDS = 2;
const WIDTH = 480;
const MAX_FPS = 30;
const MAX_SECONDS = 15;

type Xy = [x: number, y: number];

/** One hand in one frame: MediaPipe's side label and its 21 landmarks as shares of the frame. */
export interface Hand {
  side: string;
  points: Xy[];
}

const span = (v: number[]) => Math.max(...v) - Math.min(...v);
const xs = (hand: Hand) => hand.points.map((p) => p[0]);
const ys = (hand: Hand) => hand.points.map((p) => p[1]);

function handArea(hand: Hand): number {
  return span(xs(hand)) * span(ys(hand));
}

/** The point as a track point: the palm with the hand's size [x, y, w, h], a fingertip or a pinch as [x, y]. */
export function placeHand(hand: Hand, point: HandPoint): number[] {
  if (point === "palm") {
    const mean = (axis: 0 | 1) =>
      PALM.reduce((sum, i) => sum + hand.points[i]![axis], 0) / PALM.length;
    return [mean(0), mean(1), span(xs(hand)), span(ys(hand))].map((v) => round(v, 4));
  }
  const tip = hand.points[INDEX_TIP]!;
  if (point === "index_tip") return [round(tip[0], 4), round(tip[1], 4)];
  const thumb = hand.points[THUMB_TIP]!;
  return [round((thumb[0] + tip[0]) / 2, 4), round((thumb[1] + tip[1]) / 2, 4)];
}

/** The hand to follow: the largest (nearest the lens), or the largest one MediaPipe labels left or right. */
export function pickHand(hands: Hand[], which: WhichHand): Hand | null {
  const side = which === "left" ? "Left" : "Right";
  return hands
    .filter((hand) => which === "largest" || hand.side === side)
    .reduce<Hand | null>(
      (best, hand) => (best && handArea(best) >= handArea(hand) ? best : hand),
      null,
    );
}

/** The followed hand's point in each frame; a frame without that hand stays null. */
export function handPath(frames: Hand[][], point: HandPoint, which: WhichHand) {
  return frames.map((hands) => {
    const hand = pickHand(hands, which);
    return hand ? placeHand(hand, point) : null;
  });
}

const isXy = (v: unknown): v is Xy =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));

const isHand = (v: unknown): v is Hand =>
  typeof v === "object" &&
  v !== null &&
  "side" in v &&
  typeof v.side === "string" &&
  "points" in v &&
  Array.isArray(v.points) &&
  v.points.length === LANDMARKS &&
  v.points.every(isXy);

/** What the page answered for one frame, checked: it crosses from Chrome as plain JSON. */
export function readHands(answer: unknown): Hand[] {
  if (!Array.isArray(answer) || !answer.every(isHand))
    throw new Error("the hand landmarker answered in a shape this CLI does not read");
  return answer;
}

const FRAME_NAME = /^t\d{5}\.jpg$/;

/**
 * The stretch as numbered JPEGs in `dir`, `fps` a second and WIDTH wide. Returns their names in order.
 */
export function handFrames(
  info: VideoInfo,
  start: number,
  end: number,
  fps: number,
  dir: string,
): string[] {
  runFfmpeg(
    [
      "-y",
      "-ss",
      start.toFixed(3),
      ...ffmpegInput(info.path, { playlists: info.guarded }),
      "-t",
      (end - start).toFixed(3),
      "-vf",
      `fps=${fps}:round=near,scale=${WIDTH}:-2`,
      "-q:v",
      "3",
      join(dir, "t%05d.jpg"),
    ],
    undefined,
    guardedCwd(info),
  );
  return readdirSync(dir)
    .filter((name) => FRAME_NAME.test(name))
    .sort();
}

// No such host exists: the page is answered from disk before Chrome looks one up.
const ORIGIN = "https://hands.hyperframes.invalid";

// The CPU delegate, as in the Python, so a machine's GPU cannot move the numbers.
const PAGE = `<!doctype html><meta charset="utf-8"><title>hands</title><script type="module">
import { HandLandmarker } from "/vision_bundle.mjs";
let landmarker;
window.loadHands = async () => {
  landmarker = await HandLandmarker.createFromOptions(
    { wasmLoaderPath: "/vision_wasm_internal.js", wasmBinaryPath: "/vision_wasm_internal.wasm" },
    {
      baseOptions: { modelAssetPath: "/hand_landmarker.task", delegate: "CPU" },
      runningMode: "VIDEO",
      numHands: ${MAX_HANDS},
    },
  );
};
window.handsIn = async (name, ms) => {
  const file = await (await fetch("/frames/" + name)).blob();
  const picture = await createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  try {
    const found = landmarker.detectForVideo(picture, ms);
    return found.landmarks.map((marks, i) => ({
      side: found.handedness[i]?.[0]?.categoryName ?? "",
      points: marks.map((mark) => [mark.x, mark.y]),
    }));
  } finally {
    picture.close();
  }
};
</script>`;

/** The body and type for a path on the page's origin, or null for one it has no business asking for. */
export function pageFile(
  path: string,
  frames: string,
): { type: string; file?: string; text?: string } | null {
  if (path === "/") return { type: "text/html", text: PAGE };
  const served = FILES.find((f) => path === `/${f.name}`);
  if (served) return { type: served.type, file: join(MEDIAPIPE_DIR, served.name) };
  const frame = path.startsWith("/frames/") ? path.slice("/frames/".length) : "";
  return FRAME_NAME.test(frame) ? { type: "image/jpeg", file: join(frames, frame) } : null;
}

function answer(request: HTTPRequest, frames: string): void {
  const url = new URL(request.url());
  const hit = url.origin === ORIGIN ? pageFile(url.pathname, frames) : null;
  const sent = hit
    ? request.respond({
        status: 200,
        contentType: hit.type,
        body: hit.file ? readFileSync(hit.file) : (hit.text ?? ""),
      })
    : request.abort();
  // A request still open when the page closes has nobody left to answer.
  sent.catch(() => {});
}

async function openHandsPage(page: Page, frames: string): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (request) => answer(request, frames));
  try {
    await page.goto(`${ORIGIN}/`);
    await page.evaluate("loadHands()");
  } catch (err) {
    throw new Fix(
      `the hand landmarker could not start in Chrome (${err instanceof Error ? err.message.split("\n")[0] : String(err)})`,
      "run `hyperframes doctor` to check Chrome, then run the command again",
    );
  }
}

/** The landmarker run over the frames in order as a video, so it carries a hand from one frame to the next. */
async function detectHands(
  dir: string,
  frames: string[],
  fps: number,
  onStatus?: (message: string) => void,
): Promise<Hand[][]> {
  await ensurePinnedFiles(MEDIAPIPE_DIR, CODE_ROOT, FILES, onStatus);
  const { ensureBrowser } = await import("../browser/manager.js");
  const { closeManagedBrowser, launchManagedBrowser } = await import("../browser/launch.js");
  const { buildChromeArgs } = await import("@hyperframes/engine");
  const puppeteer = await import("puppeteer-core");
  const chrome = await ensureBrowser();
  const browser = await launchManagedBrowser(puppeteer.default, {
    headless: true,
    executablePath: chrome.executablePath,
    // Software WebGL: the frames only pass through it, and it is there on a machine with no GPU.
    args: buildChromeArgs(
      { width: WIDTH, height: WIDTH, captureMode: "screenshot" },
      { browserGpuMode: "software" },
    ),
  });
  try {
    const page = await browser.newPage();
    await openHandsPage(page, dir);
    const found: Hand[][] = [];
    for (const [k, name] of frames.entries()) {
      const ms = Math.trunc((k * 1000) / fps);
      found.push(readHands(await page.evaluate(`handsIn(${JSON.stringify(name)}, ${ms})`)));
    }
    return found;
  } finally {
    await closeManagedBrowser(browser);
  }
}

/** The hand's point from `start` to `end`, one entry every `step` seconds, and how many frames lost it. */
export async function followHand(
  info: VideoInfo,
  start: number,
  end: number,
  opts: { point: HandPoint; which: WhichHand; fps: number },
  onStatus?: (message: string) => void,
) {
  if (end - start > MAX_SECONDS)
    throw new Fix(
      `hands follows up to ${MAX_SECONDS} seconds at a time, not ${round(end - start, 3)}`,
      `--start ${start} --end ${round(start + MAX_SECONDS, 3)}`,
    );
  const fps = Math.max(1, Math.min(MAX_FPS, opts.fps));
  const dir = mkdtempSync(join(tmpdir(), "hf-hands-"));
  try {
    const frames = handFrames(info, start, end, fps, dir);
    const found = await detectHands(dir, frames, fps, onStatus);
    const points = handPath(found, opts.point, opts.which);
    return {
      window: [round(start, 3), round(end, 3)],
      step: round(1 / fps, 4),
      point: opts.point,
      which: opts.which,
      points,
      lost: points.filter((p) => p === null).length,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
