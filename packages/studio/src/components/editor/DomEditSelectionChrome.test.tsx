// @vitest-environment happy-dom

import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import { DomEditSelectionChrome } from "./DomEditSelectionChrome";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    const selection = {
      element: headline,
      selector: ".hl-text",
      capabilities: {
        canCrop: false,
        canApplyManualOffset: false,
        canApplyManualSize: false,
        canApplyManualRotation: false,
      },
    } as unknown as DomEditSelection;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <DomEditSelectionChrome
          selection={selection}
          overlayRect={{ left: 44, top: 52, width: 220, height: 48, editScaleX: 1, editScaleY: 1 }}
          allowCanvasMovement={false}
          boxRef={createRef()}
          boxChromeClass="border border-studio-accent/80"
          boxClipPath={undefined}
          selectionKey="headline"
          groupSelectionCount={0}
          blockedMoveRef={createRef()}
          gestures={{ startGesture: vi.fn() } as never}
          onStyleCommit={vi.fn()}
          onBoxMouseDown={vi.fn()}
          onBoxClick={vi.fn()}
        />,
      );
    });
    const chrome = host.querySelector<HTMLElement>('[data-dom-edit-selection-box="true"]')!;
    expect(chrome.style.cssText).toContain("left: 44px");
    expect(chrome.style.cssText).toContain("width: 220px");
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
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      clipPath: "inset(10px)",
      transform: "matrix(0.8660254, 0.5, -0.5, 0.8660254, 0, 0)",
    } as CSSStyleDeclaration);
    const selection = {
      element,
      id: "clip",
      selector: "#clip",
      capabilities: {
        canCrop: true,
        canApplyManualOffset: true,
        canApplyManualSize: true,
        canApplyManualRotation: true,
      },
    } as unknown as DomEditSelection;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
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
          boxRef={createRef()}
          boxChromeClass=""
          boxClipPath={undefined}
          selectionKey="clip"
          groupSelectionCount={0}
          blockedMoveRef={createRef()}
          gestures={{ startGesture: vi.fn() } as never}
          onStyleCommit={vi.fn()}
          onBoxMouseDown={vi.fn()}
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
    expect(Number.parseFloat(rotations[0]!.slice("rotate(".length))).toBeCloseTo(30, 5);
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
          boxRef={createRef()}
          boxChromeClass="border border-studio-accent/80"
          boxClipPath={undefined}
          selectionKey="copy"
          groupSelectionCount={0}
          blockedMoveRef={createRef()}
          gestures={{ startGesture: vi.fn() } as never}
          onStyleCommit={vi.fn()}
          onBoxMouseDown={vi.fn()}
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
