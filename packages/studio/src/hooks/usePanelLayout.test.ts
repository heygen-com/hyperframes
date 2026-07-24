// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStudioUiPreferences } from "../utils/studioUiPreferences";
import { usePanelLayout } from "./usePanelLayout";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1496 });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.doUnmock("../components/editor/manualEditingAvailability");
  vi.resetModules();
});

function renderPanelLayoutWith(hook: typeof usePanelLayout) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let current: ReturnType<typeof usePanelLayout> | null = null;

  function Harness() {
    current = hook();
    return null;
  }

  act(() => {
    root.render(React.createElement(Harness));
  });

  return {
    getState: (): ReturnType<typeof usePanelLayout> => {
      if (!current) throw new Error("usePanelLayout did not render");
      return current;
    },
    unmount: () => act(() => root.unmount()),
  };
}

function renderPanelLayout() {
  return renderPanelLayoutWith(usePanelLayout);
}

describe("usePanelLayout — right inspector panes", () => {
  it("opens Design with the intended viewport-scaled panel widths", () => {
    const harness = renderPanelLayout();

    expect(harness.getState()).toMatchObject({
      leftWidth: 384,
      rightWidth: 424,
      rightCollapsed: false,
      rightPanelTab: "design",
    });

    harness.unmount();
  });

  it("persists the latest pointer width even before React rerenders", () => {
    const harness = renderPanelLayout();
    const state = harness.getState();
    const target = { setPointerCapture: vi.fn() };

    act(() => {
      state.handlePanelResizeStart("left", {
        preventDefault: vi.fn(),
        target,
        pointerId: 1,
        clientX: 100,
      } as unknown as React.PointerEvent);
      state.handlePanelResizeMove({ clientX: 140 } as React.PointerEvent);
      state.handlePanelResizeEnd();
    });

    expect(harness.getState().leftWidth).toBe(424);
    expect(readStudioUiPreferences().leftWidth).toBe(424);
    harness.unmount();
  });

  it("accumulates and persists rapid keyboard resize steps", () => {
    const harness = renderPanelLayout();
    const state = harness.getState();

    act(() => {
      state.adjustPanelWidth("right", 16);
      state.adjustPanelWidth("right", 16);
    });

    expect(harness.getState().rightWidth).toBe(456);
    expect(readStudioUiPreferences().rightWidth).toBe(456);
    harness.unmount();
  });

  it("toggleRightInspectorPane independently flips one pane, allowing both open at once", () => {
    const harness = renderPanelLayout();
    expect(harness.getState().rightInspectorPanes).toEqual({ layers: false, design: true });

    act(() => harness.getState().toggleRightInspectorPane("layers"));
    expect(harness.getState().rightInspectorPanes).toEqual({ layers: true, design: true });

    harness.unmount();
  });

  it("toggleRightInspectorPane refuses to turn off the last remaining pane", () => {
    const harness = renderPanelLayout();
    act(() => harness.getState().toggleRightInspectorPane("design"));
    // Only "design" was on; toggling it off would leave both false — guarded.
    expect(harness.getState().rightInspectorPanes).toEqual({ layers: false, design: true });
    harness.unmount();
  });

  it("setExclusiveRightInspectorPane is radio-style — selecting one turns the other off", () => {
    const harness = renderPanelLayout();
    act(() => harness.getState().toggleRightInspectorPane("layers"));
    expect(harness.getState().rightInspectorPanes).toEqual({ layers: true, design: true });

    act(() => harness.getState().setExclusiveRightInspectorPane("layers"));
    expect(harness.getState().rightInspectorPanes).toEqual({ layers: true, design: false });

    act(() => harness.getState().setExclusiveRightInspectorPane("design"));
    expect(harness.getState().rightInspectorPanes).toEqual({ layers: false, design: true });

    harness.unmount();
  });

  it("setRightPanelTab additively opens a pane when the flat inspector is off (legacy behavior)", async () => {
    vi.resetModules();
    vi.doMock("../components/editor/manualEditingAvailability", async () => {
      const actual = await vi.importActual<
        typeof import("../components/editor/manualEditingAvailability")
      >("../components/editor/manualEditingAvailability");
      return { ...actual, STUDIO_FLAT_INSPECTOR_ENABLED: false };
    });
    const { usePanelLayout: usePanelLayoutFlatOff } = await import("./usePanelLayout");
    const harness = renderPanelLayoutWith(usePanelLayoutFlatOff);
    expect(harness.getState().rightInspectorPanes).toEqual({ layers: false, design: true });

    act(() => harness.getState().setRightPanelTab("layers"));
    // Legacy (split-view) behavior: additive, both panes end up open.
    expect(harness.getState().rightInspectorPanes).toEqual({ layers: true, design: true });

    harness.unmount();
  });

  it("setRightPanelTab is flat-aware: exclusivity holds for callers other than a direct in-panel tab click", async () => {
    vi.resetModules();
    vi.doMock("../components/editor/manualEditingAvailability", async () => {
      const actual = await vi.importActual<
        typeof import("../components/editor/manualEditingAvailability")
      >("../components/editor/manualEditingAvailability");
      return { ...actual, STUDIO_FLAT_INSPECTOR_ENABLED: true };
    });
    const { usePanelLayout: usePanelLayoutFlatOn } = await import("./usePanelLayout");
    const harness = renderPanelLayoutWith(usePanelLayoutFlatOn);
    expect(harness.getState().rightInspectorPanes).toEqual({ layers: false, design: true });

    // Element-select / block-params-close / header Inspector-button callers
    // all reach setRightPanelTab directly, not through the in-panel tab
    // click's own setExclusiveRightInspectorPane call — this must still
    // enforce exclusivity under the flat flag, or both tabs end up
    // highlighted while only one pane actually renders.
    act(() => harness.getState().setRightPanelTab("layers"));
    expect(harness.getState().rightInspectorPanes).toEqual({ layers: true, design: false });

    harness.unmount();
  });
});
