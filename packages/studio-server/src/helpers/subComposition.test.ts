// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSubCompositionHtml } from "./subComposition";

function makeTempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-subcomp-preview-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return dir;
}

describe("buildSubCompositionHtml", () => {
  it("handles full HTML document compositions without nesting <html> in <body>", () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head><title>Host</title></head><body></body></html>`,
      "compositions/map-block.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <link rel="stylesheet" href="../styles/theme.css" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      .map { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="map-block" data-width="1920" data-height="1080">
      <img class="map" src="assets/map.png" alt="" />
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["map-block"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>`,
    });

    const html = buildSubCompositionHtml(
      dir,
      "compositions/map-block.html",
      "/api/runtime.js",
      "/api/projects/demo/preview/",
    );

    expect(html).not.toBeNull();
    // Must not nest a full HTML document inside <body>
    const bodyStart = html!.indexOf("<body>");
    const afterBody = html!.slice(bodyStart);
    expect(afterBody).not.toContain("<html");
    expect(afterBody).not.toContain("<head>");
    // Composition styles must be in <head>, not lost
    expect(html).toContain(".map {");
    expect(html).toContain("#root {");
    // Image src preserved (no ../ rewrite needed for bare relative paths)
    expect(html).toContain('src="assets/map.png"');
    // Base tag for asset resolution
    expect(html).toContain('<base href="/api/projects/demo/preview/">');
    // GSAP from the composition's own <head> must be preserved
    expect(html).toContain("gsap@3.14.2");
    // Body script content preserved
    expect(html).toContain('__timelines["map-block"]');
    // <link> and <meta> from composition head must not be dropped
    expect(html).toContain('rel="stylesheet"');
    expect(html).toContain('href="styles/theme.css"');
    expect(html).toContain('name="viewport"');
    // <html lang="en"> attribute forwarded to the output
    expect(html).toContain('lang="en"');
  });

  it("handles raw fragment compositions (no template, no full document)", () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head><title>Host</title></head><body></body></html>`,
      "compositions/card.html": `<div data-composition-id="card" data-width="400" data-height="300">
  <img src="../icon.svg" alt="" />
  <p>Hello</p>
</div>`,
    });

    const html = buildSubCompositionHtml(
      dir,
      "compositions/card.html",
      "/api/runtime.js",
      "/api/projects/demo/preview/",
    );

    expect(html).not.toBeNull();
    expect(html).toContain('<base href="/api/projects/demo/preview/">');
    // ../icon.svg from compositions/ rewrites to icon.svg at project root
    expect(html).toContain('src="icon.svg"');
    expect(html).not.toContain('src="../icon.svg"');
    expect(html).toContain("<p>Hello</p>");
  });

  it("rewrites sub-composition asset paths against the project root preview base", () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head><title>Test</title></head><body></body></html>`,
      "compositions/hero.html": `<template id="hero-template">
  <div data-composition-id="hero" data-width="1920" data-height="1080">
    <img src="../logo.png" alt="Logo" />
    <div style="background-image: url('../poster.png')"></div>
    <style>
      @font-face {
        font-family: "Brand Sans";
        src: url("../fonts/brand.woff2") format("woff2");
      }
    </style>
  </div>
</template>`,
    });

    const html = buildSubCompositionHtml(
      dir,
      "compositions/hero.html",
      "/api/runtime.js",
      "/api/projects/demo/preview/",
    );

    expect(html).toContain('<base href="/api/projects/demo/preview/">');
    expect(html).toContain('src="logo.png"');
    expect(html).toContain("background-image: url('poster.png')");
    expect(html).toContain('url("fonts/brand.woff2")');
    expect(html).not.toContain('src="../logo.png"');
    expect(html).not.toContain("url('../poster.png')");
    expect(html).not.toContain('url("../fonts/brand.woff2")');
  });

  it("promotes the <template>'s data-composition-id onto the root element when the content lacks one", () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html><html><head></head><body></body></html>`,
      "compositions/frames/02-music.html": `<template data-composition-id="02-music">
  <style>#music-scene { background: #121212; }</style>
  <div id="music-scene" class="clip" data-start="0" data-duration="3.213" data-track-index="0">
    <div id="music-headline">ready when you are.</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["02-music"] = gsap.timeline({ paused: true });
  </script>
</template>`,
    });

    const html = buildSubCompositionHtml(
      dir,
      "compositions/frames/02-music.html",
      "/api/runtime.js",
    );

    // Root rendered element gains the id so the runtime can bind the timeline
    // (attribute order is serializer-dependent, so match the tag as a whole).
    expect(html).toMatch(
      /<div\b(?=[^>]*\sid="music-scene")(?=[^>]*\sdata-composition-id="02-music")[^>]*>/,
    );
    // The <style>/<script> siblings must NOT receive it.
    expect(html).not.toMatch(/<style[^>]*data-composition-id/i);
    expect(html).not.toMatch(/<script[^>]*data-composition-id/i);
  });

  it("extracts the real <template> even when a head comment mentions the literal text <template>", () => {
    // Regression: a greedy /<template>([\s\S]*)<\/template>/ regex latches onto
    // the "<template>" inside the head comment, mis-slicing the capture so the
    // real content stays wrapped in an inert <template> in the output — leaving
    // the preview with no [data-composition-id] element and rendering blank.
    const dir = makeTempProject({
      "index.html": `<!doctype html><html><head></head><body></body></html>`,
      "compositions/frames/03-force-pair.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <!-- head is metadata only; the HF runtime clones ONLY <template> contents -->
  </head>
  <body>
    <template>
      <style>#fp-root { width: 1920px; height: 1080px; }</style>
      <div id="fp-root" data-composition-id="03-force-pair" data-width="1920" data-height="1080">
        <div class="headline">forces come in pairs</div>
      </div>
      <script>
        window.__timelines = window.__timelines || {};
        window.__timelines["03-force-pair"] = gsap.timeline({ paused: true });
      </script>
    </template>
  </body>
</html>`,
    });

    const html = buildSubCompositionHtml(
      dir,
      "compositions/frames/03-force-pair.html",
      "/api/runtime.js",
      "/api/projects/demo/preview/",
    );

    expect(html).not.toBeNull();
    // The real composition content is rendered into <body> directly...
    expect(html).toContain('data-composition-id="03-force-pair"');
    expect(html).toContain("forces come in pairs");
    expect(html).toContain('__timelines["03-force-pair"]');
    // ...and is NOT re-wrapped in an inert <template> (which the browser would
    // never render). The comment fragment must not leak through either.
    const bodyStart = html!.indexOf("<body>");
    const body = html!.slice(bodyStart);
    expect(body).not.toContain("<template");
    expect(body).not.toContain("clones ONLY");
  });

  it("escapes #id selectors whose id starts with a digit so the rule is not dropped", () => {
    // A CSS ident can't start with a digit, so `#01-wall { ... }` is an invalid
    // selector and the browser drops the whole rule — the root loses its size and
    // background and a standalone preview renders blank. Escape it to a valid form.
    const dir = makeTempProject({
      "index.html": `<!doctype html><html><head></head><body></body></html>`,
      "compositions/frames/01-wall.html": `<template>
  <div id="01-wall" data-composition-id="01-wall" data-start="0" data-duration="5.5" data-track-index="0">
    <style>
      #01-wall { position: absolute; inset: 0; width: 1920px; height: 1080px; background-color: #F0EBDE; }
      .arrow { background: #1F2BE0; color: #1A2B3C; }
    </style>
    <div class="arrow">action</div>
  </div>
</template>`,
    });

    const html = buildSubCompositionHtml(
      dir,
      "compositions/frames/01-wall.html",
      "/api/runtime.js",
    );

    expect(html).not.toBeNull();
    // The invalid `#01-wall` selector is rewritten to its escaped, valid form.
    expect(html).toContain("#\\30 1-wall {");
    expect(html).not.toMatch(/#01-wall\s*\{/);
    // Digit-leading hex color VALUES (not element ids) must be left untouched.
    expect(html).toContain("background: #1F2BE0;");
    expect(html).toContain("color: #1A2B3C;");
    // The element's id attribute itself is unchanged (only the selector is escaped).
    expect(html).toContain('id="01-wall"');
  });

  it("does not add a duplicate data-composition-id when the root element already has one", () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html><html><head></head><body></body></html>`,
      "compositions/frames/04-allinone.html": `<template data-composition-id="04-allinone">
  <div id="c04" data-composition-id="04-allinone" data-start="0" data-duration="5.695" data-track-index="0">
    <div class="headline">all in one app.</div>
  </div>
</template>`,
    });

    const html = buildSubCompositionHtml(
      dir,
      "compositions/frames/04-allinone.html",
      "/api/runtime.js",
    );
    const occurrences = html?.match(/data-composition-id="04-allinone"/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("escapes every digit-leading #id selector when several appear in one composition", () => {
    // The fix iterates over all digit-leading ids present on elements; pin that
    // a second id in the same document is escaped too, not just the first.
    const dir = makeTempProject({
      "index.html": `<!doctype html><html><head></head><body></body></html>`,
      "compositions/frames/01-wall.html": `<template>
  <div id="01-wall" data-composition-id="01-wall" data-start="0" data-duration="4" data-track-index="0">
    <style>
      #01-wall { width: 1920px; height: 1080px; }
      #02-music { color: #1F2BE0; }
    </style>
    <div id="02-music">two</div>
  </div>
</template>`,
    });

    const html = buildSubCompositionHtml(
      dir,
      "compositions/frames/01-wall.html",
      "/api/runtime.js",
    );

    expect(html).not.toBeNull();
    expect(html).toContain("#\\30 1-wall {");
    expect(html).toContain("#\\30 2-music {");
    expect(html).not.toMatch(/#01-wall\s*\{/);
    expect(html).not.toMatch(/#02-music\s*\{/);
    // The hex color value is still left untouched.
    expect(html).toContain("color: #1F2BE0;");
  });

  it("escapes a digit-leading #id inside compound and combinator selectors", () => {
    // Only the leading-digit id token is escaped; the descendant/combinator and
    // pseudo-class tail must be preserved verbatim.
    const dir = makeTempProject({
      "index.html": `<!doctype html><html><head></head><body></body></html>`,
      "compositions/frames/01-wall.html": `<template>
  <div id="01-wall" data-composition-id="01-wall" data-start="0" data-duration="4" data-track-index="0">
    <style>
      #01-wall .child > span { color: red; }
      #01-wall:hover { opacity: 1; }
    </style>
    <div class="child"><span>x</span></div>
  </div>
</template>`,
    });

    const html = buildSubCompositionHtml(
      dir,
      "compositions/frames/01-wall.html",
      "/api/runtime.js",
    );

    expect(html).not.toBeNull();
    expect(html).toContain("#\\30 1-wall .child > span {");
    expect(html).toContain("#\\30 1-wall:hover {");
    // No unescaped form survives.
    expect(html).not.toContain("#01-wall .child");
    expect(html).not.toContain("#01-wall:hover");
  });

  it("leaves the DOM untouched when the <template> has no data-composition-id to promote", () => {
    // No data-composition-id on the <template> tag → promoteTemplateCompositionId
    // returns early. The content's own id must be the only one, with nothing
    // injected onto the root or its siblings.
    const dir = makeTempProject({
      "index.html": `<!doctype html><html><head></head><body></body></html>`,
      "compositions/frames/05-plain.html": `<template>
  <style>#c05 { width: 1920px; height: 1080px; }</style>
  <div id="c05" data-composition-id="05-plain" data-start="0" data-duration="3" data-track-index="0">
    <div class="headline">plain</div>
  </div>
</template>`,
    });

    const html = buildSubCompositionHtml(
      dir,
      "compositions/frames/05-plain.html",
      "/api/runtime.js",
    );

    expect(html).not.toBeNull();
    // The authored id is preserved and is the ONLY data-composition-id — promote
    // didn't fabricate one (no <template> id to copy) or duplicate it.
    const occ = html?.match(/data-composition-id="05-plain"/g) ?? [];
    expect(occ).toHaveLength(1);
    expect(html).toMatch(
      /<div\b(?=[^>]*\sid="c05")(?=[^>]*\sdata-composition-id="05-plain")[^>]*>/,
    );
    // The <style> sibling was not tagged.
    expect(html).not.toMatch(/<style[^>]*data-composition-id/i);
  });
});
