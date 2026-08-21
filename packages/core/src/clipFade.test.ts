import { describe, expect, it } from "vitest";
import {
  clipFadeFilter,
  clipFadeLevelAt,
  hasClipFadeAttributes,
  opacityLane,
  parseClipFade,
} from "./clipFade";
import { serializeAutomation, type HfAutomationPoint } from "./audioAutomation";

const attrs = (record: Record<string, string>) => (name: string) => record[name] ?? null;

/** A clip whose picture ramps up over `seconds`, as authored markup would. */
const fadeIn = (seconds: number, curve?: number): string =>
  serializeAutomation({
    version: 1,
    lanes: [
      {
        target: "opacity",
        points: [
          { t: 0, v: 0, ...(curve ? { curve } : {}) },
          { t: seconds, v: 1 },
        ],
      },
    ],
  });

const lane = (points: HfAutomationPoint[]) => ({ target: "opacity", points });

describe("parseClipFade", () => {
  it("returns null for a clip with no automation at all", () => {
    expect(parseClipFade(attrs({}))).toBeNull();
  });

  it("returns null when the automation is all about sound", () => {
    const volumeOnly = serializeAutomation({
      version: 1,
      lanes: [
        {
          target: "volume",
          points: [
            { t: 0, v: 0 },
            { t: 2, v: 1 },
          ],
        },
      ],
    });
    expect(parseClipFade(attrs({ "data-automation": volumeOnly }))).toBeNull();
  });

  it("finds the opacity lane among the others", () => {
    const both = serializeAutomation({
      version: 1,
      lanes: [
        {
          target: "volume",
          points: [
            { t: 0, v: 0 },
            { t: 2, v: 1 },
          ],
        },
        {
          target: "opacity",
          points: [
            { t: 0, v: 0 },
            { t: 1.5, v: 1 },
          ],
        },
      ],
    });
    expect(parseClipFade(attrs({ "data-automation": both }))?.points).toEqual([
      { t: 0, v: 0 },
      { t: 1.5, v: 1 },
    ]);
  });

  it("leaves the picture alone rather than hiding it when the envelope is broken", () => {
    expect(parseClipFade(attrs({ "data-automation": "{not json" }))).toBeNull();
  });

  it("ignores an opacity lane with no points left in it", () => {
    expect(opacityLane({ version: 1, lanes: [{ target: "opacity", points: [] }] })).toBeNull();
    expect(opacityLane(null)).toBeNull();
  });
});

describe("hasClipFadeAttributes", () => {
  it("is one attribute lookup, because it runs on every clip every frame", () => {
    const asked: string[] = [];
    hasClipFadeAttributes((name) => {
      asked.push(name);
      return false;
    });
    expect(asked).toEqual(["data-automation"]);
  });
});

