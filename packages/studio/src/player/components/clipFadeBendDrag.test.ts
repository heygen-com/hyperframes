import { describe, expect, it } from "vitest";
import {
  bendFromPointer,
  fadeHandlePosition,
  lengthFromPointer,
  resolveDragAxis,
} from "./clipFadeBendDrag";
import { envelopeFadeSampler } from "./clipFades";

const HEIGHT = 40;

describe("bendFromPointer", () => {
  it("is straight when the pointer sits on the line", () => {
    expect(bendFromPointer(HEIGHT / 2, HEIGHT)).toBeCloseTo(0, 6);
  });

  it("puts the curve under the pointer, which is the whole gesture", () => {
    for (const offsetY of [6, 12, 20, 28, 34]) {
      const bend = bendFromPointer(offsetY, HEIGHT);
      const level = envelopeFadeSampler(bend)(0.5);
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

describe("fadeHandlePosition", () => {
  const base = { seconds: 2, pixelsPerSecond: 25, width: 200, height: HEIGHT };

  it("sits halfway along a fade in, and halfway along a fade out", () => {
    expect(fadeHandlePosition({ ...base, edge: "in", level: 0.5 })?.x).toBeCloseTo(25, 6);
    expect(fadeHandlePosition({ ...base, edge: "out", level: 0.5 })?.x).toBeCloseTo(175, 6);
  });

  it("rides the curve, so the handle stays under the pointer while bending", () => {
    for (const bend of [-1, -0.5, 0, 0.5, 1]) {
      const level = envelopeFadeSampler(bend)(0.5);
      const at = fadeHandlePosition({ ...base, edge: "in", level });
      expect(at?.y).toBeCloseTo((1 - level) * HEIGHT, 6);
    }
  });

  it("has nowhere to sit on a fade with no width or a clip with no height", () => {
    expect(fadeHandlePosition({ ...base, edge: "in", level: 0.5, seconds: 0 })).toBeNull();
    expect(fadeHandlePosition({ ...base, edge: "in", level: 0.5, height: 0 })).toBeNull();
  });

  it("never runs past a fade clamped to the clip's own width", () => {
    const at = fadeHandlePosition({ ...base, edge: "in", level: 0.5, seconds: 999 });
    expect(at?.x).toBeCloseTo(base.width / 2, 6);
  });
});

describe("lengthFromPointer", () => {
  const base = { pixelsPerSecond: 25, width: 200 };

  it("puts the fade's midpoint exactly where the pointer is", () => {
    // 50px in on a 25px/s timeline is a 100px fade, whose midpoint is 50px in.
    for (const offsetX of [10, 50, 90]) {
      const seconds = lengthFromPointer({ ...base, edge: "in", offsetX });
      expect((seconds * base.pixelsPerSecond) / 2).toBeCloseTo(offsetX, 6);
    }
  });

  it("measures a fade out from the clip's right edge", () => {
    const seconds = lengthFromPointer({ ...base, edge: "out", offsetX: 150 });
    expect(seconds).toBeCloseTo(4, 6);
    expect(base.width - (seconds * base.pixelsPerSecond) / 2).toBeCloseTo(150, 6);
  });

  it("has no fade to give when the pointer is dragged past the clip's edge", () => {
    expect(lengthFromPointer({ ...base, edge: "in", offsetX: -40 })).toBe(0);
    expect(lengthFromPointer({ ...base, edge: "out", offsetX: 260 })).toBe(0);
  });

  it("reports nothing rather than dividing by a timeline with no zoom", () => {
    expect(lengthFromPointer({ ...base, edge: "in", offsetX: 50, pixelsPerSecond: 0 })).toBe(0);
  });
});

describe("resolveDragAxis", () => {
  it("waits until the drag is big enough to mean something", () => {
    expect(resolveDragAxis(0, 0)).toBeNull();
    expect(resolveDragAxis(2, -2)).toBeNull();
  });

  it("reads a sideways drag as length and a vertical one as bend", () => {
    expect(resolveDragAxis(12, 3)).toBe("length");
    expect(resolveDragAxis(-12, 3)).toBe("length");
    expect(resolveDragAxis(2, 12)).toBe("bend");
    expect(resolveDragAxis(2, -12)).toBe("bend");
  });

  it("keeps a diagonal on one axis rather than changing both", () => {
    expect(resolveDragAxis(20, 19)).toBe("length");
    expect(resolveDragAxis(19, 20)).toBe("bend");
  });
});

describe("the drag round-trips", () => {
  it("lands the handle back where the pointer left it", () => {
    // Inside the band the bend limit can express: levels from 0.5^4 to 0.5^0.25,
    // which is roughly 6.4px to 37.5px down a 40px clip.
    for (const offsetY of [8, 15, 25, 35]) {
      const bend = bendFromPointer(offsetY, HEIGHT);
      const at = fadeHandlePosition({
        edge: "in",
        seconds: 2,
        pixelsPerSecond: 25,
        width: 200,
        height: HEIGHT,
        level: envelopeFadeSampler(bend)(0.5),
      });
      expect(at?.y).toBeCloseTo(offsetY, 0);
    }
  });

  it("parks the handle at the limit when the pointer goes further than a bend can", () => {
    const at = (offsetY: number) =>
      fadeHandlePosition({
        edge: "in",
        seconds: 2,
        pixelsPerSecond: 25,
        width: 200,
        height: HEIGHT,
        level: envelopeFadeSampler(bendFromPointer(offsetY, HEIGHT))(0.5),
      })?.y;
    // Dragged off the top of the clip and well past it: both stop in the same
    // place rather than the curve flipping over.
    expect(at(0)).toBeCloseTo(at(-500)!, 6);
    expect(at(HEIGHT)).toBeCloseTo(at(500)!, 6);
  });

  it("keeps the handle under a pointer dragged sideways too", () => {
    for (const offsetX of [15, 40, 80]) {
      const seconds = lengthFromPointer({
        edge: "in",
        offsetX,
        pixelsPerSecond: 25,
        width: 200,
      });
      const at = fadeHandlePosition({
        edge: "in",
        seconds,
        pixelsPerSecond: 25,
        width: 200,
        height: HEIGHT,
        level: 0.5,
      });
      expect(at?.x).toBeCloseTo(offsetX, 6);
    }
  });
});
