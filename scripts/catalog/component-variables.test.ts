import { describe, expect, it } from "vitest";

import { layerVariablesOntoDemo, snippetOwnsItsMotion } from "./component-variables.ts";

const DECLARATION = `[{ "id": "size", "type": "number", "label": "Size", "default": 52 }]`;

const snippet = `
<div data-hf-ui-root class="hf-ui-demo" data-composition-variables='${DECLARATION}'>
  <span>word</span>
</div>
<style>.hf-ui-demo { font-size: var(--hf-demo-size, 52px); }</style>
<script>
  var vars = window.__hyperframes ? window.__hyperframes.getVariables() : {};
  document.querySelector("[data-hf-ui-root]").style.setProperty("--hf-demo-size", (vars.size || 52) + "px");
</script>
`;

const demo = `<!doctype html>
<html><head><style>.hf-ui-demo { font-size: 52px; }</style></head>
<body>
  <main data-composition-id="demo">
    <div data-hf-ui-root class="hf-ui-demo"><span>word</span></div>
  </main>
  <script>window.__timelines = { demo: gsap.timeline({ paused: true }) };</script>
</body></html>`;

describe("layerVariablesOntoDemo", () => {
  it("gives the demo the declaration, the reader and the var-driven CSS", () => {
    const result = layerVariablesOntoDemo(demo, snippet);
    expect(result.applied).toBe(true);
    expect(result.html).toContain("data-composition-variables=");
    expect(result.html).toContain("getVariables");
    expect(result.html).toContain("var(--hf-demo-size");
  });

  it("keeps the demo's own markup and timeline, which is what animates it", () => {
    const { html } = layerVariablesOntoDemo(demo, snippet);
    expect(html).toContain('data-composition-id="demo"');
    expect(html).toContain("__timelines");
    expect(html).toContain("<span>word</span>");
  });

  it("appends the snippet's CSS after the demo's, so var() wins on order", () => {
    const { html } = layerVariablesOntoDemo(demo, snippet);
    // The demo hardcodes the same property the snippet parameterises. Whichever
    // rule comes last is the one that renders, so the appended one has to.
    expect(html.indexOf("var(--hf-demo-size")).toBeGreaterThan(html.indexOf("font-size: 52px"));
  });

  it("declines when the snippet declares nothing, rather than half-applying", () => {
    const result = layerVariablesOntoDemo(demo, "<div data-hf-ui-root></div>");
    expect(result.applied).toBe(false);
    expect(result).toHaveProperty("reason", "snippet declares no variables");
    expect(result.html).toBe(demo);
  });

  it("declines when the demo has no component root to attach to", () => {
    const result = layerVariablesOntoDemo("<html><body>nothing</body></html>", snippet);
    expect(result.applied).toBe(false);
    expect(result).toHaveProperty("reason", "demo has nowhere to hang the declaration");
  });

  it("leaves a demo that already declares its variables alone", () => {
    const already = demo.replace(
      '<div data-hf-ui-root class="hf-ui-demo">',
      `<div data-hf-ui-root class="hf-ui-demo" data-composition-variables='${DECLARATION}'>`,
    );
    const result = layerVariablesOntoDemo(already, snippet);
    expect(result.applied).toBe(false);
    expect(result).toHaveProperty("reason", "demo already declares its variables");
  });

  it("does not copy a src script, which would re-run a shared library", () => {
    const withSrc = snippet.replace(
      "<style>",
      '<script src="https://cdn.example.com/gsap.min.js"></script>\n<style>',
    );
    const { html } = layerVariablesOntoDemo(demo, withSrc);
    expect(html).not.toContain("cdn.example.com");
  });

  it("handles a self-closing root without eating its bracket", () => {
    const selfClosing = demo.replace(
      '<div data-hf-ui-root class="hf-ui-demo"><span>word</span></div>',
      '<img data-hf-ui-root class="hf-ui-demo" src="a.png" />',
    );
    const { html } = layerVariablesOntoDemo(selfClosing, snippet);
    expect(html).toContain("data-composition-variables=");
    expect(html).toContain("/>");
    expect(html).not.toContain("/>>");
  });
});

describe("snippetOwnsItsMotion", () => {
  it("recognises a snippet that registers its own paused timeline", () => {
    const selfContained = `
      <div class="x" data-composition-variables='[]'></div>
      <script>
        var tl = gsap.timeline({ paused: true });
        window.__timelines = window.__timelines || {};
        window.__timelines["x"] = tl;
      </script>`;
    expect(snippetOwnsItsMotion(selfContained)).toBe(true);
  });

  it("does not count a timeline that is only shown as a recipe", () => {
    // Every recipe-only snippet carries its integration note as a comment, so
    // matching on the text alone would call all 168 self-contained and build
    // the 45 recipe-only ones from a snippet that never animates.
    const recipeOnly = `
      <!--
        Timeline integration:
          window.__timelines["x"] = gsap.timeline({ paused: true });
      -->
      <div class="x" data-composition-variables='[]'></div>
      <script>var vars = window.__hyperframes.getVariables();</script>`;
    expect(snippetOwnsItsMotion(recipeOnly)).toBe(false);
  });

  it("ignores a block comment recipe too", () => {
    const recipeOnly = `
      <script>
        /* window.__timelines["x"] = gsap.timeline({ paused: true }); */
        var vars = window.__hyperframes.getVariables();
      </script>`;
    expect(snippetOwnsItsMotion(recipeOnly)).toBe(false);
  });
});
