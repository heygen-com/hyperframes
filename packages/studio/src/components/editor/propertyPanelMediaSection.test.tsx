// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaSection } from "./propertyPanelMediaSection";
import type { DomEditSelection } from "./domEditing";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function makeImageElement(src: string): DomEditSelection {
  const el = document.createElement("img");
  el.setAttribute("src", src);
  return {
    element: el,
    id: "hero",
    selector: "#hero",
    label: "Hero",
    tagName: "img",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 800, height: 600 },
    textContent: "",
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
  } as DomEditSelection;
}

describe("MediaSection — image cutout", () => {
  it("enables Remove BG for a project-local image and sends the normalized path", async () => {
    const onRemoveBackground = vi
      .fn()
      .mockResolvedValue({ outputPath: "assets/cutouts/portrait-cutout.png" });
    const onSetHtmlAttribute = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <MediaSection
          projectDir={null}
          element={makeImageElement("assets/portrait.jpg")}
          styles={{}}
          onSetStyle={vi.fn()}
          onSetAttribute={vi.fn()}
          onSetHtmlAttribute={onSetHtmlAttribute}
          onRemoveBackground={onRemoveBackground}
        />,
      );
    });
    expect(host.textContent).toContain("transparent PNG image");
    const removeBgButton = host.querySelector<HTMLButtonElement>('[data-media-remove-bg="true"]');
    expect(removeBgButton).not.toBeNull();
    expect(removeBgButton?.disabled).toBe(false);
    await act(async () => {
      removeBgButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onRemoveBackground).toHaveBeenCalledWith(
      "assets/portrait.jpg",
      expect.objectContaining({ quality: "balanced" }),
    );
    expect(onSetHtmlAttribute).toHaveBeenCalledWith("src", "assets/cutouts/portrait-cutout.png");
    act(() => root.unmount());
  });

  it("enables Remove BG when src is a Studio preview URL for an image", async () => {
    const onRemoveBackground = vi
      .fn()
      .mockResolvedValue({ outputPath: "assets/cutouts/portrait-cutout.png" });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <MediaSection
          projectDir={null}
          element={makeImageElement(
            "http://localhost:3012/api/projects/demo/preview/assets/portrait.jpg",
          )}
          styles={{}}
          onSetStyle={vi.fn()}
          onSetAttribute={vi.fn()}
          onSetHtmlAttribute={vi.fn()}
          onRemoveBackground={onRemoveBackground}
        />,
      );
    });
    const removeBgButton = host.querySelector<HTMLButtonElement>('[data-media-remove-bg="true"]');
    expect(removeBgButton?.disabled).toBe(false);
    await act(async () => {
      removeBgButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onRemoveBackground).toHaveBeenCalledWith(
      "assets/portrait.jpg",
      expect.objectContaining({ quality: "balanced" }),
    );
    act(() => root.unmount());
  });

  it("preserves Remove BG for an inlined data-URL image via data-hf-authored-src", async () => {
    const onRemoveBackground = vi
      .fn()
      .mockResolvedValue({ outputPath: "assets/cutouts/portrait-cutout.png" });
    const el = document.createElement("img");
    el.setAttribute("src", "data:image/jpeg;base64,abc");
    el.setAttribute("data-hf-authored-src", "assets/portrait.jpg");
    const element = makeImageElement("data:image/jpeg;base64,abc");
    element.element = el;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <MediaSection
          projectDir={null}
          element={element}
          styles={{}}
          onSetStyle={vi.fn()}
          onSetAttribute={vi.fn()}
          onSetHtmlAttribute={vi.fn()}
          onRemoveBackground={onRemoveBackground}
        />,
      );
    });
    const removeBgButton = host.querySelector<HTMLButtonElement>('[data-media-remove-bg="true"]');
    expect(removeBgButton?.disabled).toBe(false);
    expect(host.textContent).toContain("assets/portrait.jpg");
    await act(async () => {
      removeBgButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onRemoveBackground).toHaveBeenCalledWith(
      "assets/portrait.jpg",
      expect.objectContaining({ createBackgroundPlate: false }),
    );
    act(() => root.unmount());
  });
});
