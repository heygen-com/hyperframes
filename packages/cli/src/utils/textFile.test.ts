import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const existsSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  existsSyncMock.mockImplementation(actual.existsSync);
  return { ...actual, existsSync: existsSyncMock };
});

import { isShareTextFilePath, isTextFile } from "./textFile.js";

describe("isTextFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-text-file-test-"));
    writeFileSync(join(dir, "script.txt"), "hello");
    writeFileSync(join(dir, "notes.md"), "hello");
    existsSyncMock.mockClear();
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is true for an existing .txt file, in any letter case", () => {
    writeFileSync(join(dir, "LOUD.TXT"), "hello");
    expect(isTextFile(join(dir, "script.txt"))).toBe(true);
    expect(isTextFile(join(dir, "LOUD.TXT"))).toBe(true);
  });

  it("is false for a missing .txt file", () => {
    expect(isTextFile(join(dir, "missing.txt"))).toBe(false);
  });

  it.each([
    ["a sentence", "Welcome to the show"],
    ["an existing file of another type", "notes.md"],
    ["a share, backslashes", "\\\\host\\share\\script.txt"],
    ["a share, forward slashes", "//host/share/script.txt"],
    ["a share, mixed separators", "\\/host/share/script.txt"],
    ["a device", "\\\\.\\pipe\\script.txt"],
    ["a long-path prefix", "\\\\?\\C:\\script.txt"],
  ])("is false for %s without looking on disk", (_name, input) => {
    expect(isTextFile(input === "notes.md" ? join(dir, input) : input)).toBe(false);
    expect(existsSyncMock).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32")(
    "is false for an existing .txt file named with two leading separators",
    () => {
      expect(isTextFile(`/${join(dir, "script.txt")}`)).toBe(false);
      expect(existsSyncMock).not.toHaveBeenCalled();
    },
  );
});

describe("isShareTextFilePath", () => {
  it.each(["\\\\host\\share\\a.txt", "//host/share/a.TXT", "\\\\?\\C:\\a.txt"])(
    "is true for %s",
    (input) => {
      expect(isShareTextFilePath(input)).toBe(true);
      expect(existsSyncMock).not.toHaveBeenCalled();
    },
  );

  it.each(["/host/share/a.txt", "a.txt", "//host/share/a.md", "// a note"])(
    "is false for %s",
    (input) => expect(isShareTextFilePath(input)).toBe(false),
  );
});
