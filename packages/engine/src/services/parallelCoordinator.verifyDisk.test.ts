import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { psnrDb } from "../utils/psnr.js";
import { isDrawElementVerificationError, type CaptureSession } from "./frameCapture.js";
import { verifyDiskDrawElementSamples, type WorkerTask } from "./parallelCoordinator.js";

vi.mock("../utils/psnr.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/psnr.js")>()),
  psnrDb: vi.fn(),
}));

const psnr = vi.mocked(psnrDb);
const FLOOR_DB = 32;

describe("verifyDiskDrawElementSamples", () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), "hf-disk-verify-"));
    psnr.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const truthFor = (frame: number) => Buffer.from(`truth-${frame}`);
  const sessionWith = (
    frames: number[],
    overrides: { captureMode?: CaptureSession["captureMode"]; format?: "jpeg" | "png" } = {},
  ) =>
    ({
      captureMode: overrides.captureMode ?? "drawelement",
      options: { format: overrides.format ?? "jpeg" },
      deVerifyFrames: new Map(frames.map((frame) => [frame, truthFor(frame)])),
    }) as unknown as CaptureSession;
  const taskWith = (overrides: Partial<WorkerTask> = {}) =>
    ({ workerId: 1, startFrame: 0, endFrame: 10, outputDir, ...overrides }) as WorkerTask;
  const writeFrame = (fileIndex: number, ext = "jpg") => {
    const bytes = Buffer.from(`captured-${fileIndex}`);
    writeFileSync(join(outputDir, `frame_${String(fileIndex).padStart(6, "0")}.${ext}`), bytes);
    return bytes;
  };

  it("fails the worker on a sample below the floor, naming the frame and its score", async () => {
    writeFrame(2);
    writeFrame(4);
    psnr.mockResolvedValueOnce(50).mockResolvedValueOnce(FLOOR_DB - 0.1);

    const error = await verifyDiskDrawElementSamples(sessionWith([2, 4]), taskWith(), false).catch(
      (e: unknown) => e,
    );

    expect(isDrawElementVerificationError(error)).toBe(true);
    expect(error).toMatchObject({
      kind: "psnr",
      frameIndex: 4,
      failedDb: FLOOR_DB - 0.1,
      verifyThresholdDb: FLOOR_DB,
    });
  });

  it("passes a sample exactly on the floor", async () => {
    writeFrame(2);
    psnr.mockResolvedValue(FLOOR_DB);
    await expect(
      verifyDiskDrawElementSamples(sessionWith([2]), taskWith(), false),
    ).resolves.toBeUndefined();
    expect(psnr).toHaveBeenCalledTimes(1);
  });

  it("compares each captured file against its own ground truth", async () => {
    const two = writeFrame(2);
    const four = writeFrame(4);
    psnr.mockResolvedValue(50);
    await verifyDiskDrawElementSamples(sessionWith([4, 2]), taskWith(), false);
    expect(psnr.mock.calls).toEqual([
      [two, truthFor(2)],
      [four, truthFor(4)],
    ]);
  });

  it("finds a chunk's frames through the output offset", async () => {
    const onDisk = writeFrame(2);
    psnr.mockResolvedValue(50);
    await verifyDiskDrawElementSamples(
      sessionWith([12]),
      taskWith({ startFrame: 10, endFrame: 20, outputFrameOffset: 10 }),
      false,
    );
    expect(psnr.mock.calls).toEqual([[onDisk, truthFor(12)]]);
  });

  it("reads png frames from a png capture", async () => {
    const onDisk = writeFrame(2, "png");
    psnr.mockResolvedValue(50);
    await verifyDiskDrawElementSamples(sessionWith([2], { format: "png" }), taskWith(), false);
    expect(psnr.mock.calls).toEqual([[onDisk, truthFor(2)]]);
  });

  it("checks only the samples this worker captured", async () => {
    const mine = writeFrame(4);
    psnr.mockResolvedValue(50);
    await verifyDiskDrawElementSamples(
      sessionWith([1, 3, 4, 12]),
      taskWith({ startFrame: 0, endFrame: 10, frameStride: 2 }),
      false,
    );
    expect(psnr.mock.calls).toEqual([[mine, truthFor(4)]]);
  });

  it.each([
    ["a streaming capture, whose drain already checks", true, "drawelement"],
    ["a session that fell back to screenshots", false, "screenshot"],
  ] as const)("does not compare on %s", async (_name, streaming, captureMode) => {
    writeFrame(2);
    await verifyDiskDrawElementSamples(sessionWith([2], { captureMode }), taskWith(), streaming);
    expect(psnr).not.toHaveBeenCalled();
  });

  it("skips a sample whose file cannot be read, and still checks the next", async () => {
    writeFrame(4);
    psnr.mockResolvedValue(FLOOR_DB - 1);
    const error = await verifyDiskDrawElementSamples(sessionWith([2, 4]), taskWith(), false).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ frameIndex: 4 });
  });

  it("skips a sample the compare could not score, and still checks the next", async () => {
    writeFrame(2);
    writeFrame(4);
    psnr.mockRejectedValueOnce(new Error("could not parse psnr")).mockResolvedValue(FLOOR_DB - 1);
    const error = await verifyDiskDrawElementSamples(sessionWith([2, 4]), taskWith(), false).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ frameIndex: 4 });
  });

  it.each([
    ["a missing filter", new Error("No such filter: 'psnr'")],
    ["a missing binary", Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" })],
  ])("aborts rather than ship unverified frames on %s", async (_name, failure) => {
    writeFrame(2);
    psnr.mockRejectedValue(failure);
    const error = await verifyDiskDrawElementSamples(sessionWith([2]), taskWith(), false).catch(
      (e: unknown) => e,
    );
    expect(isDrawElementVerificationError(error)).toBe(false);
    expect((error as Error).message).toContain("disk self-verify aborted");
  });
});
