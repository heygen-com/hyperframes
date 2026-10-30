// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renameWithRetry, renameWithRetryAsync } from "./renameWithRetry.js";

function failing(code: string, times: number) {
  let calls = 0;
  return {
    calls: () => calls,
    fn: () => {
      calls++;
      if (calls <= times) throw Object.assign(new Error(`${code}: rename`), { code });
    },
  };
}

describe("renameWithRetry", () => {
  it("retries EPERM on win32 until the lock clears", () => {
    const rename = failing("EPERM", 3);
    renameWithRetry("a", "b", { platform: "win32", rename: rename.fn });
    expect(rename.calls()).toBe(4);
  });

  it("rethrows the original error once the budget is spent", () => {
    const rename = failing("EBUSY", 99);
    expect(() => renameWithRetry("a", "b", { platform: "win32", rename: rename.fn })).toThrow(
      /EBUSY/,
    );
    expect(rename.calls()).toBe(8);
  });

  it("does not retry off win32 or for other codes", () => {
    const posix = failing("EPERM", 99);
    expect(() => renameWithRetry("a", "b", { platform: "linux", rename: posix.fn })).toThrow(
      /EPERM/,
    );
    expect(posix.calls()).toBe(1);
    const missing = failing("ENOENT", 99);
    expect(() => renameWithRetry("a", "b", { platform: "win32", rename: missing.fn })).toThrow(
      /ENOENT/,
    );
    expect(missing.calls()).toBe(1);
  });

  it("async twin retries EPERM on win32", async () => {
    const rename = failing("EPERM", 2);
    await renameWithRetryAsync("a", "b", { platform: "win32", rename: async () => rename.fn() });
    expect(rename.calls()).toBe(3);
  });

  it("copies when win32 keeps refusing the rename, and fails with the rename error if the copy fails too", async () => {
    const copied: string[] = [];
    renameWithRetry("a", "b", {
      platform: "win32",
      copyFallback: true,
      rename: failing("EPERM", 99).fn,
      copy: (from, to) => void copied.push(`${from}>${to}`),
    });
    expect(copied).toEqual(["a>b"]);
    await renameWithRetryAsync("a", "c", {
      platform: "win32",
      copyFallback: true,
      rename: async () => failing("EPERM", 99).fn(),
      copy: async (from, to) => void copied.push(`${from}>${to}`),
    });
    expect(copied).toEqual(["a>b", "a>c"]);
    const broken = () => {
      throw new Error("copy denied");
    };
    expect(() =>
      renameWithRetry("a", "b", {
        platform: "win32",
        copyFallback: true,
        rename: failing("EPERM", 99).fn,
        copy: broken,
      }),
    ).toThrow(/EPERM/);
  });

  it("never copies unless asked: an atomic publish keeps rename-or-throw", () => {
    const copied: string[] = [];
    expect(() =>
      renameWithRetry("a", "b", {
        platform: "win32",
        rename: failing("EPERM", 99).fn,
        copy: (from, to) => void copied.push(`${from}>${to}`),
      }),
    ).toThrow(/EPERM/);
    expect(copied).toEqual([]);
  });
});
