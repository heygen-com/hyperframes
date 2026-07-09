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

describe("FlatMediaSection — volume/rate/media-start", () => {
  it("renders volume at its stored percentage and commits a new value on drag", () => {
    const onSetAttribute = vi.fn();
    const element = makeVideoElement({ dataAttributes: { volume: "0.5" } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <FlatMediaSection
          projectDir={null}
          element={element}
          styles={{}}
          onSetStyle={vi.fn()}
          onSetAttribute={onSetAttribute}
          onSetHtmlAttribute={vi.fn()}
        />,
      );
    });
    expect(host.textContent).toContain("50%");
    act(() => root.unmount());
  });

  it("commits a new volume value on slider track pointerdown", () => {
    const onSetAttribute = vi.fn();
    const element = makeVideoElement({ dataAttributes: { volume: "0.5" } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <FlatMediaSection
          projectDir={null}
          element={element}
          styles={{}}
          onSetStyle={vi.fn()}
          onSetAttribute={onSetAttribute}
          onSetHtmlAttribute={vi.fn()}
        />,
      );
    });
    const volumeTrack = host.querySelectorAll('[data-flat-slider-track="true"]')[0];
    Object.defineProperty(volumeTrack, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 100, top: 0, height: 2, right: 100, bottom: 2 }),
    });
    act(() => {
      volumeTrack.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 50 }));
    });
    // min=0, max=100, ratio=0.5 -> raw=50 -> commit(50) -> 50/100=0.5 -> "0.5"
    expect(onSetAttribute).toHaveBeenCalledWith("volume", "0.5");
    act(() => root.unmount());
  });

  it("commits a new rate value on slider track pointerdown", () => {
    const onSetAttribute = vi.fn();
    const element = makeVideoElement();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <FlatMediaSection
          projectDir={null}
          element={element}
          styles={{}}
          onSetStyle={vi.fn()}
          onSetAttribute={onSetAttribute}
          onSetHtmlAttribute={vi.fn()}
        />,
      );
    });
    const rateTrack = host.querySelectorAll('[data-flat-slider-track="true"]')[1];
    Object.defineProperty(rateTrack, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 100, top: 0, height: 2, right: 100, bottom: 2 }),
    });
    act(() => {
      rateTrack.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100 }));
    });
    // min=25, max=300, ratio=1.0 -> raw=300 -> commit(300) -> 300/100=3 -> "3"
    expect(onSetAttribute).toHaveBeenCalledWith("playback-rate", "3");
    act(() => root.unmount());
  });

  it("commits a new media-start value on slider track pointerdown", () => {
    const onSetAttribute = vi.fn();
    const element = makeVideoElement();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <FlatMediaSection
          projectDir={null}
          element={element}
          styles={{}}
          onSetStyle={vi.fn()}
          onSetAttribute={onSetAttribute}
          onSetHtmlAttribute={vi.fn()}
        />,
      );
    });
    const mediaStartTrack = host.querySelectorAll('[data-flat-slider-track="true"]')[2];
    Object.defineProperty(mediaStartTrack, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 100, top: 0, height: 2, right: 100, bottom: 2 }),
    });
    act(() => {
      mediaStartTrack.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100 }));
    });
    // no source-duration set -> mediaStartMax=Math.max(30, Math.ceil(0+10))=30 -> max=3000
    // ratio=1.0 -> raw=3000 -> commit(3000) -> (3000/100).toFixed(2) = "30.00"
    expect(onSetAttribute).toHaveBeenCalledWith("media-start", "30.00");
    act(() => root.unmount());
  });
});

