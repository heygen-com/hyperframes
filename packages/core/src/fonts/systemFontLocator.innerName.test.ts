import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureFontDir, makeSfnt, makeTtc } from "./sfntFixture.js";

const fonts = fixtureFontDir();

const { clearSystemFontCache, locateSystemFontVariants } = await import("./systemFontLocator.js");

const INNER = { byInnerName: true };
const ttc = makeTtc([
  { families: ["PingFang SC"], weight: 400 },
  { families: ["PingFang SC"], weight: 600 },
  { families: ["PingFang TC"], weight: 400 },
]);
writeFileSync(join(fonts, "PingFang.ttc"), ttc.file);
writeFileSync(join(fonts, "Georgia.ttf"), makeSfnt({ families: ["Georgia"] }));

afterEach(() => clearSystemFontCache());

describe("locateSystemFontVariants by the names inside the file", () => {
  it("finds PingFang SC in PingFang.ttc, one variant per face, each loadable alone", () => {
    const variants = locateSystemFontVariants("PingFang SC", INNER);
    expect(variants.map((v) => [v.weight, v.face, v.format])).toEqual([
      ["400", ttc.offsets[0], "ttc"],
      ["600", ttc.offsets[1], "ttc"],
    ]);
    expect(variants.every((v) => v.path === join(fonts, "PingFang.ttc"))).toBe(true);
  });

  it("does not return a face of another family in the same collection", () => {
    expect(locateSystemFontVariants("PingFang TC", INNER).map((v) => v.face)).toEqual([
      ttc.offsets[2],
    ]);
  });

  it("still matches by file name when the name is the family", () => {
    expect(locateSystemFontVariants("Georgia")).toEqual([
      { path: join(fonts, "Georgia.ttf"), format: "ttf", weight: "400", style: "normal" },
    ]);
  });

  it("does not look inside files unless asked, so preview and local renders are unchanged", () => {
    expect(locateSystemFontVariants("PingFang SC")).toEqual([]);
  });

  it("keeps only the regular and the bold face of a family with many weights", () => {
    const many = makeTtc(
      [100, 300, 400, 500, 600, 800].map((weight) => ({ families: ["Heavy Sans"], weight })),
    );
    writeFileSync(join(fonts, "Hvy.ttc"), many.file);
    expect(locateSystemFontVariants("Heavy Sans", INNER).map((v) => v.weight)).toEqual([
      "400",
      "600",
    ]);
  });

  it("finds nothing for a family no file names", () => {
    expect(locateSystemFontVariants("Zapfino")).toEqual([]);
  });
});
