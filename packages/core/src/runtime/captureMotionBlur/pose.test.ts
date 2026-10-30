import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type Affine,
  IDENTITY,
  autoTaps,
  corners,
  createPoseReader,
  individualIs3d,
  individualTransform,
  interpolate,
  invert,
  multiply,
  parseTransform,
  sweep,
  tapWeights,
  tapsFromReads,
  thinTaps,
  translate,
} from "./pose";

const rot = (deg: number, e = 0, f = 0): Affine => {
  const r = (deg * Math.PI) / 180;
  return { a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r), e, f };
};
const scaleOf = (m: Affine): number => Math.hypot(m.a, m.b);
const angleOf = (m: Affine): number => (Math.atan2(m.b, m.a) * 180) / Math.PI;

describe("pose math", () => {
  it("interpolates a rotation without shrinking it", () => {
    // Entry-wise lerp halfway through a 90° turn gives scale cos(45°) ≈ 0.707.
    const mid = interpolate(rot(0), rot(90), 0.5);
    expect(scaleOf(mid)).toBeCloseTo(1, 6);
    expect(angleOf(mid)).toBeCloseTo(45, 6);
  });

  it("rotates the short way round", () => {
    expect(angleOf(interpolate(rot(350), rot(10), 0.5))).toBeCloseTo(0, 6);
  });

  it("interpolates translation and scale linearly", () => {
    const p: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const q: Affine = { a: 3, b: 0, c: 0, d: 2, e: 100, f: -40 };
    expect(interpolate(p, q, 0.25)).toMatchObject({ a: 1.5, d: 1.25, e: 25, f: -10 });
  });

  it("inverts an affine", () => {
    const m = multiply(rot(30, 12, -7), { a: 2, b: 0, c: 0.5, d: 3, e: 4, f: 5 });
    const back = invert(m);
    expect(back).not.toBeNull();
    const id = multiply(m, back as Affine);
    for (const [k, v] of Object.entries(IDENTITY)) expect(id[k as keyof Affine]).toBeCloseTo(v, 9);
  });

  it("refuses to invert a collapsed box", () => {
    expect(invert({ a: 0, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBeNull();
  });

  it("parses computed 2D and 3D transforms", () => {
    const values = (css: string) => Object.values(parseTransform(css) ?? {});
    expect(values("matrix(1, 2, 3, 4, 5, 6)")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(values("matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 7,8,9,1)")).toEqual([1, 0, 0, 1, 7, 8]);
    expect(parseTransform("none")).toBeNull();
    expect(parseTransform("matrix(1, 2)")).toBeNull();
  });
});

describe("taps", () => {
  it("spreads taps across the shutter, centred in each slice", () => {
    const reads = [translate(IDENTITY, 0, 0), translate(IDENTITY, 100, 0)];
    const xs = tapsFromReads(reads, 4).map((m) => m.e);
    expect(xs.map((x) => Math.round(x * 100) / 100)).toEqual([12.5, 37.5, 62.5, 87.5]);
  });

  it("measures the fastest corner's path and the swept rect", () => {
    const taps = [
      translate(IDENTITY, 0, 0),
      translate(IDENTITY, 30, 0),
      translate(IDENTITY, 60, 0),
    ];
    const { travel, rect } = sweep(taps, 10, 10, 1920, 1080);
    expect(travel).toBeCloseTo(60, 6);
    expect(rect).toEqual({ x: 0, y: 0, w: 72, h: 12 });
  });

  it("reports an off-frame sweep as no rect", () => {
    const taps = [translate(IDENTITY, -500, -500), translate(IDENTITY, -400, -500)];
    expect(sweep(taps, 10, 10, 1920, 1080).rect).toBeNull();
  });

  it("thins taps to about one per 1.5 px, never below two", () => {
    const taps = tapsFromReads([IDENTITY, translate(IDENTITY, 300, 0)], 32);
    expect(thinTaps(taps, 3)).toHaveLength(2);
    expect(thinTaps(taps, 15)).toHaveLength(10);
    expect(thinTaps(taps, 300)).toHaveLength(32);
  });

  it("sizes taps to the smear: about one per 2 px, so a fast move has no steps", () => {
    const reads = [translate(IDENTITY, 0, 0), translate(IDENTITY, 200, 0)];
    const taps = autoTaps(reads, 100, 50, 1920, 1080);
    expect(taps.length).toBeGreaterThanOrEqual(90);
    expect(taps.length).toBeLessThanOrEqual(105);
    const steps = taps.slice(1).map((m, i) => m.e - (taps[i] as Affine).e);
    expect(Math.max(...steps)).toBeLessThanOrEqual(2.3);
  });

  it("never uses fewer than 32 taps, and caps a huge move at 128", () => {
    expect(
      autoTaps([translate(IDENTITY, 0, 0), translate(IDENTITY, 0.5, 0)], 100, 50, 1920, 1080),
    ).toHaveLength(32);
    expect(
      autoTaps([translate(IDENTITY, 0, 0), translate(IDENTITY, 40, 0)], 100, 50, 1920, 1080),
    ).toHaveLength(32);
    expect(
      autoTaps([translate(IDENTITY, 0, 0), translate(IDENTITY, 200, 0)], 100, 50, 1920, 1080)
        .length,
    ).toBeGreaterThan(90);
    expect(
      autoTaps([translate(IDENTITY, 0, 0), translate(IDENTITY, 5000, 0)], 100, 50, 1920, 1080),
    ).toHaveLength(128);
  });

  it("weights taps in whole 1/255 units that sum to exactly 1, for any count", () => {
    for (const n of [2, 3, 16, 40, 60, 80, 94, 104, 113, 127, 128, 255]) {
      const w = tapWeights(n);
      expect(w).toHaveLength(n);
      const units = w.map((x) => Math.round(x * 255));
      expect(units.reduce((s, u) => s + u, 0)).toBe(255);
      expect(Math.max(...units) - Math.min(...units)).toBeLessThanOrEqual(1);
    }
  });

  it("places a rotated box's corners", () => {
    const [, tr] = corners(rot(90), 10, 0);
    expect(tr?.[0]).toBeCloseTo(0, 9);
    expect(tr?.[1]).toBeCloseTo(10, 9);
  });
});

const extra = new Map<Element, Partial<CSSStyleDeclaration>>();

describe("createPoseReader", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    extra.clear();
  });

  function place(el: HTMLElement, left: number, top: number, parent: Element | null): void {
    Object.defineProperty(el, "offsetLeft", { value: left, configurable: true });
    Object.defineProperty(el, "offsetTop", { value: top, configurable: true });
    Object.defineProperty(el, "offsetParent", { value: parent, configurable: true });
  }

  function tree() {
    const scene = document.createElement("div");
    const group = document.createElement("div");
    const mover = document.createElement("div");
    scene.append(group);
    group.append(mover);
    place(group, 100, 50, scene);
    place(mover, 10, 20, group);
    const transforms = new Map<Element, string>([
      [group, "matrix(2, 0, 0, 2, 0, 0)"],
      [mover, "none"],
    ]);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el: Element) =>
        ({
          transform: transforms.get(el) ?? "none",
          transformOrigin: "0px 0px",
          ...extra.get(el),
        }) as CSSStyleDeclaration,
    );
    return { scene, group, mover, transforms };
  }

  it("composes layout offsets with every transform up the chain", () => {
    const { scene, mover } = tree();
    const reader = createPoseReader(scene, new Set([mover]));
    // group at (100,50) scaled 2×, mover at (10,20) inside it → (120, 90), scale 2.
    expect(reader.pose(mover)).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 120, f: 90 });
  });

  it("re-reads a dynamic node's transform after reset, but caches a static one", () => {
    const { scene, group, mover, transforms } = tree();
    const reader = createPoseReader(scene, new Set([mover]));
    reader.pose(mover);
    transforms.set(mover, "matrix(1, 0, 0, 1, 5, 0)");
    transforms.set(group, "matrix(1, 0, 0, 1, 0, 0)");
    reader.reset();
    // The mover's new 5 px shift lands (in the still-cached 2× group), the group's change does not.
    expect(reader.pose(mover)).toMatchObject({ a: 2, e: 130, f: 90 });
  });

  it("puts them into a pose, before the transform property and about its origin", () => {
    const { scene, group, mover } = tree();
    extra.set(group, { scale: "2" });
    extra.set(mover, { translate: "-50% -50%" });
    Object.defineProperty(mover, "offsetWidth", { value: 20, configurable: true });
    Object.defineProperty(mover, "offsetHeight", { value: 40, configurable: true });
    const reader = createPoseReader(scene, new Set());
    // group: layout (100,50), scale 2 from the origin, then its transform scale 2 → 4×.
    // mover: layout (10,20) in the group, shifted (-10,-20): at the group's origin.
    expect(reader.pose(mover)).toEqual({ a: 4, b: 0, c: 0, d: 4, e: 100, f: 50 });
  });

  it.each([
    ["translate", "120px 0px", "matrix(1, 0, 0, 1, 120, 0)"],
    ["translate", "180px 0px", "matrix(1, 0, 0, 1, 180, 0)"],
    ["rotate", "90deg", "matrix(0, 1, -1, 0, 0, 0)"],
    ["scale", "2 3", "matrix(2, 0, 0, 3, 0, 0)"],
  ])("poses `%s: %s` like the equivalent matrix transform", (prop, value, matrix) => {
    const { scene, mover, transforms } = tree();
    const reader = createPoseReader(scene, new Set([mover]));
    transforms.set(mover, matrix);
    const control = reader.pose(mover);
    transforms.set(mover, "none");
    extra.set(mover, { [prop]: value });
    reader.reset();
    const pose = reader.pose(mover);
    for (const k of ["a", "b", "c", "d", "e", "f"] as const)
      expect(pose[k]).toBeCloseTo(control[k], 9);
  });

  it("measures from the offsetParent's border and subtracts scroll", () => {
    const { scene, group, mover } = tree();
    Object.defineProperty(group, "clientLeft", { value: 5, configurable: true });
    Object.defineProperty(group, "clientTop", { value: 3, configurable: true });
    Object.defineProperty(group, "scrollTop", { value: 7, configurable: true });
    const reader = createPoseReader(scene, new Set());
    // group's 2× transform scales mover's in-group offset (10 + 5, 20 + 3 - 7) → (30, 32).
    expect(reader.pose(mover)).toMatchObject({ e: 130, f: 82 });
  });
});

