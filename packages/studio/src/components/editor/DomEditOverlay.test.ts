// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import {
  DomEditOverlay,
  filterNestedDomEditGroupItems,
  focusDomEditOverlayElement,
  hasDomEditRotationChanged,
  resolveDomEditCoordinateScale,
  resolveDomEditGroupOverlayRect,
  resolveDomEditResizeGesture,
  resolveDomEditRotationGesture,
} from "./DomEditOverlay";
import type { DomEditSelection } from "./domEditing";
import { resolveResizeAnchorOffset, resolveResizeHandleDeltas } from "./domEditOverlayGestures";

// React 19 warns unless the test environment opts into act().
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const gestureSpies = vi.hoisted(() => ({
  startGesture: vi.fn(() => true),
  startGroupDrag: vi.fn(),
  onPointerMove: vi.fn(),
  onPointerUp: vi.fn(),
  clearPointerState: vi.fn(),
}));

vi.mock("./useDomEditOverlayGestures", () => ({
  createDomEditOverlayGestureHandlers: () => ({
    startGesture: gestureSpies.startGesture,
    startGroupDrag: gestureSpies.startGroupDrag,
    onPointerMove: gestureSpies.onPointerMove,
    onPointerUp: gestureSpies.onPointerUp,
    clearPointerState: gestureSpies.clearPointerState,
  }),
}));

vi.mock("./useDomEditOverlayRects", async () => {
  const React = await import("react");
  const { rectsEqual } = await import("./domEditOverlayGeometry");

  return {
    useDomEditOverlayRects: (options: { selectionRef: { current: unknown } }) => {
      const defaultSelectionRect = {
        left: 24,
        top: 36,
        width: 180,
        height: 72,
        editScaleX: 1,
        editScaleY: 1,
      };
      const initialOverlayRect = options.selectionRef.current ? defaultSelectionRect : null;
      const [overlayRect, setOverlayRectState] = React.useState(initialOverlayRect);
      const overlayRectRef = React.useRef(initialOverlayRect);
      const [groupOverlayItems, setGroupOverlayItemsState] = React.useState([]);
      const groupOverlayItemsRef = React.useRef([]);

      const setOverlayRect = (next: unknown) => {
        if (rectsEqual(overlayRectRef.current, next)) return;
        overlayRectRef.current = next;
        setOverlayRectState(next);
      };

      const setGroupOverlayItems = (next: unknown[]) => {
        groupOverlayItemsRef.current = next;
        setGroupOverlayItemsState(next);
      };

      return {
        overlayRect,
        overlayRectRef,
        setOverlayRect,
        hoverRect: null,
        hoverRectRef: { current: null },
        setHoverRect: () => {},
        groupOverlayItems,
        groupOverlayItemsRef,
        setGroupOverlayItems,
        childRects: [],
      };
    },
  };
});

const previewHelperSpies = vi.hoisted(() => ({
  getPreviewTargetFromPointer: vi.fn<() => HTMLElement | null>(() => null),
}));

vi.mock("../../utils/studioPreviewHelpers", async () => {
  const actual = await vi.importActual<typeof import("../../utils/studioPreviewHelpers")>(
    "../../utils/studioPreviewHelpers",
  );
  return {
    ...actual,
    getPreviewTargetFromPointer: previewHelperSpies.getPreviewTargetFromPointer,
  };
});

vi.mock("./domEditOverlayGeometry", async () => {
  const actual = await vi.importActual<typeof import("./domEditOverlayGeometry")>(
    "./domEditOverlayGeometry",
  );

  return {
    ...actual,
    toOverlayRect: () => ({
      left: 24,
      top: 36,
      width: 180,
      height: 72,
      editScaleX: 1,
      editScaleY: 1,
    }),
  };
});

function createOverlayProps(args: {
  iframeRef: { current: HTMLIFrameElement | null };
  selection: DomEditSelection | null;
  hoverSelection: DomEditSelection | null;
  onSelectionChange: (next: DomEditSelection) => void;
}) {
  return {
    iframeRef: args.iframeRef,
    activeCompositionPath: null,
    selection: args.selection,
    hoverSelection: args.hoverSelection,
    groupSelections: [],
    onCanvasMouseDown: () => {},
    onCanvasPointerMove: () => Promise.resolve(args.hoverSelection ?? args.selection),
    onCanvasPointerLeave: () => {},
    onSelectionChange: args.onSelectionChange,
    onBlockedMove: () => {},
    onPathOffsetCommit: () => {},
    onGroupPathOffsetCommit: () => {},
    onBoxSizeCommit: () => {},
    onRotationCommit: () => {},
  };
}

