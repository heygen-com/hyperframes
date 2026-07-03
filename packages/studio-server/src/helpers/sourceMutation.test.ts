import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import {
  removeElementFromHtml,
  patchElementInHtml,
  probeElementInSource,
} from "./sourceMutation.js";

describe("removeElementFromHtml", () => {
  it("removes a self-closing element by id", () => {
    const html = `<!doctype html><html><body><div data-composition-id="main"><img id="photo" src="asset.png" /><div id="rest"></div></div></body></html>`;

    const updated = removeElementFromHtml(html, { id: "photo" });

    expect(updated).not.toContain(`id="photo"`);
    expect(updated).toContain(`id="rest"`);
  });

  it("removes a matched composition host by selector", () => {
    const html = `<!doctype html><html><body><div data-composition-id="main"><div data-composition-id="scene-a"><span>Scene A</span></div><div data-composition-id="scene-b"></div></div></body></html>`;

    const updated = removeElementFromHtml(html, {
      selector: '[data-composition-id="scene-a"]',
    });

    expect(updated).not.toContain(`data-composition-id="scene-a"`);
    expect(updated).toContain(`data-composition-id="scene-b"`);
  });

  it("supports fragment html by returning updated body markup", () => {
    const html = `<div id="photo"></div><div id="rest"></div>`;

    expect(removeElementFromHtml(html, { id: "photo" })).toBe(`<div id="rest"></div>`);
  });
});

