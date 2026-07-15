// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePanelLayout } from "./usePanelLayout";

vi.mock("../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type PanelLayout = ReturnType<typeof usePanelLayout>;
const ORIGINAL_INNER_WIDTH = window.innerWidth;

function mountPanelLayout() {
  let layout: PanelLayout | null = null;

  function Probe() {
    layout = usePanelLayout();
    return null;
  }

  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Probe />));

  return {
    getLayout() {
      if (!layout) throw new Error("panel layout did not initialize");
      return layout;
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

afterEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: ORIGINAL_INNER_WIDTH });
  localStorage.clear();
});

describe("usePanelLayout persistence", () => {
  it("restores panel widths after a remount", () => {
    const first = mountPanelLayout();

    act(() => {
      first.getLayout().setLeftWidth(312);
      first.getLayout().setRightWidth(448);
    });
    first.unmount();

    const second = mountPanelLayout();
    expect(second.getLayout().leftWidth).toBe(312);
    expect(second.getLayout().rightWidth).toBe(448);
    second.unmount();
  });

  it("clamps persisted widths through the public setters", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    const first = mountPanelLayout();

    act(() => {
      first.getLayout().setLeftWidth(1);
      first.getLayout().setRightWidth(1000);
    });
    expect(first.getLayout().leftWidth).toBe(160);
    expect(first.getLayout().rightWidth).toBe(600);
    first.unmount();

    const second = mountPanelLayout();
    expect(second.getLayout().leftWidth).toBe(160);
    expect(second.getLayout().rightWidth).toBe(600);
    second.unmount();
  });
});
