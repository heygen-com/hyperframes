// Pixels from the original, as project media: a still at one moment or a clip over a window, cropped to a region,
// frame-exact, recorded in the media ledger as cut from the original. A rebuild reuses footage, photos and people
// this way instead of drawing or generating them.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { defineCommand } from "citty";
import type { Example } from "../_examples.js";
import { jsonArg, num, roiArg, runMeasure, videoAndRoi, videoArg } from "../../measure/command.js";
import { Fix, frameAt, round, runFfmpeg, type Roi, type VideoInfo } from "../../measure/media.js";

export const examples: Example[] = [
  [
    "A photo from the original at 3.2 s, cropped to its box",
    "hyperframes measure extract .reverse/source.mp4 --at 3.2 --roi 120,340,840,620 --out assets/photo.png",
  ],
  [
    "The original's whole soundtrack",
    "hyperframes measure extract .reverse/source.mp4 --out assets/sound.m4a",
  ],
  [
    "The talking head from 4.0 s to 9.5 s with its sound",
    "hyperframes measure extract .reverse/source.mp4 --from 4 --to 9.5 --roi 0,0,1080,1350 --audio --out assets/presenter.mp4",
  ],
];

/** H.264 needs even sizes: shrink an odd width or height by a pixel. */
const even = ([x, y, w, h]: Roi): Roi => [x, y, w - (w % 2), h - (h % 2)];

/** The nearest folder at or above `from` holding index.html: the project the file belongs to. */
function projectOf(from: string): string | null {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "index.html"))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

async function record(
  out: string,
  type: "image" | "video" | "bgm",
  provenance: Record<string, unknown>,
  duration?: number,
) {
  const project = projectOf(dirname(out));
  if (!project) return null;
  const { recordInPlace } = await import("../../media-use/lib/manifest.mjs");
  const { regenerateIndex } = await import("../../media-use/lib/index-gen.mjs");
  const rel = (p: string) => relative(project, p).split("\\").join("/");
  const path = rel(out);
  const from = String(provenance.from);
  if (!rel(from).startsWith("..")) provenance = { ...provenance, from: rel(from) };
  const entry = recordInPlace(project, {
    type,
    path,
    source: "extracted",
    description: `cut from the original ${String(provenance.window ?? provenance.at)}`,
    ...(duration !== undefined ? { duration } : {}),
    provenance,
  });
  regenerateIndex(project);
  return entry.id;
}

// exact=1 keeps an odd offset on 4:2:0 footage; ffmpeg otherwise moves it to the even pixel before.
const crop = (roi: Roi) => `crop=${roi[2]}:${roi[3]}:${roi[0]}:${roi[1]}:exact=1`;

