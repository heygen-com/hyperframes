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
  it("renders unity volume as neutral 0 dB at the slider midpoint", () => {
    const onSetAttribute = vi.fn();
    const element = makeVideoElement({ dataAttributes: { volume: "1" } });
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
    expect(host.textContent).toContain("0.0 dB");
    expect(
      host.querySelector('[data-flat-slider-track="true"]')?.getAttribute("aria-valuenow"),
    ).toBe("0");
    act(() => root.unmount());
  });

  it("commits +12 dB of boost from the upper half of the volume fader", () => {
    const onSetAttribute = vi.fn();
    const element = makeVideoElement({ dataAttributes: { volume: "1" } });
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
      volumeTrack.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100 }));
      volumeTrack.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 100 }));
    });
    // Six decimals, not two: at two the bottom of the dB fader collapses onto
    // "0" (a hard mute) and every stop below unity writes a value the knob then
    // jumps away from.
    expect(onSetAttribute).toHaveBeenCalledWith("volume", "3.981072");
    act(() => root.unmount());
  });

  it("writes through the envelope instead of the attribute once volume is automated", () => {
    const onSetAttribute = vi.fn();
    const onCommitVolumeAt = vi.fn();
    const element = makeVideoElement({ dataAttributes: { volume: "1" } });
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
          volumeAutomated
          onCommitVolumeAt={onCommitVolumeAt}
        />,
      );
    });
    const volumeTrack = host.querySelectorAll('[data-flat-slider-track="true"]')[0];
    Object.defineProperty(volumeTrack, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 100, top: 0, height: 2, right: 100, bottom: 2 }),
    });
    act(() => {
      volumeTrack.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100 }));
      volumeTrack.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 100 }));
    });
    expect(onCommitVolumeAt).toHaveBeenCalledTimes(1);
    expect(onCommitVolumeAt.mock.calls[0][0]).toBeCloseTo(3.981072, 6);
    expect(onSetAttribute).not.toHaveBeenCalledWith("volume", expect.anything());
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
      rateTrack.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 100 }));
    });
    // the speed slider is log-scaled 0.1x..10x, so the far end of the track is 10x
    expect(onSetAttribute).toHaveBeenCalledWith("playback-rate", "10");
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
      mediaStartTrack.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 100 }));
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

function makeAudioElement(dataAttributes: Record<string, string> = {}): DomEditSelection {
  const el = document.createElement("audio");
  el.setAttribute("src", "assets/music.wav");
  return makeVideoElement({
    element: el,
    id: "music",
    selector: "#music",
    label: "Music",
    tagName: "audio",
    dataAttributes: { duration: "10", ...dataAttributes },
  });
}

function renderWithRate(element: DomEditSelection, onSetAttribute = vi.fn()) {
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
        rate={{
          automated: false,
          automatedValue: undefined,
          onAutomate: vi.fn(),
          onRemoveAutomation: vi.fn(),
          onCommitAt: vi.fn(),
          canApplyPreset: true,
          onApplyPreset: vi.fn(),
        }}
      />,
    );
  });
  return { host, root, onSetAttribute };
}

function labelsOf(host: HTMLElement): string[] {
  return [...host.querySelectorAll('[data-flat-slider-track="true"]')].map(
    (track) => track.getAttribute("aria-label") ?? "",
  );
}

describe("FlatMediaSection — audio clips", () => {
  it("offers speed presets on video but not on audio", () => {
    const video = renderWithRate(makeVideoElement({ dataAttributes: { duration: "10" } }));
    expect(video.host.textContent).toContain("Speed preset");
    act(() => video.root.unmount());

    const audio = renderWithRate(makeAudioElement());
    expect(audio.host.textContent).not.toContain("Speed preset");
    act(() => audio.root.unmount());
  });

  it("shows Fade in / Fade out rows for audio, and for video only when it carries audio", () => {
    const audio = renderWithRate(makeAudioElement());
    expect(labelsOf(audio.host)).toEqual(
      expect.arrayContaining(["Volume", "Speed", "Media start", "Fade in", "Fade out"]),
    );
    act(() => audio.root.unmount());

    const silentVideo = renderWithRate(makeVideoElement({ dataAttributes: { duration: "10" } }));
    expect(labelsOf(silentVideo.host)).not.toContain("Fade in");
    act(() => silentVideo.root.unmount());

    const audibleVideo = renderWithRate(
      makeVideoElement({ dataAttributes: { duration: "10", "has-audio": "true" } }),
    );
    expect(labelsOf(audibleVideo.host)).toContain("Fade out");
    act(() => audibleVideo.root.unmount());
  });

  it("reads the authored fades and writes data-fade-in from the slider, clearing it at zero", () => {
    const { host, root, onSetAttribute } = renderWithRate(
      makeAudioElement({ "fade-in": "0.5", "fade-out": "2" }),
    );
    const readouts = [...host.querySelectorAll('[data-flat-slider-value="true"]')].map(
      (node) => node.textContent,
    );
    expect(readouts).toEqual(expect.arrayContaining(["0.50s", "2.00s"]));

    const fadeInTrack = host.querySelector<HTMLElement>(
      '[data-flat-slider-track="true"][aria-label="Fade in"]',
    );
    if (!fadeInTrack) throw new Error("expected a Fade in slider");
    Object.defineProperty(fadeInTrack, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 100, top: 0, height: 2, right: 100, bottom: 2 }),
    });
    // The fade slider spans the clip (10 s): a quarter of the way is 2.5 s.
    act(() => {
      fadeInTrack.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 25 }));
      fadeInTrack.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 25 }));
    });
    expect(onSetAttribute).toHaveBeenCalledWith("fade-in", "2.5");
    act(() => {
      fadeInTrack.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 0 }));
      fadeInTrack.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 0 }));
    });
    // An empty write removes the attribute rather than leaving data-fade-in="0" behind.
    expect(onSetAttribute).toHaveBeenCalledWith("fade-in", "");
    act(() => root.unmount());
  });

  it("commits a typed volume in dB and a typed fade in seconds", () => {
    const { host, root, onSetAttribute } = renderWithRate(makeAudioElement());
    const readouts = host.querySelectorAll<HTMLElement>('[data-flat-slider-value="true"]');
    // Volume is the first slider row.
    act(() => readouts[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const volumeInput = host.querySelector<HTMLInputElement>('[data-flat-slider-input="true"]');
    if (!volumeInput) throw new Error("expected the volume readout to open for typing");
    act(() => {
      typeInto(volumeInput, "-6 dB");
      volumeInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const [attr, value] = onSetAttribute.mock.calls.at(-1) ?? [];
    expect(attr).toBe("volume");
    expect(Number(value)).toBeCloseTo(10 ** (-6 / 20), 2);

    const fadeOutRow = host.querySelector<HTMLElement>(
      '[data-flat-slider-track="true"][aria-label="Fade out"]',
    )?.parentElement;
    const fadeOutReadout = fadeOutRow?.querySelector<HTMLElement>(
      '[data-flat-slider-value="true"]',
    );
    act(() => fadeOutReadout?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const fadeInput = host.querySelector<HTMLInputElement>('[data-flat-slider-input="true"]');
    if (!fadeInput) throw new Error("expected the fade readout to open for typing");
    act(() => {
      typeInto(fadeInput, "1.25s");
      fadeInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSetAttribute).toHaveBeenLastCalledWith("fade-out", "1.25");
    act(() => root.unmount());
  });
});

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