describe("focusDomEditOverlayElement", () => {
  it("focuses the canvas overlay without scrolling", () => {
    const calls: Array<FocusOptions | undefined> = [];
    focusDomEditOverlayElement({
      focus: (options?: FocusOptions) => calls.push(options),
    });

    expect(calls).toEqual([{ preventScroll: true }]);
  });
});

describe("DomEditOverlay", () => {
  beforeEach(() => {
    gestureSpies.startGesture.mockClear();
    gestureSpies.startGroupDrag.mockClear();
    gestureSpies.onPointerMove.mockClear();
    gestureSpies.onPointerUp.mockClear();
    gestureSpies.clearPointerState.mockClear();
    previewHelperSpies.getPreviewTargetFromPointer.mockReset();
    previewHelperSpies.getPreviewTargetFromPointer.mockReturnValue(null);
  });

  it("selects on the first click over an element even before a hover is resolved", async () => {
    // Regression: this used to start a marquee whenever hoverSelectionRef was null.
    // The RAF hover loop populates that ref ASYNCHRONOUSLY, so a genuine first
    // click over an element read null and was misread as empty canvas — the
    // marquee swallowed the selecting onMouseDown, so nothing selected until the
    // SECOND click. With a synchronous pointer hit-test finding an element, the
    // marquee must NOT start and onCanvasMouseDown must fire on the first click.
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (): DOMRect {
      return {
        left: 0,
        top: 0,
        right: 800,
        bottom: 450,
        width: 800,
        height: 450,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    };
    const originalPointerCapture = HTMLDivElement.prototype.setPointerCapture;
    HTMLDivElement.prototype.setPointerCapture = () => {};

    // An element IS under the pointer, but no hover has been resolved yet.
    previewHelperSpies.getPreviewTargetFromPointer.mockReturnValue(document.createElement("div"));

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const iframeRef = { current: document.createElement("iframe") as HTMLIFrameElement | null };
    const onCanvasMouseDown = vi.fn();
    const onMarqueeSelect = vi.fn();

    function Harness() {
      return React.createElement(DomEditOverlay, {
        ...createOverlayProps({
          iframeRef,
          selection: null,
          hoverSelection: null,
          onSelectionChange: () => {},
        }),
        onCanvasMouseDown,
        onMarqueeSelect,
      });
    }

    act(() => {
      root.render(React.createElement(Harness));
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });

    const overlay = host.querySelector('[aria-label="Composition canvas"]') as HTMLDivElement;
    expect(overlay).toBeTruthy();

    act(() => {
      overlay.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 120, clientY: 80 }),
      );
      overlay.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 120, clientY: 80 }),
      );
    });

    // No marquee started; the click reached the selecting mouse-down handler.
    expect(onMarqueeSelect).not.toHaveBeenCalled();
    expect(onCanvasMouseDown).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
    HTMLDivElement.prototype.setPointerCapture = originalPointerCapture;
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    host.remove();
  });

  it("does not start a drag from a stale hover target on canvas pointer-down", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const selection: DomEditSelection = {
      element: document.createElement("div"),
      id: "cta-label",
      selector: ".cta-label",
      selectorIndex: 0,
      sourceFile: "index.html",
      tagName: "span",
      label: "CTA Label",
      textContent: "Add to basket",
      textFields: [],
      capabilities: {
        canEditText: true,
        canEditLayout: true,
        canMove: true,
        canApplyManualOffset: true,
        canApplyManualSize: false,
        canApplyManualRotation: false,
        canAdjustOpacity: true,
        canAdjustFill: true,
        canAdjustBorderRadius: true,
        canAdjustStroke: true,
        canAdjustShadow: true,
        canAdjustZIndex: true,
      },
      computedStyle: {
        display: "inline",
        position: "static",
      },
    };

    let currentSelection: DomEditSelection | null = null;
    const iframeRef = { current: document.createElement("iframe") as HTMLIFrameElement | null };

    function Harness() {
      const [selected, setSelected] = React.useState<DomEditSelection | null>(null);
      currentSelection = selected;

      return React.createElement(
        DomEditOverlay,
        createOverlayProps({
          iframeRef,
          selection: selected,
          hoverSelection: selection,
          onSelectionChange: (next: DomEditSelection) => setSelected(next),
        }),
      );
    }

    act(() => {
      root.render(React.createElement(Harness));
    });

    const overlay = host.querySelector('[aria-label="Composition canvas"]') as HTMLDivElement;
    expect(overlay).toBeTruthy();

    act(() => {
      overlay.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 120,
          clientY: 80,
        }),
      );
    });

    expect(gestureSpies.startGesture).not.toHaveBeenCalled();
    expect(currentSelection).toBe(null);

    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("starts movement from the selected bounds", async () => {
    // The overlay's compRect updates via a RAF loop reading iframe + overlay
    // getBoundingClientRect. happy-dom returns all zeros for newly-created
    // elements with no layout, so without stubs the RAF early-returns
    // (iRect.width <= 0) and compRect.width stays 0 — gating the selection
    // box (and other bounded UI) behind `compRect.width > 0` (added in the
    // keyframes PR a468550f). Stub element-level getBoundingClientRect for
    // the test so the RAF compRect update produces a real width.
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (): DOMRect {
      return {
        left: 0,
        top: 0,
        right: 800,
        bottom: 450,
        width: 800,
        height: 450,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    };

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const selection: DomEditSelection = {
      element: document.createElement("div"),
      id: "hero-title",
      selector: ".hero-title",
      selectorIndex: 0,
      sourceFile: "index.html",
      tagName: "div",
      label: "Hero Title",
      textContent: "Hello",
      textFields: [],
      capabilities: {
        canEditText: true,
        canEditLayout: true,
        canMove: true,
        canApplyManualOffset: true,
        canApplyManualSize: false,
        canApplyManualRotation: false,
        canAdjustOpacity: true,
        canAdjustFill: true,
        canAdjustBorderRadius: true,
        canAdjustStroke: true,
        canAdjustShadow: true,
        canAdjustZIndex: true,
      },
      computedStyle: {
        display: "block",
        position: "absolute",
      },
    };

    let currentSelection: DomEditSelection | null = selection;
    const iframeRef = { current: document.createElement("iframe") as HTMLIFrameElement | null };
    const originalPointerCapture = HTMLDivElement.prototype.setPointerCapture;
    HTMLDivElement.prototype.setPointerCapture = () => {};

    function Harness() {
      const [selected, setSelected] = React.useState<DomEditSelection | null>(selection);
      currentSelection = selected;

      return React.createElement(DomEditOverlay, {
        ...createOverlayProps({
          iframeRef,
          selection: selected,
          hoverSelection: null,
          onSelectionChange: (next: DomEditSelection) => setSelected(next),
        }),
      });
    }

    act(() => {
      root.render(React.createElement(Harness));
    });

    // Flush the mount's RAF tick so the compRect update lands before the
    // pointer-down. Two animation-frame ticks: the first scheduled by
    // useMountEffect's update(), the second by update()'s tail recursion.
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });

    const overlay = host.querySelector('[aria-label="Composition canvas"]') as HTMLDivElement;
    expect(overlay).toBeTruthy();

    const selectionBox = host.querySelector(
      '[data-dom-edit-selection-box="true"]',
    ) as HTMLDivElement;
    expect(selectionBox).toBeTruthy();

    act(() => {
      selectionBox.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 120,
          clientY: 80,
        }),
      );
    });

    expect(currentSelection).toBe(selection);
    expect(gestureSpies.startGesture).toHaveBeenCalledWith(
      "drag",
      expect.objectContaining({ button: 0 }),
    );

    act(() => {
      root.unmount();
    });
    HTMLDivElement.prototype.setPointerCapture = originalPointerCapture;
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    host.remove();
  });

  it("passes the tracked hover selection when clicking the existing selection box", async () => {
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (): DOMRect {
      return {
        left: 0,
        top: 0,
        right: 800,
        bottom: 450,
        width: 800,
        height: 450,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    };

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const selection: DomEditSelection = {
      element: document.createElement("div"),
      id: "hero-title",
      selector: ".hero-title",
      selectorIndex: 0,
      sourceFile: "index.html",
      tagName: "div",
      label: "Hero Title",
      textContent: "Hello",
      textFields: [],
      capabilities: {
        canEditText: true,
        canEditLayout: true,
        canMove: false,
        canApplyManualOffset: false,
        canApplyManualSize: false,
        canApplyManualRotation: false,
        canAdjustOpacity: true,
        canAdjustFill: true,
        canAdjustBorderRadius: true,
        canAdjustStroke: true,
        canAdjustShadow: true,
        canAdjustZIndex: true,
      },
      computedStyle: {
        display: "block",
        position: "absolute",
      },
    };
    const hoverSelection: DomEditSelection = { ...selection, id: "hovered-sibling" };
    const onCanvasMouseDown = vi.fn();
    const iframeRef = { current: document.createElement("iframe") as HTMLIFrameElement | null };

    function Harness() {
      return React.createElement(DomEditOverlay, {
        ...createOverlayProps({
          iframeRef,
          selection,
          hoverSelection,
          onSelectionChange: () => {},
        }),
        onCanvasMouseDown,
      });
    }

    act(() => {
      root.render(React.createElement(Harness));
    });

    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });

    const selectionBox = host.querySelector(
      '[data-dom-edit-selection-box="true"]',
    ) as HTMLDivElement;
    expect(selectionBox).toBeTruthy();

    act(() => {
      selectionBox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onCanvasMouseDown).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hoverSelection }),
    );

    act(() => {
      root.unmount();
    });
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    host.remove();
  });
});

