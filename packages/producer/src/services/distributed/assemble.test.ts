/**
 * Unit tests for `services/distributed/assemble.ts`.
 *
 * Contracts:
 *   - mp4/mov: pre-rendered chunks → assembled output passes ffprobe
 *     (correct frame count, audio present and exactly `frames / fps`
 *     long, faststart applied).
 *   - png-sequence: chunk frame directories merge into one continuous
 *     numbered sequence (chunk N's `frame_NNNNNN.png` files renumber
 *     into `outputPath/frame_NNNNNN.png` with a global index).
 *
 * The mp4 fixture pre-renders chunk inputs via raw ffmpeg (test color
 * bars + AAC silence) so we don't need a working Chrome to exercise
 * assemble. The capture pipeline is covered by `renderChunk.test.ts`.
 */

import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChunkSliceJson } from "../render/stages/freezePlan.js";
import { assemble } from "./assemble.js";

let runRoot: string;
let hasFfmpeg = false;

beforeAll(() => {
  runRoot = mkdtempSync(join(tmpdir(), "hf-assemble-test-"));
  hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
});

afterAll(() => {
  rmSync(runRoot, { recursive: true, force: true });
});

/**
 * Build a synthetic planDir whose `meta/chunks.json` declares N chunks of
 * `framesPerChunk` frames each. Does NOT materialize compiled/, video-frames/,
 * audio.aac — assemble only reads `plan.json` + `meta/chunks.json`, and we
 * pass chunk paths explicitly. Keeping the dir lean speeds up the test
 * loop.
 */
function buildPlanDir(
  format: "mp4" | "png-sequence",
  chunks: ChunkSliceJson[],
  totalFrames: number,
  hasAudio: boolean,
  encoder: "libx264-software" | "libx265-software" = "libx264-software",
): string {
  const planDir = mkdtempSync(join(runRoot, `plan-${format}-`));
  mkdirSync(join(planDir, "meta"), { recursive: true });
  writeFileSync(
    join(planDir, "plan.json"),
    JSON.stringify({
      planHash: "fake",
      totalFrames,
      hasAudio,
      dimensions: { fpsNum: 30, fpsDen: 1, width: 160, height: 120, format },
    }),
    "utf-8",
  );
  writeFileSync(join(planDir, "meta", "chunks.json"), JSON.stringify(chunks), "utf-8");
  // Minimal encoder.json — assemble reads this when cfr=true to detect h265
  // chunks (the cfr re-encode hardcodes libx264 and would silently transcode
  // h265). Tests default to libx264 to match the in-production default.
  writeFileSync(join(planDir, "meta", "encoder.json"), JSON.stringify({ encoder }), "utf-8");
  return planDir;
}

/**
 * Encode a tiny mp4 chunk via raw ffmpeg with closed-GOP libx264 args
 * matching what `renderChunk` produces. Uses ffmpeg's `testsrc` filter
 * so the test doesn't depend on any image assets. Each chunk is
 * independently concatenable because GOP === frame count and the first
 * frame is forced as a keyframe.
 */
