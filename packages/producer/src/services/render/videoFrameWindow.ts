import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SegmentVideoFrames } from "./segmentVideoFrames.js";

/**
 * Whether source-video frames are read one capture segment at a time. Off unless
 * `HF_VIDEO_FRAME_WINDOW` reads `true`, and only for a render that segments, because only
 * the segmented stage knows which frames a segment shows and when it is done with them.
 */
export function shouldWindowVideoFrames(args: {
  env: Readonly<Record<string, string | undefined>>;
  segmented: boolean;
}): boolean {
  return args.segmented && args.env.HF_VIDEO_FRAME_WINDOW?.trim().toLowerCase() === "true";
}

function directoryBytes(path: string): number {
  let bytes = 0;
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = join(path, entry.name);
    try {
      bytes += entry.isDirectory() ? directoryBytes(child) : statSync(child).size;
    } catch {
      // A segment closing on another worker removes its files mid-walk.
    }
  }
  return bytes;
}

/** Reports the most bytes `segment-frames` has held at once, sampled each time a segment's frames land. */
export function trackSegmentFramePeak(
  frames: SegmentVideoFrames,
  rootDir: string,
  onPeak: (bytes: number) => void,
): SegmentVideoFrames {
  let peak = 0;
  return {
    forFrames: (frameIndexes, name) => frames.forFrames(frameIndexes, name),
    forWorker() {
      const worker = frames.forWorker();
      return {
        ...worker,
        async prepare(segment) {
          await worker.prepare(segment);
          const held = directoryBytes(join(rootDir, "segment-frames"));
          if (held > peak) {
            peak = held;
            onPeak(peak);
          }
        },
      };
    },
  };
}
