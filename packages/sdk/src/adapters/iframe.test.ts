/**
 * Unit tests for the pure functions in iframe.ts (no browser needed).
 *
 * elementFromPoint requires a real layout engine — the adapter's elementAtPoint()
 * is NOT tested here. Cover it with an integration test mounting a same-origin
 * iframe (WS-A1 follow-on).
 *
 * applyDraft / commitPreview / cancelPreview require HTMLElement.style + querySelector
 * which are also browser-only. They are tested via a lightweight fake-DOM helper
 * that simulates style.setProperty / getAttribute / removeProperty.
 *
 * WS-G image-alpha tests cover:
 * - alphaIsOpaque (pure predicate)
 * - mapPointToImagePixel (pure coordinate mapping)
 * - z-stack fallthrough via mock elementsFromPoint
 * - canvas taint → opaque fallback
 * - non-image regression (WS-A1 opacity behavior unchanged)
 *
 * Paint-query tests (elementPaintsInk / compositionPaintsAt / isProvablyEmptyAt) live at
 * bottom of this file and carry their own fake-DOM helpers: the walk is geometric, so
 * they need element boxes and computed style rather than a hit-test stack.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveNearestHfElement,
  computeDraftPosition,
  createIframePreviewAdapter,
  alphaIsOpaque,
  mapPointToImagePixel,
  elementPaintsInk,
  compositionPaintsAt,
  _imgCanvasCache,
} from "./iframe.js";
import type { ElementAtPointResult } from "./types.js";
import type { EditOp } from "../types.js";

// ─── Minimal fake element ────────────────────────────────────────────────────

interface FakeEl {
  attrs: Record<string, string>;
  tagName: string;
  parentElement: FakeEl | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

function fakeEl(
  attrs: Record<string, string>,
  tagName: string,
  parent: FakeEl | null = null,
): FakeEl {
  return {
    attrs,
    tagName,
    parentElement: parent,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name);
    },
  };
}

const visible = () => true;
const invisible = () => false;

// ─── resolveNearestHfElement ──────────────────────────────────────────────────

describe("resolveNearestHfElement", () => {
  it("returns null for a null input", () => {
    expect(resolveNearestHfElement(null, visible)).toBeNull();
  });

  it("returns the element itself when it carries data-hf-id", () => {
    const el = fakeEl({ "data-hf-id": "hf-abc" }, "div");
    const result = resolveNearestHfElement(el as unknown as Element, visible);
    expect(result).toEqual<ElementAtPointResult>({ id: "hf-abc", tag: "div" });
  });

  it("walks up to a parent that carries data-hf-id", () => {
    const parent = fakeEl({ "data-hf-id": "hf-parent" }, "section");
    const child = fakeEl({}, "span", parent);
    const result = resolveNearestHfElement(child as unknown as Element, visible);
    expect(result).toEqual<ElementAtPointResult>({ id: "hf-parent", tag: "section" });
  });

  it("returns null when the nearest data-hf-id node is data-hf-root", () => {
    const root = fakeEl({ "data-hf-id": "hf-stage", "data-hf-root": "" }, "div");
    const child = fakeEl({}, "p", root);
    expect(resolveNearestHfElement(child as unknown as Element, visible)).toBeNull();
  });

  it("returns null when the element itself is data-hf-root", () => {
    const root = fakeEl({ "data-hf-id": "hf-stage", "data-hf-root": "" }, "div");
    expect(resolveNearestHfElement(root as unknown as Element, visible)).toBeNull();
  });

  it("returns null when isVisible returns false for the matching element", () => {
    const el = fakeEl({ "data-hf-id": "hf-abc" }, "div");
    expect(resolveNearestHfElement(el as unknown as Element, invisible)).toBeNull();
  });

  it("skips an opacity-0 element and returns null (isVisible called on the resolved node)", () => {
    const parent = fakeEl({ "data-hf-id": "hf-parent" }, "div");
    const child = fakeEl({}, "span", parent);
    const isVisible = vi.fn((el: Element) => {
      const fe = el as unknown as FakeEl;
      return fe.attrs["data-hf-id"] !== "hf-parent";
    });
    expect(resolveNearestHfElement(child as unknown as Element, isVisible)).toBeNull();
    expect(isVisible).toHaveBeenCalledTimes(1);
  });

  it("returns null when no data-hf-id found in any ancestor", () => {
    const grandparent = fakeEl({}, "body");
    const parent = fakeEl({}, "div", grandparent);
    const child = fakeEl({}, "span", parent);
    expect(resolveNearestHfElement(child as unknown as Element, visible)).toBeNull();
  });

  it("tag is lowercased", () => {
    const el = fakeEl({ "data-hf-id": "hf-xyz" }, "DIV");
    const result = resolveNearestHfElement(el as unknown as Element, visible);
    expect(result?.tag).toBe("div");
  });

  it("stops at the nearest ancestor — does not continue past first data-hf-id", () => {
    const outer = fakeEl({ "data-hf-id": "hf-outer" }, "section");
    const inner = fakeEl({ "data-hf-id": "hf-inner" }, "div", outer);
    const child = fakeEl({}, "span", inner);
    const result = resolveNearestHfElement(child as unknown as Element, visible);
    expect(result?.id).toBe("hf-inner");
  });
});

// ─── computeDraftPosition ─────────────────────────────────────────────────────

describe("computeDraftPosition", () => {
  it("applies delta to base data-x/data-y", () => {
    expect(computeDraftPosition("100", "200", 30, -10)).toEqual({ x: 130, y: 190 });
  });

  it("defaults missing data-x/data-y to 0", () => {
    expect(computeDraftPosition(null, null, 50, 25)).toEqual({ x: 50, y: 25 });
  });

  it("defaults non-numeric data-x/data-y to 0", () => {
    expect(computeDraftPosition("abc", "xyz", 10, 5)).toEqual({ x: 10, y: 5 });
  });

  it("works with zero delta (no-move commit)", () => {
    expect(computeDraftPosition("40", "80", 0, 0)).toEqual({ x: 40, y: 80 });
  });

  it("handles negative base positions", () => {
    expect(computeDraftPosition("-20", "0", 5, 10)).toEqual({ x: -15, y: 10 });
  });
});

// ─── IframePreviewAdapter selection ──────────────────────────────────────────

function stubIframe() {
  return {} as HTMLIFrameElement;
}

describe("IframePreviewAdapter selection", () => {
  it("on('selection') fires when select() is called", () => {
    const adapter = createIframePreviewAdapter(stubIframe());
    const cb = vi.fn();
    adapter.on("selection", cb);
    adapter.select(["hf-abc"]);
    expect(cb).toHaveBeenCalledWith(["hf-abc"]);
  });

  it("off unsubscribes the handler", () => {
    const adapter = createIframePreviewAdapter(stubIframe());
    const cb = vi.fn();
    const off = adapter.on("selection", cb);
    off();
    adapter.select(["hf-abc"]);
    expect(cb).not.toHaveBeenCalled();
  });

  it("additive select merges with prior selection", () => {
    const adapter = createIframePreviewAdapter(stubIframe());
    const cb = vi.fn();
    adapter.on("selection", cb);
    adapter.select(["hf-a"]);
    adapter.select(["hf-b"], { additive: true });
    expect(cb).toHaveBeenLastCalledWith(expect.arrayContaining(["hf-a", "hf-b"]));
  });

  it("non-additive select replaces prior selection", () => {
    const adapter = createIframePreviewAdapter(stubIframe());
    const cb = vi.fn();
    adapter.on("selection", cb);
    adapter.select(["hf-a"]);
    adapter.select(["hf-b"]);
    expect(cb).toHaveBeenLastCalledWith(["hf-b"]);
  });

  it("multiple handlers all fire", () => {
    const adapter = createIframePreviewAdapter(stubIframe());
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    adapter.on("selection", cb1);
    adapter.on("selection", cb2);
    adapter.select(["hf-abc"]);
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });
});

// ─── applyDraft / commitPreview / cancelPreview ───────────────────────────────
// Tests use a fake iframe+element because HTMLElement.style requires a browser.

interface FakeStyle {
  _props: Record<string, string>;
  setProperty(name: string, value: string): void;
  getPropertyValue(name: string): string;
  removeProperty(name: string): void;
}

interface FakeDomEl {
  _attrs: Record<string, string>;
  style: FakeStyle;
  isConnected: boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  querySelector(sel: string): FakeDomEl | null;
}

function fakeDomEl(id: string, dataX: string | null, dataY: string | null): FakeDomEl {
  const style: FakeStyle = {
    _props: {},
    setProperty(name, value) {
      this._props[name] = value;
    },
    getPropertyValue(name) {
      return this._props[name] ?? "";
    },
    removeProperty(name) {
      delete this._props[name];
    },
  };
  const attrs: Record<string, string> = { "data-hf-id": id };
  if (dataX !== null) attrs["data-x"] = dataX;
  if (dataY !== null) attrs["data-y"] = dataY;
  const el: FakeDomEl = {
    _attrs: attrs,
    style,
    isConnected: true,
    getAttribute(name) {
      return this._attrs[name] ?? null;
    },
    setAttribute(name, value) {
      this._attrs[name] = value;
    },
    hasAttribute(name) {
      return name in this._attrs;
    },
    querySelector(_sel: string) {
      return null;
    },
  };
  return el;
}

function fakeIframe(el: FakeDomEl | null): HTMLIFrameElement {
  return {
    contentDocument: {
      querySelector(_sel: string) {
        return el;
      },
    },
  } as unknown as HTMLIFrameElement;
}

describe("IframePreviewAdapter draft / commit / cancel", () => {
  it("commitPreview without applyDraft is a no-op", () => {
    const dispatch = vi.fn();
    const adapter = createIframePreviewAdapter(stubIframe(), dispatch);
    adapter.commitPreview();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("cancelPreview without applyDraft is a no-op", () => {
    const dispatch = vi.fn();
    const adapter = createIframePreviewAdapter(stubIframe(), dispatch);
    adapter.cancelPreview();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("commitPreview dispatches moveElement with correct absolute position", () => {
    const dispatch = vi.fn();
    const el = fakeDomEl("hf-abc", "100", "200");
    const adapter = createIframePreviewAdapter(fakeIframe(el), dispatch);

    adapter.applyDraft("hf-abc", { dx: 30, dy: -20 });
    adapter.commitPreview();

    expect(dispatch).toHaveBeenCalledWith<[EditOp]>({
      type: "moveElement",
      target: "hf-abc",
      x: 130,
      y: 180,
    });
  });

  it("commitPreview with missing data-x/data-y defaults base to 0", () => {
    const dispatch = vi.fn();
    const el = fakeDomEl("hf-abc", null, null);
    const adapter = createIframePreviewAdapter(fakeIframe(el), dispatch);

    adapter.applyDraft("hf-abc", { dx: 50, dy: 25 });
    adapter.commitPreview();

    expect(dispatch).toHaveBeenCalledWith<[EditOp]>({
      type: "moveElement",
      target: "hf-abc",
      x: 50,
      y: 25,
    });
  });

  it("commitPreview mirrors the move onto the live element and applies the translate", () => {
    const el = fakeDomEl("hf-abc", "100", "200");
    const adapter = createIframePreviewAdapter(fakeIframe(el), vi.fn());

    adapter.applyDraft("hf-abc", { dx: 30, dy: -20 });
    adapter.commitPreview();

    expect(el.getAttribute("data-x")).toBe("130");
    expect(el.getAttribute("data-y")).toBe("180");
    // Baseline captured from the pre-drag values.
    expect(el.getAttribute("data-hf-edit-base-x")).toBe("100");
    expect(el.getAttribute("data-hf-edit-base-y")).toBe("200");
    // Final translate = delta from the baseline, held without a reload.
    expect(el.getAttribute("data-hf-edit-original-translate")).toBe("");
    expect(el.style.getPropertyValue("translate")).toBe("30px -20px");

    // A second drag composes from the committed state and keeps the baseline.
    adapter.applyDraft("hf-abc", { dx: 10, dy: 10 });
    expect(el.style.getPropertyValue("translate")).toBe("40px -10px");
    adapter.commitPreview();
    expect(el.getAttribute("data-x")).toBe("140");
    expect(el.getAttribute("data-hf-edit-base-x")).toBe("100");
    expect(el.style.getPropertyValue("translate")).toBe("40px -10px");
  });

  it("applyDraft translates the element live and cancelPreview restores it", () => {
    const el = fakeDomEl("hf-abc", "0", "0");
    el.style.setProperty("translate", "5px 6px");
    const adapter = createIframePreviewAdapter(fakeIframe(el), vi.fn());

    adapter.applyDraft("hf-abc", { dx: 30, dy: -20 });
    expect(el.style.getPropertyValue("translate")).toBe("35px -14px");

    adapter.cancelPreview();
    expect(el.style.getPropertyValue("translate")).toBe("5px 6px");
    expect(el.getAttribute("data-hf-edit-base-x")).toBeNull();
  });

  it("cancelPreview removes a draft translate when there was none before", () => {
    const el = fakeDomEl("hf-abc", "0", "0");
    const adapter = createIframePreviewAdapter(fakeIframe(el), vi.fn());

    adapter.applyDraft("hf-abc", { dx: 30 });
    expect(el.style.getPropertyValue("translate")).toBe("30px 0px");

    adapter.cancelPreview();
    expect(el.style.getPropertyValue("translate")).toBe("");
  });

  it("applyDraft reuses the cached element across repeated calls (no re-query)", () => {
    const el = fakeDomEl("hf-abc", "0", "0");
    let queryCount = 0;
    const iframe = {
      contentDocument: {
        querySelector(_sel: string) {
          queryCount++;
          return el;
        },
      },
    } as unknown as HTMLIFrameElement;
    const adapter = createIframePreviewAdapter(iframe);
    adapter.applyDraft("hf-abc", { dx: 1, dy: 1 });
    adapter.applyDraft("hf-abc", { dx: 2, dy: 2 });
    adapter.applyDraft("hf-abc", { dx: 3, dy: 3 });
    // Queried once on the first call; the next two reuse the connected cache.
    expect(queryCount).toBe(1);
  });

  it("commitPreview without a dispatch callback is a no-op", () => {
    const el = fakeDomEl("hf-abc", "0", "0");
    const adapter = createIframePreviewAdapter(fakeIframe(el));

    adapter.applyDraft("hf-abc", { dx: 10, dy: 10 });
    // should not throw
    adapter.commitPreview();
  });

  it("cancelPreview reverts the draft translate without dispatching", () => {
    const dispatch = vi.fn();
    const el = fakeDomEl("hf-abc", "100", "200");
    const adapter = createIframePreviewAdapter(fakeIframe(el), dispatch);

    adapter.applyDraft("hf-abc", { dx: 30, dy: 20 });
    expect(el.style.getPropertyValue("translate")).toBe("30px 20px");
    adapter.cancelPreview();

    expect(dispatch).not.toHaveBeenCalled();
    expect(el.style.getPropertyValue("translate")).toBe("");
  });

  it("second commitPreview after first is a no-op (draft cleared)", () => {
    const dispatch = vi.fn();
    const el = fakeDomEl("hf-abc", "0", "0");
    const adapter = createIframePreviewAdapter(fakeIframe(el), dispatch);

    adapter.applyDraft("hf-abc", { dx: 10, dy: 5 });
    adapter.commitPreview();
    adapter.commitPreview();

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("switching applyDraft to a new id reverts the abandoned element", () => {
    const elA = fakeDomEl("hf-a", "0", "0");
    const elB = fakeDomEl("hf-b", "0", "0");
    const iframe = {
      contentDocument: {
        querySelector(sel: string) {
          return sel.includes("hf-a") ? elA : elB;
        },
      },
    } as unknown as HTMLIFrameElement;
    const adapter = createIframePreviewAdapter(iframe, vi.fn());

    adapter.applyDraft("hf-a", { dx: 80, dy: 0 });
    expect(elA.style.getPropertyValue("translate")).toBe("80px 0px");

    adapter.applyDraft("hf-b", { dx: 10, dy: 10 });
    // The abandoned element is restored; the delta does not carry over.
    expect(elA.style.getPropertyValue("translate")).toBe("");
    expect(elB.style.getPropertyValue("translate")).toBe("10px 10px");
  });

  it("commitPreview reverts the draft translate when dispatch throws", () => {
    const el = fakeDomEl("hf-abc", "0", "0");
    el.style.setProperty("translate", "5px 6px");
    const dispatch = vi.fn(() => {
      throw new Error("element_not_found");
    });
    const adapter = createIframePreviewAdapter(fakeIframe(el), dispatch);

    adapter.applyDraft("hf-abc", { dx: 30, dy: 20 });
    expect(() => adapter.commitPreview()).toThrow("element_not_found");
    expect(el.style.getPropertyValue("translate")).toBe("5px 6px");
    expect(el.getAttribute("data-hf-edit-base-x")).toBeNull();
  });

  it("cancelPreview does not promote a computed (stylesheet) translate to inline", () => {
    const el = fakeDomEl("hf-abc", "0", "0");
    // Simulate a stylesheet-authored translate visible only via computed style.
    (el as unknown as { ownerDocument: unknown }).ownerDocument = {
      defaultView: {
        getComputedStyle: () => ({ getPropertyValue: () => "-50% -50%" }),
      },
    };
    const adapter = createIframePreviewAdapter(fakeIframe(el), vi.fn());

    adapter.applyDraft("hf-abc", { dx: 30, dy: 20 });
    // Draft composes onto the computed baseline (calc for non-px units).
    expect(el.style.getPropertyValue("translate")).toBe("calc(-50% + 30px) calc(-50% + 20px)");

    adapter.cancelPreview();
    // Inline translate removed — the stylesheet value stays authoritative.
    expect(el.style.getPropertyValue("translate")).toBe("");
  });
});

// ─── WS-G: alphaIsOpaque ──────────────────────────────────────────────────────

describe("alphaIsOpaque", () => {
  function makeImageData(alpha: number): ImageData {
    const data = new Uint8ClampedArray([255, 0, 0, alpha]);
    return { data, width: 1, height: 1, colorSpace: "srgb" } as unknown as ImageData;
  }

  it("returns false for a fully transparent pixel (a=0)", () => {
    expect(alphaIsOpaque(makeImageData(0))).toBe(false);
  });

  it("returns true for a fully opaque pixel (a=255)", () => {
    expect(alphaIsOpaque(makeImageData(255))).toBe(true);
  });

  it("returns true for alpha at default threshold (a=1 >= 1)", () => {
    expect(alphaIsOpaque(makeImageData(1), 1)).toBe(true);
  });

  it("respects a custom threshold: a=100 < threshold=128 → false", () => {
    expect(alphaIsOpaque(makeImageData(100), 128)).toBe(false);
  });

  it("respects a custom threshold: a=200 >= threshold=128 → true", () => {
    expect(alphaIsOpaque(makeImageData(200), 128)).toBe(true);
  });

  it("threshold edge: a === threshold → true", () => {
    expect(alphaIsOpaque(makeImageData(64), 64)).toBe(true);
  });
});

// ─── WS-G: mapPointToImagePixel ───────────────────────────────────────────────

describe("mapPointToImagePixel", () => {
  // A 200×100 CSS box displaying a 400×200 natural image.
  const rect = { left: 10, top: 20, width: 200, height: 100 };
  const natural = { width: 400, height: 200 };

  it("fill: maps center of box to center of natural image", () => {
    const result = mapPointToImagePixel(rect, natural, "fill", "50% 50%", {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    expect(result).toEqual({ px: 200, py: 100 });
  });

  it("fill: maps top-left corner to natural (0, 0)", () => {
    const result = mapPointToImagePixel(rect, natural, "fill", "50% 50%", {
      x: rect.left,
      y: rect.top,
    });
    expect(result).toEqual({ px: 0, py: 0 });
  });

  it("fill: maps bottom-right corner to natural (399, 199)", () => {
    const result = mapPointToImagePixel(rect, natural, "fill", "50% 50%", {
      x: rect.left + rect.width,
      y: rect.top + rect.height,
    });
    // rect.width maps to naturalWidth → px = floor(200/200 * 400) = 400, clamped to 399
    expect(result).toEqual({ px: 399, py: 199 });
  });

  it("returns null when point is outside the CSS box (left)", () => {
    const result = mapPointToImagePixel(rect, natural, "fill", "50% 50%", {
      x: rect.left - 1,
      y: rect.top + 10,
    });
    expect(result).toBeNull();
  });

  it("returns null when point is outside the CSS box (above)", () => {
    const result = mapPointToImagePixel(rect, natural, "fill", "50% 50%", {
      x: rect.left + 10,
      y: rect.top - 1,
    });
    expect(result).toBeNull();
  });

  describe("cover", () => {
    // 200×100 box, 100×100 natural → scale = max(2, 1) = 2 (cover clips Y;
    // the 200×200 rendered image overflows top/bottom — cover never letterboxes)
    // rendered: 200×200; centered by default (50% 50%)
    // imgTop = (100 - 200)/2 = -50; imgLeft = (200-200)/2 = 0
    const coverRect = { left: 0, top: 0, width: 200, height: 100 };
    const coverNatural = { width: 100, height: 100 };

    it("cover: point in center maps to center of natural image", () => {
      // x=100, y=50 → rx=100-0=100, ry=50-(-50)=100; px=100/2=50, py=100/2=50
      const result = mapPointToImagePixel(coverRect, coverNatural, "cover", "50% 50%", {
        x: 100,
        y: 50,
      });
      expect(result).toEqual({ px: 50, py: 50 });
    });
  });

  describe("contain", () => {
    // 200×100 box, 400×100 natural → scale = min(0.5, 1) = 0.5
    // rendered: 200×50; centered by default
    // imgLeft = (200-200)/2 = 0; imgTop = (100-50)/2 = 25
    const containRect = { left: 0, top: 0, width: 200, height: 100 };
    const containNatural = { width: 400, height: 100 };

    it("contain: point in rendered area maps to natural pixel", () => {
      // y=50 → ry = 50-25 = 25; py = 25/0.5 = 50
      // x=100 → rx = 100-0 = 100; px = 100/0.5 = 200
      const result = mapPointToImagePixel(containRect, containNatural, "contain", "50% 50%", {
        x: 100,
        y: 50,
      });
      expect(result).toEqual({ px: 200, py: 50 });
    });

    it("contain: point in letterbox region (above image) → null", () => {
      // imgTop = 25; y=10 → ry=10-25 = -15 → null
      const result = mapPointToImagePixel(containRect, containNatural, "contain", "50% 50%", {
        x: 100,
        y: 10,
      });
      expect(result).toBeNull();
    });

    it("contain: point in letterbox region (below image) → null", () => {
      // imgTop = 25; rendered height = 50 → imgBottom = 75; y=80 > 75 → null
      const result = mapPointToImagePixel(containRect, containNatural, "contain", "50% 50%", {
        x: 100,
        y: 80,
      });
      expect(result).toBeNull();
    });
  });

  it("out-of-box point returns null regardless of object-fit", () => {
    const r = { left: 50, top: 50, width: 100, height: 100 };
    const n = { width: 200, height: 200 };
    // Point to the left of the CSS box
    expect(mapPointToImagePixel(r, n, "cover", "50% 50%", { x: 49, y: 100 })).toBeNull();
  });

  describe("none", () => {
    // object-fit:none draws the image at natural size, positioned in the box.
    // box 100×100, natural 50×50, "50% 50%" → availX=availY=50, offset=25.
    const r = { left: 0, top: 0, width: 100, height: 100 };
    const n = { width: 50, height: 50 };

    it("none: box center maps to image center", () => {
      // click (50,50): px=floor(50-25)=25, py=25
      expect(mapPointToImagePixel(r, n, "none", "50% 50%", { x: 50, y: 50 })).toEqual({
        px: 25,
        py: 25,
      });
    });

    it("none: point inside the box but outside the natural-size image → null", () => {
      // image occupies 25..75; click at (10,10) is left/above it
      expect(mapPointToImagePixel(r, n, "none", "50% 50%", { x: 10, y: 10 })).toBeNull();
    });
  });

  describe("object-position", () => {
    // contain so object-position has an effect on the vertical axis.
    // box 200×100, natural 400×100 → scale 0.5, rendered 200×50; availX=0, availY=50.
    const r = { left: 0, top: 0, width: 200, height: 100 };
    const n = { width: 400, height: 100 };

    it("'left top' aligns the image to the top of the box", () => {
      expect(mapPointToImagePixel(r, n, "contain", "left top", { x: 0, y: 0 })).toEqual({
        px: 0,
        py: 0,
      });
    });

    it("reversed keyword pair 'top left' resolves identically to 'left top'", () => {
      const reversed = mapPointToImagePixel(r, n, "contain", "top left", { x: 0, y: 0 });
      const canonical = mapPointToImagePixel(r, n, "contain", "left top", { x: 0, y: 0 });
      expect(reversed).toEqual(canonical);
      expect(reversed).toEqual({ px: 0, py: 0 });
    });

    it("'bottom left' (vertical-first) and 'left bottom' both align bottom-left", () => {
      // bottom → imgTop=availY=50; bottom edge click y=100 → ry=50 → py=floor(50/0.5)=100→clamp 99
      const vh = mapPointToImagePixel(r, n, "contain", "bottom left", { x: 0, y: 100 });
      const hv = mapPointToImagePixel(r, n, "contain", "left bottom", { x: 0, y: 100 });
      expect(vh).toEqual(hv);
      expect(vh).toEqual({ px: 0, py: 99 });
    });

    it("supports pixel object-position values", () => {
      // "0px 10px" → imgTop=10; click (0,10) → ry=0 → py=0
      expect(mapPointToImagePixel(r, n, "contain", "0px 10px", { x: 0, y: 10 })).toEqual({
        px: 0,
        py: 0,
      });
    });
  });

  it("cover/contain returns null for a zero-dimension natural image", () => {
    const r = { left: 0, top: 0, width: 200, height: 100 };
    expect(
      mapPointToImagePixel(r, { width: 0, height: 100 }, "cover", "50% 50%", { x: 10, y: 10 }),
    ).toBeNull();
  });
});

// ─── WS-G: z-stack fallthrough (mock elementsFromPoint) ──────────────────────

/**
 * WS-G z-stack tests.
 *
 * The adapter's elementAtPoint uses elementsFromPoint (z-stack) and checks
 * `candidate instanceof win.HTMLImageElement`. Since happy-dom / the Bun test
 * runner doesn't expose a global HTMLImageElement, we supply a local stub
 * class and wire it into the fake contentWindow so the instanceof check works.
 *
 * Canvas pixel reads (getImageData) are unavailable in the test environment, so
 * we patch globalThis.OffscreenCanvas to control alpha values:
 *   - opaque:      getImageData → alpha=255
 *   - transparent: getImageData → alpha=0
 *   - tainted:     getImageData → throws SecurityError
 */

