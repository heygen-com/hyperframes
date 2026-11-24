// compositeAndEncode against real ffmpeg: a tiny HLG clip, overlay PNGs in the 16-bit signal-space
// format overlay capture writes, and the composite decoded back to rgb48 to check each state lands
// on exactly its frames. Needs ffmpeg with libx265: integration lane.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import type { Fps } from "@hyperframes/core";
import {
  extractMediaMetadata,
  getEncoderPreset,
  getFfmpegBinary,
  getFfprobeBinary,
  spawnStreamingEncoder,
} from "@hyperframes/engine";
import {
  ENCODER_IDLE,
  EncoderPacingError,
  procThreadStates,
  waitUntilIdle,
} from "./encoderPacing.js";
import {
  buildCompositeDecodeArgs,
  compositeAndEncode,
  compositeEncoderOptions,
  createOverlayFrameQueue,
  DEFAULT_COMPOSITE_DEPS,
} from "./ffmpegComposite.js";
import type { CapturedOverlay, CompositeRequest, OverlayState } from "./types.js";

const FFMPEG = getFfmpegBinary();
const FFPROBE = getFfprobeBinary();
const HAS_X265 =
  spawnSync(FFMPEG, ["-hide_banner", "-encoders"], { encoding: "utf-8" }).stdout?.includes(
    "libx265",
  ) ?? false;

const WIDTH = 320;
const HEIGHT = 180;
const FPS: Fps = { num: 30, den: 1 };
const MEDIA_START = 0.5;
const MEDIA_START_FRAMES = 15;
const TOTAL_FRAMES = 45;
const FRAME_BYTES = WIDTH * HEIGHT * 6;
// The overlay box: opaque white in the second state, half-transparent white in the third.
const BOX = { x: 0, y: 0, w: 80, h: 60 };
const HALF_ALPHA = 128 * 257;
// The states: nothing, the opaque box, the half box. Both boundaries round to the wrong frame on
// the image demuxer's default 1/25 s time base (15 -> 15.6, 33 -> 33.6).
const BOUNDS = [0, 15, 33, TOTAL_FRAMES];