function makeMp4Chunk(outputPath: string, frameCount: number): void {
  const args = [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc=size=160x120:rate=30:duration=${frameCount / 30}`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-g",
    String(frameCount),
    "-keyint_min",
    String(frameCount),
    "-sc_threshold",
    "0",
    "-force_key_frames",
    `expr:eq(mod(n,${frameCount}),0)`,
    "-bf",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-vframes",
    String(frameCount),
    "-y",
    outputPath,
  ];
  const result = spawnSync("ffmpeg", args, { stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(`ffmpeg testsrc chunk failed: ${result.stderr.toString().slice(-400)}`);
  }
}

/** Generate an AAC audio file of `durationSeconds` of silence. */
function makeAacAudio(outputPath: string, durationSeconds: number): void {
  const result = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `anullsrc=channel_layout=stereo:sample_rate=48000`,
    "-t",
    String(durationSeconds),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-y",
    outputPath,
  ]);
  if (result.status !== 0) {
    throw new Error(`ffmpeg anullsrc failed: ${result.stderr.toString().slice(-400)}`);
  }
}

/** Read ffprobe JSON for one stream of `outputPath`. */
function probeStream(
  outputPath: string,
  streamSelector: "v:0" | "a:0",
): Record<string, unknown> | null {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      streamSelector,
      "-show_entries",
      "stream=start_time,duration,nb_frames,nb_read_packets,codec_name,r_frame_rate",
      "-count_packets",
      "-of",
      "json",
      outputPath,
    ],
    { stdio: "pipe" },
  );
  if (result.status !== 0) return null;
  const parsed = JSON.parse(result.stdout.toString()) as {
    streams?: Array<Record<string, unknown>>;
  };
  return parsed.streams?.[0] ?? null;
}

describe("assemble()", () => {
  const TIMEOUT_MS = 30_000;

  it(
    "concat-copies two mp4 chunks and applies faststart",
    async () => {
      if (!hasFfmpeg) {
        console.warn(
          "[assemble.test] skipping mp4 concat test — ffmpeg not available on this host",
        );
        return;
      }

      const chunks: ChunkSliceJson[] = [
        { index: 0, startFrame: 0, endFrame: 5 },
        { index: 1, startFrame: 5, endFrame: 10 },
      ];
      const planDir = buildPlanDir("mp4", chunks, 10, false);

      const chunkAPath = join(planDir, "chunk-0.mp4");
      const chunkBPath = join(planDir, "chunk-1.mp4");
      makeMp4Chunk(chunkAPath, 5);
      makeMp4Chunk(chunkBPath, 5);

      const outputPath = join(planDir, "output.mp4");
      const result = await assemble(planDir, [chunkAPath, chunkBPath], null, outputPath);

      expect(result.outputPath).toBe(outputPath);
      expect(existsSync(outputPath)).toBe(true);
      expect(result.fileSize).toBeGreaterThan(0);
      expect(result.framesEncoded).toBe(10);

      // ── ffprobe: correct frame count + codec ───────────────────────────
      const videoStream = probeStream(outputPath, "v:0");
      expect(videoStream).toBeDefined();
      expect(videoStream?.codec_name).toBe("h264");
      const probedFrames = Number(videoStream?.nb_read_packets ?? videoStream?.nb_frames);
      expect(probedFrames).toBe(10);

      // ── ffprobe: exact framerate + duration equivalence ────────────────
      // The container's `r_frame_rate` must match the planDir's exact
      // rational (30/1 here) — not a PTS-averaged fraction like
      // `360000/12001`. This guards the `-r` flag on the concat /
      // mux / faststart steps from regressing.
      expect(videoStream?.r_frame_rate).toBe("30/1");
      // Duration must equal `totalFrames * fpsDen / fpsNum` within 1ms.
      const expectedDuration = (10 * 1) / 30;
      const probedDuration = Number(videoStream?.duration ?? 0);
      expect(Math.abs(probedDuration - expectedDuration)).toBeLessThan(0.001);

      // ── faststart applied ──────────────────────────────────────────────
      // Bun.file is async; resolve before asserting.
      const buf = await Bun.file(outputPath).arrayBuffer();
      const bytes = new Uint8Array(buf);
      let cursor = 0;
      let moovBeforeMdat = false;
      while (cursor + 8 <= bytes.length) {
        const size =
          (bytes[cursor]! << 24) |
          (bytes[cursor + 1]! << 16) |
          (bytes[cursor + 2]! << 8) |
          bytes[cursor + 3]!;
        const fourcc = String.fromCharCode(
          bytes[cursor + 4]!,
          bytes[cursor + 5]!,
          bytes[cursor + 6]!,
          bytes[cursor + 7]!,
        );
        if (fourcc === "moov") {
          moovBeforeMdat = true;
          break;
        }
        if (fourcc === "mdat") break;
        if (size <= 0) break;
        cursor += size;
      }
      expect(moovBeforeMdat).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    "single-chunk render stamps exact r_frame_rate on the output container",
    async () => {
      if (!hasFfmpeg) {
        console.warn(
          "[assemble.test] skipping single-chunk r_frame_rate test — ffmpeg not available on this host",
        );
        return;
      }

      // Reproducer for the single-chunk pass-through regression: when
      // `chunkPaths.length === 1`, assemble must still stamp an exact
      // `r_frame_rate` matching the planDir's rational (here 30/1), not
      // a PTS-derived fraction like `359/12`. Multi-chunk renders go
      // through the concat demuxer; single-chunk renders skip it and
      // need the `-r <fps>` flag on a direct remux step.
      const chunks: ChunkSliceJson[] = [{ index: 0, startFrame: 0, endFrame: 10 }];
      const planDir = buildPlanDir("mp4", chunks, 10, false);

      const chunkPath = join(planDir, "chunk-0.mp4");
      makeMp4Chunk(chunkPath, 10);

      const outputPath = join(planDir, "output-single-chunk.mp4");
      const result = await assemble(planDir, [chunkPath], null, outputPath);

      expect(result.outputPath).toBe(outputPath);
      expect(existsSync(outputPath)).toBe(true);
      expect(result.framesEncoded).toBe(10);

      const videoStream = probeStream(outputPath, "v:0");
      expect(videoStream).toBeDefined();
      expect(videoStream?.codec_name).toBe("h264");
      // The exact-rational assertion — the regression hole that this
      // test closes. Before the single-chunk -r fix, this came back as
      // a PTS-derived fraction (e.g. `359/12`) on 1-chunk renders.
      expect(videoStream?.r_frame_rate).toBe("30/1");
      const expectedDuration = 10 / 30;
      const probedDuration = Number(videoStream?.duration ?? 0);
      expect(Math.abs(probedDuration - expectedDuration)).toBeLessThan(0.001);
    },
    TIMEOUT_MS,
  );

  it(
    "muxes audio with frame-count-derived duration when audio.aac is present",
    async () => {
      if (!hasFfmpeg) return;

      const chunks: ChunkSliceJson[] = [
        { index: 0, startFrame: 0, endFrame: 6 },
        { index: 1, startFrame: 6, endFrame: 12 },
      ];
      const totalFrames = 12;
      const fps = 30;
      const planDir = buildPlanDir("mp4", chunks, totalFrames, true);

      const chunkAPath = join(planDir, "chunk-0.mp4");
      const chunkBPath = join(planDir, "chunk-1.mp4");
      const audioPath = join(planDir, "audio.aac");
      makeMp4Chunk(chunkAPath, 6);
      makeMp4Chunk(chunkBPath, 6);
      // Audio is half a second longer than the video — `padOrTrimAudioToVideoFrameCount`
      // should trim it down to `totalFrames / fps`.
      makeAacAudio(audioPath, totalFrames / fps + 0.5);

      const outputPath = join(planDir, "output-audio.mp4");
      const result = await assemble(planDir, [chunkAPath, chunkBPath], audioPath, outputPath);

      expect(existsSync(outputPath)).toBe(true);
      expect(result.framesEncoded).toBe(totalFrames);

      const audioStream = probeStream(outputPath, "a:0");
      expect(audioStream).toBeDefined();
      expect(audioStream?.codec_name).toBe("aac");
      const videoStream = probeStream(outputPath, "v:0");
      expect(videoStream).toBeDefined();
      expect(Number(videoStream?.start_time ?? NaN)).toBeLessThan(0.001);
      expect(Number(audioStream?.start_time ?? NaN)).toBeLessThan(0.001);
      // Audio duration should be within ~25ms of `totalFrames / fps` after
      // pad/trim. The 25ms tolerance absorbs AAC frame quantization (1024
      // samples @ 48kHz = ~21ms).
      const audioDuration = Number(audioStream?.duration ?? 0);
      const expected = totalFrames / fps;
      expect(Math.abs(audioDuration - expected)).toBeLessThan(0.05);
    },
    TIMEOUT_MS,
  );

  it(
    "muxes padded short audio without shifting the first video frame",
    async () => {
      if (!hasFfmpeg) return;

      const chunks: ChunkSliceJson[] = [
        { index: 0, startFrame: 0, endFrame: 6 },
        { index: 1, startFrame: 6, endFrame: 12 },
      ];
      const totalFrames = 12;
      const fps = 30;
      const planDir = buildPlanDir("mp4", chunks, totalFrames, true);

      const chunkAPath = join(planDir, "chunk-0.mp4");
      const chunkBPath = join(planDir, "chunk-1.mp4");
      const audioPath = join(planDir, "audio.aac");
      makeMp4Chunk(chunkAPath, 6);
      makeMp4Chunk(chunkBPath, 6);
      // Audio is shorter than the video, forcing the distributed pad branch.
      makeAacAudio(audioPath, totalFrames / fps - 0.2);

      const outputPath = join(planDir, "output-audio-padded.mp4");
      const result = await assemble(planDir, [chunkAPath, chunkBPath], audioPath, outputPath);

      expect(existsSync(outputPath)).toBe(true);
      expect(result.framesEncoded).toBe(totalFrames);

      const audioStream = probeStream(outputPath, "a:0");
      expect(audioStream).toBeDefined();
      expect(audioStream?.codec_name).toBe("aac");
      const videoStream = probeStream(outputPath, "v:0");
      expect(videoStream).toBeDefined();
      expect(Number(videoStream?.start_time ?? NaN)).toBeLessThan(0.001);
      expect(Number(audioStream?.start_time ?? NaN)).toBeLessThan(0.001);

      const audioDuration = Number(audioStream?.duration ?? 0);
      const expected = totalFrames / fps;
      expect(Math.abs(audioDuration - expected)).toBeLessThan(0.05);
    },
    TIMEOUT_MS,
  );

  it(
    "cfr:true re-encodes for exact avg_frame_rate matching r_frame_rate",
    async () => {
      if (!hasFfmpeg) {
        console.warn("[assemble.test] skipping cfr test — ffmpeg not available on this host");
        return;
      }

      // Opt-in CFR: the re-encode pass with `-fps_mode cfr -r <fps>` must
      // land the stream's `avg_frame_rate` on the requested rational
      // exactly, not a PTS-derived fraction. Default `cfr=false` path is
      // covered by the existing concat-copy tests above.
      const chunks: ChunkSliceJson[] = [
        { index: 0, startFrame: 0, endFrame: 5 },
        { index: 1, startFrame: 5, endFrame: 10 },
      ];
      const planDir = buildPlanDir("mp4", chunks, 10, false);

      const chunkAPath = join(planDir, "chunk-0.mp4");
      const chunkBPath = join(planDir, "chunk-1.mp4");
      makeMp4Chunk(chunkAPath, 5);
      makeMp4Chunk(chunkBPath, 5);

      const outputPath = join(planDir, "output-cfr.mp4");
      const result = await assemble(planDir, [chunkAPath, chunkBPath], null, outputPath, {
        cfr: true,
      });

      expect(result.outputPath).toBe(outputPath);
      expect(existsSync(outputPath)).toBe(true);
      expect(result.framesEncoded).toBe(10);

      // ffprobe both r_frame_rate AND avg_frame_rate — the CFR re-encode's
      // contract is that they're equal and both exactly match the
      // requested rate.
      const probe = spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=r_frame_rate,avg_frame_rate,duration",
          "-of",
          "json",
          outputPath,
        ],
        { stdio: "pipe" },
      );
      expect(probe.status).toBe(0);
      const parsed = JSON.parse(probe.stdout.toString()) as {
        streams?: Array<{ r_frame_rate?: string; avg_frame_rate?: string; duration?: string }>;
      };
      const stream = parsed.streams?.[0];
      expect(stream).toBeDefined();
      expect(stream?.r_frame_rate).toBe("30/1");
      expect(stream?.avg_frame_rate).toBe("30/1");
      const expectedDuration = 10 / 30;
      const probedDuration = Number(stream?.duration ?? 0);
      expect(Math.abs(probedDuration - expectedDuration)).toBeLessThan(0.001);
    },
    TIMEOUT_MS,
  );

  it(
    "cfr:true rejects non-mp4 formats with a clear error",
    async () => {
      const chunks: ChunkSliceJson[] = [{ index: 0, startFrame: 0, endFrame: 5 }];
      // png-sequence path short-circuits before the cfr check; webm/mov
      // would hit the runtime guard. We rebuild plan.json with a non-mp4
      // format manually so this test runs without a webm encoder.
      const planDir = mkdtempSync(join(runRoot, "plan-webm-cfr-"));
      mkdirSync(join(planDir, "meta"), { recursive: true });
      writeFileSync(
        join(planDir, "plan.json"),
        JSON.stringify({
          planHash: "fake",
          totalFrames: 5,
          hasAudio: false,
          dimensions: { fpsNum: 30, fpsDen: 1, width: 160, height: 120, format: "webm" },
        }),
        "utf-8",
      );
      writeFileSync(join(planDir, "meta", "chunks.json"), JSON.stringify(chunks), "utf-8");
      // Fabricate a placeholder file so the existence check passes — the
      // cfr-guard error fires before we actually run the concat invocation
      // in the multi-chunk branch; the single-chunk remux path runs first
      // here, then we hit the cfr guard. Since the remux is real, only
      // run this test when ffmpeg is present.
      if (!hasFfmpeg) {
        console.warn("[assemble.test] skipping cfr-non-mp4 test — ffmpeg not available");
        return;
      }
      const chunkPath = join(planDir, "chunk-0.webm");
      // Build a real 5-frame webm chunk so the concat step succeeds and
      // the cfr guard is what actually trips.
      const buildResult = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=160x120:rate=30:duration=0.166666",
        "-c:v",
        "libvpx-vp9",
        "-row-mt",
        "1",
        "-deadline",
        "realtime",
        "-cpu-used",
        "8",
        "-g",
        "5",
        "-keyint_min",
        "5",
        "-pix_fmt",
        "yuv420p",
        "-vframes",
        "5",
        "-y",
        chunkPath,
      ]);
      if (buildResult.status !== 0) {
        console.warn(
          "[assemble.test] skipping cfr-non-mp4 test — libvpx-vp9 not available on this host",
        );
        return;
      }
      let caught: unknown;
      try {
        await assemble(planDir, [chunkPath], null, join(planDir, "out.webm"), { cfr: true });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect((caught as Error).message).toContain("cfr=true is only supported");
    },
    TIMEOUT_MS,
  );

  it(
    "cfr:true rejects h265 chunks with a clear error",
    async () => {
      if (!hasFfmpeg) {
        console.warn("[assemble.test] skipping cfr-h265 test — ffmpeg not available");
        return;
      }
      // The cfr re-encode hardcodes `-c:v libx264`; pairing it with h265
      // chunks would silently transcode them to h264. Assemble must throw
      // a typed error instead of producing a wrong-codec deliverable. We
      // stage a plan whose `meta/encoder.json` reports `libx265-software`
      // and chunks built with libx264 (the bytes don't matter — the guard
      // trips on the encoder discriminant before the re-encode runs).
      const chunks: ChunkSliceJson[] = [{ index: 0, startFrame: 0, endFrame: 5 }];
      const planDir = buildPlanDir("mp4", chunks, 5, false, "libx265-software");

      const chunkPath = join(planDir, "chunk-0.mp4");
      makeMp4Chunk(chunkPath, 5);

      let caught: unknown;
      try {
        await assemble(planDir, [chunkPath], null, join(planDir, "out.mp4"), { cfr: true });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect((caught as Error).message).toContain(
        `cfr=true is not yet supported with codec: "h265"`,
      );
    },
    TIMEOUT_MS,
  );

  it(
    "merges png-sequence chunk directories with continuous global numbering",
    () => {
      const chunks: ChunkSliceJson[] = [
        { index: 0, startFrame: 0, endFrame: 3 },
        { index: 1, startFrame: 3, endFrame: 7 },
      ];
      const planDir = buildPlanDir("png-sequence", chunks, 7, false);

      // Fabricate two chunk directories with 3 + 4 frames respectively.
      // Each chunk uses a 0-indexed naming scheme — `renderChunk` writes
      // them this way today.
      const chunkADir = join(planDir, "chunk-a");
      const chunkBDir = join(planDir, "chunk-b");
      mkdirSync(chunkADir, { recursive: true });
      mkdirSync(chunkBDir, { recursive: true });
      const minimalPngHeader = Buffer.from([
        // 8-byte PNG signature followed by an IHDR chunk for a 1×1 RGB image.
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
        0x77, 0x53, 0xde,
      ]);
      for (let i = 0; i < 3; i++) {
        // Each frame's bytes differ (suffix index) so the merged sequence's
        // ordering assertion has something to bite on.
        writeFileSync(
          join(chunkADir, `frame_${String(i).padStart(6, "0")}.png`),
          Buffer.concat([minimalPngHeader, Buffer.from([0xaa, i])]),
        );
      }
      for (let i = 0; i < 4; i++) {
        writeFileSync(
          join(chunkBDir, `frame_${String(i).padStart(6, "0")}.png`),
          Buffer.concat([minimalPngHeader, Buffer.from([0xbb, i])]),
        );
      }

      const outputPath = join(planDir, "merged");
      // No await — png-sequence assemble is synchronous internally.
      const promise = assemble(planDir, [chunkADir, chunkBDir], null, outputPath);
      return promise.then((result) => {
        expect(result.outputPath).toBe(outputPath);
        expect(result.framesEncoded).toBe(7);
        const merged = readdirSync(outputPath).sort();
        expect(merged).toEqual([
          "frame_000001.png",
          "frame_000002.png",
          "frame_000003.png",
          "frame_000004.png",
          "frame_000005.png",
          "frame_000006.png",
          "frame_000007.png",
        ]);
      });
    },
    TIMEOUT_MS,
  );

  it("rejects when chunkPaths.length does not match chunks.json length", async () => {
    const chunks: ChunkSliceJson[] = [
      { index: 0, startFrame: 0, endFrame: 5 },
      { index: 1, startFrame: 5, endFrame: 10 },
    ];
    const planDir = buildPlanDir("mp4", chunks, 10, false);
    let caught: unknown;
    try {
      await assemble(planDir, ["/tmp/nonexistent.mp4"], null, join(planDir, "out.mp4"));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as Error).message).toContain("does not match");
  });

  it("rejects a planDir missing plan.json", async () => {
    const emptyDir = join(runRoot, "empty");
    mkdirSync(emptyDir, { recursive: true });
    let caught: unknown;
    try {
      await assemble(emptyDir, [], null, join(emptyDir, "out.mp4"));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as Error).message).toContain("plan.json");
  });
});
