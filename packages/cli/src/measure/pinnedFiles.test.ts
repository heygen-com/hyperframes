import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ensurePinnedFiles, type PinnedFile } from "./pinnedFiles.js";

const ownedByAnotherAccount = vi.hoisted(() => new Set<string>());
// What each download saw of its folder the moment it began writing: its mode.
const writes = vi.hoisted(() => [] as { dest: string; folderMode: number }[]);
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const lstatSync = ((path: string, options?: object) => {
    const stat = fs.lstatSync(path, options as never);
    return stat && ownedByAnotherAccount.has(path)
      ? Object.assign(stat, { uid: process.getuid!() + 1 })
      : stat;
  }) as typeof fs.lstatSync;
  return { ...fs, lstatSync };
});
vi.mock("../cloud/download.js", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  return {
    downloadToFile: async (_url: string, dest: string) => {
      writes.push({ dest, folderMode: fs.statSync(path.dirname(dest)).mode & 0o777 });
      fs.writeFileSync(dest, "pinned bytes");
    },
  };
});

const file: PinnedFile = {
  name: "model.bin",
  bytes: 12,
  sha256: createHash("sha256").update("pinned bytes").digest("hex"),
  url: "https://x.test/model.bin",
};

let root = "";
let elsewhere = "";
let dir = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hf-pinned-files-"));
  elsewhere = mkdtempSync(join(tmpdir(), "hf-pinned-files-elsewhere-"));
  dir = join(root, "tool", "1.0.0");
});
afterEach(() => {
  ownedByAnotherAccount.clear();
  writes.length = 0;
  rmSync(root, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
});

it("downloads a missing file into a new owner-only folder", async () => {
  await ensurePinnedFiles(dir, root, [file]);

  expect(readdirSync(dir)).toEqual(["model.bin"]);
  expect(writes.map((w) => dirname(w.dest))).toEqual([dir]);
  if (process.getuid) expect(statSync(dir).mode & 0o777).toBe(0o700);
});

// fails without the fix: the download landed in the folder, and only the seal afterwards refused it.
it.skipIf(!process.getuid)(
  "writes nothing into a folder another account owns, refusing it first",
  async () => {
    mkdirSync(dir, { recursive: true });
    ownedByAnotherAccount.add(join(root, "tool"));

    await expect(ensurePinnedFiles(dir, root, [file])).rejects.toThrow(
      `${join(root, "tool")} can be changed by another user account`,
    );

    expect(writes).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  },
);

// fails without the fix: the download followed the link and wrote its bytes into the folder it named.
it.skipIf(!process.getuid)(
  "writes nothing through a folder that is a link out of the cache",
  async () => {
    mkdirSync(dirname(dir), { recursive: true });
    symlinkSync(elsewhere, dir);

    await expect(ensurePinnedFiles(dir, root, [file])).rejects.toThrow(
      "can be changed by another user account",
    );

    expect(writes).toEqual([]);
    expect(readdirSync(elsewhere)).toEqual([]);
  },
);

// fails without the fix: the folder stayed group- and world-writable until the seal after the download.
it.skipIf(!process.getuid)(
  "takes group and other write off the person's own folder before the first byte",
  async () => {
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o777);

    await ensurePinnedFiles(dir, root, [file]);

    expect(writes).toHaveLength(1);
    expect(writes[0]!.folderMode & 0o022).toBe(0);
  },
);

it("touches nothing when every file is present and verified in a private folder", async () => {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, file.name), "pinned bytes");

  await ensurePinnedFiles(dir, root, [file]);

  expect(writes).toEqual([]);
  expect(existsSync(join(dir, file.name))).toBe(true);
});
