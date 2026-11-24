import { describe, expect, it } from "vitest";

import {
  carriesRuntime,
  ensureRuntimeBeforeBodyScripts,
  inlineRuntimeBeforeBodyScripts,
  withBaseHref,
} from "./runtime-in-srcdoc.js";

const URL = "https://cdn.example/hyperframe.runtime.iife.js";

/** What a pasted component looks like: it reads its variables during parse. */
const COMPONENT_PAGE = `<!doctype html><html><head><title>t</title></head><body>
<div data-hf-ui-root data-composition-variables='[{"id":"count","default":"3"}]'></div>
<script>var vars = window.__hyperframes && window.__hyperframes.getVariables
  ? window.__hyperframes.getVariables() : {};</script>
</body></html>`;

describe("ensureRuntimeBeforeBodyScripts", () => {
  it("puts the runtime ahead of the script that reads variables", () => {
    // The whole bug: the probe appended the runtime after load, so this guard
    // always took the empty branch and the component used its hardcoded
    // defaults. badge-pop with count 10 rendered 3.
    const out = ensureRuntimeBeforeBodyScripts(COMPONENT_PAGE, URL);

    expect(out).toContain(`<script src="${URL}"></script>`);
    expect(out.indexOf(URL)).toBeLessThan(out.indexOf("getVariables"));
  });

  it("puts it inside head, where an external script blocks the parser", () => {
    const out = ensureRuntimeBeforeBodyScripts(COMPONENT_PAGE, URL);

    // Landing after </head> would not block body parsing in the same way.
    expect(out.indexOf(URL)).toBeGreaterThan(out.indexOf("<head>"));
    expect(out.indexOf(URL)).toBeLessThan(out.indexOf("</head>"));
  });

  it("does not add a second copy when the page already links it", () => {
    const already = `<html><head><script src="${URL}"></script></head><body></body></html>`;

    expect(ensureRuntimeBeforeBodyScripts(already, URL)).toBe(already);
  });

  it("leaves a CLI-rendered page alone, which inlines the runtime already", () => {
    // The engine inlines it and defines the global on the way in. A second
    // copy would re-initialise the runtime underneath a live composition.
    const rendered = `<html><head><script>window.__hyperframes = {};</script></head><body></body></html>`;

    expect(ensureRuntimeBeforeBodyScripts(rendered, URL)).toBe(rendered);
  });

  it("falls back to before <body> when there is no head", () => {
    const out = ensureRuntimeBeforeBodyScripts("<html><body><script>x</script></body></html>", URL);

    expect(out.indexOf(URL)).toBeLessThan(out.indexOf("<body>"));
  });

  it("handles a bare fragment by going first", () => {
    const out = ensureRuntimeBeforeBodyScripts("<div>hi</div><script>x</script>", URL);

    expect(out.startsWith(`<script src="${URL}"></script>`)).toBe(true);
  });

  it("is a no-op on empty input", () => {
    expect(ensureRuntimeBeforeBodyScripts("", URL)).toBe("");
  });

  it("survives a head tag carrying attributes", () => {
    const out = ensureRuntimeBeforeBodyScripts(
      `<html><head lang="en" data-x><script>read()</script></head><body></body></html>`,
      URL,
    );

    expect(out.indexOf(URL)).toBeLessThan(out.indexOf("read()"));
  });

  it("does not mistake a longer tag name for head", () => {
    const out = ensureRuntimeBeforeBodyScripts(
      `<html><header><script>early()</script></header><body><script>read()</script></body></html>`,
      URL,
    );

    expect(out.indexOf(URL)).toBeLessThan(out.indexOf("<body>"));
    expect(out.indexOf(URL)).toBeGreaterThan(out.indexOf("</header>"));
  });
});

describe("carriesRuntime", () => {
  it("reads a script's own src, not text inside another attribute's quoted value", () => {
    expect(
      carriesRuntime(`<script data-note="see src=/hyperframe.runtime.iife.js"></script>`),
    ).toBe(false);
    expect(
      carriesRuntime(`<script data-note='a' src=/v1/hyperframe.runtime.iife.js></script>`),
    ).toBe(true);
  });
});

describe("inlineRuntimeBeforeBodyScripts", () => {
  it("puts the runtime's text ahead of the script that reads variables", () => {
    const out = inlineRuntimeBeforeBodyScripts(COMPONENT_PAGE, "window.__hyperframes = {};");

    expect(out).toContain("<head><script>window.__hyperframes = {};</script>");
    expect(out.indexOf("__hyperframes = {}")).toBeLessThan(out.indexOf("getVariables"));
  });

  it("adds no second copy to a page that links or inlines it", () => {
    const linked = `<html><head><script src="${URL}"></script></head><body></body></html>`;
    const inlined = inlineRuntimeBeforeBodyScripts(COMPONENT_PAGE, "window.__hyperframes = {};");

    expect(inlineRuntimeBeforeBodyScripts(linked, "window.__hyperframes = {};")).toBe(linked);
    expect(inlineRuntimeBeforeBodyScripts(inlined, "window.__hyperframes = {};")).toBe(inlined);
  });
});

describe("withBaseHref", () => {
  it("resolves the page's relative paths at the URL it came from, quoted safely", () => {
    const out = withBaseHref("<html><head></head></html>", 'https://site.example/a b/"x".html');

    expect(out).toBe(
      '<html><head><base href="https://site.example/a b/&quot;x&quot;.html"></head></html>',
    );
  });

  it("resolves a base the page names itself and puts it first", () => {
    const page = '<html><head><base href="media/"></head></html>';

    expect(withBaseHref(page, "https://site.example/film/")).toBe(
      '<html><head><base href="https://site.example/film/media/"><base href="media/"></head></html>',
    );
  });
});
