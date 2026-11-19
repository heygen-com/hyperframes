// @vitest-environment node
import { createHash } from "node:crypto";
import {
  createReadStream,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    copyFile: vi.fn(actual.copyFile),
    open: vi.fn(actual.open),
    rm: vi.fn(actual.rm),
  };
});

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { onRestoredInPlace, openBlobStore, readBlob } from "./blobStore.js";
import { serveWhileOpen } from "../helpers/servedFiles.js";

const {
  rename: realRename,
  copyFile: realCopyFile,
  open: realOpen,
  rm: realRm,
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
    vi.mocked(fsp.rename).mockImplementation(realRename);
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
    vi.mocked(fsp.rename).mockImplementation(async () => {
      throw busy();
    });
    const heard: string[] = [];
    const stop = onRestoredInPlace((path, outcome) => heard.push(`${path} ${outcome}`));
    return { target, store, hash, heard, stop };
  }

  it("writes a file a holder keeps open in place, once the rename is still refused, and checks it", async () => {
    const { target, store, hash, heard, stop } = await heldRestore();
    try {
      await store.writeTo(hash, root, "index.html");
    } finally {
      stop();
    }

    expect(readFileSync(target, "utf8")).toBe("<p>before</p>");
    expect(heard).toEqual([`${target} restored`]);
  });

  it("fails a write in place that does not match the kept copy, and keeps the copy", async () => {
    const { target, store, hash, heard, stop } = await heldRestore();
    vi.mocked(fsp.copyFile).mockImplementation(async (from, to, mode) => {
      if (to === realpathSync(target)) return writeFileSync(target, "<p>torn</p>");
      return realCopyFile(from, to, mode);
    });
    try {
      await expect(store.writeTo(hash, root, "index.html")).rejects.toThrow(/does not match/);
    } finally {
      stop();
    }

    expect(heard).toEqual([`${target} mismatch`]);
    expect((await store.read(hash)).toString("utf8")).toBe("<p>before</p>");
  });

  it.skipIf(process.getuid?.() === 0)("leaves a read-only project file as it is", async () => {
    const source = join(root, "source.html");
    writeFileSync(source, "<p>before</p>");
    const store = await openBlobStore(join(root, "history", "blobs"));
    const hash = await store.put(source);
    const target = join(root, "index.html");
    writeFileSync(target, "<p>after</p>");
    fs.chmodSync(target, 0o444);
    try {
      await expect(store.writeTo(hash, root, "index.html")).rejects.toMatchObject({
        code: expect.stringMatching(/^(EACCES|EPERM)$/),
      });
      expect(readFileSync(target, "utf8")).toBe("<p>after</p>");
      expect(readdirSync(root).sort()).toEqual(["history", "index.html", "source.html"]);
    } finally {
      fs.chmodSync(target, 0o644);
    }
  });

  it("writes a file back into the project once the hold clears", async () => {
    const source = join(root, "source.html");
    writeFileSync(source, "<p>before</p>");
    const store = await openBlobStore(join(root, "history", "blobs"));
    const hash = await store.put(source);
    const target = join(root, "index.html");
    writeFileSync(target, "<p>after</p>");
    let refused = 0;
    vi.mocked(fsp.rename).mockImplementation(async (from, to) => {
      if (refused++ < 2) throw busy();
      return realRename(from, to);
    });

    await store.writeTo(hash, root, "index.html");

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
    vi.mocked(fsp.rename).mockImplementation(realRename);
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
    vi.mocked(fsp.rename).mockImplementation(async (from, to) => {
      openAtReplace = !read.closed;
      return realRename(from, to);
    });

    await store.writeTo(hash, root, "clip.mp4");

    expect(openAtReplace).toBe(false);
  });

  it("off Windows, a refused rename fails the restore at once and writes nothing in place", async () => {
    const target = join(root, "index.html");
    writeFileSync(target, "<p>before</p>");
    const store = await openBlobStore(join(root, "history", "blobs"));
    const hash = await store.put(target);
    writeFileSync(target, "<p>after</p>");
    vi.mocked(fsp.rename).mockImplementation(async () => {
      throw busy();
    });
    const heard: string[] = [];
    const stop = onRestoredInPlace((_path, outcome) => heard.push(outcome));
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      await expect(store.writeTo(hash, root, "index.html")).rejects.toMatchObject({
        code: "EPERM",
      });
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

describe("a pinned copy", () => {
  it("survives every prune from the moment it is filed until it is unpinned", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-blob-pin-"));
    try {
      const small = join(root, "small.txt");
      const large = join(root, "large.txt");
      writeFileSync(small, "pinned bytes");
      writeFileSync(large, "y".repeat(200 * 1024));
      const store = await openBlobStore(join(root, "history", "blobs"));
      const hashes = [await store.put(small, true), await store.put(large, true)];
      await store.prune(new Set());
      for (const hash of hashes) expect(store.has(hash!)).toBe(true);
      for (const hash of hashes) store.unpin(hash!);
      await store.prune(new Set());
      for (const hash of hashes) expect(store.has(hash!)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pins a copy whose bytes the store already holds, and keeps it until each pin is let go", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-blob-pin-"));
    try {
      const file = join(root, "same.txt");
      writeFileSync(file, "same bytes");
      const store = await openBlobStore(join(root, "history", "blobs"));
      const hash = (await store.put(file))!;
      await store.put(file, true);
      await store.put(file, true);
      store.unpin(hash);
      await store.prune(new Set());
      expect(store.has(hash)).toBe(true);
      store.unpin(hash);
      await store.prune(new Set());
      expect(store.has(hash)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("a pinned copy filed while its hash is pruned", () => {
  afterEach(() => {
    vi.mocked(fsp.rm).mockImplementation(realRm);
    vi.mocked(fsp.open).mockImplementation(realOpen);
  });

  it("is filed again after the delete, never deleted after it is pinned", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-blob-pin-"));
    try {
      const file = join(root, "same.txt");
      writeFileSync(file, "same bytes");
      const blobs = join(root, "history", "blobs");
      const store = await openBlobStore(blobs);
      const hash = (await store.put(file))!;
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      let deleting = 0;
      vi.mocked(fsp.rm).mockImplementation(async (...args: Parameters<typeof realRm>) => {
        if (String(args[0]).endsWith(hash)) {
          deleting += 1;
          await held;
        }
        return realRm(...args);
      });
      let read = false;
      vi.mocked(fsp.open).mockImplementation(async (...args: Parameters<typeof realOpen>) => {
        const handle = await realOpen(...args);
        if (String(args[0]) !== file) return handle;
        const close = handle.close.bind(handle);
        handle.close = async () => {
          await close();
          read = true;
        };
        return handle;
      });
      const pruned = store.prune(new Set());
      await vi.waitFor(() => expect(deleting).toBe(1));
      const pinned = store.put(file, true);
      // The put has read its bytes and come to the store while the delete is still under way.
      await vi.waitFor(() => expect(read).toBe(true));
      release();
      await Promise.all([pruned, pinned]);
      expect(store.has(hash)).toBe(true);
      await expect(readBlob(blobs, hash)).resolves.toEqual(Buffer.from("same bytes"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("takes no pin when the duplicate it staged cannot be removed", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-blob-pin-"));
    try {
      const large = join(root, "large.txt");
      writeFileSync(large, "z".repeat(200 * 1024));
      const store = await openBlobStore(join(root, "history", "blobs"));
      await store.put(large);
      vi.mocked(fsp.rm).mockImplementation(async (...args: Parameters<typeof realRm>) => {
        if (String(args[0]).includes("incoming-")) throw busy();
        return realRm(...args);
      });
      await expect(store.put(large, true)).rejects.toThrow("EPERM");
      expect([...store.pinned()]).toEqual([]);
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

describe("a kept copy whose bytes no longer match its name", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hf-blob-damaged-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** A filed copy of index.html, then changed in the store behind the history's back. */
  async function damaged(size: number) {
    const target = join(root, "index.html");
    writeFileSync(target, "a".repeat(size));
    const blobs = join(root, "history", "blobs");
    const store = await openBlobStore(blobs);
    const hash = (await store.put(target))!;
    writeFileSync(join(blobs, hash.slice(0, 2), hash), "b".repeat(size));
    writeFileSync(target, "current");
    return { target, blobs, store, hash };
  }

  it.each([16, 256 * 1024])("is not written back into the project (%i bytes)", async (size) => {
    const { target, store, hash } = await damaged(size);

    await expect(store.writeTo(hash, root, "index.html")).rejects.toThrow(/damaged/);
    expect(readFileSync(target, "utf8")).toBe("current");
    expect(readdirSync(root).sort()).toEqual(["history", "index.html"]);
  });

  it("is not read back, through the store or the read-only view", async () => {
    const { blobs, store, hash } = await damaged(16);

    await expect(store.read(hash)).rejects.toThrow(/damaged/);
    await expect(readBlob(blobs, hash)).rejects.toThrow(/damaged/);
  });
});
