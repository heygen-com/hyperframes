import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
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

const isVideoStream = (value: unknown): value is VideoStream => {
  if (typeof value !== "object" || value === null) return false;

  return (
    "codec_name" in value &&
    value.codec_name === "h264" &&
    "width" in value &&
    value.width === 1920 &&
    "height" in value &&
    value.height === 1080
  );
};

const validateAsset = (file: string): number => {
  const bytes = statSync(file).size;
  if (bytes <= minimumAssetBytes) {
    throw new Error(`${file} is ${bytes} bytes; expected more than 1 KiB`);
  }

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
      file,
    ],
    { encoding: "utf8" },
  );

  if (probe.error) throw probe.error;
  if (probe.status !== 0) {
    throw new Error(`ffprobe rejected ${file}: ${probe.stderr.trim()}`);
  }

  const result: unknown = JSON.parse(probe.stdout);
  if (
    typeof result !== "object" ||
    result === null ||
    !("streams" in result) ||
    !Array.isArray(result.streams) ||
    result.streams.length !== 1 ||
    !isVideoStream(result.streams[0])
  ) {
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

    await Bun.write(temporaryFile, body);
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
