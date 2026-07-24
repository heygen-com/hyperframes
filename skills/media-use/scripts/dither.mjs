#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import {
  ERROR_DIFFUSION_ALGORITHMS,
  applyErrorDiffusionRgba,
  errorDiffusionBufferLength,
} from "./lib/error-diffusion.mjs";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"]);
const OUTPUT_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const { values: args } = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    out: { type: "string", short: "o" },
    algorithm: { type: "string", short: "a", default: "floyd-steinberg" },
    palette: { type: "string", default: "#000000,#ffffff" },
    "point-size": { type: "string", default: "3" },
    brightness: { type: "string", default: "1" },
    contrast: { type: "string", default: "1.2" },
    detail: { type: "string", default: "1" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`media-use dither — exact cached error-diffusion for image or MP4 media

Usage:
  node dither.mjs --input in.mp4 --out out.mp4 [options]

Options:
  --algorithm, -a   ${Object.keys(ERROR_DIFFUSION_ALGORITHMS).join(" | ")}
  --palette         2-6 authored-order #rrggbb colors, comma-separated
  --point-size      Block size in pixels, 1-20 (default: 3)
  --brightness      0.5-2 (default: 1)
  --contrast        0.5-2 (default: 1.2)
  --detail          Diffused-error strength, 0.1-1 (default: 1)
  --json            Output JSON status
  --help, -h        Show this help

Video output uses the source average frame rate as CFR; VFR cadence is normalized.

After processing, register the output with:
  node resolve.mjs --from <output> --type image|video`);
  process.exit(0);
}

