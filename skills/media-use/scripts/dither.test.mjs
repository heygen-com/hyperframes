import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./dither.mjs", import.meta.url));
const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "media-use-dither-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args, "--json"], { encoding: "utf8" });
}

test("processes an image into the requested ordered palette", { skip: !HAS_FFMPEG }, (t) => {
  const { dir, cleanup } = fixture();
  t.after(cleanup);
  const input = join(dir, "source.png");
  const output = join(dir, "dithered.png");
  ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=16x12:rate=1", "-frames:v", "1", input]);

  const result = run([
    "--input",
    input,
    "--out",
    output,
    "--algorithm",
    "floyd-steinberg",
    "--palette",
    "#000000,#ffffff",
    "--point-size",
    "3",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).type, "image");

  const rgb = execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    output,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-",
  ]);
  for (let index = 0; index < rgb.length; index += 3) {
    const value = rgb[index];
    assert.ok(value === 0 || value === 255);
    assert.equal(rgb[index + 1], value);
    assert.equal(rgb[index + 2], value);
  }
});

test("processes moving MP4 frames, audio, and BT.709 metadata", { skip: !HAS_FFMPEG }, (t) => {
  const { dir, cleanup } = fixture();
  t.after(cleanup);
  const input = join(dir, "source.mp4");
  const output = join(dir, "dithered.mp4");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=16x12:rate=3:duration=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    input,
  ]);

  const result = run([
    "--input",
    input,
    "--out",
    output,
    "--algorithm",
    "atkinson",
    "--palette",
    "#0f380f,#306230,#8bac0f,#9bbc0f",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", output],
      {
        encoding: "utf8",
      },
    ),
  );
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  assert.equal(video.width, 16);
  assert.equal(video.height, 12);
  assert.equal(video.nb_frames, "6");
  assert.equal(video.color_space, "bt709");
  assert.equal(video.color_transfer, "bt709");
  assert.equal(video.color_primaries, "bt709");
  assert.equal(video.color_range, "tv");
  assert.equal(audio.codec_name, "aac");
  assert.ok(Number(probe.format.duration) < 2.5, "audio must not outlive processed video");
  const keyframes = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-skip_frame",
      "nokey",
      "-show_entries",
      "frame=best_effort_timestamp_time",
      "-of",
      "csv=p=0",
      output,
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split(/\s+/)
    .map((value) => Number.parseFloat(value));
  assert.deepEqual(keyframes, [0, 1]);
});

test("rejects tagged PQ or HLG instead of silently producing SDR", { skip: !HAS_FFMPEG }, (t) => {
  const { dir, cleanup } = fixture();
  t.after(cleanup);
  const input = join(dir, "hlg.mp4");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=white:size=16x12:rate=1:duration=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p10le",
    "-x264-params",
    "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc",
    "-color_primaries:v",
    "bt2020",
    "-color_trc:v",
    "arib-std-b67",
    "-colorspace:v",
    "bt2020nc",
    input,
  ]);

  const result = run(["--input", input, "--out", join(dir, "wrong.mp4")]);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /HDR arib-std-b67 input is not supported/);
});
