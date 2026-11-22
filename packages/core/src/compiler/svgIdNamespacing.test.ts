import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { parseHTML } from "linkedom";
import postcss from "postcss";

const hashCalls = vi.hoisted(() => [] as string[]);
vi.mock("../canary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../canary")>();
  return {
    ...actual,
    fnv1a32: (input: string) => {
      hashCalls.push(input);
      return actual.fnv1a32(input);
    },
  };
});
import {
  SVG_AUTHORED_ID_ATTR,
  namespaceCollidingSvgIds,
  rewriteSvgIdReferencesInCss,
  sceneClipRoots,
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

it("preserves the first document target when a child has no local definition", () => {
  const { document, idMaps } = namespace(
    [
      {
        namespace: "earlier",
        html: '<svg><linearGradient id="paint"/><rect fill="url(#paint)"/></svg>',
      },
      {
        namespace: "parent",
        html: '<svg><linearGradient id="paint"/><rect fill="url(#paint)"/></svg>',
      },
      { namespace: "child", html: '<svg><rect class="child" fill="url(#paint)"/></svg>' },
    ],
    { after: '<svg><linearGradient id="paint"/></svg>' },
  );
  expect(document.querySelector(".child")!.getAttribute("fill")).toBe("url(#earlier--paint)");
  expect(idMaps[2]!.get("paint")).toBe("earlier--paint");
});

describe("rewriteSvgIdReferencesInCss", () => {
  it("is a no-op with an empty map", () => {
    const css = "#clip { fill: red; }";
    expect(rewriteSvgIdReferencesInCss(css, new Map())).toBe(css);
  });

  it("keeps authored and namespaced targets in a bare id selector", () => {
    const idMap = new Map([["clip", "scene-a--clip"]]);
    const css = "#clip rect { fill: red; }";
    expect(rewriteSvgIdReferencesInCss(css, idMap)).toContain(":is(#clip, #scene-a--clip) rect");
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
    expect(result).toContain(String.raw`:is(#fx\.1, #scene-b--fx\.1) { opacity: .5; }`);
    expect(result).toContain("filter: url(#scene-b--fx.1)");
  });

  it("decodes hex identifier escapes before matching", () => {
    // `\31 ` is the hex escape for "1"; `\2e` for "."; both spell `fx.1`.
    const idMap = new Map([["fx.1", "scene-b--fx.1"]]);
    const css = String.raw`#fx\2e\31 { opacity: .5; } #fx\2e 1 { color: red }`;
    const result = rewriteSvgIdReferencesInCss(css, idMap);
    // The whitespace after `\31 ` belongs to the escape, so it is consumed.
    expect(result).toMatch(/#scene-b--fx\\\.1\)\s*\{ opacity: \.5; \}/);
    expect(result).toMatch(/#scene-b--fx\\\.1\)\s*\{ color: red \}/);
  });

  it("re-escapes characters the renamed id still carries", () => {
    const idMap = new Map([["a b", "scene-b--a b"]]);
    const css = String.raw`#a\ b { opacity: .5; }`;
    expect(rewriteSvgIdReferencesInCss(css, idMap)).toContain(
      String.raw`:is(#a\ b, #scene-b--a\ b) {`,
    );
  });

  it("leaves a #id inside an attribute selector or string untouched", () => {
    const idMap = new Map([["clip", "scene-a--clip"]]);
    const css = `[data-ref="#clip"] { fill: red; } .x::after { content: "#clip"; }`;
    expect(rewriteSvgIdReferencesInCss(css, idMap)).toBe(css);
  });
});

it("rewrites case-insensitive CSS URL functions in attributes and styles", () => {
  const { roots, idMaps } = namespace([
    { namespace: "a", html: CLIPPED },
    {
      namespace: "b",
      html: '<svg><clipPath id="clip"/><rect clip-path="URL(#clip)"/></svg>',
      cssTexts: ["rect { clip-path: Url(#clip) }"],
    },
  ]);
  expect(roots[1]!.querySelector("rect")!.getAttribute("clip-path")).toBe("URL(#b--clip)");
  expect(rewriteSvgIdReferencesInCss("rect { clip-path: Url(#clip) }", idMaps[1]!)).toContain(
    "Url(#b--clip)",
  );
});

it("finalizes initially referenced keepers while allowing first-use references after scripts", () => {
  const { document } = parseHTML(`<!doctype html><html><body>
    <div class="a"><svg><clipPath id="clip"/><g clip-path="url(#clip)"/><path id="late"/><path id="script-only"/></svg></div>
    <div class="b"><svg><clipPath id="clip"/><g clip-path="url(#clip)"/><path id="late"/><path id="script-only"/></svg></div>
  </body></html>`);
  const roots = [document.querySelector(".a")!, document.querySelector(".b")!];
  const scopes = roots.map((root, index) => ({ root, namespace: index === 0 ? "a" : "b" }));
  const finalized = new Set<Element>();
  namespaceCollidingSvgIds(document, scopes, finalized);
  const definitions = roots.map((root) => root.querySelector("clipPath")!);
  const captured = definitions.map((target) => target.id);
  const html = document.createElement("div");
  html.id = "clip";
  document.body.appendChild(html);
  for (const root of roots) {
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#late");
    root.querySelector("svg")!.appendChild(use);
  }
  namespaceCollidingSvgIds(document, scopes, finalized);
  expect(definitions.map((target) => target.id)).toEqual(captured);
  expect(captured).toEqual(["clip", "b--clip"]);
  expect(roots.map((root) => root.querySelector("use")!.getAttribute("href"))).toEqual([
    "#late",
    "#b--late",
  ]);
  expect(roots.map((root) => root.querySelector('path[id="script-only"]')?.id)).toEqual([
    "script-only",
    "script-only",
  ]);
  expect(roots[1]!.querySelector("g")!.getAttribute("clip-path")).toBe("url(#b--clip)");
});

function scopedDocument(specs: ScopeSpec[], after = "") {
  const { document } = parseHTML(
    `<!DOCTYPE html><html><body>${specs.map((spec) => `<div class="scope">${spec.html}</div>`).join("")}${after}</body></html>`,
  );
  const roots = [...document.querySelectorAll("div.scope")];
  const scopes = specs.map((spec, index) => ({ root: roots[index]!, namespace: spec.namespace }));
  return {
    document: document as unknown as Parameters<typeof namespaceCollidingSvgIds>[0],
    scopes,
  };
}

function countMapSets<T>(run: () => T): { result: T; sets: number } {
  const set = vi.spyOn(Map.prototype, "set");
  try {
    const result = run();
    return { result, sets: set.mock.calls.length };
  } finally {
    set.mockRestore();
  }
}

// fails without the fix: each scope copied the whole document rename table, scopes x ids entries.
it("shares one document rename table across scopes instead of copying it per scope", () => {
  const ids = Array.from({ length: 200 }, (_, index) => `c${index}`);
  const defs = ids.map((id) => `<clipPath id="${id}"/><rect clip-path="url(#${id})"/>`).join("");
  const { document, scopes } = scopedDocument(
    [
      { namespace: "first", html: `<svg>${defs}</svg>` },
      ...ids.map((_, index) => ({ namespace: `m${index}`, html: "<i></i>" })),
    ],
    `<svg>${ids.map((id) => `<clipPath id="${id}"/>`).join("")}</svg>`,
  );

  const { result: idMaps, sets } = countMapSets(() => namespaceCollidingSvgIds(document, scopes));

  expect(idMaps[200]!.get("c7")).toBe("first--c7");
  expect(idMaps[200]!.size).toBe(200);
  expect(sets).toBeLessThan(10_000);
});

// fails without the fix: every selector rebuilt a table of every renamed id.
it("looks up only the ids a stylesheet names", () => {
  const idMap = new Map(Array.from({ length: 2000 }, (_, index) => [`c${index}`, `m--c${index}`]));
  const css = Array.from(
    { length: 300 },
    (_, index) => `.r${index} #c${index} { fill: url(#c${index}); }`,
  ).join("\n");

  const { result, sets } = countMapSets(() => rewriteSvgIdReferencesInCss(css, idMap));

  expect(result).toContain(".r5 :is(#c5, #m--c5) { fill: url(#m--c5); }");
  expect(sets).toBeLessThan(20_000);
});

// fails without the fix: every read of a scope's size walked every id the scope renames.
it("reads a scope's size without walking its ids, however many styles ask", () => {
  const ids = Array.from({ length: 500 }, (_, index) => `c${index}`);
  const defs = ids.map((id) => `<clipPath id="${id}"/><rect clip-path="url(#${id})"/>`).join("");
  const { document, scopes } = scopedDocument([
    { namespace: "a", html: `<svg>${defs}</svg>` },
    { namespace: "b", html: `<svg>${defs}</svg>` },
  ]);
  const idMap = namespaceCollidingSvgIds(document, scopes)[1]!;
  const has = vi.spyOn(Map.prototype, "has");
  let lookups: number;
  try {
    for (let i = 0; i < 500; i += 1) rewriteSvgIdReferencesInCss(`.s${i} { color: red; }`, idMap);
    lookups = has.mock.calls.length;
  } finally {
    has.mockRestore();
  }

  expect(idMap.size).toBe(500);
  expect(lookups).toBeLessThan(500);
});

// fails without the fix: every attribute selector compared its name against the scope's whole alias list, and an
// exact match still checked one copy per element that referenced the same symbol.
it("rewrites attribute selectors in linear time however many fragment references the mount holds", () => {
  const rewrite = (n: number, target: (i: number) => string) => {
    let reads = 0;
    const references = Array.from({ length: n }, (_, i) => {
      const before = `#${target(i)}`;
      return {
        name: "href",
        localName: "href",
        namespaceURI: null,
        get before() {
          reads += 1;
          return before;
        },
        after: `#m--${target(i)}`,
      };
    });
    const css = Array.from({ length: n }, (_, i) => `[href="#${target(i)}"] { fill: red; }`).join(
      "\n",
    );
    return { css: rewriteSvgIdReferencesInCss(css, new Map(), references), reads: () => reads };
  };
  const work = (n: number, target: (i: number) => string) => rewrite(n, target).reads();
  const distinct = (i: number) => `g${i}`;
  const sameSymbol = () => "g";

  expect(rewrite(8, distinct).css).toContain(`:is([href="#g5"], [href="#m--g5"]) { fill: red; }`);
  expect(rewrite(8, sameSymbol).css).toContain(`:is([href="#g"], [href="#m--g"]) { fill: red; }`);
  // About 2 when linear, about 4 when every selector checks every alias.
  expect(work(800, distinct) / work(400, distinct)).toBeLessThan(2.6);
  expect(work(800, sameSymbol) / work(400, sameSymbol)).toBeLessThan(2.6);
});

// An alias escapes `<` itself, so its rule can't end its style element even without postcss.
it("writes `<` in an aliased attribute value as a CSS escape itself, and the rule still matches it", () => {
  const tail = "</style><script>window.ran = true</script>";
  const after = `clip.mp4#url(#m--c)${tail}`;
  const references = [
    { name: "src", localName: "src", namespaceURI: null, before: `clip.mp4#url(#c)${tail}`, after },
  ];
  const css = rewriteSvgIdReferencesInCss(
    `video[src*="url(#c)"] { opacity: 0.5; }`,
    new Map(),
    references,
  );

  expect(css).not.toMatch(/<\/style|<script/i);
  const { document } = new JSDOM(`<style>${css}</style><video></video>`).window;
  const video = document.querySelector("video")!;
  video.setAttribute("src", after);
  expect(document.querySelectorAll("style, script").length).toBe(1);
  const rule = document.styleSheets[0]!.cssRules[0] as CSSStyleRule;
  expect(video.matches(rule.selectorText)).toBe(true);
});

// fails without the fix: the whole namespace, however long, prefixed every renamed id.
it("caps a long namespace's prefix, each mount's renamed ids still distinct", () => {
  const long = (end: string) => `${"x".repeat(5000)}${end}`;
  const { idMaps } = namespace([
    { namespace: "a", html: CLIPPED },
    { namespace: long("1"), html: CLIPPED },
    { namespace: long("2"), html: CLIPPED },
  ]);

  const one = idMaps[1]!.get("clip")!;
  const two = idMaps[2]!.get("clip")!;
  expect(one.length).toBeLessThan(64);
  expect(two.length).toBeLessThan(64);
  expect(two).not.toBe(one);
});

const attributeBytes = (document: { querySelectorAll(selector: string): Iterable<Element> }) =>
  [...document.querySelectorAll("*")].reduce(
    (sum, el) =>
      sum + [...el.attributes].reduce((n, attr) => n + attr.name.length + attr.value.length + 4, 0),
    0,
  );

// fails without the fix: the pass wrote renamed ids and their records without charging them.
it("charges every attribute byte it adds", () => {
  const { document, scopes } = scopedDocument([
    { namespace: "a", html: CLIPPED },
    { namespace: "b", html: CLIPPED },
    { namespace: "c", html: CLIPPED },
  ]);
  const before = attributeBytes(document);
  const charged: number[] = [];

  namespaceCollidingSvgIds(document, scopes, undefined, (_scope, bytes) => charged.push(bytes));

  const total = charged.reduce((sum, bytes) => sum + bytes, 0);
  expect(total).toBeGreaterThan(0);
  expect(total).toBe(attributeBytes(document) - before);
});

it("stops at the first charge the budget refuses", () => {
  const { document, scopes } = scopedDocument([
    { namespace: "a", html: CLIPPED },
    { namespace: "b", html: CLIPPED },
  ]);

  expect(() =>
    namespaceCollidingSvgIds(document, scopes, undefined, () => {
      throw new Error("too large");
    }),
  ).toThrow("too large");
});

// fails without the fix: every renamed id re-sanitized and re-hashed its mount's whole namespace.
it("hashes a long namespace once per mount, not once per renamed id", () => {
  const ids = Array.from({ length: 200 }, (_, index) => `c${index}`);
  const defs = ids.map((id) => `<clipPath id="${id}"/><rect clip-path="url(#${id})"/>`).join("");
  const { document, scopes } = scopedDocument([
    { namespace: "a", html: `<svg>${defs}</svg>` },
    { namespace: "x".repeat(5000), html: `<svg>${defs}</svg>` },
  ]);
  hashCalls.length = 0;

  const idMaps = namespaceCollidingSvgIds(document, scopes);

  expect(idMaps[1]!.size).toBe(200);
  expect(hashCalls.length).toBe(1);
});

// fails without the fix: the rewrite built every alternative, and its growth was charged only once the sheet existed.
describe("rewriteSvgIdReferencesInCss charges its growth while it builds", () => {
  const limit = 64 * 1024;
  const references = Array.from({ length: 2000 }, (_, i) => ({
    name: "href",
    localName: "href",
    namespaceURI: null,
    before: "#a",
    after: `#m-${i}-${"x".repeat(100)}`,
  }));

  it.each([
    `[href="#a"]`,
    `[href^="#"]`,
    `[href$="a"]`,
    `[href*="a"]`,
    `[href~="#a"]`,
    `[href|="#a"]`,
    `[href="#A" i]`,
  ])("stops within one alternative of the budget for %s", (predicate) => {
    const css = Array.from({ length: 50 }, (_, i) => `${predicate} .r${i} { fill: red; }`).join(
      "\n",
    );
    let charged = 0;
    const charge = (bytes: number) => {
      charged += bytes;
      if (charged > limit) throw new Error("over budget");
    };

    expect(() => rewriteSvgIdReferencesInCss(css, new Map(), references, charge)).toThrow(
      "over budget",
    );
    expect(charged).toBeLessThan(limit + 200);
  });

  it("stops within one id rename of the budget", () => {
    const css = Array.from({ length: 2000 }, (_, i) => `#clip .r${i} { fill: red; }`).join("\n");
    const idMap = new Map([["clip", `clip-${"x".repeat(200)}`]]);
    let charged = 0;
    const charge = (bytes: number) => {
      charged += bytes;
      if (charged > limit) throw new Error("over budget");
    };
    expect(() => rewriteSvgIdReferencesInCss(css, idMap, [], charge)).toThrow("over budget");
    expect(charged).toBeLessThan(limit + 500);
  });

  // fails without the fix: the id's decoded length was charged against, not the escaped token it replaced.
  const renamedClip = [
    {
      name: "id",
      localName: "id",
      namespaceURI: null,
      before: "clip",
      after: "m--clip-namespaced",
    },
  ];
  it.each([
    [`#\\63 lip { fill: red; }`, new Map([["clip", "m--clip-namespaced"]]), []],
    [`#cl\\69 p .a { fill: red; }`, new Map([["clip", "m--clip-namespaced"]]), []],
    [`#\\63 lip { fill: red; }`, new Map(), renamedClip],
  ])("rewrites %j with exactly its growth left (%#)", (css, idMap, aliases) => {
    const growth = rewriteSvgIdReferencesInCss(css, idMap, aliases).length - css.length;
    let left = growth;
    const rewritten = rewriteSvgIdReferencesInCss(css, idMap, aliases, (bytes) => {
      left -= bytes;
      if (left < 0) throw new Error("over budget");
    });
    expect(growth).toBeGreaterThan(0);
    expect(rewritten).toContain("m--clip-namespaced");
    expect(left).toBe(0);
  });

  it.each([
    [`.x,[href="#a"],\n\n    .b { fill: red; }`, new Map()],
    [`.x,#clip,\n\n    .b { fill: red; }`, new Map([["clip", "m--clip"]])],
    [`[href="#a"] #clip { fill: url(#clip); }`, new Map([["clip", "m--clip"]])],
  ])("charges exactly the growth of %j", (css, idMap) => {
    let charged = 0;
    const rewritten = rewriteSvgIdReferencesInCss(css, idMap, references.slice(0, 2), (bytes) => {
      charged += bytes;
    });
    expect(rewritten).not.toBe(css);
    expect(charged).toBe(Math.max(0, rewritten.length - css.length));
  });

  it("charges nothing for a sheet it leaves as it is", () => {
    const charge = vi.fn();
    expect(
      rewriteSvgIdReferencesInCss(`[href="#b"] { fill: red; }`, new Map(), references, charge),
    ).toBe(`[href="#b"] { fill: red; }`);
    expect(charge).not.toHaveBeenCalled();
  });
});

// fails without the fix: each opener with no closer rescanned the rest of the selector, quadratic in its length.
it("rewriteSvgIdReferencesInCss scans a selector of 300000 unclosed brackets in time linear in its length", () => {
  const references = [
    { name: "href", localName: "href", namespaceURI: null, before: "#a", after: "#m-a" },
  ];
  const run = "[".repeat(300_000);
  expect(
    rewriteSvgIdReferencesInCss(`:is(${run}) { fill: red; }`, new Map(), references),
  ).toContain(run);
}, 10_000);

// fails without the fix: every element of the root scope was checked against every excluded clip, one contains() each.
it("checks a scope's elements against thousands of excluded clips in one walk each, not once per clip", () => {
  const clips = Array.from(
    { length: 2000 },
    (_, i) => `<div data-start="${i}" data-duration="1"><svg><rect/></svg></div>`,
  ).join("");
  const { document } = parseHTML(
    `<!DOCTYPE html><html><body><div data-composition-id="main"><svg><clipPath id="c"/><rect clip-path="url(#c)"/></svg><div data-composition-id="sub" data-composition-src="s.html"></div>${clips}</div></body></html>`,
  );
  const queryable = document as unknown as Parameters<typeof namespaceCollidingSvgIds>[0];
  const root = document.querySelector('[data-composition-id="main"]')!;
  const host = document.querySelector("[data-composition-src]")!;
  const elements = root.querySelectorAll("*").length;
  let owner = Object.getPrototypeOf(root);
  while (!Object.hasOwn(owner, "contains")) owner = Object.getPrototypeOf(owner);
  const contains = vi.spyOn(owner, "contains");
  let checks: number;
  let found: Element[];
  try {
    found = sceneClipRoots(queryable, [host]);
    namespaceCollidingSvgIds(queryable, [
      { root, namespace: "main", exclude: [host, ...found] },
      ...found.map((clip, i) => ({ root: clip, namespace: `clip${i}` })),
    ]);
    checks = contains.mock.calls.length;
  } finally {
    contains.mockRestore();
  }

  expect(found).toHaveLength(2000);
  expect(checks).toBeLessThan(elements);
});

// fails without the fix: each selector's comparison re-read rule.selectors, which splits the whole list again.
it("splits a rule's selector list a fixed number of times, however many selectors it holds", () => {
  const css = `${Array.from({ length: 2000 }, (_, i) => `#x${i}`).join(",")} { color: red; }`;
  const alias = { name: "href", localName: "href", namespaceURI: null, before: "#a", after: "#a" };
  const comma = vi.spyOn(postcss.list, "comma");
  let splits: number;
  try {
    rewriteSvgIdReferencesInCss(css, new Map(), [alias]);
    splits = comma.mock.calls.length;
  } finally {
    comma.mockRestore();
  }

  expect(splits).toBeGreaterThan(0);
  expect(splits).toBeLessThan(10);
});

// fails without the fix: each mount sharing a namespace probed past every name the earlier mounts minted.
it("mints names for many mounts sharing a namespace with probes linear in the renames", () => {
  const ids = Array.from({ length: 20 }, (_, index) => `c${index}`);
  const defs = ids.map((id) => `<clipPath id="${id}"/><rect clip-path="url(#${id})"/>`).join("");
  const mounts = 1000;
  const { document, scopes } = scopedDocument([
    { namespace: "host", html: `<svg>${defs}</svg>` },
    ...Array.from({ length: mounts }, () => ({ namespace: "scene", html: `<svg>${defs}</svg>` })),
  ]);
  const has = vi.spyOn(Set.prototype, "has");
  let idMaps: ReturnType<typeof namespaceCollidingSvgIds>;
  let probes: number;
  try {
    idMaps = namespaceCollidingSvgIds(document, scopes);
    probes = has.mock.calls.length;
  } finally {
    has.mockRestore();
  }

  const minted = idMaps.slice(1).flatMap((idMap) => ids.map((id) => idMap.get(id)!));
  expect(minted).toHaveLength(ids.length * mounts);
  expect(new Set(minted).size).toBe(minted.length);
  expect(probes).toBeLessThan(100 * minted.length);
});

// fails without the fix: every ^=, $=, ~= and |= predicate compared its value against every alias.
it("looks up prefix, suffix, token and dash predicates without reading every alias", () => {
  let reads = 0;
  const references = Array.from({ length: 2000 }, (_, i) => ({
    name: "href",
    localName: "href",
    namespaceURI: null,
    get before() {
      reads++;
      return `#a${i}`;
    },
    after: `#m${i}`,
  }));
  const css = ["^=", "$=", "~=", "|="]
    .flatMap((operator) =>
      Array.from({ length: 200 }, (_, i) => `[href${operator}"none${i}"] { fill: red; }`),
    )
    .join("\n");

  expect(rewriteSvgIdReferencesInCss(css, new Map(), references)).toBe(css);
  expect(reads).toBeLessThan(10 * references.length);
});

// fails without the fix: a *= predicate that matched nothing scanned every alias uncharged.
it("charges a substring predicate's scan to the budget, so it stops many non-matching ones", () => {
  const references = Array.from({ length: 2000 }, (_, i) => ({
    name: "href",
    localName: "href",
    namespaceURI: null,
    before: `#a${i}`,
    after: `#m${i}`,
  }));
  const css = Array.from({ length: 500 }, (_, i) => `[href*="none${i}"] { fill: red; }`).join("\n");
  const limit = 1024 * 1024;
  let charged = 0;
  const charge = (bytes: number) => {
    charged += bytes;
    if (charged > limit) throw new Error("over budget");
  };

  expect(() => rewriteSvgIdReferencesInCss(css, new Map(), references, charge)).toThrow(
    "over budget",
  );
});

it("gives each attribute operator the same alternatives as matching every alias in turn", () => {
  const befores = ["#a", "#a-b", "#ab", "#A", "x #a y", "#b", "#a", "url(#a)", "#A-B"];
  const references = befores.map((before, i) => ({
    name: "href",
    localName: "href",
    namespaceURI: null,
    before,
    after: `#m${i}`,
  }));
  const matchers: Record<string, (before: string, value: string) => boolean> = {
    "=": (before, value) => before === value,
    "~=": (before, value) => before.split(/[ \t\r\n\f]+/).includes(value),
    "|=": (before, value) => before === value || before.startsWith(`${value}-`),
    "^=": (before, value) => before.startsWith(value),
    "$=": (before, value) => before.endsWith(value),
    "*=": (before, value) => before.includes(value),
  };
  for (const [operator, matches] of Object.entries(matchers))
    for (const value of ["#a", "#A", "a", "#a-", "b", ")", "#"])
      for (const flag of ["", " i"]) {
        const fold = (text: string) => (flag ? text.toLowerCase() : text);
        const predicate = `[href${operator}"${value}"${flag}]`;
        const alternatives = [
          ...new Set(
            references
              .filter(({ before }) => matches(fold(before), fold(value)))
              .map(({ after }) => `[href="${after}"${flag}]`),
          ),
        ];
        const expected = alternatives.length
          ? `:is(${[predicate, ...alternatives].join(", ")})`
          : predicate;

        expect(
          rewriteSvgIdReferencesInCss(`${predicate} { fill: red; }`, new Map(), references),
          predicate,
        ).toBe(`${expected} { fill: red; }`);
      }
});

// fails without the fix: each predicate visited every alias of its name in any namespace, then dropped them unpaid.
it("reads only aliases in the predicate's namespace, so other-namespace matches cost nothing per predicate", () => {
  let namespaceReads = 0;
  const references = Array.from({ length: 2000 }, (_, i) => ({
    name: "xlink:href",
    localName: "href",
    get namespaceURI() {
      namespaceReads++;
      return "http://www.w3.org/1999/xlink";
    },
    before: `#a${i}`,
    after: `#m${i}`,
  }));
  const predicates = ['="#a1"', '^="#a"', '$="1"', '|="#a1"', '~="#a1"'].flatMap((match) => [
    `[xlink\\:href${match}]`,
    `[xlink\\:href${match} i]`,
  ]);
  const css = Array.from({ length: 100 }, () => predicates)
    .flat()
    .map((selector) => `${selector} { fill: red; }`)
    .join("\n");

  expect(rewriteSvgIdReferencesInCss(css, new Map(), references)).toBe(css);
  expect(namespaceReads).toBeLessThan(10 * references.length);
});