describe("patchElementInHtml", () => {
  const FIXTURE = `<!doctype html><html><head></head><body>
<div id="root" data-composition-id="main">
  <div class="layer" data-composition-id="overlay" data-composition-src="compositions/overlay.html">
    <div class="chrome">
      <span class="brand">HyperFrames</span>
    </div>
  </div>
  <div id="hero" class="hero-heading" style="font-size: 48px">Hello World</div>
</div>
</body></html>`;

  it("patches inline style by id", () => {
    const { html: result, matched } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "inline-style", property: "color", value: "red" },
    ]);

    expect(matched).toBe(true);
    expect(result).toMatch(/color:\s*red/);
    expect(result).toContain('id="hero"');
  });

  it("patches inline style by class selector", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { selector: ".hero-heading" }, [
      { type: "inline-style", property: "font-size", value: "72px" },
    ]);

    expect(result).toMatch(/font-size:\s*72px/);
  });

  it("patches data attribute", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "attribute", property: "hf-studio-path-offset", value: "true" },
    ]);

    expect(result).toContain('data-hf-studio-path-offset="true"');
  });

  it("does not double data- prefix when property already has it", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "attribute", property: "data-hf-studio-path-offset", value: "true" },
    ]);

    expect(result).toContain('data-hf-studio-path-offset="true"');
    expect(result).not.toContain("data-data-hf-studio-path-offset");
  });

  it("does not double data- prefix for any studio attribute", () => {
    const attrs = [
      "data-hf-studio-path-offset",
      "data-hf-studio-original-translate",
      "data-hf-studio-original-inline-translate",
      "data-hf-studio-box-size",
      "data-hf-studio-rotation",
    ];
    for (const attr of attrs) {
      const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
        { type: "attribute", property: attr, value: "true" },
      ]);
      expect(result).toContain(`${attr}="true"`);
      expect(result).not.toContain(`data-${attr}`);
    }
  });

  it("removes attribute with data- prefix already present", () => {
    const { html: withAttr } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "attribute", property: "data-hf-studio-path-offset", value: "true" },
    ]);
    expect(withAttr).toContain('data-hf-studio-path-offset="true"');

    const { html: removed } = patchElementInHtml(withAttr, { id: "hero" }, [
      { type: "attribute", property: "data-hf-studio-path-offset", value: null },
    ]);
    expect(removed).not.toContain("hf-studio-path-offset");
  });

  it("patches html attribute", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "title", value: "greeting" },
    ]);

    expect(result).toContain('title="greeting"');
  });

  it("patches text content", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "text-content", property: "", value: "New Title" },
    ]);

    expect(result).toContain("New Title");
    expect(result).not.toContain("Hello World");
  });

  it("applies child-scoped inline style without changing the parent style", () => {
    const source = `<div data-hf-id="parent" style="color: red"><span class="line">A</span><span class="line">B</span></div>`;
    const { html: result, matched } = patchElementInHtml(source, { hfId: "parent" }, [
      {
        type: "inline-style",
        property: "color",
        value: "blue",
        childSelector: ":scope > span",
        childIndex: 1,
      },
    ]);

    expect(matched).toBe(true);
    const { document } = parseHTML(result);
    const parent = document.querySelector('[data-hf-id="parent"]');
    const children = Array.from(document.querySelectorAll(".line"));
    expect(parent?.getAttribute("style")).toContain("color: red");
    expect(children[0]?.getAttribute("style")).toBeNull();
    expect(children[1]?.getAttribute("style")).toContain("color: blue");
  });

  it("applies child-scoped text content to the child only", () => {
    const source = `<div data-hf-id="parent"><span class="line">A</span><span class="line">B</span></div>`;
    const { html: result, matched } = patchElementInHtml(source, { hfId: "parent" }, [
      {
        type: "text-content",
        property: "text",
        value: "B < C & D",
        childSelector: ":scope > span",
        childIndex: 1,
      },
    ]);

    expect(matched).toBe(true);
    const { document } = parseHTML(result);
    const children = Array.from(document.querySelectorAll(".line"));
    expect(children[0]?.textContent).toBe("A");
    expect(children[1]?.textContent).toBe("B < C & D");
  });

  it("rejects the whole batch when a child-scoped operation cannot resolve", () => {
    const source = `<div data-hf-id="parent"><span class="line">A</span><span class="line">B</span></div>`;
    const result = patchElementInHtml(source, { hfId: "parent" }, [
      {
        type: "inline-style",
        property: "color",
        value: "blue",
        childSelector: ":scope > span",
        childIndex: 0,
      },
      {
        type: "text-content",
        property: "text",
        value: "missing",
        childSelector: ":scope > strong",
        childIndex: 0,
      },
    ]);

    expect(result.matched).toBe(false);
    expect(result.html).toBe(source);
  });

  it("applies multiple operations in one call", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "inline-style", property: "color", value: "blue" },
      { type: "inline-style", property: "font-size", value: "96px" },
      { type: "attribute", property: "hf-studio-path-offset", value: "true" },
    ]);

    expect(result).toMatch(/color:\s*blue/);
    expect(result).toMatch(/font-size:\s*96px/);
    expect(result).toContain('data-hf-studio-path-offset="true"');
  });

  it("finds element by composition-id selector", () => {
    const { html: result } = patchElementInHtml(
      FIXTURE,
      { selector: '[data-composition-id="overlay"]' },
      [{ type: "inline-style", property: "opacity", value: "0.5" }],
    );

    expect(result).toMatch(/opacity:\s*0\.5/);
  });

  it("finds element by class with selectorIndex", () => {
    const html = `<div class="item">A</div><div class="item">B</div>`;
    const { html: result } = patchElementInHtml(html, { selector: ".item", selectorIndex: 1 }, [
      { type: "text-content", property: "", value: "Changed" },
    ]);

    expect(result).toContain("A");
    expect(result).toContain("Changed");
    expect(result).not.toContain(">B<");
  });

  it("returns unchanged html and matched:false when target not found", () => {
    const { html: result, matched } = patchElementInHtml(FIXTURE, { id: "nonexistent" }, [
      { type: "inline-style", property: "color", value: "red" },
    ]);

    expect(matched).toBe(false);
    expect(result).toBe(FIXTURE);
  });

  it("removes inline style when value is null", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "inline-style", property: "font-size", value: null },
    ]);

    expect(result).not.toContain("font-size");
  });

  it("removes attribute when value is null", () => {
    const { html: result } = patchElementInHtml(
      FIXTURE,
      { selector: '[data-composition-id="overlay"]' },
      [{ type: "html-attribute", property: "data-composition-src", value: null }],
    );

    expect(result).not.toContain("data-composition-src");
  });

  it("patches fragment html without doctype", () => {
    const fragment = `<div id="card" style="padding: 8px"><span>Title</span></div>`;
    const { html: result } = patchElementInHtml(fragment, { id: "card" }, [
      { type: "inline-style", property: "padding", value: "16px" },
    ]);

    expect(result).toMatch(/padding:\s*16px/);
  });

  it("rejects event handler attributes", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "onload", value: "fetch('/evil')" },
    ]);

    expect(result).not.toContain("onload");
    expect(result).not.toContain("fetch");
  });

  it("rejects javascript: URLs in src", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "src", value: "javascript:alert(1)" },
    ]);

    expect(result).not.toContain("javascript:");
  });

  it("allows aria-* and data-* attributes", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "aria-label", value: "greeting" },
      { type: "html-attribute", property: "data-custom", value: "test" },
    ]);

    expect(result).toContain('aria-label="greeting"');
    expect(result).toContain('data-custom="test"');
  });

  it("rejects srcdoc and formaction attributes", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "srcdoc", value: "<script>alert(1)</script>" },
      { type: "html-attribute", property: "formaction", value: "javascript:void(0)" },
    ]);

    expect(result).not.toContain("srcdoc");
    expect(result).not.toContain("formaction");
  });

  it("rejects on* event handlers regardless of casing", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "onClick", value: "alert(1)" },
      { type: "html-attribute", property: "ONERROR", value: "alert(2)" },
      { type: "html-attribute", property: "onmouseover", value: "alert(3)" },
    ]);

    expect(result).not.toContain("alert");
  });

  it("rejects data:text/html URIs in src", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      {
        type: "html-attribute",
        property: "src",
        value: "data:text/html,<script>alert(1)</script>",
      },
    ]);

    expect(result).not.toContain("data:text/html");
  });

  it("allows safe href values", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "href", value: "https://example.com" },
    ]);

    expect(result).toContain('href="https://example.com"');
  });

  it("rejects javascript: in href", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "href", value: "javascript:alert(1)" },
    ]);

    expect(result).not.toContain("javascript:");
  });

  it("allows legitimate form and media attributes", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "placeholder", value: "Enter text" },
      { type: "html-attribute", property: "target", value: "_blank" },
      { type: "html-attribute", property: "rel", value: "noopener" },
      { type: "html-attribute", property: "srcset", value: "img-2x.png 2x" },
    ]);

    expect(result).toContain('placeholder="Enter text"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener"');
    expect(result).toContain("srcset");
  });

  it("rejects unknown/dangerous attributes", () => {
    const { html: result } = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "xmlns", value: "http://evil.com" },
      { type: "html-attribute", property: "background", value: "http://evil.com/bg.js" },
      { type: "html-attribute", property: "dynsrc", value: "http://evil.com/vid.avi" },
    ]);

    expect(result).not.toContain("xmlns");
    expect(result).not.toContain("background=");
    expect(result).not.toContain("dynsrc");
  });
});

