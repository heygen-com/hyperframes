import { describe, expect, it } from "vitest";
import { orientation, durationFromHtml } from "./info.js";

describe("orientation", () => {
  it("is landscape when width > height", () => {
    expect(orientation(1920, 1080)).toBe("landscape");
  });

  it("is portrait when height > width", () => {
    expect(orientation(1080, 1920)).toBe("portrait");
  });

  it("is square when width === height", () => {
    expect(orientation(1080, 1080)).toBe("square");
  });
});

describe("durationFromHtml", () => {
  it("reads data-duration from the root composition element", () => {
    const html = `<div data-composition-id="comp" data-width="1920" data-height="1080" data-start="0" data-duration="6"></div>`;
    expect(durationFromHtml(html, 5)).toBe(6);
  });

  it("reads data-duration regardless of attribute order", () => {
    const html = `<div data-duration="8" data-composition-id="comp"></div>`;
    expect(durationFromHtml(html, 5)).toBe(8);
  });

  it("falls back to the computed timeline duration when no data-duration", () => {
    const html = `<div data-composition-id="comp"></div>`;
    expect(durationFromHtml(html, 5)).toBe(5);
  });
});
