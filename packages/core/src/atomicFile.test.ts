// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  createStagingDir,
  atomicTempPath,
  createFileAtomically,
  isAtomicTempPath,
  replaceFileAtomically,
  resolveWritePath,
} from "./atomicFile.js";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});

/** `<file>.hf<6 hex>.tmp`, checked without building a regex from a path (Windows paths hold backslashes). */
function expectTempSiblingOf(tempPath: string, file: string): void {
  expect(tempPath.startsWith(`${file}.`)).toBe(true);
  expect(tempPath.slice(file.length)).toMatch(/^\.hf[0-9a-f]{6}\.tmp$/);
}

/** A directory cannot be opened on Windows, so its descriptor is synthetic and never reaches the disk. */
const DIRECTORY_FD = -1;

function withPlatform(platform: NodeJS.Platform, run: () => void): void {
  const actual = process.platform;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    run();
  } finally {
    Object.defineProperty(process, "platform", { value: actual, configurable: true });
  }
}

/**
 * Filesystem operations that record what an atomic write asks for, in order. The directory open is
 * recorded without touching the disk, so the same test can prove the POSIX order while running on Windows.
 */
function recordingOperations(dir: string) {
  const events: string[] = [];
  const openedFiles: string[] = [];
  let fileFd = -1;
  const operations = {
    openSync: (path: fs.PathLike, flags: string | number, mode?: number) => {
      if (String(path) === dir) {
        events.push(`open-directory:${String(path)}`);
        return DIRECTORY_FD;
      }
      openedFiles.push(String(path));
      fileFd = fs.openSync(path, flags, mode);
      events.push(`open:${String(path)}`);
      return fileFd;
    },
    writeFileSync: (fd: fs.PathOrFileDescriptor, ...args: any[]) => {
      events.push(`write:${String(fd)}`);
      return fs.writeFileSync(fd, ...args);
    },
    fsyncSync: (fd: number) => {
      events.push(`fsync:${fd}`);
      if (fd !== DIRECTORY_FD) fs.fsyncSync(fd);
    },
    closeSync: (fd: number) => {
      events.push(`close:${fd}`);
      if (fd !== DIRECTORY_FD) fs.closeSync(fd);
    },
    chmodSync: fs.chmodSync,
    renameSync: (from: fs.PathLike, to: fs.PathLike) => {
      events.push(`rename:${String(from)}:${String(to)}`);
      return fs.renameSync(from, to);
    },
    unlinkSync: fs.unlinkSync,
  };
  return { operations, events, opened: () => openedFiles, tempFd: () => fileFd };
}

describe("isAtomicTempPath", () => {
  it("knows the temp files it names, and no one else's", () => {
    expect(isAtomicTempPath(atomicTempPath("/p/index.html"))).toBe(true);
    expect(isAtomicTempPath("compositions/intro.html.hf0a1b2c.tmp")).toBe(true);
    expect(isAtomicTempPath("foo.12345678.tmp")).toBe(false);
    expect(isAtomicTempPath("index.html.hf0a1b2c.tmp.bak")).toBe(false);
  });
});

