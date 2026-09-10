import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { inlineSubCompositions } from "./inlineSubCompositions";
import { readDeclaredDefaults, parseHostVariableValues } from "../runtime/getVariables";
import { assignBundledRuntimeCompositionIds } from "./htmlBundler";
import { JSDOM } from "jsdom";

// Fixtures reference GSAP CDN but are never loaded in a real browser — resolveHtml is mocked.

/**
 * Minimal sub-composition HTML that uses `#intro` as its CSS and GSAP scope.
 * This is the pattern that breaks when the producer path strips the inner root.
 */
const SUB_COMP_HTML = `<template id="intro-template">
  <div id="intro" data-composition-id="intro" data-width="1920" data-height="1080">
    <div class="title" style="opacity:0;">HELLO WORLD</div>
    <style>
      #intro { position:relative; width:1920px; height:1080px; background:#111; }
      #intro .title { font-size:120px; color:#fff; }
    </style>
    <script>
      (function() {
        window.__timelines = window.__timelines || {};
        var tl = gsap.timeline({ paused: true });
        tl.fromTo('#intro .title', { opacity:0 }, { opacity:1, duration:0.5 }, 0.2);
        window.__timelines['intro'] = tl;
      })();
    </script>
  </div>
</template>`;

function makeHostDocument(compId: string) {
  const { document } = parseHTML(`<!DOCTYPE html>
<html><body>
  <div data-composition-id="main">
    <div data-composition-id="${compId}" data-composition-src="intro.html"
         data-start="0" data-duration="4" data-track-index="0"></div>
  </div>
</body></html>`);
  return document;
}

