import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHUNK_FRAME_RANGE_INVALID,
  renderChunk,
  RenderChunkValidationError,
  resolveChunkFrameRange,
} from "./renderChunk.js";

const SLICE = { index: 1, startFrame: 10, endFrame: 20 };

describe("resolveChunkFrameRange", () => {
  it("is the whole slice when omitted", () => {
    expect(resolveChunkFrameRange(SLICE, 1, undefined)).toEqual({ startFrame: 10, endFrame: 20 });
  });

  it.each([
    [10, 20],
    [10, 11],
    [13, 17],
    [19, 20],
  ])("accepts [%i, %i) inside the slice", (startFrame, endFrame) => {
    expect(resolveChunkFrameRange(SLICE, 1, { startFrame, endFrame })).toEqual({
      startFrame,
      endFrame,
    });
  });

  it.each([
    ["starts before the slice", 9, 15],
    ["ends past the slice", 15, 21],
    ["is empty", 15, 15],
    ["is reversed", 16, 15],
    ["is not whole frames", 12.5, 15],
    ["is not a number", Number.NaN, 15],
  ])("rejects a range that %s", (_, startFrame, endFrame) => {
    let caught: unknown;
    try {
      resolveChunkFrameRange(SLICE, 1, { startFrame, endFrame });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RenderChunkValidationError);
    expect((caught as RenderChunkValidationError).code).toBe(CHUNK_FRAME_RANGE_INVALID);
    expect((caught as Error).message).toContain("chunk 1's slice [10, 20)");
  });
});

describe("renderChunk() frameRange validation", () => {
  let root: string;
  let planDir: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "hf-chunk-frame-range-"));
    planDir = join(root, "plan");
    mkdirSync(join(planDir, "meta"), { recursive: true });
    writeFileSync(join(planDir, "plan.json"), JSON.stringify({ planHash: "fake" }));
    writeFileSync(join(planDir, "meta", "encoder.json"), "{}");
    writeFileSync(
      join(planDir, "meta", "chunks.json"),
      JSON.stringify([{ index: 0, startFrame: 0, endFrame: 10 }, SLICE]),
    );
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // The check runs before ffmpeg, the plan hash or a browser, so a bad range fails fast.
  it("rejects a range outside the chunk's slice before rendering", async () => {
    const out = join(root, "out.mp4");
    await expect(
      renderChunk(planDir, 1, out, { frameRange: { startFrame: 5, endFrame: 15 } }),
    ).rejects.toMatchObject({ code: CHUNK_FRAME_RANGE_INVALID });
    await expect(
      renderChunk(planDir, 1, out, { frameRange: { startFrame: 12, endFrame: 12 } }),
    ).rejects.toMatchObject({ code: CHUNK_FRAME_RANGE_INVALID });
  });
});
