// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditingTypes";
import { getInlineStyles } from "./domEditingDom";
import { SelectField, SliderControl } from "./propertyPanelPrimitives";
import { StyleSections } from "./propertyPanelStyleSections";
import { BorderRadiusEditor } from "./BorderRadiusEditor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount());
  }
  roots.length = 0;
  document.body.innerHTML = "";
  vi.useRealTimers();
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

function findInput(host: HTMLElement, label: string): HTMLInputElement {
  const field = Array.from(host.querySelectorAll("label")).find((candidate) =>
    Array.from(candidate.querySelectorAll("span")).some((span) => span.textContent === label),
  );
  const input = field?.querySelector<HTMLInputElement>('input[type="text"]');
  if (!input) throw new Error(`Missing input field: ${label}`);
  return input;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("HTMLInputElement value setter is unavailable");
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function slider(value: number, onCommit: (nextValue: number) => void): React.ReactNode {
  return (
    <SliderControl
      value={value}
      min={0}
      max={100}
      step={1}
      displayValue={String(value)}
      onCommit={onCommit}
    />
  );
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

describe("SliderControl commit contract", () => {
  it("flushes the last pending value on unmount", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const host = render(slider(0, onCommit));
    const root = roots.pop();
    const input = host.querySelector<HTMLInputElement>('input[type="range"]');
    if (!root || !input) throw new Error("Slider control was not rendered");

    act(() => {
      setInputValue(input, "20");
      setInputValue(input, "40");
    });
    expect(onCommit).not.toHaveBeenCalled();

    act(() => root.unmount());

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(40);
  });

  it("flushes a pending value to the old target before switching targets", () => {
    vi.useFakeTimers();
    const oldTargetCommit = vi.fn();
    const newTargetCommit = vi.fn();
    const host = render(slider(0, oldTargetCommit));
    const root = roots.at(-1);
    const input = host.querySelector<HTMLInputElement>('input[type="range"]');
    if (!root || !input) throw new Error("Slider control was not rendered");

    act(() => setInputValue(input, "35"));
    act(() => root.render(slider(0, newTargetCommit)));

    expect(oldTargetCommit).toHaveBeenCalledTimes(1);
    expect(oldTargetCommit).toHaveBeenCalledWith(35);
    expect(newTargetCommit).not.toHaveBeenCalled();
  });

  it("makes one trailing commit for a rapid drag", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const host = render(slider(0, onCommit));
    const input = host.querySelector<HTMLInputElement>('input[type="range"]');
    if (!input) throw new Error("Slider control was not rendered");

    act(() => {
      setInputValue(input, "10");
      setInputValue(input, "20");
      setInputValue(input, "30");
    });
    expect(onCommit).not.toHaveBeenCalled();

    act(() => vi.runAllTimers());

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(30);
  });
});

describe("StyleSections curated options", () => {
  it("keeps authored off-list values visible and commits remaining options", () => {
    const calls: Array<[property: string, value: string | null]> = [];
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

describe("StyleSections inline style reset", () => {
  it("detects inline corner-radius longhands from the canonical style snapshot", () => {
    const element = document.createElement("div");
    element.style.setProperty("border-top-left-radius", "12px");

    expect(getInlineStyles(element)).toMatchObject({ "border-top-left-radius": "12px" });
  });

  it("reveals reset on label hover only for an inline override", () => {
    const overridden = createSelection();
    overridden.inlineStyles = { gap: "24px" };
    const host = render(
      <StyleSections
        projectId="project"
        element={overridden}
        styles={{ display: "flex", gap: "24px" }}
        assets={[]}
        onSetStyle={() => undefined}
      />,
    );
    expandSection(host, "flex");

    const reset = host.querySelector<HTMLButtonElement>('[aria-label="Reset Gap"]');
    expect(reset).not.toBeNull();
    expect(reset?.className).toContain("opacity-0");
    expect(reset?.className).toContain("group-hover:opacity-100");

    const authoredOnly = createSelection();
    const root = roots.at(-1);
    if (!root) throw new Error("Missing rendered root");
    act(() =>
      root.render(
        <StyleSections
          projectId="project"
          element={authoredOnly}
          styles={{ display: "flex", gap: "12px" }}
          assets={[]}
          onSetStyle={() => undefined}
        />,
      ),
    );

    expect(host.querySelector('[aria-label="Reset Gap"]')).toBeNull();
  });

  it("resets the inline property and displays the refreshed authored value", () => {
    const element = createSelection();
    element.inlineStyles = { gap: "24px" };
    const onSetStyle = vi.fn<(property: string, value: string | null) => void>();
    const host = render(
      <StyleSections
        projectId="project"
        element={element}
        styles={{ display: "flex", gap: "24px" }}
        assets={[]}
        onSetStyle={onSetStyle}
      />,
    );
    expandSection(host, "flex");

    const reset = host.querySelector<HTMLButtonElement>('[aria-label="Reset Gap"]');
    if (!reset) throw new Error("Missing gap reset");
    act(() => reset.click());
    expect(onSetStyle).toHaveBeenCalledWith("gap", null);

    element.inlineStyles = {};
    const root = roots.at(-1);
    if (!root) throw new Error("Missing rendered root");
    act(() =>
      root.render(
        <StyleSections
          projectId="project"
          element={element}
          styles={{ display: "flex", gap: "12px" }}
          assets={[]}
          onSetStyle={onSetStyle}
        />,
      ),
    );

    expect(findInput(host, "Gap").value).toBe("12px");
    expect(host.querySelector('[aria-label="Reset Gap"]')).toBeNull();
  });
});

describe("BorderRadiusEditor inline style reset", () => {
  it("shows a longhand reset in linked mode when no shorthand reset exists", () => {
    const resetTopLeft = vi.fn();
    const host = render(
      <BorderRadiusEditor
        tl={12}
        tr={12}
        br={12}
        bl={12}
        resets={{ tl: resetTopLeft }}
        onCommit={() => undefined}
      />,
    );

    const reset = host.querySelector<HTMLButtonElement>('[aria-label="Reset All"]');
    if (!reset) throw new Error("Missing linked radius reset");
    act(() => reset.click());
    expect(resetTopLeft).toHaveBeenCalledOnce();
  });
});
