import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatFfmpegError } from "./runFfmpeg.js";

describe("formatFfmpegError", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

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

  it("maps Windows invalid-image exit codes to an actionable architecture hint", () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    expect(formatFfmpegError(3221225595, "")).toContain("wrong architecture");
  });
});

function createSpawnSpy() {
  const calls: Array<{ command: string; args: string[] }> = [];
  const spawn = vi.fn((command: string, args: string[]) => {
    calls.push({ command, args });
    const proc = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
      killed: boolean;
    };
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    proc.killed = false;
    process.nextTick(() => proc.emit("close", 0));
    return proc;
  });
  return { spawn, calls };
}

describe("runFfmpeg binary resolution", () => {
  const originalFfmpegPath = process.env.HYPERFRAMES_FFMPEG_PATH;

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("child_process");
    if (originalFfmpegPath === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH;
    else process.env.HYPERFRAMES_FFMPEG_PATH = originalFfmpegPath;
  });

  it("spawns the configured absolute FFmpeg path when HYPERFRAMES_FFMPEG_PATH is set", async () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = "/tools/ffmpeg.exe";
    const { spawn, calls } = createSpawnSpy();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { runFfmpeg } = await import("./runFfmpeg.js");
    const result = await runFfmpeg(["-version"]);

    expect(result.success).toBe(true);
    expect(calls[0]).toEqual({ command: resolve("/tools/ffmpeg.exe"), args: ["-version"] });
  });
});
