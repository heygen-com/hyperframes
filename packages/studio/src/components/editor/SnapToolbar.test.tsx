// @vitest-environment happy-dom

import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppHotkeys } from "../../hooks/useAppHotkeys";
import { readStudioUiPreferences } from "../../utils/studioUiPreferences";
import { usePlayerStore } from "../../player/store/playerStore";
import type { LeftSidebarHandle } from "../sidebar/LeftSidebar";
import type { DomEditSelection } from "./domEditing";
import { SnapToolbar } from "./SnapToolbar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  usePlayerStore.getState().reset();
});

function renderToolbar(onSnapChange = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<SnapToolbar onSnapChange={onSnapChange} />);
  });
  return { root, onSnapChange };
}

function AppHotkeyHarness() {
  const domEditSelectionRef = useRef<DomEditSelection | null>(null);
  const clearDomSelectionRef = useRef<() => void>(() => undefined);
  const domEditSaveTimestampRef = useRef(0);
  const leftSidebarRef = useRef<LeftSidebarHandle | null>(null);

  useAppHotkeys({
    handleTimelineElementsDelete: vi.fn(async () => {}),
    handleTimelineElementSplit: vi.fn(),
    handleDomEditElementDelete: vi.fn(),
    domEditSelectionRef,
    clearDomSelectionRef,
    editHistory: {
      undo: vi.fn(async () => ({ ok: false })),
      redo: vi.fn(async () => ({ ok: false })),
      state: { undo: [], redo: [] },
    },
    readOptionalProjectFile: vi.fn(async () => ""),
    readProjectFile: vi.fn(async () => ""),
    writeProjectFile: vi.fn(async () => undefined),
    domEditSaveTimestampRef,
    showToast: vi.fn(),
    syncHistoryPreviewAfterApply: vi.fn(async () => undefined),
    waitForPendingDomEditSaves: vi.fn(async () => undefined),
    leftSidebarRef,
    handleCopy: vi.fn(() => false),
    handlePaste: vi.fn(async () => undefined),
    handleCut: vi.fn(async () => false),
    onResetKeyframes: vi.fn(() => false),
    onDeleteSelectedKeyframes: vi.fn(),
  });

  return null;
}

function renderToolbarWithAppHotkeys(onSnapChange = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <>
        <AppHotkeyHarness />
        <SnapToolbar onSnapChange={onSnapChange} />
      </>,
    );
  });
  return { root, onSnapChange };
}

describe("SnapToolbar keyboard shortcuts", () => {
  it("toggles snap on an unclaimed S keypress", () => {
    const { root, onSnapChange } = renderToolbar();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true }),
      );
    });

    expect(onSnapChange).toHaveBeenCalledWith(expect.objectContaining({ snapEnabled: false }));
    act(() => root.unmount());
  });

  it("does not toggle snap when another handler already prevented S", () => {
    const { root, onSnapChange } = renderToolbar();
    const event = new KeyboardEvent("keydown", {
      key: "s",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();

    act(() => {
      document.dispatchEvent(event);
    });

    expect(onSnapChange).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("does not toggle snap when the app split shortcut claims S without a selected clip", () => {
    const { root, onSnapChange } = renderToolbarWithAppHotkeys();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true }),
      );
    });

    expect(onSnapChange).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});

/**
 * The grid panel on the shared Popover. It is a form, not a list of actions, so
 * the arrow keys have to stay with the number field inside it (KTD5).
 *
 * Base UI opens and closes it from a portal, so every query below runs against
 * `document` rather than the toolbar's own host.
 */
function openGridPanel(): HTMLElement {
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Grid options"]');
  if (!trigger) throw new Error("grid options trigger not rendered");
  // Base UI treats a bare `click()` as a keyboard activation and pre-highlights;
  // the pointer sequence is what a mouse actually sends.
  act(() => {
    const init = { bubbles: true, cancelable: true, composed: true, detail: 1 };
    trigger.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse" }));
    trigger.dispatchEvent(new MouseEvent("mousedown", init));
    trigger.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse" }));
    trigger.dispatchEvent(new MouseEvent("mouseup", init));
    trigger.dispatchEvent(new MouseEvent("click", init));
  });
  const panel = document.querySelector<HTMLElement>('[aria-label="Grid options"][role="dialog"]');
  if (!panel) throw new Error("grid panel did not open");
  return panel;
}

describe("SnapToolbar grid panel", () => {
  it("persists a spacing change through the preferences writer", () => {
    const { root, onSnapChange } = renderToolbar();
    const panel = openGridPanel();
    const spacing = panel.querySelector<HTMLInputElement>('input[type="number"]');
    if (!spacing) throw new Error("grid spacing field not rendered");

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(spacing, "120");
      spacing.dispatchEvent(new Event("input", { bubbles: true }));
      spacing.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onSnapChange).toHaveBeenCalledWith(expect.objectContaining({ gridSpacing: 120 }));
    expect(readStudioUiPreferences().gridSpacing).toBe(120);
    act(() => root.unmount());
  });

  it("closes on an outside press and writes no preference", () => {
    const { root, onSnapChange } = renderToolbar();
    openGridPanel();
    onSnapChange.mockClear();

    act(() => {
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerType: "mouse" }),
      );
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector('[aria-label="Grid options"][role="dialog"]')).toBeNull();
    expect(onSnapChange).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
