import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  isCopiedOutsideFileType,
  isUploadedOutsideFileType,
  leftOutWarning,
} from "./outsideFile.js";

const dir = mkdtempSync(join(tmpdir(), "hf-outside-file-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function write(name: string, body: string | Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

/** Three packets of `size` bytes with the sync byte at `offset` in each. */
function transportStream(size: number, offset: number): Buffer {
  const bytes = Buffer.alloc(size * 3);
  for (let at = offset; at < bytes.length; at += size) bytes[at] = 0x47;
  return bytes;
}

describe("outside file types", () => {
  it("copies scripts into a local render but not into an upload", () => {
    for (const name of ["lib.js", "lib.mjs"]) {
      const path = write(name, "export const key = 1;");
      expect(isCopiedOutsideFileType(path)).toBe(true);
      expect(isUploadedOutsideFileType(path)).toBe(false);
    }
  });

  it("copies stylesheets, fonts and media into both", () => {
    for (const name of ["theme.css", "brand.woff2", "clip.mp4", "logo.png"]) {
      const path = write(name, "x");
      expect(isCopiedOutsideFileType(path)).toBe(true);
      expect(isUploadedOutsideFileType(path)).toBe(true);
    }
  });

  it("treats a .ts or .mts file as video only when it is a transport stream", () => {
    const source = [write("config.ts", "export const key: number = 1;"), write("config.mts", "G")];
    for (const path of source) {
      expect(isCopiedOutsideFileType(path)).toBe(false);
      expect(isUploadedOutsideFileType(path)).toBe(false);
    }
    const video = [
      write("clip.ts", transportStream(188, 0)),
      write("cam.mts", transportStream(192, 4)),
      write("disc.m2ts", "x"),
    ];
    for (const path of video) {
      expect(isCopiedOutsideFileType(path)).toBe(true);
      expect(isUploadedOutsideFileType(path)).toBe(true);
    }
  });

  it("does not count text with a sync byte at every packet as a transport stream", () => {
    const text = Array.from({ length: 4 }, () => `G${"/".repeat(187)}`).join("");
    for (const name of ["spaced.ts", "spaced.mts"]) {
      expect(isUploadedOutsideFileType(write(name, text))).toBe(false);
    }
  });

  it.skipIf(process.platform === "win32")(
    "refuses a named pipe without waiting for a writer",
    () => {
      const fifo = join(dir, "pipe.ts");
      execFileSync("mkfifo", [fifo]);
      expect(isCopiedOutsideFileType(fifo)).toBe(false);
      expect(isUploadedOutsideFileType(fifo)).toBe(false);
    },
  );

  it("names the copied types for the upload or render that left a file out", () => {
    expect(leftOutWarning("index.html", "../lib.js", "file_type")).toBe(
      "index.html references ../lib.js, which is outside the project and is not an image, video, audio, font or CSS file; it was left out of the upload. Move it into the project to include it.",
    );
    expect(leftOutWarning("index.html", "../a.pdf", "file_type", "render")).toBe(
      "index.html references ../a.pdf, which is outside the project and is not an image, video, audio, font, CSS or JS file; it was left out of the render. Move it into the project to include it.",
    );
  });
});
