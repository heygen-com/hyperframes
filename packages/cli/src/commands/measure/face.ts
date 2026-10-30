import { defineCommand } from "citty";
import type { Example } from "../_examples.js";
import { jsonArg, num, runMeasure, videoArg, window } from "../../measure/command.js";
import { faceBoxes, faceSummary } from "../../measure/face.js";
import { probeVideo } from "../../measure/media.js";

export const examples: Example[] = [
  [
    "How big and where the presenter's face is in a shot",
    "hyperframes measure face ref.mp4 --start 4 --end 9.5",
  ],
];

export default defineCommand({
  meta: {
    name: "face",
    description:
      "How big the face is and where, over a window: its box per sampled frame and whether a generated presenter can keep the likeness at that size",
  },
  args: {
    video: videoArg,
    start: { type: "string", description: "First second (default 0)" },
    end: { type: "string", description: "Last second (default: the end)" },
    samples: {
      type: "string",
      description: "Frames sampled, evenly, the last one included (default 12)",
    },
    cast: {
      type: "boolean",
      description: "The person is one face in a crowd: grade the smallest face",
      default: false,
    },
    json: jsonArg,
  },
  async run({ args }) {
    await runMeasure(async () => {
      const info = probeVideo(String(args.video));
      const [a, b] = window(info, args.start, args.end);
      const samples = await faceBoxes(info, a, b, Math.max(1, num(args.samples, "--samples", 12)));
      return {
        video: info.path,
        start: a,
        end: b,
        ...faceSummary(samples, args.cast === true),
        reading:
          "face_height is the face's height over the frame's; boxes are x, y, w, h as shares of the frame",
      };
    });
  },
});
