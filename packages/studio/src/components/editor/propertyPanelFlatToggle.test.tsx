// @vitest-environment happy-dom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { FlatToggle } from "./propertyPanelFlatToggle";
import { renderInto, setupReactActEnvironment } from "./testRenderUtils";

setupReactActEnvironment();

describe("FlatToggle", () => {
  it("renders the off state with a dim label and dim knob, and fires onChange(true) on click", () => {
    const onChange = vi.fn();
    const { host, root } = renderInto(
      <FlatToggle label="Loop" checked={false} onChange={onChange} />,
    );
    const label = host.querySelector('[data-flat-toggle-label="true"]');
    expect(label?.className).toContain("text-panel-text-3");
    const pill = host.querySelector<HTMLButtonElement>('[data-flat-toggle="true"]');
    expect(pill).not.toBeNull();
    act(() => pill?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith(true);
    act(() => root.unmount());
  });

  it("renders the on state with an emphasized label and mint knob, and fires onChange(false) on click", () => {
    const onChange = vi.fn();
    const { host, root } = renderInto(<FlatToggle label="Loop" checked onChange={onChange} />);
    const label = host.querySelector('[data-flat-toggle-label="true"]');
    expect(label?.className).toContain("text-panel-text-2");
    const knob = host.querySelector('[data-flat-toggle-knob="true"]');
    expect(knob?.className).toContain("bg-panel-accent");
    const pill = host.querySelector<HTMLButtonElement>('[data-flat-toggle="true"]');
    act(() => pill?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith(false);
    act(() => root.unmount());
  });

  it("does not fire onChange when disabled", () => {
    const onChange = vi.fn();
    const { host, root } = renderInto(
      <FlatToggle label="Loop" checked={false} disabled onChange={onChange} />,
    );
    const pill = host.querySelector<HTMLButtonElement>('[data-flat-toggle="true"]');
    expect(pill?.disabled).toBe(true);
    act(() => pill?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onChange).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
