import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  SVG_AUTHORED_ID_ATTR,
  namespaceSvgIds,
  rewriteSvgIdReferencesInCss,
} from "./svgIdNamespacing";

function namespace(html: string, ns: string) {
  const { document } = parseHTML(html);
  const idMap = namespaceSvgIds(document as unknown as Parameters<typeof namespaceSvgIds>[0], ns);
  return { document, idMap };
}

describe("namespaceSvgIds", () => {
  it("is a no-op when there are no svg ids", () => {
    const { idMap } = namespace("<div><p>hello</p></div>", "scene-a");
    expect(idMap.size).toBe(0);
  });

  it("is a no-op when namespace is empty (anonymous host)", () => {
    const { document, idMap } = namespace('<svg><clipPath id="clip"><rect/></clipPath></svg>', "");
    expect(idMap.size).toBe(0);
    expect(document.querySelector("clipPath")!.getAttribute("id")).toBe("clip");
  });

  it("renames an svg element id and records the authored id", () => {
    const { document, idMap } = namespace(
      '<svg><clipPath id="clip"><rect/></clipPath></svg>',
      "scene-a",
    );
    const clipPath = document.querySelector("clipPath")!;
    expect(idMap.get("clip")).toBe("scene-a--clip");
    expect(clipPath.getAttribute("id")).toBe("scene-a--clip");
    expect(clipPath.getAttribute(SVG_AUTHORED_ID_ATTR)).toBe("clip");
  });

  it("rewrites a clip-path url() presentation attribute", () => {
    const { document } = namespace(
      '<svg><clipPath id="clip"><rect/></clipPath></svg><div clip-path="url(#clip)"></div>',
      "scene-a",
    );
    expect(document.querySelector("div")!.getAttribute("clip-path")).toBe("url(#scene-a--clip)");
  });

  it("rewrites filter/mask/fill/stroke/marker url() references", () => {
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
    const { document } = namespace(html, "scene-b");
    const div = document.querySelector("div")!;
    expect(div.getAttribute("style")).toBe("filter:url(#scene-b--fx); mask: url('#scene-b--msk')");
    const rect = document.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("url(#scene-b--grad)");
    expect(rect.getAttribute("stroke")).toBe("url(#scene-b--grad)");
    expect(rect.getAttribute("marker-start")).toBe("url(#scene-b--arrow)");
    expect(rect.getAttribute("marker-end")).toBe("url(#scene-b--arrow)");
  });

  it("rewrites <use href> and xlink:href fragment refs", () => {
    const html =
      '<svg><symbol id="shape"></symbol><use href="#shape"></use><use xlink:href="#shape"></use></svg>';
    const { document } = namespace(html, "scene-c");
    const uses = [...document.querySelectorAll("use")];
    expect(uses[0]!.getAttribute("href")).toBe("#scene-c--shape");
    expect(uses[1]!.getAttribute("xlink:href")).toBe("#scene-c--shape");
  });

  it("leaves unrelated hrefs and non-fragment urls untouched", () => {
    const html =
      '<svg><clipPath id="clip"><rect/></clipPath></svg>' +
      '<a href="https://example.com/#clip">link</a>' +
      '<div style="background:url(image.png)"></div>';
    const { document } = namespace(html, "scene-d");
    expect(document.querySelector("a")!.getAttribute("href")).toBe("https://example.com/#clip");
    expect(document.querySelector("div")!.getAttribute("style")).toBe("background:url(image.png)");
  });

  it("disambiguates two composition instances reusing the same catalog block ids", () => {
    // Same shape as the #3490 repro: two sibling scenes each author their
    // own #clip/#shape/#fx, and both must keep resolving to their OWN scene.
    const sceneA = namespace(
      '<svg><clipPath id="clip"><rect fill="red"/></clipPath><symbol id="shape"><circle/></symbol>' +
        '<filter id="fx"></filter></svg>' +
        '<g clip-path="url(#clip)"><use href="#shape"></use></g>' +
        '<div style="filter:url(#fx)"></div>',
      "scene-a",
    );
    const sceneB = namespace(
      '<svg><clipPath id="clip"><rect fill="blue"/></clipPath><symbol id="shape"><circle/></symbol>' +
        '<filter id="fx"></filter></svg>' +
        '<g clip-path="url(#clip)"><use href="#shape"></use></g>' +
        '<div style="filter:url(#fx)"></div>',
      "scene-b",
    );

    expect(sceneA.document.querySelector("g")!.getAttribute("clip-path")).toBe(
      "url(#scene-a--clip)",
    );
    expect(sceneB.document.querySelector("g")!.getAttribute("clip-path")).toBe(
      "url(#scene-b--clip)",
    );
    // The two namespaced ids are document-unique, so merging both fragments
    // into one document (what inlining actually does) no longer collides.
    expect(sceneA.idMap.get("clip")).not.toBe(sceneB.idMap.get("clip"));
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
});
