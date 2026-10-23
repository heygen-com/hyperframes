import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function writeIphoneClip(ffmpeg: string, dir: string, seconds = 1): string {
  const base = join(dir, "base.mov");
  execFileSync(ffmpeg, [
    ...["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc=s=64x64:d=${seconds}`],
    ...["-f", "lavfi", "-i", `anoisesrc=d=${seconds},aformat=channel_layouts=4.0`],
    ...["-f", "lavfi", "-i", `sine=frequency=1000:duration=${seconds}:sample_rate=48000`],
    ...["-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "libx264"],
    ...["-c:a:0", "pcm_s16le", "-c:a:1", "aac", "-movflags", "+faststart", base],
  ]);
  // Apple's spatial-audio fourcc on the PCM track (the first `sowt`, as faststart puts the header first).
  const bytes = readFileSync(base);
  bytes.write("apac", bytes.indexOf("sowt"), "latin1");
  const clip = join(dir, "iphone.mov");
  writeFileSync(clip, bytes);
  return clip;
}
