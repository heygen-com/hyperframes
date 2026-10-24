import { defineCommand } from "citty";
import type { Example } from "../_examples.js";
import {
  num,
  jsonArg,
  outArg,
  roiArg,
  runMeasure,
  videoAndRoi,
  videoArg,
  window,
} from "../../measure/command.js";
import { boxAt, boxRange } from "../../measure/box.js";
import { Fix, outDir } from "../../measure/media.js";

export const examples: Example[] = [
  [
    "One graphic's box, colours, text lines and cap height at one time",
    "hyperframes measure box .reverse/source.mp4 --at 1 --roi 240,280,600,540",
  ],
  [
    "When it is on screen over a range, and each move it makes with its ease",
    "hyperframes measure box .reverse/source.mp4 --start 3.5 --end 4.5 --roi 240,280,600,540 --track",
  ],
];

export default defineCommand({
  meta: {
    name: "box",
    description:
      "Where one graphic sits, found by its colour: box, ink, colours, text lines, cap height; over a range its moves",
  },
  args: {
    video: videoArg,
    at: { type: "string", description: "One time in seconds" },
    start: { type: "string", description: "Range start in seconds" },
    end: { type: "string", description: "Range end in seconds" },
    roi: {
      ...roiArg,
      description: "Region round the graphic with some of its ground (default: whole frame)",
    },
    color: {
      type: "string",
      description:
        "Its pixels: auto (the commonest colour unlike the ROI border), white, dark, alpha or #rrggbb (default auto)",
      default: "auto",
    },
    tol: { type: "string", description: "RGB distance that still matches the colour (40)" },
    track: {
      type: "boolean",
      description: "Over a range: each move of its centre, size and ink, with the ease",
      default: false,
    },
    out: outArg,
    json: jsonArg,
  },
  run: ({ args }) =>
    runMeasure(() => {
      const { info, roi } = videoAndRoi(args.video, args.roi);
      const opts = {
        video: info.path,
        info,
        roi,
        color: args.color ?? "auto",
        tol: num(args.tol, "--tol", 40),
        dir: outDir(args.out, "measure/box"),
      };
      if (args.at !== undefined)
        return { video: info.path, roi, ...boxAt(opts, num(args.at, "--at", 0)) };
      if (args.start === undefined || args.end === undefined)
        throw new Fix("give --at t, or --start and --end", "--start 3.5 --end 4.5");
      const [start, end] = window(info, args.start, args.end);
      return { video: info.path, roi, ...boxRange(opts, start, end, args.track === true) };
    }),
});
