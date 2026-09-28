import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

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
