// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { SCENE_PART_ATTR } from "../sceneParts";
import { bundleToSingleHtml } from "./htmlBundler";
import { AFTER_FONTS_SCRIPT_TYPE } from "./scriptRuns";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-bundle-repeats-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

const page = (scripts: string) => `<!doctype html><html><body>
<div data-composition-id="main" data-width="320" data-height="180" data-start="0" data-duration="2"></div>
<script>window.__timelines = {};</script>
${scripts}
</body></html>`;

const tags = (count: number, src: (i: number) => string) =>
  Array.from({ length: count }, (_, i) => `<script src="${src(i)}"></script>`).join("\n");

// Studio's preview build: the lint pass (staticGuard) is off there, and slow on such pages on its own.
const PREVIEW = { inlineAssets: false, staticGuard: false, sceneParts: true } as const;
const FOUR_MIB = 4 * 1024 * 1024;
const MIB = 1024 * 1024;

describe("a page naming one script in thousands of tags", () => {
  it("reads and inlines a 4 MiB script once for 3,000 tags", { timeout: 20_000 }, async () => {
    const body = `window.big = (window.big || 0) + 1; //${"x".repeat(FOUR_MIB)}`;
    const dir = project({ "index.html": page(tags(3_000, () => "big.js")), "big.js": body });
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();

    const html = await bundleToSingleHtml(dir, PREVIEW);

    expect(performance.now() - started).toBeLessThan(10_000);
    expect(process.memoryUsage().heapUsed - heapBefore).toBeLessThan(256 * MIB);
    expect(html.split("window.big = ").length - 1).toBe(1);
    expect(html.length).toBeLessThan(FOUR_MIB + MIB);
  });

  it(
    "bundles 30,000 tags naming a missing script in bounded time",
    { timeout: 20_000 },
    async () => {
      const dir = project({ "index.html": page(tags(30_000, () => "missing.js")) });
      const started = performance.now();

      const html = await bundleToSingleHtml(dir, PREVIEW);

      expect(performance.now() - started).toBeLessThan(10_000);
      const { document } = parseHTML(html);
      expect(document.querySelectorAll('script[src="missing.js"]')).toHaveLength(30_000);
    },
  );

  it("inlines a file once whatever spelling each tag uses", async () => {
    const spellings = ["a.js", "./a.js", "sub/../a.js", "a.js"];
    const dir = project({
      "index.html": page(tags(spellings.length, (i) => spellings[i]!) + tags(1, () => "b.js")),
      "a.js": "window.a = (window.a || 0) + 1;",
      "b.js": "window.b = 1;",
    });

    const html = await bundleToSingleHtml(dir, PREVIEW);

    expect(html.split("window.a = ").length - 1).toBe(1);
    expect(html).toContain("window.b = 1;");
    expect(html.indexOf("window.a = ")).toBeLessThan(html.indexOf("window.b = 1;"));
  });

  it(
    "keeps every tag of a pinned script external, checking the page once",
    { timeout: 20_000 },
    async () => {
      const dir = project({
        "index.html": page(
          tags(1, () => "pinned.js").replace("></script>", ' integrity="sha384-YQ=="></script>') +
            tags(20_000, () => "pinned.js"),
        ),
        "pinned.js": "window.pinned = 1;",
      });
      const started = performance.now();

      const html = await bundleToSingleHtml(dir, PREVIEW);

      expect(performance.now() - started).toBeLessThan(10_000);
      expect(html).not.toContain("window.pinned = 1;");
      const { document } = parseHTML(html);
      const pinned = [...document.querySelectorAll('script[src="pinned.js"]')];
      expect(pinned).toHaveLength(20_001);
      for (const el of pinned) expect(el.getAttribute("integrity")).toBe("sha384-YQ==");
    },
  );

  it(
    "keeps 20,000 pinned tags of one script external in bounded time",
    { timeout: 20_000 },
    async () => {
      const dir = project({
        "index.html": page(
          tags(20_000, () => "pinned.js").replaceAll(
            "></script>",
            ' integrity="sha384-YQ==" crossorigin="anonymous"></script>',
          ),
        ),
        "pinned.js": "window.pinned = 1;",
      });
      const started = performance.now();

      const html = await bundleToSingleHtml(dir, PREVIEW);

      expect(performance.now() - started).toBeLessThan(10_000);
      expect(html).not.toContain("window.pinned = 1;");
      const { document } = parseHTML(html);
      expect(document.querySelectorAll('script[src="pinned.js"][integrity]')).toHaveLength(20_000);
    },
  );

  it("inlines a composition script once whatever spelling each scene uses", async () => {
    const host = (id: string, start: number, src = "") =>
      `<div data-composition-id="${id}"${src && ` data-composition-src="${src}"`} data-start="${start}" data-duration="1"></div>`;
    const sceneBody = (id: string, src: string) =>
      `<div data-composition-id="${id}" data-width="320" data-height="180"><script src="${src}"></script></div>`;
    const dir = project({
      "index.html": `<!doctype html><html><body>
<div data-composition-id="main" data-width="320" data-height="180" data-start="0" data-duration="3">
${host("a", 0, "a.html")}${host("b", 1, "b.html")}${host("c", 2)}
</div>
<template id="c-template">${sceneBody("c", "./lib.js")}</template>
<script>window.__timelines = {};</script>
</body></html>`,
      "a.html": `<template>${sceneBody("a", "lib.js")}</template>`,
      "b.html": `<template>${sceneBody("b", "l%69b.js")}</template>`,
      "lib.js": "window.lib = (window.lib || 0) + 1;",
    });

    const html = await bundleToSingleHtml(dir, PREVIEW);

    expect(html.split("window.lib = ").length - 1).toBe(1);
    const { document } = parseHTML(html);
    const lib = [...document.querySelectorAll("script")].find((el) =>
      el.textContent?.includes("window.lib = "),
    );
    // Both scenes name it, so it runs for the film, not inside one scene's part.
    expect(lib?.getAttribute(SCENE_PART_ATTR)).toBeNull();
  });

  it.each([
    ["nomodule", '<script nomodule src="a.js"></script>'],
    ["data block", '<script type="text/plain" src="a.js"></script>'],
  ])("keeps the regular script after a %s tag naming the same file", async (_, first) => {
    const dir = project({
      "index.html": page(`${first}\n<script src="a.js"></script>`),
      "a.js": "window.a = 1;",
    });

    const html = await bundleToSingleHtml(dir, PREVIEW);

    const { document } = parseHTML(html);
    const copies = [...document.querySelectorAll("script")].filter((el) =>
      el.textContent?.includes("window.a = 1;"),
    );
    expect(copies).toHaveLength(2);
    const runs = (el: Element) =>
      !el.hasAttribute("nomodule") && el.getAttribute("type") === AFTER_FONTS_SCRIPT_TYPE;
    expect(copies.some(runs)).toBe(true);
  });

  it(
    "carries a pin to 20,000 spellings of its file in bounded time",
    { timeout: 20_000 },
    async () => {
      const dir = project({
        "index.html": page(
          '<script src="pinned.js" integrity="sha384-YQ=="></script>\n' +
            tags(20_000, (i) => `pinned.js?v=${i}`),
        ),
        "pinned.js": "window.pinned = 1;",
      });
      const started = performance.now();

      const html = await bundleToSingleHtml(dir, PREVIEW);

      expect(performance.now() - started).toBeLessThan(10_000);
      expect(html).not.toContain("window.pinned = 1;");
      const { document } = parseHTML(html);
      expect(document.querySelectorAll('script[src^="pinned.js"][integrity]')).toHaveLength(20_001);
    },
  );
});
