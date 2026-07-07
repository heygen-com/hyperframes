import { describe, expect, it } from "vitest";
import { readCompositionFps } from "./compositionFps.js";

const wrap = (body: string) => `<!DOCTYPE html><html><body>${body}</body></html>`;

describe("readCompositionFps", () => {
  it("reads data-fps from the explicit data-root composition element", () => {
    const html = wrap('<div data-composition-id="root" data-root="true" data-fps="24">x</div>');
    expect(readCompositionFps(html)).toBe("24");
  });

  it("reads data-fps from the outermost composition when no data-root is marked", () => {
    const html = wrap(
      '<div data-composition-id="root" data-fps="48"><div data-composition-id="child" data-fps="12">x</div></div>',
    );
    expect(readCompositionFps(html)).toBe("48");
  });

  it("preserves a fractional rate verbatim for parseFps to validate", () => {
    const html = wrap(
      '<div data-composition-id="root" data-root="true" data-fps="30000/1001">x</div>',
    );
    expect(readCompositionFps(html)).toBe("30000/1001");
  });

  it("returns null when the root has no data-fps", () => {
    expect(readCompositionFps(wrap('<div data-composition-id="root">x</div>'))).toBeNull();
  });

  it("returns null when there is no composition root", () => {
    expect(readCompositionFps(wrap("<div>plain</div>"))).toBeNull();
  });

  it("returns null for a blank data-fps", () => {
    expect(
      readCompositionFps(wrap('<div data-composition-id="root" data-fps="  ">x</div>')),
    ).toBeNull();
  });
});