let dir: string;

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A 16-bit RGBA PNG: `alpha` (16-bit) of signal white inside BOX, transparent elsewhere. */
function writeBoxPng(path: string, alpha: number): void {
  const row = 1 + WIDTH * 8;
  const raw = Buffer.alloc(row * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (alpha === 0 || x >= BOX.x + BOX.w || y >= BOX.y + BOX.h) continue;
      const at = y * row + 1 + x * 8;
      raw.writeUInt16BE(65535, at);
      raw.writeUInt16BE(65535, at + 2);
      raw.writeUInt16BE(65535, at + 4);
      raw.writeUInt16BE(alpha, at + 6);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr.set([16, 6, 0, 0, 0], 8);
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", deflateSync(raw)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

function ffmpeg(args: string[]): void {
  const result = spawnSync(FFMPEG, ["-v", "error", "-y", ...args], { encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}

/** MD5 of the output's HEVC bitstream, copied out of the container. */
function bitstreamMd5(path: string): string {
  const result = spawnSync(
    FFMPEG,
    ["-v", "error", "-i", path, "-map", "0:v", "-c", "copy", "-f", "hevc", "-"],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`copy failed: ${result.stderr.toString()}`);
  return createHash("md5").update(result.stdout).digest("hex");
}

function decodeRgb48(path: string): Buffer {
  const result = spawnSync(
    FFMPEG,
    ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb48le", "-"],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`decode failed: ${result.stderr.toString()}`);
  return result.stdout;
}

/** Mean 16-bit channel value of a region of one decoded frame. */
function regionMean(
  frames: Buffer,
  frame: number,
  region: { x: number; y: number; w: number; h: number },
): number {
  let sum = 0;
  for (let y = region.y; y < region.y + region.h; y++) {
    const row = frame * FRAME_BYTES + (y * WIDTH + region.x) * 6;
    for (let i = 0; i < region.w * 3; i++) sum += frames.readUInt16LE(row + i * 2);
  }
  return sum / (region.w * region.h * 3);
}

/** Mean absolute 16-bit difference between a region of two decoded frames. */
function meanAbsDiff(
  a: Buffer,
  frameA: number,
  b: Buffer,
  frameB: number,
  region: { x: number; y: number; w: number; h: number },
): number {
  let sum = 0;
  for (let y = region.y; y < region.y + region.h; y++) {
    const rowA = frameA * FRAME_BYTES + (y * WIDTH + region.x) * 6;
    const rowB = frameB * FRAME_BYTES + (y * WIDTH + region.x) * 6;
    for (let i = 0; i < region.w * 3; i++) {
      sum += Math.abs(a.readUInt16LE(rowA + i * 2) - b.readUInt16LE(rowB + i * 2));
    }
  }
  return sum / (region.w * region.h * 3);
}

function states(): OverlayState[] {
  return BOUNDS.slice(0, -1).map((startFrame, index) => {
    const endFrame = BOUNDS[index + 1]!;
    return {
      index,
      startFrame,
      endFrame,
      captureFrame: Math.floor((startFrame + endFrame - 1) / 2),
    };
  });
}

function hlgSource(path: string, extraX265Params = ""): void {
  ffmpeg([
    ...["-f", "lavfi", "-i", `testsrc2=s=${WIDTH}x${HEIGHT}:r=30:d=2`],
    ...["-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le"],
    ...[
      "-x265-params",
      `log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc${extraX265Params}`,
    ],
    ...["-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc"],
    path,
  ]);
}

/** Each frame's overlay PNG, from the states that tile the frames. */
function pngPerFrame(overlays: CapturedOverlay[], totalFrames: number): string[] {
  return Array.from({ length: totalFrames }, (_, frame) => {
    const shown = overlays.find((o) => frame >= o.state.startFrame && frame < o.state.endFrame);
    if (!shown) throw new Error(`no overlay state covers frame ${frame}`);
    return shown.pngPath;
  });
}

async function* framesOf(paths: string[]): AsyncIterable<string> {
  yield* paths;
}

/**
 * The composite's raw rgb48le frames with the overlays given another way: each state's PNG once,
 * through the concat demuxer for its duration (the way an earlier version fed them). The
 * streamed input must give the same frames byte for byte.
 */
function compositeThroughConcat(request: CompositeRequest, overlays: CapturedOverlay[]): Buffer {
  const lines = ["ffconcat version 1.0"];
  const micros = (frame: number) => Math.round((frame * 1_000_000) / 30);
  for (const { state, pngPath } of overlays) {
    lines.push(`file '${pngPath}'`, "option framerate 30");
    lines.push(`duration ${micros(state.endFrame) - micros(state.startFrame)}us`);
  }
  lines.push(`file '${overlays.at(-1)?.pngPath}'`, "option framerate 30");
  const list = join(dir, `concat-${Math.random()}.ffconcat`);
  writeFileSync(list, `${lines.join("\n")}\n`);
  const args = buildCompositeDecodeArgs(request);
  const at = args.indexOf("-probesize");
  args.splice(at, 14, "-f", "concat", "-safe", "0", "-i", list);
  const raw = spawnSync(FFMPEG, args, { maxBuffer: 256 * 1024 * 1024 });
  if (raw.status !== 0) throw new Error(`composite failed: ${raw.stderr.toString()}`);
  return raw.stdout;
}

/** The composite's raw rgb48le frames from the streamed overlays, all at once. */
function compositeAtOnce(request: CompositeRequest, paths: string[]): Buffer {
  const input = Buffer.concat(paths.map((path) => readFileSync(path)));
  const raw = spawnSync(FFMPEG, buildCompositeDecodeArgs(request), {
    input,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (raw.status !== 0) throw new Error(`composite failed: ${raw.stderr.toString()}`);
  return raw.stdout;
}

async function compositeRequest(args: {
  srcPath: string;
  mediaStart: number;
  overlays: CapturedOverlay[];
  totalFrames: number;
  outputPath: string;
  onFramesEncoded?: (frames: number) => void;
}): Promise<CompositeRequest> {
  const metadata = await extractMediaMetadata(args.srcPath);
  const states = args.overlays.map((o) => o.state);
  const plan = {
    states,
    fps: FPS,
    totalFrames: args.totalFrames,
    width: WIDTH,
    height: HEIGHT,
  };
  return {
    video: {
      id: "bg",
      srcPath: args.srcPath,
      mediaStart: args.mediaStart,
      duration: args.totalFrames / 30,
      fps: FPS,
      width: WIDTH,
      height: HEIGHT,
      fit: "fill",
      transfer: "hlg",
      primaries: "bt2020",
      colorSpace: metadata.colorSpace,
      metadata,
    },
    plan,
    overlayFrames: framesOf(pngPerFrame(args.overlays, args.totalFrames)),
    encoder: {
      preset: getEncoderPreset("high", "mp4", { transfer: "hlg" }),
      effectiveQuality: 10,
      effectiveBitrate: undefined,
      deliveryEncoder: { lockGopForChunkConcat: false, gopSize: undefined },
      useGpu: false,
    },
    hdr: { transfer: "hlg" },
    outputPath: args.outputPath,
    abortSignal: undefined,
    onFramesEncoded: args.onFramesEncoded,
  };
}

describe.skipIf(!HAS_X265)("compositeAndEncode (real ffmpeg)", () => {
  let outputPath: string;
  let out: Buffer;
  let src: Buffer;
  let framesReported: number[];
  let framesEncoded: number;
  let layeredPath: string;
  let streamedRaw: Buffer;
  let concatRaw: Buffer;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "hdr-passthrough-composite-"));
    const srcPath = join(dir, "hlg.mp4");
    hlgSource(srcPath);
    const clear = join(dir, "clear.png");
    const opaque = join(dir, "box.png");
    const half = join(dir, "half.png");
    writeBoxPng(clear, 0);
    writeBoxPng(opaque, 65535);
    writeBoxPng(half, HALF_ALPHA);
    const pngs = [clear, opaque, half];
    const planned = states();
    const overlays: CapturedOverlay[] = planned.map((state, i) => ({
      state,
      pngPath: pngs[i]!,
      hash: String(i),
    }));
    outputPath = join(dir, "out", "video-only.mp4");
    framesReported = [];
    const request = await compositeRequest({
      srcPath,
      mediaStart: MEDIA_START,
      overlays,
      totalFrames: TOTAL_FRAMES,
      outputPath,
      onFramesEncoded: (frames) => framesReported.push(frames),
    });
    framesEncoded = (await compositeAndEncode(request)).framesEncoded;
    out = decodeRgb48(outputPath);
    src = decodeRgb48(srcPath);

    // The layered stage's encoder, fed the composited frames the way capture feeds it: one at a
    // time, each once the encoder has long gone quiet.
    streamedRaw = compositeAtOnce(request, pngPerFrame(overlays, TOTAL_FRAMES));
    concatRaw = compositeThroughConcat(request, overlays);
    layeredPath = join(dir, "out", "layered-video-only.mp4");
    const layered = await spawnStreamingEncoder(layeredPath, compositeEncoderOptions(request));
    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      await layered.writeFrame(
        streamedRaw.subarray(frame * FRAME_BYTES, (frame + 1) * FRAME_BYTES),
      );
      await new Promise((done) => setTimeout(done, 250));
      const pid = layered.pid ?? 0;
      await waitUntilIdle(() => procThreadStates(pid), { ...ENCODER_IDLE, calmPolls: 10 });
    }
    expect((await layered.close()).success).toBe(true);
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("encodes exactly the composition's frames", () => {
    expect(framesEncoded).toBe(TOTAL_FRAMES);
    expect(framesReported.at(-1)).toBe(TOTAL_FRAMES);
    expect(out.length).toBe(TOTAL_FRAMES * FRAME_BYTES);
    const probe = spawnSync(
      FFPROBE,
      [
        ...["-v", "error", "-count_frames", "-select_streams", "v:0"],
        ...["-show_entries", "stream=nb_read_frames,pix_fmt,codec_name,r_frame_rate"],
        ...["-of", "json", "--", outputPath],
      ],
      { encoding: "utf-8" },
    );
    const stream = JSON.parse(probe.stdout).streams[0];
    expect(stream).toMatchObject({
      nb_read_frames: String(TOTAL_FRAMES),
      pix_fmt: "yuv420p10le",
      codec_name: "hevc",
      r_frame_rate: "30/1",
    });
  });

  it("composites the streamed overlays exactly as each state's PNG held for its frames", () => {
    expect(streamedRaw.length).toBe(TOTAL_FRAMES * FRAME_BYTES);
    expect(streamedRaw.equals(concatRaw)).toBe(true);
  });

  it("writes the bitstream the layered encoder writes for the same frames", () => {
    expect(bitstreamMd5(outputPath)).toBe(bitstreamMd5(layeredPath));
  });

  it("tags the output as HLG BT.2020", () => {
    const probe = spawnSync(
      FFPROBE,
      [
        ...["-v", "error", "-select_streams", "v:0"],
        ...["-show_entries", "stream=color_primaries,color_transfer,color_space,codec_tag_string"],
        ...["-of", "json", "--", outputPath],
      ],
      { encoding: "utf-8" },
    );
    expect(JSON.parse(probe.stdout).streams[0]).toMatchObject({
      color_primaries: "bt2020",
      color_transfer: "arib-std-b67",
      color_space: "bt2020nc",
      codec_tag_string: "hvc1",
    });
  });

  it("shows each overlay state on exactly its frames", () => {
    const box = { x: 8, y: 8, w: 60, h: 40 };
    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      const level = regionMean(out, frame, box);
      const under = regionMean(src, frame + MEDIA_START_FRAMES, box);
      if (frame < BOUNDS[1]!) {
        expect(Math.abs(level - under)).toBeLessThan(1000);
      } else if (frame < BOUNDS[2]!) {
        expect(level).toBeGreaterThan(64000);
      } else {
        // Straight alpha over signal-space RGB: out = a * white + (1 - a) * video.
        const a = HALF_ALPHA / 65535;
        expect(Math.abs(level - (a * 65535 + (1 - a) * under))).toBeLessThan(1000);
      }
    }
  });

  it("passes the trimmed source through outside the overlay", () => {
    // Below the box: the overlay is transparent there in every state.
    const clear = { x: 0, y: 64, w: WIDTH, h: HEIGHT - 64 };
    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      const error = (offset: number): number => meanAbsDiff(out, frame, src, frame + offset, clear);
      // The source frame the trim maps here matches best, and closely; its neighbours do not.
      expect(error(MEDIA_START_FRAMES)).toBeLessThan(800);
      expect(error(MEDIA_START_FRAMES)).toBeLessThan(error(MEDIA_START_FRAMES - 1));
      if (frame + MEDIA_START_FRAMES + 1 < src.length / FRAME_BYTES) {
        expect(error(MEDIA_START_FRAMES)).toBeLessThan(error(MEDIA_START_FRAMES + 1));
      }
    }
  });
});

// An mp4 whose streams all start after 0 (no edit list, a transport-stream remux). The browser
// plays it from timestamp 0, so the engine's media-time offset is the stream start and the seek
// for mediaStart 0 is negative. The composite must keep that lead, holding the first frame until
// the stream starts, as the layered HDR extraction does; a seek clamped to 0 plays it early.
const STREAM_OFFSET_SECONDS = 0.2;
const STREAM_OFFSET_FRAMES = 6;
const OFFSET_TOTAL_FRAMES = 30;

describe.skipIf(!HAS_X265)("compositeAndEncode with a source that starts after 0", () => {
  let out: Buffer;
  let src: Buffer;
  let framesEncoded: number;
  let seekSeconds: number;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "hdr-passthrough-composite-offset-"));
    const plainPath = join(dir, "offset-plain.mp4");
    const srcPath = join(dir, "offset.mp4");
    hlgSource(plainPath);
    ffmpeg([
      ...["-i", plainPath, "-map", "0", "-c", "copy"],
      ...["-output_ts_offset", String(STREAM_OFFSET_SECONDS), srcPath],
    ]);
    const clear = join(dir, "offset-clear.png");
    writeBoxPng(clear, 0);
    const state: OverlayState = {
      index: 0,
      startFrame: 0,
      endFrame: OFFSET_TOTAL_FRAMES,
      captureFrame: OFFSET_TOTAL_FRAMES / 2,
    };
    const outputPath = join(dir, "out", "offset-video-only.mp4");
    const request = await compositeRequest({
      srcPath,
      mediaStart: 0,
      overlays: [{ state, pngPath: clear, hash: "clear" }],
      totalFrames: OFFSET_TOTAL_FRAMES,
      outputPath,
    });
    seekSeconds = Number(request.video.metadata.mediaTimeOffsetSeconds);
    framesEncoded = (await compositeAndEncode(request)).framesEncoded;
    out = decodeRgb48(outputPath);
    src = decodeRgb48(plainPath);
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("probes the stream start as a media-time offset", () => {
    expect(seekSeconds).toBeCloseTo(STREAM_OFFSET_SECONDS, 3);
    expect(framesEncoded).toBe(OFFSET_TOTAL_FRAMES);
  });

  it("holds the first frame until the stream starts, then plays on its own timestamps", () => {
    const whole = { x: 0, y: 0, w: WIDTH, h: HEIGHT };
    for (let frame = 0; frame < OFFSET_TOTAL_FRAMES; frame++) {
      const expected = Math.max(0, frame - STREAM_OFFSET_FRAMES);
      const error = (sourceFrame: number) => meanAbsDiff(out, frame, src, sourceFrame, whole);
      expect(error(expected)).toBeLessThan(800);
      // A clamped seek shows `frame` itself: the stream played early by the offset.
      if (frame >= STREAM_OFFSET_FRAMES) expect(error(expected)).toBeLessThan(error(frame));
    }
  });
});

