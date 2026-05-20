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
});
