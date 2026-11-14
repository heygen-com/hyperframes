import { defineCommand } from "../../utils/defineCommand.js";
import type { Example } from "../_examples.js";
import {
  compareWindowArgs,
  jsonArg,
  num,
  roiArg,
  runMeasure,
  videoAndRoi,
  videoArg,
  window,
} from "../../measure/command.js";
import { parseRoi, probeVideo } from "../../measure/media.js";
import { compareRhythm, rhythm } from "../../measure/rhythm.js";

export const examples: Example[] = [
  [
    "How the film moves: holds, update rate, cuts and camera per shot",
    "hyperframes measure rhythm ref.mp4",
  ],
  [
    "The same numbers for your render, as ratios to the original's",
    "hyperframes measure rhythm ref.mp4 --start 4 --end 9 --compare renders/final.mp4",
  ],
];

export default defineCommand({
  meta: {
    name: "rhythm",
    description:
      "How a film moves: moving share, holds, update rate (ones, twos), cuts, and each shot's zoom, pan or handheld",
  },
  args: {
    video: videoArg,
    start: { type: "string", alias: ["from"], description: "Window start in seconds (default 0)" },
    end: { type: "string", alias: ["to"], description: "Window end in seconds (default: the end)" },
    roi: roiArg,
    // fallow-ignore-next-line code-duplication
    compare: {
      type: "string",
      description: "A second video (your render) measured at the original's still level",
    },
    ...compareWindowArgs,
    json: jsonArg,
  },
  run: ({ args }) =>
    runMeasure(() => {
      const { info, roi } = videoAndRoi(args.video, args.roi);
      const [start, end] = window(info, args.start, args.end);
      const region = args.roi === undefined ? undefined : roi;
      const ref = rhythm(info.path, start, end - start, region);
      if (!args.compare) return { video: info.path, ...ref };
      const other = probeVideo(args.compare);
      const yoursRoi = args["compare-roi"]
        ? parseRoi(args["compare-roi"], other.width, other.height)
        : region;
      const from = num(args["compare-start"], "--compare-start", start);
      const yours = rhythm(other.path, from, end - start, yoursRoi, ref.still_threshold);
      const { shots: refShots, ...refSummary } = ref;
      const { shots: yoursShots, ...yoursSummary } = yours;
      return {
        reference: refSummary,
        yours: yoursSummary,
        ratio: compareRhythm(ref, yours),
        reference_shots: refShots,
        yours_shots: yoursShots,
      };
    }),
});
