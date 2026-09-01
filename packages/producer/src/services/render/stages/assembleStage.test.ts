import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssembleStageInput } from "./assembleStage.js";

const { applyFaststartMock, muxVideoWithAudioMock, padOrTrimAudioMock } = vi.hoisted(() => ({
  applyFaststartMock: vi.fn(),
  muxVideoWithAudioMock: vi.fn(),
  padOrTrimAudioMock: vi.fn(),
}));

vi.mock("@hyperframes/engine", () => ({
  applyFaststart: applyFaststartMock,
  muxVideoWithAudio: muxVideoWithAudioMock,
}));

vi.mock("../audioPadTrim.js", () => ({
  padOrTrimAudioToVideoFrameCount: padOrTrimAudioMock,
}));

vi.mock("../shared.js", () => ({
  updateJobStatus: vi.fn(),
}));

import { runAssembleStage } from "./assembleStage.js";
import { EncoderInterruptedError } from "../encoderInterruption.js";

function makeInput(overrides: Partial<AssembleStageInput> = {}): AssembleStageInput {
  return {
    job: {
      id: "aac-duration-parity",
      config: { fps: { num: 30, den: 1 }, quality: "draft" },
      status: "queued",
      progress: 0,
      currentStage: "queued",
      createdAt: new Date(0),
      duration: 1,
    },
    videoOnlyPath: "/tmp/video-only.mp4",
    audioOutputPath: "/tmp/audio.m4a",
    outputPath: "/tmp/output.mp4",
    hasAudio: true,
    abortSignal: undefined,
    assertNotAborted: () => {},
    ...overrides,
  };
}

describe("runAssembleStage audio duration parity", () => {
  beforeEach(() => {
    applyFaststartMock.mockReset();
    muxVideoWithAudioMock.mockReset();
    padOrTrimAudioMock.mockReset();
    applyFaststartMock.mockResolvedValue({ success: true });
    muxVideoWithAudioMock.mockResolvedValue({ success: true });
    padOrTrimAudioMock.mockResolvedValue({
      success: true,
      outputPath: "/tmp/audio.duration-normalized.m4a",
      targetDurationSeconds: 1,
      sourceDurationSeconds: 1.024,
      operation: "trim",
    });
  });

  it("normalizes mixed AAC to the encoded video frame duration before muxing", async () => {
    await runAssembleStage(makeInput());

    expect(padOrTrimAudioMock).toHaveBeenCalledWith({
      videoPath: "/tmp/video-only.mp4",
      audioPath: "/tmp/audio.m4a",
      outputPath: "/tmp/audio.duration-normalized.m4a",
      signal: undefined,
    });
    expect(muxVideoWithAudioMock).toHaveBeenCalledWith(
      "/tmp/video-only.mp4",
      "/tmp/audio.duration-normalized.m4a",
      "/tmp/output.mp4",
      undefined,
      { audioCodec: "aac" },
      { num: 30, den: 1 },
    );
  });

  it("uses a distinct AAC normalization path when the mixed-audio extension differs", async () => {
    await runAssembleStage(makeInput({ audioOutputPath: "/tmp/audio.m4a" }));

    expect(padOrTrimAudioMock).toHaveBeenCalledWith({
      videoPath: "/tmp/video-only.mp4",
      audioPath: "/tmp/audio.m4a",
      outputPath: "/tmp/audio.duration-normalized.m4a",
      signal: undefined,
    });
  });

  it("fails instead of muxing an unnormalized AAC tail", async () => {
    padOrTrimAudioMock.mockResolvedValue({
      success: false,
      outputPath: "/tmp/audio.duration-normalized.m4a",
      targetDurationSeconds: 1,
      sourceDurationSeconds: 1.024,
      operation: "trim",
      error: "ffmpeg trim failed",
    });

    await expect(runAssembleStage(makeInput())).rejects.toThrow(
      "Audio duration normalization failed: ffmpeg trim failed",
    );
    expect(muxVideoWithAudioMock).not.toHaveBeenCalled();
  });

  it("preserves an external interruption from final audio mux", async () => {
    muxVideoWithAudioMock.mockResolvedValue({
      success: false,
      error: "FFmpeg exited with code 255\nprivate stderr",
      failureReason: "external_interruption",
    });

    await expect(runAssembleStage(makeInput())).rejects.toBeInstanceOf(EncoderInterruptedError);
  });

  it("preserves an external interruption from audio duration normalization", async () => {
    padOrTrimAudioMock.mockResolvedValue({
      success: false,
      error: "FFmpeg exited with code 255\nprivate stderr",
      failureReason: "external_interruption",
    });

    await expect(runAssembleStage(makeInput())).rejects.toBeInstanceOf(EncoderInterruptedError);
  });

  it("preserves an external interruption from MP4 faststart", async () => {
    applyFaststartMock.mockResolvedValue({
      success: false,
      error: "FFmpeg exited with code 255\nprivate stderr",
      failureReason: "external_interruption",
    });

    await expect(runAssembleStage(makeInput({ hasAudio: false }))).rejects.toBeInstanceOf(
      EncoderInterruptedError,
    );
  });
});
