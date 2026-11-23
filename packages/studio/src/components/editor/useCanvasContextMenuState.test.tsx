// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../../player/store/playerStore";
import type { DomEditSelection } from "./domEditing";
import { useCanvasContextMenuState } from "./useCanvasContextMenuState";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  usePlayerStore.getState().setPreviewFailed(false);
  document.body.innerHTML = "";
});

/** The menu hook with its hit test held until the returned release is called. */
function mountHeld() {
  let release: (selection: DomEditSelection | null) => void = () => {};
  const hitTest = () => new Promise<DomEditSelection | null>((resolve) => (release = resolve));
  const menu: { current: ReturnType<typeof useCanvasContextMenuState> | null } = { current: null };
  function Probe() {
    menu.current = useCanvasContextMenuState({
      selection: null,
      selectionRef: { current: null },
      hoverSelectionRef: { current: null },
      onCanvasPointerMoveRef: { current: hitTest },
      onSelectionChangeRef: { current: vi.fn() },
    });
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(<Probe />));
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

  it("stays shut when the preview fails while the right-click's hit test is still out", async () => {
    const { menu, release } = mountHeld();
    act(() => usePlayerStore.getState().setPreviewFailed(true));
    await release();
    expect(menu().contextMenu).toBeNull();
  });
});
