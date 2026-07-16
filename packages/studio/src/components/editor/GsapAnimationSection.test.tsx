// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { DesignPanelInputProvider } from "../../contexts/DesignPanelInputContext";
import { usePlayerStore } from "../../player";
import { GsapAnimationSection } from "./GsapAnimationSection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./AnimationCard", () => ({
  AnimationCard: ({
    animation,
    focusedSegment,
    onFocusSegmentConsumed,
  }: {
    animation: GsapAnimation;
    focusedSegment: { tweenPercentage: number } | null;
    onFocusSegmentConsumed: () => void;
  }) => (
    <button
      type="button"
      data-testid={`animation-${animation.id}`}
      data-focused={focusedSegment ? String(focusedSegment.tweenPercentage) : ""}
      onClick={onFocusSegmentConsumed}
    />
  ),
}));

vi.mock("./GsapAddAnimationControl", () => ({ GsapAddAnimationControl: () => null }));

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
});

const sharedAnimation: GsapAnimation = {
  id: "shared-animation",
  targetSelector: ".shared",
  method: "to",
  position: 0,
  properties: { x: 100 },
};

const requiredCallbacks = {
  onAddAnimation: vi.fn(),
  onUpdateProperty: vi.fn(),
  onUpdateMeta: vi.fn(),
  onDeleteAnimation: vi.fn(),
  onAddProperty: vi.fn(),
  onRemoveProperty: vi.fn(),
};

function renderSection(elementId: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (nextElementId: string) => {
    act(() => {
      root.render(
        <DesignPanelInputProvider section="test">
          <GsapAnimationSection
            {...requiredCallbacks}
            elementId={nextElementId}
            animations={[sharedAnimation]}
          />
        </DesignPanelInputProvider>,
      );
    });
  };
  render(elementId);
  return { host, root, render };
}

describe("GsapAnimationSection", () => {
  it("consumes a shared animation id only for the focused element", () => {
    usePlayerStore.getState().setFocusedEaseSegment({
      elementId: "index.html#second",
      animationId: sharedAnimation.id,
      tweenPercentage: 50,
    });
    const view = renderSection("index.html#first");
    const card = view.host.querySelector<HTMLButtonElement>(
      "[data-testid='animation-shared-animation']",
    );
    if (!card) throw new Error("expected animation card");

    expect(card.dataset.focused).toBe("");
    act(() => card.click());
    expect(usePlayerStore.getState().focusedEaseSegment?.elementId).toBe("index.html#second");

    view.render("index.html#second");
    expect(card.dataset.focused).toBe("50");
    act(() => card.click());
    expect(usePlayerStore.getState().focusedEaseSegment).toBeNull();
    act(() => view.root.unmount());
  });
});
