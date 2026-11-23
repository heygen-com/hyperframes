import { terminalText } from "@hyperframes/core";
import { defineCommand } from "../../utils/defineCommand.js";
import type { Example } from "../_examples.js";
import { jsonArg, num, runMeasure, videoArg, window } from "../../measure/command.js";
import { HAND_CHOICES, HAND_POINTS, followHand } from "../../measure/hands.js";
import { Fix, probeVideo } from "../../measure/media.js";

export const examples: Example[] = [
  [
    "Where the palm is through 3-5 s, for a title that rides it",
    "hyperframes measure hands ref.mp4 --start 3 --end 5",
  ],
  [
    "The right hand's pinch at the video's own frame rate",
    "hyperframes measure hands ref.mp4 --start 1.2 --end 2.4 --point pinch --which right --fps 30",
  ],
];

function choice<T extends string>(
  value: unknown,
  flag: string,
  choices: readonly T[],
  fallback: T,
): T {
  if (value === undefined) return fallback;
  const hit = choices.find((c) => c === value);
  if (hit === undefined)
    throw new Fix(
      `${flag} must be one of ${choices.join(", ")}, got "${String(value)}"`,
      `${flag} ${fallback}`,
    );
  return hit;
}

export default defineCommand({
  meta: {
    name: "hands",
    description:
      "Where a hand is through a stretch of up to 15 s: its palm, index fingertip or pinch in each sampled frame, from MediaPipe's hand landmarker",
  },
  args: {
    video: videoArg,
    start: { type: "string", alias: ["from"], description: "First second (default 0)" },
    end: { type: "string", alias: ["to"], description: "Last second (default: the end)" },
    point: {
      type: "string",
      description:
        "palm (the wrist and knuckles' middle, with the hand's size), index_tip, or pinch (midway between the thumb and index tips). Default palm",
    },
    which: {
      type: "string",
      description:
        "The hand followed: largest, or the largest one labelled left or right. Default largest",
    },
    fps: { type: "string", description: "Frames sampled per second, 1 to 30 (default 15)" },
    json: jsonArg,
  },
  async run({ args }) {
    await runMeasure(async () => {
      const info = probeVideo(String(args.video));
      const [start, end] = window(info, args.start, args.end);
      const followed = await followHand(
        info,
        start,
        end,
        {
          point: choice(args.point, "--point", HAND_POINTS, "palm"),
          which: choice(args.which, "--which", HAND_CHOICES, "largest"),
          fps: num(args.fps, "--fps", 15),
        },
        (message) => console.error(terminalText(message)),
      );
      return {
        video: info.path,
        ...followed,
        reading:
          "points[i] is the hand's point at window[0] + i * step seconds: x, y as shares of the frame from its top left (palm adds the hand's width and height); null is a frame with no such hand, never filled in",
      };
    });
  },
});