// A source whose frames carry mastering display and content light level metadata (BT.2020
// primaries, 1000 nits), as camera HDR files do. The layered encoder reads raw frames and never
// sees it; ffmpeg 8 carries it through the composite graph, and the mp4 muxer would write it as
// container mdcv / clli boxes the layered output does not have.
const SOURCE_MASTERING =
  ":master-display=G(8500,39850)B(6550,2300)R(35400,14600)WP(15635,16450)L(10000000,1):max-cll=1000,400";

describe.skipIf(!HAS_X265)("compositeAndEncode with source HDR side data", () => {
  let outSideData: unknown[];

  const streamSideData = (path: string): unknown[] => {
    const probe = spawnSync(
      FFPROBE,
      [
        ...["-v", "error", "-select_streams", "v:0", "-show_entries", "stream_side_data"],
        ...["-of", "json", "--", path],
      ],
      { encoding: "utf-8" },
    );
    if (probe.status !== 0) throw new Error(`ffprobe failed: ${probe.stderr}`);
    return JSON.parse(probe.stdout).streams?.[0]?.side_data_list ?? [];
  };
  const firstFrameSideData = (path: string): string[] => {
    const probe = spawnSync(
      FFPROBE,
      [
        ...["-v", "error", "-select_streams", "v:0", "-read_intervals", "%+#1"],
        ...["-show_entries", "frame_side_data", "-of", "json", "--", path],
      ],
      { encoding: "utf-8" },
    );
    if (probe.status !== 0) throw new Error(`ffprobe failed: ${probe.stderr}`);
    const list: Array<{ side_data_type?: string }> =
      JSON.parse(probe.stdout).frames?.[0]?.side_data_list ?? [];
    return list.map((entry) => entry.side_data_type ?? "");
  };
  let srcFrameSideData: string[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "hdr-passthrough-composite-sidedata-"));
    const srcPath = join(dir, "mastered.mp4");
    hlgSource(srcPath, SOURCE_MASTERING);
    const clear = join(dir, "sidedata-clear.png");
    writeBoxPng(clear, 0);
    const state: OverlayState = { index: 0, startFrame: 0, endFrame: 30, captureFrame: 15 };
    const outputPath = join(dir, "out", "sidedata-video-only.mp4");
    const request = await compositeRequest({
      srcPath,
      mediaStart: 0,
      overlays: [{ state, pngPath: clear, hash: "clear" }],
      totalFrames: 30,
      outputPath,
    });
    await compositeAndEncode(request);
    srcFrameSideData = firstFrameSideData(srcPath);
    outSideData = streamSideData(outputPath);
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("writes none of the source's side data into the output stream", () => {
    // The source really carries it, so the check below is not vacuous.
    expect(srcFrameSideData).toContain("Mastering display metadata");
    expect(srcFrameSideData).toContain("Content light level metadata");
    expect(outSideData).toEqual([]);
  });
});

