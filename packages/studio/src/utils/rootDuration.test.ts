// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  extendRootDurationInSource,
  findRootOpenTag,
  patchRootCompositionDuration,
  readRootCompositionDuration,
} from "./rootDuration";
import { furthestClipEndFromSource } from "../player/lib/timelineElementHelpers";

// What the HTML parser reads as no comment, or as one that ends before the root.
const unreadPrefixes = {
  "an unclosed comment in a script string": `<script>var open = "<!--";</script>`,
  "an unclosed comment in a style": `<style>/* <!-- */</style>`,
  "<!-->": `<!-->`,
  "<!--->": `<!--->`,
  "a comment closed by --!>": `<!-- old --!>`,
};
const withSceneAfter = (prefix: string) =>
  [
    prefix,
    `<div id="root" data-composition-id="main" data-duration="3">`,
    `  <!-- clips -->`,
    `  <div id="s" data-composition-id="scene" data-start="0" data-duration="1"></div>`,
    `</div>`,
  ].join("\n");

const registryScene = (length: string) =>
  [
    `<!doctype html>`,
    `<html lang="en" data-composition-id="card" data-composition-duration="4">`,
    `<body><template>`,
    `<div data-composition-id="card" data-duration="${length}">`,
    `  <div data-start="1" data-duration="5"></div>`,
    `</div>`,
    `</template></body></html>`,
  ].join("\n");

describe("extendRootDurationInSource", () => {
  it("extends data-duration when the new end is bigger than the root duration", () => {
    const source = [
      `<div data-composition-id="main" data-duration="4">`,
      `  <section id="clip" data-start="2" data-duration="3"></section>`,
      `</div>`,
    ].join("\n");

    expect(extendRootDurationInSource(source, 5.25)).toContain(
      `data-composition-id="main" data-duration="5.25"`,
    );
  });

  it("does nothing when the new end is smaller than or equal to the root duration", () => {
    const source = `<div data-composition-id="main" data-duration="6"></div>`;

    expect(extendRootDurationInSource(source, 5)).toBe(source);
    expect(extendRootDurationInSource(source, 6)).toBe(source);
  });

  it("leaves non-root data-duration attributes untouched by the extension", () => {
    const source = [
      `<div data-duration="3"></div>`,
      `<div data-composition-id="main" data-duration="4"></div>`,
    ].join("\n");
    const patched = extendRootDurationInSource(source, 7);

    expect(patched).toContain(`<div data-duration="3"></div>`);
    expect(patched).toContain(`<div data-composition-id="main" data-duration="7"></div>`);
  });

  // Reviewer round-2 finding #3: the old regex was attribute-ORDER-dependent and
  // double-quotes-only, so these hand-authored variants silently no-op'd.
  it("extends when data-duration is declared BEFORE data-composition-id", () => {
    const source = `<div data-duration="4" data-composition-id="main"></div>`;
    expect(extendRootDurationInSource(source, 9)).toBe(
      `<div data-duration="9" data-composition-id="main"></div>`,
    );
  });

  it("extends when attributes use single quotes", () => {
    const source = `<div data-composition-id='main' data-duration='4'></div>`;
    expect(extendRootDurationInSource(source, 9)).toBe(
      `<div data-composition-id='main' data-duration='9'></div>`,
    );
  });

  it("extends with swapped order AND single quotes AND extra whitespace", () => {
    const source = `<div  data-duration = '4'  data-composition-id = 'main' >x</div>`;
    expect(extendRootDurationInSource(source, 9)).toBe(
      `<div  data-duration = '9'  data-composition-id = 'main' >x</div>`,
    );
  });
});

describe("readRootCompositionDuration", () => {
  it("reads the root duration regardless of attribute order or quote style", () => {
    expect(
      readRootCompositionDuration(`<div data-composition-id="main" data-duration="4"></div>`),
    ).toBe(4);
    expect(
      readRootCompositionDuration(`<div data-duration="4" data-composition-id="main"></div>`),
    ).toBe(4);
    expect(
      readRootCompositionDuration(`<div data-composition-id='main' data-duration='4.5'></div>`),
    ).toBe(4.5);
  });

  it("reads the FIRST composition when several are present", () => {
    const source = [
      `<div data-composition-id="root" data-duration="10"></div>`,
      `<div data-composition-id="nested" data-duration="2"></div>`,
    ].join("\n");
    expect(readRootCompositionDuration(source)).toBe(10);
  });

  it("returns null when there is no composition root", () => {
    expect(readRootCompositionDuration(`<div data-duration="4"></div>`)).toBeNull();
  });

  it("returns null when the root has no data-duration attribute", () => {
    expect(readRootCompositionDuration(`<div data-composition-id="main"></div>`)).toBeNull();
  });

  it("reads a scene file's root inside its <template>", () => {
    const scene = `<template><div data-composition-id="scene" data-duration="5"></div></template>`;
    expect(readRootCompositionDuration(scene)).toBe(5);
  });

  it("reads a registry scene's root and clips inside the template its <html> wraps", () => {
    expect(readRootCompositionDuration(registryScene("4"))).toBe(4);
    expect(furthestClipEndFromSource(registryScene("4"))).toBe(6);
  });
});

