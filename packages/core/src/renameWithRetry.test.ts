// @vitest-environment node
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catchHeldRename, renameWithRetry, renameWithRetryAsync } from "./renameWithRetry.js";

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

  it("gives up at once on win32 when the target is a folder with files in it, which no wait clears", async () => {
    const folder = mkdtempSync(join(tmpdir(), "hf-rename-onto-folder-"));
    writeFileSync(join(folder, "frame_00001.jpg"), "winner");
    try {
      const rename = failing("EPERM", 99);
      expect(() => renameWithRetry("a", folder, { platform: "win32", rename: rename.fn })).toThrow(
        /EPERM/,
      );
      expect(rename.calls()).toBe(1);
      const later = failing("EPERM", 99);
      await expect(
        renameWithRetryAsync("a", folder, { platform: "win32", rename: async () => later.fn() }),
      ).rejects.toThrow(/EPERM/);
      expect(later.calls()).toBe(1);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("still waits on win32 for an empty folder target, which may be a removed folder still held open", () => {
    const folder = mkdtempSync(join(tmpdir(), "hf-rename-onto-empty-"));
    try {
      const rename = failing("EPERM", 2);
      renameWithRetry("a", folder, { platform: "win32", rename: rename.fn });
      expect(rename.calls()).toBe(3);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "keeps waiting and keeps the rename's own error when the target cannot be looked at",
    () => {
      const parent = mkdtempSync(join(tmpdir(), "hf-rename-unreadable-"));
      const folder = join(parent, "entry");
      mkdirSync(folder);
      writeFileSync(join(folder, "frame_00001.jpg"), "winner");
      chmodSync(parent, 0);
      try {
        const rename = failing("EPERM", 2);
        renameWithRetry("a", folder, { platform: "win32", rename: rename.fn });
        expect(rename.calls()).toBe(3);
        const always = failing("EPERM", 99);
        expect(() =>
          renameWithRetry("a", folder, { platform: "win32", rename: always.fn }),
        ).toThrow(/EPERM: rename/);
      } finally {
        chmodSync(parent, 0o700);
        rmSync(parent, { recursive: true, force: true });
      }
    },
  );

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

describe("catchHeldRename", () => {
  it("hands back the first hold, even one a caller swallowed, and rides later holds out as before", async () => {
    const rename = failing("EBUSY", 2);
    const held = await catchHeldRename(async () => {
      try {
        renameWithRetry("a", "b", { platform: "win32", rename: rename.fn });
      } catch {
        // a route that answers a failed write itself
      }
      renameWithRetry("a", "b", { platform: "win32", rename: rename.fn });
    });
    expect(held).toMatchObject({ code: "EBUSY" });
    expect(rename.calls()).toBe(3);
  });
});
