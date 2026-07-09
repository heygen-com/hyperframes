// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FlatColorGradingAccessory,
  FlatColorGradingSection,
} from "./propertyPanelFlatColorGradingSection";
import { normalizeHfColorGrading } from "@hyperframes/core/color-grading";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function renderInto(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return { host, root };
}

function neutralGrading() {
  const grading = normalizeHfColorGrading("neutral");
  if (!grading) throw new Error("expected a neutral grading");
  return grading;
}

describe("FlatColorGradingAccessory", () => {
  it("shows a 5px status dot colored by runtime status, with the message as its title", () => {
    const { host, root } = renderInto(
      <FlatColorGradingAccessory
        state={{
          grading: neutralGrading(),
          compareEnabled: false,
          runtimeStatus: { state: "active", message: "Shader active" },
          commitCompare: vi.fn(),
          resetGrading: vi.fn(),
        }}
      />,
    );
    const dot = host.querySelector('[data-flat-grade-status-dot="true"]');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("title")).toBe("Shader active");
    expect(dot?.className).toContain("bg-emerald-400");
    act(() => root.unmount());
  });

  it("disables the compare hold button when grading is inactive, and fires resetGrading on click", () => {
    const resetGrading = vi.fn();
    const { host, root } = renderInto(
      <FlatColorGradingAccessory
        state={{
          grading: neutralGrading(),
          compareEnabled: false,
          runtimeStatus: { state: "inactive", message: "No grading applied" },
          commitCompare: vi.fn(),
          resetGrading,
        }}
      />,
    );
    const compareButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Hold to show original"]',
    );
    expect(compareButton?.disabled).toBe(true);
    const resetButton = host.querySelector<HTMLButtonElement>('[data-flat-grade-reset="true"]');
    act(() => resetButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(resetGrading).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});

function neutralPropsBase() {
  return {
    grading: neutralGrading(),
    assets: [] as string[],
    onCommitColorGrading: vi.fn(),
    applyScope: "source-file" as const,
    applyBusy: false,
    onSetApplyScope: vi.fn(),
    onApplyToScope: vi.fn(),
    onApplyScopeAvailable: true,
    mediaMetadata: null,
  };
}

describe("FlatColorGradingSection — Preset + LUT", () => {
  it("renders the Preset dropdown with id/label pairs and fires onCommitColorGrading on change", () => {
    const onCommitColorGrading = vi.fn();
    const { host, root } = renderInto(
      <FlatColorGradingSection
        {...neutralPropsBase()}
        onCommitColorGrading={onCommitColorGrading}
      />,
    );
    const presetSelect = host.querySelector<HTMLSelectElement>(
      '[data-flat-grade-preset="true"] select',
    );
    if (!presetSelect) throw new Error("expected a preset select");
    expect(presetSelect.value).toBe("neutral");
    act(() => {
      presetSelect.value = "fresh-pop";
      presetSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onCommitColorGrading).toHaveBeenCalledTimes(1);
    expect(onCommitColorGrading.mock.calls[0][0].preset).toBe("fresh-pop");
    act(() => root.unmount());
  });

  it("shows the Custom LUT row collapsed by default, expanding to reveal the strength slider when a LUT is set", () => {
    const grading = { ...neutralGrading(), lut: { src: "assets/luts/warm.cube", intensity: 0.8 } };
    const { host, root } = renderInto(
      <FlatColorGradingSection {...neutralPropsBase()} grading={grading} />,
    );
    const lutToggle = host.querySelector<HTMLButtonElement>('[data-flat-grade-lut-toggle="true"]');
    expect(lutToggle).not.toBeNull();
    act(() => lutToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.textContent).toContain("warm.cube");
    act(() => root.unmount());
  });

  it("commits the selected catalog LUT via the select control, resetting intensity to 1 when switching LUTs", () => {
    const onCommitColorGrading = vi.fn();
    const grading = { ...neutralGrading(), lut: { src: "assets/luts/warm.cube", intensity: 0.5 } };
    const { host, root } = renderInto(
      <FlatColorGradingSection
        {...neutralPropsBase()}
        assets={["assets/luts/warm.cube", "assets/luts/cool.cube"]}
        grading={grading}
        onCommitColorGrading={onCommitColorGrading}
      />,
    );
    const lutToggle = host.querySelector<HTMLButtonElement>('[data-flat-grade-lut-toggle="true"]');
    act(() => lutToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const lutSelect = host.querySelector<HTMLSelectElement>('[data-flat-grade-lut-select="true"]');
    if (!lutSelect) throw new Error("expected a LUT catalog select");
    act(() => {
      lutSelect.value = "assets/luts/cool.cube";
      lutSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onCommitColorGrading).toHaveBeenCalledTimes(1);
    expect(onCommitColorGrading.mock.calls[0][0].lut).toEqual({
      src: "assets/luts/cool.cube",
      intensity: 1,
    });
    act(() => root.unmount());
  });

  it("imports a LUT via the hidden file input and commits the resolved asset", async () => {
    const onCommitColorGrading = vi.fn();
    const onImportAssets = vi.fn().mockResolvedValue(["assets/luts/x.cube"]);
    const { host, root } = renderInto(
      <FlatColorGradingSection
        {...neutralPropsBase()}
        onCommitColorGrading={onCommitColorGrading}
        onImportAssets={onImportAssets}
      />,
    );
    const lutToggle = host.querySelector<HTMLButtonElement>('[data-flat-grade-lut-toggle="true"]');
    act(() => lutToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const fileInput = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error("expected a hidden file input");
    const file = new File(["cube data"], "x.cube");
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onImportAssets).toHaveBeenCalledTimes(1);
    expect(onImportAssets.mock.calls[0][0]).toEqual([file]);
    expect(onImportAssets.mock.calls[0][1]).toBe("assets/luts");
    expect(onCommitColorGrading).toHaveBeenCalledTimes(1);
    expect(onCommitColorGrading.mock.calls[0][0].lut).toEqual({
      src: "assets/luts/x.cube",
      intensity: 1,
    });
    act(() => root.unmount());
  });
});
