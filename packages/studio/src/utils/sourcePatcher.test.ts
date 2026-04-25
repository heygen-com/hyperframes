import { describe, expect, it } from "vitest";
import {
  applyPatch,
  applyPatchByTarget,
  readAttributeByTarget,
  readTagSnippetByTarget,
  type PatchOperation,
} from "./sourcePatcher";

describe("applyPatchByTarget", () => {
  it("updates a composition host by data-composition-id selector", () => {
    const html = `<div data-composition-id="intro" data-start="0" data-track-index="1"></div>`;
    const op: PatchOperation = { type: "attribute", property: "start", value: "2.5" };

    expect(applyPatchByTarget(html, { selector: '[data-composition-id="intro"]' }, op)).toContain(
      'data-start="2.5"',
    );
  });

  it("updates a class-based layer when the clip has no DOM id", () => {
    const html = `<div class="headline clip" data-start="0" data-track-index="1"></div>`;
    const op: PatchOperation = { type: "attribute", property: "track-index", value: "3" };

    expect(applyPatchByTarget(html, { selector: ".headline" }, op)).toContain(
      'data-track-index="3"',
    );
  });

  it("updates inline z-index by selector when the clip has no DOM id", () => {
    const html = `<div class="headline clip" style="position: absolute; opacity: 1" data-start="0"></div>`;
    const op: PatchOperation = { type: "inline-style", property: "z-index", value: "3" };

    expect(applyPatchByTarget(html, { selector: ".headline" }, op)).toContain(
      'style="position: absolute; opacity: 1; z-index: 3"',
    );
  });

  it("patches inline move styles by target", () => {
    const html = `<div id="card" style="position: absolute; left: 108px; top: 112px"></div>`;

    const withLeft = applyPatchByTarget(
      html,
      { id: "card" },
      { type: "inline-style", property: "left", value: "160px" },
    );
    const withTop = applyPatchByTarget(
      withLeft,
      { id: "card" },
      { type: "inline-style", property: "top", value: "140px" },
    );

    expect(withTop).toContain('style="position: absolute; left: 160px; top: 140px"');
  });

  it("patches inline resize styles by target", () => {
    const html = `<div id="card" style="position: absolute; width: 380px; height: 196px"></div>`;

    const withWidth = applyPatchByTarget(
      html,
      { id: "card" },
      { type: "inline-style", property: "width", value: "420px" },
    );
    const withHeight = applyPatchByTarget(
      withWidth,
      { id: "card" },
      { type: "inline-style", property: "height", value: "220px" },
    );

    expect(withHeight).toContain('style="position: absolute; width: 420px; height: 220px"');
  });

  it("escapes quoted CSS urls inside double-quoted style attributes", () => {
    const html = `<div id="card" style="position: absolute; opacity: 1"></div>`;

    const withBackground = applyPatchByTarget(
      html,
      { id: "card" },
      {
        type: "inline-style",
        property: "background-image",
        value: `url("../ChatGPT Image Apr 22, 2026.png")`,
      },
    );
    const withRadius = applyPatchByTarget(
      withBackground,
      { id: "card" },
      { type: "inline-style", property: "border-radius", value: "12px" },
    );

    expect(withRadius).toContain(
      "background-image: url(&quot;../ChatGPT Image Apr 22, 2026.png&quot;)",
    );
    expect(withRadius).toContain("border-radius: 12px");
  });

  it("updates media timing attributes by selector", () => {
    const html = `<video class="hero clip" data-start="0.2" data-duration="1.4" data-media-start="0.4"></video>`;

    const withDuration = applyPatchByTarget(
      html,
      { selector: ".hero" },
      {
        type: "attribute",
        property: "duration",
        value: "1.1",
      },
    );
    const withMediaStart = applyPatchByTarget(
      withDuration,
      { selector: ".hero" },
      {
        type: "attribute",
        property: "media-start",
        value: "0.7",
      },
    );

    expect(withMediaStart).toContain('data-duration="1.1"');
    expect(withMediaStart).toContain('data-media-start="0.7"');
  });

  it("reads media timing attributes by selector", () => {
    const html = `<div class="hero clip" data-start="0.2" data-duration="1.4" data-media-start="0.4"></div>`;

    expect(readAttributeByTarget(html, { selector: ".hero" }, "media-start")).toBe("0.4");
    expect(readAttributeByTarget(html, { selector: ".hero" }, "duration")).toBe("1.4");
  });

  it("reads the matched tag snippet by target", () => {
    const html = `<section id="hero" class="card clip" style="left: 120px; top: 180px"></section>`;

    expect(readTagSnippetByTarget(html, { id: "hero" })).toBe(
      `<section id="hero" class="card clip" style="left: 120px; top: 180px"`,
    );
  });

  it("patches and reads single-quoted attributes and styles", () => {
    const html =
      "<section id='hero' class='card clip' data-start='0.2' style='left: 120px; top: 180px'></section>";

    const moved = applyPatchByTarget(
      html,
      { id: "hero" },
      { type: "inline-style", property: "left", value: "160px" },
    );
    const updated = applyPatchByTarget(
      moved,
      { id: "hero" },
      { type: "attribute", property: "start", value: "0.4" },
    );

    expect(updated).toContain(`style='left: 160px; top: 180px'`);
    expect(updated).toContain(`data-start="0.4"`);
    expect(readAttributeByTarget(updated, { id: "hero" }, "start")).toBe("0.4");
  });

  it("replaces the full text body of a nested element by id", () => {
    const html =
      '<div id="panel"><strong>Headline</strong><span>Supporting copy</span></div><p>Outside</p>';

    const patched = applyPatch(html, "panel", {
      type: "text-content",
      property: "text",
      value: "<strong>New headline</strong><span>New supporting copy</span>",
    });

    expect(patched).toContain(
      '<div id="panel"><strong>New headline</strong><span>New supporting copy</span></div>',
    );
    expect(patched).toContain("<p>Outside</p>");
  });

  it("does not stop at the first child closing tag when patching nested text", () => {
    const html =
      '<section id="card"><div><strong>Headline</strong></div><div>Copy</div></section><p>Outside</p>';

    const patched = applyPatchByTarget(
      html,
      { id: "card" },
      {
        type: "text-content",
        property: "text",
        value: "<strong>New headline</strong>",
      },
    );

    expect(patched).toBe(
      '<section id="card"><strong>New headline</strong></section><p>Outside</p>',
    );
  });

  it("patches the correct duplicate selector occurrence", () => {
    const html = [
      `<div class="headline clip" data-start="0"></div>`,
      `<div class="headline clip" data-start="1"></div>`,
    ].join("");

    const patched = applyPatchByTarget(
      html,
      { selector: ".headline", selectorIndex: 1 },
      {
        type: "attribute",
        property: "start",
        value: "2.5",
      },
    );

    expect(patched).toContain(`<div class="headline clip" data-start="0"></div>`);
    expect(patched).toContain(`<div class="headline clip" data-start="2.5"></div>`);
  });
});
