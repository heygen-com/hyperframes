import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { catalogOverviewAssets } from "./assets";

const root = resolve(import.meta.dirname, "../..");
const assetsDirectory = resolve(root, "docs/video-sources/catalog-overview/assets");
const minimumAssetBytes = 1024;

type VideoStream = {
  codec_name: string;
  width: number;
  height: number;
};

const requireObject = (value: unknown, message: string): object => {
  if (typeof value !== "object" || value === null) throw new Error(message);
  return value;
};

const parseVideoStream = (output: string, file: string): VideoStream => {
  const result = requireObject(JSON.parse(output), `${file} returned invalid metadata`);
  const streams = Reflect.get(result, "streams");
  if (!Array.isArray(streams) || streams.length !== 1)
    throw new Error(`${file} must contain one video stream`);
  const stream = requireObject(streams[0], `${file} returned an invalid video stream`);

  return {
    codec_name: String(Reflect.get(stream, "codec_name")),
    width: Number(Reflect.get(stream, "width")),
    height: Number(Reflect.get(stream, "height")),
  };
};

const isExpectedVideoStream = (stream: VideoStream): boolean =>
  stream.codec_name === "h264" && stream.width === 1920 && stream.height === 1080;

const validateAssetSize = (file: string): number => {
  const bytes = statSync(file).size;
  if (bytes <= minimumAssetBytes) {
    throw new Error(`${file} is ${bytes} bytes; expected more than 1 KiB`);
  }
  return bytes;
};

const probeVideoStream = (file: string): VideoStream => {
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height",
      "-of",
      "json",
      "--",
      file,
    ],
    { encoding: "utf8" },
  );

  if (probe.error) throw probe.error;
  if (probe.status !== 0) {
    throw new Error(`ffprobe rejected ${file}: ${probe.stderr.trim()}`);
  }
  return parseVideoStream(probe.stdout, file);
};

const validateAsset = (file: string): number => {
  const bytes = validateAssetSize(file);
  if (!isExpectedVideoStream(probeVideoStream(file))) {
    throw new Error(`${file} must contain one H.264 1920x1080 video stream`);
  }

  return bytes;
};

const downloadAsset = async (url: string, file: string): Promise<number> => {
  const temporaryFile = `${file}.download`;
  rmSync(temporaryFile, { force: true });

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`GET ${url} returned ${response.status} ${response.statusText}`);
    }

    const body = await response.arrayBuffer();
    if (body.byteLength <= minimumAssetBytes) {
      throw new Error(`GET ${url} returned ${body.byteLength} bytes; expected more than 1 KiB`);
    }

    writeFileSync(temporaryFile, Buffer.from(body));
    const bytes = validateAsset(temporaryFile);
    renameSync(temporaryFile, file);
    return bytes;
  } finally {
    rmSync(temporaryFile, { force: true });
  }
};

const prepareLocalAsset = (source: string, file: string): number => {
  const sourceFile = resolve(root, source);
  if (!existsSync(sourceFile)) {
    throw new Error(
      `${source} is missing; run the Catalog preview generation command from the overview README`,
    );
  }

  const temporaryFile = `${file}.download`;
  rmSync(temporaryFile, { force: true });

  try {
    const upscale = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        sourceFile,
        "-vf",
        "scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-f",
        "mp4",
        temporaryFile,
      ],
      { encoding: "utf8" },
    );
    if (upscale.error) throw upscale.error;
    if (upscale.status !== 0) {
      throw new Error(`ffmpeg rejected ${sourceFile}: ${upscale.stderr.trim()}`);
    }

    const bytes = validateAsset(temporaryFile);
    renameSync(temporaryFile, file);
    return bytes;
  } finally {
    rmSync(temporaryFile, { force: true });
  }
};

mkdirSync(assetsDirectory, { recursive: true });

for (const asset of catalogOverviewAssets) {
  const file = resolve(assetsDirectory, `${asset.item}.mp4`);

  // Local previews are generated from source in this checkout, so a valid old
  // destination must not hide a newer registry change.
  if (asset.localFile) {
    const bytes = prepareLocalAsset(asset.localFile, file);
    console.log(`validated ${asset.item}.mp4 (${bytes} bytes, generated locally)`);
    continue;
  }

  if (existsSync(file)) {
    try {
      const bytes = validateAsset(file);
      console.log(`validated ${asset.item}.mp4 (${bytes} bytes, cached)`);
      continue;
    } catch (error) {
      console.warn(`discarding invalid cached ${asset.item}.mp4: ${String(error)}`);
      rmSync(file, { force: true });
    }
  }

  const bytes = await downloadAsset(asset.url, file);
  console.log(`validated ${asset.item}.mp4 (${bytes} bytes, downloaded)`);
}
