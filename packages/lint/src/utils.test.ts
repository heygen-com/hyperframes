import { describe, expect, it } from "vitest";

import { readAttr, readDecodedAttr } from "./utils.js";

describe("readAttr", () => {
  it("reads a double-quoted value", () => {
    expect(readAttr('<div data-start="2.5">', "data-start")).toBe("2.5");
  });

  it("reads a single-quoted value", () => {
    expect(readAttr("<div data-start='2.5'>", "data-start")).toBe("2.5");
  });

  // Unquoted values are valid HTML5 and the runtime reads them, so a
  // quoted-only pattern both invents "missing attribute" errors and hides
  // real violations on the attributes it cannot see.
  it("reads an unquoted value", () => {
    expect(readAttr("<div data-start=0>", "data-start")).toBe("0");
  });

  it("reads unquoted values from a tag that mixes quoting styles", () => {
    const tag = `<div id="root" data-composition-id=main data-start=0 data-width=1920 data-height='1080'>`;
    expect(readAttr(tag, "data-composition-id")).toBe("main");
    expect(readAttr(tag, "data-start")).toBe("0");
    expect(readAttr(tag, "data-width")).toBe("1920");
    expect(readAttr(tag, "data-height")).toBe("1080");
  });

  it("agrees with the parser-backed reader across quoting styles and near-misses", () => {
    const cases: Array<[string, string]> = [
      ["<div data-track-index=2 data-duration=6>", "data-track-index"],
      ["<div data-track-index=2 data-duration=6>", "data-duration"],
      ['<div data-hf-src="x?id=5" id="root">', "id"],
      ['<img src="x.png?class=big" class="clip">', "class"],
      ["<div data-composition-src=scenes/a.html>", "data-composition-src"],
    ];
    for (const [tag, attr] of cases) {
      expect(readAttr(tag, attr)).toBe(readDecodedAttr(tag, attr) || null);
    }
  });

  it("reads unquoted values that sit next to other attributes", () => {
    expect(readAttr("<div data-start=0 class=clip>", "class")).toBe("clip");
    expect(readAttr("<div data-composition-src=scenes/a.html>", "data-composition-src")).toBe(
      "scenes/a.html",
    );
  });

  // A `name=value` pair inside another attribute's value is not an attribute.
  // Reading it as one made `duplicate_media_id` fire on ids that do not exist
  // and hid `media_missing_id` on a video that really had none.
  it("does not read a name=value pair out of another attribute's value", () => {
    expect(readAttr('<img src="https://cdn.x/i?id=123" class="clip">', "id")).toBeNull();
    expect(readAttr('<img src="x.png?class=big" class="clip">', "class")).toBe("clip");
    expect(readAttr('<div data-hf-src="clip.mp4?id=5" id="root">', "id")).toBe("root");
    expect(readAttr('<video src="v.mp4?preload=none">', "preload")).toBeNull();
    expect(readAttr('<div title="use id=hero">', "id")).toBeNull();
  });

  // The `(?<![\w-])` lookbehind, not `\b`: a hyphen would otherwise read as a
  // word break and match the tail of a longer attribute name.
  it("does not match the tail of a longer attribute name", () => {
    expect(readAttr('<div data-hf-id="x">', "id")).toBeNull();
    expect(readAttr("<div data-width=1920>", "width")).toBeNull();
  });

  it("returns null for an absent or valueless attribute", () => {
    expect(readAttr("<video muted>", "muted")).toBeNull();
    expect(readAttr("<div>", "data-start")).toBeNull();
    expect(readAttr("", "data-start")).toBeNull();
  });

  it("treats an empty quoted value as absent, as before", () => {
    expect(readAttr('<div data-start="">', "data-start")).toBeNull();
  });
});
