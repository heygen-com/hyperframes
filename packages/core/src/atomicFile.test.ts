// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
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

/** Real fs calls, each logged as `<call>:<path>`; a descriptor is logged as the path it was opened with. */
function recordingOperations(events: string[]) {
  const paths = new Map<number, string>();
  const at = (fd: number) => paths.get(fd) ?? String(fd);
  return {
    openSync: (path: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode | null) => {
      const fd = fs.openSync(path, flags, mode);
      paths.set(fd, String(path));
      events.push(`open:${String(path)}`);
      return fd;
    },
    writeFileSync: (fd: number, data: string | Uint8Array) => {
      events.push(`write:${at(fd)}`);
      fs.writeFileSync(fd, data);
    },
    fsyncSync: (fd: number) => {
      events.push(`fsync:${at(fd)}`);
      fs.fsyncSync(fd);
    },
    closeSync: (fd: number) => {
      events.push(`close:${at(fd)}`);
      fs.closeSync(fd);
    },
    chmodSync: fs.chmodSync,
    renameSync: (from: fs.PathLike, to: fs.PathLike) => {
      events.push(`rename:${String(from)}:${String(to)}`);
      fs.renameSync(from, to);
    },
    linkSync: fs.linkSync,
    unlinkSync: (path: fs.PathLike) => {
      events.push(`unlink:${String(path)}`);
      fs.unlinkSync(path);
    },
    pathOf: at,
  };
}

