import { defineCommand } from "../../utils/defineCommand.js";
import type { Example } from "../_examples.js";
import { jsonArg, num, roiArg, runMeasure, videoAndRoi, videoArg } from "../../measure/command.js";
import { measureInk } from "../../measure/ink.js";
import { Fix, readFrameAt } from "../../measure/media.js";

export const examples: Example[] = [
  [
    "How big the title's letters are, in the video's pixels",
    "hyperframes measure ink ref.mp4 --at 3 --roi 200,400,1200,300",
  ],
];

export default defineCommand({
  meta: {
    name: "ink",
    description:
      "The bounds, size and lines of the text or marks drawn in a region of one frame, in the video's pixels",
  },
  args: {
    video: videoArg,
    at: { type: "string", description: "The second to read (default 0)" },
    roi: { ...roiArg, description: "Region x,y,w,h in the video's pixels around the text" },
    json: jsonArg,
  },
  async run({ args }) {
    await runMeasure(() => {
      const { info, roi } = videoAndRoi(args.video, args.roi);
      const at = num(args.at, "--at", 0);
      const px = readFrameAt(info, at, { roi }).frames[0];
      if (!px) throw new Fix(`no frame at ${at}s`, "pick a time inside the video");
      const ink = measureInk(px, roi);
      return {
        video: info.path,
        at,
        roi,
        ink: ink ?? "none: nothing stands out from its surroundings",
      };
    });
  },
});
