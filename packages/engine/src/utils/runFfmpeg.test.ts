import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  describeFfmpegFailure,
  formatFfmpegError,
  isExternalFfmpegInterruption,
  ffmpegStatsReader,
} from "./runFfmpeg.js";

describe("isExternalFfmpegInterruption", () => {
  const base = {
    exitCode: 255,
    signal: null,
    stderr: "",
    terminationReason: "exit" as const,
  };

  it("recognizes a direct external termination signal", () => {
    expect(isExternalFfmpegInterruption({ ...base, exitCode: null, signal: "SIGTERM" })).toBe(true);
  });

  it("does not broaden the retry signal to SIGKILL", () => {
    expect(isExternalFfmpegInterruption({ ...base, exitCode: null, signal: "SIGKILL" })).toBe(
      false,
    );
  });

  it("recognizes ffmpeg's handled SIGTERM exit-255 signature", () => {
    expect(
      isExternalFfmpegInterruption({
        ...base,
        stderr: "frame= 42\nExiting normally, received signal 15.\n",
      }),
    ).toBe(true);
  });

  it("does not classify an ordinary exit 255", () => {
    expect(isExternalFfmpegInterruption({ ...base, stderr: "Encoder initialization failed" })).toBe(
      false,
    );
  });

  it("requires exit 255 when classification relies on ffmpeg stderr", () => {
    expect(
      isExternalFfmpegInterruption({
        ...base,
        exitCode: 1,
        stderr: "Exiting normally, received signal 15.",
      }),
    ).toBe(false);
  });

  it.each(["abort", "deadline", "inactivity"] as const)(
    "keeps a managed %s termination non-retryable",
    (terminationReason) => {
      expect(
        isExternalFfmpegInterruption({
          ...base,
          signal: "SIGTERM",
          stderr: "Exiting normally, received signal 15.",
          terminationReason,
        }),
      ).toBe(false);
    },
  );
});

