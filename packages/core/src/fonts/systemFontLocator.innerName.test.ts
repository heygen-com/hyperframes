import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeSfnt, makeTtc } from "./sfntFixture.js";

const home = mkdtempSync(join(tmpdir(), "hf-home-"));
// The locator reads the home folder when it runs, so a fixture home is enough.
process.env.HOME = home;

const { clearSystemFontCache, locateSystemFontVariants } = await import("./systemFontLocator.js");

const fonts = join(home, ".fonts");
mkdirSync(fonts, { recursive: true });
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
    const variants = locateSystemFontVariants("PingFang SC");
    expect(variants.map((v) => [v.weight, v.face, v.format])).toEqual([
      ["400", ttc.offsets[0], "ttc"],
      ["600", ttc.offsets[1], "ttc"],
    ]);
    expect(variants.every((v) => v.path === join(fonts, "PingFang.ttc"))).toBe(true);
  });

  it("does not return a face of another family in the same collection", () => {
    expect(locateSystemFontVariants("PingFang TC").map((v) => v.face)).toEqual([ttc.offsets[2]]);
  });

  it("still matches by file name when the name is the family", () => {
    expect(locateSystemFontVariants("Georgia")).toEqual([
      { path: join(fonts, "Georgia.ttf"), format: "ttf", weight: "400", style: "normal" },
    ]);
  });

  it("finds nothing for a family no file names", () => {
    expect(locateSystemFontVariants("Zapfino")).toEqual([]);
  });
});
