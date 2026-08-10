import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { externalizeDataUris, localReferences, processAssets } from "./catalog-payload-assets.ts";

function project(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-payload-assets-"));
  for (const [name, contents] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, contents);
  }
  return dir;
}

function target() {
  return { dir: mkdtempSync(join(tmpdir(), "hf-payload-out-")), urlBase: "/public/catalog/assets" };
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
    // Rewriting it would corrupt the script, so the leading non-identifier
    // character in the pattern is what keeps this out.
    const html = `<script>var configSrc = "config.json";</script>`;
    assert.deepEqual(localReferences(html), []);
  });

  it("still finds a property assignment, where the dot is not an identifier char", () => {
    const html = `<script>img.src = "assets/hero.png";</script>`;
    assert.deepEqual(localReferences(html), ["assets/hero.png"]);
  });

  it("ignores references with no known extension", () => {
    const html = `<a href="/docs/guide">guide</a><div style="background:url(gradient)"></div>`;
    assert.deepEqual(localReferences(html), []);
  });
});

describe("processAssets", () => {
  it("writes a publishable asset once and links to it", () => {
    const dir = project({ "assets/logo.png": Buffer.from([0x89, 0x50]) });
    const out = target();
    const result = processAssets(`<img src="assets/logo.png">`, dir, out);

    assert.equal(result.hosted, 1);
    assert.equal(result.inlined, 0);
    assert.deepEqual(result.unresolved, []);
    assert.match(result.html, /^<img src="\/public\/catalog\/assets\/[0-9a-f]{16}\.png">$/);
    assert.equal(readdirSync(out.dir).length, 1);
  });

  it("stores one copy when two items share a byte-identical font", () => {
    // The reason for content addressing: the catalog's fonts were being
    // base64'd into a hundred payloads apiece.
    const font = Buffer.from("a-font-file");
    const one = project({ "a.woff2": font });
    const two = project({ "nested/b.woff2": font });
    const out = target();

    const first = processAssets(`<style>@font-face{src:url(a.woff2)}</style>`, one, out);
    const second = processAssets(`<style>@font-face{src:url(nested/b.woff2)}</style>`, two, out);

    assert.equal(readdirSync(out.dir).length, 1);
    const url = /\/public\/catalog\/assets\/[0-9a-f]{16}\.woff2/;
    assert.equal(first.html.match(url)?.[0], second.html.match(url)?.[0]);
  });

  it("inlines a type the host will not publish", () => {
    // `.glb` returns 404 from the docs host, so a link would break the preview.
    const dir = project({ "scene.glb": Buffer.from([0x67, 0x6c]) });
    const out = target();
    const result = processAssets(`<model-viewer src="scene.glb">`, dir, out);

    assert.equal(result.inlined, 1);
    assert.equal(result.hosted, 0);
    assert.match(result.html, /data:model\/gltf-binary;base64,/);
    assert.ok(!existsSync(join(out.dir, "scene.glb")));
  });

  it("gives the same output twice, so regeneration writes no new bytes", () => {
    const dir = project({ "a.png": Buffer.from([0x01]) });
    const first = processAssets(`<img src="a.png">`, dir, target());
    const second = processAssets(`<img src="a.png">`, dir, target());

    assert.equal(first.html, second.html);
  });

  it("replaces every occurrence of the same reference", () => {
    const dir = project({ "a.png": Buffer.from([0x01]) });
    const result = processAssets(`<img src="a.png"><img src="a.png">`, dir, target());

    assert.equal(result.html.match(/\/public\/catalog\/assets\//g)?.length, 2);
  });

  it("reports a reference whose file is missing rather than dropping it", () => {
    // A runtime-built path such as `masks/${slug}.png` lands here, and the item
    // has to keep its video instead of shipping a preview with holes in it.
    const result = processAssets(`<img src="masks/gone.png">`, project({}), target());

    assert.deepEqual(result.unresolved, ["masks/gone.png"]);
  });

  it("refuses a reference that climbs out of the project directory", () => {
    const dir = project({ "keep.png": Buffer.from([0x01]) });
    const result = processAssets(`<img src="../../etc/passwd.png">`, dir, target());

    assert.deepEqual(result.unresolved, ["../../etc/passwd.png"]);
    assert.equal(result.hosted, 0);
  });

  it("leaves a composition with no local references untouched", () => {
    const html = `<div data-composition-id="x"></div>`;
    const result = processAssets(html, project({}), target());

    assert.deepEqual(result, { html, hosted: 0, inlined: 0, unresolved: [] });
  });
});

describe("externalizeDataUris", () => {
  const font = (n: number) => Buffer.alloc(n, 7).toString("base64");

  it("pulls an embedded font out into a shared file", () => {
    // Compositions arrive with fonts already embedded, which is where the bulk
    // of the catalog's payload weight came from.
    const out = target();
    const result = externalizeDataUris(
      `<style>@font-face{src:url(data:font/woff2;base64,${font(8000)})}</style>`,
      out,
    );

    assert.equal(result.externalized, 1);
    assert.match(result.html, /url\(\/public\/catalog\/assets\/[0-9a-f]{16}\.woff2\)/);
    assert.equal(readdirSync(out.dir).length, 1);
  });

  it("stores one copy when two payloads embed the same font", () => {
    const out = target();
    const blob = font(8000);
    externalizeDataUris(`<style>src:url(data:font/woff2;base64,${blob})</style>`, out);
    externalizeDataUris(
      `<b>other item</b><style>src:url(data:font/woff2;base64,${blob})</style>`,
      out,
    );

    assert.equal(readdirSync(out.dir).length, 1);
  });

  it("leaves a small blob alone, where a request costs more than the bytes", () => {
    const out = target();
    const result = externalizeDataUris(`<img src="data:image/png;base64,${font(64)}">`, out);

    assert.equal(result.externalized, 0);
    assert.ok(!existsSync(out.dir) || readdirSync(out.dir).length === 0);
  });

  it("leaves a type the host will not publish embedded", () => {
    const out = target();
    const result = externalizeDataUris(
      `<a href="data:model/gltf-binary;base64,${font(8000)}">`,
      out,
    );

    assert.equal(result.externalized, 0);
    assert.match(result.html, /data:model\/gltf-binary/);
  });
});
