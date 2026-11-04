import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Sources, mergeSnippets, fingerprint } from "../src/sources";
import { fingerprint as liveFingerprint } from "../src/live";
import { PREVIEW_IGNORED_DIRS } from "../../core/src/projectFolders";
import {
  bundleToSingleHtml,
  type BundleScriptProvenance,
} from "../../core/src/compiler/htmlBundler";

describe("source records", () => {
  it("ignores the generated folders Studio's preview signature ignores", () => {
    const dir = mkdtempSync(join(tmpdir(), "inspect-source-"));
    try {
      writeFileSync(join(dir, "index.html"), "<div></div>");
      const before = fingerprint(dir);
      for (const folder of PREVIEW_IGNORED_DIRS) {
        mkdirSync(join(dir, folder));
        writeFileSync(join(dir, folder, "peaks.json"), "[1,2,3]");
      }
      expect(fingerprint(dir)).toBe(before);
      writeFileSync(join(dir, "data.json"), "{}");
      expect(fingerprint(dir)).not.toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not change when only data-hf-id stamps are added to the html", () => {
    const dir = mkdtempSync(join(tmpdir(), "inspect-source-"));
    try {
      writeFileSync(join(dir, "index.html"), '<div class="a"><p>Hi</p></div>');
      const before = liveFingerprint(dir);
      const standaloneBefore = fingerprint(dir);
      writeFileSync(
        join(dir, "index.html"),
        '<div class="a" data-hf-id="hf-1a2b"><p data-hf-id=\'hf-3c4d\'>Hi</p></div>',
      );
      expect(liveFingerprint(dir)).toBe(before);
      expect(fingerprint(dir)).not.toBe(standaloneBefore);
      writeFileSync(join(dir, "index.html"), '<div class="b" data-hf-id="hf-1a2b"><p>Hi</p></div>');
      expect(liveFingerprint(dir)).not.toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps original multiline blocks and deduplicates targets without reformatting", () => {
    const dir = mkdtempSync(join(tmpdir(), "inspect-source-"));
    try {
      const text = 'const target = "#title";\nconst config = {\n  x: 100,\n  duration: 1\n};\n';
      writeFileSync(join(dir, "scene.js"), text);
      const source = new Sources(dir);
      const a = source.slice("scene.js", 24, text.length, "animation creation", 0)!;
      const b = source.slice("scene.js", 24, text.length, "animation creation", 1)!;
      const result = mergeSnippets([a, b], source);
      expect(result).toHaveLength(1);
      expect(result[0].targets).toEqual([0, 1]);
      expect(text.includes(result[0].code)).toBe(true);
      const before = fingerprint(dir);
      writeFileSync(join(dir, "scene.js"), text.replace("100", "150"));
      expect(fingerprint(dir)).not.toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("extracts raw-text elements with HTML-valid whitespace before the closing bracket", () => {
    const dir = mkdtempSync(join(tmpdir(), "inspect-raw-text-"));
    try {
      writeFileSync(
        join(dir, "index.html"),
        "<script>const marker = 1;</script \n><style>.marker { color: red; }</style\t>",
      );
      const source = new Sources(dir);
      expect(source.chunks.map((chunk) => chunk.text)).toContain("const marker = 1;");
      expect(source.cssRules.some((rule) => rule.selector === ".marker")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("opt-in compiler mapping keeps default HTML unchanged and concurrent maps isolated", async () => {
    const dirs = [0, 1].map(() => mkdtempSync(join(tmpdir(), "inspect-map-")));
    try {
      dirs.forEach((dir, i) =>
        writeFileSync(
          join(dir, "index.html"),
          `<!doctype html><html><head></head><body><div data-composition-id="root" data-start="0" data-duration="10" data-width="1920" data-height="1080"></div><script>const marker${i}=1; window.__timelines={};</script></body></html>`,
        ),
      );
      const outputs = await Promise.all(
        dirs.map(async (dir) => {
          const maps: BundleScriptProvenance[] = [];
          const plain = await bundleToSingleHtml(dir);
          const mapped = await bundleToSingleHtml(dir, { scriptProvenance: (p) => maps.push(p) });
          return { plain, mapped, maps };
        }),
      );
      outputs.forEach((output, i) => {
        expect(output.mapped.replace(/\n\/\/# sourceURL=hf-inspect-[a-f0-9]+\.js/g, "")).toBe(
          output.plain,
        );
        expect(output.plain).not.toContain("hf-inspect-");
        expect(output.maps.some((map) => map.input.includes(`marker${i}`))).toBe(true);
        expect(output.maps.some((map) => map.input.includes(`marker${1 - i}`))).toBe(false);
      });
    } finally {
      dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
    }
  });
  it("finds an element's tag before its served data-hf-id reaches the source", () => {
    const dir = mkdtempSync(join(tmpdir(), "inspect-source-"));
    try {
      writeFileSync(
        join(dir, "scene.html"),
        '<div data-composition-id="s"><span id="t" class="w">A</span><i class="dot"></i><i class="dot"></i></div>',
      );
      const source = new Sources(dir);
      const served = {
        ref: "r",
        tag: "span",
        id: "t",
        hfId: "hf-ab12",
        classes: ["w"],
        composition: "s",
      };
      expect(source.markup(served, 0)?.code).toContain('<span id="t" class="w">');
      const twin = { ...served, tag: "i", id: "", classes: ["dot"] };
      expect(source.markup(twin, 0)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("gives a caller inside a large wrapper as its call line, keeping the creation it encloses", () => {
    const dir = mkdtempSync(join(tmpdir(), "inspect-caller-"));
    try {
      const filler = Array.from({ length: 80 }, (_, n) => `  const step${n} = ${n} * 2;`).join(
        "\n",
      );
      const html = `<html><body><script>\n(function () {\n${filler}\n  gsap.to("#title", { x: 100 });\n})();\n</script></body></html>`;
      writeFileSync(join(dir, "index.html"), html);
      const lines = html.split("\n");
      const at = (text: string) => lines.findIndex((line) => line.includes(text)) + 1;
      const stack = [
        `at http://127.0.0.1:4000/index.html:${at("gsap.to")}:3`,
        `at http://127.0.0.1:4000/index.html:${at("})();")}:1`,
      ].join("\n");
      const [creation, caller, ...rest] = new Sources(dir).mapper(html, [])(stack, 0);
      expect(creation.kind).toEqual(["animation creation"]);
      expect(creation.code.trim()).toBe('gsap.to("#title", { x: 100 });');
      expect(caller.kind).toEqual(["animation caller"]);
      expect(caller.code).toBe("})();\n");
      expect(rest).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("indexes only the files the inspected document was bundled from", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspect-served-"));
    try {
      mkdirSync(join(dir, "compositions"));
      mkdirSync(join(dir, "mockups"));
      writeFileSync(join(dir, "theme.css"), ".title { color: red; }\n");
      writeFileSync(
        join(dir, "index.html"),
        `<!doctype html><html><head><link rel="stylesheet" href="theme.css"></head><body><div id="stage" data-composition-id="root" data-start="0" data-duration="4" data-width="1920" data-height="1080"><h1 id="title" class="title">Hi</h1><div data-composition-id="scene" data-composition-src="compositions/scene.html" data-start="0" data-duration="2"></div></div><script>window.__timelines={};</script></body></html>`,
      );
      writeFileSync(
        join(dir, "compositions/scene.html"),
        `<template id="scene-template"><div data-composition-id="scene" data-width="1920" data-height="1080"><p class="line">Yo</p><style>.line { font-size: 40px; }</style></div></template>`,
      );
      writeFileSync(
        join(dir, "mockups/a.html"),
        `<style>.title { color: green; }</style><h1 id="title" class="title">Mock</h1><script>const mock = 1;</script>`,
      );
      const reads: string[] = [];
      await bundleToSingleHtml(dir, { onRead: (path) => reads.push(path) });
      const files = (sources: Sources) =>
        [...new Set(sources.cssRules.map((rule) => rule.file))].sort();
      expect(files(new Sources(dir))).toEqual([
        "compositions/scene.html",
        "mockups/a.html",
        "theme.css",
      ]);
      const served = new Sources(dir, reads);
      expect(files(served)).toEqual(["compositions/scene.html", "theme.css"]);
      expect(served.chunks.some((chunk) => chunk.file === "mockups/a.html")).toBe(false);
      const title = {
        ref: "r",
        tag: "h1",
        id: "title",
        hfId: null,
        classes: ["title"],
        composition: "root",
      };
      expect(new Sources(dir).markup(title, 0)).toBeNull();
      expect(served.markup(title, 0)?.file).toBe("index.html");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
