import { beforeEach, describe, expect, it, vi } from "vitest";

const { muxVideoWithAudio, applyFaststart, extractVideoStreamStats, validateVideoStreamParity } =
  vi.hoisted(() => ({
    muxVideoWithAudio: vi.fn(),
    applyFaststart: vi.fn(),
    extractVideoStreamStats: vi.fn(),
    validateVideoStreamParity: vi.fn(),
  }));

vi.mock("@hyperframes/engine", () => ({
  muxVideoWithAudio,
  applyFaststart,
  extractVideoStreamStats,
  validateVideoStreamParity,
}));

vi.mock("../shared.js", () => ({ updateJobStatus: vi.fn() }));

import { runAssembleStage } from "./assembleStage.js";

describe("runAssembleStage stream parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    muxVideoWithAudio.mockResolvedValue({ success: true, durationMs: 1 });
    applyFaststart.mockResolvedValue({ success: true, durationMs: 1 });
    extractVideoStreamStats
      .mockResolvedValueOnce({ durationSeconds: 1050.9, frameCount: 31527 })
      .mockResolvedValueOnce({ durationSeconds: 1050.9, frameCount: 162 });
    validateVideoStreamParity.mockImplementation(() => {
      throw new Error("Video stream frame parity failed after mux: source=31527, output=162");
    });
  });

  it("fails a completed audio mux whose final video packet count is truncated", async () => {
    await expect(
      runAssembleStage({
        job: { config: { fps: { num: 30, den: 1 } } } as never,
        videoOnlyPath: "/tmp/video-only.mp4",
        audioOutputPath: "/tmp/audio.aac",
        outputPath: "/tmp/output.mp4",
        hasAudio: true,
        abortSignal: undefined,
        assertNotAborted: vi.fn(),
      }),
    ).rejects.toThrow(/source=31527, output=162/);

    expect(extractVideoStreamStats).toHaveBeenNthCalledWith(1, "/tmp/video-only.mp4", undefined);
    expect(extractVideoStreamStats).toHaveBeenNthCalledWith(2, "/tmp/output.mp4", undefined);
    expect(validateVideoStreamParity).toHaveBeenCalledWith(
      { durationSeconds: 1050.9, frameCount: 31527 },
      { durationSeconds: 1050.9, frameCount: 162 },
    );
  });
});
