import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashProjectDir, listSiteFiles } from "./projectHash.js";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-project-hash-"));
  dirs.push(dir);
  return dir;
}
function project(): string {
  const dir = tempDir();
  writeFileSync(join(dir, "index.html"), "<html>hi</html>");
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("listSiteFiles / hashProjectDir", () => {
  it("follows a symlinked project root", () => {
    const real = project();
    const link = join(tempDir(), "fx");
    symlinkSync(real, link);
    expect(listSiteFiles(link)).toEqual(["index.html"]);
    expect(hashProjectDir(link)).toBe(hashProjectDir(real));
  });

  it("lists symlinked files and folders, and hashes their targets' bytes", () => {
    const dir = project();
    const outside = tempDir();
    mkdirSync(join(outside, "media"));
    writeFileSync(join(outside, "shared.css"), "a{}");
    writeFileSync(join(outside, "media", "clip.txt"), "v1");
    symlinkSync(join(outside, "shared.css"), join(dir, "shared.css"));
    symlinkSync(join(outside, "media"), join(dir, "media"));
    expect(listSiteFiles(dir)).toEqual(["index.html", "media/clip.txt", "shared.css"]);

    const before = hashProjectDir(dir);
    writeFileSync(join(outside, "media", "clip.txt"), "v2");
    expect(hashProjectDir(dir)).not.toBe(before);
  });

  it("skips top-level skip-list folders", () => {
    const dir = project();
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules", "junk.js"), "x");
    expect(listSiteFiles(dir)).toEqual(["index.html"]);
  });

  it("does not loop on a folder that links back to an ancestor", () => {
    const dir = project();
    symlinkSync(dir, join(dir, "self"));
    expect(listSiteFiles(dir)).toEqual(["index.html"]);
  });

  it("throws on a dangling symlink, naming it", () => {
    const dir = project();
    symlinkSync(join(dir, "missing.png"), join(dir, "broken.png"));
    expect(() => listSiteFiles(dir)).toThrow(/cannot read broken\.png/);
  });

  it("never reuses an id from the unversioned scheme", () => {
    const dir = project();
    const unversioned = createHash("sha256")
      .update("index.html\0<html>hi</html>")
      .digest("hex")
      .slice(0, 16);
    expect(hashProjectDir(dir)).not.toBe(unversioned);
  });

  it("hashes a file larger than a runtime can read in one call", () => {
    const dir = project();
    writeFileSync(join(dir, "big.mov"), "");
    truncateSync(join(dir, "big.mov"), 2 ** 32 + 1);
    // Same bytes hashed outside this code: "site-v2\0big.mov\0" + 4 GiB + 1 zero bytes + index.html.
    expect(hashProjectDir(dir)).toBe("014f8f69f7633edb");
  }, 60_000);

  it("keeps the site id of a small project unchanged", () => {
    const dir = project();
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "clip.mp4"), Buffer.from([0, 1, 2, 255]));
    expect(hashProjectDir(dir)).toBe("12972d522bd6829d");
  });
});