// ─── Stub HTMLImageElement (no global in Node/Bun) ───────────────────────────

class FakeHTMLImageElement {
  attrs: Record<string, string>;
  tagName: string;
  parentElement: FakeHTMLImageElement | null;
  /** A clear pixel falls through to the style/own-text checks, which read this. */
  childNodes: Array<{ nodeType: number; textContent: string }> = [];
  naturalWidth: number;
  naturalHeight: number;
  currentSrc: string;
  src: string;

  constructor(id: string, parent: FakeHTMLImageElement | null = null) {
    this.attrs = { "data-hf-id": id };
    this.tagName = "IMG";
    this.parentElement = parent;
    this.naturalWidth = 100;
    this.naturalHeight = 100;
    this.currentSrc = `http://example.com/img-${id}.png`;
    this.src = `http://example.com/img-${id}.png`;
  }

  getBoundingClientRect(): DOMRect {
    return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 } as DOMRect;
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  hasAttribute(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.attrs, name);
  }
}

// WS-G tests reuse the existing FakeEl / fakeEl helper from above.
// buildFakeIframeWithStack accepts FakeEl or FakeHTMLImageElement.

function buildFakeIframeWithStack(stack: Array<FakeEl | FakeHTMLImageElement>) {
  return {
    contentDocument: {
      elementsFromPoint(_x: number, _y: number) {
        return stack;
      },
    },
    contentWindow: {
      // Supply our stub class so `candidate instanceof win.HTMLImageElement` works
      HTMLImageElement: FakeHTMLImageElement,
      getComputedStyle(_el: Element) {
        return { opacity: "1" } as CSSStyleDeclaration;
      },
    },
  } as unknown as HTMLIFrameElement;
}