describe("formatFfmpegError", () => {
  const originalPlatform = process.platform;
  const originalFfmpegPath = process.env.HYPERFRAMES_FFMPEG_PATH;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    if (originalFfmpegPath === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH;
    else process.env.HYPERFRAMES_FFMPEG_PATH = originalFfmpegPath;
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

  it.each([3221225781, -1073741515])(
    "maps Windows DLL-not-found exit code %s to selected-path guidance",
    (exitCode) => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      process.env.HYPERFRAMES_FFMPEG_PATH = "/tools/ffmpeg.exe";

      const message = formatFfmpegError(exitCode, "");

      expect(message).toContain("0xC0000135 (STATUS_DLL_NOT_FOUND)");
      expect(message).toContain(resolve("/tools/ffmpeg.exe"));
      expect(message).toContain("working 64-bit Windows FFmpeg build");
    },
  );
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

describe("describeFfmpegFailure", () => {
  const stderr = "Output #0, ipod, to 'audio.m4a':\n  Metadata:\n    major_brand     : M4A\n";

  it("names the signal that ended ffmpeg when it left no exit code", () => {
    const message = describeFfmpegFailure(
      { exitCode: null, signal: "SIGKILL", stderr, terminationReason: "exit" },
      1000,
    );
    expect(message).toMatch(/^FFmpeg ended without an exit code \(SIGKILL\)\./);
    expect(message).toContain("major_brand     : M4A");
  });

  it("names a stop the caller asked for", () => {
    const message = describeFfmpegFailure(
      { exitCode: null, signal: "SIGTERM", stderr, terminationReason: "abort" },
      1000,
    );
    expect(message).toMatch(/^FFmpeg ended without an exit code \(abort\)\./);
  });

  it("leads with the timeout when no progress ended it", () => {
    const message = describeFfmpegFailure(
      { exitCode: null, signal: "SIGTERM", stderr, terminationReason: "inactivity" },
      1000,
    );
    expect(message).toMatch(/^FFmpeg timed out after 1000 ms/);
  });

  it("keeps an exit code's message as it was", () => {
    const message = describeFfmpegFailure(
      { exitCode: 1, signal: null, stderr: "Invalid argument\n", terminationReason: "exit" },
      1000,
    );
    expect(message).toBe(formatFfmpegError(1, "Invalid argument\n"));
  });
});

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

describe("ffmpegStatsReader", () => {
  it("reads frames and output seconds from stats lines split anywhere across chunks", () => {
    const stats: unknown[] = [];
    const read = ffmpegStatsReader((s) => stats.push(s));
    read("Input #0, image2pipe\nframe=   12 fps=24 q=2");
    read("8.0 size=  512kB time=00:00:00.40 bitrate=N/A speed=0.8x\rframe=  ");
    read("30 fps=25 q=28.0 size=1024kB time=00:01:01.50 bitrate=1Mbits/s\r");
    read("[out#0/mp4] video:1024kB\n");
    expect(stats).toEqual([
      { frames: 12, seconds: 0.4 },
      { frames: 30, seconds: 61.5 },
    ]);
  });

  it("reports a copy pass's seconds when it prints no frame count", () => {
    const stats: unknown[] = [];
    ffmpegStatsReader((s) => stats.push(s))("size=  9000kB time=00:00:12.00 bitrate=6000kbits/s\r");
    expect(stats).toEqual([{ frames: undefined, seconds: 12 }]);
  });

  it("keeps ffmpeg's centiseconds exact", () => {
    const stats: unknown[] = [];
    ffmpegStatsReader((s) => stats.push(s))("size=  9000kB time=00:01:08.04 bitrate=6000kbits/s\r");
    expect(stats).toEqual([{ frames: undefined, seconds: 68.04 }]);
  });
});

describe("a run's timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("child_process");
    vi.resetModules();
  });

  async function fakeFfmpeg() {
    vi.useFakeTimers();
    const proc = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      kill: vi.fn(() => queueMicrotask(() => proc.emit("close", null, "SIGTERM"))),
    });
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn: () => proc }));
    const { runFfmpeg } = await import("./runFfmpeg.js");
    return { proc, runFfmpeg };
  }

  it("lets an audio run whose output time advances outlive it", async () => {
    const { proc, runFfmpeg } = await fakeFfmpeg();

    const run = runFfmpeg(["-i", "in.wav", "out.m4a"], { timeout: 300_000 });
    // Nine minutes of an audio run, which prints no frame count, one progress line every 100 s.
    for (let minute = 1; minute <= 9; minute += 1) {
      await vi.advanceTimersByTimeAsync(100_000);
      proc.stderr.emit("data", Buffer.from(`size=  ${minute}00KiB time=00:0${minute}:00.00\r`));
    }
    expect(proc.kill).not.toHaveBeenCalled();
    proc.emit("close", 0, null);

    await expect(run).resolves.toMatchObject({ success: true, terminationReason: "exit" });
  });

  it("stops a run that prints no progress at the timeout and says it timed out", async () => {
    const { proc, runFfmpeg } = await fakeFfmpeg();

    const run = runFfmpeg(["-i", "pipe:0", "out.wav"]);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(proc.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    const result = await run;
    expect(describeFfmpegFailure(result, 300_000)).toMatch(/^FFmpeg timed out after 300000 ms/);
  });

  it("outlives the timeout while frames advance, and stops once they do not", async () => {
    const { proc, runFfmpeg } = await fakeFfmpeg();

    const run = runFfmpeg(["-i", "in.mp4", "out-%05d.png"], { timeout: 2_000 });
    for (let frame = 1; frame <= 4; frame += 1) {
      await vi.advanceTimersByTimeAsync(1_500);
      proc.stderr.emit("data", Buffer.from(`frame=${frame} fps=1 time=00:00:0${frame}.00\r`));
    }
    // Six seconds in: three stall timeouts, never one without a new frame.
    expect(proc.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    proc.stderr.emit("data", Buffer.from("frame=4 fps=1 time=00:00:04.00\r"));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    await expect(run).resolves.toMatchObject({ terminationReason: "inactivity" });
  });
});

describe("a run whose signal already aborted", () => {
  afterEach(() => {
    vi.doUnmock("child_process");
    vi.resetModules();
  });

  it("starts no ffmpeg", async () => {
    const spawn = vi.fn();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));
    const { runFfmpeg } = await import("./runFfmpeg.js");

    const result = await runFfmpeg(["-version"], { signal: AbortSignal.abort() });

    expect(spawn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, terminationReason: "abort" });
  });
});
