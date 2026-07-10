// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlatTextLayerList } from "./propertyPanelFlatTextSection";

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

const FIELDS = [
  {
    key: "a",
    label: "Text",
    value: "Headline",
    tagName: "div",
    attributes: [],
    inlineStyles: {},
    computedStyles: {},
    source: "self" as const,
  },
  {
    key: "b",
    label: "Text",
    value: "Subhead",
    tagName: "span",
    attributes: [],
    inlineStyles: {},
    computedStyles: {},
    source: "self" as const,
  },
];

describe("FlatTextLayerList", () => {
  it("lists every field, highlights the active one, and fires onSelect/onAdd/onRemove", () => {
    const onSelect = vi.fn();
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const { host, root } = renderInto(
      <FlatTextLayerList
        fields={FIELDS as never}
        activeFieldKey="a"
        styles={{}}
        onSelect={onSelect}
        onAdd={onAdd}
        onRemove={onRemove}
      />,
    );
    expect(host.textContent).toContain("Headline");
    expect(host.textContent).toContain("Subhead");

    const rows = host.querySelectorAll('[data-flat-text-layer-row="true"]');
    expect(rows).toHaveLength(2);
    expect((rows[0] as HTMLElement).getAttribute("data-active")).toBe("true");
    expect((rows[1] as HTMLElement).getAttribute("data-active")).toBe("false");

    act(() => rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSelect).toHaveBeenCalledWith("b");

    const addButton = host.querySelector<HTMLButtonElement>('[data-flat-text-layer-add="true"]');
    act(() => addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onAdd).toHaveBeenCalledTimes(1);

    const removeButton = host.querySelector<HTMLButtonElement>(
      '[data-flat-text-layer-remove="true"]',
    );
    act(() => removeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onRemove).toHaveBeenCalledWith("a");
    act(() => root.unmount());
  });
});