// HYPERFRAMES_FFMPEG_PATH naming a script that runs ffmpeg as its child: the encoder's pid is the
// shell, whose threads are idle while its child encodes, so the encode cannot be paced; and a
// composite killed mid-way leaves its child holding the pipes. Both must decline, not hang.
describe.skipIf(!HAS_X265 || process.platform !== "linux")(
  "compositeAndEncode behind a wrapper",
  () => {
    const saved = process.env.HYPERFRAMES_FFMPEG_PATH;
    let srcPath: string;
    let clear: string;

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "hdr-passthrough-composite-wrapper-"));
      srcPath = join(dir, "wrapped.mp4");
      hlgSource(srcPath);
      clear = join(dir, "wrapped-clear.png");
      writeBoxPng(clear, 0);
      const wrapper = join(dir, "ffmpeg");
      writeFileSync(wrapper, `#!/bin/sh\n"${FFMPEG}" "$@"\n`);
      chmodSync(wrapper, 0o755);
      process.env.HYPERFRAMES_FFMPEG_PATH = wrapper;
    }, 120_000);

    afterAll(() => {
      if (saved === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH;
      else process.env.HYPERFRAMES_FFMPEG_PATH = saved;
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    async function wrappedRequest(frames: AsyncIterable<string>): Promise<CompositeRequest> {
      const state: OverlayState = { index: 0, startFrame: 0, endFrame: 30, captureFrame: 15 };
      const request = await compositeRequest({
        srcPath,
        mediaStart: 0,
        overlays: [{ state, pngPath: clear, hash: "clear" }],
        totalFrames: 30,
        outputPath: join(dir, "out", `wrapped-${Math.random()}.mp4`),
      });
      return { ...request, overlayFrames: frames };
    }

    it("declines an encoder process that is not ffmpeg before the composite starts", async () => {
      const started = Date.now();
      const error = await compositeAndEncode(await wrappedRequest(framesOf([]))).catch((e) => e);
      expect(error).toBeInstanceOf(EncoderPacingError);
      expect(String(error.message)).toMatch(/not ffmpeg/);
      expect(Date.now() - started).toBeLessThan(30_000);
    }, 60_000);

    it("stops a wrapped composite whose child holds its pipes, while capture is still feeding it", async () => {
      const queue = createOverlayFrameQueue();
      // Every frame but no end: the pipe demuxer reads these small PNGs in whole 4 KiB blocks.
      for (let i = 0; i < 30; i++) queue.push(clear);
      let checks = 0;
      const started = Date.now();
      const error = await compositeAndEncode(await wrappedRequest(queue), {
        ...DEFAULT_COMPOSITE_DEPS,
        // Accepts the encoder at first, then finds it has forked: the encode stops mid-way.
        checkEncoder: async () => {
          if (++checks === 3)
            throw new EncoderPacingError("the encoder process started 1 process(es)");
        },
      }).catch((e) => e);
      expect(error).toBeInstanceOf(EncoderPacingError);
      expect(Date.now() - started).toBeLessThan(30_000);
      queue.end();
    }, 60_000);
  },
);
