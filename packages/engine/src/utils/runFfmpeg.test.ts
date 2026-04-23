import { describe, expect, it } from "vitest";

import { formatFfmpegError } from "./runFfmpeg.js";

describe("formatFfmpegError", () => {
  it("reports exit code alone when stderr is empty", () => {
    expect(formatFfmpegError(-22, "")).toBe("FFmpeg exited with code -22");
  });

  it("appends stderr tail when present", () => {
    const stderr =
      "ffmpeg version 8.1\nbuilt with gcc 13.2.0\n" +
      "[h264_nvenc @ 0x7f] Error applying encoder options: Invalid argument\n" +
      "Error while opening encoder\n";
    const message = formatFfmpegError(-22, stderr);
    expect(message).toContain("FFmpeg exited with code -22");
    expect(message).toContain("ffmpeg stderr (tail):");
    expect(message).toContain("Error applying encoder options: Invalid argument");
    expect(message).toContain("Error while opening encoder");
  });

  it("keeps only the last N non-empty lines in the tail", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`).join("\n");
    const message = formatFfmpegError(1, lines, 5);
    expect(message).toContain("line-29");
    expect(message).toContain("line-25");
    expect(message).not.toContain("line-24");
  });

  it("strips blank lines from the tail so real signal isn't hidden", () => {
    const stderr = "\n\nError applying encoder options: Invalid argument\n\n\n";
    const message = formatFfmpegError(-22, stderr);
    expect(message).toContain("Error applying encoder options: Invalid argument");
    // Only one non-empty stderr line should appear in the tail.
    const tailPart = message.split("ffmpeg stderr (tail):\n")[1] ?? "";
    expect(tailPart.trim().split(/\r?\n/).length).toBe(1);
  });

  it("falls back to a process-error string when exit code is null and stderr is empty", () => {
    expect(formatFfmpegError(null, "")).toBe("[FFmpeg] process error");
  });

  it("wraps stderr in [FFmpeg] prefix when exit code is null (spawn failure)", () => {
    expect(formatFfmpegError(null, "spawn ffmpeg ENOENT")).toBe("[FFmpeg] spawn ffmpeg ENOENT");
  });
});
