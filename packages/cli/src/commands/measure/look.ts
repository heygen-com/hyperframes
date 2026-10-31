import { defineCommand } from "../../utils/defineCommand.js";
import type { Example } from "../_examples.js";
import {
  jsonArg,
  num,
  roiArg,
  runMeasure,
  videoAndRoi,
  videoArg,
  window,
} from "../../measure/command.js";
import { compareLook, look, sameLook } from "../../measure/look.js";
import { Fix, parseRoi, probeVideo, readFrameAt, videoClip } from "../../measure/media.js";

export const examples: Example[] = [
  ["The grade of the first 5 seconds", "hyperframes measure look ref.mp4 --start 0 --end 5"],
  [
    "Does the rebuild's grade match the original's",
    "hyperframes measure look ref.mp4 --compare renders/v1.mp4",
  ],
];

export default defineCommand({
  meta: {
    name: "look",
    description:
      "Brightness, contrast, saturation, black-and-white share and warmth of a window, or compared with another video",
  },
  args: {
    video: videoArg,
    start: { type: "string", description: "First second (default 0)" },
    end: { type: "string", description: "Last second (default: the end)" },
    fps: { type: "string", description: "Frames sampled per second (default 2)" },
    roi: roiArg,
    at: { type: "string", description: "With --grid: the moment to read" },
    grid: {
      type: "string",
      description: "With --at: the mean colour of each cell, COLSxROWS, e.g. 8x6",
    },
    compare: { type: "string", description: "Another video measured over the same window" },
    "compare-start": {
      type: "string",
      description: "Second the window starts in it (default: --start)",
    },
    "compare-roi": { type: "string", description: "Region of it (default: the whole frame)" },
    json: jsonArg,
  },
  async run({ args }) {
    await runMeasure(() => {
      const { info, roi } = videoAndRoi(args.video, args.roi);
      if (args.grid !== undefined || args.at !== undefined) {
        const m = /^(\d+)x(\d+)$/.exec(String(args.grid ?? ""));
        if (!m || args.at === undefined)
          throw new Fix("--grid and --at go together", "--at 2 --grid 8x6");
        const [cols, rows] = [Number(m[1]), Number(m[2])];
        const at = num(args.at, "--at", 0);
        const { frames, w, h } = readFrameAt(info, at, { roi, width: Math.min(640, roi[2]) });
        const px = frames[0];
        if (!px) throw new Fix(`no frame at ${at}s`, "pick a time inside the video");
        const hex = (v: number[]) =>
          `#${v.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
        const colors = Array.from({ length: rows }, (_, r) =>
          Array.from({ length: cols }, (_, c) => {
            const [x0, x1, y0, y1] = [
              Math.floor((c * w) / cols),
              Math.floor(((c + 1) * w) / cols),
              Math.floor((r * h) / rows),
              Math.floor(((r + 1) * h) / rows),
            ];
            const sum = [0, 0, 0];
            for (let y = y0; y < y1; y++)
              for (let x = x0; x < x1; x++)
                for (let k = 0; k < 3; k++) sum[k]! += px[(y * w + x) * 3 + k]!;
            const n = Math.max(1, (x1 - x0) * (y1 - y0));
            return hex(sum.map((v) => v / n));
          }),
        );
        return {
          video: info.path,
          at,
          roi,
          grid: `${cols}x${rows}`,
          colors,
          reading: "rows top to bottom, each cell's mean colour",
        };
      }
      const [a, b] = window(info, args.start, args.end);
      const fps = num(args.fps, "--fps", 2);
      const ref = look(videoClip(info.path, a, b - a, info), fps, roi);
      if (args.compare === undefined) return { video: info.path, start: a, end: b, ...ref };
      const other = probeVideo(String(args.compare));
      const otherRoi =
        args["compare-roi"] === undefined
          ? undefined
          : parseRoi(args["compare-roi"], other.width, other.height);
      const theirs = look(
        videoClip(other.path, num(args["compare-start"], "--compare-start", a), b - a, other),
        fps,
        otherRoi,
      );
      const diff = compareLook(ref, theirs);
      return {
        video: info.path,
        compare: other.path,
        start: a,
        end: b,
        reference: ref,
        other: theirs,
        ...diff,
        same_look: sameLook(diff),
      };
    });
  },
});
