import { afterAll, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createFrameLookupTable,
  extractAllVideoFrames,
  parseVideoElements,
} from "../../../engine/src/services/videoFrameExtractor.ts";
import {
  parseAudioElements,
  processCompositionAudio,
} from "../../../engine/src/services/audioMixer.ts";

const workDirs: string[] = [];

afterAll(() => {
  if (process.env.HF_KEEP_PLAYBACK_RATE_FIXTURE === "1") return;
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

function ffmpeg(args: string[]) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], {
    encoding: null,
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr.toString("utf8")}`);
  }
  return result.stdout;
}

function ffprobeDuration(path: string): number {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "--", path],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`ffprobe failed: ${result.stderr}`);
  return Number.parseFloat(result.stdout.trim());
}

function sampleRgb(path: string, time: number): [number, number, number] {
  const rgb = ffmpeg([
    "-ss",
    String(time),
    "-i",
    path,
    "-frames:v",
    "1",
    "-vf",
    "scale=1:1",
    "-pix_fmt",
    "rgb24",
    "-f",
    "rawvideo",
    "-",
  ]);
  return [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0];
}

function dominant(rgb: [number, number, number]): "red" | "green" | "blue" | "yellow" {
  const [r, g, b] = rgb;
  if (r > 130 && g > 130 && b < 100) return "yellow";
  if (r >= g && r >= b) return "red";
  if (g >= r && g >= b) return "green";
  return "blue";
}

function sampleFrequency(path: string, center: number): number {
  const duration = 0.2;
  const pcm = ffmpeg([
    "-ss",
    String(center - duration / 2),
    "-t",
    String(duration),
    "-i",
    path,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-f",
    "s16le",
    "-",
  ]);
  let crossings = 0;
  let previous = pcm.readInt16LE(0);
  for (let offset = 2; offset + 1 < pcm.length; offset += 2) {
    const current = pcm.readInt16LE(offset);
    if ((previous < 0 && current >= 0) || (previous >= 0 && current < 0)) crossings += 1;
    previous = current;
  }
  return crossings / (2 * duration);
}

test(
  "final render keeps timecoded picture and pitch-preserved sound aligned at 2x",
  async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-playback-rate-parity-"));
    workDirs.push(projectDir);
    const source = join(projectDir, "timecoded.mp4");
    const output = join(projectDir, "out.mp4");

    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=160x90:r=10:d=1",
      "-f",
      "lavfi",
      "-i",
      "color=c=green:s=160x90:r=10:d=1",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x90:r=10:d=1",
      "-f",
      "lavfi",
      "-i",
      "color=c=yellow:s=160x90:r=10:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:sample_rate=48000:duration=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=48000:duration=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1100:sample_rate=48000:duration=1",
      "-filter_complex",
      "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v];[4:a][5:a][6:a][7:a]concat=n=4:v=0:a=1[a]",
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      "-y",
      source,
    ]);

    const html = `<!doctype html><html><body style="margin:0;background:black">
<div id="root" data-composition-id="rate-parity" data-start="0" data-duration="2" data-width="160" data-height="90" data-fps="10">
  <video id="picture" src="timecoded.mp4" data-start="0" data-duration="2" data-track-index="0" data-playback-rate="2" muted playsinline style="position:absolute;inset:0;width:160px;height:90px;object-fit:fill"></video>
  <audio id="sound" src="timecoded.mp4" data-start="0" data-duration="2" data-end="2" data-track-index="10" data-playback-rate="2"></audio>
</div></body></html>`;

    const videoElements = parseVideoElements(html);
    const extracted = await extractAllVideoFrames(videoElements, projectDir, {
      fps: 10,
      outputDir: join(projectDir, "extracted"),
      format: "png",
      timelineEnd: 2,
    });
    expect(extracted.errors).toEqual([]);

    const audioElements = parseAudioElements(html);
    const audioPath = join(projectDir, "audio.m4a");
    const audio = await processCompositionAudio(
      audioElements,
      projectDir,
      join(projectDir, "audio-work"),
      audioPath,
      2,
    );
    expect(audio.success).toBe(true);

    const framesDir = join(projectDir, "timeline-frames");
    mkdirSync(framesDir);
    const lookup = createFrameLookupTable(videoElements, extracted.extracted);
    for (let frame = 0; frame < 20; frame += 1) {
      const framePath = lookup.getFrame("picture", frame / 10);
      if (!framePath) throw new Error(`missing picture frame ${frame}`);
      copyFileSync(framePath, join(framesDir, `frame_${String(frame + 1).padStart(5, "0")}.png`));
    }
    ffmpeg([
      "-framerate",
      "10",
      "-i",
      join(framesDir, "frame_%05d.png"),
      "-i",
      audioPath,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-t",
      "2",
      "-y",
      output,
    ]);

    const duration = ffprobeDuration(output);
    expect(duration).toBeWithin(1.95, 2.05);
    const proofTimes = [0.25, 0.75, 1.25, 1.75];
    const colors = proofTimes.map((time) => dominant(sampleRgb(output, time)));
    expect(colors).toEqual(["red", "green", "blue", "yellow"]);
    const frequencies = proofTimes.map((time) => sampleFrequency(output, time));
    for (const [actual, expected] of frequencies.map((value, index) => [
      value,
      [440, 660, 880, 1100][index]!,
    ])) {
      expect(actual).toBeWithin(expected - 30, expected + 30);
    }
    console.log(
      `[playback-rate-proof] ${JSON.stringify({
        output,
        sha256: createHash("sha256").update(readFileSync(output)).digest("hex"),
        duration,
        proofTimes,
        colors,
        frequencies,
      })}`,
    );
  },
  120_000,
);
