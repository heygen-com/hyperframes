import { spawnSync } from "node:child_process";
import { getFfmpegBinary } from "@hyperframes/engine";

export const FFMPEG = getFfmpegBinary();
export const HAS_FFMPEG = spawnSync(FFMPEG, ["-version"], { encoding: "utf-8" }).status === 0;

/** Mean grey level of every frame of an encoded video, 0-255. */
export function frameLevels(videoPath: string, width: number, height: number): number[] {
  const raw = spawnSync(
    FFMPEG,
    ["-v", "error", "-i", videoPath, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (raw.status !== 0) throw new Error(`decode failed: ${raw.stderr}`);
  const frameBytes = width * height;
  const levels: number[] = [];
  for (let offset = 0; offset + frameBytes <= raw.stdout.length; offset += frameBytes) {
    let sum = 0;
    for (let i = offset; i < offset + frameBytes; i++) sum += raw.stdout[i]!;
    levels.push(sum / frameBytes);
  }
  return levels;
}
