import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatFfmpegError,
  isExternalFfmpegInterruption,
  runFfmpegPipeline,
  ffmpegStatsReader,
} from "./runFfmpeg.js";

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;

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

describe.skipIf(!HAS_FFMPEG)("runFfmpegPipeline", () => {
  const rawFrames = (source: string) => [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    source,
    "-c:v",
    "rawvideo",
    "-f",
    "nut",
    "pipe:1",
  ];

  it("hands every producer frame to the consumer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-pipeline-"));
    try {
      const result = await runFfmpegPipeline(rawFrames("testsrc2=s=64x16:d=0.2:r=30"), [
        "-v",
        "error",
        "-f",
        "nut",
        "-i",
        "pipe:0",
        "-fps_mode",
        "passthrough",
        join(dir, "f_%03d.png"),
      ]);
      expect(result.success, result.stderr).toBe(true);
      expect(readdirSync(dir)).toHaveLength(6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails with the producer's error when the producer cannot start its input", async () => {
    const result = await runFfmpegPipeline(
      [
        "-v",
        "error",
        "-i",
        join(tmpdir(), "hf-missing-input.mp4"),
        "-c:v",
        "rawvideo",
        "-f",
        "nut",
        "pipe:1",
      ],
      ["-v", "error", "-f", "nut", "-i", "pipe:0", "-f", "null", "-"],
    );
    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/hf-missing-input\.mp4/);
  }, 30_000);

  it("stops an endless producer when the consumer fails", async () => {
    const startedAt = Date.now();
    const result = await runFfmpegPipeline(
      rawFrames("testsrc2=s=320x240:r=30"),
      ["-v", "error", "-f", "nut", "-i", "pipe:0", "-vf", "hf_missing_filter", "-f", "null", "-"],
      { timeout: 20_000 },
    );
    expect(result.success).toBe(false);
    expect(result.terminationReason).toBe("exit");
    expect(result.stderr).toMatch(/hf_missing_filter/);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 30_000);
});

describe("runFfmpegPipeline start failure", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("child_process");
  });

  it("releases a waiting consumer when the producer cannot start", async () => {
    const { PassThrough, Writable } = await import("node:stream");
    const producer = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
      pid: 4242,
    });
    const consumer = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new Writable({ write: (_chunk, _encoding, done) => done() }),
      kill: vi.fn(),
      pid: 4243,
    });
    consumer.stdin.on("finish", () => consumer.emit("close", 1, null));
    const spawn = vi.fn().mockReturnValueOnce(producer).mockReturnValueOnce(consumer);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));
    const { runFfmpegPipeline: pipeline } = await import("./runFfmpeg.js");

    const startedAt = Date.now();
    const pending = pipeline(["-i", "in"], ["-i", "pipe:0"], { timeout: 5_000 });
    consumer.emit("spawn");
    producer.emit("error", Object.assign(new Error("spawn EMFILE"), { code: "EMFILE" }));
    const result = await pending;

    expect(result.success).toBe(false);
    expect(result.terminationReason).toBe("spawn_error");
    expect(Date.now() - startedAt).toBeLessThan(2_000);
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
});
