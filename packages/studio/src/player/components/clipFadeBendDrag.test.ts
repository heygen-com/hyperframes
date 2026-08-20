import { describe, expect, it } from "vitest";
import { fadeEase } from "@hyperframes/core/clip-fade";
import { bendFromPointer, bendHandlePosition } from "./clipFadeBendDrag";
import { fadeSampler } from "./clipFades";

const HEIGHT = 40;

describe("bendFromPointer", () => {
  it("is straight when the pointer sits on the line", () => {
    expect(bendFromPointer(HEIGHT / 2, HEIGHT)).toBeCloseTo(0, 6);
  });

  it("puts the curve under the pointer, which is the whole gesture", () => {
    for (const offsetY of [6, 12, 20, 28, 34]) {
      const bend = bendFromPointer(offsetY, HEIGHT);
      const level = fadeEase(0.5, bend);
      expect((1 - level) * HEIGHT).toBeCloseTo(offsetY, 0);
    }
  });

  it("bends up for a fade that gets loud early and down for one that waits", () => {
    // Smaller offsetY is higher on the screen, so the level halfway through is
    // greater: the fade has already done most of its work.
    expect(bendFromPointer(8, HEIGHT)).toBeGreaterThan(0);
    expect(bendFromPointer(32, HEIGHT)).toBeLessThan(0);
  });

  it("stops following a pointer dragged past the range instead of inverting", () => {
    expect(bendFromPointer(-200, HEIGHT)).toBe(1);
    expect(bendFromPointer(400, HEIGHT)).toBe(-1);
  });

  it("reports straight rather than dividing by a clip with no height", () => {
    expect(bendFromPointer(10, 0)).toBe(0);
  });
});

describe("bendHandlePosition", () => {
  const base = { seconds: 2, pixelsPerSecond: 25, width: 200, height: HEIGHT };

  it("sits halfway along a fade in, and halfway along a fade out", () => {
    expect(bendHandlePosition({ ...base, edge: "in", level: 0.5 })?.x).toBeCloseTo(25, 6);
    expect(bendHandlePosition({ ...base, edge: "out", level: 0.5 })?.x).toBeCloseTo(175, 6);
  });

  it("rides the curve, so the handle stays under the pointer while bending", () => {
    for (const bend of [-1, -0.5, 0, 0.5, 1]) {
      const level = fadeSampler(bend)(0.5);
      const at = bendHandlePosition({ ...base, edge: "in", level });
      expect(at?.y).toBeCloseTo((1 - level) * HEIGHT, 6);
    }
  });

  it("has nowhere to sit on a fade with no width or a clip with no height", () => {
    expect(bendHandlePosition({ ...base, edge: "in", level: 0.5, seconds: 0 })).toBeNull();
    expect(bendHandlePosition({ ...base, edge: "in", level: 0.5, height: 0 })).toBeNull();
  });

  it("never runs past a fade clamped to the clip's own width", () => {
    const at = bendHandlePosition({ ...base, edge: "in", level: 0.5, seconds: 999 });
    expect(at?.x).toBeCloseTo(base.width / 2, 6);
  });
});

describe("the drag round-trips", () => {
  it("lands the handle back where the pointer left it", () => {
    // Inside the band the bend limit can express: levels from 0.5^4 to 0.5^0.25,
    // which is roughly 6.4px to 37.5px down a 40px clip.
    for (const offsetY of [8, 15, 25, 35]) {
      const bend = bendFromPointer(offsetY, HEIGHT);
      const at = bendHandlePosition({
        edge: "in",
        seconds: 2,
        pixelsPerSecond: 25,
        width: 200,
        height: HEIGHT,
        level: fadeSampler(bend)(0.5),
      });
      expect(at?.y).toBeCloseTo(offsetY, 0);
    }
  });

  it("parks the handle at the limit when the pointer goes further than a bend can", () => {
    const at = (offsetY: number) =>
      bendHandlePosition({
        edge: "in",
        seconds: 2,
        pixelsPerSecond: 25,
        width: 200,
        height: HEIGHT,
        level: fadeSampler(bendFromPointer(offsetY, HEIGHT))(0.5),
      })?.y;
    // Dragged off the top of the clip and well past it: both stop in the same
    // place rather than the curve flipping over.
    expect(at(0)).toBeCloseTo(at(-500)!, 6);
    expect(at(HEIGHT)).toBeCloseTo(at(500)!, 6);
  });
});
