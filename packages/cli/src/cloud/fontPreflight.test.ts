import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeUnresolvedFonts, unresolvedCloudFonts } from "./fontPreflight.js";

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-font-pre-"));
  writeFileSync(
    join(dir, "index.html"),
    `<html><head><style>h1{font-family:"PingFang SC"}</style></head><body><h1 data-composition-id="m" data-width="1920" data-height="1080">x</h1></body></html>`,
  );
  return dir;
}

describe("unresolvedCloudFonts", () => {
  it("returns the families the resolver cannot find, as the compile step would refuse them", async () => {
    const calls: object[] = [];
    const families = await unresolvedCloudFonts(project(), undefined, async (_html, options) => {
      calls.push(options);
      throw Object.assign(new Error("x"), {
        code: "FONT_FETCH_FAILED",
        unresolvedFamilies: ["PingFang SC"],
      });
    });
    expect(families).toEqual(["PingFang SC"]);
    expect(calls).toMatchObject([{ failClosedFontFetch: true, allowSystemFontCapture: false }]);
  });

  it("lets the render go when every font resolves", async () => {
    expect(await unresolvedCloudFonts(project(), undefined, async (html) => html)).toEqual([]);
  });

  it("does not block on a network failure: the server decides", async () => {
    const families = await unresolvedCloudFonts(project(), undefined, async () => {
      throw Object.assign(new Error("x"), { code: "FONT_FETCH_UNAVAILABLE" });
    });
    expect(families).toEqual([]);
  });
});

describe("describeUnresolvedFonts", () => {
  it("names the font and a look-alike when there is one", () => {
    expect(describeUnresolvedFonts(["PingFang SC", "Zapfino"])).toBe(
      "PingFang SC isn't available in the cloud: use Noto Sans SC, switch to a font in your project or render on this computer.\n" +
        "Zapfino isn't available in the cloud: switch to a font in your project or render on this computer.",
    );
  });
});
