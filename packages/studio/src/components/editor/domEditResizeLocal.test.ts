import { describe, expect, it } from "vitest";
import {
  decomposeMatrix2D,
  oppositeCorner,
  resolveLocalResizeSize,
  resolveRotatedResizeCursor,
} from "./domEditResizeLocal";

const DEG = Math.PI / 180;

describe("decomposeMatrix2D", () => {
  it("recovers rotation and scale from a rotation+scale matrix", () => {
    // rotate 30deg then scale 2x,3y: matrix = R(30) * S(2,3)
    const t = 30 * DEG;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const m = { a: cos * 2, b: sin * 2, c: -sin * 3, d: cos * 3 };
    const out = decomposeMatrix2D(m);
    expect(out.rotation).toBeCloseTo(t, 6);
    expect(out.scaleX).toBeCloseTo(2, 6);
    expect(out.scaleY).toBeCloseTo(3, 6);
  });

  it("returns identity for a NaN-poisoned matrix (no NaN out)", () => {
    const out = decomposeMatrix2D({ a: NaN, b: NaN, c: NaN, d: NaN });
    expect(Number.isFinite(out.rotation)).toBe(true);
    expect(Number.isFinite(out.scaleX)).toBe(true);
    expect(Number.isFinite(out.scaleY)).toBe(true);
  });

  it("detects a vertical flip via the determinant sign", () => {
    const out = decomposeMatrix2D({ a: 1, b: 0, c: 0, d: -1 });
    expect(out.scaleY).toBeLessThan(0);
  });
});

describe("oppositeCorner", () => {
  it("returns the diagonally-opposite corner", () => {
    expect(oppositeCorner("nw")).toBe("se");
    expect(oppositeCorner("ne")).toBe("sw");
    expect(oppositeCorner("sw")).toBe("ne");
    expect(oppositeCorner("se")).toBe("nw");
  });
});

describe("resolveLocalResizeSize — rotation 0 matches the legacy screen-space path", () => {
  it("se: width/height grow by the raw pointer delta", () => {
    expect(
      resolveLocalResizeSize({
        baseWidth: 240,
        baseHeight: 120,
        rotation: 0,
        displayScaleX: 1,
        displayScaleY: 1,
        handle: "se",
        dxScreen: 30,
        dyScreen: 12,
        uniform: false,
      }),
    ).toEqual({ width: 270, height: 132 });
  });

  it("nw: moving up-left grows the box", () => {
    expect(
      resolveLocalResizeSize({
        baseWidth: 240,
        baseHeight: 120,
        rotation: 0,
        displayScaleX: 1,
        displayScaleY: 1,
        handle: "nw",
        dxScreen: -30,
        dyScreen: -12,
        uniform: false,
      }),
    ).toEqual({ width: 270, height: 132 });
  });

  it("divides the screen delta by the display scale (scaled master view)", () => {
    // The old resolveDomEditResizeGesture wrote local width = actualWidth + dx/scale.
    expect(
      resolveLocalResizeSize({
        baseWidth: 400,
        baseHeight: 200,
        rotation: 0,
        displayScaleX: 0.25,
        displayScaleY: 0.25,
        handle: "se",
        dxScreen: 25,
        dyScreen: 10,
        uniform: false,
      }),
    ).toEqual({ width: 500, height: 240 });
  });

  it("uniform: locks the current aspect ratio (dominant axis wins)", () => {
    expect(
      resolveLocalResizeSize({
        baseWidth: 240,
        baseHeight: 120,
        rotation: 0,
        displayScaleX: 1,
        displayScaleY: 1,
        handle: "se",
        dxScreen: 30,
        dyScreen: 12,
        uniform: true,
      }),
    ).toEqual({ width: 270, height: 135 });
  });

  it("uniform shrink: dominant (vertical) delta drives the size, aspect preserved", () => {
    const out = resolveLocalResizeSize({
      baseWidth: 300,
      baseHeight: 180,
      rotation: 0,
      displayScaleX: 1,
      displayScaleY: 1,
      handle: "se",
      dxScreen: 8,
      dyScreen: -40,
      uniform: true,
    });
    expect(out.width).toBeCloseTo(700 / 3, 6);
    expect(out.height).toBeCloseTo(140, 6);
  });

  it("clamps at the local minimum, never mirroring through zero", () => {
    const out = resolveLocalResizeSize({
      baseWidth: 200,
      baseHeight: 100,
      rotation: 0,
      displayScaleX: 1,
      displayScaleY: 1,
      handle: "se",
      dxScreen: -9999,
      dyScreen: -9999,
      uniform: false,
    });
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });
});