// ─── OffscreenCanvas stub helpers ────────────────────────────────────────────

type CanvasAlphaBehavior = "opaque" | "transparent" | "tainted";

function stubOffscreenCanvas(behavior: CanvasAlphaBehavior): () => void {
  const orig = globalThis.OffscreenCanvas as typeof OffscreenCanvas | undefined;
  globalThis.OffscreenCanvas = class {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext(_type: string) {
      return {
        drawImage() {},
        getImageData() {
          if (behavior === "tainted") {
            throw new DOMException("Tainted canvases may not be exported.", "SecurityError");
          }
          const alpha = behavior === "opaque" ? 255 : 0;
          return { data: new Uint8ClampedArray([255, 0, 0, alpha]), width: 1, height: 1 };
        },
      };
    }
  } as unknown as typeof OffscreenCanvas;
  return () => {
    if (orig === undefined) {
      delete (globalThis as Record<string, unknown>).OffscreenCanvas;
    } else {
      globalThis.OffscreenCanvas = orig;
    }
  };
}

/**
 * Run a z-stack image-alpha test with a controlled canvas behavior.
 * Abstracts the restore/try/finally boilerplate shared across multiple tests.
 */
function withCanvasStub(
  behavior: CanvasAlphaBehavior,
  fn: (
    makeImgStack: (
      imgId: string,
      behind?: Array<FakeEl | FakeHTMLImageElement>,
    ) => HTMLIFrameElement,
  ) => void,
): void {
  const restore = stubOffscreenCanvas(behavior);
  try {
    fn((imgId, behind = []) => {
      const img = new FakeHTMLImageElement(imgId);
      return buildFakeIframeWithStack([img, ...behind]);
    });
  } finally {
    restore();
  }
}

