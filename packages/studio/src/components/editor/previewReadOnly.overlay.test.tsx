// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSelection } from "../../hooks/domSelectionTestHarness";
import { CANVAS_NUDGE_COMMIT_DEBOUNCE_MS } from "./domEditNudge";
import { __resetForTests } from "../../utils/canvasNudgeGate";
import { DomEditOverlay } from "./DomEditOverlay";
import { PreviewReadOnlyProvider } from "./previewReadOnlyContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECT = { left: 100, top: 100, width: 200, height: 100, editScaleX: 1, editScaleY: 1 };
const layout = vi.hoisted(() => ({ group: [] as unknown[] }));

vi.mock("./useDomEditOverlayRects", () => ({
  useDomEditOverlayRects: () => ({
    overlayRect: { left: 100, top: 100, width: 200, height: 100, editScaleX: 1, editScaleY: 1 },
    overlayRectRef: {
      current: { left: 100, top: 100, width: 200, height: 100, editScaleX: 1, editScaleY: 1 },
    },
    setOverlayRect: () => undefined,
    hoverRect: null,
    groupOverlayItems: layout.group,
    groupOverlayItemsRef: { current: layout.group },
    setGroupOverlayItems: () => undefined,
    childRects: [],
  }),
}));
vi.mock("./useDomEditCompositionRect", () => ({
  useDomEditCompositionRect: () => ({
    left: 0,
    top: 0,
    width: 800,
    height: 450,
    scaleX: 1,
    scaleY: 1,
  }),
}));
vi.mock("./offCanvasIndicatorRefresh", () => ({
  startOffCanvasIndicatorRefresh: () => () => undefined,
}));

const BOX = '[data-dom-edit-selection-box="true"]';
let root: Root;
let host: HTMLElement;

function textElement(id: string): HTMLElement {
  const element = document.createElement("h1");
  element.id = id;
  element.textContent = "Title";
  document.body.append(element);
  return element;
}

function fixture(
  overrides: Partial<React.ComponentProps<typeof DomEditOverlay>> = {},
  readOnly = false,
) {
  const spies = {
    onCanvasMouseDown: vi.fn(),
    onSelectionChange: vi.fn(),
    onManualDragStart: vi.fn(),
    onBlockedMove: vi.fn(),
    onPathOffsetCommit: vi.fn(),
    onGroupPathOffsetCommit: vi.fn(),
    onBoxSizeCommit: vi.fn(),
    onRotationCommit: vi.fn(),
    onStyleCommit: vi.fn(),
    onDeleteSelection: vi.fn(),
    onApplyZIndex: vi.fn(),
  };
  const selection = makeSelection("Title", textElement("title"));
  selection.capabilities.canApplyManualRotation = true;
  selection.textFields = [{ key: "text", label: "Text", value: "Title" }] as never;
  const props = {
    iframeRef: { current: document.createElement("iframe") },
    activeCompositionPath: null,
    selection,
    hoverSelection: null,
    onCanvasPointerMove: () => Promise.resolve(selection),
    onCanvasPointerLeave: () => undefined,
    ...spies,
    ...overrides,
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <PreviewReadOnlyProvider readOnly={readOnly}>
        <DomEditOverlay {...props} />
      </PreviewReadOnlyProvider>,
    ),
  );
  return { spies, selection, overlay: host.firstElementChild as HTMLElement };
}

