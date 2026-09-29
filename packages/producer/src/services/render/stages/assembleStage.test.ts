import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssembleStageInput } from "./assembleStage.js";

const { applyFaststartMock, muxVideoWithAudioMock, packageHlsMock, padOrTrimAudioMock } =
  vi.hoisted(() => ({
    applyFaststartMock: vi.fn(),
    muxVideoWithAudioMock: vi.fn(),
    packageHlsMock: vi.fn(),
    padOrTrimAudioMock: vi.fn(),
  }));

vi.mock("@hyperframes/engine", () => ({
  applyFaststart: applyFaststartMock,
  muxVideoWithAudio: muxVideoWithAudioMock,
  packageHls: packageHlsMock,
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

function resetMocks(): void {
  applyFaststartMock.mockReset();
  muxVideoWithAudioMock.mockReset();
  packageHlsMock.mockReset();
  padOrTrimAudioMock.mockReset();
  applyFaststartMock.mockResolvedValue({ success: true });
  muxVideoWithAudioMock.mockResolvedValue({ success: true });
  packageHlsMock.mockResolvedValue({ success: true });
  padOrTrimAudioMock.mockResolvedValue({
    success: true,
    outputPath: "/tmp/audio.duration-normalized.m4a",
    targetDurationSeconds: 1,
    sourceDurationSeconds: 1.024,
    operation: "trim",
  });
}

describe("runAssembleStage audio duration parity", () => {
  beforeEach(resetMocks);

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

  it("leaves every non-hls format on the mux/faststart path", async () => {
    for (const format of ["mp4", "webm", "mov"] as const) {
      resetMocks();
      await runAssembleStage(makeInput({ format }));
      expect(muxVideoWithAudioMock).toHaveBeenCalledTimes(1);
      expect(packageHlsMock).not.toHaveBeenCalled();
    }
  });
});

describe("runAssembleStage HLS packaging", () => {
  beforeEach(resetMocks);

  function hlsInput(overrides: Partial<AssembleStageInput> = {}): AssembleStageInput {
    return makeInput({ format: "hls", outputPath: "/tmp/output-hls", ...overrides });
  }

  it("packages the normalized audio alongside the video and skips the mp4 mux", async () => {
    await runAssembleStage(hlsInput({ hlsSegmentSeconds: 6 }));

    // The audio sidecar is normalized to the video frame count first — the
    // packager stream-copies, so it cannot fix a length mismatch itself.
    expect(padOrTrimAudioMock).toHaveBeenCalledWith({
      videoPath: "/tmp/video-only.mp4",
      audioPath: "/tmp/audio.m4a",
      outputPath: "/tmp/audio.duration-normalized.m4a",
      signal: undefined,
    });
    expect(packageHlsMock).toHaveBeenCalledWith(
      "/tmp/video-only.mp4",
      "/tmp/audio.duration-normalized.m4a",
      "/tmp/output-hls",
      { segmentSeconds: 6, signal: undefined },
    );
    expect(muxVideoWithAudioMock).not.toHaveBeenCalled();
    expect(applyFaststartMock).not.toHaveBeenCalled();
  });

  it("passes a null audio path and skips faststart when the composition is silent", async () => {
    await runAssembleStage(hlsInput({ hasAudio: false }));

    expect(padOrTrimAudioMock).not.toHaveBeenCalled();
    expect(packageHlsMock).toHaveBeenCalledWith("/tmp/video-only.mp4", null, "/tmp/output-hls", {
      segmentSeconds: 4,
      signal: undefined,
    });
    expect(applyFaststartMock).not.toHaveBeenCalled();
  });

  it("defaults to 4 s segments", async () => {
    await runAssembleStage(hlsInput());

    expect(packageHlsMock.mock.calls[0]?.[3]).toEqual({ segmentSeconds: 4, signal: undefined });
  });

  it("forwards the abort signal to the packager", async () => {
    const abortSignal = new AbortController().signal;
    await runAssembleStage(hlsInput({ abortSignal }));

    expect(packageHlsMock.mock.calls[0]?.[3]).toEqual({ segmentSeconds: 4, signal: abortSignal });
  });

  it("throws 'HLS packaging failed' with the ffmpeg error appended", async () => {
    packageHlsMock.mockResolvedValue({ success: false, error: "Invalid var_stream_map" });

    await expect(runAssembleStage(hlsInput())).rejects.toThrow(
      "HLS packaging failed: Invalid var_stream_map",
    );
  });

  it("preserves an external interruption from HLS packaging", async () => {
    packageHlsMock.mockResolvedValue({
      success: false,
      error: "FFmpeg exited with code 255\nprivate stderr",
      failureReason: "external_interruption",
    });

    await expect(runAssembleStage(hlsInput())).rejects.toBeInstanceOf(EncoderInterruptedError);
  });

  it("fails instead of packaging an unnormalized AAC tail", async () => {
    padOrTrimAudioMock.mockResolvedValue({
      success: false,
      outputPath: "/tmp/audio.duration-normalized.m4a",
      error: "ffmpeg trim failed",
    });

    await expect(runAssembleStage(hlsInput())).rejects.toThrow(
      "Audio duration normalization failed: ffmpeg trim failed",
    );
    expect(packageHlsMock).not.toHaveBeenCalled();
  });
});
