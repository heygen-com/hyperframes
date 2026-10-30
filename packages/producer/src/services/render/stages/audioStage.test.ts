import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseMasterFxChain, type AudioElement, type VideoElement } from "@hyperframes/engine";

const { processCompositionAudioMock, constrainAacTruePeakMock } = vi.hoisted(() => ({
  processCompositionAudioMock: vi.fn(),
  constrainAacTruePeakMock: vi.fn(async () => ({
    success: true,
    error: undefined as string | undefined,
    loweredDb: undefined as number | undefined,
  })),
}));

vi.mock("../audioPadTrim.js", () => ({ constrainAacTruePeak: constrainAacTruePeakMock }));

vi.mock("@hyperframes/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/engine")>();
  return { ...actual, processCompositionAudio: processCompositionAudioMock };
});

import { runAudioStage } from "./audioStage.js";
import { appendAutoDetectedVideoAudio } from "./extractVideosStage.js";
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
    constrainAacTruePeakMock.mockClear();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeInput(overrides: Partial<Parameters<typeof runAudioStage>[0]> = {}) {
    const workDir = mkdtempSync(join(tmpdir(), "hf-audiostage-"));
    tempDirs.push(workDir);
    return {
      projectDir: workDir,
      workDir,
      compiledDir: join(workDir, "compiled"),
      totalFrames: 150,
      fps: { num: 30, den: 1 },
      ffmpegProcessTimeout: 3_600_000,
      audioGain: 1,
      audios,
      abortSignal: undefined,
      assertNotAborted: () => {},
      ...overrides,
    };
  }

  it.each([
    { totalFrames: 91, fps: { num: 30, den: 1 }, seconds: 3.033333333333333 },
    { totalFrames: 31, fps: { num: 30000, den: 1001 }, seconds: 1.0343666666666667 },
  ])(
    "mixes the exact frame duration: $totalFrames at $fps.num/$fps.den",
    async ({ totalFrames, fps, seconds }) => {
      processCompositionAudioMock.mockResolvedValueOnce({ success: true, tracksProcessed: 1 });
      await runAudioStage(makeInput({ totalFrames, fps }));
      expect(processCompositionAudioMock.mock.calls[0]?.[4]).toBe(seconds);
      expect(constrainAacTruePeakMock).toHaveBeenCalledWith(
        expect.objectContaining({ targetDurationSeconds: seconds }),
      );
    },
  );

  it("keeps PCM through the encoded peak check and removes it afterwards", async () => {
    const input = makeInput();
    const pcm = join(input.workDir, "audio-source.wav");
    processCompositionAudioMock.mockImplementationOnce(async () => {
      writeFileSync(pcm, "retained mix");
      return { success: true, tracksProcessed: 1 };
    });
    constrainAacTruePeakMock.mockImplementationOnce(async () => {
      expect(existsSync(pcm)).toBe(true);
      return { success: true, error: undefined, loweredDb: 1.44 };
    });
    const result = await runAudioStage(input);
    expect(constrainAacTruePeakMock).toHaveBeenCalledWith({
      audioPath: result.audioOutputPath,
      sourcePath: pcm,
      targetDurationSeconds: 5,
      signal: undefined,
      timeoutMs: 3_600_000,
    });
    expect(existsSync(pcm)).toBe(false);
    expect(result.audioLoweredDb).toBe(1.44);
  });

  it("surfaces an encoded peak failure and still removes PCM", async () => {
    const input = makeInput();
    const pcm = join(input.workDir, "audio-source.wav");
    processCompositionAudioMock.mockImplementationOnce(async () => {
      writeFileSync(pcm, "retained mix");
      return { success: true, tracksProcessed: 1 };
    });
    constrainAacTruePeakMock.mockResolvedValueOnce({
      success: false,
      error: "peak probe failed",
      loweredDb: undefined,
    });
    await expect(runAudioStage(input)).rejects.toThrow("peak probe failed");
    expect(existsSync(pcm)).toBe(false);
  });

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
      {
        ffmpegProcessTimeout: 3_600_000,
        audioGain: 1,
        keepEncoderInputAt: expect.stringMatching(/audio-source\.wav$/),
      },
      expect.any(String),
    );
  });

  it("hands the master chain to the mixer when the only track is the one the render added for a plain video", async () => {
    // A plain <video> has no audio entry at compile time; the render adds one after probing
    // its file. That track is not parsed from HTML, so the chain cannot ride on it.
    const chain = '{"version":1,"nodes":[]}';
    const html = `<div data-composition-id="main" data-fx-chain='${chain}'><video id="talk" src="talk.mp4" data-start="0" data-duration="5"></video></div>`;
    const video: VideoElement = {
      id: "talk",
      src: "talk.mp4",
      start: 0,
      end: 5,
      mediaStart: 0,
      loop: false,
      hasAudio: true,
    };
    const composition = {
      videos: [video],
      audios: [] as AudioElement[],
      masterFxChain: parseMasterFxChain(html),
    };
    appendAutoDetectedVideoAudio(composition, [
      {
        videoId: "talk",
        metadata: { hasAudio: true },
      } as Parameters<typeof appendAutoDetectedVideoAudio>[1][number],
    ]);
    expect(composition.audios.map((audio) => audio.id)).toEqual(["talk-audio"]);
    processCompositionAudioMock.mockResolvedValue({
      success: true,
      outputPath: "audio.m4a",
      durationMs: 1,
      tracksProcessed: 1,
    });

    await runAudioStage(
      makeInput({ audios: composition.audios, masterFxChain: composition.masterFxChain }),
    );

    expect(processCompositionAudioMock).toHaveBeenCalledWith(
      composition.audios,
      expect.any(String),
      expect.any(String),
      expect.any(String),
      5,
      undefined,
      {
        ffmpegProcessTimeout: 3_600_000,
        audioGain: 1,
        masterFxChain: chain,
        keepEncoderInputAt: expect.stringMatching(/audio-source\.wav$/),
      },
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

  it("logs the mixer's phase times and the peak check's as one line", async () => {
    const phaseMs = { prepare: 11, groups: 2, mix: 30, master: 4, encode: 20 };
    processCompositionAudioMock.mockResolvedValue({
      success: true,
      outputPath: "audio.m4a",
      durationMs: 1,
      tracksProcessed: 1,
      phaseMs,
    });
    const info = vi.fn();

    await runAudioStage(makeInput({ log: { info } as never }));

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      "[audio] phases",
      expect.objectContaining({ ...phaseMs, guard: expect.any(Number) }),
    );
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
          detail: "private ffmpeg handled signal 15",
          elementId: "private-element",
          subprocess: { exitCode: 255, terminationReason: "exit" },
        },
      ],
    });

    const pending = runAudioStage(makeInput());
    await expect(pending).rejects.toBeInstanceOf(EncoderInterruptedError);
    await expect(pending).rejects.toMatchObject({
      audioFailures: [
        {
          stage: "mix",
          reason: "external_interruption",
          owner: "system",
          retryable: true,
          subprocess: { exitCode: 255, terminationReason: "exit" },
        },
      ],
    });
    await pending.catch((error: EncoderInterruptedError) => {
      expect(JSON.stringify(error.audioFailures)).not.toContain("private");
    });
  });

  it("does not set audioError when there is no audio to mix", async () => {
    const result = await runAudioStage(makeInput({ audios: [] }));

    expect(processCompositionAudioMock).not.toHaveBeenCalled();
    expect(constrainAacTruePeakMock).not.toHaveBeenCalled();
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
