import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WhisperUnavailableError } from "../whisper/manager.js";

// Make the whisper core report "unavailable" so we exercise the soft-skip path.
const transcribeMock = vi.fn();
vi.mock("../whisper/transcribe.js", () => ({ transcribe: transcribeMock }));

const trackTranscribeUnavailable = vi.fn();
const trackCommandFailure = vi.fn();
vi.mock("../telemetry/events.js", () => ({
  trackTranscribeUnavailable: (...a: unknown[]) => trackTranscribeUnavailable(...a),
  trackCommandFailure: (...a: unknown[]) => trackCommandFailure(...a),
}));

import transcribeCmd from "./transcribe.js";

function dummyAudio(): { dir: string; input: string } {
  const dir = mkdtempSync(join(tmpdir(), "hf-transcribe-test-"));
  const input = join(dir, "narration.wav");
  writeFileSync(input, "not-real-audio");
  return { dir, input };
}

describe("transcribe command", () => {
  let dirs: string[] = [];
  let priorExitCode: typeof process.exitCode;

  beforeEach(() => {
    dirs = [];
    priorExitCode = process.exitCode;
    process.exitCode = undefined;
    transcribeMock.mockReset();
    trackTranscribeUnavailable.mockReset();
    trackCommandFailure.mockReset();
    transcribeMock.mockRejectedValue(
      new WhisperUnavailableError("whisper-cpp not found. Install: brew install whisper-cpp"),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = priorExitCode;
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("explicit run exits non-zero and is NOT reported as a command failure", async () => {
    const { dir, input } = dummyAudio();
    dirs.push(dir);
    await transcribeCmd.run!({ args: { input, json: true, optional: false } } as never);

    expect(process.exitCode).toBe(1);
    expect(trackTranscribeUnavailable).toHaveBeenCalledWith({ optional: false });
    expect(trackCommandFailure).not.toHaveBeenCalled();
  });

  it("--optional skips cleanly with exit 0", async () => {
    const { dir, input } = dummyAudio();
    dirs.push(dir);
    await transcribeCmd.run!({ args: { input, json: true, optional: true } } as never);

    expect(process.exitCode).toBe(0);
    expect(trackTranscribeUnavailable).toHaveBeenCalledWith({ optional: true });
    expect(trackCommandFailure).not.toHaveBeenCalled();
  });

  it("imports an SRT and exports an SRT sidecar from transcript.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-transcribe-test-"));
    dirs.push(dir);
    const input = join(dir, "sample.srt");
    const sample = `1
00:00:01,000 --> 00:00:03,500
Write HTML.

2
00:00:03,500 --> 00:00:06,000
Render video. Built for agents.
`;
    writeFileSync(input, sample);

    await transcribeCmd.run!({ args: { input, dir, json: true } } as never);
    const transcriptPath = join(dir, "transcript.json");

    await transcribeCmd.run!({ args: { input: transcriptPath, to: "srt", json: true } } as never);
    const outputPath = join(dir, "transcript.srt");

    expect(readFileSync(outputPath, "utf-8")).toBe(sample);
    const log = vi.mocked(console.log).mock.calls.at(-1)?.[0];
    expect(typeof log).toBe("string");
    if (typeof log !== "string") throw new Error("Expected JSON log output");
    expect(JSON.parse(log)).toEqual({
      ok: true,
      format: "srt",
      wordCount: 2,
      outputPath,
    });
  });

  it("rejects a below-minimum --timeout with a discoverable error", async () => {
    const { dir, input } = dummyAudio();
    dirs.push(dir);
    const consoleLog = vi.mocked(console.log);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit_${code}__`);
    }) as never);

    // 100 is well below the 5000ms minimum — must fail loud instead of silently
    // reverting to the auto-scaled default (the whole point of the flag is
    // that the user explicitly asked for a specific value).
    await expect(
      transcribeCmd.run!({ args: { input, json: true, timeout: "100" } } as never),
    ).rejects.toThrow("__exit_1__");

    const log = consoleLog.mock.calls.at(-1)?.[0];
    expect(typeof log).toBe("string");
    if (typeof log !== "string") throw new Error("Expected JSON log output");
    const parsed = JSON.parse(log);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("--timeout");
    expect(parsed.error).toContain("5000");

    exitSpy.mockRestore();
  });

  it("--preserve-cues keeps single-word cues separate when exporting from JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-transcribe-test-"));
    dirs.push(dir);
    // Single-word cues have no internal whitespace, so the whitespace heuristic
    // can't tell them from word-level whisper output. --preserve-cues forces 1:1.
    const transcriptPath = join(dir, "transcript.json");
    writeFileSync(
      transcriptPath,
      JSON.stringify([
        { text: "Yes", start: 0, end: 1 },
        { text: "No", start: 1, end: 2 },
      ]),
    );

    await transcribeCmd.run!({
      args: { input: transcriptPath, to: "srt", "preserve-cues": true, json: true },
    } as never);

    const output = readFileSync(join(dir, "transcript.srt"), "utf-8");
    expect(output).toBe(
      "1\n00:00:00,000 --> 00:00:01,000\nYes\n\n2\n00:00:01,000 --> 00:00:02,000\nNo\n",
    );
  });
});
