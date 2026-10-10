// @vitest-environment happy-dom
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  bundleToSingleHtml,
  extractCompiledHtmlParityContract,
  injectScriptsIntoHtml,
} from "@hyperframes/core/compiler";
// Deep import: the mount path is not part of core's published export map (it is
// bundled into the runtime IIFE, not imported by consumers). Same shape as
// engine/src/services/videoFrameExtractor.test.ts reaching into core's runtime.
import { nestedCompositionPathFixture } from "../../../core/src/compiler/nestedCompositionPath.testFixture.js";
import { loadCompositions } from "../../../core/src/runtime/compositionLoader.js";
import { VARIABLE_HOST_ATTR } from "../../../core/src/runtime/variableScope.js";
import { compileForRender } from "./htmlCompiler.js";
import { createFileServer } from "@hyperframes/engine";
import { getVerifiedHyperframeRuntimeSource } from "./hyperframeRuntimeLoader.js";

vi.mock("../utils/urlDownloader.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/urlDownloader.js")>()),
  fetchPublicHttpsText: async () => {
    throw new Error("offline test");
  },
}));
Object.assign(
  (
    window as unknown as {
      happyDOM: {
        settings: { disableCSSFileLoading: boolean; handleDisabledFileLoadingAsSuccess: boolean };
      };
    }
  ).happyDOM.settings,
  { disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true },
);

const tempDirs: string[] = [];

const nativeQuerySelector = Element.prototype.querySelector;
const nativeQuerySelectorAll = Element.prototype.querySelectorAll;
afterEach(() => {
  Element.prototype.querySelector = nativeQuerySelector;
  Element.prototype.querySelectorAll = nativeQuerySelectorAll;
  delete window.__hfSvgSelectorAliases;
});