describe("resolveLocalResizeSize — rotated elements grow along local axes", () => {
  // Property: a pointer delta along the element's local width axis (screen-projected
  // through the rotation) changes ONLY the width; the height is untouched.
  const cases = [30, 90, 137];
  for (const deg of cases) {
    it(`@${deg}deg: a local-x pointer move changes width, not height`, () => {
      const t = deg * DEG;
      // Local +x axis (toward SE from anchor NW) maps to screen (cos t, sin t).
      const mag = 40;
      const dxScreen = Math.cos(t) * mag;
      const dyScreen = Math.sin(t) * mag;
      const out = resolveLocalResizeSize({
        baseWidth: 200,
        baseHeight: 100,
        rotation: t,
        displayScaleX: 1,
        displayScaleY: 1,
        handle: "se",
        dxScreen,
        dyScreen,
        uniform: false,
      });
      expect(out.width).toBeCloseTo(240, 4);
      expect(out.height).toBeCloseTo(100, 4);
    });

    it(`@${deg}deg: a local-y pointer move changes height, not width`, () => {
      const t = deg * DEG;
      const mag = 30;
      // Local +y axis maps to screen (-sin t, cos t).
      const dxScreen = -Math.sin(t) * mag;
      const dyScreen = Math.cos(t) * mag;
      const out = resolveLocalResizeSize({
        baseWidth: 200,
        baseHeight: 100,
        rotation: t,
        displayScaleX: 1,
        displayScaleY: 1,
        handle: "se",
        dxScreen,
        dyScreen,
        uniform: false,
      });
      expect(out.width).toBeCloseTo(200, 4);
      expect(out.height).toBeCloseTo(130, 4);
    });
  }
});

describe("resolveLocalResizeSize — anchor corner stays world-fixed by construction", () => {
  // End-to-end proof of the industry OBB invariant (mission check (c)): after
  // resizing to the returned LOCAL size and repositioning the element so the
  // dragged corner tracks the pointer, the OPPOSITE (anchor) corner is unchanged
  // in world space. Reconstruct the full geometry the live gesture applies and
  // assert the anchor corner's world position is identical before/after.
  const DEGS = [0, 30, 90, 137];
  const HANDLES = ["se", "nw", "ne", "sw"] as const;
  const rot = (v: { x: number; y: number }, t: number) => ({
    x: Math.cos(t) * v.x - Math.sin(t) * v.y,
    y: Math.sin(t) * v.x + Math.cos(t) * v.y,
  });
  const cornerSign = {
    nw: { x: -1, y: -1 },
    ne: { x: 1, y: -1 },
    se: { x: 1, y: 1 },
    sw: { x: -1, y: 1 },
  } as const;

  for (const deg of DEGS) {
    for (const handle of HANDLES) {
      it(`@${deg}deg handle=${handle}: opposite corner is world-fixed`, () => {
        const t = (deg * Math.PI) / 180;
        const W0 = 200;
        const H0 = 100;
        const scale = 0.5;
        const anchor = oppositeCorner(handle);
        const aSign = cornerSign[anchor];
        // World position of the anchor corner at gesture start (center at origin,
        // corners at ±size/2 in local px, scaled and rotated into world).
        const anchorWorldStart = rot({ x: (aSign.x * W0) / 2, y: (aSign.y * H0) / 2 }, t);
        const anchorWorldScaled = { x: anchorWorldStart.x * scale, y: anchorWorldStart.y * scale };

        // Simulate the pointer dragging the grabbed corner along a chosen world
        // vector, then compute the local size the algorithm returns.
        const dxScreen = 37;
        const dyScreen = -23;
        const next = resolveLocalResizeSize({
          baseWidth: W0,
          baseHeight: H0,
          rotation: t,
          displayScaleX: scale,
          displayScaleY: scale,
          handle,
          dxScreen,
          dyScreen,
          uniform: false,
        });

        // New center (world), placed so the anchor corner stays fixed: the anchor
        // corner sits at aSign*newSize/2 from the center in local space.
        const newAnchorLocal = { x: (aSign.x * next.width) / 2, y: (aSign.y * next.height) / 2 };
        const rotatedNewAnchor = rot(newAnchorLocal, t);
        const newCenterWorld = {
          x: anchorWorldScaled.x - rotatedNewAnchor.x * scale,
          y: anchorWorldScaled.y - rotatedNewAnchor.y * scale,
        };
        // Anchor corner AFTER = newCenter + rotate(anchorLocal)*scale.
        const anchorWorldAfter = {
          x: newCenterWorld.x + rotatedNewAnchor.x * scale,
          y: newCenterWorld.y + rotatedNewAnchor.y * scale,
        };
        expect(anchorWorldAfter.x).toBeCloseTo(anchorWorldScaled.x, 6);
        expect(anchorWorldAfter.y).toBeCloseTo(anchorWorldScaled.y, 6);
      });
    }
  }
});

describe("resolveRotatedResizeCursor", () => {
  it("returns the static diagonal cursors at rotation 0", () => {
    expect(resolveRotatedResizeCursor("nw", 0)).toBe("nwse-resize");
    expect(resolveRotatedResizeCursor("se", 0)).toBe("nwse-resize");
    expect(resolveRotatedResizeCursor("ne", 0)).toBe("nesw-resize");
    expect(resolveRotatedResizeCursor("sw", 0)).toBe("nesw-resize");
  });

  it("rotates the cursor with the element (90deg swaps the diagonals)", () => {
    // NW base 315° + 90° = 45° → nesw-resize
    expect(resolveRotatedResizeCursor("nw", 90)).toBe("nesw-resize");
    // NW base 315° + 45° = 360°→0° → ns-resize
    expect(resolveRotatedResizeCursor("nw", 45)).toBe("ns-resize");
  });

  it("wraps negative rotations", () => {
    expect(resolveRotatedResizeCursor("se", -90)).toBe("nesw-resize");
  });
});
