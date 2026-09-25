import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inlineCatalogScripts, withHostedRefs } from "./catalog-script-inlining.ts";

const CDN = "https://static.example.com/registry-assets";

function itemWith(files: { path: string; url?: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-inlining-"));
  const manifest = { name: "x", files: files.map((f) => ({ ...f, target: `c/${f.path}` })) };
  writeFileSync(join(dir, "registry-item.json"), JSON.stringify(manifest));
  return dir;
}

describe("withHostedRefs", () => {
  it("points a quoted local path at its CDN URL", () => {
    const dir = itemWith([{ path: "assets/matcap-1.png", url: `${CDN}/aa.png` }]);
    try {
      assert.equal(withHostedRefs(`load("assets/matcap-1.png")`, dir), `load("${CDN}/aa.png")`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replaces the bundle's base-joined helper call with the full URL", () => {
    const dir = itemWith([{ path: "assets/shards-atlas.png", url: `${CDN}/bb.png` }]);
    try {
      assert.equal(withHostedRefs(`x=a2("shards-atlas.png")`, dir, "a2"), `x="${CDN}/bb.png"`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when a hosted name is still loaded through an unpatched helper", () => {
    const dir = itemWith([{ path: "assets/shards-atlas.png", url: `${CDN}/bb.png` }]);
    try {
      assert.throws(() => withHostedRefs(`x=a3("shards-atlas.png")`, dir, "a2"), /still loaded/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves a file that stays in the repository alone", () => {
    const dir = itemWith([{ path: "assets/textures/bluenoise64.png" }]);
    try {
      const text = `a2("textures/bluenoise64.png")`;
      assert.equal(withHostedRefs(text, dir, "a2"), text);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("glass-shard-title payload", () => {
  const scriptTag = `<script src="assets/glass-main.js"></script>`;
  const withGlassMain = (fn: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-inlining-"));
    try {
      mkdirSync(join(dir, "assets"));
      writeFileSync(join(dir, "assets/glass-main.js"), "window.GLASS = 1;");
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("inlines glass-main.js once the hdr link is a data URL", () => {
    withGlassMain((dir) => {
      const html = `<link id="gst-hdr" href="data:image/vnd.radiance;base64,AA">${scriptTag}`;
      const out = inlineCatalogScripts("glass-shard-title", html, dir, {});
      assert.ok(out.includes("window.GLASS = 1;"));
      assert.ok(!out.includes(scriptTag));
    });
  });

  it("refuses a payload whose hdr link still points at the local file", () => {
    withGlassMain((dir) => {
      for (const link of [
        `<link id="gst-hdr" href="assets/ferndale_studio_01_1k.hdr">`,
        `<link id='gst-hdr' href='assets/ferndale_studio_01_1k.hdr'>`,
      ]) {
        assert.throws(
          () => inlineCatalogScripts("glass-shard-title", link + scriptTag, dir, {}),
          /hdr <link> was not inlined/,
        );
      }
    });
  });
});

describe("module blocks' catalog import map", () => {
  const vendorUrls = Object.fromEntries(
    [
      "gsap-3.14.2.min",
      "three.core.min",
      "three.module.min",
      "RoomEnvironment",
      "BufferGeometryUtils",
    ].map((k) => [k, `https://cdn.example/${k}.js`]),
  );
  it("frost: runs the script that drives frost after frost.js, not an earlier inline script", () => {
    const name = "frost-sequence-camera-orbit";
    const dir = join("registry/blocks", name);
    const out = inlineCatalogScripts(
      name,
      readFileSync(join(dir, `${name}.html`), "utf-8"),
      dir,
      vendorUrls,
    );
    const start = out.indexOf("<script>(function(){");
    const bootstrap = out.slice(start, out.indexOf("})();</script>", start));
    assert.match(bootstrap, /setRendererProfile/);
    assert.doesNotMatch(out.replace(bootstrap, ""), /setRendererProfile/);
  });

  for (const name of ["cuboid-carousel", "orbit-card"]) {
    it(`${name}: maps every specifier its entry module imports, with no import map of its own left`, () => {
      const dir = join("registry/blocks", name);
      const html = readFileSync(join(dir, `${name}.html`), "utf-8");
      const entry = html.slice(html.indexOf('<script type="module">'));
      const imported = [...entry.matchAll(/^\s*import [^;]*? from "([^"]+)"/gm)].flatMap(
        (m) => m[1] ?? [],
      );
      assert.ok(imported.length > 0);
      const out = inlineCatalogScripts(name, html, dir, vendorUrls);
      const mapped = /imports:\{(.*?)\}\}\);/.exec(out)?.[1] ?? "";
      const keys = [...mapped.matchAll(/(?:^|,)"?([^",:]+)"?:/g)].map((m) => m[1]);
      for (const spec of imported) assert.ok(keys.includes(spec), spec);
      assert.doesNotMatch(out, /<script type="importmap">/);
    });
  }
});