describe("probeElementInSource", () => {
  const FIXTURE = `<!doctype html><html><head></head><body>
<div id="root" data-composition-id="main">
  <div class="layer" data-composition-id="overlay" data-composition-src="compositions/overlay.html">
    <div class="chrome">
      <span class="brand">HyperFrames</span>
    </div>
  </div>
  <div id="hero" class="hero-heading" style="font-size: 48px">Hello World</div>
</div>
</body></html>`;

  it("returns true for an element found by id", () => {
    expect(probeElementInSource(FIXTURE, { id: "hero" })).toBe(true);
  });

  it("returns true for an element found by class selector", () => {
    expect(probeElementInSource(FIXTURE, { selector: ".hero-heading" })).toBe(true);
  });

  it("returns true for an element found by data-composition-id selector", () => {
    expect(probeElementInSource(FIXTURE, { selector: '[data-composition-id="overlay"]' })).toBe(
      true,
    );
  });

  it("returns false for an id that does not exist in source", () => {
    expect(probeElementInSource(FIXTURE, { id: "arrows-svg" })).toBe(false);
  });

  it("returns false for a class selector that does not exist", () => {
    expect(probeElementInSource(FIXTURE, { selector: ".phone-frame" })).toBe(false);
  });

  it("returns false when target has neither id nor selector", () => {
    expect(probeElementInSource(FIXTURE, {})).toBe(false);
  });

  it("returns true for class selector with valid selectorIndex", () => {
    const html = `<div class="item">A</div><div class="item">B</div>`;
    expect(probeElementInSource(html, { selector: ".item", selectorIndex: 1 })).toBe(true);
  });

  it("returns false for class selector with out-of-bounds selectorIndex", () => {
    const html = `<div class="item">A</div><div class="item">B</div>`;
    expect(probeElementInSource(html, { selector: ".item", selectorIndex: 5 })).toBe(false);
  });

  it("returns false for an element that would only exist after JS execution", () => {
    const sourceHtml = `<!doctype html><html><head></head><body>
<div id="root" data-composition-id="main">
  <div id="canvas"></div>
  <script>
    const svg = document.createElement("div");
    svg.id = "arrows-svg";
    document.getElementById("canvas").appendChild(svg);
  </script>
</div>
</body></html>`;

    expect(probeElementInSource(sourceHtml, { id: "arrows-svg" })).toBe(false);
    expect(probeElementInSource(sourceHtml, { id: "canvas" })).toBe(true);
  });
});

