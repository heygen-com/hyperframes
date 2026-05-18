// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { usePanelLayout } from "./usePanelLayout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PanelLayoutState = ReturnType<typeof usePanelLayout>;

function renderPanelLayoutHarness(initialState?: Parameters<typeof usePanelLayout>[0]) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  let latest: PanelLayoutState | null = null;

  function Harness() {
    latest = usePanelLayout(initialState);
    return null;
  }

  act(() => {
    root.render(React.createElement(Harness));
  });

  return {
    getState: () => {
      if (!latest) throw new Error("panel layout harness not ready");
      return latest;
    },
    unmount: () =>
      act(() => {
        root.unmount();
        host.remove();
      }),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("usePanelLayout", () => {
  it("defaults to a single design tab", () => {
    const harness = renderPanelLayoutHarness();
    const state = harness.getState();
    expect(state.rightPanelTabs).toEqual(["design"]);
    expect(state.rightPanelFocusTab).toBe("design");
    harness.unmount();
  });

  it("keeps at most two tabs and favors the most recently opened tab", () => {
    const harness = renderPanelLayoutHarness({ rightPanelTabs: ["design"] });

    act(() => {
      harness.getState().focusRightPanelTab("layers");
    });
    expect(harness.getState().rightPanelTabs).toEqual(["design", "layers"]);
    expect(harness.getState().rightPanelFocusTab).toBe("layers");

    act(() => {
      harness.getState().focusRightPanelTab("css");
    });
    expect(harness.getState().rightPanelTabs).toEqual(["layers", "css"]);
    expect(harness.getState().rightPanelFocusTab).toBe("css");

    harness.unmount();
  });

  it("falls back to design when toggling the last opened tab off", () => {
    const harness = renderPanelLayoutHarness({ rightPanelTabs: ["renders"] });

    act(() => {
      harness.getState().toggleRightPanelTab("renders");
    });

    expect(harness.getState().rightPanelTabs).toEqual(["design"]);
    expect(harness.getState().rightPanelFocusTab).toBe("design");
    harness.unmount();
  });
});
