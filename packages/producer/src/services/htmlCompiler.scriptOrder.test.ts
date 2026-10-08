// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { AFTER_FONTS_SCRIPT_TYPE } from "@hyperframes/core/compiler";
import { compileForRender } from "./htmlCompiler.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-script-order-"));
  tempDirs.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const path = join(dir, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

// The shape glass-shard-title ships: inline setup, a local src script that reads it, inline tail.
const INDEX = `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="320" data-height="180"></div>
  <script>window.MARK_BEFORE = 1;</script>
  <script src="assets/needs-before.js"></script>
  <script>window.MARK_AFTER = 1;</script>
</body></html>`;

describe("compileForRender script order", () => {
  it("does not move an inline script past the src script that follows it", async () => {
    const dir = project({ "index.html": INDEX, "assets/needs-before.js": "void 0;" });
    const { html } = await compileForRender(dir, join(dir, "index.html"), join(dir, ".downloads"), {
      allowSystemFontCapture: false,
    });
    const before = html.indexOf("MARK_BEFORE");
    const lib = html.indexOf("assets/needs-before.js");
    const after = html.indexOf("MARK_AFTER");
    expect(before).toBeGreaterThan(-1);
    expect(before).toBeLessThan(lib);
    expect(lib).toBeLessThan(after);
  });

  it("keeps a mounted composition's local src script between the inline scripts around it", async () => {
    const dir = project({
      "index.html": `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="320" data-height="180">
    <div id="block" data-composition-id="block" data-composition-src="compositions/block/block.html" data-width="320" data-height="180"></div>
  </div>
</body></html>`,
      "compositions/block/block.html": `<!doctype html>
<html><body>
  <div data-composition-id="block" data-width="320" data-height="180"></div>
  <script>window.MARK_BEFORE = 1;</script>
  <script src="assets/needs-before.js"></script>
  <script>window.MARK_AFTER = 1;</script>
</body></html>`,
      "compositions/block/assets/needs-before.js": "void 0;",
    });
    const { html } = await compileForRender(dir, join(dir, "index.html"), join(dir, ".downloads"), {
      allowSystemFontCapture: false,
    });
    const before = html.indexOf("MARK_BEFORE");
    const lib = html.indexOf("compositions/block/assets/needs-before.js");
    const after = html.indexOf("MARK_AFTER");
    expect(before).toBeGreaterThan(-1);
    expect(lib).toBeGreaterThan(-1);
    expect(before).toBeLessThan(lib);
    expect(lib).toBeLessThan(after);
  });

  it("still runs a mounted composition's CDN script before its inline scripts", async () => {
    vi.stubGlobal("fetch", async () => new Response("window.CDN_LIB = 1;"));
    const dir = project({
      "index.html": `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="320" data-height="180">
    <div id="block" data-composition-id="block" data-composition-src="compositions/block/block.html" data-width="320" data-height="180"></div>
  </div>
</body></html>`,
      "compositions/block/block.html": `<!doctype html>
<html><body>
  <div data-composition-id="block" data-width="320" data-height="180"></div>
  <script>window.MARK_BEFORE = window.CDN_LIB;</script>
  <script src="https://cdn.example/lib.js"></script>
</body></html>`,
    });
    const { html } = await compileForRender(dir, join(dir, "index.html"), join(dir, ".downloads"), {
      allowSystemFontCapture: false,
    });
    const lib = html.indexOf("window.CDN_LIB = 1");
    const before = html.indexOf("MARK_BEFORE");
    expect(lib).toBeGreaterThan(-1);
    expect(lib).toBeLessThan(before);
  });

  it("defers every body script it emits until fonts, the position edit script and CDN libraries too", async () => {
    vi.stubGlobal("fetch", async () => new Response("window.CDN_LIB = 1;"));
    const dir = project({
      "index.html": `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="320" data-height="180">
    <div id="block" data-composition-id="block" data-composition-src="compositions/block/block.html" data-width="320" data-height="180"></div>
    <div id="moved" data-hf-studio-path-offset="true"></div>
  </div>
  <script>window.ROOT_SCRIPT = 1;</script>
  <script src="assets/needs-before.js"></script>
</body></html>`,
      "assets/needs-before.js": "void 0;",
      "compositions/block/block.html": `<!doctype html>
<html><body>
  <div data-composition-id="block" data-width="320" data-height="180"></div>
  <script src="https://cdn.example/lib.js"></script>
  <script>window.BLOCK_SCRIPT = 1;</script>
</body></html>`,
    });
    const { html } = await compileForRender(dir, join(dir, "index.html"), join(dir, ".downloads"), {
      allowSystemFontCapture: false,
    });
    const { document } = parseHTML(html);
    const body = [...document.querySelectorAll("body script")];
    const deferred = [...document.querySelectorAll(`script[type="${AFTER_FONTS_SCRIPT_TYPE}"]`)];
    expect(deferred).toEqual(body);
    const text = deferred.map((el) => el.getAttribute("src") ?? el.textContent ?? "");
    for (const mark of [
      "ROOT_SCRIPT",
      "needs-before.js",
      "CDN_LIB",
      "BLOCK_SCRIPT",
      "data-hf-studio-path-offset",
    ]) {
      expect(text.some((t) => t.includes(mark))).toBe(true);
    }
  });

  describe("composition scripts that are not JavaScript", () => {
    const scene = (id: string, extra: string) => `<template id="${id}-template">
<div data-composition-id="${id}" data-width="320" data-height="180" data-duration="2">
  ${extra}
  <script>window.__timelines = window.__timelines || {}; window.__timelines.${id} = 1;</script>
</div></template>`;

    async function compileFilm(sceneExtra: string) {
      const dir = project({
        "index.html": `<!doctype html>
<html><body>
  <div id="root" data-composition-id="main" data-width="320" data-height="180" data-duration="4">
    <div data-composition-id="intro" data-composition-src="compositions/intro.html" data-start="0" data-duration="2"></div>
    <div data-composition-id="scene" data-composition-src="compositions/scene.html" data-start="2" data-duration="2"></div>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines.main = 1;</script>
</body></html>`,
        "compositions/intro.html": scene("intro", ""),
        "compositions/scene.html": scene("scene", sceneExtra),
      });
      const { html } = await compileForRender(
        dir,
        join(dir, "index.html"),
        join(dir, ".downloads"),
        {
          allowSystemFontCapture: false,
        },
      );
      return parseHTML(html).document;
    }

    const runnable = (document: Document) => [
      ...document.querySelectorAll(`body script[type="${AFTER_FONTS_SCRIPT_TYPE}"]:not([src])`),
    ];
    const parses = (el: Element) => {
      try {
        new Function(el.textContent ?? "");
        return true;
      } catch {
        return false;
      }
    };
    const timelinesThatRun = (document: Document) =>
      ["main", "intro", "scene"].filter((id) =>
        runnable(document).some(
          (el) => parses(el) && (el.textContent ?? "").includes(`__timelines.${id} =`),
        ),
      );

    it("keeps a sub-composition's JSON data script readable and out of the JavaScript", async () => {
      const document = await compileFilm(
        `<script type="application/json" id="meta">{"title": "x", "beats": [1, 2]}</script>`,
      );
      const meta = document.querySelector('script[type="application/json"]');
      expect(meta?.getAttribute("id")).toBe("meta");
      expect(JSON.parse(meta?.textContent ?? "")).toEqual({ title: "x", beats: [1, 2] });
      expect(runnable(document).every(parses)).toBe(true);
      expect(timelinesThatRun(document)).toEqual(["main", "intro", "scene"]);
    });

    it("keeps a sub-composition script that does not parse apart, so the others still run", async () => {
      const document = await compileFilm(`<script>window.broken = {:</script>`);
      const broken = runnable(document).filter((el) => !parses(el));
      expect(broken).toHaveLength(1);
      expect(broken[0]!.textContent).toContain("window.broken");
      expect(timelinesThatRun(document)).toEqual(["main", "intro", "scene"]);
    });
  });
});
