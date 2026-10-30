import { resolve } from "node:path";
import { defineCommand } from "citty";
import type { Example } from "../_examples.js";
import { jsonArg, num, outArg, runMeasure } from "../../measure/command.js";
import { continuity } from "../../measure/continuity.js";
import { outDir } from "../../measure/media.js";

export const examples: Example[] = [
  [
    "Seams a chained shot has that the original does not",
    "hyperframes measure continuity .reverse/source.mp4 renders/final.mp4 --start 4 --end 12",
  ],
];

export default defineCommand({
  meta: {
    name: "continuity",
    description:
      "Seams yours has and the original does not: jumps, background flicker, and extra or missing shapes, on the original's clock",
  },
  args: {
    reference: { type: "positional", description: "The original", required: true },
    yours: { type: "positional", description: "The rebuild's render", required: true },
    start: { type: "string", description: "First second (default 0)" },
    end: { type: "string", description: "Last second (default: the end)" },
    out: outArg,
    json: jsonArg,
  },
  async run({ args }) {
    await runMeasure(() => {
      const r = continuity(resolve(String(args.reference)), resolve(String(args.yours)), {
        start: num(args.start, "--start"),
        end: num(args.end, "--end"),
        outDir: outDir(args.out, "measure/continuity"),
      });
      const count = (kind: string) => r.events.filter((e) => e.kind === kind).length;
      return {
        reference: resolve(String(args.reference)),
        yours: resolve(String(args.yours)),
        frames: r.frames,
        counts: { jump: count("jump"), flicker: count("flicker"), structure: count("structure") },
        events: r.events,
        thresholds: r.thresholds,
        reading:
          "jump: a whole-frame change the original lacks; flicker: a change over background the original keeps still; structure: an extra, missing or misplaced shape at `at` (source pixels); open each sheet (original over yours, peak marked) before acting",
        limitations: [
          "frames pair by time on the original's clock, so a retimed or offset rebuild reads as structure everywhere",
          "events are candidates to look at, not verdicts",
        ],
      };
    });
  },
});