describe("resolveDomEditCoordinateScale", () => {
  it("uses the top-level preview scale when no source boundary dimensions are available", () => {
    expect(
      resolveDomEditCoordinateScale({
        rootScaleX: 0.5,
        rootScaleY: 0.5,
      }),
    ).toEqual({
      scaleX: 0.5,
      scaleY: 0.5,
    });
  });

  it("converts source-local pixels through a scaled nested composition host", () => {
    expect(
      resolveDomEditCoordinateScale({
        rootScaleX: 0.5,
        rootScaleY: 0.5,
        sourceRectWidth: 960,
        sourceRectHeight: 540,
        sourceWidth: 1920,
        sourceHeight: 1080,
      }),
    ).toEqual({
      scaleX: 0.25,
      scaleY: 0.25,
    });
  });
});

describe("resolveDomEditGroupOverlayRect", () => {
  it("returns a bounding box that contains every selected element", () => {
    expect(
      resolveDomEditGroupOverlayRect([
        { left: 40, top: 30, width: 80, height: 50, editScaleX: 1, editScaleY: 1 },
        { left: 150, top: 10, width: 30, height: 120, editScaleX: 0.5, editScaleY: 0.5 },
        { left: 20, top: 90, width: 50, height: 20, editScaleX: 2, editScaleY: 2 },
      ]),
    ).toEqual({
      left: 20,
      top: 10,
      width: 160,
      height: 120,
      editScaleX: 1,
      editScaleY: 1,
    });
  });

  it("returns null for an empty group", () => {
    expect(resolveDomEditGroupOverlayRect([])).toBeNull();
  });
});