// T7 — data-hf-id targeting (spec for R1).
// R1 adds `hfId?: string` to SourceMutationTarget and a `[data-hf-id="…"]` branch
// in findTargetElement (sourceMutation.ts:34). Convert from it.todo in the R1 PR.
// Covers the same surface as T3 (Studio sourcePatcher) — Core sourceMutation supports
// all patch types (inline-style, attribute, text-content) via patchElementInHtml.
describe("T7 — data-hf-id targeting (spec for R1)", () => {
  it("updates inline style by data-hf-id when no HTML id attribute is present", () => {
    const source = `<h1 data-hf-id="hf-x7k2" style="color: red">Hello</h1>`;
    const { html, matched } = patchElementInHtml(source, { hfId: "hf-x7k2" }, [
      { type: "inline-style", property: "color", value: "blue" },
    ]);
    expect(matched).toBe(true);
    expect(html).toMatch(/color:\s*blue/);
    expect(html).toContain('data-hf-id="hf-x7k2"');
  });

  it("updates text content by data-hf-id", () => {
    const source = `<p data-hf-id="hf-a1b2">Old text</p>`;
    const { html, matched } = patchElementInHtml(source, { hfId: "hf-a1b2" }, [
      { type: "text-content", property: "", value: "New text" },
    ]);
    expect(matched).toBe(true);
    expect(html).toContain("New text");
  });

  it("updates attribute by data-hf-id", () => {
    const source = `<div data-hf-id="hf-c3d4" data-start="0"></div>`;
    const { html, matched } = patchElementInHtml(source, { hfId: "hf-c3d4" }, [
      { type: "attribute", property: "start", value: "2.5" },
    ]);
    expect(matched).toBe(true);
    expect(html).toContain('data-start="2.5"');
  });

  it("data-hf-id attribute survives the patch (can be targeted again)", () => {
    const source = `<h1 data-hf-id="hf-x7k2" style="color: red">Hello</h1>`;
    const { html } = patchElementInHtml(source, { hfId: "hf-x7k2" }, [
      { type: "inline-style", property: "color", value: "blue" },
    ]);
    expect(html).toContain('data-hf-id="hf-x7k2"');
  });

  it("hfId lookup falls through to selector when hfId is not found in the document", () => {
    const source = `<h1 class="headline" style="color: red">Hello</h1>`;
    const { html, matched } = patchElementInHtml(
      source,
      { hfId: "hf-missing", selector: ".headline" },
      [{ type: "inline-style", property: "color", value: "blue" }],
    );
    expect(matched).toBe(true);
    expect(html).toMatch(/color:\s*blue/);
  });

  it("does not break out of the selector on a crafted hfId (CSS injection guard)", () => {
    // A value with a quote/bracket must be escaped, not injected — it should
    // simply match nothing and leave the source untouched, never throw.
    const source = `<h1 class="safe">A</h1><h1 class="victim">B</h1>`;
    const evil = `x"] , [class="victim`;
    const run = () =>
      patchElementInHtml(source, { hfId: evil }, [
        { type: "text-content", property: "textContent", value: "HACKED" },
      ]);
    expect(run).not.toThrow();
    const { html, matched } = run();
    expect(matched).toBe(false);
    expect(html).toBe(source);
    expect(html).not.toContain("HACKED");
  });

  // The Studio edit path targets by id/selector (it never sends hfId). Once a
  // persisted data-hf-id exists in source, those edits must NOT strip it — else
  // the stable handle is destroyed by the next edit. This is the preservation
  // guarantee the write-back design depends on.
  it("preserves an existing data-hf-id when the element is patched by id", () => {
    const source = `<h1 id="hero" data-hf-id="hf-x7k2" style="color: red">Hello</h1>`;
    const { html, matched } = patchElementInHtml(source, { id: "hero" }, [
      { type: "inline-style", property: "color", value: "blue" },
    ]);
    expect(matched).toBe(true);
    expect(html).toMatch(/color:\s*blue/);
    expect(html).toContain('data-hf-id="hf-x7k2"');
  });

  it("preserves an existing data-hf-id when the element is patched by selector", () => {
    const source = `<p class="body" data-hf-id="hf-a1b2">Old</p>`;
    const { html, matched } = patchElementInHtml(source, { selector: ".body" }, [
      { type: "text-content", property: "textContent", value: "New" },
    ]);
    expect(matched).toBe(true);
    expect(html).toContain("New");
    expect(html).toContain('data-hf-id="hf-a1b2"');
  });
});
