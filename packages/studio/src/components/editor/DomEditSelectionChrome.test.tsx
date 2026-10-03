// @vitest-environment happy-dom

import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import type { OverlayRect } from "./domEditOverlayGeometry";
import { DomEditGroupChrome, DomEditSelectionChrome } from "./DomEditSelectionChrome";
import { NO_OVERLAY_RECT_DRAFT } from "./selectionChromeVars";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A selection whose capabilities are all on or all off, plus a host to render into. */
function selectionFixture(
  element: HTMLElement,
  selector: string,
  enabled: boolean,
  extra: Record<string, unknown> = {},
) {
  const selection = {
    element,
    selector,
    ...extra,
    capabilities: {
      canCrop: enabled,
      canApplyManualOffset: enabled,
      canApplyManualSize: enabled,
      canApplyManualRotation: enabled,
    },
  } as unknown as DomEditSelection;
  const host = document.createElement("div");
  document.body.append(host);
  return { selection, host, root: createRoot(host) };
}

describe("DomEditSelectionChrome crop composition", () => {
  it("renders overlay-only transparent chrome at headline geometry without changing composition bytes", () => {
    const composition = document.implementation.createHTMLDocument();
    composition.body.innerHTML = `
      <section class="hl-block"><div class="hl-mask" style="overflow:hidden;background:transparent">
        <h1 class="hl-text">Launch title</h1>
      </div></section>
    `;
    const headline = composition.querySelector<HTMLElement>(".hl-text")!;
    const before = composition.documentElement.outerHTML;
    const { selection, host, root } = selectionFixture(headline, ".hl-text", false);
    act(() => {
      root.render(
        <DomEditSelectionChrome
          selection={selection}
          overlayRect={{ left: 44, top: 52, width: 220, height: 48, editScaleX: 1, editScaleY: 1 }}
          allowCanvasMovement={false}
          allowBodyDrag
          boxRef={createRef()}
          chromeRef={createRef()}
          overlayRectDraft={NO_OVERLAY_RECT_DRAFT}
          boxChromeClass="border border-studio-accent/80"
          boxClipPath={undefined}
          selectionKey="headline"
          groupSelectionCount={0}
          gestures={{ startGesture: vi.fn() } as never}
          onStyleCommit={vi.fn()}
          onBoxClick={vi.fn()}
        />,
      );
    });
    const chrome = host.querySelector<HTMLElement>('[data-dom-edit-selection-box="true"]')!;
    expect(chrome.closest<HTMLElement>(".contents")!.style.getPropertyValue("--hf-sel-x")).toBe(
      "44px",
    );
    expect(chrome.closest<HTMLElement>(".contents")!.style.getPropertyValue("--hf-sel-w")).toBe(
      "220px",
    );
    expect(chrome.style.width).toBe("var(--hf-sel-w)");
    expect(chrome.style.background).toBe("");
    expect(chrome.className).not.toMatch(/bg-/);
    expect(composition.documentElement.outerHTML).toBe(before);
    act(() => root.unmount());
    host.remove();
  });

  it("places rotated crop UI in exactly one oriented coordinate plane", () => {
    const element = document.createElement("div");
    element.id = "clip";
    element.style.clipPath = "inset(10px)";
    Object.defineProperties(element, {
      offsetWidth: { value: 200 },
      offsetHeight: { value: 100 },
    });
    document.body.append(element);
    // Per element, not blanket: the crop frame composes the element's transform
    // with its ancestors', so answering "rotated 30deg" for every node in the
    // document would have the frame read the same turn several times over.
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      ((node: Element) =>
        (node === element
          ? { clipPath: "inset(10px)", transform: "matrix(0.8660254, 0.5, -0.5, 0.8660254, 0, 0)" }
          : { clipPath: "none", transform: "none" }) as CSSStyleDeclaration) as never,
    );
    const { selection, host, root } = selectionFixture(element, "#clip", true, { id: "clip" });
    act(() => {
      root.render(
        <DomEditSelectionChrome
          selection={selection}
          overlayRect={{
            left: 100,
            top: 50,
            width: 220,
            height: 130,
            editScaleX: 1,
            editScaleY: 1,
            angle: 30,
          }}
          allowCanvasMovement={true}
          allowBodyDrag
          boxRef={createRef()}
          chromeRef={createRef()}
          overlayRectDraft={NO_OVERLAY_RECT_DRAFT}
          boxChromeClass=""
          boxClipPath={undefined}
          selectionKey="clip"
          groupSelectionCount={0}
          gestures={{ startGesture: vi.fn() } as never}
          onStyleCommit={vi.fn()}
          onBoxClick={vi.fn()}
        />,
      );
    });

    const cropFrame = host.querySelector<HTMLElement>("[data-dom-edit-crop-frame]")!;
    const rotations: string[] = [];
    for (
      let node: HTMLElement | null = cropFrame;
      node && node !== host;
      node = node.parentElement
    ) {
      if (node.style.transform.includes("rotate(")) rotations.push(node.style.transform);
    }
    expect(rotations).toHaveLength(1);
    expect(Number.parseFloat(/rotate\(([^)]*)\)/.exec(rotations[0]!)![1]!)).toBeCloseTo(30, 5);
    act(() => root.unmount());
  });
});

