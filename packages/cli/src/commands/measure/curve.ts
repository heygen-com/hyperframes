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
import { compareCurves, curves, printable } from "../../measure/curve.js";
import { Fix, parseRoi, probeVideo } from "../../measure/media.js";

export const examples: Example[] = [
  [
    "The ease, duration and overshoot of one element's move",
    "hyperframes measure curve original.mp4 --start 2.1 --end 3 --roi 240,280,600,540",
  ],
  [
    "The same move in your render, paired with the original's",
    "hyperframes measure curve original.mp4 --start 2.1 --end 3 --roi 240,280,600,540 --compare renders/final.mp4 --compare-start 2.1",
  ],
];

/** "#rrggbb" as RGB. */
function hex(text: string): number[] {
  const m = /^#?([0-9a-f]{6})$/i.exec(text);
  if (!m) throw new Fix(`--bg must be #rrggbb, got "${text}"`, "--bg #101820");
  return [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16));
}

export default defineCommand({
  meta: {
    name: "curve",
    description:
      "Each move of one element on a flat background: start, duration, overshoot and the closest GSAP ease",
  },
  args: {
    video: videoArg,
    start: { type: "string", description: "Window start in seconds (default 0)" },
    end: { type: "string", description: "Window end in seconds (default: the end)" },
    roi: {
      ...roiArg,
      description: "Region holding the whole move, overshoot included, and nothing else that moves",
    },
    bg: { type: "string", description: "Background #rrggbb (default: the ROI border's median)" },
    thr: {
      type: "string",
      description: "Pixel distance from the background that counts as the element (24)",
    },
    compare: {
      type: "string",
      description: "A second video (your render) to measure the same way",
    },
    ...compareWindowArgs,
    json: jsonArg,
  },
  run: ({ args }) =>
    runMeasure(() => {
      const { info, roi } = videoAndRoi(args.video, args.roi);
      const [start, end] = window(info, args.start, args.end);
      const opts = { bg: args.bg ? hex(args.bg) : null, thr: num(args.thr, "--thr", 24) };
      const ref = curves(info.path, start, end - start, roi, opts);
      if (!args.compare) return { video: info.path, ...ref, moves: printable(ref.moves) };
      const other = probeVideo(args.compare);
      const yoursRoi = args["compare-roi"]
        ? parseRoi(args["compare-roi"], other.width, other.height)
        : roi;
      const yours = curves(
        other.path,
        num(args["compare-start"], "--compare-start", start),
        end - start,
        yoursRoi,
        opts,
      );
      return {
        compare: compareCurves(ref, yours),
        reference: printable(ref.moves),
        yours: printable(yours.moves),
      };
    }),
});
