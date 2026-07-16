// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePanelLayout } from "./usePanelLayout";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
