// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it } from "vitest";
import { AFTER_FONTS_SCRIPT_TYPE } from "@hyperframes/core/compiler";
import { compileForRender } from "./htmlCompiler.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-module-scripts-"));
  tempDirs.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const path = join(dir, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

describe("compileForRender mounted module scripts", () => {
  it("compiles mounted import maps without unblocking non-string addresses", async () => {
    const dir = project({
      "index.html":
        '<!doctype html><html><head></head><body><div data-composition-id="root" data-width="320" data-height="180"><div data-composition-id="blk" data-composition-src="blocks/blk.html" data-start="0" data-duration="2"></div></div></body></html>',
      "blocks/ok.js": "export const VALUE = 1;",
      "blocks/blk.html":
        '<div data-composition-id="blk" data-width="320" data-height="180"><script type="importmap">{"imports":{"ok":"./ok.js","blocked":null,"number":17,"constructor":"./ok.js","__proto__":"./ok.js"}}</script><script type="module">import "ok";</script></div>',
    });
    const { html } = await compileForRender(dir, join(dir, "index.html"), join(dir, ".downloads"), {
      allowSystemFontCapture: false,
    });
    const { document } = parseHTML(html);
    expect(
      JSON.parse(document.querySelector('script[type="importmap"]')?.textContent || "null"),
    ).toEqual({
      imports: Object.fromEntries([
        ["ok", "./blocks/ok.js"],
        ["blocked", null],
        ["number", null],
        ["constructor", "./blocks/ok.js"],
        ["__proto__", "./blocks/ok.js"],
      ]),
    });
    expect(
      document.querySelector(`script[type="${AFTER_FONTS_SCRIPT_TYPE}+module"]`),
    ).not.toBeNull();
  });

  it("keeps a mounted file's import map and module script as such, bound to that file", async () => {
    const dir = project({
      "index.html": `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="320" data-height="180">
    <div data-composition-id="blk" data-composition-src="compositions/blk/blk.html"
      data-start="0" data-duration="2"></div>
  </div>
</body></html>`,
      "compositions/blk/assets/three.js": "export const REVISION = 1;",
      "compositions/blk/assets/scene.js": 'import * as THREE from "three"; export const SCENE = 1;',
      "compositions/blk/blk.html": `<div data-composition-id="blk" data-width="320" data-height="180">
  <script type="module" src="./assets/scene.js"></script>
  <script type="importmap">{ "imports": { "three": "./assets/three.js" } }</script>
  <script type="module">import * as THREE from "three"; window.__url = __hyperframes.assetUrl("assets/leaf.webp");</script>
</div>`,
    });
    const { html } = await compileForRender(dir, join(dir, "index.html"), join(dir, ".downloads"), {
      allowSystemFontCapture: false,
    });
    const { document } = parseHTML(html);
    const importMap = document.querySelector('script[type="importmap"]');
    // Deferred until fonts: the runtime runs each as the type its marker names.
    const modules = [
      ...document.querySelectorAll(`script[type="${AFTER_FONTS_SCRIPT_TYPE}+module"]`),
    ];
    const classic = [...document.querySelectorAll(`script[type="${AFTER_FONTS_SCRIPT_TYPE}"]`)].map(
      (s) => s.textContent,
    );

    expect(JSON.parse(importMap?.textContent || "null")).toEqual({
      imports: { three: "./compositions/blk/assets/three.js" },
    });
    expect(modules.map((m) => m.getAttribute("src")).filter(Boolean)).toEqual([
      "compositions/blk/assets/scene.js",
    ]);
    const inline = modules.filter((m) => !m.hasAttribute("src"));
    expect(inline).toHaveLength(1);
    expect(inline[0]!.textContent).toMatch(/^const __hyperframes = /);
    expect(inline[0]!.textContent).toContain('"compositions/blk/blk.html"');
    expect(classic.join("")).not.toContain("SCENE");
    expect(classic.join("")).not.toContain('"imports"');
    expect(classic.join("")).not.toContain("import * as THREE");
  });
});
