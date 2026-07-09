// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlatStyleSection } from "./propertyPanelFlatStyleSections";
import type { DomEditSelection } from "./domEditing";
import { buildDefaultGradientModel, serializeGradient } from "./gradientValue";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function makeElement(overrides: Partial<DomEditSelection> = {}): DomEditSelection {
  return {
    element: document.createElement("div"),
    id: "stat-card",
    selector: ".stat-card",
    label: "Stat Card",
    tagName: "div",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 24, y: 120, width: 420, height: 260 },
    textContent: "",
    dataAttributes: {},
    inlineStyles: { "background-color": "#0D0C09" },
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
    ...overrides,
  } as DomEditSelection;
}

function renderSection(
  styles: Record<string, string> = {},
  overrides: Partial<DomEditSelection> = {},
  gsapBorderRadius: { tl: number; tr: number; br: number; bl: number } | null = null,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const element = makeElement(overrides);
  const onSetStyle = vi.fn();
  const mergedStyles = { "background-color": "#0D0C09", "border-width": "0px", ...styles };
  act(() => {
    root.render(
      <FlatStyleSection
        projectId="proj-1"
        element={element}
        styles={mergedStyles}
        assets={[]}
        onSetStyle={onSetStyle}
        gsapBorderRadius={gsapBorderRadius}
      />,
    );
  });
  return { host, root, onSetStyle };
}

function clickSegment(host: HTMLElement, label: string) {
  const segment = Array.from(host.querySelectorAll('[data-flat-segment="true"]')).find(
    (el) => el.textContent === label,
  );
  act(() => segment?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("FlatStyleSection — Fill", () => {
  it("renders the Fill segmented control defaulting to Solid, and a mint Color row when a color is set", () => {
    const { host, root } = renderSection();
    expect(host.textContent).toContain("Fill");
    expect(host.textContent).toContain("Solid");
    const swatch = host.querySelector('[data-flat-color-trigger="true"]');
    expect(swatch).not.toBeNull();
    act(() => root.unmount());
  });

  it("switches to the Gradient field when Gradient is selected", () => {
    const { host, root } = renderSection({
      "background-image": "linear-gradient(90deg, #000, #fff)",
    });
    const gradientSegment = Array.from(host.querySelectorAll('[data-flat-segment="true"]')).find(
      (el) => el.textContent === "Gradient",
    );
    expect(gradientSegment?.className).toContain("text-panel-text-0");
    act(() => root.unmount());
  });

  it("clicking Gradient commits a serialized default gradient built from the current fill color", () => {
    const { host, root, onSetStyle } = renderSection();
    clickSegment(host, "Gradient");
    const expectedGradient = serializeGradient(buildDefaultGradientModel("#0D0C09"));
    expect(onSetStyle).toHaveBeenCalledWith("background-image", expectedGradient);
    act(() => root.unmount());
  });

  it("clicking Solid clears the background-image back to none", () => {
    const { host, root, onSetStyle } = renderSection({
      "background-image": "linear-gradient(90deg, #000, #fff)",
    });
    clickSegment(host, "Solid");
    expect(onSetStyle).toHaveBeenCalledWith("background-image", "none");
    act(() => root.unmount());
  });

  it("clicking Image switches to the image-fill field without committing a style", () => {
    const { host, root, onSetStyle } = renderSection();
    clickSegment(host, "Image");
    expect(host.textContent).toContain("Upload image");
    expect(onSetStyle).not.toHaveBeenCalledWith("background-image", expect.anything());
    act(() => root.unmount());
  });
});

function getFlatRowInput(host: HTMLElement, label: string): HTMLInputElement {
  const rows = Array.from(host.querySelectorAll<HTMLElement>(".group"));
  const row = rows.find((el) => el.querySelector("span")?.textContent === label);
  const input = row?.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error(`expected an input for row "${label}"`);
  return input;
}

async function commitFlatRowInput(host: HTMLElement, label: string, nextValue: string) {
  const input = getFlatRowInput(host, label);
  act(() => {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    nativeInputValueSetter?.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new Event("focusout", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const STROKE_STYLES = {
  "border-width": "1px",
  "border-style": "solid",
  "border-color": "rgba(255,255,255,.12)",
};

describe("FlatStyleSection — Stroke and Radius", () => {
  it("renders the combined stroke row and commits width+style together on blur", () => {
    const { host, root } = renderSection(STROKE_STYLES);
    expect(host.textContent).toContain("Stroke");
    expect(getFlatRowInput(host, "Stroke").value).toBe("1px solid");
    act(() => root.unmount());
  });

  it("commits the stroke row's new width and style together on blur", async () => {
    const { host, root, onSetStyle } = renderSection(STROKE_STYLES);
    await commitFlatRowInput(host, "Stroke", "2px dashed");
    expect(onSetStyle).toHaveBeenCalledWith("border-width", "2px");
    expect(onSetStyle).toHaveBeenCalledWith("border-style", "dashed");
    act(() => root.unmount());
  });

  it("renders a single Radius value with a Linked indicator when corners are uniform", () => {
    const { host, root } = renderSection({ "border-radius": "12px" });
    expect(host.textContent).toContain("Radius");
    expect(getFlatRowInput(host, "Radius").value).toBe("12px");
    expect(host.textContent).toContain("Linked");
    act(() => root.unmount());
  });

  it("commits the radius row's new value to border-radius on blur when corners are uniform", async () => {
    const { host, root, onSetStyle } = renderSection({ "border-radius": "12px" });
    await commitFlatRowInput(host, "Radius", "20px");
    expect(onSetStyle).toHaveBeenCalledWith("border-radius", "20px");
    act(() => root.unmount());
  });

  it("falls back to the legacy BorderRadiusEditor when corners are not uniform", () => {
    const { host, root } = renderSection({}, {}, { tl: 4, tr: 12, br: 4, bl: 4 });
    expect(host.textContent).not.toContain("Linked");
    act(() => root.unmount());
  });

  it("commits a per-corner radius update through the legacy BorderRadiusEditor when unlinked", () => {
    const { host, root, onSetStyle } = renderSection({}, {}, { tl: 4, tr: 12, br: 4, bl: 4 });
    const trInput = Array.from(host.querySelectorAll<HTMLInputElement>("input")).find(
      (el) => el.value === "12",
    );
    if (!trInput) throw new Error("expected the TR corner input");
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeInputValueSetter?.call(trInput, "18");
      trInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      trInput.dispatchEvent(new Event("focusout", { bubbles: true }));
    });
    expect(onSetStyle).toHaveBeenCalledWith("border-top-right-radius", "18px");
    act(() => root.unmount());
  });
});