describe("WS-G: z-stack fallthrough via mock elementsFromPoint", () => {
  // Clear the module-level canvas cache before each test so stubs from a
  // previous test don't affect the next one.
  beforeEach(() => {
    _imgCanvasCache.clear();
  });

  it("non-image hit resolves normally (WS-A1 regression)", () => {
    // No images in the stack — should behave exactly like WS-A1.
    const div = fakeEl({ "data-hf-id": "hf-div" }, "DIV");
    const iframe = buildFakeIframeWithStack([div]);
    const adapter = createIframePreviewAdapter(iframe);
    const result = adapter.elementAtPoint(50, 50);
    expect(result).toEqual({ id: "hf-div", tag: "div" });
  });

  it("opaque image hit resolves to the image element", () => {
    withCanvasStub("opaque", (makeImgStack) => {
      const iframe = makeImgStack("hf-img", [fakeEl({ "data-hf-id": "hf-behind" }, "DIV")]);
      const result = createIframePreviewAdapter(iframe).elementAtPoint(50, 50);
      expect(result).toEqual({ id: "hf-img", tag: "img" });
    });
  });

  it("transparent image pixel falls through to the element behind", () => {
    withCanvasStub("transparent", (makeImgStack) => {
      const iframe = makeImgStack("hf-img", [fakeEl({ "data-hf-id": "hf-behind" }, "DIV")]);
      const result = createIframePreviewAdapter(iframe).elementAtPoint(50, 50);
      expect(result).toEqual({ id: "hf-behind", tag: "div" });
    });
  });

  it("tainted canvas (SecurityError) falls back to treating pixel as opaque", () => {
    // Taint fallback → opaque → hit the image, not the behind-layer element
    withCanvasStub("tainted", (makeImgStack) => {
      const iframe = makeImgStack("hf-tainted", [fakeEl({ "data-hf-id": "hf-behind" }, "DIV")]);
      const result = createIframePreviewAdapter(iframe).elementAtPoint(50, 50);
      expect(result).toEqual({ id: "hf-tainted", tag: "img" });
    });
  });

  it("transparent image over transparent image falls through to the div behind both", () => {
    // Two consecutive transparent fallthroughs — exercises the loop iterating
    // past more than one transparent image before hitting an opaque layer.
    withCanvasStub("transparent", (makeImgStack) => {
      const img2 = new FakeHTMLImageElement("hf-img2");
      const iframe = makeImgStack("hf-img1", [img2, fakeEl({ "data-hf-id": "hf-behind" }, "DIV")]);
      const result = createIframePreviewAdapter(iframe).elementAtPoint(50, 50);
      expect(result).toEqual({ id: "hf-behind", tag: "div" });
    });
  });

  it("transparent image with no element behind returns null", () => {
    // No behind element in stack — transparent hit returns null.
    withCanvasStub("transparent", (makeImgStack) => {
      const iframe = makeImgStack("hf-img");
      const result = createIframePreviewAdapter(iframe).elementAtPoint(50, 50);
      expect(result).toBeNull();
    });
  });

  it("survives a window without HTMLImageElement and a doc without elementsFromPoint", () => {
    const div = fakeEl({ "data-hf-id": "hf-div" }, "DIV");
    const fakeIframe = (doc: unknown, win: unknown) =>
      ({ contentDocument: doc, contentWindow: win }) as unknown as HTMLIFrameElement;
    const expected = { id: "hf-div", tag: "div" };

    // No HTMLImageElement on the window — `instanceof` must not throw.
    const noCtor = fakeIframe(
      { elementsFromPoint: () => [div] },
      { getComputedStyle: () => ({ opacity: "1" }) },
    );
    expect(createIframePreviewAdapter(noCtor).elementAtPoint(50, 50)).toEqual(expected);

    // No elementsFromPoint on the doc — fall back to elementFromPoint.
    const noStack = fakeIframe(
      { elementFromPoint: () => div },
      { HTMLImageElement: FakeHTMLImageElement, getComputedStyle: () => ({ opacity: "1" }) },
    );
    expect(createIframePreviewAdapter(noStack).elementAtPoint(50, 50)).toEqual(expected);
  });
});

