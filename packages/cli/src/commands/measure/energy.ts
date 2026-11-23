import { defineCommand } from "../../utils/defineCommand.js";
import type { Example } from "../_examples.js";
import { jsonArg, num, runMeasure } from "../../measure/command.js";
import { compareEnergy, energyCurve } from "../../measure/energy.js";
import { Fix, parseRoi, probeVideo, round, videoClip, type Roi } from "../../measure/media.js";

export const examples: Example[] = [
  [
    "Does a regenerated shot move as much as the original's, and when",
    "hyperframes measure energy ref.mp4 renders/v1.mp4 --start 4 --seconds 5",
  ],
];

export default defineCommand({
  meta: {
    name: "energy",
    description:
      "How much two clips move, and whether they move at the same moments, when their pixels differ",
  },
  args: {
    reference: { type: "positional", description: "The original", required: true },
    yours: { type: "positional", description: "The other video", required: true },
    start: { type: "string", description: "Second the window starts in the original (default 0)" },
    "yours-start": { type: "string", description: "Second it starts in yours (default: --start)" },
    seconds: { type: "string", description: "Window length (default: the rest of the original)" },
    roi: { type: "string", description: "Region of the original, x,y,w,h" },
    "yours-roi": {
      type: "string",
      description: "Region of yours (default: --roi scaled by the widths)",
    },
    json: jsonArg,
  },
  async run({ args }) {
    await runMeasure(() => {
      const [a, b] = [probeVideo(String(args.reference)), probeVideo(String(args.yours))];
      const start = num(args.start, "--start", 0);
      const yoursStart = num(args["yours-start"], "--yours-start", start);
      const seconds = num(args.seconds, "--seconds", a.duration - start);
      if (seconds <= 0.5) throw new Fix("the window is under half a second", "--seconds 2 or more");
      const roi = args.roi === undefined ? undefined : parseRoi(args.roi, a.width, a.height);
      const k = b.width / a.width;
      const scaled = (r: Roi): Roi => [
        Math.round(r[0] * k),
        Math.round(r[1] * k),
        Math.max(2, Math.round(r[2] * k)),
        Math.max(2, Math.round(r[3] * k)),
      ];
      const yoursRoi =
        args["yours-roi"] !== undefined
          ? parseRoi(args["yours-roi"], b.width, b.height)
          : roi && scaled(roi);
      const r = compareEnergy(
        energyCurve(videoClip(a.path, start, seconds, a), roi),
        energyCurve(videoClip(b.path, yoursStart, seconds, b), yoursRoi),
      );
      return {
        reference: a.path,
        yours: b.path,
        window_s: round(seconds, 3),
        ...r,
        reading:
          "mean_ratio is how much yours moves (0.8–1.25 is the same amount); r near 1 at a small lag_s is the same action at the same time",
      };
    });
  },
});
