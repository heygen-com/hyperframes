import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
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

describe("transcribe — whisper unavailable", () => {
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
});
