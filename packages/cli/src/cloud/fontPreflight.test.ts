import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeSwappedFonts, embedSystemFonts } from "./fontPreflight.js";

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
    expect(calls.map((c) => c.failClosedFontFetch)).toEqual([true, false]);
    expect(calls.map((c) => c.systemFontsByInnerName)).toEqual([undefined, true]);
    // The resolver only injects into a full document, so the probe for the capture pass must be one.
    expect(probes[1]).toContain("<head>");
    const entry = s.fileMap.get("index.html")!.toString();
    expect(entry).toContain('<style data-hf-system-fonts>@font-face{font-family:"PingFang SC"');
    expect(entry.indexOf("data-hf-system-fonts")).toBeLessThan(entry.indexOf("</head>"));
  });

  it("gives a font with no file on this machine an empty face and returns it, instead of stopping", async () => {
    const s = setup();
    const left = await embedSystemFonts(s, async (html, options) => {
      if ((options as { allowSystemFontCapture: boolean }).allowSystemFontCapture) return html;
      throw missing(["PingFang SC"]);
    });
    expect(left).toEqual(["PingFang SC"]);
    const entry = s.fileMap.get("index.html")!.toString();
    expect(entry).toContain(
      '@font-face{font-family:"PingFang SC";src:local("hyperframes-font-not-installed',
    );
    expect(entry).not.toContain("data:font");
  });

  it("carries the fonts it finds even when another one is not on this machine", async () => {
    const page = `<html><head><style>a{font-family:"PingFang SC"}b{font-family:"Zapfino"}</style></head><body></body></html>`;
    const fileMap = new Map([["index.html", Buffer.from(page)]]);
    const dir = mkdtempSync(join(tmpdir(), "hf-font-pre-"));
    writeFileSync(join(dir, "index.html"), page);
    const left = await embedSystemFonts(
      { dir, entryPath: "index.html", fileMap },
      async (html, options) => {
        if ((options as { allowSystemFontCapture: boolean }).allowSystemFontCapture)
          return `${html}<style>@font-face{font-family:"PingFang SC";src:url(data:font/woff2;base64,AAAA)}</style>`;
        throw missing(["PingFang SC", "Zapfino"]);
      },
    );
    expect(left).toEqual(["Zapfino"]);
    const entry = fileMap.get("index.html")!.toString();
    expect(entry).toContain('font-family:"PingFang SC";src:url(data:font/woff2');
    expect(entry).toContain('font-family:"Zapfino";src:local(');
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

describe("describeSwappedFonts", () => {
  it("names each font that is not on this computer and a look-alike when there is one", () => {
    expect(describeSwappedFonts(["PingFang SC", "Zapfino"])).toBe(
      "PingFang SC is not on this computer, so it renders in the next font of its stack (or the default font), as a local render does; Noto Sans SC is a free look-alike you can use instead.\n" +
        "Zapfino is not on this computer, so it renders in the next font of its stack (or the default font), as a local render does.",
    );
  });
});
