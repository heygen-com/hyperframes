import { describe, expect, it } from "vitest";
import {
  COMPOSITION_ATTRIBUTES,
  parseStartExpression,
  readClipTiming,
  writeClipTiming,
} from "./compositionContract";

class Attributes {
  readonly values = new Map<string, string>();

  constructor(values: Record<string, string>) {
    for (const [name, value] of Object.entries(values)) this.values.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.values.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.values.set(name, value);
  }

  removeAttribute(name: string): void {
    this.values.delete(name);
  }
}

describe("composition timing contract", () => {
  it.each([
    ["1.25", { kind: "absolute", value: 1.25 }],
    ["intro", { kind: "reference", refId: "intro", offset: 0 }],
    ["intro + 2", { kind: "reference", refId: "intro", offset: 2 }],
    ["intro+2", { kind: "reference", refId: "intro", offset: 2 }],
    ["intro - .5", { kind: "reference", refId: "intro", offset: -0.5 }],
    ["intro- 2", { kind: "reference", refId: "intro", offset: -2 }],
    ["intro-2", { kind: "reference", refId: "intro-2", offset: 0 }],
    ["intro + nope", null],
    ["Infinity", { kind: "reference", refId: "Infinity", offset: 0 }],
  ])("parses start expression %s", (raw, expected) => {
    expect(parseStartExpression(raw)).toEqual(expected);
  });

  it("rejects adversarial start input without regex backtracking", () => {
    expect(parseStartExpression(`-+${"0".repeat(100_000)}x`)).toBeNull();
  });

  it("matches runtime clamping for negative absolute and reference starts", () => {
    expect(readClipTiming(new Attributes({ "data-start": "-2", "data-duration": "1" })).start).toBe(
      0,
    );
    expect(
      readClipTiming(new Attributes({ "data-start": "intro - 5", "data-duration": "1" }), {
        resolveReferenceEnd: () => 2,
      }).start,
    ).toBe(0);
  });

  it.each([
    {
      name: "canonical fractional timing",
      attrs: { "data-start": "1.25", "data-duration": "2.5", "data-track-index": "3" },
      expected: { start: 1.25, duration: 2.5, end: 3.75, trackIndex: 3 },
      codes: [],
    },
    {
      name: "resolved reference",
      attrs: { "data-start": "intro - .5", "data-duration": "2" },
      expected: { start: 3.5, duration: 2, end: 5.5, trackIndex: 0 },
      codes: [],
      resolve: (id: string) => (id === "intro" ? 4 : null),
    },
    {
      name: "legacy attributes",
      attrs: { "data-start": "1", "data-end": "4", "data-layer": "2" },
      expected: { start: 1, duration: 3, end: 4, trackIndex: 2 },
      codes: ["deprecated-end", "deprecated-layer"],
    },
    {
      name: "canonical values win over conflicting legacy values",
      attrs: {
        "data-start": "1",
        "data-duration": "2",
        "data-end": "9",
        "data-track-index": "1",
        "data-layer": "4",
      },
      expected: { start: 1, duration: 2, end: 3, trackIndex: 1 },
      codes: ["deprecated-end", "conflicting-end", "deprecated-layer", "conflicting-layer"],
    },
    {
      name: "invalid values are diagnosed rather than coerced",
      attrs: { "data-start": "wat +", "data-duration": "-1", "data-track-index": "1.5" },
      expected: { start: null, duration: null, end: null, trackIndex: 0 },
      codes: ["invalid-start", "invalid-duration", "invalid-track-index"],
    },
  ])("reads $name", ({ attrs, expected, codes, resolve }) => {
    const result = readClipTiming(new Attributes(attrs), { resolveReferenceEnd: resolve });
    expect(result).toMatchObject(expected);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(codes);
  });

  it("canonicalizes legacy timing during a mutation and round-trips semantics", () => {
    const attrs = new Attributes({
      "data-start": "1",
      "data-end": "4",
      "data-layer": "2",
    });

    const written = writeClipTiming(attrs, { start: 2, duration: 4, trackIndex: 5 });

    expect(written).toMatchObject({ start: 2, duration: 4, end: 6, trackIndex: 5 });
    expect(attrs.values).toEqual(
      new Map([
        [COMPOSITION_ATTRIBUTES.start, "2"],
        [COMPOSITION_ATTRIBUTES.duration, "4"],
        [COMPOSITION_ATTRIBUTES.trackIndex, "5"],
      ]),
    );
  });

  it("preserves a reference expression when writing canonical duration/track fields", () => {
    const attrs = new Attributes({
      "data-start": "intro + 1",
      "data-end": "8",
      "data-layer": "2",
    });

    writeClipTiming(attrs, { duration: 3, trackIndex: 4 });

    expect(attrs.getAttribute("data-start")).toBe("intro + 1");
    expect(attrs.getAttribute("data-duration")).toBe("3");
    expect(attrs.getAttribute("data-track-index")).toBe("4");
    expect(attrs.getAttribute("data-end")).toBeNull();
    expect(attrs.getAttribute("data-layer")).toBeNull();
  });

  it("preserves a legacy end when a track-only edit cannot resolve reference duration", () => {
    const attrs = new Attributes({
      "data-start": "intro + 1",
      "data-end": "8",
      "data-layer": "2",
    });

    writeClipTiming(attrs, { trackIndex: 4 });

    expect(attrs.getAttribute("data-start")).toBe("intro + 1");
    expect(attrs.getAttribute("data-duration")).toBeNull();
    expect(attrs.getAttribute("data-end")).toBe("8");
    expect(attrs.getAttribute("data-track-index")).toBe("4");
    expect(attrs.getAttribute("data-layer")).toBeNull();
  });
});
