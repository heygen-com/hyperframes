import { join } from "node:path";
import { defineCommand } from "citty";
import type { Example } from "../_examples.js";
import { jsonArg, num, outArg, runMeasure, videoArg } from "../../measure/command.js";
import { Fix, outDir, parseRoi, probeVideo, round, runFfmpeg } from "../../measure/media.js";
import { trackTemplate } from "../../measure/track.js";

export const examples: Example[] = [
  [
    "Follow the cursor from 2.0 s to 5.5 s, starting from its box at 2.0 s",
    "hyperframes measure track ref.mp4 --at 2 --to 5.5 --roi 840,410,36,48",
  ],
];

const PATH_POINTS = 24;

export default defineCommand({
  meta: {
    name: "track",
    description:
      "Follow one textured thing (a cursor, a hand, a product) from its box at one moment, frame by frame, until a cut or a lost match",
  },
  args: {
    video: videoArg,
    at: { type: "string", description: "The second its box is taken at", required: true },
    roi: {
      type: "string",
      description: "Its box at --at, x,y,w,h in the video's pixels",
      required: true,
    },
    to: { type: "string", description: "Last second to follow it to (default: the end)" },
    radius: {
      type: "string",
      description: "How far it can move between frames, in pixels (default 48)",
    },
    "min-score": { type: "string", description: "Weakest match kept, 0–1 (default 0.6)" },
    out: outArg,
    json: jsonArg,
  },
  async run({ args }) {
    await runMeasure(async () => {
      const info = probeVideo(String(args.video));
      const at = num(args.at, "--at", 0);
      const to = Math.min(info.duration, num(args.to, "--to", info.duration));
      if (to <= at + 1 / info.fps) throw new Fix("--to is not after --at", "--at 2 --to 5.5");
      const box = parseRoi(args.roi, info.width, info.height);
      const r = await trackTemplate({
        info,
        at,
        box,
        to,
        radius: num(args.radius, "--radius"),
        minScore: num(args["min-score"], "--min-score"),
      });
      const step = Math.max(1, Math.ceil(r.rows.length / PATH_POINTS));
      const path = r.rows.filter((_, i) => i % step === 0 || i === r.rows.length - 1);
      // The path drawn on the first frame, so one look shows where it went.
      const dir = outDir(args.out, "measure/track");
      const picture = join(dir, `track-${at}-${round(to, 2)}s.png`);
      const draw = path.flatMap((p, i) =>
        i
          ? [
              `drawbox=x=${Math.round(p.x! - 3)}:y=${Math.round(p.y! - 3)}:w=6:h=6:color=red@0.9:t=fill`,
            ]
          : [],
      );
      runFfmpeg([
        ...["-y", "-ss", String(at), "-i", info.path, "-frames:v", "1"],
        ...[
          "-vf",
          [
            `drawbox=x=${box[0]}:y=${box[1]}:w=${box[2]}:h=${box[3]}:color=yellow:t=3`,
            ...draw,
          ].join(","),
          picture,
        ],
      ]);
      const scores = r.scores.slice(1);
      return {
        video: info.path,
        template: { at, box },
        followed_s: [round(at, 3), r.rows.at(-1)!.t],
        frames: r.rows.length,
        lost: r.lost,
        mean_score: scores.length
          ? round(scores.reduce((s, v) => s + v, 0) / scores.length, 3)
          : null,
        path: path.map((p) => ({ t: p.t, x: Math.round(p.x!), y: Math.round(p.y!) })),
        moves: r.moves,
        picture,
        reading:
          "x and y are the box centre in video pixels; moves are its eases; a lost track needs a new --at and --roi where it reappears",
      };
    });
  },
});
