/**
 * One real `format: "hls"` render, end to end.
 *
 * This is the only test in the series that proves the whole contract the VOD
 * consumer asked for, and every piece of it is something a mocked test cannot
 * see: that the orchestrator's GOP lock actually reaches libx264, that
 * `-hls_time` therefore cuts on the segment boundary rather than at whatever
 * keyframe happened to be nearby, that every segment starts on an IDR frame,
 * and that the artifact transaction publishes a directory whose playlist
 * probes to the right duration.
 *
 * Needs Chrome + ffmpeg, so it lives in the integration lane
 * (`scripts/test-classification.mjs`). `render` is ~10 s of 320x180 frames to
 * keep it affordable.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFfmpegBinary, getFfprobeBinary, resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "../renderOrchestrator.js";

const FFMPEG = getFfmpegBinary();
const FFPROBE = getFfprobeBinary();
const HAS_FFMPEG = spawnSync(FFMPEG, ["-version"], { encoding: "utf-8" }).status === 0;

const DURATION_SECONDS = 10;
const SEGMENT_SECONDS = 4;
const FPS = 30;
// `-hls_time` closes a segment at the first keyframe at or after the target,
// so the last segment holds the remainder: 4 + 4 + 2.
const EXPECTED_VIDEO_SEGMENTS = Math.ceil(DURATION_SECONDS / SEGMENT_SECONDS);

const COMPOSITION = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: #111; }
    .scene { position: absolute; inset: 0; }
    #a { background: #1a1a2e; }
    #b { background: #0f3460; }
  </style>
</head>
<body>
  <div
    id="root"
    data-composition-id="hls-vod"
    data-start="0"
    data-duration="${DURATION_SECONDS}"
    data-width="320"
    data-height="180"
    data-fps="${FPS}"
    data-no-timeline
  >
    <audio src="assets/tone.wav" data-start="0" data-duration="${DURATION_SECONDS}" data-volume="0.5"></audio>
    <section id="a" class="scene clip" data-start="0" data-duration="5" data-track-index="1"></section>
    <section id="b" class="scene clip" data-start="5" data-duration="5" data-track-index="1"></section>
  </div>
</body>
</html>
`;

/**
 * `inputPath` is a separate parameter, not the argv's last element, so the
 * `--` terminator stays the penultimate literal token — see
 * `src/utils/ffprobeArgvContract.test.ts`, which checks that position at the
 * source level across the tree.
 */
