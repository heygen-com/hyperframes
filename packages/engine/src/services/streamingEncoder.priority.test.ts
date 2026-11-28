import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { constants, getPriority, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { spawnStreamingEncoder } from "./streamingEncoder.js";

const os = vi.hoisted(() => ({ setPriority: vi.fn() }));
vi.mock("os", async (importOriginal) => {
  const real = await importOriginal<typeof import("os")>();
  os.setPriority.mockImplementation(real.setPriority);
  return { ...real, setPriority: os.setPriority };
});

const dirs: string[] = [];
beforeEach(() => {
  os.setPriority.mockClear();
});
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function jpegFrame(): Buffer {
  return execFileSync(getFfmpegBinary(), [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=64x64:r=30",
    "-frames:v",
    "1",
    "-f",
    "image2pipe",
    "-c:v",
    "mjpeg",
    "pipe:1",
  ]);
}

async function encodeThreeFrames(belowNormalPriority?: boolean, whileRunning = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "hf-encoder-priority-"));
  dirs.push(dir);
  const encoder = await spawnStreamingEncoder(join(dir, "out.mp4"), {
    fps: { num: 30, den: 1 },
    width: 64,
    height: 64,
    codec: "h264",
    preset: "ultrafast",
    quality: 23,
    pixelFormat: "yuv420p",
    imageFormat: "jpeg",
    belowNormalPriority,
  });
  const frame = jpegFrame();
  for (let i = 0; i < 3; i++) await encoder.writeFrame(frame);
  whileRunning();
  return encoder.close();
}

describe("streaming encoder priority", () => {
  it("runs ffmpeg below normal priority when asked", async () => {
    let priority: number | undefined;
    const result = await encodeThreeFrames(true, () => {
      priority = getPriority(os.setPriority.mock.calls[0]?.[0]);
    });
    expect(result.success).toBe(true);
    expect(priority).toBe(constants.priority.PRIORITY_BELOW_NORMAL);
  });

  it("leaves ffmpeg at normal priority by default", async () => {
    expect((await encodeThreeFrames()).success).toBe(true);
    expect(os.setPriority).not.toHaveBeenCalled();
  });

  it("still encodes when the system refuses the lower priority", async () => {
    os.setPriority.mockImplementationOnce(() => {
      throw Object.assign(new Error("setpriority EPERM"), { code: "EPERM" });
    });
    expect((await encodeThreeFrames(true)).success).toBe(true);
  });
});
