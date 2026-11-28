import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { ensureDOMParser } from "../utils/dom.js";
import compositions, { parseCompositions, parseSubComposition } from "./compositions.js";

describe("parseCompositions", () => {
  beforeEach(() => {
    ensureDOMParser();
  });

  it.each([
    { declared: "8", child: "2", expected: 8 },
    { declared: "2.5", child: "7", expected: 2.5 },
    { declared: "3", child: null, expected: 3 },
  ])("honors the declared inline duration $declared", ({ declared, child, expected }) => {
    const html = `<div data-composition-id="host" data-duration="${declared}">
      ${child === null ? "" : `<div class="clip" data-start="0" data-duration="${child}"></div>`}
    </div>`;

    expect(parseCompositions(html, ".")[0]?.duration).toBe(expected);
  });

  it.each([null, "0", "-1", "Infinity", "invalid", "4junk"])(
    "derives the inline duration when %s is not a valid declared duration",
    (declared) => {
      const html = `<div data-composition-id="host" ${declared === null ? "" : `data-duration="${declared}"`}>
        <div class="clip" data-start="1" data-duration="2"></div>
      </div>`;

      expect(parseCompositions(html, ".")[0]?.duration).toBe(3);
    },
  );

  it.each(["wide", "0", "-1", "Infinity"])(
    "falls back to the default size when data-width is %s",
    (value) => {
      const html = `<div data-composition-id="host" data-width="${value}" data-height="${value}"></div>`;

      expect(parseCompositions(html, ".")[0]).toMatchObject({ width: 1920, height: 1080 });
    },
  );

  it("resolves relative sub-composition starts when computing host duration", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hyperframes-compositions-"));

    try {
      const compositionsDir = join(baseDir, "compositions");
      mkdirSync(compositionsDir);

      const subCompositionHtml = `
<template id="scene-template">
  <div data-composition-id="scene" data-width="1920" data-height="1080" data-duration="3">
    <div class="clip" data-start="0" data-duration="3"></div>
  </div>
</template>`;
      writeFileSync(join(compositionsDir, "scene.html"), subCompositionHtml);

      const html = `
<div data-composition-id="host" data-width="1920" data-height="1080">
  <div id="s1" data-composition-id="s1" data-composition-src="compositions/scene.html" data-start="0" data-duration="3" data-track="main"></div>
  <div data-composition-id="s2" data-composition-src="compositions/scene.html" data-start="s1" data-duration="3" data-track="main"></div>
</div>`;

      const host = parseCompositions(html, baseDir).find(
        (composition) => composition.id === "host",
      );

      expect(host?.duration).toBe(6);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe("parseSubComposition", () => {
  beforeEach(() => {
    ensureDOMParser();
  });

  it.each([false, true])(
    "honors an external composition trim with a template wrapper: %s",
    (wrapped) => {
      const content = `<div data-composition-id="scene" data-duration="2.5">
        <div class="clip" data-start="0" data-duration="7"></div>
      </div>`;
      const html = wrapped ? `<template>${content}</template>` : content;

      expect(parseSubComposition(html, "fallback", 1920, 1080).duration).toBe(2.5);
    },
  );

  it.each(["0", "-1", "Infinity", "invalid", "4junk"])(
    "derives the external duration when %s is not a valid declared duration",
    (declared) => {
      const html = `<template><div data-composition-id="scene" data-duration="${declared}">
        <div class="clip" data-start="1" data-duration="2"></div>
      </div></template>`;

      expect(parseSubComposition(html, "fallback", 1920, 1080).duration).toBe(3);
    },
  );

  it.each(["wide", "0", "-1", "Infinity"])(
    "falls back to the parent size when sub-composition data-width is %s",
    (value) => {
      const html = `<template><div data-composition-id="scene" data-width="${value}" data-height="${value}"></div></template>`;

      expect(parseSubComposition(html, "fallback", 1280, 720)).toMatchObject({
        width: 1280,
        height: 720,
      });
    },
  );

  it("reads template-wrapped sub-composition contents", () => {
    const html = `
<template id="foo-template">
  <div data-composition-id="foo" data-width="1920" data-height="1080" data-duration="1.5">
    <div class="clip" data-start="0" data-duration="1.5"></div>
  </div>
</template>`;

    expect(parseSubComposition(html, "foo", 1280, 720)).toEqual({
      id: "foo",
      duration: 1.5,
      width: 1920,
      height: 1080,
      elementCount: 1,
    });
  });

  it("counts visual-only template content and estimates simple script durations", () => {
    const html = `
<template id="foo-template">
  <div data-composition-id="foo" data-width="1920" data-height="1080">
    <div class="foo-bg" style="position:absolute;inset:0;background:#f00;"></div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.fromTo(".foo-bg", { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0);
      window.__timelines["foo"] = tl;
    </script>
  </div>
</template>`;

    expect(parseSubComposition(html, "foo", 1280, 720)).toEqual({
      id: "foo",
      duration: 0.5,
      width: 1920,
      height: 1080,
      elementCount: 1,
    });
  });

  it("treats a data-composition-src that points at a folder as inline instead of crashing", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hyperframes-compositions-"));

    try {
      mkdirSync(join(baseDir, "compositions", "intro"), { recursive: true });
      const html = `<div data-composition-id="intro" data-composition-src="compositions/intro" data-width="1920" data-height="1080"></div>`;

      expect(parseCompositions(html, baseDir)).toMatchObject([{ id: "intro" }]);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe("compositions on a terminal", () => {
  // Windows refuses control characters in folder names.
  it.skipIf(process.platform === "win32")(
    "prints a folder name with control characters as visible escapes",
    async () => {
      // Built rather than written: a literal control character in the source is a lint error.
      const esc = String.fromCharCode(27);
      const parent = mkdtempSync(join(tmpdir(), "hf-compositions-"));
      const dir = join(parent, `video${esc}]0;x${String.fromCharCode(7)}${esc}[2J`);
      mkdirSync(dir);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        for (const html of ["<div></div>", '<div data-composition-id="main"></div>']) {
          writeFileSync(join(dir, "index.html"), html);
          log.mockClear();
          await compositions.run?.({
            args: { _: [], dir, json: false },
            rawArgs: [],
            cmd: compositions,
          });
          const human = log.mock.calls.map((call) => call.join(" ")).join("\n");

          expect(human.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "")).not.toContain(esc);
          expect(human).toContain("video\\x1b]0;x\\x07\\x1b[2J");
        }
      } finally {
        log.mockRestore();
        rmSync(parent, { recursive: true, force: true });
      }
    },
  );
});
