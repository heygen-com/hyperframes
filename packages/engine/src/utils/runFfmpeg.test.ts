import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatFfmpegError, runFfmpeg } from "./runFfmpeg.js";

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

// Shadows the real ffmpeg via PATH with a script that traps SIGTERM. Before
// the SIGKILL escalation, both kill paths sent SIGTERM only, so a stuck
// ffmpeg never emitted `close` and these awaits hung forever (the test would
// fail by timeout). Shell-script shim, so skipped on Windows.
//
// The shim is careful about two things:
// - It prints "ready" to stderr after installing the trap, and the tests
//   only treat a kill as trap-protected once that line is seen. Killing
//   earlier races the trap setup and SIGTERM would win legitimately.
// - It blocks on the builtin `read` instead of spawning `sleep`, so no
//   child process inherits the stdio pipes. A SIGKILLed shim closes its
//   pipes immediately and `close` fires right away; an inherited pipe
//   would defer `close` until the child exits.
describe.skipIf(process.platform === "win32")("runFfmpeg kill escalation", () => {
  let fakeBinDir: string;
  let originalPath: string | undefined;

  beforeAll(async () => {
    fakeBinDir = mkdtempSync(join(tmpdir(), "hf-fake-ffmpeg-"));
    const script = join(fakeBinDir, "ffmpeg");
    writeFileSync(script, '#!/usr/bin/env bash\ntrap "" TERM\necho ready >&2\nread -t 60 _\n');
    chmodSync(script, 0o755);
    originalPath = process.env.PATH;
    process.env.PATH = `${fakeBinDir}:${process.env.PATH ?? ""}`;

    // Warm-up run: the first exec of a fresh script file can be slow
    // (macOS scans it on first run). Waiting for "ready" once here keeps
    // the timed tests below from racing that one-time latency.
    const controller = new AbortController();
    await runFfmpeg([], {
      signal: controller.signal,
      onStderr: (line) => {
        if (line.includes("ready")) controller.abort();
      },
    });
  }, 15_000);

  afterAll(() => {
    process.env.PATH = originalPath;
    rmSync(fakeBinDir, { recursive: true, force: true });
  });

  it("resolves instead of hanging when a timed-out ffmpeg ignores SIGTERM", async () => {
    const result = await runFfmpeg([], { timeout: 500 });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBeNull();
    // Resolution must have come through the SIGKILL escalation: timeout
    // (500ms) plus the escalation grace period, not a SIGTERM exit at
    // the timeout mark.
    expect(result.durationMs).toBeGreaterThanOrEqual(900);
  }, 5000);

  it("resolves instead of hanging when an aborted ffmpeg ignores SIGTERM", async () => {
    const controller = new AbortController();
    const result = await runFfmpeg([], {
      signal: controller.signal,
      onStderr: (line) => {
        // Abort only after the trap is installed so SIGTERM is guaranteed
        // to be ignored and the SIGKILL escalation is what unblocks us.
        if (line.includes("ready")) controller.abort();
      },
    });
    expect(result.success).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(450);
  }, 5000);
});
