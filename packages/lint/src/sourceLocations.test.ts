import { describe, expect, it } from "vitest";
import { sourceLocationFor } from "./sourceLocations";
import { lintHyperframeHtml } from "./hyperframeLinter";
import type { HyperframeLintFinding } from "./types";
const finding = (fields: Partial<HyperframeLintFinding>): HyperframeLintFinding => ({
  code: "probe",
  severity: "error",
  message: "bad",
  ...fields,
});
describe("original source locations", () => {
  it("locates a tag after comments and a template wrapper", () => {
    const html = '<!--\n comment\n-->\n<template>\n  <div id="bad">x</div>\n</template>';
    expect(sourceLocationFor(html, finding({ elementId: "bad" }))).toEqual({ line: 5, column: 3 });
  });
  it("locates normalized CSS snippets across CRLF", () => {
    const html = "<style>\r\n  .bad {\r\n    position: fixed;\r\n  }\r\n</style>";
    expect(sourceLocationFor(html, finding({ snippet: ".bad { position: fixed; }" }))).toEqual({
      line: 2,
      column: 3,
    });
  });
  it("locates a script snippet", () => {
    expect(
      sourceLocationFor(
        '<script>\n  gsap.to("#x", { x: 1 });\n</script>',
        finding({ snippet: 'gsap.to("#x", { x: 1 });' }),
      ),
    ).toEqual({ line: 2, column: 3 });
  });
  it("does not invent a location for repeated snippets or global findings", () => {
    expect(
      sourceLocationFor("<div>x</div>\n<div>x</div>", finding({ snippet: "<div>x</div>" })),
    ).toEqual({});
    expect(sourceLocationFor("<html></html>", finding({}))).toEqual({});
  });
  it("does not use a commented-out id", () => {
    expect(
      sourceLocationFor('<!-- <div id="x"> -->\n<div id="x">', finding({ elementId: "x" })),
    ).toEqual({ line: 2, column: 1 });
  });
  it("attaches locations to real lint findings", async () => {
    const html =
      '<div data-composition-id="main" data-width="1920" data-height="1080" data-duration="3">\n  <div id="bad" class="clip" data-start="0">x</div>\n</div>';
    const r = await lintHyperframeHtml(html, { filePath: "index.html" });
    expect(r.findings.find((f) => f.code === "timeline_element_missing_timing")).toMatchObject({
      file: "index.html",
      line: 2,
      column: 3,
    });
  });
});

it("does not point synthesized code snippets at commented examples", () => {
  expect(
    sourceLocationFor(
      "<!-- p.getTotalLength() -->\n<script>p.getTotalLength( /* measure */ );</script>",
      finding({ snippet: "p.getTotalLength()" }),
    ),
  ).toEqual({});
});

describe("rule-owned source positions", () => {
  const shell = (content: string) =>
    `<div data-composition-id="main" data-width="1920" data-height="1080" data-duration="3">\n${content}\n</div>`;
  const at = (html: string, token: string) => {
    const offset = html.indexOf(token);
    const before = html.slice(0, offset);
    return {
      line: before.split(/\r\n|\r|\n/).length,
      column: offset - Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r")),
    };
  };
  it.each(["\n", "\r\n"])(
    "locates the offending JS expression through comments and templates (%j)",
    async (nl) => {
      const html = (
        `<!--\n😀 header\n-->\n<template>\n` +
        shell(
          "<script>\nconst before = 1;\n// Math.random()\n\nconst x = Math.random();\n</script>",
        ) +
        "\n</template>"
      ).replaceAll("\n", nl);
      const result = await lintHyperframeHtml(html);
      expect(result.findings.find((f) => f.code === "non_deterministic_code")).toMatchObject(
        at(html, "Math.random();"),
      );
    },
  );
  it("locates an Acorn syntax error rather than the script prefix", async () => {
    const html = shell("<script>\nconst before = 1;\n\nconst broken = ;\n</script>");
    const result = await lintHyperframeHtml(html);
    expect(result.findings.find((f) => f.code === "invalid_inline_script_syntax")).toMatchObject(
      at(html, ";\n</script>"),
    );
  });
  it("maps CSS parser positions to original HTML", async () => {
    const html =
      "<!-- header -->\n<template>\n" +
      shell("<style>\n.x {\n color red;\n}\n</style>") +
      "\n</template>";
    const result = await lintHyperframeHtml(html);
    expect(result.findings.find((f) => f.code === "css_parse_error")).toMatchObject(
      at(html, "color red"),
    );
  });
  it("keeps an external stylesheet's identity", async () => {
    const result = await lintHyperframeHtml(shell(""), {
      filePath: "scenes/a.html",
      externalStyles: [{ href: "theme.css", content: ".x {\n color red;\n}" }],
    });
    expect(result.findings.find((f) => f.code === "css_parse_error")).toMatchObject({
      file: "theme.css",
      line: 2,
      column: 2,
    });
  });
  it("locates a unique font declaration and GSAP timeline call", async () => {
    const html = shell(
      '<style>\n.x { font-family: "NoSuchFont"; }\n</style>\n<script>\nconst a = 1;\nconst tl = gsap.timeline();\n</script>',
    );
    const result = await lintHyperframeHtml(html);
    expect(result.findings.find((f) => f.code === "font_family_without_font_face")).toMatchObject(
      at(html, "font-family"),
    );
    expect(result.findings.find((f) => f.code === "gsap_timeline_not_registered")).toMatchObject(
      at(html, "gsap.timeline"),
    );
  });
  it("does not arbitrarily locate a multi-declaration font finding", async () => {
    const result = await lintHyperframeHtml(
      shell('<style>.a {font-family:"FooUnknown"} .b {font-family:"BarUnknown"}</style>'),
    );
    expect(
      result.findings.find((f) => f.code === "font_family_without_font_face")?.line,
    ).toBeUndefined();
  });
});

