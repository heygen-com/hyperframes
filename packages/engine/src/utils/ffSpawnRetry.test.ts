import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeSpawnFailure,
  fileLockRetryDelayMs,
  isTransientSpawnErrno,
  withTransientSpawnRetry,
} from "./ffSpawnRetry.js";

describe("isTransientSpawnErrno", () => {
  it("treats the Windows file-lock family and resource exhaustion as transient", () => {
    expect(isTransientSpawnErrno("EBUSY")).toBe(true);
    expect(isTransientSpawnErrno("ETXTBSY")).toBe(true);
    expect(isTransientSpawnErrno("EAGAIN")).toBe(true);
    expect(isTransientSpawnErrno("EMFILE")).toBe(true);
    expect(isTransientSpawnErrno("ENFILE")).toBe(true);
  });

  it("does not retry permanent spawn failures", () => {
    expect(isTransientSpawnErrno("ENOENT")).toBe(false);
    expect(isTransientSpawnErrno("EACCES")).toBe(false);
    expect(isTransientSpawnErrno(undefined)).toBe(false);
  });
});

describe("fileLockRetryDelayMs", () => {
  it("doubles the base backoff per attempt", () => {
    expect(fileLockRetryDelayMs(0, 250)).toBe(250);
    expect(fileLockRetryDelayMs(1, 250)).toBe(500);
    expect(fileLockRetryDelayMs(2, 250)).toBe(1000);
  });
});

describe("describeSpawnFailure", () => {
  it("names the binary, attempt count, and the antivirus hint for transient errnos", () => {
    const message = describeSpawnFailure(
      "C:\\app\\ffmpeg.exe",
      Object.assign(new Error("spawn EBUSY"), { code: "EBUSY" }),
      3,
    );

    expect(message).toContain('"C:\\app\\ffmpeg.exe"');
    expect(message).toContain("after 3 attempt(s)");
    expect(message).toContain("spawn EBUSY");
    expect(message).toContain("antivirus");
  });

  it("omits the lock hint for permanent errnos", () => {
    const message = describeSpawnFailure(
      "ffmpeg",
      Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }),
      1,
    );

    expect(message).not.toContain("antivirus");
  });
});

describe("withTransientSpawnRetry", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  beforeEach(() => {
    warn.mockClear();
  });

  it("returns a successful attempt untouched and calls it exactly once", async () => {
    const attempt = vi.fn(async () => "ok");

    await expect(withTransientSpawnRetry("ffmpeg", attempt, () => undefined)).resolves.toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("retries a result-shaped transient spawn failure and succeeds", async () => {
    let calls = 0;
    const attempt = async (): Promise<{ success: boolean; error?: Error }> => {
      calls += 1;
      if (calls === 1) {
        return {
          success: false,
          error: Object.assign(new Error("spawn EBUSY"), { code: "EBUSY" }),
        };
      }
      return { success: true };
    };

    await expect(
      withTransientSpawnRetry(
        "ffmpeg",
        attempt,
        (result) => result.error as NodeJS.ErrnoException | undefined,
        { attempts: 3, backoffMs: 1 },
      ),
    ).resolves.toEqual({ success: true });
    expect(calls).toBe(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("EBUSY"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("attempt 2/3"));
  });

  it("retries a rejected transient spawn error and preserves success", async () => {
    let calls = 0;
    const attempt = async (): Promise<void> => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error("spawn EBUSY"), { code: "EBUSY" });
      }
    };

    await expect(
      withTransientSpawnRetry("ffmpeg", attempt, () => undefined, { attempts: 3, backoffMs: 1 }),
    ).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it("throws an enriched error naming the binary when transient retries are exhausted", async () => {
    const attempt = async (): Promise<void> => {
      throw Object.assign(new Error("spawn EBUSY"), { code: "EBUSY" });
    };

    await expect(
      withTransientSpawnRetry("C:\\app\\ffmpeg.exe", attempt, () => undefined, {
        attempts: 3,
        backoffMs: 1,
      }),
    ).rejects.toThrow(/Failed to spawn "C:\\app\\ffmpeg\.exe" after 3 attempt\(s\).*antivirus/s);
  });

  it("keeps the errno code on the exhausted-retry error", async () => {
    const attempt = async (): Promise<void> => {
      throw Object.assign(new Error("spawn EBUSY"), { code: "EBUSY" });
    };

    await expect(
      withTransientSpawnRetry("ffmpeg", attempt, () => undefined, { attempts: 2, backoffMs: 1 }),
    ).rejects.toMatchObject({ code: "EBUSY" });
  });

  it("never retries permanent failures", async () => {
    const attempt = vi.fn(async () => {
      throw Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
    });

    await expect(withTransientSpawnRetry("ffmpeg", attempt, () => undefined)).rejects.toThrow(
      /ENOENT/,
    );
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("returns a result-shaped permanent failure untouched", async () => {
    const permanent = {
      success: false,
      error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
    };
    const attempt = vi.fn(async () => permanent);

    await expect(
      withTransientSpawnRetry("ffmpeg", attempt, (result) =>
        isTransientSpawnErrno(result.error?.code) ? result.error : undefined,
      ),
    ).resolves.toBe(permanent);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("honors attempts=1 for transient failures without retrying", async () => {
    const attempt = vi.fn(async () => ({
      success: false,
      error: Object.assign(new Error("spawn EBUSY"), { code: "EBUSY" }),
    }));

    await withTransientSpawnRetry(
      "ffmpeg",
      attempt,
      (result) => result.error as NodeJS.ErrnoException | undefined,
      { attempts: 1, backoffMs: 1 },
    );
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
