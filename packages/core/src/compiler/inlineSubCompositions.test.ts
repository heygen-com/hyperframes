import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { inlineSubCompositions } from "./inlineSubCompositions";

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