const fire = (target: Element, type: string, init: MouseEventInit = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

beforeEach(() => {
  vi.useFakeTimers();
  __resetForTests();
  HTMLElement.prototype.setPointerCapture = () => undefined;
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  layout.group = [];
  vi.useRealTimers();
});

describe("DomEditOverlay with the preview read-only", () => {
  it("control: with the flag off a press on the box starts a move", () => {
    const { spies, overlay } = fixture();
    fire(overlay.querySelector(BOX)!, "pointerdown");
    expect(spies.onManualDragStart).toHaveBeenCalledTimes(1);
  });

  it("refuses to start a move from the selection box", () => {
    const { spies, overlay } = fixture({}, true);
    const box = overlay.querySelector(BOX)!;
    fire(box, "pointerdown");
    fire(box, "pointermove", { clientX: 40 });
    fire(box, "pointerup");
    expect(spies.onManualDragStart).not.toHaveBeenCalled();
    expect(spies.onBlockedMove).not.toHaveBeenCalled();
    expect(spies.onPathOffsetCommit).not.toHaveBeenCalled();
  });

  it("offers no resize dots, and none can start a resize", () => {
    const off = fixture();
    expect(off.overlay.querySelectorAll("div.h-4.w-4")).toHaveLength(4);
    act(() => root.unmount());
    document.body.innerHTML = "";
    const { spies, overlay } = fixture({}, true);
    expect(overlay.querySelectorAll("div.h-4.w-4")).toHaveLength(0);
    expect(spies.onBoxSizeCommit).not.toHaveBeenCalled();
  });

  it("offers no rotate handle", () => {
    const off = fixture();
    expect(off.overlay.querySelector('[aria-label="Rotate selection"]')).not.toBeNull();
    act(() => root.unmount());
    document.body.innerHTML = "";
    const { spies, overlay } = fixture({}, true);
    expect(overlay.querySelector('[aria-label="Rotate selection"]')).toBeNull();
    expect(spies.onRotationCommit).not.toHaveBeenCalled();
  });

  it("offers no crop handles, so clip-path is never committed", () => {
    const off = fixture();
    expect(off.overlay.querySelector("[data-dom-edit-crop-frame]")).not.toBeNull();
    act(() => root.unmount());
    document.body.innerHTML = "";
    const { spies, overlay } = fixture({}, true);
    expect(overlay.querySelector("[data-dom-edit-crop-frame]")).toBeNull();
    expect(spies.onStyleCommit).not.toHaveBeenCalled();
  });

  it("does not drag a multi-selection", () => {
    const members = ["a", "b"].map((id) => {
      const selection = makeSelection(id, textElement(id));
      return { key: id, selection, element: selection.element, rect: RECT };
    });
    layout.group = members;
    const { spies, overlay } = fixture(
      {
        selection: null,
        groupSelections: members.map((m) => m.selection),
      },
      true,
    );
    fire(overlay.querySelector(BOX)!, "pointerdown");
    expect(spies.onManualDragStart).not.toHaveBeenCalled();
    expect(spies.onGroupPathOffsetCommit).not.toHaveBeenCalled();
  });

  const nudge = () => {
    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
      vi.advanceTimersByTime(CANVAS_NUDGE_COMMIT_DEBOUNCE_MS + 10);
    });
    return event;
  };

  it("control: with the flag off an arrow key nudges", () => {
    const { spies } = fixture();
    expect(nudge().defaultPrevented).toBe(true);
    expect(spies.onPathOffsetCommit).toHaveBeenCalledTimes(1);
  });

  it("neither nudges on an arrow key nor swallows it", () => {
    const { spies } = fixture({}, true);
    expect(nudge().defaultPrevented).toBe(false);
    expect(spies.onPathOffsetCommit).not.toHaveBeenCalled();
  });

  const pressEnter = (overlay: HTMLElement) =>
    act(() => {
      overlay.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });

  it("control: with the flag off Enter opens the text for editing", () => {
    const { selection, overlay } = fixture();
    pressEnter(overlay);
    expect(selection.element.hasAttribute("contenteditable")).toBe(true);
  });

  it("does not open text for editing on Enter", () => {
    const { selection, overlay } = fixture({}, true);
    pressEnter(overlay);
    expect(selection.element.hasAttribute("contenteditable")).toBe(false);
  });

  const rightClick = async (overlay: HTMLElement) => {
    await act(async () => {
      overlay.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }),
      );
    });
  };

  it("control: with the flag off right-click offers delete and z-order", async () => {
    const { overlay } = fixture();
    await rightClick(overlay);
    expect(document.body.textContent).toContain("Delete");
  });

  it("offers no delete or z-order on right-click when read-only", async () => {
    // Same fixture as the control test above (a real, already-selected element) so the
    // context menu actually opens; `selection: null` here would close it via
    // useCanvasContextMenuState's own deselect effect, before read-only ever mattered.
    const { spies, overlay } = fixture({}, true);
    await rightClick(overlay);
    expect(document.body.textContent).not.toContain("Delete");
    expect(spies.onDeleteSelection).not.toHaveBeenCalled();
    expect(spies.onApplyZIndex).not.toHaveBeenCalled();
  });

  it("still selects and reports to the host on right-click of an unselected element", async () => {
    const { spies, overlay } = fixture({ selection: null }, true);
    await rightClick(overlay);
    expect(spies.onSelectionChange).toHaveBeenCalledTimes(1);
  });

  it("still selects and reports to the host on a click", () => {
    const { spies, overlay } = fixture({ selection: null }, true);
    fire(overlay, "mousedown");
    expect(spies.onCanvasMouseDown).toHaveBeenCalledTimes(1);
  });

  it("still selects on a click of the selection box", () => {
    const { spies, overlay } = fixture({}, true);
    fire(overlay.querySelector(BOX)!, "click");
    expect(spies.onCanvasMouseDown).toHaveBeenCalledTimes(1);
  });
});
