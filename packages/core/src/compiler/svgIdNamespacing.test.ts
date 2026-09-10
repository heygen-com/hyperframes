import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  SVG_AUTHORED_ID_ATTR,
  namespaceCollidingSvgIds,
  rewriteSvgIdReferencesInCss,
  type SvgIdScope,
} from "./svgIdNamespacing";

type ScopeSpec = { namespace: string; html: string; cssTexts?: string[] };

/** Assemble one document with a `<div class="scope">` per instance — the
 *  shape the inline pipeline leaves behind — and namespace across them. */
function namespace(specs: ScopeSpec[], { before = "", after = "" } = {}) {
  const { document } = parseHTML(
    `<!DOCTYPE html><html><body>${before}${specs
      .map((spec) => `<div class="scope">${spec.html}</div>`)
      .join("")}${after}</body></html>`,
  );
  const roots = [...document.querySelectorAll("div.scope")];
  const scopes: SvgIdScope[] = specs.map((spec, index) => ({
    root: roots[index]!,
    namespace: spec.namespace,
    cssTexts: spec.cssTexts,
  }));
  const idMaps = namespaceCollidingSvgIds(
    document as unknown as Parameters<typeof namespaceCollidingSvgIds>[0],
    scopes,
  );
  return { document, roots, idMaps };
}

const CLIPPED =
  '<svg><clipPath id="clip"><rect/></clipPath></svg><div clip-path="url(#clip)"></div>';