describe("inlineSubCompositions – #ID selector scoping divergence", () => {
  it.each([
    { label: "empty", html: "" },
    { label: "whitespace-only", html: "   \n  \t  " },
    {
      label: "valid-parse-empty-body",
      html: "<!doctype html><html><head></head><body></body></html>",
    },
    // linkedom's parseHTML("just some text") returns documentElement === null.
    // Any code that then touches .head/.body (as linkedom's own internals do)
    // throws "Cannot destructure property 'firstElementChild' of
    // 'documentElement' as it is null" — the #1 raw crash in production
    // telemetry. Must be skipped gracefully, not crash.
    { label: "malformed non-HTML text", html: "just some plain text, no tags at all" },
  ])("skips $label sub-composition files gracefully", ({ html }) => {
    const document = makeHostDocument("intro");
    const host = document.querySelector('[data-composition-src="intro.html"]')!;
    const missing: string[] = [];

    const result = inlineSubCompositions(document, [host], {
      resolveHtml: () => html,
      parseHtml: (h) => parseHTML(h).document,
      onMissingComposition: (src) => missing.push(src),
    });

    expect(missing).toEqual(["intro.html"]);
    expect(result.styles).toHaveLength(0);
    expect(result.scripts).toHaveLength(0);
  });

  it("passes the failure reason through to onMissingComposition", () => {
    const document = makeHostDocument("intro");
    const host = document.querySelector('[data-composition-src="intro.html"]')!;
    const reasons: Array<string | undefined> = [];

    inlineSubCompositions(document, [host], {
      resolveHtml: () => "",
      parseHtml: (h) => parseHTML(h).document,
      onMissingComposition: (_src, reason) => reasons.push(reason),
    });

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("empty");
  });

  it("producer path (no flattenInnerRoot): strips inner root, losing #id attribute", () => {
    const document = makeHostDocument("intro");
    const host = document.querySelector('[data-composition-src="intro.html"]')!;

    const result = inlineSubCompositions(document, [host], {
      resolveHtml: () => SUB_COMP_HTML,
      parseHtml: (html) => parseHTML(html).document,
    });

    // The producer path takes innerHTML when compId matches, stripping the
    // wrapper <div id="intro" ...>. The host element should NOT contain a
    // child with id="intro" — the id attribute is lost.
    const innerRootById = host.querySelector("#intro");
    expect(innerRootById).toBeNull();

    // The host itself still has data-composition-id="intro" (from the
    // original markup), but no element inside has id="intro".
    expect(host.getAttribute("data-composition-id")).toBe("intro");

    // CSS was scoped: #intro selectors should be rewritten to use
    // data-hf-authored-id attribute selector so they still resolve.
    const scopedCss = result.styles.join("\n");
    expect(scopedCss).toContain('[data-hf-authored-id="intro"]');
    expect(scopedCss).not.toContain("#intro");
  });

  it("producer path: scoped CSS rewrites #id selectors to [data-hf-authored-id] attribute", () => {
    const document = makeHostDocument("intro");
    const host = document.querySelector('[data-composition-src="intro.html"]')!;

    const result = inlineSubCompositions(document, [host], {
      resolveHtml: () => SUB_COMP_HTML,
      parseHtml: (html) => parseHTML(html).document,
    });

    // The CSS scoper rewrites `#intro` to `[data-hf-authored-id="intro"]`
    // so that the selector resolves against the flattened structure.
    const scopedCss = result.styles.join("\n");
    expect(scopedCss).toContain('[data-hf-authored-id="intro"]');
    expect(scopedCss).toContain('[data-hf-authored-id="intro"] .title');
  });

  it("producer path: scoped scripts rewrite #intro selectors for GSAP targets", () => {
    const document = makeHostDocument("intro");
    const host = document.querySelector('[data-composition-src="intro.html"]')!;

    const result = inlineSubCompositions(document, [host], {
      resolveHtml: () => SUB_COMP_HTML,
      parseHtml: (html) => parseHTML(html).document,
    });

    // The wrapped script should contain the authored root id normalization
    // logic so that runtime querySelector('#intro .title') maps to the
    // data-hf-authored-id attribute selector.
    const wrappedScript = result.scripts.join("\n");
    expect(wrappedScript).toContain("__hfAuthoredRootId");
    expect(wrappedScript).toContain('"intro"');
  });

  it("maps a template-local timeline id onto a differently named mount", () => {
    const document = makeHostDocument("captions-comp");
    const host = document.querySelector('[data-composition-src="intro.html"]')!;
    const captionsHtml = `<template id="captions-template">
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <style>[data-composition-id="captions"] { opacity: 1; }</style>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["captions"] = { duration: 4 };
    </script>
  </div>
</template>`;

    const result = inlineSubCompositions(document, [host], {
      resolveHtml: () => captionsHtml,
      parseHtml: (html) => parseHTML(html).document,
    });

    expect(host.getAttribute("data-composition-id")).toBe("captions-comp");
    expect(host.querySelector('[data-composition-id="captions"]')).not.toBeNull();
    expect(result.styles.join("\n")).toContain('[data-composition-id="captions-comp"]');
    const wrappedScript = result.scripts.join("\n");
    expect(wrappedScript).toContain('var __hfCompId = "captions"');
    expect(wrappedScript).toContain('var __hfTimelineCompId = "captions-comp"');
  });

  it("bundler path (with flattenInnerRoot): preserves inner root as a child element", () => {
    const document = makeHostDocument("intro");
    const host = document.querySelector('[data-composition-src="intro.html"]')!;

    // Simulate the bundler's flattenInnerRoot: clone the element, add
    // data-hf-authored-id, strip timing attrs (simplified here).
    function flattenInnerRoot(innerRoot: Element): Element {
      const clone = innerRoot.cloneNode(true) as Element;
      const authoredId = clone.getAttribute("id");
      if (authoredId) {
        clone.setAttribute("data-hf-authored-id", authoredId);
        clone.removeAttribute("id");
      }
      clone.removeAttribute("data-start");
      clone.removeAttribute("data-duration");
      return clone;
    }

    const result = inlineSubCompositions(document, [host], {
      resolveHtml: () => SUB_COMP_HTML,
      parseHtml: (html) => parseHTML(html).document,
      flattenInnerRoot,
    });

    // With flattenInnerRoot, the inner root is preserved as a child of the
    // host via outerHTML. The data-hf-authored-id attribute is present.
    const authoredRoot = host.querySelector('[data-hf-authored-id="intro"]');
    expect(authoredRoot).not.toBeNull();

    // CSS is still rewritten to use the attribute selector.
    const scopedCss = result.styles.join("\n");
    expect(scopedCss).toContain('[data-hf-authored-id="intro"]');
  });

  it("with flattenInnerRoot: restores data-composition-id on the wrapper for an anonymous host", () => {
    // Regression test: a host mounted via data-composition-src with no
    // data-composition-id of its own (an "anonymous" host). The composition
    // styles its own root box via the bare composition-id selector and a
    // script self-references it too — both need something in the render DOM
    // to actually carry that id once flattenInnerRoot strips it from the
    // wrapper by default.
    const { document } = parseHTML(`<!DOCTYPE html>
<html><body>
  <div data-composition-id="main">
    <div data-composition-src="scoped-text.html" data-start="0" data-duration="3"></div>
  </div>
</body></html>`);
    const host = document.querySelector('[data-composition-src="scoped-text.html"]')!;

    const scopedTextHtml = `<template id="scoped-text-template">
  <div data-composition-id="scoped-text" data-width="1080" data-height="1920" data-duration="3">
    <div class="label">Scoped Text Should Stay Styled</div>
    <style>
      [data-composition-id="scoped-text"] { display: flex; background: rgb(12, 12, 12); }
    </style>
  </div>
</template>`;

    function flattenInnerRoot(innerRoot: Element): Element {
      const clone = innerRoot.cloneNode(true) as Element;
      clone.removeAttribute("data-composition-id");
      clone.removeAttribute("data-start");
      clone.removeAttribute("data-duration");
      clone.setAttribute("data-hf-inner-root", "true");
      return clone;
    }

    const result = inlineSubCompositions(document, [host], {
      resolveHtml: () => scopedTextHtml,
      parseHtml: (html) => parseHTML(html).document,
      flattenInnerRoot,
    });

    const wrapper = host.querySelector("[data-hf-inner-root]");
    expect(wrapper?.getAttribute("data-composition-id")).toBe("scoped-text");

    const scopedCss = result.styles.join("\n");
    expect(scopedCss).toContain("display: flex");
  });

  it("extracts <link> elements from sub-composition <head> with original rel and crossorigin", () => {
    const subCompWithLinks = `<!doctype html>
<html><head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@800&display=swap">
</head><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <span>Hello</span>
  </div>
</body></html>`;

    const document = makeHostDocument("captions");
    const host = document.querySelector('[data-composition-src="intro.html"]')!;

    const result = inlineSubCompositions(document, [host], {
      resolveHtml: () => subCompWithLinks,
      parseHtml: (html) => parseHTML(html).document,
    });

    expect(result.externalLinks).toHaveLength(3);
    expect(result.externalLinks[0]).toEqual({
      href: "https://fonts.googleapis.com",
      rel: "preconnect",
      crossorigin: undefined,
    });
    expect(result.externalLinks[1]).toEqual({
      href: "https://fonts.gstatic.com",
      rel: "preconnect",
      crossorigin: "",
    });
    expect(result.externalLinks[2]).toEqual({
      href: "https://fonts.googleapis.com/css2?family=Montserrat:wght@800&display=swap",
      rel: "stylesheet",
      crossorigin: undefined,
    });
  });

  it("collects an inline <head> script instead of discarding it", () => {
    // The <head> loop had a `src` branch and no else, so an inline <head>
    // script was silently dropped on render while the mount path executed it.
    const subCompWithHeadScript = `<!doctype html>
<html><head>
  <script>window.__headScriptRan = true;</script>
</head><body>
  <div data-composition-id="intro" data-width="1920" data-height="1080"><span>Hi</span></div>
</body></html>`;

    const document = makeHostDocument("intro");
    const host = document.querySelector('[data-composition-src="intro.html"]')!;

    const result = inlineSubCompositions(document, [host], {
      resolveHtml: () => subCompWithHeadScript,
      parseHtml: (html) => parseHTML(html).document,
    });

    expect(result.scripts.join("\n")).toContain("window.__headScriptRan = true;");
    expect(result.scriptItems).toContainEqual({
      kind: "inline",
      content: expect.stringContaining("window.__headScriptRan = true;"),
    });
  });

  it("hoists a <link> from a TEMPLATED sub-composition's head", () => {
    // Hoisting used to be gated on the composition being non-templated, so a
    // templated composition's webfont link was kept in preview (the mount path
    // hoists unconditionally) and dropped from the render.
    const templatedSubCompWithLink = `<!doctype html>
<html><head>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat">
</head><body>
  <template id="intro-template">
    <div data-composition-id="intro" data-width="1920" data-height="1080"><span>Hi</span></div>
  </template>
</body></html>`;

    const document = makeHostDocument("intro");
    const host = document.querySelector('[data-composition-src="intro.html"]')!;

    const result = inlineSubCompositions(document, [host], {
      resolveHtml: () => templatedSubCompWithLink,
      parseHtml: (html) => parseHTML(html).document,
    });

    expect(result.externalLinks).toEqual([
      {
        href: "https://fonts.googleapis.com/css2?family=Montserrat",
        rel: "stylesheet",
        crossorigin: undefined,
      },
    ]);
  });

  it("deduplicates link hrefs across multiple sub-compositions", () => {
    const subComp = `<!doctype html>
<html><head>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@800">
</head><body>
  <div data-composition-id="cap1" data-width="1920" data-height="1080"><span>A</span></div>
</body></html>`;

    const { document } = parseHTML(`<!DOCTYPE html>
<html><body>
  <div data-composition-id="main">
    <div data-composition-id="cap1" data-composition-src="cap1.html" data-start="0" data-duration="4" data-track-index="0"></div>
    <div data-composition-id="cap2" data-composition-src="cap2.html" data-start="4" data-duration="4" data-track-index="1"></div>
  </div>
</body></html>`);
    const hosts = Array.from(document.querySelectorAll("[data-composition-src]"));

    const result = inlineSubCompositions(document, hosts, {
      resolveHtml: () => subComp,
      parseHtml: (html) => parseHTML(html).document,
    });

    expect(result.externalLinks).toHaveLength(1);
    expect(result.externalLinks[0]!.href).toBe(
      "https://fonts.googleapis.com/css2?family=Montserrat:wght@800",
    );
  });

  it("propagates data-timeline-locked from inner root to host element", () => {
    const lockedSubComp = `<!doctype html>
<html><head></head><body>
  <div id="captions" data-composition-id="captions" data-timeline-locked data-width="1920" data-height="1080">
    <span>Hello</span>
  </div>
</body></html>`;

    const document = makeHostDocument("captions");
    const host = document.querySelector('[data-composition-src="intro.html"]')!;

    inlineSubCompositions(document, [host], {
      resolveHtml: () => lockedSubComp,
      parseHtml: (html) => parseHTML(html).document,
    });

    expect(host.hasAttribute("data-timeline-locked")).toBe(true);
  });

  it("producer path propagates data-hf-authored-id to host when inner root has id", () => {
    const document = makeHostDocument("intro");
    const host = document.querySelector('[data-composition-src="intro.html"]')!;

    inlineSubCompositions(document, [host], {
      resolveHtml: () => SUB_COMP_HTML,
      parseHtml: (html) => parseHTML(html).document,
    });

    // The inner root's id="intro" is stripped (innerHTML), but the producer
    // now propagates it as data-hf-authored-id on the host element so that
    // rewritten #ID selectors ([data-hf-authored-id="intro"]) resolve.
    expect(host.getAttribute("data-hf-authored-id")).toBe("intro");

    // The original #intro element is still gone — innerHTML stripped it.
    const introById = host.querySelector("#intro");
    expect(introById).toBeNull();

    expect(host.getAttribute("data-composition-id")).toBe("intro");
  });

  it("producer path: scoped CSS matches host element when both attributes coexist", () => {
    const document = makeHostDocument("intro");
    const host = document.querySelector('[data-composition-src="intro.html"]')!;

    const result = inlineSubCompositions(document, [host], {
      resolveHtml: () => SUB_COMP_HTML,
      parseHtml: (html) => parseHTML(html).document,
      compoundAuthoredRoot: true,
    });

    // After inlining, the host has both data-composition-id and data-hf-authored-id.
    // CSS selectors targeting the root must be compound (no space) so they match
    // when both attributes are on the same element.
    expect(host.getAttribute("data-composition-id")).toBe("intro");
    expect(host.getAttribute("data-hf-authored-id")).toBe("intro");

    const scopedCss = result.styles.join("\n");

    // Root-only selector: must be compound
    expect(scopedCss).toMatch(/\[data-composition-id="intro"\]\[data-hf-authored-id="intro"\]/);
    // Must NOT have a descendant combinator between the two attribute selectors
    expect(scopedCss).not.toMatch(
      /\[data-composition-id="intro"\]\s+\[data-hf-authored-id="intro"\]\s*\{/,
    );

    // Descendant selector: compound root + space + child
    expect(scopedCss).toMatch(
      /\[data-composition-id="intro"\]\[data-hf-authored-id="intro"\]\s+\.title/,
    );
  });
});

describe("inlineSubCompositions – variable defaults on a template sub-comp root div", () => {
  const SUB_COMP_WITH_VAR = `<template id="card-template">
  <div id="card" data-composition-id="card" data-width="1920" data-height="1080"
       data-composition-variables='[{"id":"headline","type":"string","label":"Headline","default":"Hi there"}]'>
    <h1 class="title" data-var-text="headline">Hi there</h1>
  </div>
</template>`;

  function hostDoc() {
    const { document } = parseHTML(`<!DOCTYPE html><html><body>
      <div data-composition-id="main">
        <div data-composition-id="card" data-composition-src="card.html"
             data-start="0" data-duration="4" data-track-index="0"></div>
      </div></body></html>`);
    return document;
  }

  it("aggregates defaults declared on the inner root div (template comps have no <html> to hold them)", () => {
    const document = hostDoc();
    const host = document.querySelector('[data-composition-src="card.html"]')!;
    const result = inlineSubCompositions(document, [host], {
      resolveHtml: () => SUB_COMP_WITH_VAR,
      parseHtml: (h) => parseHTML(h).document,
      readVariableDefaults: readDeclaredDefaults,
      parseHostVariables: parseHostVariableValues,
    });
    expect(result.variablesByComp["card"]).toMatchObject({ headline: "Hi there" });
  });

  it("lets a per-instance host value override the declared default", () => {
    const document = hostDoc();
    const host = document.querySelector('[data-composition-src="card.html"]')!;
    host.setAttribute("data-variable-values", JSON.stringify({ headline: "Overridden" }));
    const result = inlineSubCompositions(document, [host], {
      resolveHtml: () => SUB_COMP_WITH_VAR,
      parseHtml: (h) => parseHTML(h).document,
      readVariableDefaults: readDeclaredDefaults,
      parseHostVariables: parseHostVariableValues,
    });
    expect(result.variablesByComp["card"]).toMatchObject({ headline: "Overridden" });
  });
});

describe("inlineSubCompositions – recursive host discovery", () => {
  const MAX_NESTING_DEPTH = 20;

  function compositionHtml(label: string, nestedSrcs: string[] = []) {
    const nestedHosts = nestedSrcs
      .map(
        (src, index) =>
          `<div data-composition-id="${label}-child-${index}" data-composition-src="${src}"></div>`,
      )
      .join("");
    return `<template><div data-composition-id="${label}"><span data-level="${label}">${label}</span>${nestedHosts}</div></template>`;
  }

  function inlineFixture(rootHosts: string[], compositions: Record<string, string>) {
    const { document } = parseHTML(`<!DOCTYPE html><html><body>
      <main data-level="root">root</main>
      ${rootHosts
        .map(
          (src, index) =>
            `<div data-composition-id="root-host-${index}" data-composition-src="${src}"></div>`,
        )
        .join("")}
    </body></html>`);
    const missing: Array<{ src: string; reason?: string }> = [];

    inlineSubCompositions(
      document,
      Array.from(document.querySelectorAll("[data-composition-src]")),
      {
        resolveHtml: (src) => compositions[src] ?? null,
        parseHtml: (html) => parseHTML(html).document,
        onMissingComposition: (src, reason) => missing.push({ src, reason }),
      },
    );

    return { document, missing };
  }

  it("inlines a three-level root -> A -> B chain", () => {
    const { document, missing } = inlineFixture(["a.html"], {
      "a.html": compositionHtml("A", ["b.html"]),
      "b.html": compositionHtml("B"),
    });

    expect(document.querySelector('[data-level="root"]')?.textContent).toBe("root");
    expect(document.querySelector('[data-level="A"]')?.textContent).toBe("A");
    expect(document.querySelector('[data-level="B"]')?.textContent).toBe("B");
    expect(missing).toEqual([]);
  });

  it("inlines a four-level root -> A -> B -> C chain", () => {
    const { document, missing } = inlineFixture(["a.html"], {
      "a.html": compositionHtml("A", ["b.html"]),
      "b.html": compositionHtml("B", ["c.html"]),
      "c.html": compositionHtml("C"),
    });

    expect(
      Array.from(document.querySelectorAll("[data-level]")).map((element) => element.textContent),
    ).toEqual(["root", "A", "B", "C"]);
    expect(missing).toEqual([]);
  });

  it("reports and leaves a direct circular reference uninlined", () => {
    const { document, missing } = inlineFixture(["a.html"], {
      "a.html": compositionHtml("A", ["a.html"]),
    });

    expect(document.querySelectorAll('[data-level="A"]')).toHaveLength(1);
    expect(document.querySelector('[data-composition-src="a.html"]')).not.toBeNull();
    expect(missing).toEqual([{ src: "a.html", reason: "circular composition reference" }]);
  });

  it("reports and leaves an indirect circular reference uninlined", () => {
    const { document, missing } = inlineFixture(["a.html"], {
      "a.html": compositionHtml("A", ["b.html"]),
      "b.html": compositionHtml("B", ["a.html"]),
    });

    expect(document.querySelectorAll('[data-level="A"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-level="B"]')).toHaveLength(1);
    expect(document.querySelector('[data-composition-src="a.html"]')).not.toBeNull();
    expect(missing).toEqual([{ src: "a.html", reason: "circular composition reference" }]);
  });

  it("inlines the same sub-composition in sibling branches", () => {
    const { document, missing } = inlineFixture(["a.html"], {
      "a.html": compositionHtml("A", ["shared.html", "shared.html"]),
      "shared.html": compositionHtml("shared"),
    });

    expect(document.querySelectorAll('[data-level="shared"]')).toHaveLength(2);
    expect(missing).toEqual([]);
  });

  it("allows the depth ceiling and stops only the branch one level beyond it", () => {
    const compositions: Record<string, string> = {
      "sibling.html": compositionHtml("sibling"),
    };
    for (const prefix of ["exact", "overflow"]) {
      const length = prefix === "exact" ? MAX_NESTING_DEPTH : MAX_NESTING_DEPTH + 1;
      for (let level = 1; level <= length; level += 1) {
        const nextSrc = level < length ? [`${prefix}-${level + 1}.html`] : [];
        compositions[`${prefix}-${level}.html`] = compositionHtml(`${prefix}-${level}`, nextSrc);
      }
    }

    const { document, missing } = inlineFixture(
      ["exact-1.html", "overflow-1.html", "sibling.html"],
      compositions,
    );

    expect(document.querySelector(`[data-level="exact-${MAX_NESTING_DEPTH}"]`)).not.toBeNull();
    expect(document.querySelector(`[data-level="overflow-${MAX_NESTING_DEPTH}"]`)).not.toBeNull();
    expect(document.querySelector(`[data-level="overflow-${MAX_NESTING_DEPTH + 1}"]`)).toBeNull();
    expect(document.querySelector('[data-level="sibling"]')).not.toBeNull();
    expect(missing).toEqual([
      {
        src: `overflow-${MAX_NESTING_DEPTH + 1}.html`,
        reason: "nesting depth exceeded",
      },
    ]);
  });
});

describe("inlineSubCompositions – sub-composition asset paths", () => {
  // Every asset ref a sub-composition in a subdirectory carries has to be
  // re-pointed when its content moves into the project-root document. Hoisted
  // <head> <link>/<script src> used to bypass the rewrite entirely (so even the
  // documented `../` form escaped the project), and sibling refs (`_shared.css`)
  // silently 404'd. Both render the frame unstyled.
  const SUB_COMP = `<!doctype html>
<html><head>
  <link rel="stylesheet" href="_shared.css">
  <link rel="stylesheet" href="../shared/theme.css">
  <script src="helper.js"></script>
  <style>.badge { background-image: url("frame.png"); }</style>
</head><body>
  <div data-composition-id="frame" data-width="1920" data-height="1080">
    <img src="frame.png" alt="">
    <div style="background-image: url('frame.png')"></div>
  </div>
</body></html>`;

  const PROJECT_FILES = [
    "design/styleframes/_shared.css",
    "design/styleframes/frame.png",
    "design/styleframes/helper.js",
    "design/shared/theme.css",
  ];

  function inlineFrame() {
    const { document } = parseHTML(`<!DOCTYPE html>
<html><body>
  <div data-composition-id="main">
    <div data-composition-id="frame" data-composition-src="design/styleframes/frame-01.html"
         data-start="0" data-duration="4" data-track-index="0"></div>
  </div>
</body></html>`);
    const host = document.querySelector("[data-composition-src]")!;
    const result = inlineSubCompositions(document, [host], {
      resolveHtml: () => SUB_COMP,
      parseHtml: (html) => parseHTML(html).document,
      rewriteInlineStyles: true,
      assetExists: (path: string) => PROJECT_FILES.includes(path),
    });
    return { document, result };
  }

  it("rewrites hoisted <link> hrefs against the sub-composition dir", () => {
    const { result } = inlineFrame();
    const hrefs = result.externalLinks.map((l) => l.href);
    expect(hrefs).toContain("design/styleframes/_shared.css");
    expect(hrefs).toContain("design/shared/theme.css");
    expect(hrefs).not.toContain("_shared.css");
    expect(hrefs).not.toContain("../shared/theme.css");
  });

  it("rewrites hoisted external script srcs", () => {
    const { result } = inlineFrame();
    expect(result.externalScriptSrcs).toContain("design/styleframes/helper.js");
  });

  it("rewrites sibling refs in markup, hoisted CSS, and inline styles", () => {
    const { document, result } = inlineFrame();
    expect(document.querySelector("img")?.getAttribute("src")).toBe("design/styleframes/frame.png");
    expect(result.styles.join("\n")).toContain("design/styleframes/frame.png");
    expect(document.querySelector("[style]")?.getAttribute("style")).toContain(
      "design/styleframes/frame.png",
    );
  });
});

/** Inline `hostEntries` (each pointing at a source in `sources`) into one
 *  bundler-shaped document with runtime composition ids assigned. */
function inlineScenes(
  sources: Record<string, string>,
  hostEntries: Array<{ compId: string; src: string }>,
) {
  const hostsMarkup = hostEntries
    .map(
      ({ compId, src }, i) =>
        `<div data-composition-id="${compId}" data-composition-src="${src}"
              data-start="0" data-duration="4" data-track-index="${i}"></div>`,
    )
    .join("\n");
  const { document } = parseHTML(`<!DOCTYPE html>
<html><body>
  <div data-composition-id="main">${hostsMarkup}</div>
</body></html>`);
  const hosts = Array.from(document.querySelectorAll("[data-composition-src]"));
  const hostIdentityMap = assignBundledRuntimeCompositionIds(hosts);
  const result = inlineSubCompositions(document, hosts, {
    resolveHtml: (src) => sources[src] ?? null,
    parseHtml: (html) => parseHTML(html).document,
    hostIdentityMap,
  });
  return { document, result };
}

describe("inlineSubCompositions – #3490 nested SVG id collisions", () => {
  // Same shape as the issue repro: a composition-scoped clipPath, a <use>
  // target, and a CSS filter, all hardcoded ids a catalog block or a scene
  // author has no reason to think are unsafe to repeat.
  function svgScene(compId: string, color: string): string {
    return `<!DOCTYPE html><html><body><div id="${compId}" data-composition-id="${compId}" data-width="100" data-height="100">
      <svg width="0" height="0">
        <clipPath id="clip"><rect width="10" height="10"/></clipPath>
        <symbol id="shape"><circle r="5" fill="${color}"/></symbol>
        <filter id="fx"><feFlood flood-color="${color}"/></filter>
      </svg>
      <g class="clipped" clip-path="url(#clip)"><use class="shape" href="#shape"></use></g>
      <div class="fx-target" style="filter:url(#fx)"></div>
      <style>#${compId} .fx-target { filter: url(#fx); }</style>
    </div></body></html>`;
  }

  it("gives two sibling scenes reusing #clip/#shape/#fx distinct, non-colliding ids", () => {
    const { document, result } = inlineScenes(
      { "scene-a.html": svgScene("scene-a", "red"), "scene-b.html": svgScene("scene-b", "blue") },
      [
        { compId: "scene-a", src: "scene-a.html" },
        { compId: "scene-b", src: "scene-b.html" },
      ],
    );

    // Exactly one "clip" survives verbatim (the first instance keeps its
    // authored id) and no id repeats across the two scenes — the exact
    // document-order collision the browser resolves incorrectly before this
    // fix.
    const allIds = Array.from(document.querySelectorAll("[id]")).map((el) => el.getAttribute("id"));
    expect(allIds.filter((id) => id === "clip")).toHaveLength(1);
    expect(new Set(allIds).size).toBe(allIds.length);

    const [gA, gB] = Array.from(document.querySelectorAll("g.clipped"));
    const [useA, useB] = Array.from(document.querySelectorAll("use.shape"));
    const [fxA, fxB] = Array.from(document.querySelectorAll(".fx-target"));

    const clipA = gA!.getAttribute("clip-path");
    const clipB = gB!.getAttribute("clip-path");
    expect(clipA).toMatch(/^url\(#.*clip\)$/);
    expect(clipA).not.toBe(clipB);

    const hrefA = useA!.getAttribute("href");
    const hrefB = useB!.getAttribute("href");
    expect(hrefA).toMatch(/^#.*shape$/);
    expect(hrefA).not.toBe(hrefB);

    // <use>/clip-path must resolve to the id actually declared in THIS
    // scene's <svg>, not merely to a unique-looking string.
    const clipAId = clipA!.slice("url(#".length, -1);
    const shapeAId = hrefA!.slice(1);
    expect(document.getElementById(clipAId)?.closest("svg")).toBeTruthy();
    expect(document.getElementById(shapeAId)?.closest("svg")).toBeTruthy();

    const styleFxA = fxA!.getAttribute("style");
    const styleFxB = fxB!.getAttribute("style");
    expect(styleFxA).not.toBe(styleFxB);

    // The CSS text (`<style>#scene-a .fx-target { filter: url(#fx) }`)
    // extracted alongside the DOM (never re-injected by this shared function
    // — that is the caller's job) must resolve to the SAME renamed id the
    // element attribute above did, or the two diverge and the rule stops
    // matching once inlined.
    const styles = result.styles.join("\n");
    const fxAId = styleFxA!.match(/url\(#([^)]+)\)/)?.[1];
    expect(fxAId).toBeTruthy();
    expect(styles).toContain(`filter: url(#${fxAId})`);
  });

  it("disambiguates the same catalog block used twice in one scene", () => {
    const block = svgScene("block", "green");
    const { document } = inlineScenes({ "block.html": block }, [
      { compId: "block", src: "block.html" },
      { compId: "block", src: "block.html" },
    ]);

    const uses = Array.from(document.querySelectorAll("use.shape"));
    expect(uses).toHaveLength(2);
    const hrefs = uses.map((u) => u.getAttribute("href"));
    expect(hrefs[0]).not.toBe(hrefs[1]);
    expect(new Set(hrefs).size).toBe(2);

    // Each <use> must still resolve within the merged document.
    for (const href of hrefs) {
      const id = href!.slice(1);
      expect(document.getElementById(id)).toBeTruthy();
    }
  });

  it("records the authored id on the renamed (second) instance only", () => {
    // Mirrors #646: an author's own script calling
    // document.getElementById('shape') from inside its composition must
    // still find its element after this module renames the real id — the
    // scoped shim falls back to data-hf-authored-id.
    const { document } = inlineScenes(
      { "scene-a.html": svgScene("scene-a", "red"), "scene-b.html": svgScene("scene-b", "blue") },
      [
        { compId: "scene-a", src: "scene-a.html" },
        { compId: "scene-b", src: "scene-b.html" },
      ],
    );
    const sceneARoot = document.querySelector('[data-composition-id="scene-a"]')!;
    const sceneBRoot = document.querySelector('[data-composition-id="scene-b"]')!;
    expect(sceneARoot.querySelector('[data-hf-authored-id="shape"]')).toBeNull();
    expect(sceneARoot.querySelector("symbol")!.getAttribute("id")).toBe("shape");
    const authoredMatch = sceneBRoot.querySelector('[data-hf-authored-id="shape"]');
    expect(authoredMatch).toBeTruthy();
    expect(authoredMatch).toBe(sceneBRoot.querySelector("symbol"));
  });
});

describe("inlineSubCompositions – renamed SVG ids stay reachable from author scripts", () => {
  // These tests execute the compiled, scoped scripts inside a real jsdom
  // window built from the assembled document — the same thing the browser
  // does — so they exercise the selector runtime in compositionScoping.ts,
  // not just the DOM rewrite.
  function scriptedScene(compId: string, script: string, extra = ""): string {
    return `<!DOCTYPE html><html><body><div id="${compId}" data-composition-id="${compId}" data-width="100" data-height="100">
      <svg class="art" width="0" height="0">
        <path id="shape" d="M0,0 L10,10"/>
        <use class="ref" href="#shape"></use>
      </svg>
      ${extra}
      <script>${script}</script>
    </div></body></html>`;
  }

  function inlineAndBoot(
    sources: Record<string, string>,
    hostEntries: Array<{ compId: string; src: string }>,
    fakeGsap?: (window: Window & typeof globalThis) => unknown,
  ) {
    const { document, result } = inlineScenes(sources, hostEntries);
    const dom = new JSDOM(document.toString(), { runScripts: "outside-only" });
    const window = dom.window as unknown as Window & typeof globalThis & Record<string, unknown>;
    window.__captured = {};
    if (fakeGsap) (window as Record<string, unknown>).gsap = fakeGsap(window);
    for (const script of result.scripts) window.eval(script);
    return { window, result, captured: window.__captured as Record<string, unknown> };
  }

  it("single composition: native and script references to the same element both keep resolving", () => {
    const { window, captured } = inlineAndBoot(
      {
        "scene.html": scriptedScene(
          "scene",
          `var svg = document.querySelector("svg.art");
           window.__captured.viaDocument = document.querySelector("#shape");
           window.__captured.viaElement = svg.querySelector("#shape");
           window.__captured.byId = document.getElementById("shape");
           window.__captured.all = document.querySelectorAll("#shape").length;`,
        ),
      },
      [{ compId: "scene", src: "scene.html" }],
    );
    const path = window.document.querySelector("path")!;
    // Ids are byte-for-byte untouched: no collision, no rename, no shim.
    expect(path.getAttribute("id")).toBe("shape");
    expect(path.hasAttribute("data-hf-authored-id")).toBe(false);
    expect(window.document.querySelector("use")!.getAttribute("href")).toBe("#shape");
    expect((window as Record<string, unknown>).__hfRenamedIdSelectorShim).toBeUndefined();
    expect(captured.viaDocument).toBe(path);
    expect(captured.viaElement).toBe(path);
    expect(captured.byId).toBe(path);
    expect(captured.all).toBe(1);
  });

  it("two colliding compositions: native refs point at their own element and each script still finds its own", () => {
    const probe = `var svg = document.querySelector("svg.art");
      window.__captured[__hfProbeName] = {
        viaDocument: document.querySelector("#shape"),
        viaElement: svg.querySelector("#shape"),
        viaElementAll: svg.querySelectorAll("#shape").length,
        byId: document.getElementById("shape"),
        gsapTargets: gsap.to(["#shape", ".ref"], {}),
        toArray: gsap.utils.toArray("#shape"),
      };`;
    const { window, captured } = inlineAndBoot(
      {
        "scene-a.html": scriptedScene("scene-a", `var __hfProbeName = "a"; ${probe}`),
        "scene-b.html": scriptedScene("scene-b", `var __hfProbeName = "b"; ${probe}`),
      },
      [
        { compId: "scene-a", src: "scene-a.html" },
        { compId: "scene-b", src: "scene-b.html" },
      ],
      () => ({
        to: (targets: unknown) => targets,
        utils: { toArray: (targets: unknown) => targets },
      }),
    );
    const [rootA, rootB] = Array.from(
      window.document.querySelectorAll(
        '[data-composition-id="scene-a"], [data-composition-id="scene-b"]',
      ),
    );
    const pathA = rootA!.querySelector("path")!;
    const pathB = rootB!.querySelector("path")!;

    // DOM: A keeps the authored id, B is renamed and its <use> follows.
    expect(pathA.getAttribute("id")).toBe("shape");
    expect(pathB.getAttribute("id")).not.toBe("shape");
    expect(pathB.getAttribute("data-hf-authored-id")).toBe("shape");
    expect(rootA!.querySelector("use")!.getAttribute("href")).toBe("#shape");
    expect(rootB!.querySelector("use")!.getAttribute("href")).toBe(`#${pathB.getAttribute("id")}`);

    // Scripts: every lookup form resolves to the element of ITS OWN scene.
    const a = captured.a as Record<string, unknown>;
    const b = captured.b as Record<string, unknown>;
    expect(a.viaDocument).toBe(pathA);
    expect(a.viaElement).toBe(pathA);
    expect(a.byId).toBe(pathA);
    expect(b.viaDocument).toBe(pathB);
    expect(b.viaElement).toBe(pathB);
    expect(b.viaElementAll).toBe(1);
    expect(b.byId).toBe(pathB);
    // GSAP selector arrays resolve string entries through the scoped lookup.
    expect(a.gsapTargets).toEqual([pathA, rootA!.querySelector("use.ref")]);
    expect(b.gsapTargets).toEqual([pathB, rootB!.querySelector("use.ref")]);
    expect(a.toArray).toEqual([pathA]);
    expect(b.toArray).toEqual([pathB]);
    expect((window as Record<string, unknown>).__hfRenamedIdSelectorShim).toBe(true);
  });

  it("escaped CSS id: a styled element that is also natively referenced keeps its rule after rename", () => {
    function fxScene(compId: string): string {
      return `<!DOCTYPE html><html><body><div id="${compId}" data-composition-id="${compId}" data-width="100" data-height="100">
        <svg width="0" height="0"><filter id="fx.1"><feFlood flood-color="red"/></filter></svg>
        <rect class="target" filter="url(#fx.1)"></rect>
        <style>#fx\\.1 { color: red; } .target { filter: url(#fx.1); }</style>
        <script>window.__captured[${JSON.stringify(compId)}] = document.querySelector("#fx\\\\.1");</script>
      </div></body></html>`;
    }
    const { window, result, captured } = inlineAndBoot(
      { "scene-a.html": fxScene("scene-a"), "scene-b.html": fxScene("scene-b") },
      [
        { compId: "scene-a", src: "scene-a.html" },
        { compId: "scene-b", src: "scene-b.html" },
      ],
    );
    const [rootA, rootB] = Array.from(
      window.document.querySelectorAll(
        '[data-composition-id="scene-a"], [data-composition-id="scene-b"]',
      ),
    );
    const filterA = rootA!.querySelector("filter")!;
    const filterB = rootB!.querySelector("filter")!;
    expect(filterA.getAttribute("id")).toBe("fx.1");
    expect(filterB.getAttribute("id")).toBe("scene-b--fx.1");
    expect(rootB!.querySelector("rect")!.getAttribute("filter")).toBe("url(#scene-b--fx.1)");

    // Scene B's stylesheet was rewritten with a VALID escaped selector and a
    // matching url(); scene A's is untouched.
    const [cssA, cssB] = result.styles;
    expect(cssA).toContain(String.raw`#fx\.1`);
    expect(cssA).toContain("url(#fx.1)");
    expect(cssB).toContain(String.raw`#scene-b--fx\.1`);
    expect(cssB).toContain("url(#scene-b--fx.1)");
    expect(cssB).not.toContain(String.raw`#fx\.1`);

    // The rewritten selector actually matches the renamed element in a real
    // selector engine.
    const ruleSelector = /(\[data-composition-id="scene-b"\][^{]*#scene-b--fx\\\.1)\s*\{/.exec(
      cssB!,
    )?.[1];
    expect(ruleSelector).toBeTruthy();
    expect(window.document.querySelector(ruleSelector!)).toBe(filterB);

    // And the author's own escaped selector still resolves through the
    // scoped document proxy in both scenes.
    expect(captured["scene-a"]).toBe(filterA);
    expect(captured["scene-b"]).toBe(filterB);
  });
});
