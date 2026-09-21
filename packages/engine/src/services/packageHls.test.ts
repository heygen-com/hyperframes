import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFfmpegBinary, getFfprobeBinary } from "../utils/ffmpegBinaries.js";
import {
  HLS_AUDIO_PLAYLIST,
  HLS_MASTER_PLAYLIST,
  HLS_VIDEO_PLAYLIST,
  appendLockedGopArgs,
  lockedGopCodecParams,
  stripAudioOnlyVariants,
} from "./chunkEncoder.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.resetModules();
  vi.doUnmock("child_process");
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-package-hls-"));
  tempDirs.push(dir);
  return dir;
}

type FakeProc = EventEmitter & { stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };

type SpawnCall = { command: string; args: readonly string[]; proc: FakeProc };

function createSpawnSpy(): {
  spawn: (command: string, args: readonly string[]) => FakeProc;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  const spawn = (command: string, args: readonly string[]): FakeProc => {
    const proc = new EventEmitter() as FakeProc;
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn(() => true);
    calls.push({ command, args, proc });
    return proc;
  };
  return { spawn, calls };
}

async function capturePackageHlsArgs(
  audioPath: string | null,
  options: { segmentSeconds: number },
  exitCode = 0,
  stderr?: string,
): Promise<{
  args: readonly string[];
  outputDir: string;
  result: Awaited<ReturnType<typeof import("./chunkEncoder.js").packageHls>>;
}> {
  const { spawn, calls } = createSpawnSpy();
  vi.resetModules();
  vi.doMock("child_process", () => ({ spawn }));

  const { packageHls } = await import("./chunkEncoder.js");
  const outputDir = join(makeTempDir(), "hls");
  const promise = packageHls("/tmp/video-only.mp4", audioPath, outputDir, options);

  const proc = calls[0]!.proc;
  if (stderr !== undefined) proc.stderr.emit("data", Buffer.from(stderr));
  proc.emit("exit", exitCode);
  proc.emit("close", exitCode);

  return { args: calls[0]!.args, outputDir, result: await promise };
}

function argValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe("packageHls arguments", () => {
  it("stream-copies both inputs as split renditions when audio is present", async () => {
    const { args } = await capturePackageHlsArgs("/tmp/audio.m4a", { segmentSeconds: 4 });

    expect(args.filter((a) => a === "-i")).toHaveLength(2);
    expect(args).toContain("/tmp/video-only.mp4");
    expect(args).toContain("/tmp/audio.m4a");
    expect(argValue(args, "-map")).toBe("0:v:0");
    expect(args.slice(args.indexOf("-map") + 2)).toContain("1:a:0");
    expect(argValue(args, "-var_stream_map")).toBe(
      "v:0,agroup:aud,name:video a:0,agroup:aud,name:audio",
    );
  });

  it("maps video only, with no audio group, when audioPath is null", async () => {
    const { args } = await capturePackageHlsArgs(null, { segmentSeconds: 4 });

    expect(args.filter((a) => a === "-i")).toHaveLength(1);
    expect(argValue(args, "-var_stream_map")).toBe("v:0,name:video");
    expect(args.join(" ")).not.toContain("agroup");
    expect(args.join(" ")).not.toContain("1:a:0");
  });

  it("never re-encodes", async () => {
    const { args } = await capturePackageHlsArgs("/tmp/audio.m4a", { segmentSeconds: 4 });

    expect(argValue(args, "-c")).toBe("copy");
    expect(args).not.toContain("-c:v");
    expect(args).not.toContain("-c:a");
    expect(args).not.toContain("-crf");
    expect(args).not.toContain("-b:v");
  });

  it("requests VOD playlists with independent mpegts segments", async () => {
    const { args } = await capturePackageHlsArgs("/tmp/audio.m4a", { segmentSeconds: 4 });

    expect(argValue(args, "-f")).toBe("hls");
    expect(argValue(args, "-hls_playlist_type")).toBe("vod");
    expect(argValue(args, "-hls_flags")).toBe("independent_segments");
    expect(argValue(args, "-hls_segment_type")).toBe("mpegts");
    expect(argValue(args, "-master_pl_name")).toBe(HLS_MASTER_PLAYLIST);
  });

  it("zeroes the mpegts mux base", async () => {
    const { args } = await capturePackageHlsArgs("/tmp/audio.m4a", { segmentSeconds: 4 });
    expect(argValue(args, "-muxdelay")).toBe("0");
    expect(argValue(args, "-muxpreload")).toBe("0");
  });

  it("passes segmentSeconds through to -hls_time", async () => {
    const { args } = await capturePackageHlsArgs("/tmp/audio.m4a", { segmentSeconds: 6 });
    expect(argValue(args, "-hls_time")).toBe("6");
  });

  it("writes the %v-templated playlists and segments into the output directory", async () => {
    const { args, outputDir } = await capturePackageHlsArgs("/tmp/audio.m4a", {
      segmentSeconds: 4,
    });

    expect(argValue(args, "-hls_segment_filename")).toBe(join(outputDir, "%v_%05d.ts"));
    expect(args.at(-1)).toBe(join(outputDir, "%v.m3u8"));
    expect(argValue(args, "-y")).toBe(join(outputDir, "%v.m3u8"));
  });

  it("omits the mp4-only mux args that MPEG-TS cannot carry", async () => {
    const { args } = await capturePackageHlsArgs("/tmp/audio.m4a", { segmentSeconds: 4 });

    expect(args).not.toContain("-movflags");
    expect(args).not.toContain("-r");
    expect(args).not.toContain("-avoid_negative_ts");
  });

  it("creates the output directory, which ffmpeg will not do itself", async () => {
    const { outputDir } = await capturePackageHlsArgs(null, { segmentSeconds: 4 });
    expect(existsSync(outputDir)).toBe(true);
  });

  it("reports the directory as the output path", async () => {
    const { outputDir, result } = await capturePackageHlsArgs(null, { segmentSeconds: 4 });
    expect(result).toMatchObject({ success: true, outputPath: outputDir });
  });

  it("surfaces an ffmpeg failure as an error string", async () => {
    const { result } = await capturePackageHlsArgs(
      null,
      { segmentSeconds: 4 },
      1,
      "Invalid data found when processing input\n",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("FFmpeg exited with code 1");
    expect(result.error).toContain("Invalid data found");
  });

  it("preserves an external interruption so the job can retry on a fresh host", async () => {
    const { result } = await capturePackageHlsArgs(
      null,
      { segmentSeconds: 4 },
      255,
      "Exiting normally, received signal 15.\n",
    );

    expect(result).toMatchObject({ success: false, failureReason: "external_interruption" });
  });
});

describe("stripAudioOnlyVariants", () => {
  // Shape ffmpeg 7 writes for `v:0,agroup:aud a:0,agroup:aud`, trimmed.
  const MEDIA =
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="group_aud",NAME="audio_1",DEFAULT=YES,URI="audio.m3u8"';
  const VIDEO_VARIANT =
    '#EXT-X-STREAM-INF:BANDWIDTH=49256,RESOLUTION=320x180,CODECS="avc1.42c00d,mp4a.40.2",AUDIO="group_aud"';
  const AUDIO_VARIANT = '#EXT-X-STREAM-INF:BANDWIDTH=231375,CODECS="mp4a.40.2",AUDIO="group_aud"';

  it("removes the audio-only variant and its URI, keeping the rendition group", () => {
    const master = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      MEDIA,
      VIDEO_VARIANT,
      "video.m3u8",
      "",
      AUDIO_VARIANT,
      "audio.m3u8",
      "",
    ].join("\n");

    expect(stripAudioOnlyVariants(master)).toBe(
      ["#EXTM3U", "#EXT-X-VERSION:3", MEDIA, VIDEO_VARIANT, "video.m3u8", ""].join("\n"),
    );
  });

  it("leaves a master with only a video variant untouched", () => {
    const master = ["#EXTM3U", "#EXT-X-VERSION:3", VIDEO_VARIANT, "video.m3u8", ""].join("\n");
    expect(stripAudioOnlyVariants(master)).toBe(master);
  });
});

describe("packageHls segmentSeconds validation", () => {
  it.each([0, -4, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "throws on segmentSeconds=%s",
    async (segmentSeconds) => {
      const { packageHls } = await import("./chunkEncoder.js");
      await expect(
        packageHls("/tmp/video.mp4", null, join(makeTempDir(), "hls"), { segmentSeconds }),
      ).rejects.toThrow(/positive integer segmentSeconds/);
    },
  );
});

describe("packageHls outputDir validation", () => {
  it("rejects a directory containing % before spawning ffmpeg", async () => {
    const { spawn, calls } = createSpawnSpy();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));
    const { packageHls } = await import("./chunkEncoder.js");

    const outputDir = join(makeTempDir(), "pct%20dir");
    await expect(
      packageHls("/tmp/video.mp4", null, outputDir, { segmentSeconds: 4 }),
    ).rejects.toThrow(/outputDir must not contain "%"/);
    expect(calls).toHaveLength(0);
    expect(existsSync(outputDir)).toBe(false);
  });
});

