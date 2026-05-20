/**
 * Smoke test for the WebM (VP9) distributed concat-copy path.
 *
 * Asserts that `buildEncoderArgs(..., { codec: "vp9",
 * lockGopForChunkConcat: true, gopSize: N })` produces VP9 chunk files
 * that `ffmpeg -f concat -c copy` can stitch into a single playable
 * WebM.
 *
 * Uses direct ffmpeg invocation instead of `plan() / renderChunk() /
 * assemble()` so the contract this test pins is exactly the encoder-arg
 * surface — independent of plan-time validation, file servers, browser
 * capture, and the rest of the distributed-pipeline stack.
 *
 * Each chunk + concat-copy + ffprobe verification surfaces its failure
 * fingerprint in the error message so a regression-driven concat-copy
 * failure (alt-ref reaching across a seam, libvpx bumping its default
 * cpu-used, etc.) can be diagnosed without re-running locally.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEncoderArgs } from "@hyperframes/engine";

const FPS = 30;
const TOTAL_FRAMES = 60;
const CHUNK_SIZE = 15;
const CHUNK_COUNT = TOTAL_FRAMES / CHUNK_SIZE; // 4
const WIDTH = 320;
const HEIGHT = 240;

let runRoot: string;
let framesDir: string;
let chunkDir: string;
let concatListPath: string;
let outputPath: string;
let frameGenStderr = "";

interface FfmpegResult {
  exitCode: number | null;
  stderr: string;
  stdout: string;
}

function runFfmpegSync(args: string[]): FfmpegResult {
  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  return {
    exitCode: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function runFfprobeSync(args: string[]): FfmpegResult {
  const result = spawnSync("ffprobe", args, { encoding: "utf8" });
  return {
    exitCode: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

beforeAll(() => {
  runRoot = mkdtempSync(join(tmpdir(), "hf-webm-concat-smoke-"));
  framesDir = join(runRoot, "frames");
  chunkDir = join(runRoot, "chunks");
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(chunkDir, { recursive: true });
  concatListPath = join(runRoot, "concat-list.txt");
  outputPath = join(runRoot, "output.webm");

  // Generate 60 PNG frames using lavfi testsrc2 (animated counter / color
  // bars — easy to eyeball for seam errors if a human inspects the output).
  // Each frame is a real image; we use a frame sequence rather than a single
  // mp4 source so the per-chunk encode is a pure image2 → VP9 pass with no
  // intermediate decode.
  const frameGen = runFfmpegSync([
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${TOTAL_FRAMES / FPS}`,
    "-frames:v",
    String(TOTAL_FRAMES),
    join(framesDir, "frame_%04d.png"),
  ]);
  frameGenStderr = frameGen.stderr;
  if (frameGen.exitCode !== 0) {
    throw new Error(
      `[smoke setup] frame generation failed (exit ${frameGen.exitCode}): ${frameGen.stderr.slice(-400)}`,
    );
  }
});

afterAll(() => {
  rmSync(runRoot, { recursive: true, force: true });
});

describe("webm VP9 concat-copy smoke", () => {
  it("generates 60 source PNG frames", () => {
    // Sanity check — if testsrc2 frame generation broke, downstream
    // failures would be miscategorized as concat-copy errors.
    const firstFrame = join(framesDir, "frame_0001.png");
    const lastFrame = join(framesDir, `frame_${String(TOTAL_FRAMES).padStart(4, "0")}.png`);
    expect(existsSync(firstFrame)).toBe(true);
    expect(existsSync(lastFrame)).toBe(true);
    expect(frameGenStderr).toBeDefined();
  });

  it("encodes 4 VP9 chunks with closed-GOP args from buildEncoderArgs", () => {
    // The contract this test asserts: buildEncoderArgs with
    // lockGopForChunkConcat=true + codec=vp9 + gopSize=chunkSize produces
    // VP9 chunks whose first frame is an independently-decodable keyframe
    // and whose alt-ref behavior doesn't reach back across chunk seams.
    //
    // Use the exact args buildEncoderArgs returns. We only swap the input
    // args (image2 input range per chunk) — the encoder args (everything
    // after `-r <fps>`) are byte-identical to what a real renderChunk()
    // call would invoke.
    for (let chunkIdx = 0; chunkIdx < CHUNK_COUNT; chunkIdx++) {
      const startNumber = chunkIdx * CHUNK_SIZE + 1; // image2 frame numbers are 1-based
      const chunkPath = join(chunkDir, `chunk_${String(chunkIdx).padStart(4, "0")}.webm`);
      const inputArgs = [
        "-framerate",
        String(FPS),
        "-start_number",
        String(startNumber),
        "-i",
        join(framesDir, "frame_%04d.png"),
        "-frames:v",
        String(CHUNK_SIZE),
      ];
      const args = buildEncoderArgs(
        {
          fps: { num: FPS, den: 1 },
          width: WIDTH,
          height: HEIGHT,
          codec: "vp9",
          preset: "good",
          quality: 32,
          pixelFormat: "yuv420p",
          lockGopForChunkConcat: true,
          gopSize: CHUNK_SIZE,
        },
        inputArgs,
        chunkPath,
      );
      const result = runFfmpegSync(["-hide_banner", "-loglevel", "error", ...args]);
      if (result.exitCode !== 0) {
        throw new Error(
          `[smoke chunk ${chunkIdx}] VP9 encode failed (exit ${result.exitCode}):\n` +
            `args: ${JSON.stringify(args)}\n` +
            `stderr: ${result.stderr.slice(-1000)}`,
        );
      }
      expect(existsSync(chunkPath)).toBe(true);
      expect(statSync(chunkPath).size).toBeGreaterThan(0);
    }
  });

  it("concat-copies the 4 chunks into a single WebM", () => {
    const lines: string[] = [];
    for (let chunkIdx = 0; chunkIdx < CHUNK_COUNT; chunkIdx++) {
      const chunkPath = join(chunkDir, `chunk_${String(chunkIdx).padStart(4, "0")}.webm`);
      lines.push(`file '${chunkPath.replace(/'/g, "'\\''")}'`);
    }
    writeFileSync(concatListPath, `${lines.join("\n")}\n`, "utf-8");

    const result = runFfmpegSync([
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatListPath,
      "-c",
      "copy",
      "-y",
      outputPath,
    ]);

    // Surface ffmpeg's full stderr in the assertion message — a broken
    // concat-copy fails with something specific ("Non-monotonous DTS",
    // "missing keyframe at chunk 2", matroska/webm cluster errors) that
    // the message above wouldn't disambiguate.
    if (result.exitCode !== 0) {
      throw new Error(
        `[smoke concat-copy] failed (exit ${result.exitCode}). ` +
          `Failure fingerprint: ${result.stderr.slice(-1000)}`,
      );
    }
    expect(existsSync(outputPath)).toBe(true);
    expect(statSync(outputPath).size).toBeGreaterThan(0);
  });

  it("ffprobe -show_streams reports a single playable VP9 stream", () => {
    // First verification — the output file is structurally a valid WebM
    // with one video stream encoded as VP9. A broken concat-copy can
    // produce a file whose container parses but whose stream metadata is
    // corrupted (no codec ID, zero duration, broken pixel format).
    const result = runFfprobeSync([
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,pix_fmt,r_frame_rate",
      "-of",
      "default=noprint_wrappers=1",
      outputPath,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(
        `[smoke ffprobe] -show_streams failed (exit ${result.exitCode}). ` +
          `This means concat-copy produced a structurally broken WebM. ` +
          `Failure fingerprint: ${result.stderr.slice(-1000)}`,
      );
    }
    expect(result.stdout).toMatch(/codec_name=vp9/);
    expect(result.stdout).toMatch(new RegExp(`width=${WIDTH}`));
    expect(result.stdout).toMatch(new RegExp(`height=${HEIGHT}`));
  });

  it("ffmpeg -i ... -f null - decodes the concat'd WebM without errors", () => {
    // Second verification — the bitstream actually decodes end-to-end.
    // A WebM whose containers parse but whose VP9 frames reference
    // non-existent alt-ref frames (because alt-ref crossed a chunk
    // seam) will fail here with "Reference frame not found" or
    // "Invalid frame" errors.
    const result = runFfmpegSync([
      "-hide_banner",
      "-v",
      "error",
      "-i",
      outputPath,
      "-f",
      "null",
      "-",
    ]);
    if (result.exitCode !== 0 || result.stderr.length > 0) {
      throw new Error(
        `[smoke decode-test] ffmpeg -f null - reported decode errors ` +
          `(exit ${result.exitCode}). This means concat-copy seams produce ` +
          `invalid VP9 references ` +
          `Failure fingerprint: ${result.stderr.slice(-1000) || "(no stderr; check exit code)"}`,
      );
    }
  });

  it("ffprobe -count_frames matches the sum of chunk frames", () => {
    // Third verification — playable frame count equals what we encoded.
    // A broken concat-copy can produce a file that decodes "without
    // errors" up to the first bad seam and then silently truncates,
    // leaving fewer frames than expected.
    const result = runFfprobeSync([
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_frames",
      "-show_entries",
      "stream=nb_read_frames",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      outputPath,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(
        `[smoke ffprobe count_frames] failed (exit ${result.exitCode}): ` +
          `${result.stderr.slice(-1000)}`,
      );
    }
    const nbFrames = Number.parseInt(result.stdout.trim(), 10);
    if (!Number.isFinite(nbFrames) || nbFrames !== TOTAL_FRAMES) {
      throw new Error(
        `[smoke ffprobe count_frames] expected ${TOTAL_FRAMES} frames, got ${result.stdout.trim()} ` +
          `— concat-copy dropped frames at one or more chunk seams.`,
      );
    }
    expect(nbFrames).toBe(TOTAL_FRAMES);
  });
});

describe("webm VP9 concat-copy smoke (yuva420p alpha)", () => {
  // The wired-up distributed webm path uses yuva420p. This block proves
  // (a) the closed-GOP args + alpha pixel format don't break concat-copy
  // at the bitstream level, and (b) the alpha plane round-trips with
  // real spatial content — catching the failure mode where the encoder
  // accepted yuva420p input but dropped the alpha sub-stream silently.
  // The source frames carry a per-pixel alpha gradient so the encoder
  // cannot treat the alpha plane as uniform/redundant and drop it.
  it("encode + concat-copy + decode round-trip works for yuva420p", () => {
    const alphaRoot = mkdtempSync(join(tmpdir(), "hf-webm-concat-smoke-alpha-"));
    try {
      const alphaFramesDir = join(alphaRoot, "frames");
      const alphaChunkDir = join(alphaRoot, "chunks");
      mkdirSync(alphaFramesDir, { recursive: true });
      mkdirSync(alphaChunkDir, { recursive: true });
      const alphaConcatListPath = join(alphaRoot, "concat-list.txt");
      const alphaOutputPath = join(alphaRoot, "output.webm");

      // `geq=a='X*255/W'` writes a horizontal alpha gradient on top of
      // the testsrc2 RGB. `testsrc2 + format=rgba` alone produced
      // uniformly-opaque alpha and libvpx-vp9 silently downgraded the
      // output to yuv420p, masking any alpha-pipeline bug — the
      // gradient ensures the encoder has spatially-varying alpha to
      // preserve.
      const frameGen = runFfmpegSync([
        "-hide_banner",
        "-y",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${TOTAL_FRAMES / FPS}`,
        "-vf",
        "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='X*255/W'",
        "-frames:v",
        String(TOTAL_FRAMES),
        join(alphaFramesDir, "frame_%04d.png"),
      ]);
      if (frameGen.exitCode !== 0) {
        throw new Error(
          `[alpha smoke setup] frame generation failed: ${frameGen.stderr.slice(-400)}`,
        );
      }

      const chunkPaths: string[] = [];
      for (let chunkIdx = 0; chunkIdx < CHUNK_COUNT; chunkIdx++) {
        const startNumber = chunkIdx * CHUNK_SIZE + 1;
        const chunkPath = join(alphaChunkDir, `chunk_${String(chunkIdx).padStart(4, "0")}.webm`);
        chunkPaths.push(chunkPath);
        const args = buildEncoderArgs(
          {
            fps: { num: FPS, den: 1 },
            width: WIDTH,
            height: HEIGHT,
            codec: "vp9",
            preset: "good",
            quality: 32,
            pixelFormat: "yuva420p",
            lockGopForChunkConcat: true,
            gopSize: CHUNK_SIZE,
          },
          [
            "-framerate",
            String(FPS),
            "-start_number",
            String(startNumber),
            "-i",
            join(alphaFramesDir, "frame_%04d.png"),
            "-frames:v",
            String(CHUNK_SIZE),
          ],
          chunkPath,
        );
        const result = runFfmpegSync(["-hide_banner", "-loglevel", "error", ...args]);
        if (result.exitCode !== 0) {
          throw new Error(
            `[alpha smoke chunk ${chunkIdx}] yuva420p VP9 encode failed: ${result.stderr.slice(-1000)}`,
          );
        }
      }

      writeFileSync(
        alphaConcatListPath,
        `${chunkPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")}\n`,
        "utf-8",
      );
      const concatResult = runFfmpegSync([
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        alphaConcatListPath,
        "-c",
        "copy",
        "-y",
        alphaOutputPath,
      ]);
      if (concatResult.exitCode !== 0) {
        throw new Error(`[alpha smoke concat-copy] failed: ${concatResult.stderr.slice(-1000)}`);
      }

      // Decode-test gates only on exit code — `-v error` ffmpeg builds
      // can emit non-fatal stderr (DTS warnings, container-quirk notes)
      // and we don't want the test to flake on chatty stderr in a
      // future libavformat upgrade.
      const decodeResult = runFfmpegSync([
        "-hide_banner",
        "-v",
        "error",
        "-i",
        alphaOutputPath,
        "-f",
        "null",
        "-",
      ]);
      if (decodeResult.exitCode !== 0) {
        throw new Error(
          `[alpha smoke decode-test] failed (exit ${decodeResult.exitCode}): ` +
            `${decodeResult.stderr.slice(-1000) || "(no stderr)"}`,
        );
      }

      // libvpx-vp9 stores the alpha plane as a Matroska `BlockAdditional`
      // sidecar, NOT in the main stream's `pix_fmt` — `ffprobe` always
      // reports `pix_fmt=yuv420p` for VP9-with-alpha. The right signal
      // is the stream-level `TAG:ALPHA_MODE=1` tag the encoder writes
      // when `-metadata:s:v:0 alpha_mode=1` is set on yuva420p input.
      const probeResult = runFfprobeSync([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_streams",
        alphaOutputPath,
      ]);
      expect(probeResult.exitCode).toBe(0);
      expect(probeResult.stdout).toMatch(/codec_name=vp9/);
      expect(probeResult.stdout).toMatch(/ALPHA_MODE=1/);

      // Decode the alpha plane and check it has spatially-varying
      // content — catches the case where the encoder accepted yuva420p
      // input but dropped the alpha sub-stream silently (a uniform
      // alpha plane would mask any plan-time bug like a misconfigured
      // `needsAlpha` gate). The horizontal gradient source produces
      // YMIN ≈ 0 / YMAX ≈ 255 on the alpha plane; uniform alpha would
      // give YMIN == YMAX. Spread > 100 cleanly rejects the bad case.
      //
      // `-c:v libvpx-vp9` before `-i` is load-bearing: ffmpeg's default
      // VP9 decoder strips the BlockAdditional alpha track when
      // decoding to non-rgba pixel formats; forcing the libvpx-vp9
      // decoder + `-pix_fmt rgba` is how the alpha plane comes back.
      const statsResult = runFfmpegSync([
        "-hide_banner",
        "-v",
        "error",
        "-c:v",
        "libvpx-vp9",
        "-i",
        alphaOutputPath,
        "-pix_fmt",
        "rgba",
        "-vf",
        "extractplanes=a,signalstats,metadata=mode=print:file=-",
        "-f",
        "null",
        "-",
      ]);
      if (statsResult.exitCode !== 0) {
        throw new Error(
          `[alpha smoke signalstats] failed (exit ${statsResult.exitCode}): ` +
            `${statsResult.stderr.slice(-500)}`,
        );
      }
      const yminMatch = statsResult.stdout.match(/lavfi\.signalstats\.YMIN=(\d+)/);
      const ymaxMatch = statsResult.stdout.match(/lavfi\.signalstats\.YMAX=(\d+)/);
      if (!yminMatch || !ymaxMatch) {
        throw new Error(
          `[alpha smoke signalstats] could not parse YMIN/YMAX from output: ` +
            `${statsResult.stdout.slice(0, 500)}`,
        );
      }
      const ymin = Number.parseInt(yminMatch[1], 10);
      const ymax = Number.parseInt(ymaxMatch[1], 10);
      expect(ymax - ymin).toBeGreaterThan(100);
      expect(statSync(alphaOutputPath).size).toBeGreaterThan(0);
    } finally {
      rmSync(alphaRoot, { recursive: true, force: true });
    }
  });
});
