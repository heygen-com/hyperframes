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
 */

import { describe, it, expect, vi } from "vitest";
import {
  resolveNearestHfElement,
  computeDraftPosition,
  createIframePreviewAdapter,
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
  "data-hf-id": string;
  "data-x": string | null;
  "data-y": string | null;
  style: FakeStyle;
  isConnected: boolean;
  getAttribute(name: string): string | null;
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
  const el: FakeDomEl = {
    "data-hf-id": id,
    "data-x": dataX,
    "data-y": dataY,
    style,
    isConnected: true,
    getAttribute(name) {
      if (name === "data-x") return this["data-x"];
      if (name === "data-y") return this["data-y"];
      if (name === "data-hf-id") return this["data-hf-id"];
      return null;
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

  it("cancelPreview clears draft vars without dispatching", () => {
    const dispatch = vi.fn();
    const el = fakeDomEl("hf-abc", "100", "200");
    const adapter = createIframePreviewAdapter(fakeIframe(el), dispatch);

    adapter.applyDraft("hf-abc", { dx: 30, dy: 20 });
    adapter.cancelPreview();

    expect(dispatch).not.toHaveBeenCalled();
    // CSS vars cleared
    expect(el.style.getPropertyValue("--hf-studio-dx")).toBe("");
    expect(el.style.getPropertyValue("--hf-studio-dy")).toBe("");
  });

  it("commitPreview clears draft vars after dispatching", () => {
    const dispatch = vi.fn();
    const el = fakeDomEl("hf-abc", "0", "0");
    const adapter = createIframePreviewAdapter(fakeIframe(el), dispatch);

    adapter.applyDraft("hf-abc", { dx: 10, dy: 5 });
    adapter.commitPreview();

    expect(el.style.getPropertyValue("--hf-studio-dx")).toBe("");
    expect(el.style.getPropertyValue("--hf-studio-dy")).toBe("");
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
});
