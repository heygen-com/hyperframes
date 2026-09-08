// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlatToggle } from "./propertyPanelFlatToggle";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function renderInto(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return { host, root };
}

describe("FlatToggle", () => {
  it("renders the off state with a dim label and dim knob, and fires onChange(true) on click", () => {
    const onChange = vi.fn();
    const { host, root } = renderInto(
      <FlatToggle label="Loop" checked={false} onChange={onChange} />,
    );
    const label = host.querySelector('[data-flat-toggle-label="true"]');
    expect(label?.className).toContain("text-text-3");
    const pill = host.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(pill?.getAttribute("aria-checked")).toBe("false");
    act(() => pill?.click());
    expect(onChange).toHaveBeenCalledWith(true);
    act(() => root.unmount());
  });

  it("renders the on state with an emphasized label and a checked switch, and fires onChange(false) on click", () => {
    const onChange = vi.fn();
    const { host, root } = renderInto(<FlatToggle label="Loop" checked onChange={onChange} />);
    const label = host.querySelector('[data-flat-toggle-label="true"]');
    expect(label?.className).toContain("text-text-2");
    const pill = host.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(pill?.getAttribute("aria-checked")).toBe("true");
    act(() => pill?.click());
    expect(onChange).toHaveBeenCalledWith(false);
    act(() => root.unmount());
  });

  it("does not fire onChange when disabled", () => {
    const onChange = vi.fn();
    const { host, root } = renderInto(
      <FlatToggle label="Loop" checked={false} disabled onChange={onChange} />,
    );
    const pill = host.querySelector<HTMLElement>('[role="switch"]');
    // Base UI renders the switch as a span, so `disabled` is an ARIA state and
    // a data attribute rather than the native property. The look hangs off
    // `data-disabled`; a `disabled:` class here would never match.
    expect(pill?.getAttribute("aria-disabled")).toBe("true");
    expect(pill?.className).toContain("data-[disabled]:opacity-40");
    act(() => pill?.click());
    expect(onChange).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
