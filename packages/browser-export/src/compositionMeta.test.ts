import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { findCompositionRoot, readCompositionMeta } from "./compositionMeta.js";

function doc(html: string): Document {
  return parseHTML(`<html><body>${html}</body></html>`).document as unknown as Document;
}

describe("findCompositionRoot", () => {
  it("finds the element carrying data-composition-id", () => {
    const document = doc(`<div id="root"><div data-composition-id="main"></div></div>`);
    expect(findCompositionRoot(document)?.getAttribute("data-composition-id")).toBe("main");
  });

  it("returns the scope itself when it is the composition root", () => {
    const document = doc(`<div data-composition-id="self"></div>`);
    const root = document.querySelector("[data-composition-id]") as Element;
    expect(findCompositionRoot(root)).toBe(root);
  });

  it("falls back to #root when no data-composition-id exists", () => {
    const document = doc(`<div id="root"></div>`);
    expect(findCompositionRoot(document)?.getAttribute("id")).toBe("root");
  });

  it("returns null when nothing matches", () => {
    expect(findCompositionRoot(doc(`<div></div>`))).toBeNull();
  });
});

describe("readCompositionMeta", () => {
  it("reads id, width and height", () => {
    const document = doc(
      `<div data-composition-id="promo" data-width="1080" data-height="1920"></div>`,
    );
    const root = document.querySelector("[data-composition-id]") as Element;
    expect(readCompositionMeta(root)).toEqual({
      id: "promo",
      width: 1080,
      height: 1920,
    });
  });

  it("defaults to 1920x1080 on missing or invalid dimensions", () => {
    const document = doc(
      `<div data-composition-id="promo" data-width="abc" data-height="-4"></div>`,
    );
    const root = document.querySelector("[data-composition-id]") as Element;
    const meta = readCompositionMeta(root);
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1080);
  });
});
