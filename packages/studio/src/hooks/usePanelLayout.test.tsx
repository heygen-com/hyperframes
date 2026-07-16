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
    return (
      <div
        aria-label="Resize test panel"
        onPointerDown={(event) => layout?.handlePanelResizeStart("right", event)}
        onPointerMove={(event) => layout?.handlePanelResizeMove(event)}
        onPointerUp={() => layout?.handlePanelResizeEnd()}
      />
    );
  }

  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Probe />));

  return {
    host,
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
  it("persists a multi-move panel drag once at pointer end", () => {
    const setItem = vi.spyOn(window.localStorage, "setItem");
    const harness = mountPanelLayout();
    const separator = harness.host.querySelector('[aria-label="Resize test panel"]');
    if (!(separator instanceof HTMLElement)) throw new Error("resize separator did not render");

    act(() => {
      separator.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 500, pointerId: 1 }),
      );
      for (const clientX of [510, 520, 530]) {
        separator.dispatchEvent(
          new PointerEvent("pointermove", { bubbles: true, clientX, pointerId: 1 }),
        );
      }
      separator.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 530, pointerId: 1 }),
      );
    });

    expect(harness.getLayout().rightWidth).toBe(370);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("hf-studio-ui-preferences") ?? "{}")).toMatchObject({
      rightPanelWidth: 370,
    });
    harness.unmount();
  });

  it("persists public width updates used by keyboard nudges", () => {
    const setItem = vi.spyOn(window.localStorage, "setItem");
    const harness = mountPanelLayout();

    act(() => harness.getLayout().setRightWidth(416));

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("hf-studio-ui-preferences") ?? "{}")).toMatchObject({
      rightPanelWidth: 416,
    });
    harness.unmount();
  });

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
