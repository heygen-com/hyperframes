import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
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

  it("preserves script delimiters as data without exposing them to the HTML parser", () => {
    withGlassMain((dir) => {
      const value = "</script></ScRiPt><!--<script>\u2028\u2029";
      writeFileSync(
        join(dir, "assets/glass-main.js"),
        `globalThis.payload = ${JSON.stringify(value)};`,
      );
      const out = inlineCatalogScripts("glass-shard-title", scriptTag, dir, {});
      const body = out.slice("<script>".length, -"</script>".length);
      assert.doesNotMatch(body, /[<\u2028\u2029]/);
      const context: { payload?: string } = {};
      runInNewContext(body, context);
      assert.equal(context.payload, value);
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

const vendorUrls = Object.fromEntries(
  ["gsap-3.14.2.min", "three-modules"].map((k) => [k, `https://cdn.example/${k}.js`]),
);
/** How a loader turns fetched code into a script URL; library code may build blob URLs for its own data. */
const BLOB_SCRIPT = /\{type:"text\/javascript"\}/;
const INLINED_BLOCKS = [
  "code-slice-hero",
  "cuboid-carousel",
  "frost-sequence-camera-orbit",
  "orbit-card",
];

function inlinedBlock(name: string): string {
  const dir = join("registry/blocks", name);
  return inlineCatalogScripts(
    name,
    readFileSync(join(dir, `${name}.html`), "utf-8"),
    dir,
    vendorUrls,
  );
}

// The docs host's CSP allows inline, eval'd and https: scripts but no blob: script, so a
// preview whose libraries load from a blob: URL renders its empty base (code-slice-hero, 2026-10-05).
describe("catalog payloads under the docs host's script policy", () => {
  for (const name of INLINED_BLOCKS) {
    it(`${name}: loads no script from a blob: URL`, () => {
      assert.doesNotMatch(inlinedBlock(name), BLOB_SCRIPT);
    });
  }

  it("no committed payload loads a script from a blob: URL", () => {
    const root = "docs/public/catalog";
    const payloads = readdirSync(root, { recursive: true, encoding: "utf-8" }).filter((f) =>
      /^(blocks|components)\/[^/]+\.json$/.test(f),
    );
    assert.ok(payloads.length > 100);
    const html = (f: string) =>
      (JSON.parse(readFileSync(join(root, f), "utf-8")) as { html: string }).html;
    assert.deepEqual(
      payloads.filter((f) => BLOB_SCRIPT.test(html(f))),
      [],
    );
  });
});

describe("module blocks' shared catalog bundle", () => {
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
    it(`${name}: bundles its own modules and takes only three.js from the shared bundle`, () => {
      const out = inlinedBlock(name);
      const required = [...out.matchAll(/__require\(\\"([^"\\]+)\\"\)/g)].map((m) => m[1] ?? "");
      assert.ok(required.length > 0);
      for (const spec of required)
        assert.match(spec, /^(three(\/addons\/.+)?|\.\/three\.module\.min\.js)$/);
      assert.doesNotMatch(out, /<script type="(importmap|module)">/);
    });
  }
});
