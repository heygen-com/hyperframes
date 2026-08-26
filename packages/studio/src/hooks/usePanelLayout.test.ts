// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStudioUiPreferences } from "../utils/studioUiPreferences";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { usePanelLayout } from "./usePanelLayout";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

beforeEach(() => {
  vi.mocked(trackStudioEvent).mockClear();
  const entries = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return entries.size;
      },
      clear: () => entries.clear(),
      getItem: (key: string) => entries.get(key) ?? null,
      key: (index: number) => Array.from(entries.keys())[index] ?? null,
      removeItem: (key: string) => entries.delete(key),
      setItem: (key: string, value: string) => entries.set(key, value),
    } satisfies Storage,
  });
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

function resizeWindowTo(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
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

  it("tracks only actual right-panel tab changes, including rapid repeated calls", () => {
    const harness = renderPanelLayout();

    act(() => {
      harness.getState().setRightPanelTab("design");
      harness.getState().setRightPanelTab("design");
    });
    expect(trackStudioEvent).not.toHaveBeenCalled();

    act(() => {
      harness.getState().setRightPanelTab("layers");
      harness.getState().setRightPanelTab("layers");
    });
    expect(trackStudioEvent).toHaveBeenCalledOnce();
    expect(trackStudioEvent).toHaveBeenCalledWith("tab_switch", {
      panel: "right_panel",
      tab: "layers",
    });
    expect(harness.getState().rightPanelTab).toBe("layers");

    harness.unmount();
  });

  it("caps a panel relative to the window instead of at a flat 600px", () => {
    resizeWindowTo(700);
    const harness = renderPanelLayout();
    // The old flat cap let the inspector claim 600 of a 700px window.
    expect(harness.getState().rightWidth).toBeLessThanOrEqual(280);
    harness.unmount();
  });

  it("rails both panels once the window cannot fit them", () => {
    resizeWindowTo(560);
    const harness = renderPanelLayout();
    expect(harness.getState()).toMatchObject({
      effectiveLeftCollapsed: true,
      effectiveRightCollapsed: true,
      leftCollapsed: false,
      rightCollapsed: false,
    });
    harness.unmount();
  });

  it("auto-collapse never writes the user's persisted or URL-synced intent", () => {
    const harness = renderPanelLayout();
    act(() => resizeWindowTo(560));

    expect(harness.getState().effectiveLeftCollapsed).toBe(true);
    // localStorage carries leftCollapsed; the shareable URL carries rightCollapsed.
    // A ten-second window drag must rewrite neither.
    expect(readStudioUiPreferences().leftCollapsed).toBeUndefined();
    expect(harness.getState().leftCollapsed).toBe(false);
    expect(harness.getState().rightCollapsed).toBe(false);
    harness.unmount();
  });

  it("returns the user's own width when the window grows back", () => {
    const harness = renderPanelLayout();
    const wide = harness.getState().leftWidth;

    act(() => resizeWindowTo(560));
    expect(harness.getState().leftWidth).toBeLessThan(wide);

    act(() => resizeWindowTo(1496));
    expect(harness.getState().leftWidth).toBe(wide);
    harness.unmount();
  });

  it("keeps an explicitly collapsed sidebar collapsed after a narrow trip", () => {
    const harness = renderPanelLayout();
    act(() => harness.getState().toggleLeftSidebar());
    expect(readStudioUiPreferences().leftCollapsed).toBe(true);

    act(() => resizeWindowTo(560));
    act(() => resizeWindowTo(1496));

    expect(harness.getState().effectiveLeftCollapsed).toBe(true);
    harness.unmount();
  });

  it("lets the user reopen a panel the window auto-collapsed", () => {
    const harness = renderPanelLayout();
    act(() => resizeWindowTo(560));
    expect(harness.getState().effectiveRightCollapsed).toBe(true);

    // Without this the header Inspector button would be dead below 700px.
    act(() => harness.getState().setRightCollapsed(false));
    expect(harness.getState().effectiveRightCollapsed).toBe(false);
    harness.unmount();
  });

  it("opens the sidebar when the rail's own button is clicked", () => {
    const harness = renderPanelLayout();
    act(() => resizeWindowTo(560));
    expect(harness.getState().effectiveLeftCollapsed).toBe(true);

    // Regression: the toggle used to flip stored INTENT, which was already
    // false here, so the click persisted leftCollapsed=true and the rail stayed
    // railed — a dead button that silently saved a collapse nobody asked for.
    act(() => harness.getState().toggleLeftSidebar());

    expect(harness.getState().effectiveLeftCollapsed).toBe(false);
    expect(harness.getState().leftCollapsed).toBe(false);
    expect(readStudioUiPreferences().leftCollapsed).toBe(false);
    // And it gets a real width: rendering an expanded sidebar at the 42px rail
    // width would squash its own content. Only a real-UI click caught this.
    expect(harness.getState().leftWidth).toBeGreaterThanOrEqual(200);
    harness.unmount();
  });

  it("closes the sidebar again on the next click", () => {
    const harness = renderPanelLayout();
    act(() => resizeWindowTo(560));
    act(() => harness.getState().toggleLeftSidebar());
    act(() => harness.getState().toggleLeftSidebar());

    expect(harness.getState().effectiveLeftCollapsed).toBe(true);
    expect(readStudioUiPreferences().leftCollapsed).toBe(true);
    harness.unmount();
  });

  it("forgets that reopen once the window is wide again", () => {
    const harness = renderPanelLayout();
    act(() => resizeWindowTo(560));
    act(() => harness.getState().setRightCollapsed(false));
    expect(harness.getState().effectiveRightCollapsed).toBe(false);

    // Widening past the threshold clears the override, so a later narrow trip
    // rails again rather than staying open forever off one old click.
    act(() => resizeWindowTo(1496));
    act(() => resizeWindowTo(560));
    expect(harness.getState().effectiveRightCollapsed).toBe(true);
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

    // The flat inspector can change its visible pane without changing the
    // umbrella rightPanelTab value. A later element selection must still bring
    // Design back even though rightPanelTab already says "design".
    act(() => harness.getState().setExclusiveRightInspectorPane("layers"));
    expect(harness.getState()).toMatchObject({
      rightPanelTab: "design",
      rightInspectorPanes: { layers: true, design: false },
    });
    act(() => harness.getState().setRightPanelTab("design"));
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
