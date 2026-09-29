import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ExtractedFrameSequenceError,
  extractedFrameIndex,
  framePathsFromDirectory,
} from "./extractedFrameIndex.js";

const roots: string[] = [];

function frameDir(): string {
  const root = mkdtempSync(join(tmpdir(), "hf-extracted-frame-index-"));
  roots.push(root);
  return root;
}

function seed(root: string, ...files: string[]): void {
  for (const file of files) writeFileSync(join(root, file), file);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("extractedFrameIndex", () => {
  it("derives frame identity across the five-to-six-digit boundary", () => {
    expect(extractedFrameIndex("frame_99999.jpg", "jpg")).toBe(99_998);
    expect(extractedFrameIndex("frame_100000.jpg", "jpg")).toBe(99_999);
  });

  it("refuses malformed, zero, and wrong-format frame candidates", () => {
    expect(() => extractedFrameIndex("frame_bad.jpg", "jpg")).toThrow(ExtractedFrameSequenceError);
    expect(() => extractedFrameIndex("frame_00000.jpg", "jpg")).toThrow(
      ExtractedFrameSequenceError,
    );
    expect(() => extractedFrameIndex("frame_00001.png", "jpg")).toThrow(
      ExtractedFrameSequenceError,
    );
  });
});

describe("framePathsFromDirectory", () => {
  it("maps by the filename ordinal instead of directory or lexical position", () => {
    const root = frameDir();
    seed(
      root,
      ...Array.from({ length: 10 }, (_, index) => `frame_${index + 1}.jpg`).reverse(),
      "notes.txt",
    );

    const paths = framePathsFromDirectory(root, "jpg");

    expect(paths.size).toBe(10);
    expect(basename(paths.get(8)!)).toBe("frame_9.jpg");
    expect(basename(paths.get(9)!)).toBe("frame_10.jpg");
  });

  it("fails loudly when two filenames claim the same numeric frame", () => {
    const root = frameDir();
    seed(root, "frame_1.jpg", "frame_00001.jpg");

    expect(() => framePathsFromDirectory(root, "jpg")).toThrow(/duplicate.*frame index 0/i);
  });

  it("fails loudly instead of shifting later frames across a gap", () => {
    const root = frameDir();
    seed(root, "frame_00001.jpg", "frame_00003.jpg");

    expect(() => framePathsFromDirectory(root, "jpg")).toThrow(/missing.*frame index 1/i);
  });

  it("fails on frame-prefixed malformed candidates but ignores unrelated files", () => {
    const root = frameDir();
    seed(root, "frame_00001.jpg", "frame_bad.jpg", "notes.txt");

    expect(() => framePathsFromDirectory(root, "jpg")).toThrow(/invalid.*frame filename/i);
  });
});
