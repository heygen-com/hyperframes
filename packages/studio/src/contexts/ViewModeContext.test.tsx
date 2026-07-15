// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useViewModeState, type ViewModeValue } from "./ViewModeContext";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function mountViewMode(initialViewMode?: ViewModeValue["viewMode"] | null) {
  let value: ViewModeValue | null = null;

  function Probe() {
    value = useViewModeState(initialViewMode);
    return null;
  }

  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Probe />));

  return {
    getValue() {
      if (!value) throw new Error("view mode did not initialize");
      return value;
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("useViewModeState", () => {
  it("honors a legacy top-level storyboard query on initial load", () => {
    window.history.replaceState(null, "", "/?view=storyboard");
    const harness = mountViewMode();

    expect(harness.getValue().viewMode).toBe("storyboard");
    harness.unmount();
  });

  it("does not write a top-level view query when the mode changes", () => {
    const harness = mountViewMode();

    act(() => harness.getValue().setViewMode("storyboard"));

    expect(harness.getValue().viewMode).toBe("storyboard");
    expect(window.location.search).not.toContain("view=");
    harness.unmount();
  });
});
