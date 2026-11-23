import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileForRender } from "./htmlCompiler.js";

const utf16le = (text: string) =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);

describe("compileForRender a page saved as UTF-16LE", () => {
  it("compiles its text, not NUL bytes, with its sub-composition", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-compiler-utf16-"));
    writeFileSync(
      join(projectDir, "index.html"),
      utf16le(`<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080" data-duration="2">
    <div data-composition-id="scene" data-composition-src="scene.html" data-start="0" data-duration="2"></div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines.root = { duration: function() { return 2; } };
    </script>
  </div>
</body></html>`),
    );
    writeFileSync(
      join(projectDir, "scene.html"),
      utf16le(`<template><div data-composition-id="scene"><h1>Café scene</h1></div></template>`),
    );

    const compiled = await compileForRender(projectDir, join(projectDir, "index.html"), projectDir);

    expect(compiled.html).not.toContain("\u0000");
    expect(compiled.html).toContain('data-composition-id="root"');
    expect(compiled.html).toContain("Café scene");
  });
});