const failure = (code: string) => Object.assign(new Error(code), { code });

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

  function projectFile(): string {
    const dir = mkdtempSync(join(tmpdir(), "atomic-file-test-"));
    dirs.push(dir);
    const file = join(dir, "index.html");
    writeFileSync(file, "old", { mode: 0o640 });
    return file;
  }

  it("flushes the sibling to disk before replacing the project file", () => {
    const file = projectFile();
    const events: string[] = [];
    const operations = recordingOperations(events);
    const rename = operations.renameSync;
    operations.renameSync = (from, to) => {
      expect(readFileSync(from, "utf-8")).toBe("new complete html");
      rename(from, to);
    };

    replaceFileAtomically(file, "new complete html", 0o640, operations);

    const tempPath = events[0]!.slice("open:".length);
    expectTempSiblingOf(tempPath, file);
    expect(events.slice(0, 5)).toEqual([
      `open:${tempPath}`,
      `write:${tempPath}`,
      `fsync:${tempPath}`,
      `close:${tempPath}`,
      `rename:${tempPath}:${file}`,
    ]);
    expect(readFileSync(file, "utf-8")).toBe("new complete html");
    // Windows keeps only a read-only bit, no group or other permissions.
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o640);
  });

  it.skipIf(process.platform === "win32")("flushes the folder after the rename", () => {
    const file = projectFile();
    const events: string[] = [];

    replaceFileAtomically(file, "new", 0o640, recordingOperations(events));

    expect(events.slice(5)).toEqual([
      `open:${dirname(file)}`,
      `fsync:${dirname(file)}`,
      `close:${dirname(file)}`,
    ]);
  });

  it.skipIf(process.platform === "win32")("keeps a write whose folder refuses a flush", () => {
    const file = projectFile();
    const operations = recordingOperations([]);
    operations.fsyncSync = (fd) => {
      if (operations.pathOf(fd) === dirname(file)) throw failure("EINVAL");
      fs.fsyncSync(fd);
    };

    replaceFileAtomically(file, "new", 0o640, operations);

    expect(readFileSync(file, "utf-8")).toBe("new");
  });

  it("keeps the old file and no sibling when the flush fails", () => {
    const file = projectFile();
    const events: string[] = [];
    const operations = recordingOperations(events);
    operations.fsyncSync = () => {
      throw failure("EIO");
    };

    expect(() => replaceFileAtomically(file, "new", 0o640, operations)).toThrow("EIO");
    expect(readFileSync(file, "utf-8")).toBe("old");
    expect(fs.readdirSync(dirname(file))).toEqual(["index.html"]);
    expect(events.some((event) => event.startsWith("rename:"))).toBe(false);
  });

  it.each(["EINVAL", "ENOTSUP", "EOPNOTSUPP"])(
    "still writes on a volume that cannot flush a file (%s)",
    (code) => {
      const file = projectFile();
      const operations = recordingOperations([]);
      operations.fsyncSync = () => {
        throw failure(code);
      };

      replaceFileAtomically(file, "new", 0o640, operations);

      expect(readFileSync(file, "utf-8")).toBe("new");
      expect(fs.readdirSync(dirname(file))).toEqual(["index.html"]);
    },
  );

  it("replaces an existing destination", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-file-replace-test-"));
    dirs.push(dir);
    const file = join(dir, "index.html");
    writeFileSync(file, "old destination");

    replaceFileAtomically(file, "new destination", 0o640);

    expect(readFileSync(file, "utf-8")).toBe("new destination");
  });

  const tempOpens = (events: string[]) =>
    events
      .filter((event) => event.startsWith("open:") && isAtomicTempPath(event))
      .map((event) => event.slice("open:".length));

  it("allocates a distinct temporary sibling for each writer", () => {
    const file = projectFile();
    const events: string[] = [];
    const operations = recordingOperations(events);

    replaceFileAtomically(file, "first", 0o640, operations);
    replaceFileAtomically(file, "second", 0o640, operations);

    const tempPaths = tempOpens(events);
    expect(tempPaths).toHaveLength(2);
    expect(tempPaths[0]).not.toBe(tempPaths[1]);
  });

  it("uses a unique temporary sibling and removes it when publication fails", () => {
    const file = projectFile();
    const events: string[] = [];
    const operations = recordingOperations(events);
    operations.renameSync = () => {
      throw new Error("publish failed");
    };

    expect(() => replaceFileAtomically(file, "new", 0o640, operations)).toThrow("publish failed");
    const tempPaths = tempOpens(events);
    expect(tempPaths).toHaveLength(1);
    expectTempSiblingOf(tempPaths[0]!, file);
    expect(events.filter((event) => event.startsWith("unlink:"))).toEqual([
      `unlink:${tempPaths[0]}`,
    ]);
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
    const events: string[] = [];
    const operations = recordingOperations(events);
    operations.linkSync = (from, to) => {
      expect(readFileSync(from, "utf-8")).toBe("complete html");
      fs.linkSync(from, to);
    };

    createFileAtomically(file, "complete html", operations);

    expect(readFileSync(file, "utf-8")).toBe("complete html");
    expect(fs.readdirSync(dir)).toEqual(["index.html"]);
    expect(events).not.toContain(`open:${file}`);
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

  function failingLink(code: string, events: string[] = []) {
    const operations = recordingOperations(events);
    operations.linkSync = () => {
      throw failure(code);
    };
    return operations;
  }

  it.each(["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "EISDIR"])(
    "writes directly on a volume without hard links (%s)",
    (code) => {
      const dir = tempDir();
      const file = join(dir, "index.html");
      const events: string[] = [];

      createFileAtomically(file, "html", failingLink(code, events));

      expect(readFileSync(file, "utf-8")).toBe("html");
      expect(fs.readdirSync(dir)).toEqual(["index.html"]);
      const direct = events.filter((event) => event.endsWith(`:${file}`));
      expect(direct).toEqual([`open:${file}`, `write:${file}`, `fsync:${file}`, `close:${file}`]);
    },
  );

  it("removes the partial file a direct write leaves on a full disk, keeping the error", () => {
    const dir = tempDir();
    const file = join(dir, "index.html");
    const closed: number[] = [];
    const operations = failingLink("EXDEV");
    operations.writeFileSync = (fd, data) => {
      if (operations.pathOf(fd) !== file) return fs.writeFileSync(fd, data);
      fs.writeFileSync(fd, "ht");
      throw failure("ENOSPC");
    };
    operations.closeSync = (fd) => {
      if (operations.pathOf(fd) !== file) return fs.closeSync(fd);
      closed.push(fd);
      fs.closeSync(fd);
      throw failure("EIO");
    };

    expect(() => createFileAtomically(file, "html", operations)).toThrow("ENOSPC");
    expect(fs.readdirSync(dir)).toEqual([]);
    // Unlinking an open file succeeds, so only the count shows the descriptor was not leaked.
    expect(closed).toHaveLength(1);
  });

  it("removes the file when a network share reports its quota only at close", () => {
    const dir = tempDir();
    const file = join(dir, "index.html");
    const closed: number[] = [];
    const operations = failingLink("EXDEV");
    operations.closeSync = (fd) => {
      if (operations.pathOf(fd) !== file) return fs.closeSync(fd);
      closed.push(fd);
      fs.closeSync(fd);
      throw failure("EDQUOT");
    };

    expect(() => createFileAtomically(file, "html", operations)).toThrow("EDQUOT");
    expect(fs.readdirSync(dir)).toEqual([]);
    // A second close could hit a descriptor another request has reused since.
    expect(closed).toHaveLength(1);
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
    const operations = recordingOperations([]);
    operations.unlinkSync = () => {
      throw failure("EBUSY");
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
    const operations = recordingOperations([]);
    operations.renameSync = (from, to) => {
      if (++attempts <= failures) throw failure(code);
      fs.renameSync(from, to);
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

  it("flushes the sibling but never opens the folder on Windows", () => {
    const { dir, file } = renamingAfter(0, "EBUSY");
    const events: string[] = [];

    replaceFileAtomically(file, "new", 0o644, recordingOperations(events));

    expect(readFileSync(file, "utf-8")).toBe("new");
    expect(events.some((event) => event.startsWith("fsync:") && isAtomicTempPath(event))).toBe(
      true,
    );
    expect(events).not.toContain(`open:${dir}`);
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
