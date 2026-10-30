import { mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineCommand } from "citty";
import type { Example } from "../_examples.js";
import {
  jsonArg,
  num,
  outArg,
  roiArg,
  runMeasure,
  videoAndRoi,
  videoArg,
  window,
} from "../../measure/command.js";
import { detectEvents, lookWindows } from "../../measure/events.js";
import {
  Fix,
  frameAt,
  outDir,
  parseNumbers,
  parseRange,
  readClip,
  round,
  runFfmpeg,
  videoClip,
  type Frames,
  type Roi,
  type VideoInfo,
} from "../../measure/media.js";

export const examples: Example[] = [
  ["An overview sheet, one frame a second", "hyperframes measure frames ref.mp4 --every 1"],
  [
    "The consecutive frames around every event, one strip per window",
    "hyperframes measure frames ref.mp4 --events",
  ],
  [
    "Every frame of a transition, at full size",
    "hyperframes measure frames ref.mp4 --range 2.1,2.6 --width 0",
  ],
  [
    "Two moments, cropped to read the text",
    "hyperframes measure frames ref.mp4 --at 1.2,3.4 --roi 100,800,880,200",
  ],
];

const TILE_W = 360;
const SHEET_TILES = 24;
const STRIP_MAX = 12;
const WINDOWS_MAX = 60;

/** Runs of consecutive indexes, for a short select expression. */
function runsOf(ks: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const k of ks) {
    const last = out.at(-1);
    if (last && k === last[1] + 1) last[1] = k;
    else out.push([k, k]);
  }
  return out;
}

/** The frames at these indexes (sorted, unique), in order, from one decode pass. */
function framesAt(info: VideoInfo, ks: number[], roi: Roi, width: number): Frames {
  const expr = runsOf(ks)
    .map(([a, b]) => (a === b ? `eq(n\\,${a})` : `between(n\\,${a}\\,${b})`))
    .join("+");
  // Renumbered so the raw output is exactly the picked frames, no gap filled by a repeat.
  const clip = {
    ...videoClip(info.path, 0, undefined, info),
    filters: [`select=${expr}`, `setpts=N/(${info.fpsText})/TB`],
  };
  const full = roi[0] === 0 && roi[1] === 0 && roi[2] === info.width && roi[3] === info.height;
  return readClip(clip, { ...(full ? {} : { roi }), width: width || roi[2] });
}

