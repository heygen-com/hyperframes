import { readdirSync } from "node:fs";
import { join } from "node:path";

export type ExtractedFrameFormat = "jpg" | "png";

export const FRAME_FILENAME_PREFIX = "frame_";

export class ExtractedFrameSequenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractedFrameSequenceError";
  }
}

export function extractedFrameIndex(file: string, format: ExtractedFrameFormat): number {
  const match = new RegExp(`^${FRAME_FILENAME_PREFIX}(\\d+)\\.${format}$`).exec(file);
  if (!match) {
    throw new ExtractedFrameSequenceError(`Invalid extracted frame filename: ${file}`);
  }
  const ordinal = Number.parseInt(match[1]!, 10);
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new ExtractedFrameSequenceError(`Invalid extracted frame ordinal: ${file}`);
  }
  return ordinal - 1;
}

export function framePathsFromDirectory(
  outputDir: string,
  format: ExtractedFrameFormat,
): Map<number, string> {
  const suffix = `.${format}`;
  const indexed = new Map<number, string>();
  for (const file of readdirSync(outputDir)) {
    if (!file.startsWith(FRAME_FILENAME_PREFIX) || !file.endsWith(suffix)) continue;
    const index = extractedFrameIndex(file, format);
    if (indexed.has(index)) {
      throw new ExtractedFrameSequenceError(
        `Duplicate extracted frame index ${index}: ${indexed.get(index)} and ${file}`,
      );
    }
    indexed.set(index, join(outputDir, file));
  }

  const ordered = new Map<number, string>();
  for (let index = 0; index < indexed.size; index += 1) {
    const path = indexed.get(index);
    if (!path) {
      throw new ExtractedFrameSequenceError(
        `Missing extracted frame index ${index} in ${outputDir}`,
      );
    }
    ordered.set(index, path);
  }
  return ordered;
}