describe("DomEditSelectionChrome during a gesture", () => {
  it("re-renders the crop frame for a size change only; a move follows the chrome's variables", () => {
    const element = document.createElement("div");
    element.style.clipPath = "inset(10px)";
    document.body.append(element);
    let draft: OverlayRect | null = null;
    const listeners = new Set<() => void>();
    const store = {
      get: () => draft,
      subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)),
    };
    const publish = (next: OverlayRect) =>
      act(() => ((draft = next), listeners.forEach((l) => l())));
    const rect = { left: 10, top: 20, width: 200, height: 100, editScaleX: 1, editScaleY: 1 };
    const { selection, host, root } = selectionFixture(element, "#c", true);
    act(() => {
      root.render(
        <DomEditSelectionChrome
          selection={selection}
          overlayRect={rect}
          allowCanvasMovement
          allowBodyDrag
          boxRef={createRef()}
          chromeRef={createRef()}
          overlayRectDraft={store}
          boxChromeClass=""
          boxClipPath={undefined}
          selectionKey="c"
          groupSelectionCount={0}
          gestures={{ startGesture: vi.fn() } as never}
          onStyleCommit={vi.fn()}
          onBoxClick={vi.fn()}
        />,
      );
    });
    const frame = host.querySelector<HTMLElement>("[data-dom-edit-crop-frame]")!;
    const before = frame.style.cssText;
    expect(frame.style.transform).toContain("var(--hf-sel-x, 10px) - 10px");

    publish({ ...rect, left: 60, top: 70 });
    expect(frame.style.cssText).toBe(before);

    publish({ ...rect, width: 260, height: 130 });
    expect(frame.style.width).toBe("260px");
    act(() => root.unmount());
  });
});

// The bug: the overlay above the preview goes pointer-events-none while text is
// being edited, but `pointer-events: none` on a parent does not disable a child
// that sets `auto`. The selection box covers exactly the element being typed
// into, so it kept swallowing every press: the caret could only ever be placed
// once, when the edit opened, and dragging across characters did nothing.
describe("DomEditSelectionChrome while editing text", () => {
  const CAPABLE = {
    canCrop: true,
    canApplyManualOffset: true,
    canApplyManualSize: true,
    canApplyManualRotation: true,
  };

  function renderChrome(editing: boolean) {
    const element = document.createElement("div");
    element.id = "copy";
    document.body.append(element);
    const selection = {
      element,
      id: "copy",
      selector: "#copy",
      capabilities: CAPABLE,
    } as unknown as DomEditSelection;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <DomEditSelectionChrome
          selection={selection}
          overlayRect={{ left: 10, top: 20, width: 200, height: 60, editScaleX: 1, editScaleY: 1 }}
          allowCanvasMovement={true}
          allowBodyDrag
          boxRef={createRef()}
          chromeRef={createRef()}
          overlayRectDraft={NO_OVERLAY_RECT_DRAFT}
          boxChromeClass="border border-studio-accent/80"
          boxClipPath={undefined}
          selectionKey="copy"
          groupSelectionCount={0}
          gestures={{ startGesture: vi.fn() } as never}
          onStyleCommit={vi.fn()}
          onBoxClick={vi.fn()}
          inlineText={{ editing, startFromPress: vi.fn() }}
        />,
      );
    });
    return { host, unmount: () => act(() => root.unmount()) };
  }

  it("stops the selection box taking presses, so they reach the caret below", () => {
    const { host, unmount } = renderChrome(true);
    const box = host.querySelector<HTMLElement>('[data-dom-edit-selection-box="true"]')!;
    expect(box.className).toContain("pointer-events-none");
    expect(box.className).not.toContain("pointer-events-auto");
    unmount();
  });

  it("keeps the box interactive when no text is being edited", () => {
    const { host, unmount } = renderChrome(false);
    const box = host.querySelector<HTMLElement>('[data-dom-edit-selection-box="true"]')!;
    expect(box.className).toContain("pointer-events-auto");
    unmount();
  });

  it("still marks the edited element, so it is clear which one has the caret", () => {
    const { host, unmount } = renderChrome(true);
    const box = host.querySelector<HTMLElement>('[data-dom-edit-selection-box="true"]')!;
    expect(box.className).toContain("border-studio-accent/80");
    unmount();
  });

  it("takes away every handle that would sit over the text", () => {
    const { host, unmount } = renderChrome(true);
    expect(host.querySelectorAll(".pointer-events-auto")).toHaveLength(0);
    expect(host.querySelector("[data-dom-edit-crop-frame]")).toBeNull();
    unmount();
  });

  it("keeps the handles when nothing is being edited", () => {
    const { host, unmount } = renderChrome(false);
    expect(host.querySelectorAll(".pointer-events-auto").length).toBeGreaterThan(1);
    unmount();
  });
});

