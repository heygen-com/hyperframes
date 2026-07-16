// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { OffCanvasIndicators } from "./OffCanvasIndicators";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./domEditingLayers", () => ({
  resolveDomEditSelection: vi.fn(async (element: HTMLElement) => ({ element })),
}));

it("rotates an off-canvas indicator with its element", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <OffCanvasIndicators
        rects={[{ key: "card", left: 80, top: 20, width: 40, height: 20, angle: 30 }]}
        elements={{ current: new Map() }}
        compRect={{ left: 0, top: 0, width: 100, height: 100 }}
        selection={null}
        groupSelections={[]}
        activeCompositionPathRef={{ current: null }}
        onSelectionChangeRef={{ current: () => undefined }}
      />,
    );
  });

  const indicator = host.querySelector<HTMLElement>('[role="button"]');
  expect(indicator?.parentElement?.style.transform).toBe("rotate(30deg)");
  expect(indicator?.parentElement?.style.transformOrigin).toBe("center");

  act(() => root.unmount());
  host.remove();
});

it("only enables pointer events on the selectable indicator glyph", async () => {
  const host = document.createElement("div");
  const element = document.createElement("div");
  element.id = "card";
  document.body.append(host);
  document.body.append(element);
  const root = createRoot(host);
  const onSelectionChange = vi.fn();
  act(() => {
    root.render(
      <OffCanvasIndicators
        rects={[{ key: "card", left: 80, top: 20, width: 40, height: 20 }]}
        elements={{ current: new Map([["card", element]]) }}
        compRect={{ left: 0, top: 0, width: 100, height: 100 }}
        selection={null}
        groupSelections={[]}
        activeCompositionPathRef={{ current: null }}
        onSelectionChangeRef={{ current: onSelectionChange }}
      />,
    );
  });

  const glyph = host.querySelector<HTMLElement>('[role="button"]');
  const outline = host.querySelector<HTMLElement>("[data-off-canvas-indicator-outline]");
  expect(glyph?.parentElement?.className).toContain("pointer-events-none");
  expect(outline?.className).toContain("pointer-events-none");
  expect(glyph?.className).toContain("pointer-events-auto");
  expect(glyph?.className).not.toContain("inset-0");

  await act(async () => {
    glyph?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({ element }), {
    revealPanel: true,
  });

  act(() => root.unmount());
  element.remove();
  host.remove();
});