try {
  const result = await run();
  if (args.json) console.log(JSON.stringify({ ok: true, ...result }));
  else {
    console.log(`dithered ${result.input} -> ${result.out} (${result.algorithm})`);
    console.log(`next: resolve --from ${result.out} --type ${result.type}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (args.json) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`error: ${message}`);
  process.exit(1);
}

async function run() {
  if (!args.input || !args.out) throw new Error("--input and --out are required");
  const inputPath = resolve(args.input);
  const outPath = resolve(args.out);
  if (!existsSync(inputPath)) throw new Error(`input file not found: ${inputPath}`);
  if (inputPath === outPath) throw new Error("--out must differ from --input");

  const metadata = probe(inputPath);
  if (metadata.colorTransfer === "smpte2084" || metadata.colorTransfer === "arib-std-b67") {
    throw new Error(
      `HDR ${metadata.colorTransfer} input is not supported by the 8-bit SDR dither processor; tone-map to Rec.709 first`,
    );
  }
  const options = {
    algorithm: args.algorithm,
    palette: args.palette.split(",").map((color) => color.trim()),
    pointSize: Number(args["point-size"]),
    brightness: Number(args.brightness),
    contrast: Number(args.contrast),
    detail: Number(args.detail),
  };
  // Validate before starting FFmpeg or creating an output file.
  applyErrorDiffusionRgba(new Uint8ClampedArray(4), 1, 1, options, new Float32Array(3));

  mkdirSync(dirname(outPath), { recursive: true });
  const inputIsImage = IMAGE_EXTENSIONS.has(extname(inputPath).toLowerCase());
  if (inputIsImage) {
    if (!OUTPUT_IMAGE_EXTENSIONS.has(extname(outPath).toLowerCase())) {
      throw new Error("image output must use .png, .jpg, .jpeg, or .webp");
    }
    processImage(inputPath, outPath, metadata, options);
  } else {
    if (extname(outPath).toLowerCase() !== ".mp4") throw new Error("video output must use .mp4");
    await processVideo(inputPath, outPath, metadata, options);
  }

  return {
    input: inputPath,
    out: outPath,
    type: inputIsImage ? "image" : "video",
    algorithm: options.algorithm,
    palette: options.palette,
    point_size: options.pointSize,
    brightness: options.brightness,
    contrast: options.contrast,
    detail: options.detail,
  };
}

function probe(filePath) {
  const raw = execFileSync(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath],
    { encoding: "utf8", timeout: 10_000 },
  );
  const parsed = JSON.parse(raw);
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  if (!video?.width || !video?.height)
    throw new Error(`no readable video/image stream: ${filePath}`);
  const fps = usableFrameRate(video.avg_frame_rate) ?? usableFrameRate(video.r_frame_rate) ?? "30";
  return {
    width: video.width,
    height: video.height,
    fps,
    colorTransfer: video.color_transfer || "",
  };
}

function processImage(inputPath, outPath, metadata, options) {
  const frameBytes = metadata.width * metadata.height * 4;
  const rgba = execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-",
    ],
    { maxBuffer: frameBytes + 1024 },
  );
  if (rgba.length !== frameBytes)
    throw new Error(`decoded ${rgba.length} bytes; expected ${frameBytes}`);
  applyErrorDiffusionRgba(rgba, metadata.width, metadata.height, options);

  const temporary = temporaryOutput(outPath);
  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "-s:v",
        `${metadata.width}x${metadata.height}`,
        "-i",
        "-",
        "-frames:v",
        "1",
        temporary,
      ],
      { input: rgba, maxBuffer: frameBytes + 1024 },
    );
    renameSync(temporary, outPath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

async function processVideo(inputPath, outPath, metadata, options) {
  const temporary = temporaryOutput(outPath);
  const frameBytes = metadata.width * metadata.height * 4;
  const keyframeInterval = String(Math.max(1, Math.round(frameRateNumber(metadata.fps))));
  const errors = new Float32Array(
    errorDiffusionBufferLength(metadata.width, metadata.height, options.pointSize),
  );
  const decoder = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-",
  ]);
  const encoder = spawn("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s:v",
    `${metadata.width}x${metadata.height}`,
    "-r",
    metadata.fps,
    "-i",
    "-",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a?",
    "-map_metadata",
    "1",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-g",
    keyframeInterval,
    "-keyint_min",
    keyframeInterval,
    "-sc_threshold",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-x264-params",
    "colorprim=bt709:transfer=bt709:colormatrix=bt709",
    "-color_primaries:v",
    "bt709",
    "-color_trc:v",
    "bt709",
    "-colorspace:v",
    "bt709",
    "-color_range",
    "tv",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    temporary,
  ]);
  const decoderError = text(decoder.stderr);
  const encoderError = text(encoder.stderr);
  const decoderDone = once(decoder, "close").then(([code]) => code ?? 1);
  const encoderDone = once(encoder, "close").then(([code]) => code ?? 1);

  try {
    const frame = Buffer.allocUnsafe(frameBytes);
    let frameOffset = 0;
    for await (const chunk of decoder.stdout) {
      let chunkOffset = 0;
      while (chunkOffset < chunk.length) {
        const length = Math.min(frameBytes - frameOffset, chunk.length - chunkOffset);
        chunk.copy(frame, frameOffset, chunkOffset, chunkOffset + length);
        chunkOffset += length;
        frameOffset += length;
        if (frameOffset !== frameBytes) continue;
        applyErrorDiffusionRgba(frame, metadata.width, metadata.height, options, errors);
        await writeFrame(encoder.stdin, frame);
        frameOffset = 0;
      }
    }
    if (frameOffset)
      throw new Error(`decoder returned a partial RGBA frame (${frameOffset} bytes)`);
    encoder.stdin.end();
    const [decoderCode, encoderCode] = await Promise.all([decoderDone, encoderDone]);
    if (decoderCode !== 0) throw new Error(`FFmpeg decode failed: ${(await decoderError).trim()}`);
    if (encoderCode !== 0) throw new Error(`FFmpeg encode failed: ${(await encoderError).trim()}`);
    renameSync(temporary, outPath);
  } catch (error) {
    decoder.kill("SIGKILL");
    encoder.kill("SIGKILL");
    throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
}

function writeFrame(stream, frame) {
  return new Promise((resolveWrite, reject) => {
    stream.write(frame, (error) => (error ? reject(error) : resolveWrite()));
  });
}

function usableFrameRate(value) {
  if (!value || value === "0/0") return null;
  const number = frameRateNumber(value);
  return Number.isFinite(number) && number > 0 ? value : null;
}

function frameRateNumber(value) {
  const [numerator, denominator = "1"] = value.split("/");
  return Number(numerator) / Number(denominator);
}

function temporaryOutput(outPath) {
  const extension = extname(outPath);
  return `${outPath.slice(0, -extension.length)}.part-${process.pid}${extension}`;
}
