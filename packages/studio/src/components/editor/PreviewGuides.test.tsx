// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewGuides } from "./PreviewGuides";
import { usePreviewGuidesStore } from "./previewGuidesStore";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const compRect = vi.hoisted(() => ({
  current: { left: 20, top: 20, width: 400, height: 225, scaleX: 1, scaleY: 1 },
}));
vi.mock("./useDomEditCompositionRect", () => ({
  useDomEditCompositionRect: () => compRect.current,
}));

afterEach(() => {
  compRect.current = { left: 20, top: 20, width: 400, height: 225, scaleX: 1, scaleY: 1 };
  document.body.innerHTML = "";
  window.localStorage.clear();
});

function render(rulerVisible: boolean, safeMarginsVisible: boolean) {
  usePreviewGuidesStore.setState({ rulerVisible, safeMarginsVisible });
  const host = document.createElement("div");
  document.body.append(host);
  act(() => {
    createRoot(host).render(<PreviewGuides iframeRef={{ current: null }} />);
  });
  return host;
}

describe("PreviewGuides", () => {
  it("draws nothing when both toggles are off", () => {
    const host = render(false, false);
    expect(host.querySelector("[data-testid]")).toBeNull();
  });

  it("draws the ruler with ticks 0 to 100 every 10 on both edges", () => {
    const host = render(true, false);
    const top = host.querySelector('[data-testid="preview-ruler-top"]');
    expect(Array.from(top?.children ?? []).map((t) => t.textContent)).toEqual(
      Array.from({ length: 11 }, (_, i) => String(i * 10)),
    );
    expect(host.querySelector('[data-testid="preview-ruler-left"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="preview-safe-action"]')).toBeNull();
  });

  it("draws the wide safe boxes and the caption band", () => {
    const host = render(false, true);
    expect(host.querySelector('[data-testid="preview-safe-action"]')?.textContent).toBe(
      "Action-safe 93%",
    );
    expect(host.querySelector('[data-testid="preview-safe-title"]')?.textContent).toBe(
      "Title-safe 90%",
    );
    expect(host.querySelector('[data-testid="preview-safe-captions"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="preview-ruler-top"]')).toBeNull();
  });

  it("places the ruler in the gutter outside the frame", () => {
    const host = render(true, false);
    const top = host.querySelector<HTMLElement>('[data-testid="preview-ruler-top"]');
    const left = host.querySelector<HTMLElement>('[data-testid="preview-ruler-left"]');
    expect([top?.style.left, top?.style.top, top?.style.width]).toEqual(["20px", "4px", "400px"]);
    expect([left?.style.left, left?.style.top, left?.style.height]).toEqual([
      "4px",
      "20px",
      "225px",
    ]);
  });

  it("insets the wide boxes 3.5% and 5% and ends the caption band at the title-safe bottom", () => {
    const host = render(false, true);
    const box = (id: string) =>
      host.querySelector<HTMLElement>(`[data-testid="preview-safe-${id}"]`)?.style;
    expect([box("action")?.left, box("action")?.top]).toEqual(["3.5%", "3.5%"]);
    expect([box("title")?.right, box("title")?.bottom]).toEqual(["5%", "5%"]);
    const band = box("captions");
    expect(band?.top).toBe("87%");
    expect(band?.height).toBe("8%");
    expect([band?.left, band?.right]).toEqual(["5%", "5%"]);
  });

  it("draws nothing until the composition has a size", () => {
    compRect.current = { left: 0, top: 0, width: 0, height: 0, scaleX: 1, scaleY: 1 };
    const host = render(true, true);
    expect(host.querySelector("[data-testid]")).toBeNull();
  });

  it("uses the vertical box on a portrait composition", () => {
    compRect.current = { left: 20, top: 20, width: 225, height: 400, scaleX: 1, scaleY: 1 };
    const host = render(false, true);
    const style = host.querySelector<HTMLElement>('[data-testid="preview-safe-vertical"]')?.style;
    expect(style?.top).toBe("13.021%");
    expect(host.querySelector('[data-testid="preview-safe-action"]')).toBeNull();
    const band = host.querySelector<HTMLElement>('[data-testid="preview-safe-captions"]')?.style;
    expect([band?.left, band?.right]).toEqual(["12.963%", "12.963%"]);
    expect(band?.top).toBe("66.792%");
  });
});