beforeAll(() => {
  // The mount path scopes CSS with CSS.escape, which the DOM stub omits.
  if (typeof globalThis.CSS === "undefined") {
    Object.defineProperty(globalThis, "CSS", { value: {}, configurable: true, writable: true });
  }
  if (typeof CSS.escape !== "function") {
    CSS.escape = (value: string) => value.replace(/([^\w-])/g, "\\$1");
  }
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  delete (window as Window & { __hfVariablesByComp?: unknown }).__hfVariablesByComp;
  delete (window as Window & { __timelines?: unknown }).__timelines;
  vi.restoreAllMocks();
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-compiler-parity-"));
  tempDirs.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const path = join(dir, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

type ParityContract = ReturnType<typeof extractCompiledHtmlParityContract>;

/**
 * Mount the project the way the player does — parse `index.html` into the live
 * document, serve its sub-compositions through the capture file server, and let the
 * runtime assemble them — then read the same contract off the resulting DOM.
 *
 * This is the third assembly path. Both compiler arms below run the same code
 * up to `bundleToSingleHtml`, which is why a runtime-only regression (a mounted
 * composition losing every `<style>` authored beside its root) stayed invisible
 * to a green suite.
 */
async function mountContract(
  dir: string,
  indexHtml: string,
  expectedRefusal?: string,
): Promise<ParityContract> {
  const parsed = new DOMParser().parseFromString(indexHtml, "text/html");
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  const server = await createFileServer({ projectDir: dir });
  const base = document.createElement("base");
  base.href = `${server.url}/`;
  document.head.prepend(base);
  try {
    await loadCompositions({
      injectedStyles: [],
      injectedScripts: [],
      injectedLinks: [],
      parseDimensionPx: (value: string | null) => (value ? `${value}px` : null),
      // A mount that fails is not a parity result. Surface it instead of
      // comparing the contract of an empty host against a compiled one.
      onDiagnostic: ({ code, details }) => {
        if (expectedRefusal && details?.errorMessage === expectedRefusal) return;
        throw new Error(`mount diagnostic ${code}: ${JSON.stringify(details)}`);
      },
    });
  } finally {
    base.remove();
    server.close();
  }
  return extractCompiledHtmlParityContract(`<!doctype html>${document.documentElement.outerHTML}`);
}

async function contracts(files: Record<string, string>, expectedRefusal?: string) {
  const dir = project(files);
  const preview = await bundleToSingleHtml(dir);
  const render = await compileForRender(dir, join(dir, "index.html"), join(dir, ".downloads"), {
    allowSystemFontCapture: false,
  });
  const servedRender = injectScriptsIntoHtml(
    render.html,
    [getVerifiedHyperframeRuntimeSource()],
    [],
    true,
  );
  return {
    dir,
    html: { preview, render: servedRender },
    preview: extractCompiledHtmlParityContract(preview),
    render: extractCompiledHtmlParityContract(servedRender),
    mount: await mountContract(dir, files["index.html"]!, expectedRefusal),
  };
}

const shell = (body: string, head = "") => `<!doctype html>
<html><head>${head}</head><body>${body}
<script>window.__timelines = window.__timelines || {};</script></body></html>`;

describe("preview/render semantic compilation parity", () => {
  it("preserves canonical timing, track, authored style, font, and resource contracts", async () => {
    const result = await contracts({
      "index.html": shell(
        `<main data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="4">
          <div id="title" data-start="1" data-duration="2" data-track-index="3" class="clip parity-card">Title</div>
          <img id="logo" src="assets/logo.svg" alt="" />
        </main>`,
        `<style>@font-face { font-family: "ParityDisplay"; src: url(data:font/woff2;base64,d09GMgAB) format("woff2"); }
        .parity-card { --parity-contract: 1; color: red; font-family: "ParityDisplay", sans-serif; }</style>`,
      ),
      "assets/logo.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`,
    });
    expect(result.render).toEqual(result.preview);
  });

  it("keeps conditional head styles apart the same way in preview and render", async () => {
    const dir = project({
      "index.html": shell(
        `<main data-composition-id="main" data-start="0" data-width="320" data-height="180" data-duration="1"></main>`,
        `<style>p{color:red}</style><style media="print">p{color:blue}</style>` +
          `<style type="text/x-tpl">{{ a }}</style><style title="alt">p{color:green}</style>` +
          `<style>h1{color:black}</style><style>h2{color:black}</style>`,
      ),
    });
    const headStyles = (html: string) =>
      [...new DOMParser().parseFromString(html, "text/html").head.querySelectorAll("style")]
        .filter((el) => !el.hasAttribute("data-hyperframes-text-rendering"))
        .map((el) => [
          el.getAttribute("media"),
          el.getAttribute("type"),
          el.getAttribute("title"),
          el.textContent,
        ]);
    const preview = headStyles(await bundleToSingleHtml(dir));
    const render = headStyles(
      (
        await compileForRender(dir, join(dir, "index.html"), join(dir, ".downloads"), {
          allowSystemFontCapture: false,
        })
      ).html,
    );
    expect(preview).toEqual([
      [null, null, null, "p{color:red}"],
      ["print", null, null, "p{color:blue}"],
      [null, "text/x-tpl", null, "{{ a }}"],
      [null, null, "alt", "p{color:green}"],
      [null, null, null, "h1{color:black}\n\nh2{color:black}"],
    ]);
    expect(render).toEqual(preview);
  });

  it("keeps a composition's print style print-only in preview and render", async () => {
    const dir = project({
      "index.html": shell(
        `<main data-composition-id="main" data-start="0" data-width="320" data-height="180" data-duration="1">
          <section data-composition-id="card" data-composition-src="card.html" data-start="0" data-duration="1"></section>
        </main>`,
      ),
      "card.html": `<template id="card-template"><article data-composition-id="card" data-width="320" data-height="180">
        <style media="print">.card-p{color:blue}</style><p class="card-p">x</p></article></template>`,
    });
    const printCss = (html: string) =>
      [
        ...new DOMParser()
          .parseFromString(html, "text/html")
          .querySelectorAll('style[media="print"]'),
      ]
        .map((el) => el.textContent)
        .join("\n");
    expect(printCss(await bundleToSingleHtml(dir))).toMatch(/\.card-p\{color:blue\}/);
    const render = await compileForRender(dir, join(dir, "index.html"), join(dir, ".downloads"), {
      allowSystemFontCapture: false,
    });
    expect(printCss(render.html)).toMatch(/\.card-p\{color:blue\}/);
  });

  it("emits conditional composition styles and links as their own elements in preview and render", async () => {
    const host = (id: string) =>
      `<section data-composition-id="${id}" data-composition-src="${id}.html" data-start="0" data-duration="1"></section>`;
    const comp = (id: string, inner: string) =>
      `<template id="${id}-template"><article data-composition-id="${id}" data-width="320" data-height="180">${inner}<p class="p${id}">x</p></article></template>`;
    const dir = project({
      "index.html": shell(
        `<main data-composition-id="main" data-start="0" data-width="320" data-height="180" data-duration="1">
          ${["a", "b", "c", "d"].map(host).join("")}</main>`,
      ),
      "a.html": comp("a", `<style media="(max-width: 10px">.pa{color:blue}</style>`),
      "b.html": comp("b", `<style>.pb{color:green}</style>`),
      "c.html": comp("c", `<style media="screen">@import "local.css"; .pc{color:red}</style>`),
      "d.html": comp(
        "d",
        `<style title="alt">.pd{color:black}</style><link rel="stylesheet" href="d.css" media="print" title="alt">`,
      ),
      "local.css": ".q{color:green}",
      "d.css": ".pd{color:white}",
    });
    const head = (html: string) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const styles = [...doc.head.querySelectorAll("style")]
        .filter((el) => /\.p[a-d]\b/.test(el.textContent ?? ""))
        .map((el) => ({
          media: el.getAttribute("media"),
          title: el.getAttribute("title"),
          css: (el.textContent ?? "").trim(),
        }));
      const links = [...doc.head.querySelectorAll('link[rel="stylesheet"]')].map((el) => ({
        media: el.getAttribute("media"),
        title: el.getAttribute("title"),
      }));
      return { styles, links };
    };
    const preview = head(await bundleToSingleHtml(dir));
    const render = head(
      (
        await compileForRender(dir, join(dir, "index.html"), join(dir, ".downloads"), {
          allowSystemFontCapture: false,
        })
      ).html,
    );
    const find = (id: string) => preview.styles.find((style) => style.css.includes(`.p${id}{`));
    expect(find("a")?.media).toBe("(max-width: 10px");
    expect(find("a")?.css).not.toContain(".pb{");
    expect(find("b")).toMatchObject({ media: null, title: null });
    expect(find("c")?.media).toBe("screen");
    expect(find("c")?.css.startsWith('@import "local.css"')).toBe(true);
    expect(find("d")).toMatchObject({ media: null, title: "alt" });
    expect(preview.links).toEqual([{ media: "print", title: "alt" }]);
    expect(render).toEqual(preview);
  });

  it("keeps each composition's link to a shared file under its own condition in preview, render and mount", async () => {
    const url = "https://cdn.example/shared.css";
    const host = (id: string) =>
      `<section data-composition-id="${id}" data-composition-src="${id}.html" data-start="0" data-duration="1"></section>`;
    const comp = (id: string, attrs: string) =>
      `<template id="${id}-template"><article data-composition-id="${id}" data-width="320" data-height="180"><link rel="stylesheet" href="${url}"${attrs}><p>x</p></article></template>`;
    const files = {
      "index.html": shell(
        `<main data-composition-id="main" data-start="0" data-width="320" data-height="180" data-duration="1">
          ${["a", "b", "c"].map(host).join("")}</main>`,
        `<link rel="stylesheet" href="${url}" title="alt">`,
      ),
      "a.html": comp("a", ' media="print"'),
      "b.html": comp("b", ""),
      "c.html": comp("c", ' media="print"'),
    };
    const dir = project(files);
    const links = (head: ParentNode) =>
      [...head.querySelectorAll(`link[href="${url}"]`)].map((el) => ({
        media: el.getAttribute("media"),
        title: el.getAttribute("title"),
      }));
    const parsedHead = (html: string) => new DOMParser().parseFromString(html, "text/html").head;
    const expected = [
      { media: null, title: "alt" },
      { media: "print", title: null },
      { media: null, title: null },
    ];
    expect(links(parsedHead(await bundleToSingleHtml(dir)))).toEqual(expected);
    const render = await compileForRender(dir, join(dir, "index.html"), join(dir, ".downloads"), {
      allowSystemFontCapture: false,
    });
    expect(links(parsedHead(render.html))).toEqual(expected);
    await mountContract(dir, files["index.html"]);
    expect(links(document.head)).toEqual(expected);
  });

  it("keeps legacy end/layer timing semantically identical", async () => {
    const result = await contracts({
      "index.html":
        shell(`<main data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="5">
        <div id="legacy" class="clip" data-start="1.5" data-end="4" data-layer="2">Legacy timing</div>
      </main>`),
    });
    expect(result.render).toEqual(result.preview);
  });

  it("keeps flattened sub-composition identity and variable bootstrap identical", async () => {
    const result = await contracts({
      "index.html":
        shell(`<main data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="6">
        <section id="card-host" data-composition-id="card" data-composition-src="compositions/card.html"
          data-start="1" data-duration="3" data-variable-values='{"title":"Pro"}'></section>
      </main>`),
      "compositions/card.html": `<template id="card-template">
        <article data-composition-id="card" data-width="800" data-height="600">
          <h2 id="card-title" class="parity-card">Card</h2>
          <style>@font-face { font-family: ParityBody; src: url(data:font/woff2;base64,d09GMgAB) format("woff2"); }
          .parity-card { --parity-contract: 2; font-family: ParityBody, sans-serif; }</style>
        </article>
      </template>
      <script>window.__timelines = window.__timelines || {};</script>`,
    });
    expect(result.render).toEqual(result.preview);
  });
});

const FONT_FACE = `@font-face { font-family: ParityBody; src: url(data:font/woff2;base64,d09GMgAB) format("woff2"); }`;

const anonymousCardHost = (body: string) => ({
  "index.html":
    shell(`<main data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="6">
      <section id="card-host" data-composition-src="compositions/card.html"
        data-start="1" data-duration="3"></section>
    </main>`),
  "compositions/card.html": body,
});

const cardHost = (body: string) => ({
  "index.html":
    shell(`<main data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="6">
      <section id="card-host" data-composition-id="card" data-composition-src="compositions/card.html"
        data-start="1" data-duration="3"></section>
    </main>`),
  "compositions/card.html": body,
});

/**
 * Every fixture here mounts a sub-composition, because the mount path only runs
 * for one. The set has to keep covering the shape that broke — see the
 * assertion below, which fails if a refactor quietly drops it.
 */
const MOUNT_PARITY_FIXTURES: { name: string; files: Record<string, string> }[] = [
  {
    name: "assets authored as siblings of the composition root",
    files: cardHost(`<template id="card-template">
      <style>${FONT_FACE}
      .parity-card { --parity-contract: 3; font-family: ParityBody, sans-serif; }</style>
      <article id="card-root" data-composition-id="card" data-width="800" data-height="600">
        <h2 class="parity-card">Card</h2>
      </article>
    </template>`),
  },
  {
    name: "assets authored inside the composition root",
    files: cardHost(`<template id="card-template">
      <article id="card-root" data-composition-id="card" data-width="800" data-height="600">
        <style>${FONT_FACE}
        .parity-card { --parity-contract: 4; font-family: ParityBody, sans-serif; }</style>
        <h2 class="parity-card">Card</h2>
      </article>
    </template>`),
  },
  {
    name: "a TEMPLATED composition hoisting a head stylesheet link",
    // The compiler used to hoist a <link> only for a non-templated
    // composition, so a templated one's webfont survived preview (the mount
    // path always hoisted) and vanished from the render.
    files: cardHost(`<!doctype html><html><head>
      <link rel="preconnect" href="https://fonts.example.com" />
      </head><body>
      <template id="card-template">
        <style>${FONT_FACE}
        .parity-card { --parity-contract: 6; font-family: ParityBody, sans-serif; }</style>
        <article id="card-root" data-composition-id="card" data-width="800" data-height="600">
          <h2 class="parity-card">Card</h2>
        </article>
      </template>
      </body></html>`),
  },
  {
    name: "an anonymous host scoping to the id its content declares",
    // A host naming no composition id. The mount path used to drop the
    // content in whole and unscoped, so this composition's CSS landed on the
    // host document at large; the compiler has always fallen back to the
    // first declared root and scoped to it.
    files: anonymousCardHost(`<template id="card-template">
      <style>${FONT_FACE}
      .parity-card { --parity-contract: 7; font-family: ParityBody, sans-serif; }</style>
      <article id="card-root" data-composition-id="card" data-width="800" data-height="600">
        <h2 class="parity-card">Card</h2>
      </article>
    </template>`),
  },
  {
    name: "a full-document composition hoisting a head stylesheet link",
    files: cardHost(`<!doctype html><html><head>
      <link rel="preconnect" href="https://fonts.example.com" />
      <style>${FONT_FACE}
      .parity-card { --parity-contract: 5; font-family: ParityBody, sans-serif; }</style>
      </head><body>
      <article id="card-root" data-composition-id="card" data-width="800" data-height="600">
        <h2 class="parity-card">Card</h2>
      </article>
      </body></html>`),
  },
];

/** True when a sub-composition authors a `<style>`/`<script>` outside its root. */
function hasRootSiblingAssets(subCompositionHtml: string): boolean {
  const doc = new DOMParser().parseFromString(subCompositionHtml, "text/html");
  const template = doc.querySelector("template");
  const scope: ParentNode = template ? template.content : doc.body;
  const root = scope.querySelector("[data-composition-id]");
  const assets = Array.from(scope.querySelectorAll("style, script"));
  return assets.length > 0 && assets.some((asset) => !root?.contains(asset));
}

const subCompositions = (files: Record<string, string>) =>
  Object.entries(files)
    .filter(([path]) => path !== "index.html")
    .map(([, content]) => content);

/**
 * The runtime's assembly is not a compiler, so two contract fields are outside
 * what this arm gates, and are asserted rather than compared:
 *
 * - `runtimeBootstrap` / `variableBootstrap` — the runtime IIFE and the variable
 *   bootstrap script are injected by the player and the producer AROUND a mount,
 *   never by `loadCompositions`. Comparing them would compare harnesses.
 *
 * Nothing else is excluded. The templated-head-`<link>` and anonymous-host
 * divergences are gated by fixtures above. Two divergences remain ungated HERE rather than
 * unfixed — an inline `<head>` script and the split between the CSS scope id
 * and the script scope id both live in script bodies, and this contract
 * carries no script-body field. Their gates are the unit suites in
 * `packages/core/src/{compiler,runtime}`.
 */
function assembledContract(contract: ParityContract) {
  const { runtimeBootstrap: _runtime, variableBootstrap: _variables, ...assembled } = contract;
  return assembled;
}

const CARD_HOST =
  '<div data-composition-id="card" data-composition-src="compositions/cards/card.html"></div>';
const comp = (id: string, inner = "") =>
  `<html><body><div data-composition-id="${id}">${inner}</div></body></html>`;
/** The nested fixture (index > scene > card) with extra index hosts and scene copies. */
const nested = (extraHosts: string, sceneCopies = 1, extraFiles: Record<string, string> = {}) => ({
  ...nestedCompositionPathFixture,
  "index.html": nestedCompositionPathFixture["index.html"]!.replace(
    '<div data-composition-id="scene"',
    `${extraHosts}<div data-composition-id="scene"`,
  ),
  "compositions/scene.html": comp("scene", CARD_HOST.repeat(sceneCopies)),
  ...extraFiles,
});

describe("mount/compile assembly parity", () => {
  it.each([
    { name: "a free authored id", files: nested(""), ids: ["card"] },
    { name: "an authored id collision", files: nested(CARD_HOST), ids: ["card", "card__hf1"] },
    {
      name: "a reserved suffix collision",
      files: nested(CARD_HOST + CARD_HOST.replace('"card"', '"card__hf1"')),
      ids: ["card", "card__hf1", "card__hf2"],
    },
    { name: "two copies inside one scene", files: nested("", 2), ids: ["card__hf1", "card__hf2"] },
    {
      name: "one card reused at two depths",
      files: nested(
        '<div data-composition-id="outer" data-composition-src="compositions/outer.html"></div>',
        1,
        {
          "compositions/outer.html": comp(
            "outer",
            '<div data-composition-id="sub" data-composition-src="compositions/sub.html"></div>',
          ),
          "compositions/sub.html": comp("sub", CARD_HOST),
        },
      ),
      ids: ["card__hf1", "card"],
    },
    {
      name: "an anonymous host before a late card",
      files: nested('<div data-composition-src="compositions/cards/card.html"></div>'),
      ids: [null, "card__hf1"],
    },
    {
      name: "an inline non-host element using the id",
      files: nested('<div data-composition-id="card"></div>'),
      ids: ["card__hf1"],
    },
    {
      name: "a scene that includes itself through a ./ path",
      files: {
        ...nested(""),
        "compositions/scene.html": comp(
          "scene",
          CARD_HOST +
            '<div data-composition-id="scene" data-composition-src="./compositions/scene.html"></div>',
        ),
      },
      ids: ["card"],
      refusal: "circular composition reference",
    },
    {
      name: "a late card whose id also names a root template",
      files: nested(
        '<template id="card-template"><div data-composition-id="card"><p>Template card</p></div></template>',
        1,
        {
          "compositions/cards/card.html": `<html data-composition-variables='[{"id":"title","type":"string","label":"Title","default":"DEF"}]'><body><div data-composition-id="card"><p data-proof>Project-root card</p></div></body></html>`,
        },
      ),
      ids: ["card"],
      variables: { card: { title: "DEF" } },
    },
    {
      name: "a root template host before a late card",
      files: nested(
        '<div data-composition-id="card"></div><template id="card-template"><div data-composition-id="card"><p data-proof>Project-root card</p></div></template>',
      ),
      ids: ["card", "card__hf1"],
    },
  ])(
    "mounts nested project-root paths with $name identically on all three paths",
    async ({ files, ids, refusal, variables }) => {
      const result = await contracts(files, refusal);
      expect(result.render).toEqual(result.preview);
      expect(assembledContract(result.mount)).toEqual(assembledContract(result.preview));
      const cards = [...document.querySelectorAll("[data-proof]")];
      expect(cards.map((card) => card.textContent)).toEqual(ids.map(() => "Project-root card"));
      const hostIds = cards.map((card) =>
        card.closest(`[${VARIABLE_HOST_ATTR}]`)?.getAttribute("data-composition-id"),
      );
      expect(hostIds).toEqual(ids);
      if (variables) {
        const byComp = (window as Window & { __hfVariablesByComp?: unknown }).__hfVariablesByComp;
        expect(byComp).toMatchObject(variables);
      }
    },
  );

  it("orders nested composition styles by host document order on all three paths", async () => {
    // Same-named @keyframes are page-wide, so the last one in the head wins.
    const comp = (id: string, inner: string, opacity: string) =>
      `<html><body><div data-composition-id="${id}"><style>@keyframes pop { to { opacity: ${opacity}; } }</style>${inner}</div></body></html>`;
    const host = (id: string) =>
      `<div data-composition-id="${id}" data-composition-src="compositions/${id}.html"></div>`;
    const result = await contracts({
      "index.html": shell(
        `<main data-composition-id="main" data-width="320" data-height="180">${host("s1")}${host("s2")}</main>`,
      ),
      "compositions/s1.html": comp("s1", host("card"), "0.1"),
      "compositions/card.html": comp("card", "", "0.2"),
      "compositions/s2.html": comp("s2", "", "0.3"),
    });
    const keyframes = (root: ParentNode) =>
      [...root.querySelectorAll("style")].flatMap((style) =>
        [
          ...(style.textContent ?? "").matchAll(/@keyframes\s+pop\s*\{[^}]*opacity:\s*([\d.]+)/g),
        ].map((match) => match[1]),
      );
    const parsed = (html: string) => new DOMParser().parseFromString(html, "text/html");
    const order = ["0.1", "0.2", "0.3"];
    expect(keyframes(parsed(result.html.preview))).toEqual(order);
    expect(keyframes(parsed(result.html.render))).toEqual(order);
    expect(keyframes(document)).toEqual(order);
  });

  const linked = (id: string, inner = "") =>
    `<html><head><link rel="stylesheet" href="https://cdn.example/${id}.css"><style>.x { --order: ${id}; }</style></head><body><div data-composition-id="${id}">${inner}</div></body></html>`;
  const external = (id: string) =>
    `<div data-composition-id="${id}" data-composition-src="compositions/${id}.html"></div>`;
  it.each([
    {
      name: "nested links",
      body: external("s1") + external("s2"),
      files: {
        "compositions/s1.html": linked("s1", external("card")),
        "compositions/card.html": linked("card"),
        "compositions/s2.html": linked("s2"),
      },
      order: ["link:s1", "style:s1", "link:card", "style:card", "link:s2", "style:s2"],
    },
    {
      name: "each link beside its own styles",
      body: external("a") + external("b"),
      files: { "compositions/a.html": linked("a"), "compositions/b.html": linked("b") },
      order: ["link:a", "style:a", "link:b", "style:b"],
    },
    {
      name: "a page template host before an external host",
      body:
        '<div data-composition-id="tpl"></div><template id="tpl-template"><div data-composition-id="tpl"><style>.x { --order: tpl; }</style></div></template>' +
        external("ext"),
      files: { "compositions/ext.html": linked("ext") },
      order: ["style:tpl", "link:ext", "style:ext"],
    },
  ])("orders head assets for $name by host on all three paths", async ({ body, files, order }) => {
    const result = await contracts({
      "index.html": shell(
        `<main data-composition-id="main" data-width="320" data-height="180">${body}</main>`,
      ),
      ...files,
    });
    const headOrder = (root: ParentNode) =>
      [...root.querySelectorAll('link[rel="stylesheet"], style')].flatMap((el) =>
        el.tagName === "LINK"
          ? [`link:${(el.getAttribute("href") ?? "").match(/([\w-]+)\.css$/)?.[1]}`]
          : [...(el.textContent ?? "").matchAll(/--order:\s*([\w-]+)/g)].map(
              (m) => `style:${m[1]}`,
            ),
      );
    const parsed = (html: string) => new DOMParser().parseFromString(html, "text/html");
    expect(headOrder(parsed(result.html.preview))).toEqual(order);
    expect(headOrder(document)).toEqual(order);
    // Render leaves page template hosts to its runtime, so read its head after that runtime ran.
    await mountContract(result.dir, result.html.render);
    expect(headOrder(document)).toEqual(order);
  });

  it("keeps a fixture set that still covers the shape the mount path used to drop", () => {
    expect(MOUNT_PARITY_FIXTURES.length).toBeGreaterThan(0);
    const siblingShaped = MOUNT_PARITY_FIXTURES.filter((fixture) =>
      subCompositions(fixture.files).some(hasRootSiblingAssets),
    );
    expect(siblingShaped.map((fixture) => fixture.name)).not.toHaveLength(0);
  });

  it.each(MOUNT_PARITY_FIXTURES)(
    "assembles $name identically on all three paths",
    async ({ files }) => {
      const result = await contracts(files);
      expect(result.render).toEqual(result.preview);
      expect(assembledContract(result.mount)).toEqual(assembledContract(result.preview));
      expect(result.mount.runtimeBootstrap).toBe(false);
      expect(result.mount.variableBootstrap).toBe(false);
    },
  );
});