// ─── Paint query: elementPaintsInk / compositionPaintsAt / isProvablyEmptyAt ───

/**
 * The paint query decides whether a host layering a transparent composition over
 * other content swallows a click or lets it through, so both directions matter: a
 * false negative makes visible artwork unclickable, a false positive makes the
 * composition opaque to interaction again.
 *
 * These need richer fakes than the resolver tests above — boxes, computed style and
 * a document to walk — because the walk is geometric rather than a z-stack.
 */

interface PaintRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PAINT_DEFAULT_STYLE: Record<string, string> = {
  display: "block",
  visibility: "visible",
  opacity: "1",
  backgroundColor: "rgba(0, 0, 0, 0)",
  backgroundImage: "none",
};

const paintStyles = new WeakMap<object, Record<string, string>>();

function domRect(r: PaintRect): DOMRect {
  return {
    ...r,
    right: r.left + r.width,
    bottom: r.top + r.height,
  } as DOMRect;
}

interface PaintNode {
  tagName: string;
  attrs: Record<string, string>;
  parentElement: PaintNode | null;
  childNodes: Array<{ nodeType: number; textContent: string }>;
  children: PaintNode[];
  getBoundingClientRect(): DOMRect;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  querySelector(selector: string): PaintNode | null;
}

function pnode(init: {
  tag?: string;
  attrs?: Record<string, string>;
  style?: Record<string, string>;
  rect?: PaintRect;
  text?: string;
  parent?: PaintNode | null;
}): PaintNode {
  const rect = init.rect ?? { left: 0, top: 0, width: 100, height: 100 };
  const node: PaintNode = {
    tagName: (init.tag ?? "div").toUpperCase(),
    attrs: { "data-hf-id": `hf-${init.tag ?? "div"}`, ...init.attrs },
    parentElement: init.parent ?? null,
    childNodes: init.text === undefined ? [] : [{ nodeType: 3, textContent: init.text }],
    children: [],
    getBoundingClientRect: () => domRect(rect),
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name);
    },
    querySelector(selector) {
      return this.children.find((c) => c.tagName.toLowerCase() === selector) ?? null;
    },
  };
  if (init.style) paintStyles.set(node, init.style);
  init.parent?.children.push(node);
  return node;
}

