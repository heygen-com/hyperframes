// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditingTypes";
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
    const onBatchStyleCommit =
      vi.fn<(selections: DomEditSelection[], property: string, value: string | null) => void>();
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

  it("excludes style-disabled targets and reports the editable count", () => {
    const first = makeSelection("first", { opacity: "0.5" });
    const second = makeSelection("second", { opacity: "0.5" });
    const locked = makeSelection("locked", { opacity: "0.8" }, false);
    const selections = [first, second, locked];
    const onBatchStyleCommit =
      vi.fn<(selections: DomEditSelection[], property: string, value: string | null) => void>();
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
    expect(onBatchStyleCommit.mock.calls[0]?.slice(1)).toEqual(["border-style", "solid"]);
  });
});
