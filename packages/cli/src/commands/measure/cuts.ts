import { defineCommand } from "citty";
import type { Example } from "../_examples.js";
import { jsonArg, runMeasure, videoArg, window } from "../../measure/command.js";
import { findCuts, signatures } from "../../measure/cuts.js";
import { probeVideo, round, videoClip } from "../../measure/media.js";

export const examples: Example[] = [
  ["Every hard cut and the shots between them", "hyperframes measure cuts ref.mp4"],
  ["Cuts in the first 20 seconds", "hyperframes measure cuts ref.mp4 --start 0 --end 20"],
];

export default defineCommand({
  meta: {
    name: "cuts",
    description:
      "Hard cuts from the frame-to-frame difference (scene scores miss some), and the shots between them",
  },
  args: {
    video: videoArg,
    start: { type: "string", description: "First second to read (default 0)" },
    end: { type: "string", description: "Last second to read (default: the end)" },
    json: jsonArg,
  },
  async run({ args }) {
    await runMeasure(() => {
      const info = probeVideo(String(args.video));
      const [start, end] = window(info, args.start, args.end);
      const clip = videoClip(info.path, start, end - start, info);
      const found = findCuts(signatures(clip.input, clip.filters).frames);
      const f0 = Math.ceil(start * info.fps - 1e-6);
      const cuts = found.map((c) => ({
        t: round((f0 + c.frame) / info.fps, 3),
        frame: f0 + c.frame,
        ...(c.frames > 1 ? { frames: c.frames } : {}),
        change: round(c.change, 1),
      }));
      const edges = [start, ...cuts.map((c) => c.t), end];
      return {
        video: info.path,
        start,
        end: round(end, 3),
        fps: round(info.fps, 3),
        cuts,
        shots: edges.slice(1).map((e, i) => ({
          start: round(edges[i]!, 3),
          end: round(e, 3),
          seconds: round(e - edges[i]!, 2),
        })),
      };
    });
  },
});
