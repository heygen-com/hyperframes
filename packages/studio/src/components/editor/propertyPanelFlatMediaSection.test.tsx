// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlatMediaSection } from "./propertyPanelFlatMediaSection";
import type { DomEditSelection } from "./domEditing";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function makeVideoElement(overrides: Partial<DomEditSelection> = {}): DomEditSelection {
  const el = document.createElement("video");
  el.setAttribute("src", "assets/intro-loop.mp4");
  return {
    element: el,
    id: "s1-bg",
    selector: "#s1-bg",
    label: "S1 Background",
    tagName: "video",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 1920, height: 1080 },
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
    ...overrides,
  } as DomEditSelection;
}

function renderSection(overrides: Partial<DomEditSelection> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const element = makeVideoElement(overrides);
  act(() => {
    root.render(
      <FlatMediaSection
        projectDir={null}
        element={element}
        styles={{}}
        onSetStyle={vi.fn()}
        onSetAttribute={vi.fn()}
        onSetHtmlAttribute={vi.fn()}
      />,
    );
  });
  return { host, root };
}

describe("FlatMediaSection — source row", () => {
  it("renders the source path and copies it to clipboard on click", () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    const { host, root } = renderSection();
    expect(host.textContent).toContain("assets/intro-loop.mp4");
    const copyButton = host.querySelector<HTMLButtonElement>('[data-flat-media-copy="true"]');
    expect(copyButton).not.toBeNull();
    act(() => copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("assets/intro-loop.mp4");
    act(() => root.unmount());
  });
});

describe("FlatMediaSection — cutout", () => {
  it("shows the WebM label for video and fires background removal on click", async () => {
    const onRemoveBackground = vi.fn().mockResolvedValue({ outputPath: "assets/intro-loop.webm" });
    const onSetHtmlAttribute = vi.fn();
    const onSetAttribute = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const element = makeVideoElement();
    act(() => {
      root.render(
        <FlatMediaSection
          projectDir={null}
          element={element}
          styles={{}}
          onSetStyle={vi.fn()}
          onSetAttribute={onSetAttribute}
          onSetHtmlAttribute={onSetHtmlAttribute}
          onRemoveBackground={onRemoveBackground}
        />,
      );
    });
    expect(host.textContent).toContain("transparent WebM");
    const removeBgButton = host.querySelector<HTMLButtonElement>(
      '[data-flat-media-remove-bg="true"]',
    );
    expect(removeBgButton).not.toBeNull();
    await act(async () => {
      removeBgButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onRemoveBackground).toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("toggles BG plate via FlatToggle", () => {
    const { host, root } = renderSection();
    const plateToggle = host.querySelector<HTMLButtonElement>(
      '[data-flat-toggle="true"][aria-label="BG plate"]',
    );
    expect(plateToggle).not.toBeNull();
    expect(plateToggle?.getAttribute("aria-checked")).toBe("false");
    act(() => plateToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(plateToggle?.getAttribute("aria-checked")).toBe("true");
    act(() => root.unmount());
  });
});