function ffprobe(inputPath: string, args: readonly string[]): string {
  const argv = ["-v", "error", ...args, "--", inputPath];
  const result = spawnSync(FFPROBE, argv, { encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`ffprobe failed (${String(result.status)}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

/** `#EXTINF:` durations, in playlist order. */
function extinfDurations(playlistPath: string): number[] {
  return readFileSync(playlistPath, "utf-8")
    .split("\n")
    .filter((line) => line.startsWith("#EXTINF:"))
    .map((line) => Number.parseFloat(line.slice("#EXTINF:".length)));
}

describe.skipIf(!HAS_FFMPEG)("format: hls — real render", () => {
  let root: string;
  let outputDir: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "hf-hls-render-"));
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "index.html"), COMPOSITION);

    const tone = spawnSync(
      FFMPEG,
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=440:duration=${DURATION_SECONDS}`,
        "-ar",
        "48000",
        "-y",
        join(root, "assets", "tone.wav"),
      ],
      { encoding: "utf-8" },
    );
    if (tone.status !== 0) throw new Error(`tone fixture failed: ${tone.stderr}`);

    outputDir = join(root, "out-hls");
    const job = createRenderJob({
      fps: FPS,
      quality: "draft",
      format: "hls",
      hlsSegmentSeconds: SEGMENT_SECONDS,
      hdrMode: "force-sdr",
      workers: 1,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      producerConfig: resolveConfig({ browserGpuMode: "software" }),
    });
    await executeRenderJob(job, root, outputDir);
  }, 600_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("publishes a directory with a master playlist referencing both renditions", () => {
    const master = readFileSync(join(outputDir, "master.m3u8"), "utf-8");

    expect(existsSync(join(outputDir, "video.m3u8"))).toBe(true);
    expect(existsSync(join(outputDir, "audio.m3u8"))).toBe(true);
    expect(master).toContain("video.m3u8");
    expect(master).toContain("audio.m3u8");
  });

  it("marks the playlists as VOD with independent segments", () => {
    const video = readFileSync(join(outputDir, "video.m3u8"), "utf-8");

    expect(video).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
    expect(video).toContain("#EXT-X-INDEPENDENT-SEGMENTS");
    expect(video).toContain(`#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`);
    expect(video.trimEnd().endsWith("#EXT-X-ENDLIST")).toBe(true);
  });

  it("cuts fixed-length segments, the last one holding the remainder", () => {
    const durations = extinfDurations(join(outputDir, "video.m3u8"));
    const segments = readdirSync(outputDir).filter((name) => name.startsWith("video_"));

    expect(segments).toHaveLength(EXPECTED_VIDEO_SEGMENTS);
    expect(durations).toHaveLength(EXPECTED_VIDEO_SEGMENTS);
    // Every segment but the last is exactly `SEGMENT_SECONDS`, within a frame.
    for (const duration of durations.slice(0, -1)) {
      expect(Math.abs(duration - SEGMENT_SECONDS)).toBeLessThanOrEqual(1 / FPS);
    }
    expect(durations.at(-1)).toBeGreaterThan(0);
    expect(durations.at(-1)).toBeLessThanOrEqual(SEGMENT_SECONDS + 1 / FPS);
  });

  // The load-bearing assertion for PR 1's GOP lock: without it, libx264's
  // default keyint puts the only IDR at frame 0 and the whole clip collapses
  // into one segment. A segment that does not start on an IDR is not
  // independently decodable, whatever the playlist claims.
  it("starts every video segment on an IDR frame", () => {
    const segments = readdirSync(outputDir)
      .filter((name) => name.startsWith("video_") && name.endsWith(".ts"))
      .sort();

    expect(segments.length).toBe(EXPECTED_VIDEO_SEGMENTS);
    for (const segment of segments) {
      // `csv=p=0` still emits the field separator, so the row reads "1,".
      const firstFrame = ffprobe(join(outputDir, segment), [
        "-select_streams",
        "v:0",
        "-show_entries",
        "frame=key_frame",
        "-of",
        "csv=p=0",
        "-read_intervals",
        "%+#1",
      ]).replace(/,+$/, "");
      expect(firstFrame).toBe("1");
    }
  });

  it("probes the video playlist to the composition duration", () => {
    const probed = Number.parseFloat(
      ffprobe(join(outputDir, "video.m3u8"), [
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
      ]),
    );

    // Same single-frame tolerance the artifact gate uses.
    expect(Math.abs(probed - DURATION_SECONDS)).toBeLessThanOrEqual(1 / FPS);
  });

  it("carries the audio rendition at the same start time as the video", () => {
    const firstVideoPts = Number.parseFloat(
      ffprobe(join(outputDir, "video.m3u8"), [
        "-select_streams",
        "v:0",
        "-show_entries",
        "packet=pts_time",
        "-of",
        "csv=p=0",
        "-read_intervals",
        "%+#1",
      ]).split("\n")[0]!,
    );

    // `packageHls` passes `-muxdelay 0 -muxpreload 0` to keep the mpegts muxer
    // from applying its default 1.4 s PTS base; the video must start at zero.
    expect(firstVideoPts).toBeLessThan(1 / FPS);
  });

  /**
   * Packaging an AAC sidecar directly (the engine's `packageHls` fixtures) puts
   * one extra sub-frame segment on the audio rendition — a 23 ms priming tail
   * past the last video segment. Through the real pipeline it does not happen,
   * because `padOrTrimAudioToVideoFrameCount` trims the sidecar to the video
   * frame count first. Pinned because a regression here is invisible: the
   * playlist stays valid and only the rendition lengths diverge.
   */
  it("keeps the audio rendition segment-aligned with the video rendition", () => {
    const videoDurations = extinfDurations(join(outputDir, "video.m3u8"));
    const audioDurations = extinfDurations(join(outputDir, "audio.m3u8"));

    expect(audioDurations).toHaveLength(videoDurations.length);
    // One AAC frame is 1024 samples (21.3 ms at 48 kHz), so each audio segment
    // lands within a frame of its video counterpart rather than exactly on it.
    for (const [index, audio] of audioDurations.entries()) {
      expect(Math.abs(audio - videoDurations[index]!)).toBeLessThanOrEqual(0.025);
    }
  });

  it("reports an integer target duration on both renditions", () => {
    for (const playlist of ["video.m3u8", "audio.m3u8"]) {
      const text = readFileSync(join(outputDir, playlist), "utf-8");
      expect(text).toContain(`#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`);
      expect(text).toContain("#EXT-X-ENDLIST");
    }
  });
});
