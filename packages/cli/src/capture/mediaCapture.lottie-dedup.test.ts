import AdmZip from "adm-zip";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveLottieAnimations } from "./mediaCapture.js";

function iconAnimation(color: number[]) {
  return {
    v: "5.12.2",
    fr: 30,
    ip: 0,
    op: 60,
    w: 80,
    h: 80,
    nm: "Icon",
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: "Icon",
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: { a: 0, k: [40, 40, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 0, k: [100, 100, 100] },
        },
        shapes: [
          { ty: "rc", d: 1, s: { a: 0, k: [60, 60] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 8 } },
          { ty: "fl", c: { a: 0, k: color }, o: { a: 0, k: 100 }, r: 1 },
        ],
        ip: 0,
        op: 60,
        st: 0,
        bm: 0,
      },
    ],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Lottie content deduplication", () => {
  it.each(["intercepted", "json", "archive"])(
    "keeps color variants and deduplicates exact copies from %s discovery",
    async (mode) => {
      const dir = mkdtempSync(join(tmpdir(), "hf-lottie-dedup-"));
      const icons = [iconAnimation([1, 0, 0, 1]), iconAnimation([0, 0, 1, 1])];
      const sources = icons.map((icon) => JSON.stringify(icon));
      expect(sources[0]?.slice(0, 200)).toBe(sources[1]?.slice(0, 200));
      const extension = mode === "archive" ? "lottie" : "json";
      const urls = [0, 1, 0].map((index, n) => `https://icons.example/${index}-${n}.${extension}`);
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const source = sources[url.includes("/1-") ? 1 : 0] ?? "";
          if (mode !== "archive") return new Response(source);
          const zip = new AdmZip();
          zip.addFile("a/icon.json", Buffer.from(source));
          return new Response(new Uint8Array(zip.toBuffer()));
        }),
      );

      try {
        const discovered = urls.map((url, n) => ({
          url,
          ...(mode === "intercepted" ? { data: icons[n === 1 ? 1 : 0] } : {}),
        }));
        expect(await saveLottieAnimations(discovered, dir, dir)).toBe(2);
        expect(readdirSync(dir).sort()).toEqual(["animation-0.json", "animation-1.json"]);
        for (let n = 0; n < sources.length; n++) {
          expect(readFileSync(join(dir, `animation-${n}.json`), "utf8")).toBe(sources[n]);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
