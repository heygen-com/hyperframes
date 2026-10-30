import { defineCommand } from "citty";
import type { Example } from "../_examples.js";
import { jsonArg, num, roiArg, runMeasure, videoAndRoi, videoArg } from "../../measure/command.js";
import { objects } from "../../measure/objects.js";

export const examples: Example[] = [
  [
    "How many elements are on screen and how they are arranged (ring, grid, row, stack)",
    "hyperframes measure objects .reverse/source.mp4 --at 2.4 --roi 300,200,1320,680",
  ],
];

export default defineCommand({
  meta: {
    name: "objects",
    description:
      "Separate elements at one time: count, sizes and arrangement (ring, grid, row, column, stack) as shares of the frame",
  },
  args: {
    video: videoArg,
    at: { type: "string", description: "Time in seconds", required: true },
    roi: roiArg,
    tol: {
      type: "string",
      description: "Distance from the background that counts as an element (40)",
    },
    json: jsonArg,
  },
  run: ({ args }) =>
    runMeasure(() => {
      const { info, roi } = videoAndRoi(args.video, args.roi);
      return {
        video: info.path,
        roi,
        ...objects(info.path, info, num(args.at, "--at", 0), roi, num(args.tol, "--tol", 40)),
      };
    }),
});