it("locates repeated GSAP config errors at the triggering Acorn call", async () => {
  const html = '<script>\nconst unrelated = 1;\n\ngsap.to(".x", {repeat: -1});\n</script>';
  const result = await lintHyperframeHtml(html);
  expect(result.findings.find((f) => f.code === "gsap_infinite_repeat")).toMatchObject({
    line: 4,
    column: 1,
  });
});

it("uses Acorn without executing source and preserves classic/module handling", async () => {
  const classic = await lintHyperframeHtml(
    "<script>return; globalThis.__lintMustNotRun = true;</script>",
  );
  expect(classic.findings.some((f) => f.code === "invalid_inline_script_syntax")).toBe(false);
  expect("__lintMustNotRun" in globalThis).toBe(false);
  const module = await lintHyperframeHtml(
    '<script type="module">import x from "x"; await x;</script>',
  );
  expect(module.findings.some((f) => f.code === "invalid_inline_script_syntax")).toBe(false);
});

it("maps fixpoint comment deletion and repeated script text without guessing", async () => {
  const html =
    "<<!-- -->!-- removed -->\n<template>\n<script>const safe = 1;</script>\n<script>const safe = 1; Math.random();</script>\n</template>";
  const result = await lintHyperframeHtml(html);
  expect(result.findings.find((f) => f.code === "non_deterministic_code")).toMatchObject({
    line: 4,
    column: 25,
  });
});

it("counts same-line Unicode columns as UTF-16 units", async () => {
  const html = '<script>const text = "😀"; Math.random();</script>';
  const result = await lintHyperframeHtml(html);
  expect(result.findings.find((f) => f.code === "non_deterministic_code")).toMatchObject({
    line: 1,
    column: html.indexOf("Math.random") + 1,
  });
});

it("leaves the mapped EOF error at the end of its own script", async () => {
  const html = "<!-- header -->\n<script>const foo = (</script>\n<script>const ok = 1;</script>";
  const result = await lintHyperframeHtml(html);
  expect(result.findings.find((f) => f.code === "invalid_inline_script_syntax")).toMatchObject({
    line: 2,
    column: 22,
  });
});

it("maps PostCSS offsets when bare CR and LF are mixed", async () => {
  const html = "<style>.x {\r}\r.y {\n color red;\n}</style>";
  const result = await lintHyperframeHtml(html);
  expect(result.findings.find((f) => f.code === "css_parse_error")).toMatchObject({
    line: 4,
    column: 2,
  });
});

it("uses classic-script Acorn semantics for new.target and hashbang", async () => {
  const target = await lintHyperframeHtml("<script>new.target;</script>");
  expect(target.findings.some((f) => f.code === "invalid_inline_script_syntax")).toBe(true);
  const hashbang = await lintHyperframeHtml("<script>#!/usr/bin/env node\nconst a=1;</script>");
  expect(hashbang.findings.some((f) => f.code === "invalid_inline_script_syntax")).toBe(false);
});

it("locates a snippet at the end of a large source in linear time", () => {
  const filler = "<div>\n  <p>a  b</p>\n</div>\n".repeat(12_000);
  const html = `${filler}<style>\n  .late {\n    position: fixed;\n  }\n</style>`;
  const start = performance.now();
  const location = sourceLocationFor(html, finding({ snippet: ".late { position: fixed; }" }));
  expect(location).toEqual({ line: 36_002, column: 3 });
  expect(performance.now() - start).toBeLessThan(1_000);
});
