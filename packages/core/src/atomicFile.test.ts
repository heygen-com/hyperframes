// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("writes the sibling completely before replacing the project file", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-file-test-"));
    dirs.push(dir);
    const file = join(dir, "index.html");
    writeFileSync(file, "old", { mode: 0o640 });
    const events: string[] = [];
    const operations = {
      writeFileSync: (path: fs.PathLike, ...args: any[]) => {
        events.push(`write:${String(path)}`);
        return fs.writeFileSync(path, ...args);
      },
      chmodSync: fs.chmodSync,
      renameSync: (from: fs.PathLike, to: fs.PathLike) => {
        events.push(`rename:${String(from)}:${String(to)}`);
        expect(readFileSync(from, "utf-8")).toBe("new complete html");
        return fs.renameSync(from, to);
      },
      unlinkSync: fs.unlinkSync,
    };

    replaceFileAtomically(file, "new complete html", 0o640, operations);

    expect(events).toHaveLength(2);
    expect(events[0]!.startsWith("write:")).toBe(true);
    const tempPath = events[0]!.slice("write:".length);
    expectTempSiblingOf(tempPath, file);
    expect(events[1]).toBe(`rename:${tempPath}:${file}`);
    expect(readFileSync(file, "utf-8")).toBe("new complete html");
    // Windows keeps only a read-only bit, no group or other permissions.
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o640);
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
      writeFileSync: (path: fs.PathLike, ...args: any[]) => {
        tempPaths.push(String(path));
        return fs.writeFileSync(path, ...args);
      },
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
      writeFileSync: (path: fs.PathLike, ...args: any[]) => {
        tempPaths.push(String(path));
        return fs.writeFileSync(path, ...args);
      },
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
      writeFileSync: (path: fs.PathLike, ...args: any[]) => {
        expect(String(path)).not.toBe(file);
        return fs.writeFileSync(path, ...args);
      },
      chmodSync: fs.chmodSync,
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
      chmodSync: fs.chmodSync,
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
      chmodSync: fs.chmodSync,
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

describe("replaceFileAtomically on a busy target", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function renamingAfter(failures: number, code: string) {
    const dir = mkdtempSync(join(tmpdir(), "atomic-busy-test-"));
    dirs.push(dir);
    const file = join(dir, "index.html");
    writeFileSync(file, "old");
    let attempts = 0;
    const operations = {
      writeFileSync: fs.writeFileSync,
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

  it("gives up after five attempts and keeps the old file", () => {
    const { dir, file, operations, attempts } = renamingAfter(Infinity, "EBUSY");

    expect(() => replaceFileAtomically(file, "new", 0o644, operations)).toThrow("EBUSY");
    expect(attempts()).toBe(5);
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