/** An image node the walk can pick up: a FakeHTMLImageElement with a box and a parent. */
function pimg(
  id: string,
  rect: PaintRect,
  opts?: { parent?: PaintNode | null; src?: string; naturalWidth?: number },
): FakeHTMLImageElement {
  const img = new FakeHTMLImageElement(id);
  img.getBoundingClientRect = () => domRect(rect);
  img.parentElement = (opts?.parent ?? null) as unknown as FakeHTMLImageElement | null;
  if (opts?.src) {
    img.src = opts.src;
    img.currentSrc = opts.src;
  }
  if (opts?.naturalWidth !== undefined) img.naturalWidth = opts.naturalWidth;
  return img;
}

function paintWin(): Window & typeof globalThis {
  return {
    HTMLImageElement: FakeHTMLImageElement,
    getComputedStyle(el: object) {
      const merged = { ...PAINT_DEFAULT_STYLE, ...(paintStyles.get(el) ?? {}) };
      return {
        ...merged,
        getPropertyValue(name: string) {
          if (merged[name] !== undefined) return merged[name];
          return name.endsWith("-width") ? "0px" : "none";
        },
      } as unknown as CSSStyleDeclaration;
    },
  } as unknown as Window & typeof globalThis;
}

function paintDoc(nodes: object[], readyState = "complete"): Document {
  const matching = (selector: string) => {
    if (selector === "*") return nodes;
    const attr = selector.slice(1, -1);
    return nodes.filter((n) => (n as PaintNode).hasAttribute(attr));
  };
  return {
    readyState,
    querySelectorAll: matching,
    querySelector: (selector: string) => matching(selector)[0] ?? null,
  } as unknown as Document;
}

/** OffscreenCanvas stub that counts pixel reads, for the lazy-sampling guard. */
function stubCountingCanvas(): { restore: () => void; reads: () => number } {
  const orig = globalThis.OffscreenCanvas as typeof OffscreenCanvas | undefined;
  let reads = 0;
  globalThis.OffscreenCanvas = class {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext(_type: string) {
      return {
        drawImage() {},
        getImageData() {
          reads++;
          return { data: new Uint8ClampedArray([255, 0, 0, 255]), width: 1, height: 1 };
        },
      };
    }
  } as unknown as typeof OffscreenCanvas;
  return {
    restore: () => {
      if (orig === undefined) {
        delete (globalThis as Record<string, unknown>).OffscreenCanvas;
      } else {
        globalThis.OffscreenCanvas = orig;
      }
    },
    reads: () => reads,
  };
}

const el = (n: PaintNode) => n as unknown as Element;

describe("elementPaintsInk", () => {
  const win = paintWin();

  it("treats a bare layout wrapper as NOT painting", () => {
    // The common case, and the reason this exists: a composition is mostly full-bleed
    // wrappers with no visual presence, and every one covers what sits beneath.
    expect(elementPaintsInk(el(pnode({})), win)).toBe(false);
  });

  it("counts a background colour, but not a transparent one", () => {
    expect(elementPaintsInk(el(pnode({ style: { backgroundColor: "#ff0000" } })), win)).toBe(true);
    expect(elementPaintsInk(el(pnode({ style: { backgroundColor: "rgba(0,0,0,0)" } })), win)).toBe(
      false,
    );
    expect(elementPaintsInk(el(pnode({ style: { backgroundColor: "transparent" } })), win)).toBe(
      false,
    );
  });

  it("reads the alpha, so a NON-BLACK zero-alpha colour is still no ink", () => {
    // Only the `transparent` keyword computes to rgba(0,0,0,0); a faded-out white stays
    // rgba(255, 255, 255, 0), which a set of known spellings counts as painted.
    for (const color of [
      "rgba(255, 255, 255, 0)",
      "rgba(12, 34, 56, 0.0)",
      "rgb(255 255 255 / 0)",
      "hsla(0, 0%, 0%, 0)",
      "hsl(120 50% 50% / 0)",
    ]) {
      expect(elementPaintsInk(el(pnode({ style: { backgroundColor: color } })), win), color).toBe(
        false,
      );
    }
    // A non-zero alpha still paints, however faint.
    expect(
      elementPaintsInk(el(pnode({ style: { backgroundColor: "rgba(255, 255, 255, 0.01)" } })), win),
    ).toBe(true);
    // rgb() with no alpha component is opaque.
    expect(elementPaintsInk(el(pnode({ style: { backgroundColor: "rgb(1, 2, 3)" } })), win)).toBe(
      true,
    );
  });

  it("counts a background image", () => {
    expect(elementPaintsInk(el(pnode({ style: { backgroundImage: "url(a.png)" } })), win)).toBe(
      true,
    );
  });

  it("counts a visible border but not a zero-width or `none` one", () => {
    const bordered = pnode({
      style: { "border-top-style": "solid", "border-top-width": "2px" },
    });
    expect(elementPaintsInk(el(bordered), win)).toBe(true);

    const zeroWidth = pnode({
      style: { "border-top-style": "solid", "border-top-width": "0px" },
    });
    expect(elementPaintsInk(el(zeroWidth), win)).toBe(false);

    const styleNone = pnode({
      style: { "border-top-style": "none", "border-top-width": "2px" },
    });
    expect(elementPaintsInk(el(styleNone), win)).toBe(false);
  });

  it("counts intrinsic media regardless of styling", () => {
    for (const tag of ["video", "canvas", "svg"]) {
      expect(elementPaintsInk(el(pnode({ tag })), win), tag).toBe(true);
    }
  });

  it("counts an element's OWN text, not text belonging to a descendant", () => {
    expect(elementPaintsInk(el(pnode({ tag: "span", text: "Clean" })), win)).toBe(true);

    // Without the own-text rule every ancestor of a caption would count as painting,
    // and the whole frame would read as covered.
    const wrapper = pnode({});
    pnode({ tag: "span", text: "Clean", parent: wrapper });
    expect(elementPaintsInk(el(wrapper), win)).toBe(false);

    expect(elementPaintsInk(el(pnode({ text: "   \n  " })), win)).toBe(false);
  });
});

