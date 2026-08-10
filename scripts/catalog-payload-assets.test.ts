import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { inlineAssets, localReferences } from "./catalog-payload-assets.ts";

function project(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-payload-assets-"));
  for (const [name, contents] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, contents);
  }
  return dir;
}

describe("localReferences", () => {
  it("finds files referenced by attribute and by CSS url()", () => {
    const html = `<img src="assets/logo.png"><style>@font-face{src:url('fonts/inter.woff2')}</style>`;
    assert.deepEqual(localReferences(html).sort(), ["assets/logo.png", "fonts/inter.woff2"]);
  });

  it("ignores a shader source assigned to a variable ending in src", () => {
    // The whole reason the pattern demands a non-identifier character first.
    const html = `<script>var vertSrc = "attribute vec2 a_pos; void main(){}";</script>`;
    assert.deepEqual(localReferences(html), []);
  });

  it("ignores in-document fragment references, encoded or not", () => {
    const html = `<rect filter="url(#noise)"></rect><rect filter="url(%23grain)"></rect>`;
    assert.deepEqual(localReferences(html), []);
  });

  it("ignores anything already addressable by the browser", () => {
    const html = `<img src="https://cdn.example.com/a.png"><img src="data:image/png;base64,AA">`;
    assert.deepEqual(localReferences(html), []);
  });

  it("ignores a path assigned to an identifier, which is code and not markup", () => {
    // `configSrc` names a file the composition fetches at runtime and parses.
    // Rewriting it to a data URI would corrupt the script, so the leading
    // non-identifier character in the pattern is what keeps this out.
    const html = `<script>var configSrc = "config.json";</script>`;
    assert.deepEqual(localReferences(html), []);
  });

  it("still finds a property assignment, where the dot is not an identifier char", () => {
    const html = `<script>img.src = "assets/hero.png";</script>`;
    assert.deepEqual(localReferences(html), ["assets/hero.png"]);
  });

  it("ignores references with no inlinable extension", () => {
    const html = `<a href="/docs/guide">guide</a><div style="background:url(gradient)"></div>`;
    assert.deepEqual(localReferences(html), []);
  });
});

describe("inlineAssets", () => {
  it("replaces a reference with a data URI carrying the file", () => {
    const dir = project({ "assets/logo.png": Buffer.from([0x89, 0x50]) });
    const result = inlineAssets(`<img src="assets/logo.png">`, dir);

    assert.equal(result.inlined, 1);
    assert.deepEqual(result.unresolved, []);
    assert.equal(result.html, `<img src="data:image/png;base64,iVA=">`);
  });

  it("replaces every occurrence of the same reference", () => {
    const dir = project({ "a.png": Buffer.from([0x01]) });
    const result = inlineAssets(`<img src="a.png"><img src="a.png">`, dir);

    assert.equal(result.inlined, 1);
    assert.equal(result.html.match(/data:image\/png/g)?.length, 2);
  });

  it("reports a reference whose file is missing rather than dropping it", () => {
    // A runtime-built path such as `masks/${slug}.png` lands here, and the item
    // has to keep its video instead of shipping a preview with holes in it.
    const dir = project({});
    const result = inlineAssets(`<img src="masks/gone.png">`, dir);

    assert.deepEqual(result.unresolved, ["masks/gone.png"]);
    assert.equal(result.inlined, 0);
  });

  it("refuses a reference that climbs out of the project directory", () => {
    const dir = project({ "keep.png": Buffer.from([0x01]) });
    const result = inlineAssets(`<img src="../../etc/passwd.png">`, dir);

    assert.deepEqual(result.unresolved, ["../../etc/passwd.png"]);
    assert.equal(result.inlined, 0);
  });

  it("leaves a composition with no local references untouched", () => {
    const dir = project({});
    const html = `<div data-composition-id="x"></div>`;

    assert.deepEqual(inlineAssets(html, dir), { html, inlined: 0, unresolved: [] });
  });
});
