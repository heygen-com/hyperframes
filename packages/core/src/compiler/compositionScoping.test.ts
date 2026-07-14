import { describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import {
  scopeCssToComposition,
  wrapInlineScriptWithErrorBoundary,
  wrapScopedCompositionScript,
} from "./compositionScoping";

describe("composition scoping", () => {
  it("scopes regular selectors while preserving global at-rules", () => {
    const scoped = scopeCssToComposition(
      `
@import url("https://example.com/font.css");
.title, .card:hover { opacity: 0; }
@media (min-width: 800px) {
  .title { transform: translateY(30px); }
}
@keyframes rise {
  from { opacity: 0; }
  to { opacity: 1; }
}
[data-composition-id="scene"] .already { color: red; }
body { margin: 0; }
`,
      "scene",
    );

    expect(scoped).toContain('@import url("https://example.com/font.css");');
    expect(scoped).toContain(
      '[data-composition-id="scene"] .title, [data-composition-id="scene"] .card:hover',
    );
    expect(scoped).toContain('[data-composition-id="scene"] .title { transform');
    expect(scoped).toContain("@keyframes rise");
    expect(scoped).toContain("from { opacity: 0; }");
    expect(scoped).toContain('[data-composition-id="scene"] .already { color: red; }');
    expect(scoped).toContain("body { margin: 0; }");
  });

  it("leaves html/body/:root untouched by default (top-level composition owns the document)", () => {
    const scoped = scopeCssToComposition(
      `html, body { width: 560px; height: 360px; overflow: hidden; }\n:root { --x: 1; }`,
      "scene",
    );
    expect(scoped).toContain("html, body { width: 560px");
    expect(scoped).toContain(":root { --x: 1; }");
  });

  it("remaps html/body/:root to the composition box when scopeRootSelectors is set (sub-comp mount/inline)", () => {
    const scoped = scopeCssToComposition(
      `html, body { width: 560px; height: 360px; overflow: hidden; background: #14141c; }\n:root { color: red; }\n.title { opacity: 0; }`,
      "scene",
      undefined,
      undefined,
      { scopeRootSelectors: true },
    );
    // No bare document-level selectors survive — they must not clobber the host document's body.
    expect(scoped).not.toMatch(/(^|[\s,{})])html\s*[,{]/);
    expect(scoped).not.toMatch(/(^|[\s,{})]):root\s*\{/);
    expect(scoped).not.toMatch(/(^|[\s,{}])body\s*\{/);
    // They are remapped to the composition's own box (host or flattened inner root).
    expect(scoped).toContain('[data-composition-id="scene"]');
    expect(scoped).toContain("data-hf-inner-root");
    expect(scoped).toContain("width: 560px");
    // Regular selectors still scope as usual.
    expect(scoped).toContain('[data-composition-id="scene"] .title { opacity: 0; }');
  });

  it("does not scope the universal selector even with scopeRootSelectors", () => {
    const scoped = scopeCssToComposition(
      `* { box-sizing: border-box; }`,
      "scene",
      undefined,
      undefined,
      {
        scopeRootSelectors: true,
      },
    );
    expect(scoped).toContain("* { box-sizing: border-box; }");
  });

  it("pins the concrete parent-body clobber pattern that motivated the fix", () => {
    // The exact sub-comp rule that used to shrink the host <body> and clip the
    // preview. Assert the concrete remapped output, not just abstract shape, so a
    // future rewrite that reorders/splits declarations can't leave the shape
    // assertions green while re-breaking this case.
    const scoped = scopeCssToComposition(
      `html, body { width: 560px; height: 360px; overflow: hidden; background: #14141c; }`,
      "scene",
      undefined,
      undefined,
      { scopeRootSelectors: true },
    );
    expect(scoped).toContain('[data-composition-id="scene"]:not(:has([data-hf-inner-root]))');
    expect(scoped).toContain('[data-composition-id="scene"] > [data-hf-inner-root]');
    expect(scoped).toContain("width: 560px");
    expect(scoped).toContain("overflow: hidden");
  });

  it("wraps classic scripts without render-loop requestAnimationFrame waits", () => {
    const wrapped = wrapScopedCompositionScript("window.__ran = true;", "scene");

    expect(wrapped).toContain('var __hfCompId = "scene";');
    expect(wrapped).toContain("new Proxy(window.document");
    expect(wrapped).toContain("new Proxy(__hfBaseGsap");
    expect(wrapped).not.toContain("requestAnimationFrame");
  });

  it("normalizes root timing attributes when scoping selectors", () => {
    const scoped = scopeCssToComposition(
      '[data-composition-id="scene"][data-start="0"] .title { opacity: 0; }',
      "scene",
    );

    expect(scoped).toContain('[data-composition-id="scene"] .title { opacity: 0; }');
    expect(scoped).not.toContain('[data-start="0"]');
  });

  it("exposes a scoped __hyperframes.getVariables that reads __hfVariablesByComp[compId]", () => {
    const { document } = parseHTML(`<div data-composition-id="card-1"></div>`);
    const fakeWindow: Record<string, unknown> = {
      document,
      __timelines: {},
      __hfVariablesByComp: {
        "card-1": { title: "Pro", price: "$29" },
        "card-2": { title: "Enterprise", price: "Custom" },
      },
      __hyperframes: {
        getVariables: () => ({ title: "TOP-LEVEL-LEAK" }),
        fitTextFontSize: () => undefined,
      },
    };
    const wrapped = wrapScopedCompositionScript(
      `window.__captured = __hyperframes.getVariables();`,
      "card-1",
    );

    new Function("window", wrapped)(fakeWindow);

    expect(fakeWindow.__captured).toEqual({ title: "Pro", price: "$29" });
  });

  it("routes the documented window.__hyperframes.getVariables() to the scoped variant too", () => {
    // Regression: the docs (variables-and-media.md) show `window.__hyperframes.
    // getVariables()`, but inside a sub-comp the scoped `window` proxy used to
    // fall through to the HOST page's base __hyperframes, returning the wrong
    // (or empty) variables — the bare `__hyperframes` param was the only form
    // that worked. Both spellings must now resolve to this comp's variables.
    const { document } = parseHTML(`<div data-composition-id="card-1"></div>`);
    const fakeWindow: Record<string, unknown> = {
      document,
      __timelines: {},
      __hfVariablesByComp: {
        "card-1": { title: "Pro", price: "$29" },
        "card-2": { title: "Enterprise", price: "Custom" },
      },
      __hyperframes: {
        getVariables: () => ({ title: "TOP-LEVEL-LEAK" }),
        fitTextFontSize: () => undefined,
      },
    };
    const wrapped = wrapScopedCompositionScript(
      `window.__captured = window.__hyperframes.getVariables();`,
      "card-1",
    );

    new Function("window", wrapped)(fakeWindow);

    expect(fakeWindow.__captured).toEqual({ title: "Pro", price: "$29" });
  });

  it("preserves non-getVariables members on window.__hyperframes (only getVariables is rescoped)", () => {
    const { document } = parseHTML(`<div data-composition-id="card-1"></div>`);
    let fitCalled = false;
    const fakeWindow: Record<string, unknown> = {
      document,
      __timelines: {},
      __hfVariablesByComp: { "card-1": { title: "Pro" } },
      __hyperframes: {
        getVariables: () => ({ title: "TOP-LEVEL-LEAK" }),
        fitTextFontSize: () => {
          fitCalled = true;
        },
      },
    };
    const wrapped = wrapScopedCompositionScript(
      `window.__hyperframes.fitTextFontSize();`,
      "card-1",
    );

    new Function("window", wrapped)(fakeWindow);

    expect(fitCalled).toBe(true);
  });

  it("scoped getVariables reads from the runtime composition id when it differs", () => {
    const { document } = parseHTML(`<div data-composition-id="scene"></div>`);
    const fakeWindow: Record<string, unknown> = {
      document,
      __timelines: {},
      __hfVariablesByComp: {
        scene: { title: "Wrong" },
        scene__hf1: { title: "Right" },
      },
      __hyperframes: {
        getVariables: () => ({ title: "TOP-LEVEL-LEAK" }),
        fitTextFontSize: () => undefined,
      },
    };
    const wrapped = wrapScopedCompositionScript(
      `window.__captured = __hyperframes.getVariables();`,
      "scene",
      "[HyperFrames] composition script error:",
      undefined,
      "scene__hf1",
    );

    new Function("window", wrapped)(fakeWindow);

    expect(fakeWindow.__captured).toEqual({ title: "Right" });
  });

  it("scoped getVariables returns {} when __hfVariablesByComp has no entry for the comp", () => {
    const { document } = parseHTML(`<div data-composition-id="missing"></div>`);
    const fakeWindow: Record<string, unknown> = {
      document,
      __timelines: {},
      __hyperframes: {
        getVariables: () => ({ title: "TOP-LEVEL-LEAK" }),
        fitTextFontSize: () => undefined,
      },
    };
    const wrapped = wrapScopedCompositionScript(
      `window.__captured = __hyperframes.getVariables();`,
      "missing",
    );

    new Function("window", wrapped)(fakeWindow);

    expect(fakeWindow.__captured).toEqual({});
  });

  it("scoped getVariables returns a fresh object — mutations don't leak into the shared table", () => {
    const { document } = parseHTML(`<div data-composition-id="card-1"></div>`);
    const variablesByComp: Record<string, Record<string, unknown>> = {
      "card-1": { title: "Pro" },
    };
    const fakeWindow: Record<string, unknown> = {
      document,
      __timelines: {},
      __hfVariablesByComp: variablesByComp,
      __hyperframes: {
        getVariables: () => ({}),
        fitTextFontSize: () => undefined,
      },
    };
    const wrapped = wrapScopedCompositionScript(
      `var v = __hyperframes.getVariables(); v.title = "MUTATED"; v.added = "extra";`,
      "card-1",
    );

    new Function("window", wrapped)(fakeWindow);

    expect(variablesByComp["card-1"]).toEqual({ title: "Pro" });
  });

  it("preserves static methods on classes exposed through window", () => {
    const { document } = parseHTML(`<div data-composition-id="scene"></div>`);
    class FakeTexts {
      static mountChars() {
        return "ok";
      }
    }
    const fakeWindow: Record<string, unknown> = {
      document,
      __timelines: {},
      Texts: FakeTexts,
    };
    const wrapped = wrapScopedCompositionScript(
      `window.__capturedMountCharsType = typeof window.Texts?.mountChars;`,
      "scene",
    );

    new Function("window", wrapped)(fakeWindow);

    expect(fakeWindow.__capturedMountCharsType).toBe("function");
  });

  it("executes document and GSAP selectors inside the composition root", () => {
    const { document } = parseHTML(`
      <div data-composition-id="scene" data-start="intro"><h1 class="title">Scene</h1></div>
      <div data-composition-id="other"><h1 class="title">Other</h1></div>
    `);
    const gsapTargets: string[][] = [];
    const fakeWindow = {
      document,
      __selectedTitle: "",
      __selectedRootTitle: "",
      __timelines: {},
      gsap: {
        timeline: () => ({
          to(targets: Element[]) {
            gsapTargets.push(Array.from(targets).map((target) => target.textContent || ""));
            return this;
          },
        }),
      },
    };
    const wrapped = wrapScopedCompositionScript(
      `
const tl = gsap.timeline({ paused: true });
tl.to('.title', { opacity: 1 });
tl.to('[data-composition-id="scene"][data-start="0"] .title', { opacity: 1 });
window.__selectedTitle = document.querySelector('.title')?.textContent || '';
window.__selectedRootTitle = document.querySelector('[data-composition-id="scene"][data-start="0"] .title')?.textContent || '';
window.__timelines.scene = tl;
`,
      "scene",
    );

    new Function("window", "gsap", wrapped)(fakeWindow, fakeWindow.gsap);

    expect(fakeWindow.__selectedTitle).toBe("Scene");
    expect(fakeWindow.__selectedRootTitle).toBe("Scene");
    expect(gsapTargets).toEqual([["Scene"], ["Scene"]]);
  });

  it("scopes getElementById when duplicate IDs exist across composition roots", () => {
    const { document } = parseHTML(`
      <div data-composition-id="scene-a"><canvas id="gl-canvas"></canvas></div>
      <div data-composition-id="scene-b"><canvas id="gl-canvas"></canvas></div>
    `);
    const fakeWindow = {
      document,
      __selectedComp: "",
      __timelines: {},
    };
    const wrapped = wrapScopedCompositionScript(
      `
window.__selectedComp =
  document.getElementById("gl-canvas")
    ?.closest("[data-composition-id]")
    ?.getAttribute("data-composition-id") || "null";
`,
      "scene-b",
    );

    new Function("window", wrapped)(fakeWindow);

    expect(fakeWindow.__selectedComp).toBe("scene-b");
  });

  it("scopes getElementById for IDs that need CSS selector escaping", () => {
    const { document } = parseHTML(`
      <div data-composition-id="scene-a"><div id="clip:1"></div></div>
      <div data-composition-id="scene-b"><div id="clip:1"></div></div>
    `);
    const fakeWindow = {
      document,
      __selectedComp: "",
      __timelines: {},
    };
    const wrapped = wrapScopedCompositionScript(
      `
window.__selectedComp =
  document.getElementById("clip:1")
    ?.closest("[data-composition-id]")
    ?.getAttribute("data-composition-id") || "null";
`,
      "scene-b",
    );

    new Function("window", wrapped)(fakeWindow);

    expect(fakeWindow.__selectedComp).toBe("scene-b");
  });

  it("scopes authored root id lookups after the flattened root drops its literal id", () => {
    const { document } = parseHTML(`
      <div data-composition-id="scene">
        <div data-hf-authored-id="scene-root">
          <h1 class="title">Scene</h1>
        </div>
      </div>
    `);
    const fakeWindow = {
      document,
      __selectedTitle: "",
      __timelines: {},
    };
    const wrapped = wrapScopedCompositionScript(
      `
window.__selectedTitle =
  document.getElementById("scene-root")
    ?.querySelector(".title")
    ?.textContent || "missing";
`,
      "scene",
      "[HyperFrames] composition script error:",
      undefined,
      "scene",
      "scene-root",
    );

    new Function("window", wrapped)(fakeWindow);

    expect(fakeWindow.__selectedTitle).toBe("Scene");
  });

  it("does not rewrite authored root hash text inside CSS attribute values", () => {
    const scoped = scopeCssToComposition(
      'a[href="#scene-root"] { color: red; }',
      "scene",
      undefined,
      "scene-root",
    );

    expect(scoped).toContain('[data-composition-id="scene"] a[href="#scene-root"]');
    expect(scoped).not.toContain('[href="[data-hf-authored-id=');
  });

  it("does not rewrite authored root hash text inside querySelector attribute values", () => {
    const { document } = parseHTML(`
      <div data-composition-id="scene">
        <a class="jump" href="#scene-root">Jump</a>
        <div data-hf-authored-id="scene-root"></div>
      </div>
    `);
    const fakeWindow = {
      document,
      __selectedHref: "",
      __timelines: {},
    };
    const wrapped = wrapScopedCompositionScript(
      `
window.__selectedHref =
  document.querySelector('a[href="#scene-root"]')
    ?.getAttribute("href") || "missing";
`,
      "scene",
      "[HyperFrames] composition script error:",
      undefined,
      "scene",
      "scene-root",
    );

    new Function("window", wrapped)(fakeWindow);

    expect(fakeWindow.__selectedHref).toBe("#scene-root");
  });

  it("normalizes gsap.utils.selector() selectors for authored root ids and root timing attrs", () => {
    const { document } = parseHTML(`
      <div data-composition-id="scene" data-start="0">
        <div data-hf-authored-id="scene-root">
          <h1 class="title">Scene</h1>
        </div>
      </div>
      <div data-composition-id="other" data-start="0">
        <div data-hf-authored-id="scene-root">
          <h1 class="title">Other</h1>
        </div>
      </div>
    `);
    const fakeWindow = {
      document,
      __selectedRootCount: 0,
      __selectedTimedCount: 0,
      __selectedTitle: "",
      __timelines: {},
      gsap: {
        utils: {},
      },
    };
    const wrapped = wrapScopedCompositionScript(
      `
const select = gsap.utils.selector(document.querySelector('[data-composition-id="scene"]'));
window.__selectedRootCount = select('#scene-root').length;
window.__selectedTimedCount = select('[data-composition-id="scene"][data-start="0"] .title').length;
window.__selectedTitle = select('#scene-root .title')[0]?.textContent || "missing";
`,
      "scene",
      "[HyperFrames] composition script error:",
      undefined,
      "scene",
      "scene-root",
    );

    new Function("window", "gsap", wrapped)(fakeWindow, fakeWindow.gsap);

    expect(fakeWindow.__selectedRootCount).toBe(1);
    expect(fakeWindow.__selectedTimedCount).toBe(1);
    expect(fakeWindow.__selectedTitle).toBe("Scene");
  });

  it("reads scoped proxy accessors with the original target receiver", () => {
    const root = {
      contains(node: unknown) {
        return node === root;
      },
    };
    const body = { tagName: "BODY" };
    const fakeDocument = {
      querySelector(selector: string) {
        return selector === '[data-composition-id="scene"]' ? root : null;
      },
      querySelectorAll() {
        return [];
      },
      getElementById() {
        return null;
      },
      get body() {
        if (this !== fakeDocument) {
          throw new TypeError("Illegal invocation");
        }
        return body;
      },
    };
    const location = { href: "https://example.test/scene" };
    const fakeUtils = {
      get marker() {
        if (this !== fakeUtils) {
          throw new TypeError("Illegal invocation");
        }
        return "utils-ok";
      },
    };
    const fakeGsap = {
      utils: fakeUtils,
      get version() {
        if (this !== fakeGsap) {
          throw new TypeError("Illegal invocation");
        }
        return "gsap-ok";
      },
    };
    const fakeWindow = {
      document: fakeDocument,
      __bodyTag: "",
      __href: "",
      __windowSet: "",
      __gsapVersion: "",
      __utilsMarker: "",
      __timelines: {},
      gsap: fakeGsap,
      get location() {
        if (this !== fakeWindow) {
          throw new TypeError("Illegal invocation");
        }
        return location;
      },
      set customValue(value: string) {
        if (this !== fakeWindow) {
          throw new TypeError("Illegal invocation");
        }
        this.__windowSet = value;
      },
    };
    const wrapped = wrapScopedCompositionScript(
      `
window.__bodyTag = document.body.tagName;
window.__href = window.location.href;
window.customValue = "window-set-ok";
window.__gsapVersion = gsap.version;
window.__utilsMarker = gsap.utils.marker;
`,
      "scene",
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      new Function("window", "gsap", wrapped)(fakeWindow, fakeWindow.gsap);
    } finally {
      errorSpy.mockRestore();
    }

    expect(fakeWindow.__bodyTag).toBe("BODY");
    expect(fakeWindow.__href).toBe("https://example.test/scene");
    expect(fakeWindow.__windowSet).toBe("window-set-ok");
    expect(fakeWindow.__gsapVersion).toBe("gsap-ok");
    expect(fakeWindow.__utilsMarker).toBe("utils-ok");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("reads and dual-publishes remapped timelines without replacing the registry", () => {
    let timeline = "initial";
    const timelineRegistry = {
      get host() {
        if (this !== timelineRegistry) {
          throw new TypeError("Illegal invocation");
        }
        return timeline;
      },
      set host(value: string) {
        if (this !== timelineRegistry) {
          throw new TypeError("Illegal invocation");
        }
        timeline = value;
      },
    };
    const fakeWindow = {
      document: {
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
      },
      __timelines: timelineRegistry,
      __beforeTimeline: "",
      __afterTimeline: "",
      gsap: {},
    };
    const wrapped = wrapScopedCompositionScript(
      `
window.__beforeTimeline = window.__timelines.scene;
window.__timelines.scene = "updated";
window.__afterTimeline = window.__timelines.scene;
`,
      "scene",
      "[HyperFrames] composition script error:",
      undefined,
      "host",
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      new Function("window", "gsap", wrapped)(fakeWindow, fakeWindow.gsap);
    } finally {
      errorSpy.mockRestore();
    }

    expect(fakeWindow.__beforeTimeline).toBe("initial");
    expect(fakeWindow.__afterTimeline).toBe("updated");
    expect(Reflect.get(timelineRegistry, "scene")).toBe("updated");
    expect(fakeWindow.__timelines).toBe(timelineRegistry);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("uses compound selector when authored root is the scoped element itself", () => {
    const scoped = scopeCssToComposition(
      "#chrome-overlay-root { --primary: #FFDC8B; }",
      "chrome-overlay",
      undefined,
      "chrome-overlay-root",
      { compoundAuthoredRoot: true },
    );

    // Both attributes are on the same element after inlining, so the selector
    // must be compound (no space) to match.
    expect(scoped).toContain(
      '[data-composition-id="chrome-overlay"][data-hf-authored-id="chrome-overlay-root"]',
    );
    expect(scoped).not.toContain(
      '[data-composition-id="chrome-overlay"] [data-hf-authored-id="chrome-overlay-root"]',
    );
  });

  it("uses compound selector for authored root with descendant combinators", () => {
    const scoped = scopeCssToComposition(
      "#chrome-overlay-root .chrome { display: flex; }",
      "chrome-overlay",
      undefined,
      "chrome-overlay-root",
      { compoundAuthoredRoot: true },
    );

    // The authored root part is compound with scope, .chrome is a descendant
    expect(scoped).toContain(
      '[data-composition-id="chrome-overlay"][data-hf-authored-id="chrome-overlay-root"] .chrome',
    );
    expect(scoped).not.toMatch(
      /\[data-composition-id="chrome-overlay"\]\s+\[data-hf-authored-id="chrome-overlay-root"\]\s+\.chrome/,
    );
  });

  it("still uses descendant selector for non-root selectors with authoredRootId", () => {
    const scoped = scopeCssToComposition(
      ".child-element { color: red; }",
      "chrome-overlay",
      undefined,
      "chrome-overlay-root",
    );

    // Regular child selectors still get a descendant combinator (space)
    expect(scoped).toContain('[data-composition-id="chrome-overlay"] .child-element');
  });

  it("escapes </script> in scoped composition script source to prevent injection", () => {
    const wrapped = wrapScopedCompositionScript(
      'window.payload = "</script><script>window.pwned = true;</script>";',
      "scene",
    );

    expect(wrapped).toContain("(function(document, gsap, window, __hyperframes)");
    expect(wrapped).not.toContain("</script><script>");
    expect(wrapped).toContain("<\\/script>");
  });

  it("wraps unscoped composition script source as a string literal", () => {
    const wrapped = wrapInlineScriptWithErrorBoundary(
      'window.payload = "</script><script>window.pwned = true;</script>";',
      "[HyperFrames] composition script error:",
    );

    expect(wrapped).toContain("Function(");
    expect(wrapped).toContain('\\"</script><script>window.pwned = true;</script>\\"');
  });

  it("rewrites #id CSS selectors to [data-hf-authored-id] when authoredRootId is provided", () => {
    const scoped = scopeCssToComposition(
      `#intro { background: #111; }
#intro .title { font-size: 120px; color: #fff; }`,
      "intro",
      undefined,
      "intro",
    );

    // #intro should become [data-hf-authored-id="intro"]
    expect(scoped).toContain('[data-hf-authored-id="intro"]');
    expect(scoped).toContain('[data-hf-authored-id="intro"] .title');
    // Raw #intro selectors should be gone
    expect(scoped).not.toMatch(/#intro\b/);
  });

  it("rewrites a bare root [data-composition-id] box selector to target exactly one of host or wrapper", () => {
    // A composition styling its own box (e.g. `display:flex` to center its
    // children, or `padding` to offset it) via the bare composition-id
    // selector. After flattenInnerRoot preserves the authored root as a
    // wrapper below the host, that wrapper (marked data-hf-inner-root) is
    // what actually parents the real children, so the box styling must land
    // there instead of the host. It must land on exactly one of the two:
    // targeting both would apply an additive property like `padding` twice,
    // since the wrapper is nested inside the host.
    const scoped = scopeCssToComposition(
      '[data-composition-id="captions"] { display: flex; justify-content: center; }',
      "captions",
    );

    expect(scoped).toContain(
      '[data-composition-id="captions"]:not(:has([data-hf-inner-root])), ' +
        '[data-composition-id="captions"] > [data-hf-inner-root]',
    );
  });

  it("matches exactly the wrapper (not the host too) when both exist in the flattened DOM shape", () => {
    // Regression test: an earlier version of this fix targeted both the host
    // and the wrapper (a plain OR), which doubles any additive property
    // (e.g. padding-top) since the wrapper is nested inside the host.
    const scoped = scopeCssToComposition(
      '[data-composition-id="captions"] { padding-top: 200px; }',
      "captions",
    );
    const ruleMatch = scoped.match(/([^{]+)\{/);
    const selectorText = ruleMatch?.[1]?.trim();
    if (!selectorText) throw new Error("expected a CSS rule to be produced");

    const { document } = parseHTML(
      '<div id="host" data-composition-id="captions">' +
        '<div id="wrapper" data-hf-inner-root="true"></div>' +
        "</div>",
    );
    const matches = [...document.querySelectorAll(selectorText)];
    expect(matches.map((el) => el.id)).toEqual(["wrapper"]);
  });

  it("matches the host when no wrapper is present (non-flattened fallback)", () => {
    const scoped = scopeCssToComposition(
      '[data-composition-id="captions"] { padding-top: 200px; }',
      "captions",
    );
    const ruleMatch = scoped.match(/([^{]+)\{/);
    const selectorText = ruleMatch?.[1]?.trim();
    if (!selectorText) throw new Error("expected a CSS rule to be produced");

    const { document } = parseHTML('<div id="host" data-composition-id="captions"></div>');
    const matches = [...document.querySelectorAll(selectorText)];
    expect(matches.map((el) => el.id)).toEqual(["host"]);
  });

  it("leaves root-plus-descendant [data-composition-id] selectors as a plain scope prefix", () => {
    const scoped = scopeCssToComposition(
      '[data-composition-id="captions"] .title { color: red; }',
      "captions",
    );

    expect(scoped).toContain('[data-composition-id="captions"] .title');
    expect(scoped).not.toContain("data-hf-inner-root");
  });

  it('does not rewrite [id="intro"] attribute selectors', () => {
    // The function only targets #intro hash selectors, not [id="intro"] attribute selectors
    const result = scopeCssToComposition(
      '[id="intro"] .title { color: red; }',
      "intro",
      undefined,
      "intro",
    );
    expect(result).toContain('[id="intro"]');
  });

  it("wraps scripts with authored root id normalization for #id GSAP selectors", () => {
    const { document } = parseHTML(`
      <div data-composition-id="intro">
        <div data-hf-authored-id="intro">
          <div class="title">HELLO</div>
        </div>
      </div>
    `);
    const gsapTargets: string[][] = [];
    const fakeWindow = {
      document,
      __timelines: {},
      gsap: {
        timeline: () => ({
          fromTo(targets: Element[], _from: unknown, _to: unknown) {
            gsapTargets.push(Array.from(targets).map((t) => t.textContent || ""));
            return this;
          },
        }),
      },
    };
    const wrapped = wrapScopedCompositionScript(
      `
var tl = gsap.timeline({ paused: true });
tl.fromTo('#intro .title', { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.2);
window.__timelines['intro'] = tl;
`,
      "intro",
      "[HyperFrames] composition script error:",
      undefined,
      "intro",
      "intro",
    );

    new Function("window", "gsap", wrapped)(fakeWindow, fakeWindow.gsap);

    // The scoped script should resolve '#intro .title' against the
    // data-hf-authored-id="intro" element, finding the .title child.
    expect(gsapTargets).toEqual([["HELLO"]]);
  });
});