describe("namespaceCollidingSvgIds", () => {
  it("is a no-op when there are no svg ids", () => {
    const { idMaps } = namespace([
      { namespace: "scene-a", html: "<div><p>hello</p></div>" },
      { namespace: "scene-b", html: "<div><p>hello</p></div>" },
    ]);
    expect(idMaps.every((m) => m.size === 0)).toBe(true);
  });

  it("leaves a single composition byte-for-byte unchanged, even with native references", () => {
    // The reviewer's repro: one composition, `<use href="#shape">` next to
    // `<path id="shape">`. Nothing collides, so nothing may be renamed —
    // otherwise `svg.querySelector("#shape")` breaks for no reason.
    const { document, idMaps } = namespace([
      {
        namespace: "scene-a",
        html: '<svg><path id="shape" d="M0,0"/><use href="#shape"></use></svg>',
      },
    ]);
    expect(idMaps[0]!.size).toBe(0);
    const path = document.querySelector("path")!;
    expect(path.getAttribute("id")).toBe("shape");
    expect(path.hasAttribute(SVG_AUTHORED_ID_ATTR)).toBe(false);
    expect(document.querySelector("use")!.getAttribute("href")).toBe("#shape");
    expect(document.querySelector("svg")!.querySelector("#shape")).toBe(path);
  });

  it("leaves two compositions alone when their ids do not collide", () => {
    const { idMaps } = namespace([
      { namespace: "scene-a", html: CLIPPED },
      { namespace: "scene-b", html: CLIPPED.replaceAll("clip", "clip-b") },
    ]);
    expect(idMaps.every((m) => m.size === 0)).toBe(true);
  });

  it("does not rename when namespace is empty (anonymous host)", () => {
    const { document, idMaps } = namespace([
      { namespace: "", html: CLIPPED },
      { namespace: "", html: CLIPPED },
    ]);
    expect(idMaps.every((m) => m.size === 0)).toBe(true);
    for (const el of document.querySelectorAll("clipPath")) {
      expect(el.getAttribute("id")).toBe("clip");
    }
  });

  it("never renames colliding svg ids that have no native reference (JS-only ids)", () => {
    // Two scenes each animate `#cut-1` from a script and nothing else refers
    // to it. Renaming would make the id unreachable for a global library
    // that reads `document` directly, so both instances keep it — the
    // documented residual collision for the JS-only class.
    const { document, idMaps } = namespace([
      { namespace: "scene-a", html: '<svg><path id="cut-1" d="M0,0 L10,10"></path></svg>' },
      { namespace: "scene-b", html: '<svg><path id="cut-1" d="M0,0 L10,10"></path></svg>' },
    ]);
    expect(idMaps.every((m) => m.size === 0)).toBe(true);
    expect([...document.querySelectorAll("path")].map((p) => p.getAttribute("id"))).toEqual([
      "cut-1",
      "cut-1",
    ]);
  });

  it("keeps the first colliding instance and renames the later one, recording the authored id", () => {
    const { document, idMaps, roots } = namespace([
      { namespace: "scene-a", html: CLIPPED },
      { namespace: "scene-b", html: CLIPPED },
    ]);
    expect(idMaps[0]!.size).toBe(0);
    expect(idMaps[1]!.get("clip")).toBe("scene-b--clip");

    const clipA = roots[0]!.querySelector("clipPath")!;
    const clipB = roots[1]!.querySelector("clipPath")!;
    expect(clipA.getAttribute("id")).toBe("clip");
    expect(clipA.hasAttribute(SVG_AUTHORED_ID_ATTR)).toBe(false);
    expect(clipB.getAttribute("id")).toBe("scene-b--clip");
    expect(clipB.getAttribute(SVG_AUTHORED_ID_ATTR)).toBe("clip");

    // Native resolution binds `url(#clip)` to the FIRST `id="clip"` in
    // document order — which is now the only one, and scene A's own.
    expect(roots[0]!.querySelector("div")!.getAttribute("clip-path")).toBe("url(#clip)");
    expect(roots[1]!.querySelector("div")!.getAttribute("clip-path")).toBe("url(#scene-b--clip)");
    expect(document.querySelectorAll('[id="clip"]')).toHaveLength(1);
  });

  it("renames a natively-referenced instance that collides with an id the parent document owns", () => {
    // The top-level document is outside every scope and can never be
    // renamed, so it is the keeper even though the inlined instance comes
    // first in document order.
    const { document, idMaps, roots } = namespace([{ namespace: "scene-a", html: CLIPPED }], {
      after:
        '<svg><clipPath id="clip"><rect/></clipPath></svg><div id="parent-user" clip-path="url(#clip)"></div>',
    });
    expect(idMaps[0]!.get("clip")).toBe("scene-a--clip");
    expect(roots[0]!.querySelector("clipPath")!.getAttribute("id")).toBe("scene-a--clip");
    expect(roots[0]!.querySelector("div")!.getAttribute("clip-path")).toBe("url(#scene-a--clip)");
    expect(document.querySelector("#parent-user")!.getAttribute("clip-path")).toBe("url(#clip)");
  });

  it("renames a natively-referenced instance that collides with a JS-only id elsewhere", () => {
    // Scene A's `#clip` is JS-only (unrenamable) and comes first; scene B's
    // is natively referenced. B must be renamed even though A is untouched,
    // or B's `url(#clip)` would bind to A's element.
    const { roots, idMaps } = namespace([
      { namespace: "scene-a", html: '<svg><clipPath id="clip"><rect/></clipPath></svg>' },
      { namespace: "scene-b", html: CLIPPED },
    ]);
    expect(idMaps[0]!.size).toBe(0);
    expect(idMaps[1]!.get("clip")).toBe("scene-b--clip");
    expect(roots[0]!.querySelector("clipPath")!.getAttribute("id")).toBe("clip");
    expect(roots[1]!.querySelector("clipPath")!.getAttribute("id")).toBe("scene-b--clip");

    // And the mirror image: the JS-only instance comes SECOND. It still
    // cannot be renamed, so the natively-referenced first instance is.
    const mirrored = namespace([
      { namespace: "scene-a", html: CLIPPED },
      { namespace: "scene-b", html: '<svg><clipPath id="clip"><rect/></clipPath></svg>' },
    ]);
    expect(mirrored.idMaps[0]!.get("clip")).toBe("scene-a--clip");
    expect(mirrored.idMaps[1]!.size).toBe(0);
    expect(mirrored.roots[0]!.querySelector("div")!.getAttribute("clip-path")).toBe(
      "url(#scene-a--clip)",
    );
    expect(mirrored.roots[1]!.querySelector("clipPath")!.getAttribute("id")).toBe("clip");
  });

  it("rewrites filter/mask/fill/stroke/marker url() references in the renamed instance", () => {
    const html = `
      <svg>
        <filter id="fx"></filter>
        <mask id="msk"></mask>
        <linearGradient id="grad"></linearGradient>
        <marker id="arrow"></marker>
      </svg>
      <div style="filter:url(#fx); mask: url('#msk')"></div>
      <rect fill="url(#grad)" stroke="url(#grad)" marker-start="url(#arrow)" marker-end="url(#arrow)"></rect>
    `;
    const { roots } = namespace([
      { namespace: "scene-a", html },
      { namespace: "scene-b", html },
    ]);
    const div = roots[1]!.querySelector("div")!;
    expect(div.getAttribute("style")).toBe("filter:url(#scene-b--fx); mask: url('#scene-b--msk')");
    const rect = roots[1]!.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("url(#scene-b--grad)");
    expect(rect.getAttribute("stroke")).toBe("url(#scene-b--grad)");
    expect(rect.getAttribute("marker-start")).toBe("url(#scene-b--arrow)");
    expect(rect.getAttribute("marker-end")).toBe("url(#scene-b--arrow)");
    // The keeper instance is untouched.
    expect(roots[0]!.querySelector("div")!.getAttribute("style")).toBe(
      "filter:url(#fx); mask: url('#msk')",
    );
  });

  it("rewrites <use href> and xlink:href fragment refs", () => {
    const html =
      '<svg><symbol id="shape"></symbol><use href="#shape"></use><use xlink:href="#shape"></use></svg>';
    const { roots } = namespace([
      { namespace: "scene-a", html },
      { namespace: "scene-c", html },
    ]);
    const uses = [...roots[1]!.querySelectorAll("use")];
    expect(uses[0]!.getAttribute("href")).toBe("#scene-c--shape");
    expect(uses[1]!.getAttribute("xlink:href")).toBe("#scene-c--shape");
  });

  it("counts a url(#id) reference from the instance's extracted <style> text as native", () => {
    const svg = '<svg><filter id="rough-filter"><feTurbulence/></filter></svg>';
    const { roots, idMaps } = namespace([
      { namespace: "scene-a", html: svg, cssTexts: [".title { filter: url(#rough-filter); }"] },
      { namespace: "scene-b", html: svg, cssTexts: [".title { filter: url(#rough-filter); }"] },
    ]);
    expect(idMaps[1]!.get("rough-filter")).toBe("scene-b--rough-filter");
    expect(roots[1]!.querySelector("filter")!.getAttribute("id")).toBe("scene-b--rough-filter");
  });

  it("leaves unrelated hrefs and non-fragment urls untouched", () => {
    const html =
      CLIPPED +
      '<a href="https://example.com/#clip">link</a>' +
      '<div class="bg" style="background:url(image.png)"></div>';
    const { roots } = namespace([
      { namespace: "scene-a", html },
      { namespace: "scene-d", html },
    ]);
    expect(roots[1]!.querySelector("a")!.getAttribute("href")).toBe("https://example.com/#clip");
    expect(roots[1]!.querySelector("div.bg")!.getAttribute("style")).toBe(
      "background:url(image.png)",
    );
  });

  it("skips excluded nested subtrees so a nested instance keeps its own scope", () => {
    const nestedHtml =
      '<div class="nested">' +
      CLIPPED +
      "</div>" +
      '<svg><filter id="fx"></filter></svg><div style="filter:url(#fx)"></div>';
    const { document } = parseHTML(
      `<!DOCTYPE html><html><body><div class="outer">${nestedHtml}</div><div class="other">${CLIPPED}</div></body></html>`,
    );
    const outer = document.querySelector("div.outer")!;
    const nested = document.querySelector("div.nested")!;
    const other = document.querySelector("div.other")!;
    const idMaps = namespaceCollidingSvgIds(
      document as unknown as Parameters<typeof namespaceCollidingSvgIds>[0],
      [
        { root: outer, namespace: "outer", exclude: [nested] },
        { root: nested, namespace: "nested" },
        { root: other, namespace: "other" },
      ],
    );
    // `clip` collides between the nested instance (first in document order,
    // the keeper) and `other`; the OUTER scope must not claim the nested
    // element as its own.
    expect(idMaps[0]!.size).toBe(0);
    expect(idMaps[1]!.size).toBe(0);
    expect(idMaps[2]!.get("clip")).toBe("other--clip");
    expect(nested.querySelector("clipPath")!.getAttribute("id")).toBe("clip");
    expect(other.querySelector("clipPath")!.getAttribute("id")).toBe("other--clip");
  });

  it("mints a fresh id when the namespaced candidate is already taken", () => {
    const { roots, idMaps } = namespace(
      [
        { namespace: "block", html: CLIPPED },
        { namespace: "block", html: CLIPPED },
        { namespace: "block", html: CLIPPED },
      ],
      { before: '<div id="block--clip"></div>' },
    );
    // Same authored id, same namespace (the producer path has no runtime
    // ids), plus a pre-existing `block--clip`: every minted id is still
    // document-unique.
    expect(idMaps[0]!.size).toBe(0);
    expect(idMaps[1]!.get("clip")).toBe("block--clip-2");
    expect(idMaps[2]!.get("clip")).toBe("block--clip-3");
    expect(roots[1]!.querySelector("div")!.getAttribute("clip-path")).toBe("url(#block--clip-2)");
  });

  it("does not overwrite an authored id recorded by an earlier pass", () => {
    const { document } = parseHTML(
      `<!DOCTYPE html><html><body><div class="scope">${CLIPPED}</div><div class="scope">${CLIPPED.replace(
        'id="clip"',
        'id="clip" data-hf-authored-id="original"',
      )}</div></body></html>`,
    );
    const roots = [...document.querySelectorAll("div.scope")];
    namespaceCollidingSvgIds(
      document as unknown as Parameters<typeof namespaceCollidingSvgIds>[0],
      [
        { root: roots[0]!, namespace: "a" },
        { root: roots[1]!, namespace: "b" },
      ],
    );
    const renamed = roots[1]!.querySelector("clipPath")!;
    expect(renamed.getAttribute("id")).toBe("b--clip");
    expect(renamed.getAttribute(SVG_AUTHORED_ID_ATTR)).toBe("original");
  });
});

