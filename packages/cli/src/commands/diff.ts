import { basename, extname, join, resolve } from "node:path";
import { defineCommand } from "../utils/defineCommand.js";
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
  findLedger,
  type DiffResult,
} from "../measure/diff.js";
import { Fix, formatJson, outDir, parseNumbers, parseRange } from "../measure/media.js";
import { readSegments } from "../measure/segments.js";
import { repeated } from "./media-use/generate.js";
import { parseMask } from "../heygen/generate.js";

export const examples: Example[] = [
  [
    "Score a render against the original, frame by frame",
    "hyperframes diff original.mp4 renders/final.mp4",
  ],
  [
    "Score one segment of a project without rendering it",
    "hyperframes diff original.mp4 . --range 2.1,4.5",
  ],
  [
    "Score chosen moments of a project without rendering it",
    "hyperframes diff original.mp4 . --at 0.5,2.4,3.1",
  ],
  [
    "Score one drawn element (a title's box) by itself at chosen moments of a project",
    "hyperframes diff original.mp4 . --at 1,1.5,2 --drawn 120,670,485,115",
  ],
  [
    "Judge each segment of the final render and write a side-by-side",
    "hyperframes diff original.mp4 renders/final.mp4 --segments segments.md --sbs",
  ],
];

function number(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const [n] = parseNumbers(value, flag);
  return n;
}

/** `x,y,w,h` or `x,y,w,h,a-b` in the original's pixels and seconds. */
function parseDrawn(text: string): ReturnType<typeof parseMask> {
  try {
    return parseMask(text);
  } catch {
    throw new Fix(`--drawn ${text} is not x,y,w,h[,a-b]`, "--drawn 120,670,485,115,0-2.77");
  }
}

