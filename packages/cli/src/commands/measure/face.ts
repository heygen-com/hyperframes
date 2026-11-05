import { defineCommand } from "../../utils/defineCommand.js";
import type { Example } from "../_examples.js";
import { jsonArg, num, runMeasure, videoArg, window } from "../../measure/command.js";
import {
  FIT_MIN_FACES,
  againstStart,
  faceBoxes,
  faceFit,
  faceSummary,
} from "../../measure/face.js";
import { Fix, probeVideo, round } from "../../measure/media.js";

export const examples: Example[] = [
  [
    "How big and where the presenter's face is in a shot",
    "hyperframes measure face ref.mp4 --start 4 --end 9.5",
  ],
  [
    "The scale and x, y that put a generated clip's face on the original's face over 2-6 s",
    "hyperframes measure face presenter.mp4 --against ref.mp4 --from 2 --to 6",
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
    start: {
      type: "string",
      description:
        "First second (default 0; with --against, 0 for a shot of its own and --from for a render as long as the original)",
    },
    end: {
      type: "string",
      description:
        "Last second (default: the end; with --against, --start plus the length of --from/--to)",
    },
    samples: {
      type: "string",
      description: "Frames sampled, evenly, the last one included (default 8)",
    },
    cast: {
      type: "boolean",
      description:
        "The person is one face in a crowd: grade the smallest face (and look for faces down to 20 px)",
      default: false,
    },
    against: {
      type: "string",
      description:
        "The original video: print the GSAP scale and x, y (canvas pixels) that put this clip's face on the original's over --from/--to",
    },
    from: { type: "string", description: "With --against: the original's first second" },
    to: { type: "string", description: "With --against: the original's last second" },
    json: jsonArg,
  },
  async run({ args }) {
    await runMeasure(async () => {
      const info = probeVideo(String(args.video));
      const cast = args.cast === true;
      const samples = Math.max(1, num(args.samples, "--samples", 8));
      const opts = cast ? { minFace: 0 } : {};
      if (args.against !== undefined) {
        const ref = probeVideo(String(args.against));
        const [a, b] = window(ref, args.from, args.to, ["--from", "--to"]);
        const s = num(args.start, "--start", againstStart(info.duration, ref.duration, a));
        const e = Math.min(info.duration, s + (b - a));
        if (!(e > s))
          throw new Fix(`--start ${s} is past this clip's end`, `--start 0 (or leave it out)`);
        const [fo, fc] = [
          await faceBoxes(ref, a, b, samples, opts),
          await faceBoxes(info, s, e, samples, opts),
        ];
        const rel = (f: { t: number; boxes: number[][] }[], t0: number) =>
          f.map((x) => ({ t: x.t - t0, boxes: x.boxes }));
        const fit = faceFit(rel(fo, a), rel(fc, s), ref, info, cast);
        return {
          video: info.path,
          against: ref.path,
          window: [round(s, 3), round(e, 3)],
          against_window: [a, b],
          canvas: [ref.width, ref.height],
          ...fit,
          ...(fit.transform === null
            ? {
                note: `fewer than ${FIT_MIN_FACES} moments with a face in both: try a wider window or more --samples`,
              }
            : {}),
          reading:
            "gsap.set(clip, { scale, x, y }) on a clip element that fills the canvas (object-fit: cover) with the default transform origin (its centre); x, y and the faces' centre and height are in the canvas's (the original's) pixels, clip_face before the transform; residual is the median face-centre miss left after it, in face heights",
        };
      }
      const [a, b] = window(info, args.start, args.end);
      return {
        video: info.path,
        start: a,
        end: b,
        ...faceSummary(await faceBoxes(info, a, b, samples, opts), cast),
        reading:
          "face_height is the face's height over the frame's; boxes are x, y, w, h as shares of the frame",
      };
    });
  },
});
