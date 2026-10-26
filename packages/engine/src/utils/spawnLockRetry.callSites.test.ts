import { EventEmitter } from "node:events";
import { setTimeout as realSleep } from "node:timers/promises";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each call site that starts the managed ffmpeg/ffprobe must survive the
// executable being locked for a moment. Reproduce on Windows by spawning a copy
// of ffmpeg.exe while another process holds it open with FileShare.None: Node
// throws `spawn EBUSY` synchronously, before any ChildProcess exists.
function lockedError(): NodeJS.ErrnoException {
  return Object.assign(new Error("spawn EBUSY"), { code: "EBUSY", errno: -4082, syscall: "spawn" });
}

function fakeProcess(stdout = "", stderr = "") {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() },
    kill: vi.fn(),
    pid: 4242,
  });
  setTimeout(() => {
    proc.emit("spawn");
    if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
    if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
    proc.emit("close", 0, null);
  }, 0);
  return proc;
}

/** A spawn that throws EBUSY on the calls listed in `lockedCalls` (1-based). */
function spawnLockedOn(lockedCalls: number[], outputs: string[] = []) {
  let call = 0;
  let started = 0;
  return vi.fn(() => {
    call += 1;
    if (lockedCalls.includes(call)) throw lockedError();
    return fakeProcess(outputs[started++] ?? "");
  });
}

/** An execFile whose first call fails because the binary is locked. */
function execFileLockedOnce(result: { stdout?: string; stderr?: string }) {
  let call = 0;
  const run = vi.fn(
    () =>
      new Promise<{ stdout: string; stderr: string }>((resolve) => {
        call += 1;
        if (call === 1) throw lockedError();
        resolve({ stdout: result.stdout ?? "", stderr: result.stderr ?? "" });
      }),
  );
  // promisify(execFile) uses this, as it does Node's own execFile.
  return Object.assign(vi.fn(), { [promisify.custom]: run, run });
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

describe("managed binary call sites retry a locked executable", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("child_process");
    vi.doUnmock("node:child_process");
    vi.restoreAllMocks();
  });

  it("runFfmpeg", async () => {
    const spawn = spawnLockedOn([1]);
    vi.doMock("child_process", () => ({ spawn }));
    const { runFfmpeg } = await import("./runFfmpeg.js");

    const result = await afterRetries(runFfmpeg(["-version"]));

    expect(result.success).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("runFfmpeg starts no ffmpeg once the signal aborts while it waits out a lock", async () => {
    const spawn = spawnLockedOn([1]);
    vi.doMock("child_process", () => ({ spawn }));
    const { runFfmpeg } = await import("./runFfmpeg.js");
    const controller = new AbortController();

    const result = runFfmpeg(["-version"], { signal: controller.signal });
    controller.abort();

    await expect(afterRetries(result)).resolves.toMatchObject({
      success: false,
      terminationReason: "abort",
    });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("ffprobe", async () => {
    const probe = JSON.stringify({
      streams: [{ codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 }],
      format: { duration: "1.25", bit_rate: "128000" },
    });
    const spawn = spawnLockedOn([1], [probe]);
    vi.doMock("child_process", () => ({ spawn }));
    const { extractAudioMetadata } = await import("./ffprobe.js");

    const meta = await afterRetries(extractAudioMetadata("/tmp/locked-ffprobe.wav"));

    expect(meta.durationSeconds).toBe(1.25);
  });

  it("GPU encoder detection and its probe, so a lock is not cached as no GPU", async () => {
    // Calls: 1 locked, 2 `-encoders`, 3 locked, 4 the h264_nvenc probe.
    const spawn = spawnLockedOn([1, 3], [" V....D h264_nvenc  NVIDIA NVENC H.264 encoder\n"]);
    vi.doMock("child_process", () => ({ spawn }));
    const { detectGpuEncoder } = await import("./gpuEncoder.js");

    await expect(afterRetries(detectGpuEncoder())).resolves.toBe("nvenc");
    expect(spawn).toHaveBeenCalledTimes(4);
  });

  it("psnr filter discovery, so a lock is not cached as no filters", async () => {
    const execFile = execFileLockedOnce({ stdout: " ... psnr              VV->V      PSNR\n" });
    vi.doMock("node:child_process", () => ({ execFile }));
    const { isPsnrFilterAvailable } = await import("./psnrFilterAvailability.js");

    await expect(afterRetries(isPsnrFilterAvailable())).resolves.toBe(true);
    expect(execFile.run).toHaveBeenCalledTimes(2);
  });

  it("psnrDb", async () => {
    const execFile = execFileLockedOnce({ stderr: "PSNR y:40 average:42.5 min:40\n" });
    vi.doMock("node:child_process", () => ({ execFile }));
    const { psnrDb } = await import("./psnr.js");

    await expect(afterRetries(psnrDb(Buffer.from("a"), Buffer.from("b")))).resolves.toBe(42.5);
    expect(execFile.run).toHaveBeenCalledTimes(2);
  });
});