describe("filterNestedDomEditGroupItems", () => {
  it("keeps top-level selected elements so descendants are not moved twice", () => {
    const window = new Window();
    const parent = window.document.createElement("div");
    const child = window.document.createElement("div");
    const sibling = window.document.createElement("div");
    parent.append(child);

    expect(
      filterNestedDomEditGroupItems([
        { key: "parent", element: parent },
        { key: "child", element: child },
        { key: "sibling", element: sibling },
      ]).map((item) => item.key),
    ).toEqual(["parent", "sibling"]);
  });
});

describe("resolveDomEditResizeGesture", () => {
  it("resizes width and height independently by default", () => {
    expect(
      resolveDomEditResizeGesture({
        originWidth: 240,
        originHeight: 120,
        actualWidth: 240,
        actualHeight: 120,
        scaleX: 1,
        scaleY: 1,
        dx: 30,
        dy: 12,
        uniform: false,
      }),
    ).toEqual({
      overlayWidth: 270,
      overlayHeight: 132,
      width: 270,
      height: 132,
    });
  });

  it("locks the current aspect ratio when Shift is held", () => {
    expect(
      resolveDomEditResizeGesture({
        originWidth: 240,
        originHeight: 120,
        actualWidth: 240,
        actualHeight: 120,
        scaleX: 1,
        scaleY: 1,
        dx: 30,
        dy: 12,
        uniform: true,
      }),
    ).toEqual({
      overlayWidth: 270,
      overlayHeight: 135,
      width: 270,
      height: 135,
    });
  });

  it("uses the dominant pointer delta for uniform shrink, preserving aspect", () => {
    expect(
      resolveDomEditResizeGesture({
        originWidth: 300,
        originHeight: 180,
        actualWidth: 300,
        actualHeight: 180,
        scaleX: 1,
        scaleY: 1,
        dx: 8,
        dy: -40,
        uniform: true,
      }),
    ).toMatchObject({
      width: 700 / 3,
      height: 140,
    });
  });

  it("writes source-local dimensions when the edited source is scaled down in master view", () => {
    expect(
      resolveDomEditResizeGesture({
        originWidth: 100,
        originHeight: 50,
        actualWidth: 400,
        actualHeight: 200,
        scaleX: 0.25,
        scaleY: 0.25,
        dx: 25,
        dy: 10,
        uniform: false,
      }),
    ).toEqual({
      overlayWidth: 125,
      overlayHeight: 60,
      width: 500,
      height: 240,
    });
  });
});