describe("elementPaintsInk: <img> routes through the alpha sampler", () => {
  beforeEach(() => {
    _imgCanvasCache.clear();
  });

  const rect = { left: 0, top: 0, width: 100, height: 100 };

  /** Ink at the centre of a 100×100 image, under a controlled canvas behaviour. */
  function inkAtCentre(
    behavior: CanvasAlphaBehavior,
    build: () => Element = () => pimg("hf-img", rect) as unknown as Element,
  ): boolean {
    const restore = stubOffscreenCanvas(behavior);
    try {
      return elementPaintsInk(build(), paintWin(), { x: 50, y: 50 });
    } finally {
      restore();
    }
  }

  it("an opaque pixel paints", () => {
    expect(inkAtCentre("opaque")).toBe(true);
  });

  it("a transparent pixel does NOT paint — the whole point of the alpha path", () => {
    expect(inkAtCentre("transparent")).toBe(false);
  });

  it("a tainted canvas fails safe to painted", () => {
    expect(inkAtCentre("tainted")).toBe(true);
  });

  it("an unloaded image fails safe to painted", () => {
    expect(
      inkAtCentre(
        "transparent",
        () => pimg("hf-img", rect, { naturalWidth: 0 }) as unknown as Element,
      ),
    ).toBe(true);
  });

  it("falls back to the tag rule when no point is supplied", () => {
    // Point-free callers are asking "could this paint at all", which for an image is yes.
    expect(elementPaintsInk(pimg("hf-img", rect) as unknown as Element, paintWin())).toBe(true);
  });

  it("<picture> defers to the <img> it wraps rather than painting unconditionally", () => {
    const withInnerImg = () => {
      const picture = pnode({ tag: "picture" });
      picture.children.push(pimg("hf-inner", rect) as unknown as PaintNode);
      return el(picture);
    };
    expect(inkAtCentre("transparent", withInnerImg)).toBe(false);
  });

  it("a clear pixel still paints when the image itself has background or border ink", () => {
    // object-fit letterbox over a white plate: the bitmap misses, the chip is still visible.
    const restore = stubOffscreenCanvas("transparent");
    try {
      const img = pimg("hf-chip", rect);
      paintStyles.set(img, { backgroundColor: "#fff" });
      expect(elementPaintsInk(img as unknown as Element, paintWin(), { x: 50, y: 50 })).toBe(true);
    } finally {
      restore();
    }
  });

  it("<picture> with no inner <img> still paints", () => {
    expect(elementPaintsInk(el(pnode({ tag: "picture" })), paintWin(), { x: 1, y: 1 })).toBe(true);
  });
});

