import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  enumerateNestedCompositionHosts,
  MAX_SUB_COMPOSITION_DEPTH,
  planCompositionAssembly,
  type CompositionAssemblyPlan,
} from "./compositionAssembly";

function parseComposition(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/**
 * Drive the module the way both real paths do: find the `<template>`, fall back
 * to `<body>`, and hand it the document's head and root element. The explicit
 * `<Element>` type argument is the whole point of the structural inputs — a
 * `DocumentFragment` and an `HTMLElement` both satisfy them without a cast.
 */
function planFor(html: string, compositionId: string | null): CompositionAssemblyPlan<Element> {
  const doc = parseComposition(html);
  const template = doc.querySelector("template");
  return planCompositionAssembly<Element>({
    contentNode: template ? template.content : doc.body,
    head: doc.head,
    documentElement: doc.documentElement,
    hasTemplate: Boolean(template),
    compositionId,
  });
}

const SIBLING_ASSETS = `
<html data-composition-variables='{"tone":"dark"}'>
  <head></head>
  <body>
    <template id="scene-template">
      <style id="sibling-style">#root { container-type: size; }</style>
      <div data-composition-id="scene" id="root" data-width="1920" data-height="1080"></div>
      <script id="sibling-script">window.__a = 1;</script>
    </template>
  </body>
</html>`;

const ROOT_INTERNAL_ASSETS = `
<html>
  <head></head>
  <body>
    <template id="scene-template">
      <div data-composition-id="scene" id="root">
        <style id="inner-style">#root { color: red; }</style>
        <script id="inner-script">window.__b = 1;</script>
      </div>
    </template>
  </body>
</html>`;

const BOTH_SHAPES = `
<html>
  <head></head>
  <body>
    <template id="scene-template">
      <style id="sibling-style">#root { container-type: size; }</style>
      <div data-composition-id="scene" id="root">
        <style id="inner-style">#root { color: red; }</style>
      </div>
    </template>
  </body>
</html>`;

const FULL_DOCUMENT = `
<html data-composition-variables='{"tone":"dark"}'>
  <head>
    <link rel="preconnect" href="https://fonts.example">
    <link rel="stylesheet" href="fonts.css">
    <link rel="icon" href="favicon.ico">
    <style id="head-style">body { background: black; }</style>
    <script id="head-script" src="https://cdn.example/gsap.js"></script>
  </head>
  <body>
    <div data-composition-id="scene" id="root" data-composition-variables='{"tone":"light"}'>
      <style id="body-style">#root { color: red; }</style>
    </div>
    <script id="body-script">window.__c = 1;</script>
  </body>
</html>`;

const ids = (elements: Element[]): string[] => elements.map((el) => el.getAttribute("id") || "");

describe("planCompositionAssembly", () => {
  it("reports assets authored as siblings of the composition root inside <template>", () => {
    // This is the original defect: collecting from the composition root alone
    // dropped the whole stylesheet on mount while the render stayed correct.
    const plan = planFor(SIBLING_ASSETS, "scene");

    expect(ids(plan.styleSources)).toEqual(["sibling-style"]);
    expect(ids(plan.scriptSources)).toEqual(["sibling-script"]);
    expect(plan.styleSources[0]?.textContent).toContain("container-type: size");
  });

  it("reports assets authored inside the composition root", () => {
    const plan = planFor(ROOT_INTERNAL_ASSETS, "scene");

    expect(ids(plan.styleSources)).toEqual(["inner-style"]);
    expect(ids(plan.scriptSources)).toEqual(["inner-script"]);
  });

  it("reports both shapes once each, in document order", () => {
    const plan = planFor(BOTH_SHAPES, "scene");

    expect(ids(plan.styleSources)).toEqual(["sibling-style", "inner-style"]);
  });

  it("reports body assets for a composition with no <template>", () => {
    const plan = planFor(FULL_DOCUMENT, "scene");

    expect(ids(plan.styleSources)).toContain("body-style");
    expect(ids(plan.scriptSources)).toContain("body-script");
  });

  it("orders head-sourced assets before content-sourced ones", () => {
    const plan = planFor(FULL_DOCUMENT, "scene");

    expect(ids(plan.styleSources)).toEqual(["head-style", "body-style"]);
    expect(ids(plan.scriptSources)).toEqual(["head-script", "body-script"]);
  });

  it("does not treat a templated composition's page head as an asset source", () => {
    // The head belongs to the host page, not to the composition; only the
    // non-templated (full-document) shape carries composition assets in <head>.
    const plan = planFor(
      SIBLING_ASSETS.replace("<head></head>", '<head><style id="page-style">a{}</style></head>'),
      "scene",
    );

    expect(ids(plan.styleSources)).toEqual(["sibling-style"]);
  });

  it("hoists stylesheet and preconnect links from <head> and nothing else", () => {
    const plan = planFor(FULL_DOCUMENT, "scene");

    expect(plan.linkSources.map((link) => link.getAttribute("href"))).toEqual([
      "https://fonts.example",
      "fonts.css",
    ]);
  });

  it("identifies the composition from the host id, matching the root exactly", () => {
    const plan = planFor(SIBLING_ASSETS, "scene");

    expect(plan.innerRoot?.getAttribute("data-composition-id")).toBe("scene");
    expect(plan.authoredCompositionId).toBe("scene");
    expect(plan.scriptCompositionId).toBe("scene");
    expect(plan.authoredRootId).toBe("root");
  });

  it("keeps CSS on the host id and scripts on the declared id when they disagree", () => {
    // A `captions-comp` host mounting a `captions` template: there is no exact
    // root match, so nothing is flattened, but the script's self-referencing
    // querySelector still has to resolve against the id the content declares.
    const plan = planFor(SIBLING_ASSETS, "scene-comp");

    expect(plan.innerRoot).toBeNull();
    expect(plan.authoredCompositionId).toBe("scene-comp");
    expect(plan.scriptCompositionId).toBe("scene");
    expect(plan.authoredRootId).toBeNull();
  });

  it("falls back to the first declared root for an anonymous host", () => {
    const plan = planFor(SIBLING_ASSETS, null);

    expect(plan.innerRoot?.getAttribute("id")).toBe("root");
    expect(plan.authoredCompositionId).toBe("scene");
  });

  it("reports both the document element and the inner root as variable carriers", () => {
    const plan = planFor(FULL_DOCUMENT, "scene");

    expect(plan.variableDefaultCarriers).toHaveLength(2);
    expect(plan.variableDefaultCarriers[0]?.tagName.toLowerCase()).toBe("html");
    expect(plan.variableDefaultCarriers[1]?.getAttribute("id")).toBe("root");
    // Precedence order, lowest first: the inner root's declaration wins.
    expect(plan.variableDefaultCarriers[1]?.getAttribute("data-composition-variables")).toContain(
      "light",
    );
  });

  it("reports only the document element when the content declares no root", () => {
    const plan = planFor(
      `<html><head></head><body><template id="scene-template"><p>no root</p></template></body></html>`,
      "scene",
    );

    expect(plan.innerRoot).toBeNull();
    expect(plan.variableDefaultCarriers).toHaveLength(1);
    expect(plan.authoredCompositionId).toBe("scene");
  });
});

describe("enumerateNestedCompositionHosts", () => {
  const assembled = (html: string): Element => {
    const doc = parseComposition(`<html><body><div id="host">${html}</div></body></html>`);
    const host = doc.getElementById("host");
    if (!host) throw new Error("fixture host missing");
    return host;
  };

  it("enumerates every nested host in document order", () => {
    const host = assembled(
      `<div data-composition-src="child-a.html"></div><div data-composition-src="child-b.html"></div>`,
    );

    const { hosts, skipped } = enumerateNestedCompositionHosts(host, ["outer.html"]);

    expect(hosts.map((entry) => entry.src)).toEqual(["child-a.html", "child-b.html"]);
    expect(hosts[0]?.host.getAttribute("data-composition-src")).toBe("child-a.html");
    expect(skipped).toEqual([]);
  });

  it("skips a src already in its own ancestry instead of recursing forever", () => {
    const host = assembled(`<div data-composition-src="outer.html"></div>`);

    const { hosts, skipped } = enumerateNestedCompositionHosts(host, ["outer.html"]);

    expect(hosts).toEqual([]);
    expect(skipped).toEqual([{ src: "outer.html", reason: "circular composition reference" }]);
  });

  it("stops at the depth cap", () => {
    const host = assembled(`<div data-composition-src="deep.html"></div>`);
    const atCap = Array.from({ length: MAX_SUB_COMPOSITION_DEPTH }, (_, i) => `level-${i}.html`);

    const { hosts, skipped } = enumerateNestedCompositionHosts(host, atCap);

    expect(hosts).toEqual([]);
    expect(skipped).toEqual([{ src: "deep.html", reason: "nesting depth exceeded" }]);
  });

  it("ignores a host whose src attribute is empty", () => {
    const host = assembled(`<div data-composition-src=""></div>`);

    expect(enumerateNestedCompositionHosts(host, ["outer.html"])).toEqual({
      hosts: [],
      skipped: [],
    });
  });
});

describe("import surface", () => {
  it("imports nothing that the CDN runtime bundle must not carry", () => {
    // The runtime ships as an esbuild IIFE. A DOM, filesystem, or cross-package
    // import here would ride along, so assert the module's own source rather
    // than trusting a comment.
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, "compositionAssembly.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const specifiers = Array.from(code.matchAll(/\bfrom\s+["']([^"']+)["']/g)).map(
      (match) => match[1] ?? "",
    );

    expect(specifiers).toEqual([]);
    expect(code).not.toMatch(/\brequire\s*\(/);
    // No ambient DOM or Node globals either — the structural inputs exist so
    // this module never needs them.
    expect(code).not.toMatch(/\b(document|window|globalThis|process|fetch)\s*[.[]/);
  });
});
