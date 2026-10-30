import { cpSync, type CopySyncOptions } from "node:fs";

export function copyDirSync(
  src: string,
  dest: string,
  options: Omit<CopySyncOptions, "recursive" | "filter"> = {},
): void {
  // Any filter keeps Node 22 off its native copy, which writes nothing under a non-ASCII path on Windows.
  cpSync(src, dest, { ...options, recursive: true, filter: () => true });
}
