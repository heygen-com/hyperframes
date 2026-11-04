import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineCommand } from "../../utils/defineCommand.js";
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
import {
  countEvents,
  detectEvents,
  drawStrip,
  lookWindows,
  type ScreenEvent,
} from "../../measure/events.js";
import { Fix, outDir, round, type VideoInfo } from "../../measure/media.js";

export const examples: Example[] = [
  [
    "The film's event map: cuts, flashes, what appears where, holds, and the sound's hits, grouped into windows to look at",
    "hyperframes measure events ref.mp4 --map",
  ],
  [
    "When one region changes, frame by frame",
    "hyperframes measure events ref.mp4 --roi 0,800,1080,300 --start 2 --end 6",
  ],
];

/** "6x10" as columns and rows. */
function parseGrid(text: unknown): { cols: number; rows: number } {
  const m = /^(\d+)x(\d+)$/.exec(String(text));
  if (!m || Number(m[1]) < 1 || Number(m[2]) < 1)
    throw new Fix(`--grid must be COLSxROWS, got "${String(text)}"`, "--grid 6x10");
  return { cols: Number(m[1]), rows: Number(m[2]) };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const numbers = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];

interface Sound {
  bpm: number | null;
  beats: number[];
  onsets: { t: number; strength: number }[];
}

/** The sound's onsets, beats and tempo, measured on this machine. */
async function soundOf(info: VideoInfo, start: number, end: number): Promise<Sound | null> {
  if (!info.audio) return null;
  const { analyzeTargets, previewTarget } = await import("../../audio/analysis/run.js");
  const report = await analyzeTargets([await previewTarget(info.path, info.path, null)], {
    capabilities: ["onsets", "beats", "bpm"],
    quality: "local",
  });
  const item = report.items[0];
  if (!item) return null;
  const inside = (t: number) => t >= start && t <= end;
  const onsets =
    isRecord(item.onsets) && Array.isArray(item.onsets.events) ? item.onsets.events : [];
  return {
    bpm: isRecord(item.bpm) && typeof item.bpm.value === "number" ? round(item.bpm.value, 1) : null,
    beats: numbers(isRecord(item.beats) ? item.beats.times : undefined).filter(inside),
    onsets: onsets
      .filter(isRecord)
      .flatMap((e) =>
        typeof e.t === "number" && typeof e.strength === "number" && inside(e.t)
          ? [{ t: e.t, strength: e.strength }]
          : [],
      ),
  };
}

const LIST_MAX = 64;

export default defineCommand({
  meta: {
    name: "events",
    description:
      "When things change on screen: cuts, flashes, appears, disappears, changes and holds; --map adds the sound and the windows worth looking at",
  },
  args: {
    video: videoArg,
    map: {
      type: "boolean",
      description:
        "The whole window on a 4x4 grid with the sound's onsets and beats, grouped into windows to look at",
      default: false,
    },
    roi: roiArg,
    grid: {
      type: "string",
      description: "Split the frame into COLSxROWS cells, e.g. 6x10 (default with --map: 4x4)",
    },
    start: { type: "string", description: "First second (default 0)" },
    end: { type: "string", description: "Last second (default: the end)" },
    thr: {
      type: "string",
      description: "Mean grey-level change of an appear or a cut (default 5)",
    },
    out: outArg,
    json: jsonArg,
  },
  async run({ args }) {
    // fallow-ignore-next-line complexity
    await runMeasure(async () => {
      const { info, roi } = videoAndRoi(args.video, args.roi);
      const [start, end] = window(info, args.start, args.end);
      const grid =
        args.grid !== undefined
          ? parseGrid(args.grid)
          : args.map && args.roi === undefined
            ? { cols: 4, rows: 4 }
            : undefined;
      const thr = num(args.thr, "--thr", 5);
      const found = detectEvents({ info, start, end, roi, grid, thr });
      if (found.frames < 3)
        throw new Fix(`under 3 frames between ${start}s and ${end}s`, "widen --start/--end");
      const dir = outDir(args.out, "measure/events");
      const name = `events-${start}-${round(end, 2)}s`;
      const strip = found.shown.length ? drawStrip(found, join(dir, `${name}.png`)) : null;
      const holds = found.events.filter((e) => e.type === "hold");
      const head = {
        video: info.path,
        ...(grid ? { grid: `${grid.cols}x${grid.rows}` } : { roi }),
        start,
        end: round(end, 3),
        fps: round(info.fps, 3),
      };
      if (!args.map) {
        const lengths = holds.map((e) => e.seconds ?? 0).sort((a, b) => a - b);
        return {
          ...head,
          frames: found.frames,
          thr,
          counts: countEvents(found.events),
          holds: {
            longest_s: lengths.at(-1) ?? 0,
            median_s: lengths[(lengths.length - 1) >> 1] ?? 0,
            count: lengths.length,
          },
          strip,
          strip_events: `${found.shown.length} of ${found.events.length - holds.length} (cuts and flashes, then the largest steps, then changes)`,
          events: found.events,
        };
      }
      const sound = await soundOf(info, start, end);
      const cuts = found.events.filter((e) => e.type === "cut").map((e) => e.t);
      const edges = [start, ...cuts, end];
      const windows = lookWindows(found.events, info.fps, sound?.onsets.map((o) => o.t) ?? []);
      const file = join(dir, `${name}-map.json`);
      writeFileSync(
        file,
        JSON.stringify({ ...head, events: found.events, sound, windows }, null, 1),
      );
      const strong = sound?.onsets.filter((o) => o.strength >= 0.5).map((o) => round(o.t, 3)) ?? [];
      const longHolds = holds
        .filter((e: ScreenEvent) => (e.seconds ?? 0) >= 0.5)
        .map((e) => ({ t: e.t, seconds: e.seconds }));
      return {
        ...head,
        duration: round(end - start, 3),
        counts: countEvents(found.events),
        shots: edges.slice(1).map((e, i) => ({ start: round(edges[i]!, 3), end: round(e, 3) })),
        holds: longHolds,
        sound: sound
          ? {
              bpm: sound.bpm,
              beats: sound.beats.length,
              ...(sound.beats.length
                ? { beat_times: sound.beats.slice(0, LIST_MAX).map((t) => round(t, 3)) }
                : {}),
              onsets: sound.onsets.length,
              strong_onsets: strong.slice(0, LIST_MAX),
            }
          : "none",
        windows,
        strip,
        file,
        next: "look at each window's frames: npx hyperframes measure frames <video> --events",
      };
    });
  },
});