describe("resolveDomEditRotationGesture", () => {
  it("rotates by the pointer angle around the element center", () => {
    expect(
      resolveDomEditRotationGesture({
        centerX: 0,
        centerY: 0,
        startX: 0,
        startY: -10,
        currentX: 10,
        currentY: 0,
        actualAngle: 5,
        snap: false,
      }),
    ).toEqual({ angle: 95 });
  });

  it("uses the shortest delta across the 180 degree boundary", () => {
    expect(
      resolveDomEditRotationGesture({
        centerX: 0,
        centerY: 0,
        startX: -10,
        startY: 1.76,
        currentX: -10,
        currentY: -1.76,
        actualAngle: 0,
        snap: false,
      }).angle,
    ).toBeCloseTo(20, 1);
  });

  it("snaps to 15 degree increments when requested", () => {
    expect(
      resolveDomEditRotationGesture({
        centerX: 0,
        centerY: 0,
        startX: 10,
        startY: 0,
        currentX: 10,
        currentY: 3.25,
        actualAngle: 0,
        snap: true,
      }),
    ).toEqual({ angle: 15 });
  });

  it("allows small pointer movements when the rounded angle changes", () => {
    const nextRotation = resolveDomEditRotationGesture({
      centerX: 0,
      centerY: 0,
      startX: 0,
      startY: -40,
      currentX: 1,
      currentY: -40,
      actualAngle: 0,
      snap: false,
    });

    expect(nextRotation.angle).toBe(1.4);
    expect(hasDomEditRotationChanged(0, nextRotation.angle)).toBe(true);
    expect(hasDomEditRotationChanged(0, 0)).toBe(false);
  });
});

describe("resolveResizeHandleDeltas", () => {
  it("se: pointer deltas map directly to size deltas, no anchoring", () => {
    expect(resolveResizeHandleDeltas("se", 30, 12)).toEqual({
      sizeDx: 30,
      sizeDy: 12,
      anchorX: false,
      anchorY: false,
    });
  });

  it("nw: moving the pointer up-left grows the box and anchors both axes", () => {
    expect(resolveResizeHandleDeltas("nw", -30, -12)).toEqual({
      sizeDx: 30,
      sizeDy: 12,
      anchorX: true,
      anchorY: true,
    });
  });

  it("ne: x follows the pointer, y is inverted and anchored", () => {
    expect(resolveResizeHandleDeltas("ne", 30, -12)).toEqual({
      sizeDx: 30,
      sizeDy: 12,
      anchorX: false,
      anchorY: true,
    });
  });

  it("sw: x is inverted and anchored, y follows the pointer", () => {
    expect(resolveResizeHandleDeltas("sw", -30, 12)).toEqual({
      sizeDx: 30,
      sizeDy: 12,
      anchorX: true,
      anchorY: false,
    });
  });
});

describe("resolveResizeAnchorOffset", () => {
  it("translates by the size change only on anchored axes", () => {
    expect(
      resolveResizeAnchorOffset({
        originWidth: 200,
        originHeight: 100,
        overlayWidth: 230,
        overlayHeight: 112,
        anchorX: true,
        anchorY: true,
      }),
    ).toEqual({ dx: -30, dy: -12 });
  });

  it("returns zero offset when nothing is anchored (se handle)", () => {
    expect(
      resolveResizeAnchorOffset({
        originWidth: 200,
        originHeight: 100,
        overlayWidth: 230,
        overlayHeight: 112,
        anchorX: false,
        anchorY: false,
      }),
    ).toEqual({ dx: 0, dy: 0 });
  });

  it("mixed anchoring (ne): only the y axis translates", () => {
    expect(
      resolveResizeAnchorOffset({
        originWidth: 200,
        originHeight: 100,
        overlayWidth: 230,
        overlayHeight: 88,
        anchorX: false,
        anchorY: true,
      }),
    ).toEqual({ dx: 0, dy: 12 });
  });
});
