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

  it("adds inline style to a self-closing void element without malforming it", () => {
    const html = `<img id="gif-img" class="clip" data-start="1" src="earth.gif" alt="earth" />`;
    const op: PatchOperation = { type: "inline-style", property: "z-index", value: "3" };

    const result = applyPatch(html, "gif-img", op);
    expect(result).toBe(
      `<img id="gif-img" class="clip" data-start="1" src="earth.gif" alt="earth" style="z-index: 3" />`,
    );
    expect(result).not.toContain("/ style");
  });

  it("adds inline style to a self-closing void element matched by selector", () => {
    const html = `<img class="clip hero" data-start="0" src="bg.png" alt="" />`;
    const op: PatchOperation = { type: "inline-style", property: "opacity", value: "0.5" };

    const result = applyPatchByTarget(html, { selector: ".hero" }, op);
    expect(result).toBe(
      `<img class="clip hero" data-start="0" src="bg.png" alt="" style="opacity: 0.5" />`,
    );
    expect(result).not.toContain("/ style");
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

  it("escapes JSON attribute values containing double-quotes and round-trips them", () => {
    const html = `<div id="card" data-start="0"></div>`;
    const motionJson = JSON.stringify({ preset: "fadeIn", start: 0, duration: 1.5 });

    const patched = applyPatch(html, "card", {
      type: "attribute",
      property: "data-hf-studio-motion",
      value: motionJson,
    });

    // The raw HTML must NOT contain unescaped quotes inside the attribute
    expect(patched).not.toMatch(/data-hf-studio-motion="[^"]*"[^"]*"/);
    // Entities should be present
    expect(patched).toContain("&quot;");

    // Reading the attribute back should return the original JSON
    const readBack = readAttributeByTarget(patched, { id: "card" }, "data-hf-studio-motion");
    expect(readBack).toBe(motionJson);
  });

  it("escapes and round-trips data-hf-studio-motion-original-transform with quotes", () => {
    const html = `<div id="hero" data-start="0"></div>`;
    const transform = `rotate(15deg) translate("50px", "100px")`;

    const patched = applyPatchByTarget(
      html,
      { id: "hero" },
      {
        type: "attribute",
        property: "data-hf-studio-motion-original-transform",
        value: transform,
      },
    );

    // No broken attribute boundary
    expect(patched).not.toMatch(/data-hf-studio-motion-original-transform="[^"]*"[^"]*"/);

    const readBack = readAttributeByTarget(
      patched,
      { id: "hero" },
      "data-hf-studio-motion-original-transform",
    );
    expect(readBack).toBe(transform);
  });

  it("escapes ampersands and angle brackets in attribute values", () => {
    const html = `<div id="el" data-start="0"></div>`;
    const value = `a&b<c>d"e`;

    const patched = applyPatch(html, "el", {
      type: "attribute",
      property: "data-custom",
      value,
    });

    expect(patched).toContain("a&amp;b&lt;c&gt;d&quot;e");

    const readBack = readAttributeByTarget(patched, { id: "el" }, "data-custom");
    expect(readBack).toBe(value);
  });

  it("updates an already-escaped attribute value to a new escaped value", () => {
    const html = `<div id="card" data-start="0"></div>`;
    const first = JSON.stringify({ preset: "fadeIn" });
    const second = JSON.stringify({ preset: "slideUp", easing: "ease-out" });

    const patched1 = applyPatch(html, "card", {
      type: "attribute",
      property: "data-hf-studio-motion",
      value: first,
    });
    const patched2 = applyPatch(patched1, "card", {
      type: "attribute",
      property: "data-hf-studio-motion",
      value: second,
    });

    const readBack = readAttributeByTarget(patched2, { id: "card" }, "data-hf-studio-motion");
    expect(readBack).toBe(second);
  });
});

