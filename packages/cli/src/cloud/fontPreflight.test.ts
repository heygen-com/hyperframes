import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeUnresolvedFonts, embedSystemFonts } from "./fontPreflight.js";

const PAGE = `<html><head><style>h1{font-family:"PingFang SC"}</style></head><body><h1>x</h1></body></html>`;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "hf-font-pre-"));
  writeFileSync(join(dir, "index.html"), PAGE);
  return { dir, entryPath: "index.html", fileMap: new Map([["index.html", Buffer.from(PAGE)]]) };
}

const missing = (families: string[]) =>
  Object.assign(new Error("x"), { code: "FONT_FETCH_FAILED", unresolvedFamilies: families });

describe("embedSystemFonts", () => {
  it("puts a system font the cloud lacks into the entry page as an inline @font-face", async () => {
    const s = setup();
    const calls: Record<string, unknown>[] = [];
    const probes: string[] = [];
    const left = await embedSystemFonts(s, async (html, options) => {
      calls.push(options as Record<string, unknown>);
      probes.push(html);
      if ((options as { allowSystemFontCapture: boolean }).allowSystemFontCapture)
        return `${html}<style>@font-face{font-family:"PingFang SC";src:url(data:font/woff2;base64,AAAA)}</style>`;
      throw missing(["PingFang SC"]);
    });
    expect(left).toEqual([]);
    expect(calls.map((c) => c.allowSystemFontCapture)).toEqual([false, true]);
    expect(calls.map((c) => c.systemFontsByInnerName)).toEqual([undefined, true]);
    // The resolver only injects into a full document, so the probe for the capture pass must be one.
    expect(probes[1]).toContain("<head>");
    const entry = s.fileMap.get("index.html")!.toString();
    expect(entry).toContain('<style data-hf-system-fonts>@font-face{font-family:"PingFang SC"');
    expect(entry.indexOf("data-hf-system-fonts")).toBeLessThan(entry.indexOf("</head>"));
  });

  it("returns the fonts whose file is not on this machine and leaves the page alone", async () => {
    const s = setup();
    const left = await embedSystemFonts(s, async () => {
      throw missing(["PingFang SC"]);
    });
    expect(left).toEqual(["PingFang SC"]);
    expect(s.fileMap.get("index.html")!.toString()).toBe(PAGE);
  });

  it("changes nothing when every font resolves", async () => {
    const s = setup();
    expect(await embedSystemFonts(s, async (html) => html)).toEqual([]);
    expect(s.fileMap.get("index.html")!.toString()).toBe(PAGE);
  });

  it("does not block on a network failure: the server decides", async () => {
    const s = setup();
    const left = await embedSystemFonts(s, async () => {
      throw Object.assign(new Error("x"), { code: "FONT_FETCH_UNAVAILABLE" });
    });
    expect(left).toEqual([]);
  });
});

describe("describeUnresolvedFonts", () => {
  it("names the font and a look-alike when there is one", () => {
    expect(describeUnresolvedFonts(["PingFang SC", "Zapfino"])).toBe(
      "HyperFrames couldn't find a font file for PingFang SC on this computer, so the cloud can't have it: use Noto Sans SC, switch to a font in your project or render on this computer.\n" +
        "HyperFrames couldn't find a font file for Zapfino on this computer, so the cloud can't have it: switch to a font in your project or render on this computer.",
    );
  });
});
