import { defineCommand } from "citty";
import type { Example } from "../_examples.js";
import { jsonArg, num, runMeasure, videoAndRoi, videoArg, window } from "../../measure/command.js";
import { scan, summary } from "../../measure/ink.js";
import { Fix } from "../../measure/media.js";

export const examples: Example[] = [
  [
    "When a caption is on screen and how tall its letters are",
    "hyperframes measure ink .reverse/source.mp4 --roi 60,1500,960,260 --start 0 --end 6",
  ],
  [
    "The ink box of dark text at one time",
    "hyperframes measure ink .reverse/source.mp4 --roi 100,80,880,200 --at 2.4 --ink dark",
  ],
];

export default defineCommand({
  meta: {
    name: "ink",
    description:
      "Where text ink sits in a region: first and last visible time, widest box and median height (for font size)",
  },
  args: {
    video: videoArg,
    roi: { type: "string", description: "Region x,y,w,h holding the text", required: true },
    at: { type: "string", description: "One time in seconds" },
    start: { type: "string", description: "Range start in seconds (default 0)" },
    end: { type: "string", description: "Range end in seconds (default: the end)" },
    fps: { type: "string", description: "Samples per second over a range (10)" },
    ink: { type: "string", description: "light, dark or R,G,B (default light)", default: "light" },
    tol: { type: "string", description: "Distance that still counts as ink (60)" },
    json: jsonArg,
  },
  run: ({ args }) =>
    runMeasure(() => {
      const { info, roi } = videoAndRoi(args.video, args.roi);
      const opts = { ink: args.ink ?? "light", tol: num(args.tol, "--tol", 60) };
      if (args.at !== undefined) {
        if (args.start !== undefined)
          throw new Fix("--at and --start both given", "pass one of them");
        const t = num(args.at, "--at", 0);
        const [row] = scan(info.path, t, 1.5 / info.fps, roi, { ...opts, fps: 0 });
        if (!row) throw new Fix(`no frame at ${t}s`, "pick a time inside the video");
        return { video: info.path, roi, ...row };
      }
      const [start, end] = window(info, args.start, args.end);
      const fps = num(args.fps, "--fps", 10);
      return {
        video: info.path,
        roi,
        start,
        end,
        fps,
        ...summary(scan(info.path, start, end - start, roi, { ...opts, fps })),
      };
    }),
});
