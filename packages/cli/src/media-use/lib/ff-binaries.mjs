import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { assertLiteralMediaPath } from "./literal-media-input.mjs";

// The binaries media-use spawns: HYPERFRAMES_FFMPEG_PATH / HYPERFRAMES_FFPROBE_PATH when set, else PATH.
// A set path that is not a working ffmpeg/ffprobe throws, so a broken override never reads as "no metadata".
const runsByPath = new Map();

export class FfBinarySettingError extends Error {}

function configuredOr(name, envVar) {
  const setting = process.env[envVar]?.trim();
  if (!setting) return name;
  const path = resolve(setting);
  if (!runsByPath.has(path)) runsByPath.set(path, isWorking(path, name));
  if (!runsByPath.get(path)) {
    const why = `${envVar} names "${path}", which is not a working ${name}: fix it or unset it.`;
    throw new FfBinarySettingError(why);
  }
  return path;
}

function isWorking(path, name) {
  try {
    const out = execFileSync(path, ["-version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15000,
      windowsHide: true,
    });
    return out.startsWith(`${name} version`);
  } catch {
    return false;
  }
}

export const ffmpegBinary = () => configuredOr("ffmpeg", "HYPERFRAMES_FFMPEG_PATH");
export const ffprobeBinary = () => configuredOr("ffprobe", "HYPERFRAMES_FFPROBE_PATH");

// Containers that hold their own media and name no other file. A project's file is opened only with these, so no
// list, manifest, script, device or text-art reader runs on it, and nothing it names is opened.
export const SELF_CONTAINED_FORMATS =
  "mov,matroska,mxf,avi,mpeg,mpegts,mpegvideo,flv,asf,ogg,wav,mp3,aac,flac,aiff,caf,w64,wv,au,ac3,gif,ico,image2,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,tiff_pipe";

/** ffmpeg or ffprobe options, placed before the file, that read it as one local self-contained container. */
export function selfContainedInput(file) {
  assertLiteralMediaPath(file);
  return ["-protocol_whitelist", "file", "-format_whitelist", SELF_CONTAINED_FORMATS];
}
