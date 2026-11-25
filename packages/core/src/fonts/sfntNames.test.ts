import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSfntFace, readSfntFaces } from "./sfntNames.js";
import { makeSfnt, makeTtc } from "./sfntFixture.js";

const dir = () => mkdtempSync(join(tmpdir(), "hf-sfnt-"));

describe("readSfntFaces", () => {
  it("reads the family names, weight and style of a single font", () => {
    const path = join(dir(), "a.ttf");
    writeFileSync(path, makeSfnt({ families: ["Segoe UI"], weight: 700, italic: true }));
    expect(readSfntFaces(path)).toEqual([
      { offset: 0, families: ["Segoe UI"], weight: "700", style: "italic" },
    ]);
  });

  it("reads every face of a collection, each with its own names", () => {
    const { file, offsets } = makeTtc([
      { families: ["PingFang SC", "PingFang SC Regular"], weight: 400 },
      { families: ["PingFang TC"], weight: 600 },
    ]);
    const path = join(dir(), "PingFang.ttc");
    writeFileSync(path, file);
    expect(readSfntFaces(path)).toEqual([
      {
        offset: offsets[0],
        families: ["PingFang SC", "PingFang SC Regular"],
        weight: "400",
        style: "normal",
      },
      { offset: offsets[1], families: ["PingFang TC"], weight: "600", style: "normal" },
    ]);
  });

  it("returns nothing for a file that is not a font", () => {
    const path = join(dir(), "x.ttf");
    writeFileSync(path, "not a font");
    expect(readSfntFaces(path)).toEqual([]);
  });
});

describe("extractSfntFace", () => {
  it("makes one collection member a standalone font with its own tables", () => {
    const { file, offsets } = makeTtc([
      { families: ["PingFang SC"] },
      { families: ["PingFang TC"] },
    ]);
    const path = join(dir(), "PingFang.ttc");
    writeFileSync(path, file);
    const { bytes, format } = extractSfntFace(path, offsets[1]!);
    const alone = join(dir(), "alone.ttf");
    writeFileSync(alone, bytes);
    expect(format).toBe("ttf");
    expect(readSfntFaces(alone).map((f) => f.families)).toEqual([["PingFang TC"]]);
    expect(bytes.includes(Buffer.from("glyph-data-PingFang TC"))).toBe(true);
    expect(bytes.includes(Buffer.from("glyph-data-PingFang SC"))).toBe(false);
  });
});
