// @vitest-environment happy-dom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PropertyRow } from "./AnimationCardParts";
import { ColorField } from "./propertyPanelColor";
import { GradientField } from "./propertyPanelFill";
import { DetailField } from "./propertyPanelPrimitives";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function render(element: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(element));
  return { host, root };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("HTMLInputElement value setter is unavailable");
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function renderCommitField(value: string, onCommit: (nextValue: string) => void) {
  const { host, root } = render(<DetailField label="Width" value={value} onCommit={onCommit} />);
  const input = host.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error("CommitField input was not rendered");
  return {
    input,
    rerender(nextValue: string) {
      act(() => root.render(<DetailField label="Width" value={nextValue} onCommit={onCommit} />));
    },
  };
}

describe("inspector input correctness", () => {
  it("preserves a focused CommitField draft across external value refreshes", () => {
    const onCommit = vi.fn();
    const { input, rerender } = renderCommitField("100px", onCommit);

    act(() => input.focus());
    act(() => setInputValue(input, "125px"));
    rerender("110px");

    expect(input.value).toBe("125px");
    act(() => input.blur());
    expect(onCommit).toHaveBeenCalledWith("125px");
  });

  it("does not commit a stale CommitField value when focus was clean", () => {
    const onCommit = vi.fn();
    const { input, rerender } = renderCommitField("100px", onCommit);

    act(() => input.focus());
    rerender("110px");

    expect(input.value).toBe("110px");
    act(() => input.blur());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it.each([
    ["filter", "Blur", "blur(4px)"],
    ["clipPath", "Circle", "circle(50% at 50% 50%)"],
  ])("shows a clicked %s preset in its input", (prop, presetLabel, presetValue) => {
    function Harness() {
      const [value, setValue] = useState("none");
      return (
        <PropertyRow
          prop={prop}
          val={value}
          onCommit={setValue}
          onRemove={() => undefined}
          removeTitle="Remove property"
        />
      );
    }

    const { host } = render(<Harness />);
    const preset = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === presetLabel,
    );
    const input = host.querySelector<HTMLInputElement>('input[type="text"]');
    if (!preset || !input) throw new Error("String property controls were not rendered");

    act(() => preset.click());

    expect(host.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe(presetValue);
  });

  it("selects an existing gradient stop and adds only from empty track space", () => {
    const onCommit = vi.fn();
    const { host } = render(
      <GradientField
        value="linear-gradient(90deg, #000000 0%, #ffffff 100%)"
        fallbackColor={undefined}
        onCommit={onCommit}
      />,
    );
    const track = host.querySelector<HTMLDivElement>('div[style*="background-image"]');
    const firstStop = track?.firstElementChild;
    if (!track || !(firstStop instanceof HTMLElement)) {
      throw new Error("Gradient preview controls were not rendered");
    }
    track.getBoundingClientRect = () => new DOMRect(0, 0, 200, 44);

    act(() => track.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 4 })));

    expect(onCommit).not.toHaveBeenCalled();
    expect(firstStop.getAttribute("aria-pressed")).toBe("true");

    act(() => track.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 100 })));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toContain("#808080 50%");
  });

  it("rolls an invalid hex draft back to the last valid value on blur", () => {
    const onCommit = vi.fn();
    render(<ColorField label="Fill" value="#123456" onCommit={onCommit} />);
    const openButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Pick fill color"]',
    );
    if (!openButton) throw new Error("Color picker button was not rendered");
    act(() => openButton.click());
    const input = document.querySelector<HTMLInputElement>('input[spellcheck="false"]');
    if (!input) throw new Error("Hex input was not rendered");

    act(() => input.focus());
    act(() => setInputValue(input, "not-a-color"));
    expect(input.value).toBe("not-a-color");
    expect(onCommit).not.toHaveBeenCalled();

    act(() => input.blur());

    expect(input.value).toBe("#123456");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
