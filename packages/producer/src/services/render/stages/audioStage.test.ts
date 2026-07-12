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
      audios,
      abortSignal: undefined,
      assertNotAborted: () => {},
      ...overrides,
    };
  }

  it("surfaces the mixer's error as audioError when the mix fails", async () => {
    processCompositionAudioMock.mockResolvedValue({
      success: false,
      outputPath: "audio.aac",
      durationMs: 1,
      tracksProcessed: 0,
      error: "Source not found: a1 (narration.wav)",
    });

    const result = await runAudioStage(makeInput());

    expect(result.hasAudio).toBe(false);
    expect(result.audioError).toBe("Source not found: a1 (narration.wav)");
  });

  it("falls back to a generic message when the mixer fails without an error string", async () => {
    processCompositionAudioMock.mockResolvedValue({
      success: false,
      outputPath: "audio.aac",
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
      outputPath: "audio.aac",
      durationMs: 1,
      tracksProcessed: 1,
    });

    const result = await runAudioStage(makeInput());

    expect(result.hasAudio).toBe(true);
    expect(result.audioError).toBeUndefined();
  });

  it("does not set audioError when there is no audio to mix", async () => {
    const result = await runAudioStage(makeInput({ audios: [] }));

    expect(processCompositionAudioMock).not.toHaveBeenCalled();
    expect(result.hasAudio).toBe(false);
    expect(result.audioError).toBeUndefined();
  });
});
