import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFfmpegBinary, getFfprobeBinary } from "../utils/ffmpegBinaries.js";
import { muxVideoWithAudio } from "./chunkEncoder.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"]).status === 0;

function ffmpeg(args: string[]): Buffer {
  const result = spawnSync(getFfmpegBinary(), ["-nostdin", "-v", "error", "-y", ...args]);
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
}

describe.skipIf(!HAS_FFMPEG)("WebM audio muxing", () => {
  let dir: string;
  let video: string;
  let audio: string;
  let sourceFrames: Buffer;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-mux-container-"));
    video = join(dir, "video.webm");
    audio = join(dir, "audio.m4a");
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=64x36:rate=10:duration=1",
      "-c:v",
      "libvpx-vp9",
      "-deadline",
      "realtime",
      video,
    ]);
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=1",
      "-c:a",
      "aac",
      audio,
    ]);
    sourceFrames = ffmpeg(["-i", video, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it.each(["webm", "WEBM", "WeBm"])(
    "muxes AAC as Opus into .%s without changing the video frames",
    async (extension) => {
      const output = join(dir, `output.${extension}`);
      const result = await muxVideoWithAudio(video, audio, output, undefined, {
        audioCodec: "aac",
      });
      expect(result.success, result.error).toBe(true);

      const probe = spawnSync(
        getFfprobeBinary(),
        ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", "--", output],
        { encoding: "utf8" },
      );
      expect(probe.status, probe.stderr).toBe(0);
      expect(probe.stdout.trim().split(/\r?\n/)).toEqual(["vp9", "opus"]);
      expect(ffmpeg(["-i", output, "-an", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])).toEqual(
        sourceFrames,
      );

      const pcm = ffmpeg(["-i", output, "-vn", "-t", "0.5", "-ac", "1", "-f", "s16le", "-"]);
      let energy = 0;
      for (let i = 0; i < pcm.length; i += 2) energy += pcm.readInt16LE(i) ** 2;
      expect(Math.sqrt(energy / (pcm.length / 2))).toBeGreaterThan(100);
    },
  );
});
