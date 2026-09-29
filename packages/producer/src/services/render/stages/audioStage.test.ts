import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AudioElement } from "@hyperframes/engine";

const { processCompositionAudioMock } = vi.hoisted(() => ({
  processCompositionAudioMock: vi.fn(),
}));

vi.mock("@hyperframes/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/engine")>();
  return { ...actual, processCompositionAudio: processCompositionAudioMock };
});

import { runAudioStage } from "./audioStage.js";
import { EncoderInterruptedError } from "../encoderInterruption.js";

// Regression: hasAudio flipping to false used to be indistinguishable from
// "no audio was authored" — processCompositionAudio's error (per-element
// failures, or the mix's own failure) was read into hasAudio and then
// discarded, so a real audio-mix failure shipped a silent video-only render
// with no indication anything went wrong. audioError carries that reason.
describe("runAudioStage", () => {
  const tempDirs: string[] = [];
  const audios: AudioElement[] = [
    { id: "a1", src: "narration.wav", start: 0, end: 5, mediaStart: 0, volume: 1, type: "audio" },
  ];

  afterEach(() => {
    processCompositionAudioMock.mockClear();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeInput(overrides: Partial<Parameters<typeof runAudioStage>[0]> = {}) {
    const workDir = mkdtempSync(join(tmpdir(), "hf-audiostage-"));
    tempDirs.push(workDir);
    return {
      projectDir: workDir,
      workDir,
      compiledDir: join(workDir, "compiled"),
      duration: 5,
      ffmpegProcessTimeout: 3_600_000,
      audioGain: 1,
      audios,
      abortSignal: undefined,
      assertNotAborted: () => {},
      ...overrides,
    };
  }

  it("surfaces the mixer's error as audioError when the mix fails", async () => {
    processCompositionAudioMock.mockResolvedValue({
      success: false,
      outputPath: "audio.m4a",
      durationMs: 1,
      tracksProcessed: 0,
      error: "Source not found: a1 (narration.wav)",
      failures: [
        {
          stage: "source",
          reason: "source_not_found",
          owner: "user",
          retryable: false,
          elementId: "a1",
          detail: "Source not found for audio element a1",
        },
      ],
    });

    const result = await runAudioStage(makeInput());

    expect(result.hasAudio).toBe(false);
    expect(result.audioError).toBe("Source not found: a1 (narration.wav)");
    expect(result.audioFailures).toEqual([
      expect.objectContaining({ reason: "source_not_found", stage: "source" }),
    ]);
    expect(processCompositionAudioMock).toHaveBeenCalledWith(
      audios,
      expect.any(String),
      expect.any(String),
      expect.any(String),
      5,
      undefined,
      { ffmpegProcessTimeout: 3_600_000, audioGain: 1 },
      expect.any(String),
    );
  });

  it("falls back to a generic message when the mixer fails without an error string", async () => {
    processCompositionAudioMock.mockResolvedValue({
      success: false,
      outputPath: "audio.m4a",
      durationMs: 1,
      tracksProcessed: 0,
    });

    const result = await runAudioStage(makeInput());

    expect(result.hasAudio).toBe(false);
    expect(result.audioError).toBe("audio mix failed for an unknown reason");
  });

  it("does not set audioError when the mix succeeds", async () => {
    processCompositionAudioMock.mockResolvedValue({
      success: true,
      outputPath: "audio.m4a",
      durationMs: 1,
      tracksProcessed: 1,
    });

    const result = await runAudioStage(makeInput());

    expect(result.hasAudio).toBe(true);
    expect(result.audioError).toBeUndefined();
  });

  it("throws a structured retry signal when audio ffmpeg is externally interrupted", async () => {
    processCompositionAudioMock.mockResolvedValue({
      success: false,
      outputPath: "audio.m4a",
      durationMs: 1,
      tracksProcessed: 0,
      failures: [
        {
          stage: "mix",
          reason: "external_interruption",
          owner: "system",
          retryable: true,
          detail: "ffmpeg handled signal 15",
        },
      ],
    });

    await expect(runAudioStage(makeInput())).rejects.toBeInstanceOf(EncoderInterruptedError);
  });

  it("does not set audioError when there is no audio to mix", async () => {
    const result = await runAudioStage(makeInput({ audios: [] }));

    expect(processCompositionAudioMock).not.toHaveBeenCalled();
    expect(result.hasAudio).toBe(false);
    expect(result.audioError).toBeUndefined();
    expect(result.audioFailures).toBeUndefined();
  });

  it("reports a rejection as audioError instead of letting it escape the stage", async () => {
    // An FX failure the mixer cannot degrade past rejects rather than returning a
    // result. Escaping here would reach the orchestrator as an unclassified
    // pipeline exception, losing the stage/owner/retryable classification — and
    // skipping the abort check this stage runs.
    processCompositionAudioMock.mockRejectedValue(
      new Error("Audio FX failed for track bgm: browser launch failed"),
    );
    const result = await runAudioStage(makeInput());
    expect(result.hasAudio).toBe(false);
    expect(result.audioError).toMatch(/Audio FX failed for track bgm/);
    // And it is classified. This used to come back undefined, so the warning
    // policy — which reads owner, retryability, reason and stage off this list
    // — described the FATAL failure with strictly less detail than a single
    // dropped track gets.
    expect(result.audioFailures).toEqual([
      {
        stage: "internal",
        reason: "internal",
        owner: "system",
        retryable: false,
        detail: "Audio FX failed for track bgm: browser launch failed",
      },
    ]);
  });

  it("bounds the synthesised failure's detail", async () => {
    // `detail` is contractually bounded diagnostic text; an ffmpeg-flavoured
    // message can run to tens of kilobytes.
    processCompositionAudioMock.mockRejectedValue(new Error("x".repeat(5_000)));
    const result = await runAudioStage(makeInput());
    expect(result.audioFailures?.[0]?.detail.length).toBe(2_000);
  });

  it("lets an abort keep its own shape rather than becoming an audio error", async () => {
    processCompositionAudioMock.mockRejectedValue(new Error("boom"));
    const aborted = new Error("render aborted");
    await expect(
      runAudioStage(
        makeInput({
          assertNotAborted: () => {
            throw aborted;
          },
        }),
      ),
    ).rejects.toBe(aborted);
  });
});