describe("furthestClipEndFromSource", () => {
  it("counts the clips of a <meta> root, and a nested scene by its host", () => {
    const source = [
      `<meta data-composition-id="main">`,
      `<div data-start="1" data-duration="5"></div>`,
      `<div data-composition-id="scene" data-start="0" data-duration="3">`,
      `  <div data-start="0" data-duration="9"></div>`,
      `</div>`,
    ].join("\n");
    expect(furthestClipEndFromSource(source)).toBe(6);
  });
});

describe("patchRootCompositionDuration", () => {
  it("rewrites only the root's data-duration value, preserving surrounding bytes", () => {
    const source = [
      `<!doctype html>`,
      `<div data-composition-id="main" data-duration="4" data-width="640">`,
      `  <img src="a.png" data-duration="3" />`,
      `</div>`,
    ].join("\n");
    const patched = patchRootCompositionDuration(source, "8");
    expect(patched).toBe(
      [
        `<!doctype html>`,
        `<div data-composition-id="main" data-duration="8" data-width="640">`,
        `  <img src="a.png" data-duration="3" />`,
        `</div>`,
      ].join("\n"),
    );
  });

  it("keeps single-quote style when rewriting", () => {
    expect(
      patchRootCompositionDuration(`<div data-composition-id='main' data-duration='4'></div>`, "8"),
    ).toBe(`<div data-composition-id='main' data-duration='8'></div>`);
  });

  it("skips a comment that names or holds a composition", () => {
    const source = [
      `<!-- REQUIRED: data-composition-id identifies this composition. -->`,
      `<!-- <div data-composition-id="old" data-duration="2"> -->`,
      `<template><div data-composition-id="main" data-duration="8"></div></template>`,
    ].join("\n");
    expect(patchRootCompositionDuration(source, "10")).toBe(
      source.replace(`data-duration="8"`, `data-duration="10"`),
    );
  });

  it("skips a comment holding a > before the composition it names", () => {
    const source = [
      `<!-- if a > b: <div data-composition-id="old" data-duration="9"> -->`,
      `<div data-composition-id="main" data-duration="4"></div>`,
    ].join("\n");
    expect(patchRootCompositionDuration(source, "8")).toBe(source.replace(`"4"`, `"8"`));
  });

  for (const [name, prefix] of Object.entries(unreadPrefixes)) {
    it(`patches the root the reader reads after ${name}`, () => {
      const source = withSceneAfter(prefix);
      expect(readRootCompositionDuration(source)).toBe(3);
      expect(patchRootCompositionDuration(source, "2")).toBe(
        source.replace(`data-duration="3"`, `data-duration="2"`),
      );
    });
  }

  it("finds no root after an unclosed comment or script, as the reader finds none", () => {
    for (const prefix of ["<!--", "<script>"]) {
      const source = `${prefix}\n<div data-composition-id="main" data-duration="3"></div>`;
      expect(readRootCompositionDuration(source)).toBeNull();
      expect(findRootOpenTag(source)).toBeNull();
    }
  });

  it("scans 2 MB of stray tags and an unclosed comment in linear time", () => {
    const inputs = ["<".repeat(1_000_000) + "<!--" + "<a".repeat(500_000), "<a".repeat(1_000_000)];
    const start = performance.now();
    for (const input of inputs) expect(findRootOpenTag(input)).toBeNull();
    expect(performance.now() - start).toBeLessThan(200);
  });

  it("patches a registry scene's root inside its template, the one the reader reads", () => {
    expect(extendRootDurationInSource(registryScene("4"), 6)).toBe(registryScene("6"));
  });

  it("patches an <html> root when there is no template", () => {
    const source = `<html data-composition-id="main" data-duration="4"><body></body></html>`;
    expect(patchRootCompositionDuration(source, "8")).toBe(source.replace(`"4"`, `"8"`));
  });

  it("is a no-op when the root has no data-duration attribute", () => {
    const source = `<div data-composition-id="main"></div>`;
    expect(patchRootCompositionDuration(source, "8")).toBe(source);
  });
});