describe.skipIf(!HAS_FFMPEG)("packageHls against real ffmpeg", () => {
  const FPS = 30;
  const DURATION = 4;
  const SEGMENT_SECONDS = 1;

  let dir: string;
  beforeEach(() => {
    dir = makeTempDir();
  });

  // `.concat` rather than a spread inside an array literal: this is an FFMPEG
  // wrapper, whose trailing positional is an OUTPUT path and therefore takes no
  // `--` terminator, but a verbosity-flag-then-spread array literal is
  // indistinguishable from the ffPROBE wrapper shape that must have one. See
  // the `SPREAD_WRAPPER` matcher in
  // `producer/src/utils/ffprobeArgvContract.test.ts`, which reads raw source —
  // so an example argv in a comment trips it too.
  const run = (args: string[]): void => {
    const argv = ["-v", "error"].concat(args);
    const res = spawnSync(getFfmpegBinary(), argv, { encoding: "utf-8" });
    if (res.status !== 0) throw new Error(`ffmpeg failed: ${res.stderr ?? ""}`);
  };

  /**
   * `inputPath` is a parameter rather than the caller's last argv entry so the
   * `--` terminator is the penultimate literal token, which is what
   * `producer/src/utils/ffprobeArgvContract.test.ts` checks at the source level
   * across the whole tree — a `join(dir, name)` call in that slot reads as two
   * comma-separated entries to its parser and trips the gate.
   */
  const probe = (inputPath: string, args: readonly string[]): string => {
    const argv = ["-v", "error", ...args, "--", inputPath];
    const res = spawnSync(getFfprobeBinary(), argv, { encoding: "utf-8" });
    if (res.status !== 0) throw new Error(`ffprobe failed: ${res.stderr ?? ""}`);
    return res.stdout.trim();
  };

  /** Same GOP lock args `buildEncoderArgs` emits for the software path. */
  const lockedVideo = (): string => {
    const path = join(dir, "video-only.mp4");
    const gop = SEGMENT_SECONDS * FPS;
    const gopArgs: string[] = [];
    appendLockedGopArgs(gopArgs, gop);
    gopArgs.push("-x264-params", lockedGopCodecParams("h264", gop));
    run([
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=160x120:rate=${FPS}:duration=${DURATION}`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      ...gopArgs,
      "-bf",
      "0",
      "-y",
      path,
    ]);
    return path;
  };

  const aacSidecar = (): string => {
    const path = join(dir, "audio.m4a");
    run([
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${DURATION}`,
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-y",
      path,
    ]);
    return path;
  };

  const extinfs = (playlist: string): number[] =>
    readFileSync(playlist, "utf-8")
      .split("\n")
      .filter((line) => line.startsWith("#EXTINF:"))
      .map((line) => Number.parseFloat(line.slice("#EXTINF:".length)));

  it("produces a VOD master with split audio and video renditions", async () => {
    const { packageHls } = await import("./chunkEncoder.js");
    const outputDir = join(dir, "out");

    const result = await packageHls(lockedVideo(), aacSidecar(), outputDir, {
      segmentSeconds: SEGMENT_SECONDS,
    });
    expect(result.success).toBe(true);

    const master = readFileSync(join(outputDir, HLS_MASTER_PLAYLIST), "utf-8");
    expect(master).toContain(HLS_VIDEO_PLAYLIST);
    expect(master).toContain(HLS_AUDIO_PLAYLIST);
    expect(master).toContain("#EXT-X-MEDIA:TYPE=AUDIO");

    // One selectable variant: the video, with audio attached as a rendition
    // group. ffmpeg also emits the audio as its own variant; that is stripped
    // so a bandwidth-driven player can never pick sound without picture.
    const variants = master.split("\n").filter((line) => line.startsWith("#EXT-X-STREAM-INF:"));
    expect(variants).toHaveLength(1);
    expect(variants[0]).toContain("RESOLUTION=");
    expect(variants[0]).toContain('AUDIO="');
    expect(master).toMatch(/#EXT-X-MEDIA:TYPE=AUDIO[^\n]*URI="audio\.m3u8"/);

    const videoPlaylist = readFileSync(join(outputDir, HLS_VIDEO_PLAYLIST), "utf-8");
    expect(videoPlaylist).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
    expect(videoPlaylist).toContain("#EXT-X-INDEPENDENT-SEGMENTS");
    expect(videoPlaylist).toContain("#EXT-X-ENDLIST");
  });

  it("cuts fixed-length segments and keeps the full duration", async () => {
    const { packageHls } = await import("./chunkEncoder.js");
    const outputDir = join(dir, "out");

    await packageHls(lockedVideo(), aacSidecar(), outputDir, {
      segmentSeconds: SEGMENT_SECONDS,
    });

    const segments = readdirSync(outputDir).filter((f) => f.startsWith("video_"));
    expect(segments).toHaveLength(Math.ceil(DURATION / SEGMENT_SECONDS));

    for (const extinf of extinfs(join(outputDir, HLS_VIDEO_PLAYLIST))) {
      expect(extinf).toBeCloseTo(SEGMENT_SECONDS, 3);
    }

    const probedDuration = Number.parseFloat(
      probe(join(outputDir, HLS_VIDEO_PLAYLIST), [
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
      ]),
    );
    expect(Math.abs(probedDuration - DURATION)).toBeLessThanOrEqual(1 / FPS);
  });

  it("starts every video segment on a keyframe", async () => {
    const { packageHls } = await import("./chunkEncoder.js");
    const outputDir = join(dir, "out");

    await packageHls(lockedVideo(), null, outputDir, { segmentSeconds: SEGMENT_SECONDS });

    const segments = readdirSync(outputDir)
      .filter((f) => f.startsWith("video_"))
      .sort();
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      const firstFrame = probe(join(outputDir, segment), [
        "-select_streams",
        "v",
        "-show_frames",
        "-show_entries",
        "frame=key_frame",
        "-of",
        "csv=p=0",
        "-read_intervals",
        "%+#1",
      ]);
      expect(firstFrame.split(",")[0]).toBe("1");
    }
  });

  it("writes a master and no audio playlist when there is no audio", async () => {
    const { packageHls } = await import("./chunkEncoder.js");
    const outputDir = join(dir, "out");

    const result = await packageHls(lockedVideo(), null, outputDir, {
      segmentSeconds: SEGMENT_SECONDS,
    });
    expect(result.success).toBe(true);

    expect(existsSync(join(outputDir, HLS_MASTER_PLAYLIST))).toBe(true);
    expect(existsSync(join(outputDir, HLS_VIDEO_PLAYLIST))).toBe(true);
    expect(existsSync(join(outputDir, HLS_AUDIO_PLAYLIST))).toBe(false);
    expect(readdirSync(outputDir).filter((f) => f.startsWith("audio"))).toHaveLength(0);
  });

  it("starts at PTS 0 with the AAC priming packet one frame ahead of video", async () => {
    const { packageHls } = await import("./chunkEncoder.js");
    const AAC_FRAME_SECONDS = 1024 / 44100;
    const outputDir = join(dir, "out");

    await packageHls(lockedVideo(), aacSidecar(), outputDir, {
      segmentSeconds: SEGMENT_SECONDS,
    });

    const audioPts = probe(join(outputDir, HLS_AUDIO_PLAYLIST), [
      "-select_streams",
      "a",
      "-show_entries",
      "packet=pts_time",
      "-of",
      "csv=p=0",
      "-read_intervals",
      "%+#3",
    ])
      .split("\n")
      .map((line) => Number.parseFloat(line));
    const videoPts = Number.parseFloat(
      probe(join(outputDir, HLS_VIDEO_PLAYLIST), [
        "-select_streams",
        "v",
        "-show_entries",
        "packet=pts_time",
        "-of",
        "csv=p=0",
        "-read_intervals",
        "%+#1",
      ]).split("\n")[0]!,
    );

    expect(audioPts[0]).toBeCloseTo(0, 3);
    expect(videoPts).toBeCloseTo(AAC_FRAME_SECONDS, 3);
    expect(audioPts[1]).toBeCloseTo(videoPts, 3);
  });

  it("cannot cut on time without the GOP lock", async () => {
    const { packageHls } = await import("./chunkEncoder.js");
    const unlocked = join(dir, "unlocked.mp4");
    run([
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=160x120:rate=${FPS}:duration=${DURATION}`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-bf",
      "0",
      "-y",
      unlocked,
    ]);

    const outputDir = join(dir, "out-unlocked");
    await packageHls(unlocked, null, outputDir, { segmentSeconds: SEGMENT_SECONDS });

    const durations = extinfs(join(outputDir, HLS_VIDEO_PLAYLIST));
    expect(durations).toHaveLength(1);
    expect(durations[0]).toBeCloseTo(DURATION, 3);
  });
});
