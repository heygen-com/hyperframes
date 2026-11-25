import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";

const WINDOWS_SHARE_OR_DEVICE_PREFIX = /^[\\/]{2}/;

/** True when `input` names an existing `.txt` file for `tts` to read; a share or device path is never looked up, since that reaches its host. */
export function isTextFile(input: string): boolean {
  if (WINDOWS_SHARE_OR_DEVICE_PREFIX.test(input) || extname(input).toLowerCase() !== ".txt")
    return false;
  return existsSync(resolve(input));
}

export function isShareTextFilePath(input: string): boolean {
  return WINDOWS_SHARE_OR_DEVICE_PREFIX.test(input) && extname(input).toLowerCase() === ".txt";
}
