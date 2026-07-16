// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorField } from "./propertyPanelColor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function renderColorField(onCommit: (nextValue: string) => void): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(<ColorField label="Color" value="rgb(255, 0, 0)" onCommit={onCommit} />);
  });
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Pick color color"]');
  if (!trigger) throw new Error("Color picker trigger was not rendered");
  act(() => trigger.click());
  return host;
}

describe("ColorField", () => {
  it("renders label and value inline with a small swatch, no boxed border", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => {
      root.render(<ColorField flat label="Color" value="rgb(255, 176, 32)" onCommit={vi.fn()} />);
    });
    const trigger = host.querySelector<HTMLButtonElement>('[data-flat-color-trigger="true"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.className).not.toContain("border-neutral-800");
    expect(host.textContent).toContain("Color");
  });

  it("commits color-slider feedback after 40ms", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    renderColorField(onCommit);
    const hue = document.querySelector<HTMLElement>('[role="slider"][aria-label="Hue"]');
    if (!hue) throw new Error("Hue slider was not rendered");
    hue.getBoundingClientRect = () => new DOMRect(0, 0, 100, 16);

    act(() => {
      hue.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 50 }),
      );
    });
    act(() => vi.advanceTimersByTime(39));
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledWith("rgb(0, 255, 255)");
  });

  it("flushes picker feedback on pointerup", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    renderColorField(onCommit);
    const picker = document.querySelector<HTMLElement>(".cursor-crosshair");
    if (!picker) throw new Error("Saturation picker was not rendered");
    picker.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);

    act(() => {
      picker.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          clientX: 50,
          clientY: 50,
        }),
      );
      picker.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 1,
          clientX: 50,
          clientY: 50,
        }),
      );
    });

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith("rgb(128, 64, 64)");
  });
});
