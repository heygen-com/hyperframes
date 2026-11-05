import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "bun:test";
import type { SegmentVideoFrames } from "./segmentVideoFrames.js";
import { trackSegmentFramePeak } from "./videoFrameWindow.js";

const root = mkdtempSync(join(tmpdir(), "hf-video-frame-window-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Writes `bytes` into the segment's folder on prepare and deletes it on release, as the real frames do. */
function framesOfSize(rootDir: string, bytes: number): SegmentVideoFrames {
  return {
    forWorker() {
      let folder: string | null = null;
      return {
        hook: Object.assign(async () => {}, {}),
        async prepare(segment) {
          folder = join(rootDir, "segment-frames", `segment_${segment.index}`, "clip");
          mkdirSync(folder, { recursive: true });
          writeFileSync(join(folder, "frame_00001.jpg"), Buffer.alloc(bytes));
        },
        release() {
          if (folder) rmSync(join(folder, ".."), { recursive: true, force: true });
        },
      };
    },
  };
}

describe("trackSegmentFramePeak", () => {
  it("reports the most bytes segment-frames held at once, across workers", async () => {
    const dir = mkdtempSync(join(root, "work-"));
    const peaks: number[] = [];
    const tracked = trackSegmentFramePeak(framesOfSize(dir, 1000), dir, (bytes) =>
      peaks.push(bytes),
    );
    const a = tracked.forWorker();
    const b = tracked.forWorker();

    await a.prepare({ index: 0, startFrame: 0, endFrame: 10 });
    await b.prepare({ index: 1, startFrame: 10, endFrame: 20 });
    a.release();
    await a.prepare({ index: 2, startFrame: 20, endFrame: 30 });

    expect(peaks).toEqual([1000, 2000]);
  });

  it("reports nothing before any segment lands", () => {
    const dir = mkdtempSync(join(root, "work-"));
    const peaks: number[] = [];
    trackSegmentFramePeak(framesOfSize(dir, 1), dir, (bytes) => peaks.push(bytes)).forWorker();
    expect(peaks).toEqual([]);
  });
});