describe("DomEditSelectionChrome with body drag off", () => {
  const rect = { left: 10, top: 10, width: 200, height: 100, editScaleX: 1, editScaleY: 1 };
  const gestureSpies = () => ({
    startGesture: vi.fn(),
    startGroupDrag: vi.fn(),
    startBlockedMove: vi.fn(),
  });
  const press = (el: Element) => {
    const event = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
    });
    act(() => {
      el.dispatchEvent(event);
    });
    return event;
  };

  function renderChrome(allowBodyDrag: boolean) {
    const element = document.createElement("div");
    document.body.append(element);
    const { selection, host, root } = selectionFixture(element, "#box", true);
    const hostPress = vi.fn();
    host.addEventListener("pointerdown", hostPress);
    const gestures = gestureSpies();
    act(() => {
      root.render(
        <DomEditSelectionChrome
          selection={selection}
          overlayRect={rect}
          allowCanvasMovement
          allowBodyDrag={allowBodyDrag}
          boxRef={createRef()}
          chromeRef={createRef()}
          overlayRectDraft={NO_OVERLAY_RECT_DRAFT}
          boxChromeClass=""
          boxClipPath={undefined}
          selectionKey="box"
          groupSelectionCount={0}
          gestures={gestures as never}
          onBoxClick={vi.fn()}
        />,
      );
    });
    const box = host.querySelector<HTMLElement>('[data-dom-edit-selection-box="true"]')!;
    return { host, box, gestures, hostPress, cleanup: () => act(() => root.unmount()) };
  }

  it("leaves a body press untouched for the host: no drag, no capture, no cursor", () => {
    const { box, gestures, hostPress, cleanup } = renderChrome(false);
    const event = press(box);
    expect(hostPress).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    expect(box.hasPointerCapture(1)).toBe(false);
    expect(gestures.startGesture).not.toHaveBeenCalled();
    expect(gestures.startBlockedMove).not.toHaveBeenCalled();
    expect(box.style.cursor).toBe("");
    cleanup();
  });

  it("keeps the resize and rotate handles working", () => {
    const { host, gestures, cleanup } = renderChrome(false);
    const corner = host.querySelector<HTMLElement>('[style*="nwse-resize"]')!;
    press(corner);
    expect(gestures.startGesture).toHaveBeenCalledWith("resize", expect.anything(), {
      resizeHandle: "nw",
    });
    press(host.querySelector('[aria-label="Rotate selection"]')!);
    expect(gestures.startGesture).toHaveBeenCalledWith("rotate", expect.anything());
    cleanup();
  });

  it("still drags the body by default", () => {
    const { box, gestures, cleanup } = renderChrome(true);
    press(box);
    expect(gestures.startGesture).toHaveBeenCalledWith("drag", expect.anything());
    expect(box.style.cursor).toBe("move");
    cleanup();
  });

  it("leaves a group body press untouched too", () => {
    const { host, root } = selectionFixture(document.createElement("div"), "#g", true);
    const hostPress = vi.fn();
    host.addEventListener("pointerdown", hostPress);
    const gestures = gestureSpies();
    act(() => {
      root.render(
        <DomEditGroupChrome
          groupOverlayItems={[]}
          groupBounds={rect}
          allowCanvasMovement
          allowBodyDrag={false}
          groupCanMove
          gestures={gestures as never}
          onBoxClick={vi.fn()}
        />,
      );
    });
    const groupBox = host.querySelector<HTMLElement>('[data-dom-edit-selection-box="true"]')!;
    const event = press(groupBox);
    expect(groupBox.style.cursor).toBe("");
    expect(hostPress).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    expect(gestures.startGroupDrag).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
