import { describe, expect, it } from "vitest";
import { removeElementFromHtml, patchElementInHtml } from "./sourceMutation.js";

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
    const result = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "inline-style", property: "color", value: "red" },
    ]);

    expect(result).toMatch(/color:\s*red/);
    expect(result).toContain('id="hero"');
  });

  it("patches inline style by class selector", () => {
    const result = patchElementInHtml(FIXTURE, { selector: ".hero-heading" }, [
      { type: "inline-style", property: "font-size", value: "72px" },
    ]);

    expect(result).toMatch(/font-size:\s*72px/);
  });

  it("patches data attribute", () => {
    const result = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "attribute", property: "hf-studio-path-offset", value: "true" },
    ]);

    expect(result).toContain('data-hf-studio-path-offset="true"');
  });

  it("patches html attribute", () => {
    const result = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "title", value: "greeting" },
    ]);

    expect(result).toContain('title="greeting"');
  });

  it("patches text content", () => {
    const result = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "text-content", property: "", value: "New Title" },
    ]);

    expect(result).toContain("New Title");
    expect(result).not.toContain("Hello World");
  });

  it("applies multiple operations in one call", () => {
    const result = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "inline-style", property: "color", value: "blue" },
      { type: "inline-style", property: "font-size", value: "96px" },
      { type: "attribute", property: "hf-studio-path-offset", value: "true" },
    ]);

    expect(result).toMatch(/color:\s*blue/);
    expect(result).toMatch(/font-size:\s*96px/);
    expect(result).toContain('data-hf-studio-path-offset="true"');
  });

  it("finds element by composition-id selector", () => {
    const result = patchElementInHtml(FIXTURE, { selector: '[data-composition-id="overlay"]' }, [
      { type: "inline-style", property: "opacity", value: "0.5" },
    ]);

    expect(result).toMatch(/opacity:\s*0\.5/);
  });

  it("finds element by class with selectorIndex", () => {
    const html = `<div class="item">A</div><div class="item">B</div>`;
    const result = patchElementInHtml(html, { selector: ".item", selectorIndex: 1 }, [
      { type: "text-content", property: "", value: "Changed" },
    ]);

    expect(result).toContain("A");
    expect(result).toContain("Changed");
    expect(result).not.toContain(">B<");
  });

  it("returns unchanged html when target not found", () => {
    const result = patchElementInHtml(FIXTURE, { id: "nonexistent" }, [
      { type: "inline-style", property: "color", value: "red" },
    ]);

    expect(result).toBe(FIXTURE);
  });

  it("removes inline style when value is null", () => {
    const result = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "inline-style", property: "font-size", value: null },
    ]);

    expect(result).not.toContain("font-size");
  });

  it("removes attribute when value is null", () => {
    const result = patchElementInHtml(FIXTURE, { selector: '[data-composition-id="overlay"]' }, [
      { type: "html-attribute", property: "data-composition-src", value: null },
    ]);

    expect(result).not.toContain("data-composition-src");
  });

  it("patches fragment html without doctype", () => {
    const fragment = `<div id="card" style="padding: 8px"><span>Title</span></div>`;
    const result = patchElementInHtml(fragment, { id: "card" }, [
      { type: "inline-style", property: "padding", value: "16px" },
    ]);

    expect(result).toMatch(/padding:\s*16px/);
  });

  it("rejects event handler attributes", () => {
    const result = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "onload", value: "fetch('/evil')" },
    ]);

    expect(result).not.toContain("onload");
    expect(result).not.toContain("fetch");
  });

  it("rejects javascript: URLs in src", () => {
    const result = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "src", value: "javascript:alert(1)" },
    ]);

    expect(result).not.toContain("javascript:");
  });

  it("allows aria-* and data-* attributes", () => {
    const result = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "aria-label", value: "greeting" },
      { type: "html-attribute", property: "data-custom", value: "test" },
    ]);

    expect(result).toContain('aria-label="greeting"');
    expect(result).toContain('data-custom="test"');
  });

  it("rejects srcdoc and formaction attributes", () => {
    const result = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "srcdoc", value: "<script>alert(1)</script>" },
      { type: "html-attribute", property: "formaction", value: "javascript:void(0)" },
    ]);

    expect(result).not.toContain("srcdoc");
    expect(result).not.toContain("formaction");
  });

  it("rejects on* event handlers regardless of casing", () => {
    const result = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "onClick", value: "alert(1)" },
      { type: "html-attribute", property: "ONERROR", value: "alert(2)" },
      { type: "html-attribute", property: "onmouseover", value: "alert(3)" },
    ]);

    expect(result).not.toContain("alert");
  });

  it("rejects data:text/html URIs in src", () => {
    const result = patchElementInHtml(FIXTURE, { id: "hero" }, [
      {
        type: "html-attribute",
        property: "src",
        value: "data:text/html,<script>alert(1)</script>",
      },
    ]);

    expect(result).not.toContain("data:text/html");
  });

  it("allows safe href values", () => {
    const result = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "href", value: "https://example.com" },
    ]);

    expect(result).toContain('href="https://example.com"');
  });

  it("rejects javascript: in href", () => {
    const result = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "href", value: "javascript:alert(1)" },
    ]);

    expect(result).not.toContain("javascript:");
  });

  it("allows legitimate form and media attributes", () => {
    const result = patchElementInHtml(FIXTURE, { id: "hero" }, [
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
    const result = patchElementInHtml(FIXTURE, { id: "hero" }, [
      { type: "html-attribute", property: "xmlns", value: "http://evil.com" },
      { type: "html-attribute", property: "background", value: "http://evil.com/bg.js" },
      { type: "html-attribute", property: "dynsrc", value: "http://evil.com/vid.avi" },
    ]);

    expect(result).not.toContain("xmlns");
    expect(result).not.toContain("background=");
    expect(result).not.toContain("dynsrc");
  });
});
