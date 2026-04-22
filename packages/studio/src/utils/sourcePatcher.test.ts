import { describe, expect, it } from "vitest";
import { applyPatchByTarget, readAttributeByTarget, type PatchOperation } from "./sourcePatcher";

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
