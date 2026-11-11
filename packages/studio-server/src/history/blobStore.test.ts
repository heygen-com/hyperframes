// @vitest-environment node
import { createHash } from "node:crypto";
import {
  createReadStream,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    copyFile: vi.fn(actual.copyFile),
    open: vi.fn(actual.open),
  };
});

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { onRestoredInPlace, openBlobStore } from "./blobStore.js";
import { serveWhileOpen } from "../helpers/servedFiles.js";

const { renameSync: realRenameSync } = await vi.importActual<typeof import("node:fs")>("node:fs");
const {
  rename: realRename,
  copyFile: realCopyFile,
  open: realOpen,
} = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const busy = () => Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
const platform = process.platform;

// Undo and redo on Windows: a file the preview or an editor holds open refuses a rename over it for a moment.
describe("the history store on Windows, while another process briefly holds a file", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hf-blob-busy-"));
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    vi.mocked(fs.renameSync).mockImplementation(realRenameSync);
    vi.mocked(fsp.rename).mockImplementation(realRename);
    vi.mocked(fsp.copyFile).mockImplementation(realCopyFile);
    rmSync(root, { recursive: true, force: true });
  });

  /** A project file the store holds an earlier copy of, and what a restore of it reports. */
  async function heldRestore() {
    const target = join(root, "index.html");
    writeFileSync(target, "<p>before</p>");
    const store = await openBlobStore(join(root, "history", "blobs"));
    const hash = await store.put(target);
    writeFileSync(target, "<p>after</p>");
    vi.mocked(fs.renameSync).mockImplementation(() => {
      throw busy();
    });
    const heard: string[] = [];
    const stop = onRestoredInPlace((path, outcome) => heard.push(`${path} ${outcome}`));
    return { target, store, hash, heard, stop };
  }

  it("writes a file a holder keeps open in place, once the rename is still refused, and checks it", async () => {
    const { target, store, hash, heard, stop } = await heldRestore();
    try {
      await store.writeTo(hash, target);
    } finally {
      stop();
    }

    expect(readFileSync(target, "utf8")).toBe("<p>before</p>");
    expect(heard).toEqual([`${target} restored`]);
  });

  it("fails a write in place that does not match the kept copy, and keeps the copy", async () => {
    const { target, store, hash, heard, stop } = await heldRestore();
    vi.mocked(fsp.copyFile).mockImplementation(async (from, to, mode) => {
      if (to === target) return writeFileSync(target, "<p>torn</p>");
      return realCopyFile(from, to, mode);
    });
    try {
      await expect(store.writeTo(hash, target)).rejects.toThrow(/does not match/);
    } finally {
      stop();
    }

    expect(heard).toEqual([`${target} mismatch`]);
    expect((await store.read(hash)).toString("utf8")).toBe("<p>before</p>");
  });

  it("writes a file back into the project once the hold clears", async () => {
    const source = join(root, "source.html");
    writeFileSync(source, "<p>before</p>");
    const store = await openBlobStore(join(root, "history", "blobs"));
    const hash = await store.put(source);
    const target = join(root, "index.html");
    writeFileSync(target, "<p>after</p>");
    let refused = 0;
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      if (refused++ < 2) throw busy();
      return realRenameSync(from, to);
    });

    await store.writeTo(hash, target);

    expect(readFileSync(target, "utf8")).toBe("<p>before</p>");
    expect(refused).toBe(3);
  });

  it("files a copy in the store once the hold clears", async () => {
    const source = join(root, "clip.html");
    writeFileSync(source, "<p>kept</p>");
    const store = await openBlobStore(join(root, "history", "blobs"));
    let refused = 0;
    vi.mocked(fsp.rename).mockImplementation(async (from, to) => {
      if (refused < 2) {
        refused += 1;
        throw busy();
      }
      return realRename(from, to);
    });

    const hash = await store.put(source);

    expect((await store.read(hash)).toString("utf8")).toBe("<p>kept</p>");
    expect(refused).toBe(2);
  });
});