describe("compositionPaintsAt", () => {
  beforeEach(() => {
    _imgCanvasCache.clear();
  });

  const FRAME: PaintRect = { left: 0, top: 0, width: 1000, height: 1000 };
  const root = () => pnode({ attrs: { "data-composition-id": "main" }, rect: FRAME });

  it("an unpainted full-bleed wrapper does not mask a painted child", () => {
    const nodes = [
      root(),
      pnode({ rect: FRAME }),
      pnode({
        attrs: { "data-hf-id": "hf-sun" },
        style: { backgroundColor: "#ff0" },
        rect: { left: 100, top: 100, width: 180, height: 180 },
      }),
    ];
    const paints = compositionPaintsAt(paintDoc(nodes), paintWin(), 150, 150, {
      fullBleedFraction: 0.9,
    });
    expect(paints).toBe(true);
  });

  it("reports no ink where only an unpainted wrapper sits", () => {
    const nodes = [root(), pnode({ rect: FRAME })];
    expect(compositionPaintsAt(paintDoc(nodes), paintWin(), 500, 500)).toBe(false);
  });

  it("reports no ink outside every box", () => {
    const nodes = [
      root(),
      pnode({
        style: { backgroundColor: "#f00" },
        rect: { left: 0, top: 0, width: 10, height: 10 },
      }),
    ];
    expect(compositionPaintsAt(paintDoc(nodes), paintWin(), 500, 500)).toBe(false);
  });

  it("fullBleedFraction rejects a lone full-bleed painter; the default accepts it", () => {
    const nodes = [root(), pnode({ style: { backgroundColor: "rgba(0,0,0,0.3)" }, rect: FRAME })];
    // Host policy: an editor reads "you clicked a layer covering the whole frame" as
    // "you clicked the background".
    expect(
      compositionPaintsAt(paintDoc(nodes), paintWin(), 500, 500, { fullBleedFraction: 0.9 }),
    ).toBe(false);
    // The literal ink question: a full-frame scrim does put ink there.
    expect(compositionPaintsAt(paintDoc(nodes), paintWin(), 500, 500)).toBe(true);
  });

  it("measures full-bleed against the innermost root CONTAINING the point", () => {
    // A 300×300 painter really is full-bleed inside the 300×300 sub-composition it lives
    // in, even though it covers 9% of the outer frame.
    const nested: PaintRect = { left: 0, top: 0, width: 300, height: 300 };
    const nodes = [
      root(),
      pnode({ attrs: { "data-composition-id": "inner" }, rect: nested }),
      pnode({ style: { backgroundColor: "#f00" }, rect: nested }),
    ];
    expect(
      compositionPaintsAt(paintDoc(nodes), paintWin(), 150, 150, { fullBleedFraction: 0.9 }),
    ).toBe(false);
  });

  it("never vetoes a PIXEL-VERIFIED hit, however large the box", () => {
    // The flagship shape: a full-frame transparent PNG overlay. Its box IS the frame, so an
    // area-based veto called every opaque pixel "background" and the visible artwork became
    // unclickable. Box area is not ink area once the pixel has actually been read.
    const restore = stubOffscreenCanvas("opaque");
    try {
      const frame: PaintRect = { left: 0, top: 0, width: 1000, height: 1000 };
      const nodes = [root(), pimg("hf-overlay", frame)];
      expect(
        compositionPaintsAt(paintDoc(nodes), paintWin(), 500, 500, { fullBleedFraction: 0.9 }),
      ).toBe(true);
    } finally {
      restore();
    }
  });

  it("still vetoes a full-bleed image whose pixels could NOT be read", () => {
    // A tainted cross-origin image is a fail-safe "opaque", not a measurement. Exempting it
    // would make every full-frame CDN-backed overlay permanently absorb clicks.
    const restore = stubOffscreenCanvas("tainted");
    try {
      const frame: PaintRect = { left: 0, top: 0, width: 1000, height: 1000 };
      const nodes = [root(), pimg("hf-overlay", frame)];
      expect(
        compositionPaintsAt(paintDoc(nodes), paintWin(), 500, 500, { fullBleedFraction: 0.9 }),
      ).toBe(false);
    } finally {
      restore();
    }
  });

  it("counts ink painted by the composition root itself", () => {
    // A root carrying a background is painting, and at fraction 0 the literal ink question
    // has to say so. A non-zero fraction still discounts it: a root's box IS the frame.
    const painted = () =>
      pnode({
        attrs: { "data-composition-id": "main", "data-hf-id": "hf-root" },
        style: { backgroundColor: "#111" },
        rect: { left: 0, top: 0, width: 1000, height: 1000 },
      });
    expect(compositionPaintsAt(paintDoc([painted()]), paintWin(), 500, 500)).toBe(true);
    expect(
      compositionPaintsAt(paintDoc([painted()]), paintWin(), 500, 500, { fullBleedFraction: 0.9 }),
    ).toBe(false);
  });

  it("ignores a sub-composition the point is NOT inside when sizing the frame", () => {
    // Regression: taking the smallest root in the DOCUMENT let a badge in one corner set the
    // reference frame for the whole canvas, so mid-size artwork out in the 1000×1000 outer
    // frame measured against 300×300, read as full-bleed, and went click-through under
    // something the user can plainly see — the unsafe direction.
    const badge: PaintRect = { left: 0, top: 0, width: 300, height: 300 };
    const nodes = [
      root(),
      pnode({ attrs: { "data-composition-id": "badge" }, rect: badge }),
      pnode({
        style: { backgroundColor: "#f00" },
        rect: { left: 500, top: 500, width: 300, height: 300 },
      }),
    ];
    expect(
      compositionPaintsAt(paintDoc(nodes), paintWin(), 600, 600, { fullBleedFraction: 0.9 }),
    ).toBe(true);
  });

  it("disables the full-bleed rule when no root contains the point", () => {
    const nodes = [
      pnode({
        attrs: { "data-composition-id": "elsewhere" },
        rect: { left: 0, top: 0, width: 10, height: 10 },
      }),
      pnode({
        style: { backgroundColor: "#f00" },
        rect: { left: 400, top: 400, width: 200, height: 200 },
      }),
    ];
    expect(
      compositionPaintsAt(paintDoc(nodes), paintWin(), 500, 500, { fullBleedFraction: 0.9 }),
    ).toBe(true);
  });

  it("skips display:none, visibility:hidden and zero-area boxes", () => {
    const painted = { backgroundColor: "#f00" };
    const box = { left: 0, top: 0, width: 100, height: 100 };
    for (const style of [
      { ...painted, display: "none" },
      { ...painted, visibility: "hidden" },
    ]) {
      const nodes = [root(), pnode({ style, rect: box })];
      expect(compositionPaintsAt(paintDoc(nodes), paintWin(), 50, 50)).toBe(false);
    }
    const collapsed = [
      root(),
      pnode({ style: painted, rect: { left: 0, top: 0, width: 0, height: 0 } }),
    ];
    expect(compositionPaintsAt(paintDoc(collapsed), paintWin(), 0, 0)).toBe(false);
  });

  it("skips an element hidden by an ANCESTOR's opacity:0", () => {
    // getComputedStyle does not multiply the cascade, so a fully opaque child inside a
    // fade-in wrapper that has not started yet reads as painting unless the check walks up.
    const wrapper = pnode({
      style: { opacity: "0" },
      rect: { left: 0, top: 0, width: 200, height: 200 },
    });
    const child = pnode({
      attrs: { "data-hf-id": "hf-child" },
      style: { backgroundColor: "#f00" },
      rect: { left: 0, top: 0, width: 100, height: 100 },
      parent: wrapper,
    });
    expect(compositionPaintsAt(paintDoc([root(), wrapper, child]), paintWin(), 50, 50)).toBe(false);
  });

  it("addressableOnly:false picks up a node the stamping pass never saw", () => {
    // Runtime-generated nodes (split-text word spans, clones) carry no data-hf-id.
    const generated = pnode({
      tag: "span",
      attrs: {},
      text: "word",
      rect: { left: 0, top: 0, width: 50, height: 20 },
    });
    delete generated.attrs["data-hf-id"];
    const nodes = [root(), generated];
    expect(compositionPaintsAt(paintDoc(nodes), paintWin(), 10, 10)).toBe(false);
    expect(
      compositionPaintsAt(paintDoc(nodes), paintWin(), 10, 10, { addressableOnly: false }),
    ).toBe(true);
  });

  it("samples alpha lazily — the smallest painting box wins before the rest are read", () => {
    // Guards the per-frame cost: ink is evaluated down the ordered candidates, so a hit
    // on the most specific element must not have already paid for the ones behind it.
    const canvas = stubCountingCanvas();
    try {
      const nodes = [
        root(),
        pimg("hf-big", { left: 0, top: 0, width: 400, height: 400 }, { src: "http://x/big.png" }),
        pimg(
          "hf-small",
          { left: 0, top: 0, width: 100, height: 100 },
          { src: "http://x/small.png" },
        ),
      ];
      expect(compositionPaintsAt(paintDoc(nodes), paintWin(), 50, 50)).toBe(true);
      expect(canvas.reads()).toBe(1);
    } finally {
      canvas.restore();
    }
  });
});

describe("IframePreviewAdapter.isProvablyEmptyAt", () => {
  beforeEach(() => {
    _imgCanvasCache.clear();
  });

  const iframeWith = (doc: unknown, win: unknown) =>
    ({ contentDocument: doc, contentWindow: win }) as unknown as HTMLIFrameElement;

  it("is never provably empty when the document is not reachable", () => {
    // Unknowable is not empty: the composition stays clickable rather than vanishing.
    expect(createIframePreviewAdapter(iframeWith(null, paintWin())).isProvablyEmptyAt(1, 1)).toBe(
      false,
    );
    expect(createIframePreviewAdapter(iframeWith(paintDoc([]), null)).isProvablyEmptyAt(1, 1)).toBe(
      false,
    );
  });

  it("is never provably empty when contentDocument access throws (cross-origin)", () => {
    const hostile = {} as HTMLIFrameElement;
    Object.defineProperty(hostile, "contentDocument", {
      get() {
        throw new DOMException("Blocked a frame", "SecurityError");
      },
    });
    expect(createIframePreviewAdapter(hostile).isProvablyEmptyAt(1, 1)).toBe(false);
  });

  it("is never provably empty while the document is still loading", () => {
    // A same-origin iframe mid-navigation is READABLE and empty, so the !doc guard never
    // fires — walking it would answer a confident "no ink" under an arriving composition.
    const stamped = [pnode({ attrs: { "data-hf-id": "hf-a" } })];
    expect(
      createIframePreviewAdapter(
        iframeWith(paintDoc(stamped, "loading"), paintWin()),
      ).isProvablyEmptyAt(1, 1),
    ).toBe(false);
    // Loaded but carrying nothing of the composition — equally unknowable.
    expect(
      createIframePreviewAdapter(iframeWith(paintDoc([]), paintWin())).isProvablyEmptyAt(1, 1),
    ).toBe(false);
  });

  it("inverts the walk: empty where nothing paints, not empty over ink", () => {
    const nodes = [
      pnode({
        attrs: { "data-composition-id": "main" },
        rect: { left: 0, top: 0, width: 500, height: 500 },
      }),
      pnode({
        style: { backgroundColor: "#f00" },
        rect: { left: 0, top: 0, width: 100, height: 100 },
      }),
    ];
    const adapter = createIframePreviewAdapter(iframeWith(paintDoc(nodes), paintWin()));
    expect(adapter.isProvablyEmptyAt(50, 50)).toBe(false); // over the painted box
    expect(adapter.isProvablyEmptyAt(400, 400)).toBe(true); // empty region
  });
});
