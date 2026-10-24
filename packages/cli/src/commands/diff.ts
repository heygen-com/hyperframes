import { basename, extname, join, resolve } from "node:path";
import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { failCommand, setCommandExitCode } from "../utils/commandResult.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { withMeta } from "../utils/updateCheck.js";
import {
  DEFAULT_MIN_CELL,
  DEFAULT_MIN_MEAN,
  DEFAULT_MIN_P05,
  diffVideos,
  type DiffResult,
} from "../measure/diff.js";
import { Fix, formatJson, outDir, parseNumbers, parseRange } from "../measure/media.js";
import { readSegments } from "../measure/segments.js";

export const examples: Example[] = [
  [
    "Score a render against the original, frame by frame",
    "hyperframes diff .reverse/source.mp4 renders/final.mp4",
  ],
  [
    "Score one segment of a project without rendering it",
    "hyperframes diff .reverse/source.mp4 . --range 2.1,4.5",
  ],
  [
    "Score chosen moments of a project without rendering it",
    "hyperframes diff .reverse/source.mp4 . --at 0.5,2.4,3.1",
  ],
  [
    "Judge each REVERSE.md segment of the final render and write a side-by-side",
    "hyperframes diff .reverse/source.mp4 renders/final.mp4 --segments REVERSE.md --sbs",
  ],
];

function number(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const [n] = parseNumbers(value, flag);
  return n;
}

// fallow-ignore-next-line complexity
function printHuman(r: DiffResult) {
  const mark = r.pass ? c.success("✓ pass") : c.error("✗ fail");
  console.log(
    `${mark}  SSIM mean ${r.ssim.mean}, p05 ${r.ssim.p05}, worst cell p05 ${r.ssim.cell_p05} over ${r.ssim.frames} frames (${r.window[0]}–${r.window[1]} s)`,
  );
  if (!r.missing_content.pass)
    console.log(
      `   missing content in ${Math.round(r.missing_content.share * 100)}% of frames: ${r.missing_content.spans.map(([a, b]) => `${a}–${b} s`).join(", ")}`,
    );
  for (const m of r.worst)
    console.log(`   worst ${m.t}s  ssim ${m.ssim}  cell ${m.cell.roi.join(",")} at ${m.cell.ssim}`);
  if (r.cuts)
    console.log(
      `   cuts: ${r.cuts.reference.length} in the original${r.cuts.pass ? ", all matched" : `; missing ${r.cuts.missing.join(", ") || "none"}, extra ${r.cuts.extra.join(", ") || "none"}`}`,
    );
  if (r.duration)
    console.log(
      `   duration: original ${r.duration.reference} s, yours ${r.duration.yours} s${r.duration.pass ? "" : " (differ)"}`,
    );
  if (r.sound)
    console.log(
      `   sound: ${"offset_ms" in r.sound ? (r.sound.offset_ms === null ? (r.sound.note ?? "not aligned") : `${r.sound.offset_ms} ms off`) : `original ${r.sound.original ? "has" : "has no"} sound, yours ${r.sound.yours ? "has" : "has no"}`}${r.sound.pass ? "" : " (fails)"}`,
    );
  console.log(`   every frame: ${r.frames}`);
  for (const s of r.segments ?? []) {
    const state = s.pass === null ? c.dim("—") : s.pass ? c.success("✓") : c.error("✗");
    const detail = s.ssim
      ? `ssim ${s.ssim.mean} / p05 ${s.ssim.p05} / cell ${s.ssim.cell_p05}`
      : s.energy
        ? `motion ×${s.energy.mean_ratio}, luma ×${s.look?.luma_ratio}`
        : (s.note ?? "");
    console.log(`   ${state} ${s.id} ${s.window[0]}–${s.window[1]} s ${s.pixels}: ${detail}`);
  }
  for (const w of r.warnings) console.log(`   ${c.warn("⚠")} ${w}`);
  if (r.sheet) console.log(`   sheet ${r.sheet}`);
  if (r.sbs) console.log(`   side by side ${r.sbs}`);
}

export default defineCommand({
  meta: {
    name: "diff",
    description:
      "Score a render or a project against the original video frame by frame: SSIM, worst moments, cuts, segments",
  },
  args: {
    reference: { type: "positional", description: "The original video", required: true },
    yours: {
      type: "positional",
      description:
        "A rendered video, or a project folder (captured at the original's frame times, no render)",
      required: true,
    },
    at: { type: "string", description: "Compare only these seconds, e.g. 0.5,2.4" },
    range: { type: "string", description: "Compare every frame of start,end seconds" },
    segments: {
      type: "string",
      description:
        "REVERSE.md: a verdict per `## S01 · a–b s` segment (Pixels: regenerated compares motion and look)",
    },
    "min-mean": { type: "string", description: `Mean SSIM to pass (default ${DEFAULT_MIN_MEAN})` },
    "min-p05": {
      type: "string",
      description: `5th-percentile SSIM to pass (default ${DEFAULT_MIN_P05})`,
    },
    "min-cell": {
      type: "string",
      description: `5th percentile of each frame's worst 4x4 cell to pass (default ${DEFAULT_MIN_CELL})`,
    },
    worst: { type: "string", description: "Worst moments to show (default 4)" },
    sbs: {
      type: "boolean",
      description: "Also write an original | yours side-by-side video",
      default: false,
    },
    out: {
      type: "string",
      description: "Folder for the sheet and log (default .hyperframes/diff/<yours>)",
    },
    timeout: {
      type: "string",
      description: "Render-ready timeout in ms for a project folder (default 5000)",
    },
    json: { type: "boolean", description: "Print one JSON result", default: false },
  },
  // fallow-ignore-next-line complexity
  async run({ args }) {
    const json = args.json === true;
    try {
      if (args.at !== undefined && args.range !== undefined)
        throw new Fix("--at and --range both given", "pass one of them");
      const yours = resolve(String(args.yours));
      const stem = basename(yours, extname(yours)) || "project";
      const result = await diffVideos({
        reference: resolve(String(args.reference)),
        yours,
        at: args.at === undefined ? undefined : parseNumbers(args.at, "--at"),
        range: args.range === undefined ? undefined : parseRange(args.range),
        segments:
          args.segments === undefined ? undefined : readSegments(resolve(String(args.segments))),
        thresholds: {
          mean: number(args["min-mean"], "--min-mean"),
          p05: number(args["min-p05"], "--min-p05"),
          cell: number(args["min-cell"], "--min-cell"),
        },
        worst: number(args.worst, "--worst"),
        sbs: args.sbs === true,
        outDir: outDir(args.out, join("diff", stem)),
        timeoutMs: number(args.timeout, "--timeout"),
        log: (message) => console.error(message),
      });
      if (json) console.log(formatJson(withMeta({ ok: true, ...result })));
      else printHuman(result);
      if (!result.pass) setCommandExitCode(1);
    } catch (err) {
      const fix = err instanceof Fix ? err.fix : undefined;
      const message = normalizeErrorMessage(err);
      if (json)
        console.log(formatJson(withMeta({ ok: false, error: message, ...(fix ? { fix } : {}) })));
      else console.error(`${c.error("✗")} ${message}${fix ? `\n  Fix: ${fix}` : ""}`);
      failCommand();
    }
  },
});