/** The frame shown at `at` seconds, cropped, as a picture. */
export async function cutStill(info: VideoInfo, at: number, roi: Roi, out: string) {
  const k = frameAt(at, info.fps);
  const t = k / info.fps;
  const { extractVideoFrameToBuffer } = await import("../snapshot.js");
  const png = await extractVideoFrameToBuffer(info.path, t);
  if (!png)
    throw new Fix(`no frame at ${round(t, 3)}s`, `pick a time before ${round(info.duration, 2)}s`);
  const work = mkdtempSync(join(tmpdir(), "hf-extract-"));
  try {
    const full = join(work, "frame.png");
    writeFileSync(full, png);
    runFfmpeg(["-y", "-i", full, "-vf", crop(roi), "-frames:v", "1", out]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { at: round(t, 3), frame: k };
}

/** The frames shown from `from` to `to` seconds, cropped (to even sizes), as an H.264 clip. */
export function cutClip(
  info: VideoInfo,
  from: number,
  to: number,
  asked: Roi,
  out: string,
  opts: { audio?: boolean; crf?: number } = {},
) {
  const k0 = frameAt(from, info.fps);
  const k1 = Math.min(info.frames, Math.ceil(to * info.fps - 1e-6));
  if (k1 <= k0) throw new Fix("--to is not after --from", "--from 4 --to 9.5");
  const roi = even(asked);
  const [a, n] = [k0 / info.fps, k1 - k0];
  const sound = Boolean(opts.audio && info.audio);
  // Frames picked by index, as diff and the event map count them: a seek keeps whichever frame is showing at the
  // seek time, which at some rates is the one before k0.
  runFfmpeg([
    ...["-y", "-i", info.path],
    ...[
      "-vf",
      `trim=start_frame=${k0}:end_frame=${k1},setpts=PTS-STARTPTS,${crop(roi)},format=yuv420p`,
    ],
    ...["-r", info.fpsText, "-c:v", "libx264", "-crf", String(opts.crf ?? 14), "-preset", "medium"],
    ...(sound
      ? [
          "-af",
          `atrim=start=${a}:end=${k1 / info.fps},asetpts=PTS-STARTPTS`,
          "-c:a",
          "aac",
          "-b:a",
          "192k",
        ]
      : ["-an"]),
    ...["-movflags", "+faststart", out],
  ]);
  return {
    window: [round(a, 3), round(k1 / info.fps, 3)],
    frames: n,
    duration: round(n / info.fps, 3),
    roi,
    audio: sound,
  };
}

/** The sound from `from` to `to` seconds as an audio file, on the same clock as the picture. */
function cutSound(info: VideoInfo, from: number, to: number, out: string) {
  if (!info.audio) throw new Fix(`${info.path} has no sound`, "leave <audio> out of the rebuild");
  const [a, b] = [Math.max(0, from), Math.min(info.duration, to)];
  if (b <= a) throw new Fix("--to is not after --from", "--from 0 --to 12");
  const codec = /\.wav$/i.test(out)
    ? ["-c:a", "pcm_s16le"]
    : /\.mp3$/i.test(out)
      ? ["-c:a", "libmp3lame", "-q:a", "2"]
      : ["-c:a", "aac", "-b:a", "256k"];
  runFfmpeg(["-y", "-ss", String(a), "-i", info.path, "-t", String(b - a), "-vn", ...codec, out]);
  return { window: [round(a, 3), round(b, 3)], duration: round(b - a, 3) };
}

export default defineCommand({
  meta: {
    name: "extract",
    description:
      "Cut a still (--at) or a clip (--from/--to) out of a video, cropped to a region, as project media",
  },
  args: {
    video: videoArg,
    out: {
      type: "string",
      description: "The file to write: .png/.jpg for a still, .mp4 for a clip",
      required: true,
    },
    at: { type: "string", description: "A still of the frame shown at this second" },
    from: { type: "string", description: "A clip's first second" },
    to: { type: "string", description: "A clip's end second" },
    audio: {
      type: "boolean",
      description: "Keep the clip's sound (default: picture only)",
      default: false,
    },
    crf: { type: "string", description: "Clip quality, lower is better (default 14)" },
    roi: roiArg,
    json: jsonArg,
  },
  async run({ args }) {
    // fallow-ignore-next-line complexity
    await runMeasure(async () => {
      const { info, roi: asked } = videoAndRoi(args.video, args.roi);
      const out = resolve(String(args.out));
      mkdirSync(dirname(out), { recursive: true });
      if (/\.(m4a|aac|mp3|wav)$/i.test(out)) {
        const sound = cutSound(
          info,
          num(args.from, "--from", 0),
          num(args.to, "--to", info.duration),
          out,
        );
        const ledger = await record(
          out,
          "bgm",
          { provider: "original", from: info.path, window: sound.window },
          sound.duration,
        );
        return {
          out,
          kind: "sound",
          ...sound,
          ...(ledger ? { ledger } : {}),
          place: {
            "data-start": sound.window[0],
            "data-duration": sound.duration,
            note: "an <audio id> with this src",
          },
        };
      }
      const isClip = args.from !== undefined || args.to !== undefined;
      if (isClip === (args.at !== undefined))
        throw new Fix(
          "pass --at for a still, or --from and --to for a clip",
          "--at 3.2, or --from 4 --to 9.5",
        );
      if (!isClip) {
        if (!/\.(png|jpe?g|webp)$/i.test(out))
          throw new Fix(`${out} is not a picture`, "--out assets/name.png");
        const { at, frame: k } = await cutStill(info, num(args.at, "--at", 0), asked, out);
        const ledger = await record(out, "image", {
          provider: "original",
          from: info.path,
          at,
          roi: asked,
        });
        return {
          out,
          kind: "image",
          at,
          frame: k,
          roi: asked,
          ...(ledger ? { ledger } : {}),
          place: { left: asked[0], top: asked[1], width: asked[2], height: asked[3] },
        };
      }

      if (!/\.(mp4|mov)$/i.test(out))
        throw new Fix(`${out} is not an mp4 or mov (clips are H.264)`, "--out assets/name.mp4");
      const clip = cutClip(
        info,
        num(args.from, "--from", 0),
        num(args.to, "--to", info.duration),
        asked,
        out,
        {
          audio: args.audio,
          crf: num(args.crf, "--crf", 14),
        },
      );
      const { window, duration, roi } = clip;
      const askedEnd = num(args.to, "--to", info.duration);
      const ledger = await record(
        out,
        "video",
        { provider: "original", from: info.path, window, roi, audio: clip.audio },
        duration,
      );
      return {
        out,
        kind: "clip",
        window,
        frames: clip.frames,
        duration,
        roi,
        audio: clip.audio,
        ...(askedEnd > info.duration + 0.5 / info.fps
          ? {
              note: `--to ${askedEnd} is past the end; the clip stops at ${round(info.duration, 3)} s`,
            }
          : {}),
        ...(ledger ? { ledger } : {}),
        place: {
          "data-start": window[0],
          "data-duration": duration,
          left: roi[0],
          top: roi[1],
          width: roi[2],
          height: roi[3],
          note: "a <video> clip at the original's time and box; muted unless it carries the film's sound",
        },
      };
    });
  },
});
