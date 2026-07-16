// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditingTypes";
import type { DomStyleBatchCommitArgs } from "../../hooks/domStyleCommit";
import { BatchStyleSections } from "./BatchStyleSections";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function makeSelection(
  id: string,
  computedStyles: Record<string, string>,
  canEditStyles = true,
): DomEditSelection {
  return {
    element: document.createElement("div"),
    id,
    selector: `#${id}`,
    sourceFile: "index.html",
    compositionPath: "index.html",
    label: id,
    tagName: "div",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    textContent: null,
    dataAttributes: {},
    inlineStyles: {},
    computedStyles,
    textFields: [],
    capabilities: {
      canSelect: true,
      canEditStyles,
      canCrop: true,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
  };
}

function render(node: ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("HTMLInputElement value setter is unavailable");
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function isUpdateBuilder(
  value: unknown,
): value is (selection: DomEditSelection) => Array<[property: string, value: string | null]> {
  return typeof value === "function";
}

describe("BatchStyleSections", () => {
  it("shows a shared opacity when every editable target agrees", () => {
    const selections = [
      makeSelection("first", { opacity: "0.5" }),
      makeSelection("second", { opacity: "0.5" }),
    ];
    const host = render(
      <BatchStyleSections selections={selections} onBatchStyleCommit={() => undefined} />,
    );

    const transparency = host.querySelector('[data-panel-section="transparency"]');
    expect(transparency?.textContent).toContain("50%");
    expect(transparency?.textContent).not.toContain("Mixed");
  });

  it("shows Mixed when editable targets have different opacity values", () => {
    const selections = [
      makeSelection("first", { opacity: "0.5" }),
      makeSelection("second", { opacity: "0.8" }),
    ];
    const host = render(
      <BatchStyleSections selections={selections} onBatchStyleCommit={() => undefined} />,
    );

    expect(host.querySelector('[data-panel-section="transparency"]')?.textContent).toContain(
      "Mixed",
    );
  });

  it("commits a fill color to every editable target", () => {
    const first = makeSelection("first", { "background-color": "rgb(255, 0, 0)" });
    const second = makeSelection("second", { "background-color": "rgb(255, 0, 0)" });
    const selections = [first, second];
    const onBatchStyleCommit = vi.fn<(...args: DomStyleBatchCommitArgs) => void>();
    render(<BatchStyleSections selections={selections} onBatchStyleCommit={onBatchStyleCommit} />);
    const openButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Pick fill color color"]',
    );
    if (!openButton) throw new Error("Fill color picker button was not rendered");

    act(() => openButton.click());
    const input = document.querySelector<HTMLInputElement>('input[spellcheck="false"]');
    if (!input) throw new Error("Hex color input was not rendered");
    act(() => input.focus());
    act(() => setInputValue(input, "#336699"));
    act(() => input.blur());

    expect(onBatchStyleCommit).toHaveBeenCalledTimes(1);
    expect(onBatchStyleCommit.mock.calls[0]?.[0]?.[0]).toBe(first);
    expect(onBatchStyleCommit.mock.calls[0]?.[0]?.[1]).toBe(second);
    expect(onBatchStyleCommit.mock.calls[0]?.slice(1)).toEqual([
      "background-color",
      "rgb(51, 102, 153)",
    ]);
  });

  it("uses the anchor fill color for a mixed picker and renders a mixed indicator", () => {
    vi.useFakeTimers();
    const first = makeSelection("first", { "background-color": "rgb(255, 0, 0)" });
    const second = makeSelection("second", { "background-color": "rgb(0, 0, 255)" });
    const onBatchStyleCommit = vi.fn();
    const host = render(
      <BatchStyleSections selections={[first, second]} onBatchStyleCommit={onBatchStyleCommit} />,
    );
    const openButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Pick fill color color"]',
    );
    if (!openButton) throw new Error("Fill color picker button was not rendered");

    expect(openButton.textContent).toContain("rgb(255, 0, 0)");
    expect(openButton.querySelector('[data-color-mixed-indicator="true"]')).not.toBeNull();

    act(() => openButton.click());
    const alpha = document.querySelector<HTMLElement>('[role="slider"][aria-label="Alpha"]');
    if (!alpha) throw new Error("Alpha slider was not rendered");
    alpha.getBoundingClientRect = () => new DOMRect(0, 0, 100, 16);
    act(() => {
      alpha.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 50 }),
      );
      alpha.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
    });

    expect(onBatchStyleCommit).toHaveBeenCalledWith(
      [first, second],
      "background-color",
      "rgba(255, 0, 0, 0.5)",
    );
    vi.useRealTimers();
  });

  it("plans stroke width updates from each target's own border style", () => {
    const first = makeSelection("first", {
      "border-width": "0px",
      "border-style": "none",
    });
    const second = makeSelection("second", {
      "border-width": "2px",
      "border-style": "dashed",
    });
    const calls: unknown[][] = [];
    const host = render(
      <BatchStyleSections
        selections={[first, second]}
        onBatchStyleCommit={(...args) => {
          calls.push(args);
        }}
      />,
    );
    const input = host.querySelector<HTMLInputElement>(
      '[data-panel-section="stroke"] input[type="text"]',
    );
    if (!input) throw new Error("Stroke width input was not rendered");

    act(() => input.focus());
    act(() => setInputValue(input, "4"));
    act(() => input.blur());

    const builder = calls[0]?.[1];
    if (!isUpdateBuilder(builder)) throw new Error("Expected a per-target update builder");
    expect(builder(first)).toEqual([
      ["border-width", "4px"],
      ["border-style", "solid"],
    ]);
    expect(builder(second)).toEqual([["border-width", "4px"]]);
  });

  it("plans stroke style updates from each target's own border width", () => {
    const first = makeSelection("first", {
      "border-width": "0px",
      "border-style": "none",
    });
    const second = makeSelection("second", {
      "border-width": "2px",
      "border-style": "dashed",
    });
    const calls: unknown[][] = [];
    const host = render(
      <BatchStyleSections
        selections={[first, second]}
        onBatchStyleCommit={(...args) => {
          calls.push(args);
        }}
      />,
    );
    const style = host.querySelector<HTMLSelectElement>('[data-panel-section="stroke"] select');
    if (!style) throw new Error("Stroke style input was not rendered");

    act(() => {
      style.value = "solid";
      style.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const builder = calls[0]?.[1];
    if (!isUpdateBuilder(builder)) throw new Error("Expected a per-target update builder");
    expect(builder(first)).toEqual([
      ["border-style", "solid"],
      ["border-width", "1px"],
    ]);
    expect(builder(second)).toEqual([["border-style", "solid"]]);
  });

  it("excludes style-disabled targets and reports the editable count", () => {
    const first = makeSelection("first", { opacity: "0.5" });
    const second = makeSelection("second", { opacity: "0.5" });
    const locked = makeSelection("locked", { opacity: "0.8" }, false);
    const selections = [first, second, locked];
    const onBatchStyleCommit = vi.fn<(...args: DomStyleBatchCommitArgs) => void>();
    const host = render(
      <BatchStyleSections selections={selections} onBatchStyleCommit={onBatchStyleCommit} />,
    );

    expect(host.textContent).toContain("2 of 3 selected elements are editable");
    expect(host.querySelector('[data-panel-section="transparency"]')?.textContent).toContain("50%");
    expect(host.querySelector('[data-panel-section="transparency"]')?.textContent).not.toContain(
      "Mixed",
    );

    const style = host.querySelector<HTMLSelectElement>('[data-panel-section="stroke"] select');
    if (!style) throw new Error("Stroke style field was not rendered");
    act(() => {
      style.value = "solid";
      style.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onBatchStyleCommit.mock.calls[0]?.[0]).toEqual([first, second]);
    const builder = onBatchStyleCommit.mock.calls[0]?.[1];
    if (!isUpdateBuilder(builder)) throw new Error("Expected a per-target update builder");
    expect(builder(first)).toEqual([
      ["border-style", "solid"],
      ["border-width", "1px"],
    ]);
  });

  it("renders only the count note when every selected target is style-locked", () => {
    const selections = [
      makeSelection("first", { opacity: "0.5" }, false),
      makeSelection("second", { opacity: "0.8" }, false),
    ];
    const onBatchStyleCommit = vi.fn();
    const host = render(
      <BatchStyleSections selections={selections} onBatchStyleCommit={onBatchStyleCommit} />,
    );

    expect(host.textContent).toContain("0 of 2 selected elements are editable");
    expect(host.textContent).toContain("No selected elements support batch style editing.");
    expect(host.querySelector("input, select")).toBeNull();
    expect(onBatchStyleCommit).not.toHaveBeenCalled();
  });
});
