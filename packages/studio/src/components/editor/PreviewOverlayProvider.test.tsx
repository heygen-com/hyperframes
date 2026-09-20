// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GridOverlay } from "./GridOverlay";
import { PreviewOverlayProvider } from "./PreviewOverlayProvider";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./usePreviewCompositionRect", () => ({
  usePreviewCompositionRect: () => ({
    left: 12,
    top: 18,
    width: 640,
    height: 360,
    scaleX: 0.5,
    scaleY: 0.5,
  }),
}));

afterEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
});

describe("PreviewOverlayProvider", () => {
  it("derives grid geometry from the provider iframe and exposes it to the grid part", () => {
    window.localStorage.setItem(
      "hf-studio-ui-preferences",
      JSON.stringify({ gridVisible: true, gridSpacing: 20 }),
    );
    const host = document.createElement("div");
    document.body.append(host);

    act(() => {
      createRoot(host).render(
        <PreviewOverlayProvider iframeRef={{ current: null }}>
          <GridOverlay />
        </PreviewOverlayProvider>,
      );
    });

    const grid = host.querySelector<HTMLElement>('[aria-hidden="true"]');
    expect(grid).not.toBeNull();
    expect([grid?.style.left, grid?.style.top, grid?.style.width, grid?.style.height]).toEqual([
      "12px",
      "18px",
      "640px",
      "360px",
    ]);
    expect(grid?.style.backgroundSize).toBe("10px 10px");
  });
});
