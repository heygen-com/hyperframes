import { mkdtempSync, readdirSync, readSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHdrFrameWindows, type HdrWindowSpec } from "./hdrFrameWindows.js";

const FRAME_SIZE = 4;
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(opts: {
  totalFrames: number;
  windowFrames: number;
  maxResident: number;
  /** Frames the source really has; fewer than totalFrames models a short source. */
  sourceFrames?: number;
}) {
  const dir = mkdtempSync(join(tmpdir(), "hf-hdr-windows-"));
  dirs.push(dir);
  const extracted: number[] = [];
  const windows = createHdrFrameWindows({
    dir,
    frameSize: FRAME_SIZE,
    totalFrames: opts.totalFrames,
    windowFrames: opts.windowFrames,
    maxResident: opts.maxResident,
    extract: async (spec: HdrWindowSpec) => {
      extracted.push(spec.firstFrame);
      const available = Math.max(0, (opts.sourceFrames ?? opts.totalFrames) - spec.firstFrame);
      const frames = Math.min(spec.frames, available);
      const data = Buffer.alloc(frames * FRAME_SIZE);
      for (let j = 0; j < frames; j++) data.fill(spec.firstFrame + j, j * FRAME_SIZE);
      writeFileSync(spec.path, data);
      return frames;
    },
  });
  return { dir, windows, extracted };
}

async function frameByte(
  windows: ReturnType<typeof createHdrFrameWindows>,
  index: number,
): Promise<number | null> {
  const lease = await windows.lease(index);
  if (!lease) return null;
  try {
    const buf = Buffer.alloc(FRAME_SIZE);
    readSync(lease.fd, buf, 0, FRAME_SIZE, lease.offset);
    return buf[0] ?? null;
  } finally {
    lease.release();
  }
}

const windowFiles = (dir: string) => readdirSync(dir).filter((f) => f.startsWith("window-"));

describe("createHdrFrameWindows", () => {
  it("extracts a window only when a frame inside it is read, and reads that frame's bytes", async () => {
    const { windows, extracted } = fixture({ totalFrames: 12, windowFrames: 4, maxResident: 3 });
    expect(extracted).toEqual([]);

    expect(await frameByte(windows, 5)).toBe(5);

    expect(extracted).toEqual([4]);
    windows.close();
  });

  it("keeps no more than maxResident windows on disk while the capture walks the whole clip", async () => {
    const { dir, windows } = fixture({ totalFrames: 40, windowFrames: 4, maxResident: 2 });
    let mostFiles = 0;
    for (let i = 0; i < 40; i++) {
      expect(await frameByte(windows, i)).toBe(i);
      mostFiles = Math.max(mostFiles, windowFiles(dir).length);
    }
    expect(mostFiles).toBeLessThanOrEqual(2);
    windows.close();
  });

  it("never evicts a window that is leased", async () => {
    const { windows } = fixture({ totalFrames: 16, windowFrames: 4, maxResident: 2 });
    const held = await windows.lease(0);
    expect(held).not.toBeNull();
    for (const i of [4, 8, 12]) await frameByte(windows, i);

    const buf = Buffer.alloc(FRAME_SIZE);
    expect(readSync(held!.fd, buf, 0, FRAME_SIZE, held!.offset)).toBe(FRAME_SIZE);
    expect(buf[0]).toBe(0);
    held!.release();
    windows.close();
  });

  it("holds the last frame when the source ends before the planned length", async () => {
    const { windows } = fixture({
      totalFrames: 10,
      windowFrames: 4,
      maxResident: 3,
      sourceFrames: 6,
    });

    expect(await frameByte(windows, 9)).toBe(5);
    expect(windows.totalFrames).toBe(6);
    windows.close();
  });

  it("holds the last frame when the source ends exactly at a window boundary", async () => {
    const { windows } = fixture({
      totalFrames: 12,
      windowFrames: 4,
      maxResident: 3,
      sourceFrames: 4,
    });

    expect(await frameByte(windows, 9)).toBe(3);
    expect(windows.totalFrames).toBe(4);
    windows.close();
  });

  it("reports no frame for a source that produced none", async () => {
    const { windows } = fixture({
      totalFrames: 4,
      windowFrames: 4,
      maxResident: 2,
      sourceFrames: 0,
    });

    expect(await frameByte(windows, 0)).toBeNull();
    windows.close();
  });

  it("retries a window whose extraction failed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-hdr-windows-"));
    dirs.push(dir);
    let attempts = 0;
    const windows = createHdrFrameWindows({
      dir,
      frameSize: FRAME_SIZE,
      totalFrames: 4,
      windowFrames: 4,
      maxResident: 2,
      extract: async (spec) => {
        attempts += 1;
        if (attempts === 1) throw new Error("ffmpeg failed");
        writeFileSync(spec.path, Buffer.alloc(spec.frames * FRAME_SIZE, 7));
        return spec.frames;
      },
    });

    await expect(windows.lease(0)).rejects.toThrow("ffmpeg failed");
    expect(await frameByte(windows, 0)).toBe(7);
    windows.close();
  });

  it("removes its window files on close", async () => {
    const { dir, windows } = fixture({ totalFrames: 8, windowFrames: 4, maxResident: 3 });
    await frameByte(windows, 0);
    await frameByte(windows, 5);
    expect(windowFiles(dir).length).toBeGreaterThan(0);

    windows.close();

    expect(windowFiles(dir)).toEqual([]);
  });
});
