import { defineCommand } from "../../utils/defineCommand.js";
import type { Example } from "../_examples.js";
import { jsonArg, runMeasure, videoArg } from "../../measure/command.js";
import {
  ffmpegBin,
  Fix,
  probeVideo,
  round,
  runFfmpeg,
  type VideoInfo,
} from "../../measure/media.js";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const examples: Example[] = [
  [
    "Size, frame rate, sound, and what to fix before rebuilding",
    "hyperframes measure probe ref.mp4",
  ],
  [
    "Make a constant-rate SDR working copy of a phone or HDR video",
    "hyperframes measure probe ref.mp4 --normalize original.mp4",
  ],
];

// Sections longer than this are analysed and checked one at a time.
const SECTION_S = 60;
const STANDARD = ["24000/1001", "24", "25", "30000/1001", "30", "50", "60000/1001", "60"];
const rateOf = (text: string) => {
  const [a, b] = text.split("/").map(Number);
  return (a ?? 0) / (b || 1);
};

/** The standard frame rate closest to a variable-rate video's average. */
const standardRate = (info: VideoInfo) =>
  STANDARD.reduce((best, r) =>
    Math.abs(rateOf(r) - info.avgFps) < Math.abs(rateOf(best) - info.avgFps) ? r : best,
  );

const hasFilter = (name: string) =>
  new RegExp(`\\s${name}\\s`).test(
    execFileSync(ffmpegBin(), ["-hide_banner", "-filters"], { windowsHide: true }).toString(),
  );

/** A constant-rate SDR H.264 copy: what the measuring tools, diff and the render all read the same way. */
function normalize(info: VideoInfo, out: string): { path: string; fps: string } {
  const fps = info.vfr ? standardRate(info) : info.fpsText;
  const filters = [`fps=${fps}`];
  if (info.hdr) {
    if (!hasFilter("zscale"))
      throw new Fix(
        "this ffmpeg cannot tone-map HDR (no zscale filter)",
        "install an ffmpeg built with libzimg, e.g. brew install ffmpeg",
      );
    filters.push(
      "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv",
    );
  }
  mkdirSync(dirname(out), { recursive: true });
  runFfmpeg([
    ...["-y", "-i", info.path, "-vf", [...filters, "format=yuv420p"].join(",")],
    ...["-c:v", "libx264", "-crf", "12", "-preset", "medium", "-c:a", "aac", "-b:a", "192k", out],
  ]);
  return { path: out, fps };
}

export default defineCommand({
  meta: {
    name: "probe",
    description:
      "Size (as displayed), frame rate, duration, sound, and what to fix before measuring or rebuilding",
  },
  args: {
    video: videoArg,
    normalize: {
      type: "string",
      description:
        "Write a constant-frame-rate SDR copy here (for variable-rate or HDR videos); the original is left alone",
    },
    json: jsonArg,
  },
  async run({ args }) {
    // fallow-ignore-next-line complexity
    await runMeasure(() => {
      const info = probeVideo(String(args.video));
      const notes: string[] = [];
      if (info.vfr)
        notes.push(
          "variable frame rate: frame times drift, so measure and rebuild a constant-rate copy (--normalize)",
        );
      if (info.hdr) notes.push("HDR: --normalize tone-maps an SDR copy; the render is SDR");
      if (info.duration > SECTION_S)
        notes.push(
          `longer than ${SECTION_S} s: analyse and check it in sections of at most ${SECTION_S} s, split at cuts (measure cuts)`,
        );
      if (!info.audio) notes.push("no sound: the rebuild has no <audio>");
      const made = args.normalize ? normalize(info, resolve(String(args.normalize))) : undefined;
      return {
        video: info.path,
        width: info.width,
        height: info.height,
        fps: round(info.fps, 3),
        fps_text: info.fpsText,
        duration: round(info.duration, 3),
        frames: info.frames,
        picture_duration: round(info.frames / info.fps, 3),
        audio: info.audio,
        vfr: info.vfr,
        hdr: info.hdr,
        codec: info.codec,
        canvas: {
          width: info.width,
          height: info.height,
          fps: made?.fps ?? info.fpsText,
          duration: round(info.frames / info.fps, 3),
          note: "data-width, data-height and data-duration (the picture's length) on the root composition; render with --fps at this rate",
        },
        ...(made ? { normalized: made.path } : {}),
        notes,
        ...((info.vfr || info.hdr) && !made
          ? {
              fix: `npx hyperframes measure probe ${String(args.video)} --normalize <working-copy.mp4>`,
            }
          : {}),
      };
    });
  },
});
