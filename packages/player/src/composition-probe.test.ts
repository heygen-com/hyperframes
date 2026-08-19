import { describe, expect, it } from "vitest";
import { readCompositionSizeFromDocument, runtimeCdnUrlForVersion } from "./composition-probe.js";

describe("readCompositionSizeFromDocument", () => {
  it("reads dimensions from the composition root", () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML =
      '<div data-composition-id="main" data-width="1080" data-height="1920"></div>';

    expect(readCompositionSizeFromDocument(doc)).toEqual({ width: 1080, height: 1920 });
  });

  it("falls back to plain data-width/data-height compositions", () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<div class="clip" data-width="1080" data-height="1920"></div>';

    expect(readCompositionSizeFromDocument(doc)).toEqual({ width: 1080, height: 1920 });
  });

  it("ignores invalid dimensions", () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<div data-width="0" data-height="1920"></div>';

    expect(readCompositionSizeFromDocument(doc)).toBeNull();
  });
});

describe("runtimeCdnUrlForVersion", () => {
  it("pins the injected core runtime to the Player-compatible version", () => {
    expect(runtimeCdnUrlForVersion("1.2.3")).toBe(
      "https://cdn.jsdelivr.net/npm/@hyperframes/core@1.2.3/dist/hyperframe.runtime.iife.js",
    );
  });

  it("rejects values that could create an unversioned or malformed URL", () => {
    expect(() => runtimeCdnUrlForVersion("latest")).toThrow("Invalid HyperFrames runtime version");
  });
});
