import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import { untarDirectory } from "./s3Transport.js";

let scratchRoot: string;
beforeAll(() => {
  scratchRoot = mkdtempSync(join(tmpdir(), "hf-s3-untar-"));
});
afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

describe("untarDirectory", () => {
  it("leaves out symbolic links and unpacks hard links as separate plain files", async () => {
    const sourceDir = join(scratchRoot, "src-links");
    const destDir = join(scratchRoot, "dest-links");
    const tarPath = join(scratchRoot, "links.tar");
    const outsideFile = join(scratchRoot, "outside.txt");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(outsideFile, "OUTSIDE");
    writeFileSync(join(sourceDir, "a.txt"), "shared");
    linkSync(join(sourceDir, "a.txt"), join(sourceDir, "b.txt"));
    symlinkSync(outsideFile, join(sourceDir, "..x"));
    symlinkSync(scratchRoot, join(sourceDir, "..dir"), "dir");

    // Packed without following links, so the archive holds the links themselves.
    tar.create({ file: tarPath, cwd: sourceDir, sync: true }, ["."]);
    await untarDirectory(tarPath, destDir);

    const types: string[] = [];
    tar.list({ file: tarPath, sync: true, onReadEntry: (entry) => types.push(entry.type) });
    expect(types).toEqual(expect.arrayContaining(["Link", "SymbolicLink"]));
    expect(readdirSync(destDir).sort()).toEqual(["a.txt", "b.txt"]);
    for (const name of ["a.txt", "b.txt"]) {
      expect(readFileSync(join(destDir, name), "utf-8")).toBe("shared");
      expect(lstatSync(join(destDir, name)).nlink).toBe(1);
    }
  });

  it("unpacks hard links whose names are near the filesystem limit", async () => {
    const sourceDir = join(scratchRoot, "src-long");
    const destDir = join(scratchRoot, "dest-long");
    const tarPath = join(scratchRoot, "long.tar");
    const first = `${"a".repeat(236)}.txt`;
    const second = `${"b".repeat(236)}.txt`;
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, first), "shared");
    linkSync(join(sourceDir, first), join(sourceDir, second));

    tar.create({ file: tarPath, cwd: sourceDir, sync: true }, ["."]);
    await untarDirectory(tarPath, destDir);

    expect(readdirSync(destDir).sort()).toEqual([first, second]);
    for (const name of [first, second]) {
      expect(readFileSync(join(destDir, name), "utf-8")).toBe("shared");
      expect(lstatSync(join(destDir, name)).nlink).toBe(1);
    }
  });
});
