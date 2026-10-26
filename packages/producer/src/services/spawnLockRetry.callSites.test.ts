import { EventEmitter } from "node:events";
import { setTimeout as realSleep } from "node:timers/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The producer's own ffmpeg/ffprobe call sites must survive the executable
// being locked for a moment. Reproduce on Windows by spawning a copy of
// ffmpeg.exe while another process holds it open with FileShare.None: Node
// throws `spawn EBUSY` synchronously, before any ChildProcess exists.
function lockedError(): NodeJS.ErrnoException {
  return Object.assign(new Error("spawn EBUSY"), { code: "EBUSY", errno: -4082, syscall: "spawn" });
}

function fakeProcess(stdout = "") {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
    pid: 4242,
  });
  setTimeout(() => {
    proc.emit("spawn");
    if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
    proc.emit("close", 0, null);
  }, 0);
  return proc;
}

/** A spawn whose first call fails because the binary is locked. */
function spawnLockedOnce(stdout = "") {
  let call = 0;
  return vi.fn((_command: string, _args: string[]) => {
    call += 1;
    if (call === 1) throw lockedError();
    return fakeProcess(stdout);
  });
}

/** Steps the fake clock past the retry delays, yielding to real I/O, until `result` settles. */
async function afterRetries<T>(result: Promise<T>): Promise<T> {
  let settled = false;
  result.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let step = 0; step < 400 && !settled; step++) {
    await vi.advanceTimersByTimeAsync(250);
    await realSleep(5);
  }
  return result;
}

describe("producer call sites retry a locked executable", () => {
  let dir: string;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    dir = mkdtempSync(join(tmpdir(), "hf-locked-spawn-"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("node:child_process");
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("audio pad/trim's video probe", async () => {
    const spawn = spawnLockedOnce(
      JSON.stringify({ streams: [{ nb_frames: "30", r_frame_rate: "30/1" }] }),
    );
    vi.doMock("node:child_process", () => ({ spawn }));
    const { padOrTrimAudioToVideoFrameCount } = await import("./render/audioPadTrim.js");

    const result = await afterRetries(
      padOrTrimAudioToVideoFrameCount({
        videoPath: join(dir, "v.mp4"),
        audioPath: join(dir, "a.aac"),
        outputPath: join(dir, "o.aac"),
        probeAudioInfo: () => Promise.resolve({ durationSeconds: 1 }),
        runFfmpeg: () => Promise.resolve({ success: true }),
      }),
    );

    expect(result.error).toBeUndefined();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("readFfmpegVersion", async () => {
    let call = 0;
    const run = vi.fn(
      () =>
        new Promise<{ stdout: string; stderr: string }>((resolve) => {
          call += 1;
          if (call === 1) throw lockedError();
          resolve({ stdout: "ffmpeg version 9.0.2\n", stderr: "" });
        }),
    );
    // promisify(execFile) uses this, as it does Node's own execFile.
    const execFile = Object.assign(vi.fn(), { [promisify.custom]: run });
    vi.doMock("node:child_process", () => ({ execFile }));
    const { readFfmpegVersion } = await import("./distributed/shared.js");

    await expect(afterRetries(readFfmpegVersion())).resolves.toBe("ffmpeg version 9.0.2");
    expect(run).toHaveBeenCalledTimes(2);
  });
});