function personLine(p: NonNullable<DiffResult["segments"]>[number]["person"] & object): string {
  const off = [
    ...(p.framing ?? [])
      .filter((f) => !f.pass)
      .map(
        (f) => `framing off ${f.window[0]}–${f.window[1]} s (shift ${f.shift}, size ×${f.scale})`,
      ),
    ...(p.text ?? []).filter((t) => t.carried).map((t) => `${t.clip} carries ${t.drawn}'s text`),
    ...(p.sync ?? [])
      .filter((x) => x.pass === false)
      .map((x) => `lips ${x.lag_ms} ms off at ${x.window[0]} s`),
  ];
  const moved = p.energy ? `, motion ×${p.energy.mean_ratio} (reported)` : "";
  return `person ${p.pass === null ? "—" : p.pass ? "✓" : "✗"}${off.length ? ` ${off.join("; ")}` : ""}${moved}`;
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
  if (r.missing_content.texture.share > 0)
    console.log(
      `   missing texture (reported, not failed) in ${Math.round(r.missing_content.texture.share * 100)}% of frames: ${r.missing_content.texture.spans.map(([a, b]) => `${a}–${b} s`).join(", ")}`,
    );
  for (const m of r.worst)
    console.log(`   worst ${m.t}s  ssim ${m.ssim}  cell ${m.cell.roi.join(",")} at ${m.cell.ssim}`);
  if (r.whole_frame_reuse?.spans.length)
    console.log(
      `   whole frame of the original in ${Math.round(r.whole_frame_reuse.share * 100)}% of frames${r.whole_frame_reuse.pass ? "" : `, with its drawn things at ${r.whole_frame_reuse.drawn.map(([a, b]) => `${a}–${b} s`).join(", ")} (a copy)`}`,
    );
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
  if (r.components)
    console.log(
      `   components: ${r.components.passed} of ${r.components.total} pass${r.components.mean === null ? "" : `, mean ${r.components.mean}`}`,
    );
  if (r.person) {
    const g = r.person.gates;
    const mark = (v: boolean | null, failed: string[]) =>
      v === null ? "unmeasured" : v ? "ok" : `fails in ${failed.join(", ")}`;
    console.log(
      `   person: framing ${mark(g.framing, r.person.failed.framing)}, text in the clip ${mark(g.text, r.person.failed.text)}, lips ${mark(g.sync, r.person.failed.sync)}; reported: motion ×${r.person.energy ?? "?"}, ${r.person.shots_at_cuts.at_cuts} of ${r.person.shots_at_cuts.total} clips start at a cut${r.person.shots_at_cuts.cuts_without_shot.length ? `, no new clip at ${r.person.shots_at_cuts.cuts_without_shot.join(", ")} s` : ""}`,
    );
  }
  console.log(`   every frame: ${r.frames}`);
  for (const s of r.segments ?? []) {
    const state = s.pass === null ? c.dim("—") : s.pass ? c.success("✓") : c.error("✗");
    const detail =
      [
        s.ssim && `ssim ${s.ssim.mean} / p05 ${s.ssim.p05} / cell ${s.ssim.cell_p05}`,
        s.energy && `motion ×${s.energy.mean_ratio}, luma ×${s.look?.luma_ratio}`,
        s.person && personLine(s.person),
      ]
        .filter(Boolean)
        .join("; ") ||
      (s.note ?? "");
    const region = s.regenerated ? `; person in ${s.regenerated.roi.join(",")}` : "";
    console.log(
      `   ${state} ${s.id} ${s.window[0]}–${s.window[1]} s ${s.pixels}${s.regenerated ? " outside the region" : ""}: ${detail}${region}`,
    );
  }
  for (const d of r.drawn ?? []) {
    const state = d.pass === null ? c.dim("—") : d.pass ? c.success("✓") : c.error("✗");
    const detail =
      d.pass === null
        ? "no ink found in the box (crop it tight around the letters)"
        : `score ${d.score} / p05 ${d.p05}, off by ${d.offset!.join(",")} px${d.ink === undefined ? "" : `, ink ×${d.ink}`}`;
    console.log(
      `   ${state} ${d.id} ${d.box.join(",")} ${d.window[0]}–${d.window[1]} s: ${detail}`,
    );
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
        "A file of `## S01 · a–b s` segments: a verdict per segment (Pixels: regenerated compares motion and look)",
    },
    ledger: {
      type: "string",
      description:
        "The project's media ledger, to find whole-frame cuts of the original (default: .media/manifest.jsonl beside the project or REVERSE.md)",
    },
    project: {
      type: "string",
      description:
        "The project folder, to find the ledger's generated clips and check them for the original's text (default: the folder holding .media)",
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
    drawn: {
      type: "string",
      description:
        "A drawn element's box x,y,w,h in the original's pixels, optionally its seconds a-b (repeatable): scored by itself whatever is behind it, with its offset and ink (yours over the original's: under 1 is lighter, thinner or smaller)",
    },
    json: { type: "boolean", description: "Print one JSON result", default: false },
  },
  // fallow-ignore-next-line complexity
  async run({ args, rawArgs }) {
    const json = args.json === true;
    try {
      if (args.at !== undefined && args.range !== undefined)
        throw new Fix("--at and --range both given", "pass one of them");
      const yours = resolve(String(args.yours));
      const stem = basename(yours, extname(yours)) || "project";
      const segmentsFile = args.segments === undefined ? undefined : resolve(String(args.segments));
      const result = await diffVideos({
        reference: resolve(String(args.reference)),
        yours,
        at: args.at === undefined ? undefined : parseNumbers(args.at, "--at"),
        range: args.range === undefined ? undefined : parseRange(args.range),
        segments: segmentsFile === undefined ? undefined : readSegments(segmentsFile),
        ledger:
          args.ledger === undefined
            ? findLedger(yours, segmentsFile)
            : resolve(String(args.ledger)),
        project: args.project === undefined ? undefined : resolve(String(args.project)),
        drawn: repeated(rawArgs, "--drawn").map(parseDrawn),
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