describe("individual transform properties", () => {
  it("centres a box with translate percentages of its own size", () => {
    expect(individualTransform({ translate: "-50% -50%" }, 100, 60)).toEqual({
      ...IDENTITY,
      e: -50,
      f: -30,
    });
    expect(individualTransform({ translate: "calc(50% + 10px) 5px" }, 100, 60)).toMatchObject({
      e: 60,
      f: 5,
    });
  });

  it("applies translate, then rotate, then scale", () => {
    const m = individualTransform({ translate: "10px 0px", rotate: "90deg", scale: "2" }, 10, 10);
    // A point (1, 0): scaled to (2, 0), rotated to (0, 2), shifted to (10, 2).
    expect(m && [m.a + m.e, m.b + m.f]).toEqual([expect.closeTo(10, 9), expect.closeTo(2, 9)]);
  });

  it("is null when none is set", () => {
    expect(individualTransform({ translate: "none", rotate: "none", scale: "none" }, 1, 1)).toBe(
      null,
    );
    expect(individualTransform({}, 1, 1)).toBe(null);
  });

  it("flags a z translate or a rotate axis as 3D", () => {
    expect(individualIs3d({ translate: "10px 20px 5px" })).toBe(true);
    expect(individualIs3d({ rotate: "x 30deg" })).toBe(true);
    expect(individualIs3d({ rotate: "1 1 0 57.2958deg" })).toBe(true);
    expect(individualIs3d({ translate: "10px 20px", rotate: "30deg", scale: "2" })).toBe(false);
  });
});