describe("rewriteSvgIdReferencesInCss", () => {
  it("is a no-op with an empty map", () => {
    const css = "#clip { fill: red; }";
    expect(rewriteSvgIdReferencesInCss(css, new Map())).toBe(css);
  });

  it("rewrites a bare id selector to the namespaced id", () => {
    const idMap = new Map([["clip", "scene-a--clip"]]);
    const css = "#clip rect { fill: red; }";
    expect(rewriteSvgIdReferencesInCss(css, idMap)).toContain("#scene-a--clip rect");
  });

  it("rewrites a url(#id) declaration value", () => {
    const idMap = new Map([["fx", "scene-a--fx"]]);
    const css = ".glow { filter: url(#fx); }";
    expect(rewriteSvgIdReferencesInCss(css, idMap)).toContain("filter: url(#scene-a--fx)");
  });

  it("does not touch an id selector for an id outside the map", () => {
    const idMap = new Map([["clip", "scene-a--clip"]]);
    const css = "#other { fill: red; }";
    expect(rewriteSvgIdReferencesInCss(css, idMap)).toBe(css);
  });

  it("does not confuse a short id with a longer one that starts with it", () => {
    const idMap = new Map([
      ["clip", "scene-a--clip"],
      ["clip2", "scene-a--clip2"],
    ]);
    const css = "#clip2 { fill: red; }";
    const result = rewriteSvgIdReferencesInCss(css, idMap);
    expect(result).toContain("#scene-a--clip2");
    expect(result).not.toContain("scene-a--clipscene-a");
  });

  it("matches an escaped id selector and emits a valid escaped replacement", () => {
    // `id="fx.1"` is spelled `#fx\.1` in CSS. The raw id must be matched
    // through the escape, and the renamed id re-escaped, or the rule
    // silently stops applying after the rename.
    const idMap = new Map([["fx.1", "scene-b--fx.1"]]);
    const css = String.raw`#fx\.1 { opacity: .5; } .x { filter: url(#fx.1); }`;
    const result = rewriteSvgIdReferencesInCss(css, idMap);
    expect(result).toContain(String.raw`#scene-b--fx\.1 { opacity: .5; }`);
    expect(result).toContain("filter: url(#scene-b--fx.1)");
  });

  it("decodes hex identifier escapes before matching", () => {
    // `\31 ` is the hex escape for "1"; `\2e` for "."; both spell `fx.1`.
    const idMap = new Map([["fx.1", "scene-b--fx.1"]]);
    const css = String.raw`#fx\2e\31 { opacity: .5; } #fx\2e 1 { color: red }`;
    const result = rewriteSvgIdReferencesInCss(css, idMap);
    // The whitespace after `\31 ` belongs to the escape, so it is consumed.
    expect(result).toMatch(/#scene-b--fx\\\.1\s*\{ opacity: \.5; \}/);
    expect(result).toMatch(/#scene-b--fx\\\.1\s*\{ color: red \}/);
  });

  it("re-escapes characters the renamed id still carries", () => {
    const idMap = new Map([["a b", "scene-b--a b"]]);
    const css = String.raw`#a\ b { opacity: .5; }`;
    expect(rewriteSvgIdReferencesInCss(css, idMap)).toContain(String.raw`#scene-b--a\ b {`);
  });

  it("leaves a #id inside an attribute selector or string untouched", () => {
    const idMap = new Map([["clip", "scene-a--clip"]]);
    const css = `[data-ref="#clip"] { fill: red; } .x::after { content: "#clip"; }`;
    expect(rewriteSvgIdReferencesInCss(css, idMap)).toBe(css);
  });
});