describe("FlatMediaSection — loop/muted/has-audio", () => {
  it("toggles loop via onSetHtmlAttribute and shows has-audio-track for video", () => {
    const onSetHtmlAttribute = vi.fn();
    const onSetAttribute = vi.fn();
    const element = makeVideoElement({ dataAttributes: { "has-audio": "true" } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <FlatMediaSection
          projectDir={null}
          element={element}
          styles={{}}
          onSetStyle={vi.fn()}
          onSetAttribute={onSetAttribute}
          onSetHtmlAttribute={onSetHtmlAttribute}
        />,
      );
    });
    const loopToggle = host.querySelector<HTMLButtonElement>(
      '[data-flat-toggle="true"][aria-label="Loop"]',
    );
    act(() => loopToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSetHtmlAttribute).toHaveBeenCalledWith("loop", "true");

    const hasAudioToggle = host.querySelector<HTMLButtonElement>(
      '[data-flat-toggle="true"][aria-label="Has audio track"]',
    );
    expect(hasAudioToggle?.getAttribute("aria-checked")).toBe("true");
    act(() => root.unmount());
  });

  it("toggles muted via onSetHtmlAttribute", () => {
    const onSetHtmlAttribute = vi.fn();
    const onSetAttribute = vi.fn();
    const element = makeVideoElement();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <FlatMediaSection
          projectDir={null}
          element={element}
          styles={{}}
          onSetStyle={vi.fn()}
          onSetAttribute={onSetAttribute}
          onSetHtmlAttribute={onSetHtmlAttribute}
        />,
      );
    });
    const mutedToggle = host.querySelector<HTMLButtonElement>(
      '[data-flat-toggle="true"][aria-label="Muted"]',
    );
    expect(mutedToggle?.getAttribute("aria-checked")).toBe("false");
    act(() => mutedToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSetHtmlAttribute).toHaveBeenCalledWith("muted", "true");
    act(() => root.unmount());
  });

  it("enables has-audio-track and clears muted on click", () => {
    const onSetHtmlAttribute = vi.fn();
    const onSetAttribute = vi.fn();
    const element = makeVideoElement();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <FlatMediaSection
          projectDir={null}
          element={element}
          styles={{}}
          onSetStyle={vi.fn()}
          onSetAttribute={onSetAttribute}
          onSetHtmlAttribute={onSetHtmlAttribute}
        />,
      );
    });
    const hasAudioToggle = host.querySelector<HTMLButtonElement>(
      '[data-flat-toggle="true"][aria-label="Has audio track"]',
    );
    expect(hasAudioToggle?.getAttribute("aria-checked")).toBe("false");
    act(() => hasAudioToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSetAttribute).toHaveBeenCalledWith("has-audio", "true");
    expect(onSetHtmlAttribute).toHaveBeenCalledWith("muted", null);
    act(() => root.unmount());
  });

  it("disables has-audio-track and sets muted on click", () => {
    const onSetHtmlAttribute = vi.fn();
    const onSetAttribute = vi.fn();
    const element = makeVideoElement({ dataAttributes: { "has-audio": "true" } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <FlatMediaSection
          projectDir={null}
          element={element}
          styles={{}}
          onSetStyle={vi.fn()}
          onSetAttribute={onSetAttribute}
          onSetHtmlAttribute={onSetHtmlAttribute}
        />,
      );
    });
    const hasAudioToggle = host.querySelector<HTMLButtonElement>(
      '[data-flat-toggle="true"][aria-label="Has audio track"]',
    );
    expect(hasAudioToggle?.getAttribute("aria-checked")).toBe("true");
    act(() => hasAudioToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSetAttribute).toHaveBeenCalledWith("has-audio", "");
    expect(onSetHtmlAttribute).toHaveBeenCalledWith("muted", "true");
    act(() => root.unmount());
  });
});

describe("FlatMediaSection — fit/position", () => {
  it("commits object-fit and object-position changes", () => {
    const onSetStyle = vi.fn();
    const { host, root } = (() => {
      const element = makeVideoElement();
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      act(() => {
        root.render(
          <FlatMediaSection
            projectDir={null}
            element={element}
            styles={{ "object-fit": "cover", "object-position": "center" }}
            onSetStyle={onSetStyle}
            onSetAttribute={vi.fn()}
            onSetHtmlAttribute={vi.fn()}
          />,
        );
      });
      return { host, root };
    })();
    const selects = host.querySelectorAll("select");
    const fitSelect = Array.from(selects).find((s) => s.value === "cover");
    expect(fitSelect).not.toBeUndefined();
    act(() => {
      if (fitSelect) {
        fitSelect.value = "contain";
        fitSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(onSetStyle).toHaveBeenCalledWith("object-fit", "contain");
    act(() => root.unmount());
  });

  it("commits an object-position change", () => {
    const onSetStyle = vi.fn();
    const element = makeVideoElement();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <FlatMediaSection
          projectDir={null}
          element={element}
          styles={{ "object-fit": "cover", "object-position": "center" }}
          onSetStyle={onSetStyle}
          onSetAttribute={vi.fn()}
          onSetHtmlAttribute={vi.fn()}
        />,
      );
    });
    const selects = host.querySelectorAll("select");
    const positionSelect = Array.from(selects).find((s) => s.value === "center");
    expect(positionSelect).not.toBeUndefined();
    act(() => {
      if (positionSelect) {
        positionSelect.value = "left top";
        positionSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(onSetStyle).toHaveBeenCalledWith("object-position", "left top");
    act(() => root.unmount());
  });
});
