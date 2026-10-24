import { defineCommand } from "citty";
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
import { compareFlow, flowMoves, flowSeries } from "../../measure/flow.js";
import { parseRoi, probeVideo, type Roi } from "../../measure/media.js";

export const examples: Example[] = [
  [
    "A card's moves from optical flow, as tweens",
    "hyperframes measure flow ref.mp4 --start 1 --end 2.4 --roi 300,200,640,400",
  ],
  [
    "Does the rebuild's element move like the original's",
    "hyperframes measure flow ref.mp4 --start 1 --end 2.4 --roi 300,200,640,400 --compare renders/v1.mp4",
  ],
];

export default defineCommand({
  meta: {
    name: "flow",
    description:
      "One element's motion from optical flow inside its box: its moves as tweens, or compared with another video's (energy, timing, path, scale, rotation)",
  },
  args: {
    video: videoArg,
    start: { type: "string", description: "First second", required: true },
    end: { type: "string", description: "Last second", required: true },
    roi: roiArg,
    compare: {
      type: "string",
      description: "Another video over the same window, on the same clock",
    },
    "compare-start": {
      type: "string",
      description: "Second the window starts in it (default: --start)",
    },
    "compare-roi": { type: "string", description: "Its box (default: --roi scaled by the widths)" },
    json: jsonArg,
  },
  async run({ args }) {
    await runMeasure(async () => {
      const { info, roi } = videoAndRoi(args.video, args.roi);
      const [a, b] = window(info, args.start, args.end);
      if (args.compare === undefined) {
        const rows = await flowSeries(info, a, b, roi, 320);
        return {
          video: info.path,
          start: a,
          end: b,
          roi,
          moves: flowMoves(rows, info.fps, roi, a),
        };
      }
      const other = probeVideo(String(args.compare));
      // Each axis scales on its own: a generated shot is rarely the original's exact aspect (768x1344 for 9:16).
      const [kx, ky] = [other.width / info.width, other.height / info.height];
      const scaled: Roi = [
        Math.round(roi[0] * kx),
        Math.round(roi[1] * ky),
        Math.round(roi[2] * kx),
        Math.round(roi[3] * ky),
      ];
      const otherRoi =
        args["compare-roi"] !== undefined
          ? parseRoi(args["compare-roi"], other.width, other.height)
          : scaled;
      const oa = num(args["compare-start"], "--compare-start", a);
      const [ref, yours] = await Promise.all([
        flowSeries(info, a, b, roi, 160),
        flowSeries(other, oa, oa + (b - a), otherRoi, 160),
      ]);
      return {
        video: info.path,
        compare: other.path,
        start: a,
        end: b,
        ...compareFlow(ref, yours),
        reading:
          "energy_ratio near 1 moves as much; motion_corr near 1 at lag_frames 0 moves at the same moments; path, scale and rotation errors are per frame",
      };
    });
  },
});
