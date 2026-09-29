import { readFileSync } from "node:fs";
import { win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { captureFontExtension, captureFontFilename } from "./captureFontValidation.js";

const font = readFileSync(
  new URL("../../../../docs/public/catalog/assets/a634cb9e7783af7e.woff2", import.meta.url),
);

describe("capture font publication", () => {
  it("keeps canonicalized font names distinct on case-insensitive filesystems", () => {
    const used = new Set<string>();
    expect(captureFontFilename("https://fonts.example/site.ttf", ".woff2", used)).toBe(
      "site.woff2",
    );
    expect(captureFontFilename("https://fonts.example/site.woff2", ".woff2", used)).toBe(
      "site-2.woff2",
    );
    expect(captureFontFilename("https://fonts.example/SITE.woff2", ".woff2", used)).toBe(
      "SITE-3.woff2",
    );
  });
  it("accepts the existing catalog WOFF2 font without changing its bytes", () => {
    expect(captureFontExtension(font)).toBe(".woff2");
    expect(captureFontFilename("https://fonts.example/font-0.woff2", ".woff2")).toBe(
      "font-0.woff2",
    );
  });

  it.each(["font.woff2:ads", "CON.woff2", "nul.extra.woff2", "LPT1.woff2", "bad%5Cname.woff2"])(
    "does not publish remote Windows-special filename %s",
    (name) => {
      const filename = captureFontFilename(`https://fonts.example/${name}`, ".woff2");
      const path = win32.join("C:\\capture\\assets\\fonts", filename);
      expect(filename).not.toMatch(/[:\\/]/);
      expect(filename).not.toMatch(/^(con|nul|prn|aux|com[1-9]|lpt[1-9])(?:\.|$)/i);
      expect(win32.dirname(path)).toBe("C:\\capture\\assets\\fonts");
    },
  );

  it("uses the validated extension regardless of URL suffix", () => {
    expect(captureFontFilename("https://fonts.example/site.ttf", ".woff2")).toBe("site.woff2");
  });

  it("rejects arbitrary bytes, truncated fonts, and oversized expansion declarations", () => {
    expect(captureFontExtension(Buffer.alloc(2048))).toBeNull();
    expect(captureFontExtension(font.subarray(0, 48))).toBeNull();
    const bomb = Buffer.from(font);
    bomb.writeUInt32BE(0xffffffff, 16);
    expect(captureFontExtension(bomb)).toBeNull();
  });
});
