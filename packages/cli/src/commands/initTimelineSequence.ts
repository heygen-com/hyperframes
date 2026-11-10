import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { findFFmpeg } from "../browser/ffmpeg.js";

export interface SequenceFiles {
  /** One file per frame, in play order. */
  files: string[];
  /** Frames whose image has no file on disk, filled from a neighbour. */
  missing: number;
}

/**
 * Finds each image on disk. A missing image is replaced by the one before it, or by the first one
 * found when the clip starts on a gap. Returns `null` when no image exists at all.
 */
export function resolveSequenceFiles(
  images: readonly string[],
  locate: (image: string) => string | undefined,
): SequenceFiles | null {
  const found = images.map((image) => locate(image));
  const first = found.find((file) => file !== undefined);
  if (first === undefined) return null;
  let held = first;
  const files = found.map((file) => {
    held = file ?? held;
    return held;
  });
  return { files, missing: found.filter((file) => file === undefined).length };
}

const quote = (file: string) => `'${file.replace(/'/g, `'\\''`)}'`;

/**
 * An ffconcat list showing each file for exactly one frame.
 *
 * Each image is also given the frame rate explicitly (`option framerate`). Without it FFmpeg reads
 * every image as one frame of a 25 fps stream and rounds each `duration` to that 40 ms grid before
 * anything else sees it, so at 60 fps two frames in three are lost or repeated: 60 distinct images
 * came out as 62 frames showing 26 of them. At 24 fps the grid happens to be close enough to hide it.
 * The last file is listed again without a duration, because the concat demuxer otherwise drops the
 * final image's time.
 */
export function concatList(files: string[], rate: number): string {
  const frame = (file: string) => [`file ${quote(file)}`, `option framerate ${rate}`];
  const lines = files.flatMap((file) => [...frame(file), `duration ${1 / rate}`]);
  return ["ffconcat version 1.0", ...lines, ...frame(files[files.length - 1] ?? ""), ""].join("\n");
}

export function ffmpegSequenceArgs(
  listFile: string,
  firstImage: string,
  rate: number,
  frameCount: number,
  out: string,
): string[] {
  // EXR holds linear light; without this it encodes dark.
  const linear = extname(firstImage).toLowerCase() === ".exr" ? ["-apply_trc", "iec61966_2_1"] : [];
  return [
    "-v",
    "error",
    "-y",
    ...linear,
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-vf",
    "pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p",
    // One output frame per listed image, at the rate: the count is bounded, not left to timestamps.
    "-frames:v",
    String(frameCount),
    "-r",
    String(rate),
    "-c:v",
    "libx264",
    "-crf",
    "16",
    "-preset",
    "fast",
    "-movflags",
    "+faststart",
    out,
  ];
}

/** Encodes the files into one H.264 video at `rate`. Returns false when it cannot. */
export function encodeSequence(files: string[], rate: number, out: string): boolean {
  const ffmpeg = findFFmpeg();
  const first = files[0];
  if (!ffmpeg || first === undefined) return false;
  const folder = mkdtempSync(join(tmpdir(), "hf-seq-"));
  try {
    const list = join(folder, "images.ffconcat");
    writeFileSync(list, concatList(files, rate), "utf-8");
    execFileSync(ffmpeg, ffmpegSequenceArgs(list, first, rate, files.length, out), {
      timeout: 600_000,
    });
    return existsSync(out);
  } catch {
    return false;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
