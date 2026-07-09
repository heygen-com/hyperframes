// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlatColorGradingAccessory } from "./propertyPanelFlatColorGradingSection";
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
