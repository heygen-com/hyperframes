import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFfmpegBinary } from "@hyperframes/engine";
import {
  canEncodeWhileCapturing,
  encodeWhileCapturing,
  runEncodeStage,
  type EncodeStageInput,
} from "./encodeStage.js";

const FRAMES = 12;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const frameName = (i: number) => `frame_${String(i).padStart(6, "0")}.jpg`;

/** Two workers' contiguous ranges on disk, as the parallel capture leaves them before the merge. */
function captureToWorkerDirs() {
  const root = mkdtempSync(join(tmpdir(), "hf-encode-overlap-"));
  tempDirs.push(root);
  const framesDir = join(root, "frames");
  mkdirSync(framesDir);
  execFileSync(getFfmpegBinary(), [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=s=64x64:r=30:d=${FRAMES / 30}`,
    "-start_number",
    "0",
    join(framesDir, "frame_%06d.jpg"),
  ]);
  const landed = [];
  for (let i = 0; i < FRAMES; i++) {
    const workerDir = join(root, `worker-${i < FRAMES / 2 ? 0 : 1}`);
    mkdirSync(workerDir, { recursive: true });
    renameSync(join(framesDir, frameName(i)), join(workerDir, frameName(i)));
    landed.push({ index: i, path: join(workerDir, frameName(i)) });
  }
  const merge = () =>
    landed.forEach((f) => renameSync(f.path, join(framesDir, frameName(f.index))));
  return { root, framesDir, landed, merge };
}

function makeInput(root: string, framesDir: string, videoOnlyName: string): EncodeStageInput {
  return {
    job: {
      id: "encode-while-capturing-test",
      config: { fps: { num: 30, den: 1 }, quality: "standard" },
      status: "queued",
      progress: 0,
      currentStage: "queued",
      createdAt: new Date(0),
      duration: FRAMES / 30,
    },
    log: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    outputPath: join(root, "out.mp4"),
    framesDir,
    videoOnlyPath: join(root, videoOnlyName),
    width: 64,
    height: 64,
    needsAlpha: false,
    captureImageFormat: "jpeg",
    hasAudio: false,
    isPngSequence: false,
    isGif: false,
    preset: { codec: "h264", preset: "medium", quality: 16, pixelFormat: "yuv420p" },
    effectiveQuality: 16,
    effectiveBitrate: undefined,
    enableChunkedEncode: false,
    chunkedEncodeSize: 30,
    abortSignal: undefined,
    assertNotAborted: () => {},
  };
}

async function until(condition: () => boolean) {
  const deadline = Date.now() + 20_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("encodeWhileCapturing", () => {
  it("runs only when the capture workers leave a core free for the encoder", () => {
    const input = makeInput("/r", "/r/frames", "v.mp4");
    expect(canEncodeWhileCapturing(input, 4, 8)).toBe(true);
    expect(canEncodeWhileCapturing(input, 4, 4)).toBe(false);
    expect(canEncodeWhileCapturing(input, 1, 8)).toBe(false);
    const gpu = { ...input, job: { ...input.job, config: { ...input.job.config, useGpu: true } } };
    expect(canEncodeWhileCapturing(gpu, 4, 8)).toBe(true);
    expect(
      canEncodeWhileCapturing({ ...input, lockGopForChunkConcat: true, gopSize: FRAMES }, 4, 8),
    ).toBe(true);
  });

  it("encodes a closed-GOP distributed chunk byte-identical to the encode after capture", async () => {
    const { root, framesDir, landed, merge } = captureToWorkerDirs();
    const locked = (name: string) => ({
      ...makeInput(root, framesDir, name),
      lockGopForChunkConcat: true,
      gopSize: FRAMES,
    });
    const overlap = encodeWhileCapturing(locked("overlap.mp4"), FRAMES);
    for (const frame of [...landed.slice(FRAMES / 2), ...landed.slice(0, FRAMES / 2)]) {
      overlap.onFrameLanded(frame);
    }
    await until(() => overlap.framesFed === FRAMES);
    merge();
    await overlap.finish();

    await runEncodeStage(locked("after.mp4"));
    expect(sha(join(root, "overlap.mp4"))).toBe(sha(join(root, "after.mp4")));
  });

  it("encodes in frame order while frames land out of order, byte-identical to the encode after capture", async () => {
    const { root, framesDir, landed, merge } = captureToWorkerDirs();
    const overlap = encodeWhileCapturing(makeInput(root, framesDir, "overlap.mp4"), FRAMES);
    // Worker 1 finishes its range before worker 0 does.
    for (const frame of [...landed.slice(FRAMES / 2), ...landed.slice(0, FRAMES / 2)]) {
      overlap.onFrameLanded(frame);
    }
    await until(() => overlap.framesFed === FRAMES);
    merge();
    await overlap.finish();

    await runEncodeStage(makeInput(root, framesDir, "after.mp4"));
    expect(sha(join(root, "overlap.mp4"))).toBe(sha(join(root, "after.mp4")));
  });

  it("reads frames the merge already moved, and frames that never reported landing", async () => {
    const { root, framesDir, landed, merge } = captureToWorkerDirs();
    const overlap = encodeWhileCapturing(makeInput(root, framesDir, "overlap.mp4"), FRAMES);
    landed.slice(0, 3).forEach(overlap.onFrameLanded);
    merge();
    await overlap.finish();

    await runEncodeStage(makeInput(root, framesDir, "after.mp4"));
    expect(sha(join(root, "overlap.mp4"))).toBe(sha(join(root, "after.mp4")));
  });

  it("abort stops an encoder still waiting on frames", async () => {
    const { root, framesDir, landed } = captureToWorkerDirs();
    const overlap = encodeWhileCapturing(makeInput(root, framesDir, "overlap.mp4"), FRAMES);
    overlap.onFrameLanded(landed[0]!);
    await until(() => overlap.framesFed === 1);
    await overlap.abort();
    expect(overlap.framesFed).toBe(1);
  });
});