/** Writes frames as numbered PNGs into `work` in one ffmpeg call; returns their paths in order. */
function pngs(f: Frames, from: number, count: number, work: string): string[] {
  const raw = Buffer.concat(
    f.frames
      .slice(from, from + count)
      .map((px) => Buffer.from(px.buffer, px.byteOffset, px.byteLength)),
  );
  runFfmpeg(
    [
      ...["-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${f.w}x${f.h}`, "-i", "-"],
      ...["-start_number", "0", join(work, "%04d.png")],
    ],
    raw,
  );
  return readdirSync(work)
    .sort()
    .map((name) => join(work, name));
}

/** A private folder beside the output (one filesystem for the move), removed after `use`. */
async function inWork<T>(dir: string, use: (work: string) => Promise<T> | T): Promise<T> {
  const work = mkdtempSync(join(dir, ".frames-"));
  try {
    return await use(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Frames kept as `<prefix>-NN.png` in `dir`. */
const keepFrames = (f: Frames, count: number, dir: string, prefix: string) =>
  inWork(dir, (work) =>
    pngs(f, 0, count, work).map((path, i) => {
      const to = join(dir, `${prefix}-${String(i).padStart(2, "0")}.png`);
      renameSync(path, to);
      return to;
    }),
  );

/** One sheet of frames; the frames themselves never leave the private folder. */
const sheetOfFrames = (f: Frames, from: number, count: number, labels: string[], out: string) =>
  inWork(dirname(out), (work) => sheet(pngs(f, from, count, work), labels, out, f.w));

async function sheet(
  paths: string[],
  labels: string[],
  out: string,
  width: number,
): Promise<string | null> {
  const { createContactSheet } = await import("../../capture/contactSheet.js");
  return createContactSheet(paths, out, {
    cols: Math.min(6, paths.length),
    maxImages: paths.length,
    cellWidth: width,
    labelMode: "custom",
    labels,
  });
}

/**
 * Up to `max` of a window's frames: all when they fit, else the frame before, at and after each event's onset
 * (uniform thinning turns a cut into a dissolve and drops one-frame flashes), the rest evenly spaced.
 */
function spread(
  k0: number,
  k1: number,
  max: number,
  onsets: number[] = [],
): { ks: number[]; step: number } {
  const n = k1 - k0 + 1;
  if (n <= max) return { ks: Array.from({ length: n }, (_, i) => k0 + i), step: 1 };
  const must = new Set(onsets.flatMap((k) => [k - 1, k, k + 1]).filter((k) => k >= k0 && k <= k1));
  // At least half the strip stays evenly spaced, so what happens between the onsets is seen too.
  const room = Math.max(Math.ceil(max / 2), max - must.size);
  for (let i = 0; i < room; i++) must.add(k0 + Math.round((i * (n - 1)) / (room - 1)));
  const ks = [...must].sort((a, b) => a - b);
  return { ks, step: Math.ceil((n - 1) / Math.max(1, ks.length - 1)) };
}

const label = (k: number, fps: number) => `f${k} · ${round(k / fps, 3)}s`;

export default defineCommand({
  meta: {
    name: "frames",
    description:
      "Frames of a video as pictures: chosen moments, an overview sheet, consecutive native frames of a range, or strips around every event",
  },
  args: {
    video: videoArg,
    at: { type: "string", description: "Seconds, e.g. 1.2,3.4: one picture each" },
    every: {
      type: "string",
      description: "An overview: one frame every N seconds on sheets of 24",
    },
    range: {
      type: "string",
      description: "start,end seconds: consecutive native frames as one strip",
    },
    events: {
      type: "boolean",
      description: "One strip of consecutive frames per window from measure events --map",
      default: false,
    },
    start: { type: "string", description: "With --events or --every: first second (default 0)" },
    end: {
      type: "string",
      description: "With --events or --every: last second (default: the end)",
    },
    max: {
      type: "string",
      description: `Frames per strip (default ${STRIP_MAX}; longer ranges are evenly thinned)`,
    },
    width: {
      type: "string",
      description: `Picture width in pixels (default ${TILE_W}; 0 keeps the ROI's size)`,
    },
    roi: roiArg,
    out: outArg,
    json: jsonArg,
  },
  async run({ args }) {
    // fallow-ignore-next-line complexity
    await runMeasure(async () => {
      const modes = [args.at, args.every, args.range, args.events || undefined].filter(
        (v) => v !== undefined,
      );
      if (modes.length !== 1)
        throw new Fix(
          "pass exactly one of --at, --every, --range or --events",
          "npx hyperframes measure frames ref.mp4 --every 1",
        );
      const { info, roi } = videoAndRoi(args.video, args.roi);
      const dir = outDir(args.out, "measure/frames");
      const width = num(args.width, "--width", TILE_W);
      const max = num(args.max, "--max", STRIP_MAX);
      const last = info.frames - 1;
      const head = {
        video: info.path,
        fps: round(info.fps, 3),
        ...(args.roi !== undefined ? { roi } : {}),
      };

      if (args.at !== undefined) {
        const ks = [
          ...new Set(
            parseNumbers(args.at, "--at").map((t) => Math.min(last, frameAt(t, info.fps))),
          ),
        ].sort((a, b) => a - b);
        const f = framesAt(info, ks, roi, num(args.width, "--width", 0));
        const paths = await keepFrames(f, ks.length, dir, "at");
        return {
          ...head,
          frames: ks.map((k, i) => ({ t: round(k / info.fps, 3), frame: k, path: paths[i] })),
        };
      }

      if (args.every !== undefined) {
        const step = num(args.every, "--every", 1);
        const [a, b] = window(info, args.start, args.end);
        const ks = [
          ...new Set(
            Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) =>
              Math.min(last, frameAt(a + i * step, info.fps)),
            ),
          ),
        ];
        const f = framesAt(info, ks, roi, width);
        const sheets: string[] = [];
        for (let s = 0; s < ks.length; s += SHEET_TILES) {
          const part = ks.slice(s, s + SHEET_TILES);
          const out = await sheetOfFrames(
            f,
            s,
            part.length,
            part.map((k) => `${round(k / info.fps, 2)}s`),
            join(dir, `every-${step}s-${s / SHEET_TILES + 1}.jpg`),
          );
          if (out) sheets.push(out);
        }
        return { ...head, every_s: step, frames: ks.length, sheets };
      }

      if (args.range !== undefined) {
        const [a, b] = parseRange(args.range);
        const k0 = frameAt(a, info.fps);
        const k1 = Math.min(last, Math.max(k0, Math.ceil(b * info.fps - 1e-6) - 1));
        const { ks, step } = spread(k0, k1, max);
        const f = framesAt(info, ks, roi, width);
        const out = await sheetOfFrames(
          f,
          0,
          ks.length,
          ks.map((k) => label(k, info.fps)),
          join(dir, `range-${a}-${b}s.jpg`),
        );
        return { ...head, start: a, end: b, frames: ks.length, every_nth_frame: step, strip: out };
      }

      // --events: the windows the event map groups, each as a strip of its consecutive frames.
      const [a, b] = window(info, args.start, args.end);
      const found = detectEvents({
        info,
        start: a,
        end: b,
        roi: [0, 0, info.width, info.height],
        grid: { cols: 4, rows: 4 },
      });
      const windows = lookWindows(found.events, info.fps).slice(0, WINDOWS_MAX);
      const picks = windows.map((wnd) =>
        spread(
          frameAt(wnd.start, info.fps),
          Math.min(last, frameAt(wnd.end, info.fps)),
          max,
          wnd.onset_frames,
        ),
      );
      const all = [...new Set(picks.flatMap((p) => p.ks))].sort((x, y) => x - y);
      if (!all.length)
        return {
          ...head,
          windows: [],
          note: "nothing changes on screen: one overview frame is enough (--every)",
        };
      const f = framesAt(info, all, roi, width);
      const strips = [];
      for (const [i, wnd] of windows.entries()) {
        const { ks, step } = picks[i]!;
        const from = all.indexOf(ks[0]!);
        const out = await sheetOfFrames(
          f,
          from,
          ks.length,
          ks.map((k) => label(k, info.fps)),
          join(dir, `window-${String(i + 1).padStart(2, "0")}-${wnd.start}s.jpg`),
        );
        strips.push({
          start: wnd.start,
          end: wnd.end,
          what: wnd.what,
          frames: ks.length,
          ...(step > 1 ? { thinned: `onsets kept, about every ${step}th frame between` } : {}),
          strip: out,
        });
      }
      const total = lookWindows(found.events, info.fps).length;
      return {
        ...head,
        windows: strips,
        ...(total > WINDOWS_MAX
          ? {
              note: `${total} windows; the first ${WINDOWS_MAX} shown: use --start/--end for the rest`,
            }
          : {}),
      };
    });
  },
});
