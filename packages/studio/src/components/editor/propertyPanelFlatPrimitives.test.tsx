// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FlatGroup,
  FlatRow,
  FlatSegmentedRow,
  PinnedZoneDivider,
} from "./propertyPanelFlatPrimitives";

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

describe("FlatRow", () => {
  it("renders the default tier with no reset button", () => {
    const { host, root } = renderInto(
      <FlatRow label="Weight" value="400 · Regular" tier="default" onCommit={vi.fn()} />,
    );
    const value = host.querySelector('[data-flat-row-value="true"]');
    expect(value?.className).toContain("text-panel-text-3");
    expect(host.querySelector('[data-flat-row-reset="true"]')).toBeNull();
    act(() => root.unmount());
  });

  it("renders the explicitCustom tier with a mint value and a reset button", () => {
    const onReset = vi.fn();
    const { host, root } = renderInto(
      <FlatRow
        label="Letter spacing"
        value="3.96px"
        tier="explicitCustom"
        onCommit={vi.fn()}
        onReset={onReset}
      />,
    );
    const value = host.querySelector('[data-flat-row-value="true"]');
    expect(value?.className).toContain("text-panel-accent");
    const reset = host.querySelector<HTMLButtonElement>('[data-flat-row-reset="true"]');
    expect(reset).not.toBeNull();
    act(() => reset?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onReset).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("commits edits through the underlying CommitField input", () => {
    const onCommit = vi.fn();
    const { host, root } = renderInto(
      <FlatRow label="Size" value="22px" tier="explicitDefault" onCommit={onCommit} />,
    );
    const input = host.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("expected an input");
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeInputValueSetter?.call(input, "24px");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new Event("focusout", { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledWith("24px");
    act(() => root.unmount());
  });
});

describe("FlatSegmentedRow", () => {
  it("underlines the active option in mint and leaves others muted", () => {
    const onChange = vi.fn();
    const { host, root } = renderInto(
      <FlatSegmentedRow
        label="Align"
        options={[
          { key: "left", node: "L", active: false },
          { key: "right", node: "R", active: true },
        ]}
        onChange={onChange}
      />,
    );
    const options = host.querySelectorAll('[data-flat-segment="true"]');
    expect(options).toHaveLength(2);
    expect((options[0] as HTMLElement).className).toContain("text-panel-text-4");
    expect((options[1] as HTMLElement).className).toContain("border-panel-accent");
    act(() =>
      (options[0] as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(onChange).toHaveBeenCalledWith("left");
    act(() => root.unmount());
  });
});

describe("FlatGroup", () => {
  it("renders the open header (name + pin + caret) and shows children", () => {
    const onToggleOpen = vi.fn();
    const onTogglePin = vi.fn();
    const { host, root } = renderInto(
      <FlatGroup
        title="Text"
        isOpen
        isPinned={false}
        onToggleOpen={onToggleOpen}
        onTogglePin={onTogglePin}
      >
        <div data-testid="body">body</div>
      </FlatGroup>,
    );
    expect(host.querySelector('[data-testid="body"]')).not.toBeNull();
    const pin = host.querySelector<HTMLButtonElement>('[data-flat-group-pin="true"]');
    act(() => pin?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onTogglePin).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("renders the collapsed row (name + summary + caret-right) and no children", () => {
    const onToggleOpen = vi.fn();
    const { host, root } = renderInto(
      <FlatGroup
        title="Style"
        isOpen={false}
        isPinned={false}
        onToggleOpen={onToggleOpen}
        onTogglePin={vi.fn()}
        summary="fill none · 100%"
      >
        <div data-testid="body">body</div>
      </FlatGroup>,
    );
    expect(host.querySelector('[data-testid="body"]')).toBeNull();
    expect(host.textContent).toContain("fill none · 100%");
    const row = host.querySelector<HTMLButtonElement>('[data-flat-group-collapsed="true"]');
    act(() => row?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onToggleOpen).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});

describe("PinnedZoneDivider", () => {
  it("renders the 'one open below' label", () => {
    const { host, root } = renderInto(<PinnedZoneDivider />);
    expect(host.textContent).toContain("one open below");
    act(() => root.unmount());
  });
});