describe("a restore of a file the preview is serving", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hf-blob-served-"));
  });
  afterEach(() => {
    vi.mocked(fs.renameSync).mockImplementation(realRenameSync);
    rmSync(root, { recursive: true, force: true });
  });

  it("ends the preview's open read of it first, which Windows would not replace", async () => {
    const target = join(root, "clip.mp4");
    writeFileSync(target, Buffer.alloc(1 << 20, 1));
    const store = await openBlobStore(join(root, "history", "blobs"));
    const hash = await store.put(target);
    const read = serveWhileOpen(target, createReadStream(target, { highWaterMark: 1024 }));
    await new Promise((resolve) => read.once("data", resolve));
    read.pause();
    let openAtReplace = true;
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      openAtReplace = !read.closed;
      return realRenameSync(from, to);
    });

    await store.writeTo(hash, target);

    expect(openAtReplace).toBe(false);
  });

  it("off Windows, a refused rename fails the restore at once and writes nothing in place", async () => {
    const target = join(root, "index.html");
    writeFileSync(target, "<p>before</p>");
    const store = await openBlobStore(join(root, "history", "blobs"));
    const hash = await store.put(target);
    writeFileSync(target, "<p>after</p>");
    vi.mocked(fs.renameSync).mockImplementation(() => {
      throw busy();
    });
    const heard: string[] = [];
    const stop = onRestoredInPlace((_path, outcome) => heard.push(outcome));
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      await expect(store.writeTo(hash, target)).rejects.toMatchObject({ code: "EPERM" });
    } finally {
      Object.defineProperty(process, "platform", { value: platform, configurable: true });
      stop();
    }

    expect(readFileSync(target, "utf8")).toBe("<p>after</p>");
    expect(heard).toEqual([]);
  });
});

describe("the history store's count of what it holds", () => {
  it("counts a file once when two copies of it are filed together", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-blob-count-"));
    try {
      const small = join(root, "small.txt");
      const large = join(root, "large.txt");
      writeFileSync(small, "same bytes");
      writeFileSync(large, "x".repeat(200 * 1024));
      const store = await openBlobStore(join(root, "history", "blobs"));
      await Promise.all([store.put(small), store.put(small), store.put(large), store.put(large)]);
      expect(store.bytes()).toBe("same bytes".length + 200 * 1024);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("a file written to while the history reads it", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hf-blob-moving-"));
  });
  afterEach(() => {
    vi.mocked(fsp.open).mockImplementation(realOpen);
    vi.mocked(fsp.copyFile).mockImplementation(realCopyFile);
    rmSync(root, { recursive: true, force: true });
  });

  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const stored = () => readdirSync(join(root, "blobs"), { recursive: true }).map(String);

  /** A saved file, dated a minute back, and the half and whole of the save about to replace it. */
  function savedFile(name: string, size: number) {
    const path = join(root, name);
    writeFileSync(path, "a".repeat(size));
    const minuteAgo = new Date(Date.now() - 60_000);
    utimesSync(path, minuteAgo, minuteAgo);
    return { path, half: "b".repeat(size / 2), whole: "b".repeat(size) };
  }

  it("reads a small file again when a save lands during the read, and files only the whole save", async () => {
    const { path, half, whole } = savedFile("index.html", 1024);
    vi.mocked(fsp.open).mockImplementationOnce(async (file, flags) => {
      const handle = await realOpen(file, flags);
      const read = handle.readFile.bind(handle);
      handle.readFile = (async () => {
        writeFileSync(path, half);
        const bytes = await read();
        writeFileSync(path, whole);
        return bytes;
      }) as typeof handle.readFile;
      return handle;
    });
    const store = await openBlobStore(join(root, "blobs"));

    expect(await store.put(path)).toBe(sha(whole));
    expect(store.has(sha(half))).toBe(false);
  });

  it("copies a large file again when a save lands during the copy, and files only the whole save", async () => {
    const { path, half, whole } = savedFile("clip.bin", 256 * 1024);
    vi.mocked(fsp.copyFile).mockImplementationOnce(async (from, to) => {
      writeFileSync(path, half);
      await realCopyFile(from, to);
      writeFileSync(path, whole);
    });
    const store = await openBlobStore(join(root, "blobs"));

    expect(await store.put(path)).toBe(sha(whole));
    expect(store.has(sha(half))).toBe(false);
    expect(stored().filter((name) => name.includes("incoming-"))).toEqual([]);
  });

  it("files nothing, and leaves it for the next sweep, while every read is cut into", async () => {
    const { path } = savedFile("clip.bin", 256 * 1024);
    let saves = 0;
    vi.mocked(fsp.copyFile).mockImplementation(async (from, to) => {
      await realCopyFile(from, to);
      saves += 1;
      // A new size each time: a same-size rewrite within one clock tick of the disk keeps its stat.
      writeFileSync(path, "b".repeat(256 * 1024 + saves));
    });
    const store = await openBlobStore(join(root, "blobs"));

    expect(await store.put(path)).toBeNull();
    expect(saves).toBe(3);
    expect(stored()).toEqual([]);
  });
});
