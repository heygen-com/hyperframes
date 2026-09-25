// @vitest-environment happy-dom

import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppHotkeys } from "../../hooks/useAppHotkeys";
import { usePlayerStore } from "../../player/store/playerStore";
import type { DomEditSelection } from "./domEditing";
import { SnapToolbar } from "./SnapToolbar";
import { PreviewOverlayProvider } from "./PreviewOverlayProvider";
import { usePreviewGuidesStore } from "./previewGuidesStore";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  usePlayerStore.getState().reset();
});

function renderToolbar() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <PreviewOverlayProvider iframeRef={{ current: null }}>
        <SnapToolbar />
      </PreviewOverlayProvider>,
    );
  });
  return { root };
}

function AppHotkeyHarness() {
  const domEditSelectionRef = useRef<DomEditSelection | null>(null);
  const clearDomSelectionRef = useRef<() => void>(() => undefined);

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
    showToast: vi.fn(),
    syncHistoryPreviewAfterApply: vi.fn(async () => undefined),
    waitForPendingDomEditSaves: vi.fn(async () => undefined),
    handleCopy: vi.fn(() => false),
    handlePaste: vi.fn(async () => undefined),
    handleCut: vi.fn(async () => false),
    handleDuplicate: vi.fn(async () => false),
    onResetKeyframes: vi.fn(() => false),
    onDeleteSelectedKeyframes: vi.fn(),
    readOnlyPreview: false,
  });

  return null;
}

function renderToolbarWithAppHotkeys() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <>
        <AppHotkeyHarness />
        <PreviewOverlayProvider iframeRef={{ current: null }}>
          <SnapToolbar />
        </PreviewOverlayProvider>
      </>,
    );
  });
  return { root };
}

describe("SnapToolbar keyboard shortcuts", () => {
  it("toggles snap on an unclaimed S keypress", () => {
    const { root } = renderToolbar();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true }),
      );
    });

    expect(
      JSON.parse(window.localStorage.getItem("hf-studio-ui-preferences") ?? "{}").snapEnabled,
    ).toBe(false);
    act(() => root.unmount());
  });

  it("does not toggle snap when another handler already prevented S", () => {
    const { root } = renderToolbar();
    const event = new KeyboardEvent("keydown", {
      key: "s",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();

    act(() => {
      document.dispatchEvent(event);
    });

    expect(
      JSON.parse(window.localStorage.getItem("hf-studio-ui-preferences") ?? "{}").snapEnabled,
    ).not.toBe(false);
    act(() => root.unmount());
  });

  it("does not toggle snap when the app split shortcut claims S without a selected clip", () => {
    const { root } = renderToolbarWithAppHotkeys();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true }),
      );
    });

    expect(
      JSON.parse(window.localStorage.getItem("hf-studio-ui-preferences") ?? "{}").snapEnabled,
    ).not.toBe(false);
    act(() => root.unmount());
  });
});

describe("SnapToolbar ruler and safe-margin toggles", () => {
  it.each([
    ["Toggle ruler", "rulerVisible"],
    ["Toggle safe margins", "safeMarginsVisible"],
  ])("%s flips %s and remembers it", (label, key) => {
    usePreviewGuidesStore.setState({ rulerVisible: false, safeMarginsVisible: false });
    const { root } = renderToolbar();
    const button = () => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
    expect(button()?.getAttribute("aria-pressed")).toBe("false");

    act(() => button()?.click());

    expect(button()?.getAttribute("aria-pressed")).toBe("true");
    const stored = window.localStorage.getItem("hf-studio-ui-preferences") ?? "{}";
    expect(JSON.parse(stored)[key]).toBe(true);
    act(() => root.unmount());
  });
});
