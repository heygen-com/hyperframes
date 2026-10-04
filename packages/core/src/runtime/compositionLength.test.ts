import { describe, expect, it, vi } from "vitest";
import { parseHTMLContent } from "../compiler/htmlDocument";
import {
  findRootCompositionElement,
  MIN_VALID_TIMELINE_DURATION_SECONDS,
  readStaticCompositionMeta,
  resolveCompositionLengthSeconds,
} from "./compositionLength";

describe("resolveCompositionLengthSeconds", () => {
  const base = {
    declared: null,
    timeline: () => null,
    floors: () => [],
    fallback: 0,
    derived: () => 0,
  };

  it("takes a declared length and reads nothing else", () => {
    const timeline = vi.fn(() => 10);
    const derived = vi.fn(() => 7);
    expect(resolveCompositionLengthSeconds({ ...base, declared: 4, timeline, derived })).toBe(4);
    expect(timeline).not.toHaveBeenCalled();
    expect(derived).not.toHaveBeenCalled();
  });

  it("takes the longest of timeline, floors and fallback", () => {
    expect(
      resolveCompositionLengthSeconds({
        ...base,
        timeline: () => 6,
        floors: () => [8, null],
        fallback: 5,
      }),
    ).toBe(8);
  });

  it("ignores a timeline of one frame or less", () => {
    const oneFrame = MIN_VALID_TIMELINE_DURATION_SECONDS;
    expect(
      resolveCompositionLengthSeconds({ ...base, timeline: () => oneFrame, derived: () => 2 }),
    ).toBe(2);
  });

  it("derives the length only when nothing else gives one", () => {
    expect(resolveCompositionLengthSeconds({ ...base, derived: () => 2.5 })).toBe(2.5);
    expect(resolveCompositionLengthSeconds({ ...base, fallback: 9, derived: () => 2.5 })).toBe(9);
  });
});

// Server-side callers parse with linkedom, browsers with DOMParser: both must agree.
const parsers: Array<[string, (html: string) => Document]> = [
  ["linkedom", (html) => parseHTMLContent(html)],
  ["DOMParser", (html) => new DOMParser().parseFromString(html, "text/html")],
];

describe.each(parsers)("readStaticCompositionMeta (%s)", (_name, parse) => {
  const meta = (html: string) => readStaticCompositionMeta(parse(html));

  it("reads the data-root composition's declared length and size", () => {
    const html =
      `<div data-composition-id="card" data-width="800" data-height="600" data-duration="9"></div>` +
      `<div data-composition-id="main" data-root="true" data-width="1080" data-height="1920" data-duration="4"></div>`;
    expect(meta(html)).toEqual({ width: 1080, height: 1920, fps: 30, durationSeconds: 4 });
  });

  it("extends to a nested video's authored end at its absolute start", () => {
    const html =
      `<div data-composition-id="main"><div data-composition-id="scene" data-start="3">` +
      `<video data-start="1" data-duration="4"></video></div></div>`;
    expect(meta(html)?.durationSeconds).toBe(8);
  });

  it("extends to a sub-composition's declared end", () => {
    const html = `<div data-composition-id="main"><div data-composition-id="scene" data-start="1" data-duration="5"></div></div>`;
    expect(meta(html)?.durationSeconds).toBe(6);
  });

  it("derives the length from the clips, and is 0 while one is pending", () => {
    expect(
      meta(`<div data-composition-id="main"><div data-start="1" data-duration="3"></div></div>`)
        ?.durationSeconds,
    ).toBe(4);
    const pending = `<div data-composition-id="main"><div data-start="0" data-duration="3"></div><video data-start="0"></video></div>`;
    expect(meta(pending)?.durationSeconds).toBe(0);
  });

  it("is null without a composition", () => {
    expect(meta("<div></div>")).toBeNull();
  });
});

describe("findRootCompositionElement", () => {
  it("reads the document it is given, not the global one", () => {
    const doc = parseHTMLContent(
      `<div data-composition-id="a"></div><div data-composition-id="b" data-root="true"></div>`,
    );
    expect(findRootCompositionElement(doc)?.getAttribute("data-composition-id")).toBe("b");
  });
});
