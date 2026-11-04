import { mkdirSync, statSync } from "node:fs";

/** Makes the folder an output goes in. One already there is left alone: Windows refuses a recursive mkdir of a drive's
 * root (EPERM) even though the root exists, so `-o D:\film.mp4` failed before rendering. */
export function makeOutputFolder(dir: string): void {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) mkdirSync(dir, { recursive: true });
}