describe("replaceFileAtomically", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  // Windows needs a privilege to create symlinks.
  it.skipIf(process.platform === "win32")(
    "replaces a link at the path, never writing its target",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "atomic-file-test-"));
      dirs.push(dir);
      const target = join(dir, "target.html");
      const link = join(dir, "link.html");
      writeFileSync(target, "old");
      symlinkSync(target, link);

      replaceFileAtomically(link, "new", 0o644);

      expect(readFileSync(target, "utf-8")).toBe("old");
      expect(lstatSync(link).isSymbolicLink()).toBe(false);
    },
  );

  it("writes and syncs the sibling, renames it, then syncs the folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-file-test-"));
    dirs.push(dir);
    const file = join(dir, "index.html");
    writeFileSync(file, "old", { mode: 0o640 });
    const { operations, events, tempFd } = recordingOperations(dir);

    withPlatform("linux", () =>
      replaceFileAtomically(file, "new complete html", 0o640, operations),
    );

    const tempPath = events[0]!.slice("open:".length);
    expectTempSiblingOf(tempPath, file);
    expect(events).toEqual([
      `open:${tempPath}`,
      `write:${tempFd()}`,
      `fsync:${tempFd()}`,
      `close:${tempFd()}`,
      `rename:${tempPath}:${file}`,
      `open-directory:${dir}`,
      `fsync:${DIRECTORY_FD}`,
      `close:${DIRECTORY_FD}`,
    ]);
    expect(readFileSync(file, "utf-8")).toBe("new complete html");
    // Windows keeps only a read-only bit, no group or other permissions.
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o640);
  });

  it("does not open the folder on Windows, where a directory cannot be fsynced", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-file-win32-test-"));
    dirs.push(dir);
    const file = join(dir, "index.html");
    const { operations, opened } = recordingOperations(dir);

    withPlatform("win32", () => replaceFileAtomically(file, "new", 0o644, operations));

    expect(opened()).toHaveLength(1);
    expectTempSiblingOf(opened()[0]!, file);
    expect(readFileSync(file, "utf-8")).toBe("new");
  });

  it("removes the temp file when the disk will not confirm its bytes", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-file-fsync-failure-test-"));
    dirs.push(dir);
    const file = join(dir, "index.html");
    writeFileSync(file, "old");
    const { operations } = recordingOperations(dir);
    operations.fsyncSync = () => {
      throw Object.assign(new Error("EIO"), { code: "EIO" });
    };

    expect(() => replaceFileAtomically(file, "new", 0o644, operations)).toThrow("EIO");
    expect(readFileSync(file, "utf-8")).toBe("old");
    expect(fs.readdirSync(dir)).toEqual(["index.html"]);
  });

  it("replaces an existing destination", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-file-replace-test-"));
    dirs.push(dir);
    const file = join(dir, "index.html");
    writeFileSync(file, "old destination");

    replaceFileAtomically(file, "new destination", 0o640);

    expect(readFileSync(file, "utf-8")).toBe("new destination");
  });

  it("allocates a distinct temporary sibling for each writer", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-file-unique-test-"));
    dirs.push(dir);
    const file = join(dir, "index.html");
    writeFileSync(file, "old");
    const tempPaths: string[] = [];
    const operations = {
      openSync: (path: fs.PathLike, flags: string | number, mode?: number) => {
        tempPaths.push(String(path));
        return fs.openSync(path, flags, mode);
      },
      writeFileSync: fs.writeFileSync,
      fsyncSync: fs.fsyncSync,
      closeSync: fs.closeSync,
      chmodSync: fs.chmodSync,
      renameSync: fs.renameSync,
      unlinkSync: fs.unlinkSync,
    };

    replaceFileAtomically(file, "first", 0o640, operations);
    replaceFileAtomically(file, "second", 0o640, operations);

    expect(tempPaths).toHaveLength(2);
    expect(tempPaths[0]).not.toBe(tempPaths[1]);
  });

  it("uses a unique temporary sibling and removes it when publication fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-file-failure-test-"));
    dirs.push(dir);
    const file = join(dir, "index.html");
    writeFileSync(file, "old");
    const tempPaths: string[] = [];
    const removed: string[] = [];
    const operations = {
      openSync: (path: fs.PathLike, flags: string | number, mode?: number) => {
        tempPaths.push(String(path));
        return fs.openSync(path, flags, mode);
      },
      writeFileSync: fs.writeFileSync,
      fsyncSync: fs.fsyncSync,
      closeSync: fs.closeSync,
      chmodSync: fs.chmodSync,
      renameSync: () => {
        throw new Error("publish failed");
      },
      unlinkSync: (path: fs.PathLike) => {
        removed.push(String(path));
        return fs.unlinkSync(path);
      },
    };

    expect(() => replaceFileAtomically(file, "new", 0o640, operations)).toThrow("publish failed");
    expect(tempPaths).toHaveLength(1);
    expectTempSiblingOf(tempPaths[0]!, file);
    expect(removed).toEqual(tempPaths);
  });

  it("keeps the default mode when none is given", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-file-mode-test-"));
    dirs.push(dir);
    writeFileSync(join(dir, "plain.html"), "x");

    replaceFileAtomically(join(dir, "new.html"), "new");

    expect(fs.statSync(join(dir, "new.html")).mode).toBe(fs.statSync(join(dir, "plain.html")).mode);
  });
});

