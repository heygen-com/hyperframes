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
import { Fix } from "../../measure/media.js";
import { avSync } from "../../measure/sync.js";

export const examples: Example[] = [
  [
    "How far the presenter's mouth trails the voice",
    "hyperframes measure sync renders/v1.mp4 --roi 470,620,140,90 --start 2 --end 8",
  ],
];

export default defineCommand({
  meta: {
    name: "sync",
    description:
      "Picture against sound for a person speaking: the lag between mouth motion and the voice",
  },
  args: {
    video: videoArg,
    roi: { ...roiArg, description: "The mouth, x,y,w,h in the video's pixels", required: true },
    start: { type: "string", description: "First second (default 0)" },
    end: { type: "string", description: "Last second (default: the end)" },
    "max-lag-ms": { type: "string", description: "Lags searched each way (default 400)" },
    json: jsonArg,
  },
  async run({ args }) {
    await runMeasure(() => {
      if (args.roi === undefined)
        throw new Fix("--roi is required", "--roi x,y,w,h round the mouth");
      const { info, roi } = videoAndRoi(args.video, args.roi);
      const [start, end] = window(info, args.start, args.end);
      return {
        video: info.path,
        roi,
        start,
        end,
        ...avSync(info, roi, start, end, num(args["max-lag-ms"], "--max-lag-ms", 400)),
        reading:
          "positive best_lag_ms means the picture is late; trust high confidence, repeat a medium one on another window without cuts",
      };
    });
  },
});
