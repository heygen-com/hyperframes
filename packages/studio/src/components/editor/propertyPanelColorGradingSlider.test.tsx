// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorGradingSliderControl } from "./propertyPanelColorGradingSlider";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function renderSlider(onCommit: (nextValue: number) => void): HTMLInputElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(
      <ColorGradingSliderControl
        label="Contrast"
        value={0}
        min={-100}
        max={100}
        step={1}
        displayValue="0%"
        onCommit={onCommit}
      />,
    );
  });
  const input = host.querySelector<HTMLInputElement>('input[type="range"]');
  if (!input) throw new Error("Color grading slider was not rendered");
  return input;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("HTMLInputElement value setter is unavailable");
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ColorGradingSliderControl commit cadence", () => {
  it("commits drag feedback after 40ms", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const input = renderSlider(onCommit);

    act(() => setInputValue(input, "25"));
    act(() => vi.advanceTimersByTime(39));
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledWith(25);
  });

  it("flushes drag feedback on pointerup", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const input = renderSlider(onCommit);

    act(() => {
      setInputValue(input, "25");
      input.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(25);
  });
});
