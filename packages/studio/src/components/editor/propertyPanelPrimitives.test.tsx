// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { DomEditSelection } from "./domEditingTypes";
import { SelectField } from "./propertyPanelPrimitives";
import { StyleSections } from "./propertyPanelStyleSections";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount());
  }
  roots.length = 0;
  document.body.innerHTML = "";
});

function render(node: React.ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

function findSelect(host: HTMLElement, label: string): HTMLSelectElement {
  const field = Array.from(host.querySelectorAll("label")).find(
    (candidate) => candidate.querySelector("span")?.textContent === label,
  );
  const select = field?.querySelector<HTMLSelectElement>("select");
  if (!select) throw new Error(`Missing select field: ${label}`);
  return select;
}

function expandSection(host: HTMLElement, title: string): void {
  const section = host.querySelector<HTMLElement>(`[data-panel-section="${title}"]`);
  const button = section?.querySelector<HTMLButtonElement>("button");
  if (!button) throw new Error(`Missing panel section: ${title}`);
  act(() => button.click());
}

function createSelection(): DomEditSelection {
  return {
    element: document.createElement("div"),
    id: "card",
    selector: "#card",
    sourceFile: "index.html",
    compositionPath: "index.html",
    label: "Card",
    tagName: "div",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    textContent: null,
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [],
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
  };
}

describe("SelectField unlisted values", () => {
  it("disables an unlisted display-only value only when requested", () => {
    const host = render(
      <div>
        <SelectField
          label="Shadow"
          value="custom"
          disableUnlistedValue
          options={["none", "soft"]}
          onChange={() => undefined}
        />
        <SelectField
          label="Style"
          value="groove"
          options={["none", "solid"]}
          onChange={() => undefined}
        />
      </div>,
    );

    const shadow = findSelect(host, "Shadow");
    expect(shadow.value).toBe("custom");
    expect(shadow.options[0]?.value).toBe("custom");
    expect(shadow.options[0]?.disabled).toBe(true);
    expect(
      Array.from(shadow.options)
        .slice(1)
        .every((option) => !option.disabled),
    ).toBe(true);

    const style = findSelect(host, "Style");
    expect(style.value).toBe("groove");
    expect(style.options[0]?.value).toBe("groove");
    expect(style.options[0]?.disabled).toBe(false);
  });
});

describe("StyleSections curated options", () => {
  it("keeps authored off-list values visible and commits remaining options", () => {
    const calls: Array<[property: string, value: string]> = [];
    const host = render(
      <StyleSections
        projectId="project"
        element={createSelection()}
        styles={{
          "border-style": "groove",
          "border-width": "2px",
          "box-shadow": "0 2px 4px red",
          "clip-path": "polygon(0 0, 100% 0, 100% 100%)",
          overflow: "auto",
        }}
        assets={[]}
        onSetStyle={(property, value) => {
          calls.push([property, value]);
        }}
      />,
    );

    expandSection(host, "stroke");
    expandSection(host, "effects");
    expandSection(host, "clip");

    const strokeStyle = findSelect(host, "Style");
    expect(strokeStyle.value).toBe("groove");
    expect(Array.from(strokeStyle.options, (option) => option.value)).toEqual([
      "groove",
      "none",
      "solid",
      "dashed",
      "dotted",
      "double",
    ]);

    const overflow = findSelect(host, "Overflow");
    expect(overflow.value).toBe("auto");
    expect(Array.from(overflow.options, (option) => option.value)).toEqual([
      "auto",
      "visible",
      "hidden",
      "clip",
    ]);
    expect(findSelect(host, "Shadow").options[0]?.disabled).toBe(true);
    expect(findSelect(host, "Mask").options[0]?.disabled).toBe(true);
    expect(calls).toEqual([]);

    act(() => {
      strokeStyle.value = "dashed";
      strokeStyle.dispatchEvent(new Event("change", { bubbles: true }));
      overflow.value = "hidden";
      overflow.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(calls).toContainEqual(["border-style", "dashed"]);
    expect(calls).toContainEqual(["overflow", "hidden"]);
  });
});
