// compositeAndEncode against real ffmpeg: a tiny HLG clip, overlay PNGs in the 16-bit signal-space
// format overlay capture writes, and the composite decoded back to rgb48 to check each state lands
// on exactly its frames. Needs ffmpeg with libx265: integration lane.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import type { Fps } from "@hyperframes/core";
import {
  extractMediaMetadata,
  getEncoderPreset,
  getFfmpegBinary,
  getFfprobeBinary,
} from "@hyperframes/engine";
import { compositeAndEncode } from "./ffmpegComposite.js";
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

describe.skipIf(!HAS_X265)("compositeAndEncode (real ffmpeg)", () => {
  let outputPath: string;
  let out: Buffer;
  let src: Buffer;
  let framesReported: number[];
  let framesEncoded: number;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "hdr-passthrough-composite-"));
    const srcPath = join(dir, "hlg.mp4");
    ffmpeg([
      ...["-f", "lavfi", "-i", `testsrc2=s=${WIDTH}x${HEIGHT}:r=30:d=2`],
      ...["-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le"],
      ...[
        "-x265-params",
        "log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc",
      ],
      ...["-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc"],
      srcPath,
    ]);
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
    const metadata = await extractMediaMetadata(srcPath);
    outputPath = join(dir, "out", "video-only.mp4");
    framesReported = [];
    const request: CompositeRequest = {
      video: {
        id: "bg",
        srcPath,
        mediaStart: MEDIA_START,
        duration: TOTAL_FRAMES / 30,
        fps: FPS,
        width: WIDTH,
        height: HEIGHT,
        fit: "fill",
        transfer: "hlg",
        primaries: "bt2020",
        colorSpace: metadata.colorSpace,
        metadata,
      },
      plan: { states: planned, fps: FPS, totalFrames: TOTAL_FRAMES, width: WIDTH, height: HEIGHT },
      overlays: { overlays, uniqueCount: 3, dir, captureMs: 0 },
      encoder: {
        preset: getEncoderPreset("high", "mp4", { transfer: "hlg" }),
        effectiveQuality: 10,
        effectiveBitrate: undefined,
        deliveryEncoder: { lockGopForChunkConcat: false, gopSize: undefined },
        useGpu: false,
      },
      hdr: { transfer: "hlg" },
      outputPath,
      workDir: join(dir, "work"),
      abortSignal: undefined,
      onFramesEncoded: (frames) => framesReported.push(frames),
    };
    framesEncoded = (await compositeAndEncode(request)).framesEncoded;
    out = decodeRgb48(outputPath);
    src = decodeRgb48(srcPath);
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
        ...["-of", "json", outputPath],
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

  it("tags the output as HLG BT.2020", () => {
    const probe = spawnSync(
      FFPROBE,
      [
        ...["-v", "error", "-select_streams", "v:0"],
        ...["-show_entries", "stream=color_primaries,color_transfer,color_space,codec_tag_string"],
        ...["-of", "json", outputPath],
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