describe("createFileAtomically", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "atomic-create-test-"));
    dirs.push(dir);
    return dir;
  }

  it("publishes a complete file and leaves no temporary sibling", () => {
    const dir = tempDir();
    const file = join(dir, "index.html");
    const operations = {
      writeFileSync: fs.writeFileSync,
      fsyncSync: fs.fsyncSync,
      chmodSync: fs.chmodSync,
      openSync: (path: fs.PathLike, flags: string | number, mode?: number) => {
        expect(String(path)).not.toBe(file);
        return fs.openSync(path, flags, mode);
      },
      closeSync: fs.closeSync,
      linkSync: (from: fs.PathLike, to: fs.PathLike) => {
        expect(readFileSync(from, "utf-8")).toBe("complete html");
        return fs.linkSync(from, to);
      },
      unlinkSync: fs.unlinkSync,
    };

    createFileAtomically(file, "complete html", operations);

    expect(readFileSync(file, "utf-8")).toBe("complete html");
    expect(fs.readdirSync(dir)).toEqual(["index.html"]);
  });

  it("refuses an existing file, keeping it and removing the temporary sibling", () => {
    const dir = tempDir();
    const file = join(dir, "index.html");
    writeFileSync(file, "old");

    expect(() => createFileAtomically(file, "new")).toThrow(
      expect.objectContaining({ code: "EEXIST" }),
    );
    expect(readFileSync(file, "utf-8")).toBe("old");
    expect(fs.readdirSync(dir)).toEqual(["index.html"]);
  });

  // Windows needs a privilege to create symlinks.
  it.skipIf(process.platform === "win32")(
    "refuses a dangling link without creating its target",
    () => {
      const dir = tempDir();
      symlinkSync(join(dir, "target.html"), join(dir, "link.html"));

      expect(() => createFileAtomically(join(dir, "link.html"), "new")).toThrow(
        expect.objectContaining({ code: "EEXIST" }),
      );
      expect(fs.existsSync(join(dir, "target.html"))).toBe(false);
    },
  );

  function failingLink(code: string) {
    return {
      writeFileSync: fs.writeFileSync,
      fsyncSync: fs.fsyncSync,
      chmodSync: fs.chmodSync,
      openSync: fs.openSync,
      closeSync: fs.closeSync,
      linkSync: () => {
        throw Object.assign(new Error(code), { code });
      },
      unlinkSync: fs.unlinkSync,
    };
  }

  it.each(["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "EISDIR"])(
    "writes directly on a volume without hard links (%s)",
    (code) => {
      const dir = tempDir();
      const file = join(dir, "index.html");

      createFileAtomically(file, "html", failingLink(code));

      expect(readFileSync(file, "utf-8")).toBe("html");
      expect(fs.readdirSync(dir)).toEqual(["index.html"]);
    },
  );

  /** The descriptor of the file the direct fallback writes, which is the one only it opens by name. */
  function directDescriptor(file: string) {
    let direct = -1;
    return {
      openSync: (path: fs.PathLike, flags: string | number, mode?: number) => {
        const fd = fs.openSync(path, flags, mode);
        if (String(path) === file) direct = fd;
        return fd;
      },
      isDirect: (fd: number) => fd === direct,
    };
  }

  it("removes the partial file a direct write leaves on a full disk, keeping the error", () => {
    const dir = tempDir();
    const file = join(dir, "index.html");
    const closed: number[] = [];
    const direct = directDescriptor(file);
    const operations = {
      ...failingLink("EXDEV"),
      openSync: direct.openSync,
      writeFileSync: (target: fs.PathOrFileDescriptor, ...args: any[]) => {
        fs.writeFileSync(target, ...args);
        if (typeof target === "number" && direct.isDirect(target))
          throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
      },
      closeSync: (fd: number) => {
        closed.push(fd);
        fs.closeSync(fd);
        if (direct.isDirect(fd)) throw Object.assign(new Error("EIO"), { code: "EIO" });
      },
    };

    expect(() => createFileAtomically(file, "html", operations)).toThrow("ENOSPC");
    expect(fs.readdirSync(dir)).toEqual([]);
    // Unlinking an open file succeeds, so only the count shows both the temp and direct descriptors closed.
    expect(closed).toHaveLength(2);
  });

  it("removes the file when a network share reports its quota only at close", () => {
    const dir = tempDir();
    const file = join(dir, "index.html");
    const closed: number[] = [];
    const direct = directDescriptor(file);
    const operations = {
      ...failingLink("EXDEV"),
      openSync: direct.openSync,
      closeSync: (fd: number) => {
        closed.push(fd);
        fs.closeSync(fd);
        if (direct.isDirect(fd)) throw Object.assign(new Error("EDQUOT"), { code: "EDQUOT" });
      },
    };

    expect(() => createFileAtomically(file, "html", operations)).toThrow("EDQUOT");
    expect(fs.readdirSync(dir)).toEqual([]);
    // A second close could hit a descriptor another request has reused since.
    expect(closed).toHaveLength(2);
  });

  it("keeps another writer's file when the direct write finds the name taken", () => {
    const dir = tempDir();
    const file = join(dir, "index.html");
    writeFileSync(file, "theirs");

    expect(() => createFileAtomically(file, "html", failingLink("EXDEV"))).toThrow(
      expect.objectContaining({ code: "EEXIST" }),
    );
    expect(readFileSync(file, "utf-8")).toBe("theirs");
    expect(fs.readdirSync(dir)).toEqual(["index.html"]);
  });

  it("propagates any other link failure without writing the destination", () => {
    const dir = tempDir();
    const file = join(dir, "index.html");

    expect(() => createFileAtomically(file, "html", failingLink("EIO"))).toThrow("EIO");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("reports success when only the temporary file's cleanup fails", () => {
    const dir = tempDir();
    const file = join(dir, "index.html");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const operations = {
      writeFileSync: fs.writeFileSync,
      fsyncSync: fs.fsyncSync,
      chmodSync: fs.chmodSync,
      openSync: fs.openSync,
      closeSync: fs.closeSync,
      linkSync: fs.linkSync,
      unlinkSync: () => {
        throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
      },
    };

    createFileAtomically(file, "html", operations);

    expect(readFileSync(file, "utf-8")).toBe("html");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  function nextTempNames(...hex: string[]) {
    for (const name of hex)
      vi.mocked(crypto.randomBytes).mockImplementationOnce(() => Buffer.from(name, "hex") as never);
  }

  it("takes a fresh temporary name when another writer holds one, leaving theirs alone", () => {
    const dir = tempDir();
    const file = join(dir, "index.html");
    writeFileSync(`${file}.hfdeadbe.tmp`, "theirs");
    nextTempNames("deadbe");

    createFileAtomically(file, "html");

    expect(readFileSync(file, "utf-8")).toBe("html");
    expect(readFileSync(`${file}.hfdeadbe.tmp`, "utf-8")).toBe("theirs");
  });

  it("gives up after three taken temporary names without touching them", () => {
    const dir = tempDir();
    const file = join(dir, "index.html");
    for (const name of ["000001", "000002", "000003"])
      writeFileSync(`${file}.hf${name}.tmp`, "theirs");
    nextTempNames("000001", "000002", "000003");

    expect(() => createFileAtomically(file, "html")).toThrow(
      expect.objectContaining({ code: "EEXIST" }),
    );
    expect(fs.readdirSync(dir)).toHaveLength(3);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("creates and replaces a name close to the filesystem's 255-byte limit", () => {
    const dir = tempDir();
    const file = join(dir, `${"n".repeat(237)}.html`);

    createFileAtomically(file, "first");
    replaceFileAtomically(file, "second");

    expect(readFileSync(file, "utf-8")).toBe("second");
  });
});

// Only Windows holds a file a moment after its reader is done, so only there is a refused rename tried again.
describe("replaceFileAtomically on a busy target", () => {
  const dirs: string[] = [];
  const platform = process.platform;
  beforeEach(() =>
    Object.defineProperty(process, "platform", { value: "win32", configurable: true }),
  );
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function renamingAfter(failures: number, code: string) {
    const dir = mkdtempSync(join(tmpdir(), "atomic-busy-test-"));
    dirs.push(dir);
    const file = join(dir, "index.html");
    writeFileSync(file, "old");
    let attempts = 0;
    const operations = {
      openSync: fs.openSync,
      writeFileSync: fs.writeFileSync,
      fsyncSync: fs.fsyncSync,
      closeSync: fs.closeSync,
      chmodSync: fs.chmodSync,
      unlinkSync: fs.unlinkSync,
      renameSync: (from: fs.PathLike, to: fs.PathLike) => {
        if (++attempts <= failures) throw Object.assign(new Error(code), { code });
        fs.renameSync(from, to);
      },
    };
    return { dir, file, operations, attempts: () => attempts };
  }

  it.each(["EPERM", "EBUSY", "EACCES"])("retries a rename refused with %s", (code) => {
    const { file, operations, attempts } = renamingAfter(2, code);

    replaceFileAtomically(file, "new", 0o644, operations);

    expect(readFileSync(file, "utf-8")).toBe("new");
    expect(attempts()).toBe(3);
  });

  it("gives up after eight attempts and keeps the old file", () => {
    const { dir, file, operations, attempts } = renamingAfter(Infinity, "EBUSY");

    expect(() => replaceFileAtomically(file, "new", 0o644, operations)).toThrow("EBUSY");
    expect(attempts()).toBe(8);
    expect(readFileSync(file, "utf-8")).toBe("old");
    expect(fs.readdirSync(dir)).toEqual(["index.html"]);
  });

  it("does not retry other rename errors", () => {
    const { file, operations, attempts } = renamingAfter(Infinity, "ENOSPC");

    expect(() => replaceFileAtomically(file, "new", 0o644, operations)).toThrow("ENOSPC");
    expect(attempts()).toBe(1);
  });
});

// Windows needs a privilege to create symlinks.
describe.skipIf(process.platform === "win32")("resolveWritePath", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** root/sub links to real/deep/sub, as when a project is opened through a linked folder. */
  function linkedFolder() {
    const base = fs.realpathSync(mkdtempSync(join(tmpdir(), "atomic-resolve-test-")));
    dirs.push(base);
    fs.mkdirSync(join(base, "real/deep/sub"), { recursive: true });
    fs.mkdirSync(join(base, "root"));
    symlinkSync(join(base, "real/deep/sub"), join(base, "root/sub"));
    return base;
  }

  it("resolves a relative link against the folder a linked folder points at", () => {
    const base = linkedFolder();
    writeFileSync(join(base, "real/deep/target.html"), "old");
    symlinkSync("../target.html", join(base, "real/deep/sub/comp.html"));

    expect(resolveWritePath(join(base, "root/sub/comp.html"))).toBe(
      join(base, "real/deep/target.html"),
    );
  });

  it("resolves a dangling link to the file a write through it creates", () => {
    const base = linkedFolder();
    symlinkSync("../missing.html", join(base, "real/deep/sub/comp.html"));

    expect(resolveWritePath(join(base, "root/sub/comp.html"))).toBe(
      join(base, "real/deep/missing.html"),
    );
  });

  it("returns a plain file's real path and a new file's path unchanged", () => {
    const base = linkedFolder();
    writeFileSync(join(base, "real/deep/sub/plain.html"), "x");

    expect(resolveWritePath(join(base, "root/sub/plain.html"))).toBe(
      join(base, "real/deep/sub/plain.html"),
    );
    expect(resolveWritePath(join(base, "root/sub/new.html"))).toBe(
      join(base, "real/deep/sub/new.html"),
    );
  });

  function linkCompThroughDotDot(base: string) {
    fs.mkdirSync(join(base, "real/a/b"), { recursive: true });
    symlinkSync(join(base, "real/a/b"), join(base, "root/x"));
    symlinkSync("x/../t.html", join(base, "root/comp.html"));
  }

  it("reads a link through a linked folder and .. the way the system does", () => {
    const base = linkedFolder();
    linkCompThroughDotDot(base);
    writeFileSync(join(base, "real/a/t.html"), "old");

    expect(resolveWritePath(join(base, "root/comp.html"))).toBe(join(base, "real/a/t.html"));
  });

  it("follows a dangling link through a linked folder and .. the way the system does", () => {
    const base = linkedFolder();
    linkCompThroughDotDot(base);

    expect(resolveWritePath(join(base, "root/comp.html"))).toBe(join(base, "real/a/t.html"));
  });

  it("stops a link loop with ELOOP", () => {
    const base = linkedFolder();
    symlinkSync("b.html", join(base, "root/a.html"));
    symlinkSync("a.html", join(base, "root/b.html"));

    expect(() => resolveWritePath(join(base, "root/a.html"))).toThrow(
      expect.objectContaining({ code: "ELOOP" }),
    );
  });
});

describe("HF_WRITE_TRACE", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("records one line per replaced .html when it names a file, and nothing when unset", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-write-trace-"));
    const trace = join(dir, "trace.log");
    try {
      replaceFileAtomically(join(dir, "a.html"), "<p>one</p>");
      expect(fs.existsSync(trace)).toBe(false);

      vi.stubEnv("HF_WRITE_TRACE", trace);
      replaceFileAtomically(join(dir, "a.html"), "<p>two</p>");
      replaceFileAtomically(join(dir, "data.json"), "{}");

      const lines = readFileSync(trace, "utf8").trim().split("\n");
      expect(lines).toHaveLength(1);
      const line = JSON.parse(lines[0]!);
      expect(line).toMatchObject({ kind: "write", file: "a.html", size: 10 });
      expect(line.hash).toBe(
        crypto.createHash("sha256").update("<p>two</p>").digest("hex").slice(0, 8),
      );
      expect(line.stack[0]).toContain("replaceFileAtomically");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("createStagingDir", () => {
  const dirs: string[] = [];
  const root = () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-staging-"));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("makes a fresh private directory named like mkdtemp's: the prefix and 6 letters or digits", () => {
    const parent = root();
    const first = createStagingDir(parent, ".stage-");
    const second = createStagingDir(parent, ".stage-");
    expect(first).not.toBe(second);
    expect(first).toBe(join(parent, basename(first)));
    expect(basename(first)).toMatch(/^\.stage-[A-Za-z0-9]{6}$/);
    expect(fs.statSync(first).isDirectory()).toBe(true);
    if (process.platform !== "win32") expect(fs.statSync(first).mode & 0o777).toBe(0o700);
  });

  it("does not create the parent", () => {
    expect(() => createStagingDir(join(root(), "missing"), ".s-")).toThrow(/ENOENT/);
  });

  it.runIf(process.platform === "win32")("works when the full path passes 260 characters", () => {
    let parent = root();
    while (parent.length < 280) parent = join(parent, "d".repeat(40));
    fs.mkdirSync(parent, { recursive: true });
    const dir = createStagingDir(parent, ".stage-");
    expect(dir.length).toBeGreaterThan(260);
    expect(dir.startsWith("\\\\?\\")).toBe(false);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });
});
