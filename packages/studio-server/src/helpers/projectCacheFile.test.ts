import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCopyIndex, writeCopyIndex } from "./proxyCacheKey";
import { isProjectCacheFile, readProjectCacheFile } from "./safePath";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-cache-file-"));
  dirs.push(dir);
  return dir;
}

const COPY = `${"a".repeat(64)}.mp4`;

describe("readProjectCacheFile", () => {
  it("reads a plain file in a plain folder", () => {
    const project = tempDir();
    mkdirSync(join(project, ".cache"));
    writeFileSync(join(project, ".cache", "entry"), "data");
    expect(readProjectCacheFile(project, join(project, ".cache", "entry"), 64)?.toString()).toBe(
      "data",
    );
    expect(isProjectCacheFile(project, join(project, ".cache", "entry"))).toBe(true);
  });

  it("is a miss for a file over the size limit", () => {
    const project = tempDir();
    writeFileSync(join(project, "entry"), "data");
    expect(readProjectCacheFile(project, join(project, "entry"), 3)).toBeNull();
  });

  it("is a miss for a folder at the entry", () => {
    const project = tempDir();
    mkdirSync(join(project, "entry"));
    expect(readProjectCacheFile(project, join(project, "entry"), 64)).toBeNull();
    expect(isProjectCacheFile(project, join(project, "entry"))).toBe(false);
  });

  describe.skipIf(process.platform === "win32")("links", () => {
    it("is a miss for a link at the entry", () => {
      const project = tempDir();
      const secret = join(tempDir(), "id_rsa");
      writeFileSync(secret, "PRIVATE KEY");
      symlinkSync(secret, join(project, "entry"));
      expect(readProjectCacheFile(project, join(project, "entry"), 64)).toBeNull();
      expect(isProjectCacheFile(project, join(project, "entry"))).toBe(false);
    });

    it("is a miss for a hard link to a file outside the project", () => {
      const project = tempDir();
      const secret = join(tempDir(), "id_rsa");
      writeFileSync(secret, "PRIVATE KEY");
      linkSync(secret, join(project, "entry"));
      expect(readProjectCacheFile(project, join(project, "entry"), 64)).toBeNull();
      expect(isProjectCacheFile(project, join(project, "entry"))).toBe(false);
    });

    it("is a miss for a plain file under a linked folder", () => {
      const project = tempDir();
      const elsewhere = tempDir();
      writeFileSync(join(elsewhere, "entry"), "outside");
      symlinkSync(elsewhere, join(project, ".cache"));
      expect(readProjectCacheFile(project, join(project, ".cache", "entry"), 64)).toBeNull();
      expect(isProjectCacheFile(project, join(project, ".cache", "entry"))).toBe(false);
    });
  });
});

describe("readCopyIndex", () => {
  it("names a plain copy in the same folder", () => {
    const project = tempDir();
    const cache = join(project, ".transcode-cache");
    mkdirSync(cache);
    writeFileSync(join(cache, COPY), "video");
    writeCopyIndex(join(cache, ".fast-x"), join(cache, COPY));
    expect(readCopyIndex(project, join(cache, ".fast-x"))).toBe(join(cache, COPY));
  });

  describe.skipIf(process.platform === "win32")("links", () => {
    it("is a miss when the copy it names is a link", () => {
      const project = tempDir();
      const cache = join(project, ".transcode-cache");
      mkdirSync(cache);
      const secret = join(tempDir(), "id_rsa");
      writeFileSync(secret, "PRIVATE KEY");
      symlinkSync(secret, join(cache, COPY));
      writeCopyIndex(join(cache, ".fast-x"), join(cache, COPY));
      expect(readCopyIndex(project, join(cache, ".fast-x"))).toBeNull();
    });

    it("writes an index in place of a link at its name, leaving the link's target as it was", () => {
      const project = tempDir();
      const cache = join(project, ".transcode-cache");
      mkdirSync(cache);
      const outside = join(tempDir(), "notes.txt");
      writeFileSync(outside, "mine");
      symlinkSync(outside, join(cache, ".fast-x"));
      writeCopyIndex(join(cache, ".fast-x"), join(cache, COPY));
      expect(readFileSync(outside, "utf8")).toBe("mine");
      expect(lstatSync(join(cache, ".fast-x")).isSymbolicLink()).toBe(false);
    });

    it("is a miss when the index itself is a link", () => {
      const project = tempDir();
      const cache = join(project, ".transcode-cache");
      mkdirSync(cache);
      writeFileSync(join(cache, COPY), "video");
      const outsideIndex = join(tempDir(), "index");
      writeFileSync(outsideIndex, COPY);
      symlinkSync(outsideIndex, join(cache, ".fast-x"));
      expect(readCopyIndex(project, join(cache, ".fast-x"))).toBeNull();
    });
  });
});
