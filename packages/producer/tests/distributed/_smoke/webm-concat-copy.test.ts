/**
 * Smoke test for the WebM (VP9) distributed concat-copy path.
 *
 * PR 8.1 gating experiment — answers the question:
 *   "Does `buildEncoderArgs(..., { codec: 'vp9', lockGopForChunkConcat: true, gopSize: N })`
 *    produce VP9 chunk files that `ffmpeg -f concat -c copy` can stitch
 *    into a single playable WebM?"
 *
 *   YES → PR 8.2 ships Path A: drop webm from FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED
 *         and wire lockGopForChunkConcat=true through the distributed plan().
 *
 *   NO  → PR 8.2 ships Path B: re-encode the concat'd chunks in `assemble()`
 *         (slower; loses encode parallelism but is reliably correct).
 *
 * Why direct ffmpeg invocation (instead of plan/renderChunk/assemble): the
 * full distributed pipeline currently REFUSES webm at plan time, so we can't
 * exercise it end-to-end yet. This smoke test bypasses the producer pipeline
 * and only validates the ffmpeg-level contract — the encoder args we'll wire
 * into the pipeline in 8.2.
 *
 * The test generates 60 frames (2s @ 30fps) of an animated test pattern
 * (`testsrc2` from ffmpeg's lavfi), splits them into 4 chunks of 15 frames
 * each via direct `ffmpeg` invocations using the args from
 * `buildEncoderArgs(..., { lockGopForChunkConcat: true, gopSize: 15 })`,
 * concat-copies them, and runs three independent verifications:
 *
 *   1. `ffprobe -show_streams`     — output is a valid WebM with one VP9 stream
 *   2. `ffmpeg -i ... -f null -`   — output decodes cleanly (no seam errors)
 *   3. `ffprobe -count_frames`     — frame count equals sum of chunk frames
 *
 * If concat-copy fails in any way the test reports the precise failure
 * fingerprint in the error message so PR 8.2 has the data it needs to pick
 * Path A vs Path B.
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

    // Surface ffmpeg's full stderr in the assertion message so 8.2 has the
    // failure fingerprint when concat-copy is broken (e.g.
    // "Non-monotonous DTS in output stream", "missing keyframe at chunk 2",
    // matroska/webm cluster errors).
    if (result.exitCode !== 0) {
      throw new Error(
        `[smoke concat-copy] failed (exit ${result.exitCode}). ` +
          `This means PR 8.2 must take Path B (re-encode in assemble). ` +
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
          `invalid VP9 references — PR 8.2 must take Path B (re-encode in assemble). ` +
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
        `[smoke ffprobe count_frames] expected ${TOTAL_FRAMES} frames, got ${result.stdout.trim()}. ` +
          `This means concat-copy dropped frames at one or more chunk seams — ` +
          `PR 8.2 must take Path B (re-encode in assemble).`,
      );
    }
    expect(nbFrames).toBe(TOTAL_FRAMES);
  });
});

describe("webm VP9 concat-copy smoke (yuva420p alpha)", () => {
  // The wired-up distributed webm path uses yuva420p, not yuv420p — that
  // matches the in-process renderer's webm pixel format (alpha video, the
  // format's main reason for existing). yuva420p VP9 streams have a few
  // extra concat-copy hazards that yuv420p doesn't (the alpha sub-stream
  // is muxed via `-metadata:s:v:0 alpha_mode=1` and concat-copy must
  // preserve that metadata across chunks).
  //
  // This block re-runs the same three verifications on yuva420p output to
  // pin the contract for what the distributed pipeline actually emits.
  let alphaRoot: string;
  let alphaFramesDir: string;
  let alphaChunkDir: string;
  let alphaConcatListPath: string;
  let alphaOutputPath: string;

  beforeAll(() => {
    alphaRoot = mkdtempSync(join(tmpdir(), "hf-webm-concat-smoke-alpha-"));
    alphaFramesDir = join(alphaRoot, "frames");
    alphaChunkDir = join(alphaRoot, "chunks");
    mkdirSync(alphaFramesDir, { recursive: true });
    mkdirSync(alphaChunkDir, { recursive: true });
    alphaConcatListPath = join(alphaRoot, "concat-list.txt");
    alphaOutputPath = join(alphaRoot, "output.webm");

    // For alpha frames, generate RGBA PNGs with spatially-varying alpha
    // so the encoder can't drop the alpha plane as uniform/redundant.
    // `testsrc2 + format=rgba` (the prior shape) produced uniformly-
    // opaque alpha and the libvpx-vp9 encoder silently downgraded the
    // output to yuv420p — masking any bug in the alpha pipeline. Here
    // `geq=a='X*255/W'` writes a horizontal alpha gradient on top of
    // the testsrc2 RGB so the alpha track has real per-pixel content.
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
        `[alpha smoke setup] frame generation failed (exit ${frameGen.exitCode}): ` +
          frameGen.stderr.slice(-400),
      );
    }
  });

  afterAll(() => {
    rmSync(alphaRoot, { recursive: true, force: true });
  });

  it("encodes 4 yuva420p VP9 chunks with closed-GOP args", () => {
    for (let chunkIdx = 0; chunkIdx < CHUNK_COUNT; chunkIdx++) {
      const startNumber = chunkIdx * CHUNK_SIZE + 1;
      const chunkPath = join(alphaChunkDir, `chunk_${String(chunkIdx).padStart(4, "0")}.webm`);
      const inputArgs = [
        "-framerate",
        String(FPS),
        "-start_number",
        String(startNumber),
        "-i",
        join(alphaFramesDir, "frame_%04d.png"),
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
          // yuva420p is what the distributed pipeline actually emits for
          // webm; the alpha branch in chunkEncoder.ts adds the
          // `-metadata:s:v:0 alpha_mode=1` tag we want to verify
          // round-trips through concat-copy.
          pixelFormat: "yuva420p",
          lockGopForChunkConcat: true,
          gopSize: CHUNK_SIZE,
        },
        inputArgs,
        chunkPath,
      );
      const result = runFfmpegSync(["-hide_banner", "-loglevel", "error", ...args]);
      if (result.exitCode !== 0) {
        throw new Error(
          `[alpha smoke chunk ${chunkIdx}] yuva420p VP9 encode failed (exit ${result.exitCode}):\n` +
            `args: ${JSON.stringify(args)}\n` +
            `stderr: ${result.stderr.slice(-1000)}`,
        );
      }
      expect(existsSync(chunkPath)).toBe(true);
    }
  });

  it("concat-copies the 4 yuva420p chunks into a single alpha WebM", () => {
    const lines: string[] = [];
    for (let chunkIdx = 0; chunkIdx < CHUNK_COUNT; chunkIdx++) {
      const chunkPath = join(alphaChunkDir, `chunk_${String(chunkIdx).padStart(4, "0")}.webm`);
      lines.push(`file '${chunkPath.replace(/'/g, "'\\''")}'`);
    }
    writeFileSync(alphaConcatListPath, `${lines.join("\n")}\n`, "utf-8");

    const result = runFfmpegSync([
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

    if (result.exitCode !== 0) {
      throw new Error(
        `[alpha smoke concat-copy] failed (exit ${result.exitCode}). ` +
          `yuva420p webm concat-copy is broken — PR 8.2 must take Path B. ` +
          `Failure fingerprint: ${result.stderr.slice(-1000)}`,
      );
    }
    expect(existsSync(alphaOutputPath)).toBe(true);
    expect(statSync(alphaOutputPath).size).toBeGreaterThan(0);
  });

  it("decodes alpha-track WebM cleanly without seam errors", () => {
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
    // Gate only on exit code — `-v error` ffmpeg builds can emit
    // non-fatal stderr (DTS warnings, container-quirk notes) and we
    // don't want the test to flake on chatty stderr in a future
    // libavformat upgrade. Surface stderr in the failure message for
    // forensic context.
    if (decodeResult.exitCode !== 0) {
      throw new Error(
        `[alpha smoke decode-test] failed (exit ${decodeResult.exitCode}). ` +
          `Failure fingerprint: ${decodeResult.stderr.slice(-1000) || "(no stderr)"}`,
      );
    }

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
    // libvpx-vp9 stores the alpha plane as a Matroska `BlockAdditional`
    // sidecar, NOT in the main stream's `pix_fmt` — so `ffprobe` always
    // reports `pix_fmt=yuv420p` for VP9-with-alpha. The right signal that
    // alpha encoding was enabled is the stream-level `TAG:ALPHA_MODE=1`
    // tag the encoder writes when `-metadata:s:v:0 alpha_mode=1` is set
    // on a yuva420p input.
    expect(probeResult.stdout).toMatch(/ALPHA_MODE=1/);
  });

  it("alpha plane round-trips through concat-copy with spatially-varying content", () => {
    // Decode the concat-copied WebM via the libvpx-vp9 decoder forced to
    // RGBA, then extract the alpha plane and check it has real spatial
    // variance — catches the failure mode where the encoder accepted
    // yuva420p input but dropped the alpha sub-stream silently
    // (uniform alpha would mask any plan-time bug like the `needsAlpha`
    // hole that hid this PR's bug before review caught it). The
    // gradient source produces YMIN ≈ 0 / YMAX ≈ 255 on the alpha
    // plane; uniform alpha would give YMIN == YMAX. Spread > 100 is a
    // generous floor that catches the bad case cleanly.
    //
    // `-c:v libvpx-vp9` before `-i` is the load-bearing piece: ffmpeg's
    // default VP9 decoder path strips the BlockAdditional alpha track
    // when decoding to non-rgba pixel formats; forcing the libvpx-vp9
    // decoder + `-pix_fmt rgba` is how we get the alpha plane back.
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
  });
});
