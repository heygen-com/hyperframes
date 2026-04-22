import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { runFfmpegMock } = vi.hoisted(() => ({
  runFfmpegMock: vi.fn(async () => ({
    success: true,
    durationMs: 1,
    stderr: "",
    exitCode: 0,
  })),
}));

vi.mock("../utils/runFfmpeg.js", () => ({
  runFfmpeg: runFfmpegMock,
}));

import { processCompositionAudio } from "./audioMixer.js";

describe("processCompositionAudio", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    runFfmpegMock.mockClear();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves muted tracks and uses unity master gain by default", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);

    writeFileSync(join(baseDir, "voice.wav"), "stub");

    const result = await processCompositionAudio(
      [
        {
          id: "voice",
          src: "voice.wav",
          start: 0,
          end: 2,
          mediaStart: 0,
          layer: 0,
          volume: 0,
          type: "audio",
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      2,
    );

    expect(result.success).toBe(true);
    expect(runFfmpegMock).toHaveBeenCalledTimes(2);

    const mixArgs = runFfmpegMock.mock.calls[1]?.[0];
    const filterIndex = mixArgs.indexOf("-filter_complex");
    const filter = mixArgs[filterIndex + 1];

    expect(filter).toContain("volume=0");
    expect(filter).toContain("[mixed]volume=1[out]");
  });
});
