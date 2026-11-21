import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeOutputFolder } from "./outputFolder.js";

// Windows answers a recursive mkdir of a drive root (D:\) with EPERM though the root exists, so an output there
// failed before it was written. makeOutputFolder leaves an existing folder alone; this mock stands in for Windows.
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    mkdirSync: vi.fn((path: string, options: fs.MakeDirectoryOptions) => {
      if (real.statSync(path, { throwIfNoEntry: false })?.isDirectory())
        throw Object.assign(new Error(`EPERM: operation not permitted, mkdir '${path}'`), {
          code: "EPERM",
        });
      return real.mkdirSync(path, options);
    }),
  };
});

describe("makeOutputFolder", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("leaves a folder that is already there, as a drive root is, alone", () => {
    const root = fs.mkdtempSync(join(tmpdir(), "hf-output-root-"));
    made.push(root);
    expect(() => makeOutputFolder(root)).not.toThrow();
  });

  it("makes a missing folder and the folders above it", () => {
    const root = fs.mkdtempSync(join(tmpdir(), "hf-output-new-"));
    made.push(root);
    const dir = join(root, "renders", "today");
    makeOutputFolder(dir);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });

  it("still refuses a path that is a file", () => {
    const root = fs.mkdtempSync(join(tmpdir(), "hf-output-file-"));
    made.push(root);
    const file = join(root, "film.mp4");
    fs.writeFileSync(file, "");
    expect(() => makeOutputFolder(file)).toThrow(/EEXIST/);
  });
});
