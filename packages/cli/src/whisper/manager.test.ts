import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findWhisper, WhisperUnavailableError, isWhisperUnavailable } from "./manager.js";

const originalPath = process.env["PATH"];
const tempDirs: string[] = [];

afterEach(() => {
  process.env["PATH"] = originalPath;
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

describe("findWhisper", () => {
  it.runIf(process.platform !== "win32")(
    "does not mistake Python openai-whisper for whisper.cpp",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "hyperframes-whisper-path-"));
      tempDirs.push(dir);
      const pythonWhisper = join(dir, "whisper");
      writeFileSync(pythonWhisper, "#!/bin/sh\necho 'OpenAI Whisper Python CLI'\n");
      chmodSync(pythonWhisper, 0o755);
      process.env["PATH"] = `${dir}:/usr/bin:/bin`;

      const result = findWhisper();

      expect(result?.executablePath).not.toBe(pythonWhisper);
    },
  );
});

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