describe("motion attribute round-trip via sourcePatcher", () => {
  it("round-trips data-hf-studio-motion JSON through patch and read", () => {
    const html = `<div id="hero" style="position: absolute">Hero</div>`;
    const motion = {
      start: 0.5,
      duration: 1,
      ease: "power3.out",
      from: { opacity: 0, y: 40 },
      to: { opacity: 1, y: 0 },
    };
    const motionJson = JSON.stringify(motion);

    const patched = applyPatchByTarget(
      html,
      { id: "hero" },
      { type: "attribute", property: "data-hf-studio-motion", value: motionJson },
    );

    const readBack = readAttributeByTarget(patched, { id: "hero" }, "data-hf-studio-motion");
    expect(readBack).toBeDefined();
    expect(JSON.parse(readBack!)).toEqual(motion);
  });

  it("round-trips motion with customEase containing SVG path data", () => {
    const html = `<div id="card" class="clip" data-start="0" data-duration="10">Card</div>`;
    const motion = {
      start: 0.25,
      duration: 0.8,
      ease: "studio-card-bounce",
      customEase: { id: "studio-card-bounce", data: "M0,0 C0.18,0.9 0.32,1 1,1" },
      from: { y: 44, autoAlpha: 0 },
      to: { y: 0, autoAlpha: 1 },
    };
    const motionJson = JSON.stringify(motion);

    const patched = applyPatchByTarget(
      html,
      { id: "card" },
      { type: "attribute", property: "data-hf-studio-motion", value: motionJson },
    );

    const readBack = readAttributeByTarget(patched, { id: "card" }, "data-hf-studio-motion");
    expect(readBack).toBeDefined();
    expect(JSON.parse(readBack!)).toEqual(motion);
  });

  it("round-trips all four motion attributes (motion + three originals)", () => {
    const html = `<div id="hero" style="transform: rotate(5deg); opacity: 0.8; visibility: visible">Hero</div>`;
    const motion = {
      start: 0,
      duration: 0.6,
      ease: "power2.out",
      from: { autoAlpha: 0, y: 32 },
      to: { autoAlpha: 1, y: 0 },
    };

    let result = html;
    result = applyPatchByTarget(
      result,
      { id: "hero" },
      { type: "attribute", property: "data-hf-studio-motion", value: JSON.stringify(motion) },
    );
    result = applyPatchByTarget(
      result,
      { id: "hero" },
      {
        type: "attribute",
        property: "data-hf-studio-motion-original-transform",
        value: "rotate(5deg)",
      },
    );
    result = applyPatchByTarget(
      result,
      { id: "hero" },
      { type: "attribute", property: "data-hf-studio-motion-original-opacity", value: "0.8" },
    );
    result = applyPatchByTarget(
      result,
      { id: "hero" },
      {
        type: "attribute",
        property: "data-hf-studio-motion-original-visibility",
        value: "visible",
      },
    );

    expect(
      JSON.parse(readAttributeByTarget(result, { id: "hero" }, "data-hf-studio-motion")!),
    ).toEqual(motion);
    expect(
      readAttributeByTarget(result, { id: "hero" }, "data-hf-studio-motion-original-transform"),
    ).toBe("rotate(5deg)");
    expect(
      readAttributeByTarget(result, { id: "hero" }, "data-hf-studio-motion-original-opacity"),
    ).toBe("0.8");
    expect(
      readAttributeByTarget(result, { id: "hero" }, "data-hf-studio-motion-original-visibility"),
    ).toBe("visible");
  });

  it("removes all four motion attributes when clearing", () => {
    const html = `<div id="hero" style="position: absolute">Hero</div>`;
    const motion = {
      start: 0,
      duration: 1,
      ease: "none",
      from: { opacity: 0 },
      to: { opacity: 1 },
    };

    let result = html;
    result = applyPatchByTarget(
      result,
      { id: "hero" },
      { type: "attribute", property: "data-hf-studio-motion", value: JSON.stringify(motion) },
    );
    result = applyPatchByTarget(
      result,
      { id: "hero" },
      { type: "attribute", property: "data-hf-studio-motion-original-transform", value: "" },
    );
    result = applyPatchByTarget(
      result,
      { id: "hero" },
      { type: "attribute", property: "data-hf-studio-motion-original-opacity", value: "1" },
    );
    result = applyPatchByTarget(
      result,
      { id: "hero" },
      { type: "attribute", property: "data-hf-studio-motion-original-visibility", value: "" },
    );

    // Verify all four attributes exist
    expect(readAttributeByTarget(result, { id: "hero" }, "data-hf-studio-motion")).toBeDefined();
    expect(
      readAttributeByTarget(result, { id: "hero" }, "data-hf-studio-motion-original-transform"),
    ).toBeDefined();
    expect(
      readAttributeByTarget(result, { id: "hero" }, "data-hf-studio-motion-original-opacity"),
    ).toBeDefined();
    expect(
      readAttributeByTarget(result, { id: "hero" }, "data-hf-studio-motion-original-visibility"),
    ).toBeDefined();

    // Remove all four
    result = applyPatchByTarget(
      result,
      { id: "hero" },
      { type: "attribute", property: "data-hf-studio-motion", value: null },
    );
    result = applyPatchByTarget(
      result,
      { id: "hero" },
      { type: "attribute", property: "data-hf-studio-motion-original-transform", value: null },
    );
    result = applyPatchByTarget(
      result,
      { id: "hero" },
      { type: "attribute", property: "data-hf-studio-motion-original-opacity", value: null },
    );
    result = applyPatchByTarget(
      result,
      { id: "hero" },
      { type: "attribute", property: "data-hf-studio-motion-original-visibility", value: null },
    );

    expect(readAttributeByTarget(result, { id: "hero" }, "data-hf-studio-motion")).toBeUndefined();
    expect(
      readAttributeByTarget(result, { id: "hero" }, "data-hf-studio-motion-original-transform"),
    ).toBeUndefined();
    expect(
      readAttributeByTarget(result, { id: "hero" }, "data-hf-studio-motion-original-opacity"),
    ).toBeUndefined();
    expect(
      readAttributeByTarget(result, { id: "hero" }, "data-hf-studio-motion-original-visibility"),
    ).toBeUndefined();
  });

  it("round-trips motion via selector when element has no id", () => {
    const html = `<div class="headline clip" style="position: absolute">Title</div>`;
    const motion = {
      start: 0.3,
      duration: 0.5,
      ease: "sine.out",
      from: { scale: 0.88, autoAlpha: 0 },
      to: { scale: 1, autoAlpha: 1 },
    };

    const patched = applyPatchByTarget(
      html,
      { selector: ".headline" },
      { type: "attribute", property: "data-hf-studio-motion", value: JSON.stringify(motion) },
    );

    const readBack = readAttributeByTarget(
      patched,
      { selector: ".headline" },
      "data-hf-studio-motion",
    );
    expect(readBack).toBeDefined();
    expect(JSON.parse(readBack!)).toEqual(motion);
  });
});
