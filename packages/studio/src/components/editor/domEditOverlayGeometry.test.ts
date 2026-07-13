// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  orientedOverlayRect,
  orientedGroupAwareOverlayRect,
  overlayCornersCentroid,
  selectionCacheKey,
} from "./domEditOverlayGeometry";

describe("overlayCornersCentroid", () => {
  it("averages the four corners (the rendered rotation center)", () => {
    expect(
      overlayCornersCentroid({
        nw: { x: 10, y: 20 },
        ne: { x: 110, y: 20 },
        se: { x: 110, y: 80 },
        sw: { x: 10, y: 80 },
      }),
    ).toEqual({ x: 60, y: 50 });
  });

  it("is unchanged by rotation — a rotated square's corners average to its center", () => {
    // Unit square centered at (5,5), rotated 45deg about its center: corners land
    // on the axis midpoints, whose average is still the center.
    const c = overlayCornersCentroid({
      nw: { x: 5, y: 5 - Math.SQRT2 / 2 },
      ne: { x: 5 + Math.SQRT2 / 2, y: 5 },
      se: { x: 5, y: 5 + Math.SQRT2 / 2 },
      sw: { x: 5 - Math.SQRT2 / 2, y: 5 },
    });
    expect(c.x).toBeCloseTo(5, 9);
    expect(c.y).toBeCloseTo(5, 9);
  });
});

describe("selectionCacheKey — hfId collision (R7)", () => {
  it("produces distinct keys for two elements that differ only by hfId", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = selectionCacheKey({ sourceFile: "index.html", hfId: "hf-111" } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = selectionCacheKey({ sourceFile: "index.html", hfId: "hf-222" } as any);
    expect(a).not.toBe(b);
  });
});

describe("orientedOverlayRect — rotation gate (perf fix, V15 18a/18b)", () => {
  // jsdom has no DOMMatrix/DOMPoint; a minimal stand-in is enough to exercise the
  // real (unmocked) orientedOverlayRect, unlike DomEditOverlay.test.ts and
  // anchoredResizeCommitFeedsOffset.test.ts, which mock this module entirely.
  class FakeDOMMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    constructor(init?: string) {
      const m = init ? /matrix\(([^)]+)\)/.exec(init) : null;
      if (!m) return;
      const parts = m[1]!.split(",").map((s) => Number.parseFloat(s.trim()));
      [this.a, this.b, this.c, this.d, this.e, this.f] = parts as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
    }
    transformPoint(pt: { x: number; y: number }) {
      return {
        x: this.a * pt.x + this.c * pt.y + this.e,
        y: this.b * pt.x + this.d * pt.y + this.f,
      };
    }
  }
  class FakeDOMPoint {
    constructor(
      public x: number,
      public y: number,
    ) {}
  }
  // matrix() form of rotate(30deg), so the module's `new DOMMatrix(cs.transform)`
  // parse (which expects "matrix(...)", not "rotate(...)") resolves correctly.
  const ROTATE_30DEG_MATRIX =
    "matrix(0.8660254037844387, 0.49999999999999994, -0.49999999999999994, 0.8660254037844387, 0, 0)";

  function stubRect(
    el: Element,
    rect: { left: number; top: number; width: number; height: number },
  ) {
    (el as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
      ({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left,
        y: rect.top,
        toJSON() {
          return this;
        },
      }) as DOMRect;
  }

  function buildHarness() {
    const overlayEl = document.createElement("div");
    document.body.appendChild(overlayEl);
    stubRect(overlayEl, { left: 0, top: 0, width: 1000, height: 1000 });

    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    stubRect(iframe, { left: 0, top: 0, width: 1000, height: 1000 });

    const doc = iframe.contentDocument!;
    const root = doc.createElement("div");
    root.setAttribute("data-composition-id", "root");
    root.setAttribute("data-width", "1000");
    root.setAttribute("data-height", "1000");
    doc.body.appendChild(root);

    const el = doc.createElement("div");
    root.appendChild(el);
    stubRect(el, { left: 400, top: 450, width: 200, height: 100 });
    Object.defineProperty(el, "offsetWidth", { value: 200, configurable: true });
    Object.defineProperty(el, "offsetHeight", { value: 100, configurable: true });

    const win = iframe.contentWindow as unknown as Window & {
      DOMMatrix: unknown;
      DOMPoint: unknown;
    };
    win.DOMMatrix = FakeDOMMatrix;
    win.DOMPoint = FakeDOMPoint;

    return { overlayEl, iframe, el };
  }

  it("unrotated element takes the cheap AABB path — matches the raw bounding rect, angle 0", () => {
    const { overlayEl, iframe, el } = buildHarness();
    const rect = orientedOverlayRect(overlayEl, iframe, el);
    expect(rect).not.toBeNull();
    expect(rect!.left).toBeCloseTo(400, 5);
    expect(rect!.top).toBeCloseTo(450, 5);
    expect(rect!.width).toBeCloseTo(200, 5);
    expect(rect!.height).toBeCloseTo(100, 5);
    expect(rect!.angle ?? 0).toBe(0);
  });

  it("rotated element takes the corner-geometry path — reports the live angle", () => {
    const { overlayEl, iframe, el } = buildHarness();
    el.style.transform = ROTATE_30DEG_MATRIX;
    const rect = orientedOverlayRect(overlayEl, iframe, el);
    expect(rect).not.toBeNull();
    expect(rect!.angle).toBeCloseTo(30, 3);
  });

  it("preserves an ordinary element's rotation through the group-aware entry point", () => {
    const { overlayEl, iframe, el } = buildHarness();
    el.style.transform = ROTATE_30DEG_MATRIX;
    const rect = orientedGroupAwareOverlayRect(overlayEl, iframe, el);
    expect(rect!.angle).toBeCloseTo(30, 3);
  });

  it("gate re-evaluates every call — editing an element to rotated mid-session flips the path immediately", () => {
    const { overlayEl, iframe, el } = buildHarness();
    const before = orientedOverlayRect(overlayEl, iframe, el);
    expect(before?.angle ?? 0).toBe(0);

    el.style.transform = ROTATE_30DEG_MATRIX;
    const after = orientedOverlayRect(overlayEl, iframe, el);
    expect(after!.angle).toBeCloseTo(30, 3);

    el.style.transform = "";
    const restored = orientedOverlayRect(overlayEl, iframe, el);
    expect(restored?.angle ?? 0).toBe(0);
  });
});
