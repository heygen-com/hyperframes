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
