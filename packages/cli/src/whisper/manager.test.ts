import { describe, it, expect } from "vitest";
import { WhisperUnavailableError, isWhisperUnavailable } from "./manager.js";

describe("isWhisperUnavailable", () => {
  it("recognizes WhisperUnavailableError instances", () => {
    const err = new WhisperUnavailableError(
      "whisper-cpp not found. Install: brew install whisper-cpp",
    );
    expect(isWhisperUnavailable(err)).toBe(true);
    expect(err.code).toBe("WHISPER_UNAVAILABLE");
    expect(err.name).toBe("WhisperUnavailableError");
  });

  it("recognizes a plain Error carrying the WHISPER_UNAVAILABLE code (cross-bundle safety)", () => {
    const err = Object.assign(new Error("nope"), { code: "WHISPER_UNAVAILABLE" });
    expect(isWhisperUnavailable(err)).toBe(true);
  });

  it("does NOT classify a genuine transcription failure as unavailable", () => {
    // whisper present but the run crashed — must stay a real command failure.
    expect(isWhisperUnavailable(new Error("Command failed: whisper-cli exited with code 1"))).toBe(
      false,
    );
    expect(isWhisperUnavailable(new Error("whisper-cpp build failed. Ensure cmake..."))).toBe(
      false,
    );
    expect(isWhisperUnavailable("whisper-cpp not found")).toBe(false);
    expect(isWhisperUnavailable(undefined)).toBe(false);
  });
});
