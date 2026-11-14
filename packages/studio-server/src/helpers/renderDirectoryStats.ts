import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FRAME_FILENAME = /^frame_\d{6}\.png$/;

export interface RenderDirectoryStats {
  frameCount: number;
  size: number;
  audioSidecar: boolean;
}

/** Read the byte footprint and PNG-sequence facts for a render directory. */
export function readRenderDirectoryStats(directory: string): RenderDirectoryStats {
  if (!lstatSync(directory).isDirectory()) {
    throw new Error(`Render output is not a directory: ${directory}`);
  }

  let frameCount = 0;
  let size = 0;
  let audioSidecar = false;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    try {
      const stat = lstatSync(join(directory, entry.name));
      if (!stat.isFile()) continue;
      size += stat.size;
      if (FRAME_FILENAME.test(entry.name)) frameCount += 1;
      if (entry.name === "audio.m4a") audioSidecar = true;
    } catch {
      // Skip files removed or made unreadable while the directory is scanned.
    }
  }

  return { frameCount, size, audioSidecar };
}
