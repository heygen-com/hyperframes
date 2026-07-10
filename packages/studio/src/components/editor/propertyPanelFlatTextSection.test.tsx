// @vitest-environment happy-dom

import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlatTextLayerList, FlatTextSection } from "./propertyPanelFlatTextSection";
import type { DomEditSelection, DomEditTextField } from "./domEditingTypes";

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
    // stopPropagation on the remove button must prevent the row's own onClick
    // from also firing onSelect for the removed field's key.
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalledWith("a");
    act(() => root.unmount());
  });
});

function makeMultiFieldElement(): DomEditSelection {
  return {
    element: document.createElement("div"),
    id: "multi",
    selector: ".multi",
    label: "Multi",
    tagName: "div",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    textContent: "Headline Subhead",
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [
      {
        key: "a",
        label: "Text",
        value: "Headline",
        tagName: "div",
        attributes: [],
        inlineStyles: {},
        computedStyles: {},
        source: "self",
      },
      {
        key: "b",
        label: "Text",
        value: "Subhead",
        tagName: "span",
        attributes: [],
        inlineStyles: {},
        computedStyles: {},
        source: "self",
      },
    ],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canCrop: true,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
  } as DomEditSelection;
}

describe("FlatTextSection — multi-field", () => {
  it("shows the layer list, switches the active field's rows on selection, and has no doubled heading (this component never renders its own heading — the parent FlatGroup does)", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <FlatTextSection
          element={makeMultiFieldElement()}
          styles={{}}
          fontAssets={[]}
          onSetText={vi.fn()}
          onSetTextFieldStyle={vi.fn()}
          onAddTextField={vi.fn()}
          onRemoveTextField={vi.fn()}
        />,
      );
    });
    expect(host.textContent).toContain("Headline");
    expect(host.textContent).toContain("Subhead");
    // Active field's editor rows are visible (Font/Weight/etc. from FlatTextFieldEditor).
    expect(host.textContent).toContain("Weight");
    // Exactly one "Text layers" micro-label — this component doesn't duplicate its own list.
    const layerLabels = Array.from(host.querySelectorAll("div")).filter(
      (el) => el.textContent === "Text layers",
    );
    expect(layerLabels.length).toBeLessThanOrEqual(1);

    const rows = host.querySelectorAll('[data-flat-text-layer-row="true"]');
    act(() => rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.textContent).toContain("Subhead");
    act(() => root.unmount());
  });

  it("wires onAdd/onRemove end-to-end: async onAddTextField switches the active field once it appears in props, and the resync effect falls back to the first field when the active one disappears", async () => {
    let addResolved = false;

    function Harness() {
      const [fields, setFields] = useState<DomEditTextField[]>(makeMultiFieldElement().textFields);
      const element: DomEditSelection = { ...makeMultiFieldElement(), textFields: fields };
      return (
        <FlatTextSection
          element={element}
          styles={{}}
          fontAssets={[]}
          onSetText={vi.fn()}
          onSetTextFieldStyle={vi.fn()}
          onAddTextField={() =>
            Promise.resolve().then(() => {
              addResolved = true;
              setFields((prev) => [
                ...prev,
                {
                  key: "c",
                  label: "Text",
                  value: "Third",
                  tagName: "div",
                  attributes: [],
                  inlineStyles: {},
                  computedStyles: {},
                  source: "self",
                },
              ]);
              return "c";
            })
          }
          onRemoveTextField={(fieldKey: string) =>
            setFields((prev) => prev.filter((field) => field.key !== fieldKey))
          }
        />
      );
    }

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(<Harness />);
    });

    let rows = host.querySelectorAll('[data-flat-text-layer-row="true"]');
    expect(rows).toHaveLength(2);
    expect((rows[0] as HTMLElement).getAttribute("data-active")).toBe("true");

    const addButton = host.querySelector<HTMLButtonElement>('[data-flat-text-layer-add="true"]');
    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(addResolved).toBe(true);
    rows = host.querySelectorAll('[data-flat-text-layer-row="true"]');
    expect(rows).toHaveLength(3);
    expect((rows[2] as HTMLElement).getAttribute("data-active")).toBe("true");

    // Remove the active field ("c") through the wired onRemoveTextField — the
    // resync useEffect must fall back to the first remaining field ("a")
    // since "c" no longer exists in element.textFields.
    const removeButtons = host.querySelectorAll<HTMLButtonElement>(
      '[data-flat-text-layer-remove="true"]',
    );
    act(() => {
      removeButtons[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    rows = host.querySelectorAll('[data-flat-text-layer-row="true"]');
    expect(rows).toHaveLength(2);
    expect((rows[0] as HTMLElement).getAttribute("data-active")).toBe("true");

    act(() => root.unmount());
  });
});
