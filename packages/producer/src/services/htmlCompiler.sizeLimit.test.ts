import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { _setDownloadFetchForTests } from "@hyperframes/engine";
import {
  assertCompositionFileSize,
  MAX_COMPOSITION_HTML_BYTES,
  MAX_EXPANDED_COMPOSITION_BYTES,
} from "./compositionSizeLimit.js";
import {
  compileForRender,
  inlineExternalScripts,
  localizeRemoteFontFaces,
  MAX_VARIABLE_MEDIA_SRC_BYTES,
} from "./htmlCompiler.js";
import { extractSafeRenderErrorCode } from "./safeRenderErrorCode.js";

const ROOT = `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080" data-duration="2">
    <div data-composition-id="scene" data-composition-src="scene.html" data-start="0" data-duration="2"></div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines.root = { duration: function() { return 2; } };
    </script>
  </div>
</body></html>`;
const SCENE = `<template><div data-composition-id="scene"><h1>Scene</h1></div></template>`;

/** `html` followed by a comment that brings the file to exactly `bytes`. */
const paddedTo = (html: string, bytes: number) =>
  `${html}<!--${"x".repeat(bytes - Buffer.byteLength(html) - 7)}-->`;

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-compiler-size-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

async function compileError(dir: string): Promise<unknown> {
  return compileForRender(dir, join(dir, "index.html"), dir).then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("composition HTML size limit", () => {
  it("refuses an entry file over the limit before compiling it", async () => {
    const dir = project({
      "index.html": paddedTo(ROOT, MAX_COMPOSITION_HTML_BYTES + 1),
      "scene.html": SCENE,
    });
    const started = performance.now();
    const error = await compileError(dir);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(String(error)).toContain('"index.html"');
    expect(String(error)).toContain("16.0 MB limit");
  });

  it("refuses a sub-composition file over the limit", async () => {
    const dir = project({
      "index.html": ROOT,
      "scene.html": paddedTo(SCENE, MAX_COMPOSITION_HTML_BYTES + 1),
    });
    const error = await compileError(dir);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(String(error)).toContain('"scene.html"');
  });

  it("compiles files at the limit", async () => {
    const dir = project({
      "index.html": paddedTo(ROOT, MAX_COMPOSITION_HTML_BYTES),
      "scene.html": SCENE,
    });
    const compiled = await compileForRender(dir, join(dir, "index.html"), dir);
    expect(compiled.html).toContain("<h1>Scene</h1>");
  });

  it("leaves missing paths and folders to the caller's own read", () => {
    const dir = project({});
    expect(() =>
      assertCompositionFileSize(join(dir, "missing.html"), "missing.html"),
    ).not.toThrow();
    expect(() => assertCompositionFileSize(dir, "folder")).not.toThrow();
  });
});

/** A root that mounts `src` `count` times. */
const rootMounting = (src: string, count: number) =>
  ROOT.replace(
    /<div data-composition-id="scene"[^>]*><\/div>/,
    `<div data-composition-id="scene" data-composition-src="${src}" data-start="0" data-duration="2"></div>`.repeat(
      count,
    ),
  );

/** A sub-composition that mounts `src` `count` times, as a bare fragment or inside a `<template>`. */
const sceneMounting = (id: string, src: string, count: number, template = true) => {
  const root = `<div data-composition-id="${id}">${`<div data-composition-src="${src}"></div>`.repeat(count)}</div>`;
  return template ? `<template>${root}</template>` : root;
};

/** Seven files, each mounting the next one ten times. */
function fanOut(template: boolean): Record<string, string> {
  const files: Record<string, string> = { "index.html": rootMounting("level-0.html", 10) };
  for (let level = 0; level < 6; level += 1) {
    files[`level-${level}.html`] = sceneMounting(
      `level-${level}`,
      `level-${level + 1}.html`,
      10,
      template,
    );
  }
  files["level-6.html"] = SCENE;
  return files;
}

describe("composition expansion budget", () => {
  it.each([
    ["bare fragments", false],
    ["templates", true],
  ])(
    "refuses small files that mount each other many times, as %s, before compiling",
    async (_, template) => {
      const error = await compileError(project(fanOut(template)));
      expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
      expect(String(error)).toContain("10001 mounts");
      expect(error).toMatchObject({ publicMetadata: { mounts: 10_001, exceeded: "mounts" } });
    },
  );

  it("refuses one large file mounted many times", async () => {
    const big = Math.ceil(MAX_EXPANDED_COMPOSITION_BYTES / 4) + 1;
    const dir = project({
      "index.html": rootMounting("scene.html", 4),
      "scene.html": paddedTo(SCENE, big),
    });
    const error = await compileError(dir);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(String(error)).toContain('"scene.html"');
  });

  it("leaves a missing mount inside a template to the inliner's warning, as before", async () => {
    const dir = project({
      "index.html": rootMounting("wrapper.html", 1),
      "wrapper.html": `<template><div data-composition-id="wrapper"><h1>Kept</h1><div data-composition-src="missing.html"></div></div></template>`,
    });
    const compiled = await compileForRender(dir, join(dir, "index.html"), dir);
    expect(compiled.html).toContain("<h1>Kept</h1>");
  });

  it("still compiles a scene mounted a few times, once per mount", async () => {
    const dir = project({
      "index.html": rootMounting("wrapper.html", 3),
      "wrapper.html": sceneMounting("wrapper", "scene.html", 2),
      "scene.html": SCENE,
    });
    const compiled = await compileForRender(dir, join(dir, "index.html"), dir);
    expect(compiled.html.split("<h1>Scene</h1>").length - 1).toBe(6);
  });

  it("refuses a mount whose tiny scripts would each be wrapped in kilobytes of scoping code", async () => {
    const scripts = `<script>window.n = (window.n || 0) + 1;</script>`.repeat(3_000);
    const dir = project({
      "index.html": rootMounting("scene.html", 1),
      "scene.html": SCENE.replace("<h1>Scene</h1>", `<h1>Scene</h1>${scripts}`),
    });
    const error = await compileError(dir);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(error).toMatchObject({ publicMetadata: { exceeded: "generated" } });
    // Charged as each wrapper is built, so building stops one wrapper past the limit.
    const { bytes } = (error as { publicMetadata: { bytes: number } }).publicMetadata;
    expect(bytes - MAX_EXPANDED_COMPOSITION_BYTES).toBeLessThan(64 * 1024);
  });

  it("refuses a long host id over many style rules before building the scoped sheet", async () => {
    const id = `s${"x".repeat(20_000)}`;
    const rules = Array.from({ length: 2_000 }, (_, i) => `.r${i}{color:red}`).join("");
    const dir = project({
      "index.html": ROOT.replace("<html>", "<html><head></head>").replace(
        'data-composition-id="scene"',
        `data-composition-id="${id}"`,
      ),
      "scene.html": SCENE.replace("<h1>Scene</h1>", `<style>${rules}</style><h1>Scene</h1>`),
    });
    const error = await compileError(dir);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(error).toMatchObject({ publicMetadata: { exceeded: "generated" } });
    // Each rule reserves its upper bound first, so no rule is scoped past the limit.
    const { bytes } = (error as { publicMetadata: { bytes: number } }).publicMetadata;
    expect(bytes - MAX_EXPANDED_COMPOSITION_BYTES).toBeLessThan(10 * id.length);
  });

  it("reserves the separator a scoped selector list is re-joined with", async () => {
    const selectors = Array.from({ length: 2_000 }, (_, i) => `.r${i}`).join(",");
    const sheet = `.first,${" ".repeat(20_000)}${selectors}{color:red}`;
    const dir = project({
      "index.html": ROOT.replace("<html>", "<html><head></head>"),
      "scene.html": SCENE.replace("<h1>Scene</h1>", `<style>${sheet}</style><h1>Scene</h1>`),
    });
    const error = await compileError(dir);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(error).toMatchObject({ publicMetadata: { exceeded: "generated" } });
  });

  it("compiles scenes with ordinary scripts and styles", async () => {
    const scene = SCENE.replace(
      "<h1>Scene</h1>",
      `<style>h1{color:red}.a,.b{margin:0}</style><h1>Scene</h1><script>window.ready = true;</script>`,
    );
    const dir = project({
      "index.html": rootMounting("wrapper.html", 3),
      "wrapper.html": sceneMounting("wrapper", "scene.html", 20),
      "scene.html": scene,
    });
    const compiled = await compileForRender(dir, join(dir, "index.html"), dir);
    expect(compiled.html.split("<h1>Scene</h1>").length - 1).toBe(60);
  });

  /** The fan-out project with `depth` nested templates in `file`, the innermost one mounting the fan-out. */
  function nestedFanOut(file: string, depth: number): Record<string, string> {
    const nested = `${"<template>".repeat(depth)}<div data-composition-src="level-0.html"></div>${"</template>".repeat(depth)}`;
    const files = fanOut(true);
    files["index.html"] = rootMounting("wrapper.html", 1).replace("</body>", `${nested}</body>`);
    files["wrapper.html"] = SCENE;
    if (file === "wrapper.html") {
      files["index.html"] = rootMounting("wrapper.html", 1);
      files["wrapper.html"] = SCENE.replace("<h1>Scene</h1>", `<h1>Scene</h1>${nested}`);
    }
    return files;
  }

  it.each([
    ["the entry file", "index.html"],
    ["a mounted file", "wrapper.html"],
  ])(
    "finds mounts in deeply nested templates in %s without copying each level",
    async (_, file) => {
      const template = parseHTML("<template></template>").document.querySelector("template")!;
      const content = vi.spyOn(Object.getPrototypeOf(template), "content", "get");
      try {
        const contentReads = async (depth: number) => {
          content.mockClear();
          const error = await compileError(project(nestedFanOut(file, depth)));
          expect(error).toMatchObject({ publicMetadata: { exceeded: "mounts" } });
          return content.mock.calls.length;
        };
        expect(await contentReads(3_000)).toBe(await contentReads(1));
      } finally {
        content.mockRestore();
      }
    },
  );
});

describe("variable-driven composition styles and media sources", () => {
  const withBody = (body: string) =>
    ROOT.replace("<html>", "<html><head></head>").replace("</body>", `${body}</body>`);

  it("refuses declarers that each repeat a long host value, with no sub-compositions to mount", async () => {
    const declarer = `<div data-composition-variables='[{"id":"v","type":"string","default":"d"}]'></div>`;
    const host = `<div data-variable-values='${JSON.stringify({ v: "x".repeat(1024 * 1024) })}'>${declarer.repeat(100)}</div>`;
    const dir = project({
      "index.html": withBody(host).replace(/<div data-composition-id="scene"[^>]*><\/div>/, ""),
    });
    const error = await compileError(dir);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(error).toMatchObject({
      owner: "user",
      retryable: false,
      publicMetadata: { exceeded: "generated" },
    });
    expect(String(error)).toContain("Composition variable styles add up to");
    expect(String(error)).toContain("declare them on fewer elements");
  });

  it("refuses declarers inside a mounted sub-composition that repeat a long host value", async () => {
    const declarer = `<div data-composition-variables='[{"id":"v","type":"string","default":"d"}]'></div>`;
    const host = `data-variable-values='${JSON.stringify({ v: "x".repeat(1024 * 1024) })}'`;
    const dir = project({
      "index.html": ROOT.replace(
        'data-composition-id="scene"',
        `data-composition-id="scene" ${host}`,
      ),
      "scene.html": SCENE.replace("<h1>Scene</h1>", declarer.repeat(100)),
    });
    const error = await compileError(dir);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(error).toMatchObject({ owner: "user", publicMetadata: { exceeded: "generated" } });
  });

  it("refuses many media elements bound to one long value", async () => {
    const url = `https://example.com/${"a".repeat(MAX_VARIABLE_MEDIA_SRC_BYTES - 100)}.mp4`;
    const videos = `<video data-var-src="clip"></video>`.repeat(4_200);
    const dir = project({ "index.html": withBody(videos), "scene.html": SCENE });
    const error = await compileForRender(dir, join(dir, "index.html"), dir, {
      variables: { clip: url },
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(error).toMatchObject({ publicMetadata: { exceeded: "generated" } });
  });

  it.each([
    ["longer than 8 KiB", `https://example.com/${"a".repeat(MAX_VARIABLE_MEDIA_SRC_BYTES)}.mp4`],
    ["holding a control character", "https://example.com/a\nb.mp4"],
  ])("leaves src unchanged for a bound value %s, and binds a normal one", async (_, bad) => {
    const dir = project({
      "index.html": withBody(`<video id="v1" data-var-src="clip" src="fallback.mp4"></video>`),
      "scene.html": SCENE,
    });
    const srcFor = async (clip: string) => {
      const compiled = await compileForRender(dir, join(dir, "index.html"), dir, {
        variables: { clip },
      });
      return parseHTML(compiled.html).document.getElementById("v1")?.getAttribute("src");
    };
    expect(await srcFor(bad)).toBe("fallback.mp4");
    expect(await srcFor("https://example.com/my clip.mp4")).toBe("https://example.com/my clip.mp4");
    expect(await srcFor("https://example.com/x.mp4\n")).toBe("https://example.com/x.mp4");
  });
});

describe("local font embedding", () => {
  const LARGEST_INLINED_FONT_BYTES = 5 * 1024 * 1024;
  const faces = (count: number) =>
    Array.from(
      { length: count },
      (_, i) => `@font-face { font-family: "F${i}"; src: url("big.ttf"); }`,
    ).join("\n");

  it("inlines a font that many rules name only while the page stays within the limit", async () => {
    const dir = project({
      "index.html": ROOT.replace(
        "<html>",
        `<html><head><style>${faces(8)}\n.mark { background: url("big.ttf"); }</style></head>`,
      ),
      "scene.html": SCENE,
    });
    writeFileSync(join(dir, "big.ttf"), Buffer.alloc(LARGEST_INLINED_FONT_BYTES, 1));
    const { html } = await compileForRender(dir, join(dir, "index.html"), dir);
    const inlined = html.split("data:font/ttf;base64,").length - 1;
    expect(inlined).toBeGreaterThan(0);
    expect(html.length).toBeLessThan(MAX_EXPANDED_COMPOSITION_BYTES + 64 * 1024);
    expect(html.split('url("big.ttf")').length - 1).toBe(8 - inlined + 1);
    expect(html).toContain('.mark { background: url("big.ttf"); }');
  });
});

describe("asset paths rebased from a composition's folder", () => {
  const candidates = (count: number) => Array(count).fill("../x.png").join(", ");
  const scene = (count: number) =>
    `<template><div data-composition-id="scene"><img srcset="${candidates(count)}"></div></template>`;
  const deepFolder = Array.from({ length: 4 }, (_, i) => `${i}`.repeat(200)).join("/");

  function projectWith(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "hf-rebase-"));
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    return dir;
  }

  it("rebases from the mounted file, not a query in its src", async () => {
    const src = `scenes/a/scene.html?${"q/".repeat(20_000)}`;
    const dir = projectWith({
      "index.html": ROOT.replace(
        'data-composition-src="scene.html"',
        `data-composition-src="${src}"`,
      ),
      "scenes/a/scene.html": scene(200),
    });
    const { html } = await compileForRender(dir, join(dir, "index.html"), dir);
    expect(html).toContain(`srcset="scenes/x.png, scenes/x.png`);
  });

  it("refuses a mount in a deep folder whose rebased references add up past the limit", async () => {
    const dir = projectWith({
      "index.html": ROOT.replace("scene.html", `${deepFolder}/scene.html`),
      [`${deepFolder}/scene.html`]: scene(60_000),
    });
    const error = await compileError(dir);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
  });

  it("refuses an entry file in a deep folder whose rebased references add up past the limit", async () => {
    const dir = projectWith({
      [`${deepFolder}/index.html`]: `<!doctype html><html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080" data-duration="2">
    <img srcset="${candidates(60_000)}">
  </div>
</body></html>`,
    });
    const error = await compileForRender(dir, join(dir, deepFolder, "index.html"), dir).catch(
      (e: unknown) => e,
    );
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
  });
});

describe("remote scripts and stylesheets inlined at compile time", () => {
  afterEach(() => _setDownloadFetchForTests());
  const MiB = 1024 * 1024;

  /** Serves `body(url)` and records each request and the most requests open at once. */
  function serve(body: (url: string) => string) {
    const seen = { requests: [] as string[], open: 0, mostOpen: 0 };
    _setDownloadFetchForTests(async (url: string) => {
      seen.requests.push(url);
      seen.mostOpen = Math.max(seen.mostOpen, ++seen.open);
      await new Promise((resolve) => setImmediate(resolve));
      seen.open -= 1;
      return new Response(body(url));
    });
    return seen;
  }
  const scriptTags = (urls: string[]) =>
    `<html><body>${urls.map((url) => `<script src="${url}"></script>`).join("")}</body></html>`;

  it("fetches a repeated script once and refuses copies past the render's limit", async () => {
    const seen = serve(() => `/*${"x".repeat(MiB)}*/`);
    const url = "https://cdn.example.com/big.js";
    const error = await inlineExternalScripts(scriptTags(Array(40).fill(url))).catch((e) => e);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(seen.requests).toEqual([url]);
  });

  it("downloads a few scripts at a time and stops the queued ones once over the limit", async () => {
    const seen = serve(() => `/*${"x".repeat(8 * MiB)}*/`);
    const urls = Array.from({ length: 20 }, (_, i) => `https://cdn.example.com/s${i}.js`);
    const error = await inlineExternalScripts(scriptTags(urls)).catch((e) => e);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(seen.mostOpen).toBe(4);
    expect(seen.requests.length).toBeLessThan(urls.length);
  });

  it("stops queued downloads once a script fails its integrity check", async () => {
    const seen = serve(() => `/*${"x".repeat(MiB)}*/`);
    const urls = Array.from({ length: 40 }, (_, i) => `https://cdn.example.com/i${i}.js`);
    const html = scriptTags(urls).replaceAll("<script ", '<script integrity="sha384-YQ==" ');
    await expect(inlineExternalScripts(html)).rejects.toThrow("integrity mismatch");
    expect(seen.requests.length).toBeLessThan(urls.length);
  });

  it("still inlines a few ordinary scripts", async () => {
    serve((url) => `window.loaded = ${JSON.stringify(url)};`);
    const html = await inlineExternalScripts(
      scriptTags(["https://cdn.example.com/a.js", "https://cdn.example.com/a.js"]),
    );
    expect(html.split('window.loaded = "https://cdn.example.com/a.js";').length - 1).toBe(2);
  });

  const linkTags = (urls: string[]) =>
    urls.map((url) => `<link rel="stylesheet" href="${url}">`).join("\n");

  it("inserts a remote stylesheet's text literally and fetches a repeated link once", async () => {
    const family = "A$&$'$`$$B";
    const seen = serve(() => `@font-face { font-family: "${family}"; src: local("${family}"); }`);
    const url = "https://cdn.example.com/fonts.css";
    const { html } = await localizeRemoteFontFaces(
      `<p>before</p>\n${linkTags([url, url])}\n<p>after</p>`,
      mkdtempSync(join(tmpdir(), "hf-remote-sheet-")),
    );
    expect(seen.requests).toEqual([url]);
    expect(html.split(`font-family: "${family}"`).length - 1).toBe(2);
    expect(html.split("<p>before</p>").length - 1).toBe(1);
    expect(html.split("<p>after</p>").length - 1).toBe(1);
  });

  it.each([
    ["distinct", (i: number) => `https://cdn.example.com/f${i}.css`],
    ["repeated", () => "https://cdn.example.com/f.css"],
  ])("refuses %s remote font stylesheets that add up past the render's limit", async (_, url) => {
    const face = `@font-face { font-family: "F"; src: local("${"x".repeat(MiB)}"); }`;
    const seen = serve(() => face);
    const urls = Array.from({ length: 40 }, (_, i) => url(i));
    const error = await localizeRemoteFontFaces(
      linkTags(urls),
      mkdtempSync(join(tmpdir(), "hf-remote-sheet-")),
    ).catch((e) => e);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(seen.requests.length).toBeLessThan(urls.length);
  });
});
