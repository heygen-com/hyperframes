import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { retrySpawnWhileLocked } from "./spawnLockRetry.js";

// Shaped like the error Node's ChildProcess.spawn throws synchronously for
// every errno outside EACCES/EAGAIN/EMFILE/ENFILE/ENOENT.
function spawnError(code: string, syscall = "spawn"): NodeJS.ErrnoException {
  return Object.assign(new Error(`${syscall} ${code}`), { code, errno: -4082, syscall });
}

describe("retrySpawnWhileLocked", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs once and returns the result when nothing is locked", async () => {
    const run = vi.fn(async () => "ok");

    await expect(retrySpawnWhileLocked("ffmpeg", run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("starts the first attempt synchronously", () => {
    const run = vi.fn(async () => "ok");

    void retrySpawnWhileLocked("ffmpeg", run);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(["EBUSY", "ETXTBSY"])("retries a %s spawn until the lock clears", async (code) => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(spawnError(code))
      .mockRejectedValueOnce(spawnError(code))
      .mockResolvedValue("ok");

    const result = retrySpawnWhileLocked("C:/ff/ffmpeg.exe", run);
    await vi.advanceTimersByTimeAsync(250);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);

    await expect(result).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("C:/ff/ffmpeg.exe"));
  });

  it("names the binary and the errno once the lock outlasts every attempt", async () => {
    const run = vi.fn(async (): Promise<string> => {
      throw spawnError("EBUSY");
    });

    const result = retrySpawnWhileLocked("C:/ff/ffmpeg.exe", run);
    const settled = expect(result).rejects.toMatchObject({
      code: "EBUSY",
      syscall: "spawn",
      message: expect.stringMatching(/C:\/ff\/ffmpeg\.exe.*EBUSY.*3 attempts.*antivirus/s),
    });
    await vi.runAllTimersAsync();

    await settled;
    expect(run).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["EPERM, which an ACL that denies execute also raises", spawnError("EPERM")],
    ["ENOENT", spawnError("ENOENT")],
    ["an EBUSY that did not come from spawn", spawnError("EBUSY", "open")],
    ["a non-errno failure", new Error("FFmpeg exited with code 1")],
  ])("does not retry %s", async (_label, error) => {
    const run = vi.fn(async (): Promise<string> => {
      throw error;
    });

    await expect(retrySpawnWhileLocked("ffmpeg", run)).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