describe("clipFadeLevelAt", () => {
  it("rises across the ramp and holds full afterwards", () => {
    const ramp = lane([
      { t: 0, v: 0 },
      { t: 2, v: 1 },
    ]);
    expect(clipFadeLevelAt(ramp, 0)).toBe(0);
    expect(clipFadeLevelAt(ramp, 1)).toBeCloseTo(0.5, 6);
    expect(clipFadeLevelAt(ramp, 2)).toBe(1);
    expect(clipFadeLevelAt(ramp, 7)).toBe(1);
  });

  it("reads clip-local time, which is what lets a fade survive a move", () => {
    // Nothing here knows where on the timeline the clip sits, so moving it
    // cannot address the envelope at a moment that no longer exists.
    const ramp = lane([
      { t: 0, v: 0 },
      { t: 2, v: 1 },
    ]);
    expect(clipFadeLevelAt(ramp, -5)).toBe(0);
  });

  it("holds the head level before the first point, so a late fade in is not a flash", () => {
    const late = lane([
      { t: 1, v: 0 },
      { t: 3, v: 1 },
    ]);
    expect(clipFadeLevelAt(late, 0)).toBe(0);
    expect(clipFadeLevelAt(late, 0.5)).toBe(0);
  });

  it("carries a fade in and a fade out in one envelope", () => {
    const both = lane([
      { t: 0, v: 0 },
      { t: 1, v: 1 },
      { t: 5, v: 1 },
      { t: 6, v: 0 },
    ]);
    expect(clipFadeLevelAt(both, 0)).toBe(0);
    expect(clipFadeLevelAt(both, 0.5)).toBeCloseTo(0.5, 6);
    expect(clipFadeLevelAt(both, 3)).toBe(1);
    expect(clipFadeLevelAt(both, 5.5)).toBeCloseTo(0.5, 6);
    expect(clipFadeLevelAt(both, 6)).toBe(0);
  });

  it("bends each ramp on its own, because the bend lives on its own point", () => {
    // A single shared curve could never say this: the head eases and the tail
    // does not. The envelope has carried a bend per point all along.
    const apart = lane([
      { t: 0, v: 0, curve: 0.5 },
      { t: 2, v: 1 },
      { t: 6, v: 1 },
      { t: 8, v: 0 },
    ]);
    const straight = lane([
      { t: 0, v: 0 },
      { t: 2, v: 1 },
      { t: 6, v: 1 },
      { t: 8, v: 0 },
    ]);
    expect(clipFadeLevelAt(apart, 1)).not.toBeCloseTo(clipFadeLevelAt(straight, 1), 3);
    expect(clipFadeLevelAt(apart, 7)).toBeCloseTo(clipFadeLevelAt(straight, 7), 6);
  });

  it("stops a third point from being a special case", () => {
    // Drop a point in the middle and it is no longer a fade, it is an envelope.
    // Nothing here has to notice, which is the point of storing it this way.
    const dip = lane([
      { t: 0, v: 1 },
      { t: 2, v: 0.2 },
      { t: 4, v: 1 },
    ]);
    expect(clipFadeLevelAt(dip, 2)).toBeCloseTo(0.2, 6);
    expect(clipFadeLevelAt(dip, 4)).toBe(1);
  });

  it("clamps whatever the envelope says into a level a filter can use", () => {
    const wild = lane([
      { t: 0, v: -3 },
      { t: 1, v: 9 },
    ]);
    expect(clipFadeLevelAt(wild, 0)).toBe(0);
    expect(clipFadeLevelAt(wild, 1)).toBe(1);
  });
});

describe("clipFadeFilter", () => {
  it("leaves the authored filter untouched at full level", () => {
    expect(clipFadeFilter("blur(2px)", 1)).toBe("blur(2px)");
    expect(clipFadeFilter("", 1)).toBe("");
  });

  it("composes onto whatever the author wrote rather than replacing it", () => {
    expect(clipFadeFilter("blur(2px)", 0.5)).toBe("blur(2px) opacity(0.5000)");
  });

  it("is the only filter when the author wrote none", () => {
    expect(clipFadeFilter("", 0.25)).toBe("opacity(0.2500)");
  });

  it("never emits a negative level", () => {
    expect(clipFadeFilter("", -1)).toBe("opacity(0.0000)");
  });
});

describe("the round trip an author would take", () => {
  it("reads back a hand-written fade and plays it", () => {
    const fade = parseClipFade(attrs({ "data-automation": fadeIn(1.5) }));
    expect(fade).not.toBeNull();
    expect(clipFadeLevelAt(fade!, 0)).toBe(0);
    expect(clipFadeLevelAt(fade!, 0.75)).toBeCloseTo(0.5, 6);
    expect(clipFadeLevelAt(fade!, 1.5)).toBe(1);
  });

  it("keeps a bend the author wrote on the point", () => {
    const bent = parseClipFade(attrs({ "data-automation": fadeIn(2, 0.5) }));
    expect(bent?.points[0]?.curve).toBeCloseTo(0.5, 6);
    expect(clipFadeLevelAt(bent!, 1)).not.toBeCloseTo(0.5, 3);
  });
});
