// @vitest-environment happy-dom

import React, { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../../player/store/playerStore";
import type { DomEditSelection } from "./domEditing";
import { useCanvasContextMenuState } from "./useCanvasContextMenuState";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  usePlayerStore.getState().setPreviewFailed(false);
  document.body.innerHTML = "";
});

/** The menu hook with its hit test held until the returned release is called. */
function mountHeld() {
  let release: (selection: DomEditSelection | null) => void = () => {};
  const hitTest = () => new Promise<DomEditSelection | null>((resolve) => (release = resolve));
  const menu: { current: ReturnType<typeof useCanvasContextMenuState> | null } = { current: null };
  // As the overlay does: the right-click's hit selects its target, and the menu reads that selection.
  function Probe() {
    const [selection, setSelection] = useState<DomEditSelection | null>(null);
    const selectionRef = useRef(selection);
    selectionRef.current = selection;
    const onSelectionChangeRef = useRef((next: DomEditSelection) => setSelection(next));
    menu.current = useCanvasContextMenuState({
      selection,
      selectionRef,
      hoverSelectionRef: useRef<DomEditSelection | null>(null),
      onCanvasPointerMoveRef: useRef(hitTest),
      onSelectionChangeRef,
    });
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Probe />));
  const rightClick = {
    preventDefault: vi.fn(),
    clientX: 40,
    clientY: 30,
  } as unknown as React.MouseEvent<HTMLDivElement>;
  let opening: Promise<void> = Promise.resolve();
  act(() => {
    opening = menu.current!.handleContextMenu(rightClick);
  });
  const target = { element: document.createElement("div") } as unknown as DomEditSelection;
  return {
    menu: () => menu.current!,
    release: () => act(async () => (release(target), await opening)),
  };
}

describe("the canvas menu's way in", () => {
  it("opens once the right-click's hit test lands", async () => {
    const { menu, release } = mountHeld();
    await release();
    expect(menu().contextMenu).toMatchObject({ x: 40, y: 30 });
  });

  it("closes an open menu when the preview fails", async () => {
    const { menu, release } = mountHeld();
    await release();
    act(() => usePlayerStore.getState().setPreviewFailed(true));
    expect(menu().contextMenu).toBeNull();
  });

  it("stays shut when the preview fails while the right-click's hit test is still out", async () => {
    const { menu, release } = mountHeld();
    act(() => usePlayerStore.getState().setPreviewFailed(true));
    await release();
    expect(menu().contextMenu).toBeNull();
  });
});
