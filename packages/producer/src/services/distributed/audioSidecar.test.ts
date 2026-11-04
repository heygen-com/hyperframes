import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FFMPEG_PATH_ENV, getFfmpegBinary, getFfprobeBinary } from "@hyperframes/engine";
import { AUDIO_SIDECAR_MIN_BYTES, buildAudioSidecar, wantsAudioSidecar } from "./audioSidecar.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"]).status === 0;

describe("wantsAudioSidecar", () => {
  it("wants a large mp4, mov or m4v, and nothing small or of another kind", () => {
    const big = AUDIO_SIDECAR_MIN_BYTES;
    expect(wantsAudioSidecar("takes/camera.mov", big)).toBe(true);
    expect(wantsAudioSidecar("a/b.MP4", big)).toBe(true);
    expect(wantsAudioSidecar("a/b.m4v", big)).toBe(true);
    expect(wantsAudioSidecar("takes/camera.mov", big - 1)).toBe(false);
    expect(wantsAudioSidecar("a/b.webm", big)).toBe(false);
    expect(wantsAudioSidecar("a/b.wav", big)).toBe(false);
  });
});

describe.skipIf(!HAS_FFMPEG)("buildAudioSidecar", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-audio-sidecar-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const make = (name: string, args: string[]) => {
    const made = spawnSync(getFfmpegBinary(), ["-v", "error", "-y", ...args, join(dir, name)]);
    expect(made.status).toBe(0);
    return join(dir, name);
  };
  const streams = (path: string) =>
    spawnSync(getFfprobeBinary(), [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      "--",
      path,
    ])
      .stdout.toString()
      .trim()
      .split("\n");

  const withAudio = (name: string, audio: string[], map: string[] = []) =>
    make(name, [
      ...["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=3"],
      ...audio,
      ...["-map", "0:v", ...map, "-c:v", "mpeg4", "-c:a", "aac"],
    ]);
  const sine = (channels: number) => [
    ...["-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=3`],
    ...["-af", `aformat=channel_layouts=${channels === 6 ? "5.1" : "stereo"}`],
  ];

  it("builds none when the audio starts after the picture, as an input seek would land late", async () => {
    const video = withAudio("late.mov", [...["-itsoffset", "0.478"], ...sine(2)], ["-map", "1:a"]);

    expect(await buildAudioSidecar(video, join(dir, "late.m4a"))).toBe("none");
  });

  it("builds none for several audio tracks, which the video read picks between by channel count", async () => {
    const video = make("two.mov", [
      ...["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=3"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3"],
      ...["-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=3"],
      ...[
        "-filter_complex",
        "[1:a]aformat=channel_layouts=stereo[a];[2:a]aformat=channel_layouts=5.1[b]",
      ],
      ...["-map", "0:v", "-map", "[a]", "-map", "[b]", "-c:v", "mpeg4", "-c:a", "aac"],
    ]);

    expect(await buildAudioSidecar(video, join(dir, "two.m4a"))).toBe("none");
  });

  it("copies the audio out of a video, without the picture", async () => {
    const video = make("take.mp4", [
      ...["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=3"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3"],
      ...["-c:v", "mpeg4", "-c:a", "aac"],
    ]);
    const out = join(dir, "take.audio.m4a");

    expect(await buildAudioSidecar(video, out)).toBe("built");
    expect(streams(out)).toEqual(["audio"]);
    expect(statSync(out).size).toBeLessThan(statSync(video).size);
  });

  it("makes nothing from a video with no audio", async () => {
    const video = make("silent.mp4", [
      ...["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=2"],
      ...["-c:v", "mpeg4"],
    ]);

    expect(await buildAudioSidecar(video, join(dir, "silent.audio.m4a"))).toBe("none");
  });

  it("says so when there is no ffmpeg to run", async () => {
    const before = process.env[FFMPEG_PATH_ENV];
    process.env[FFMPEG_PATH_ENV] = join(dir, "no-such-ffmpeg");
    try {
      expect(await buildAudioSidecar(join(dir, "x.mp4"), join(dir, "x.m4a"))).toBe("unavailable");
    } finally {
      if (before === undefined) delete process.env[FFMPEG_PATH_ENV];
      else process.env[FFMPEG_PATH_ENV] = before;
    }
  });
});
