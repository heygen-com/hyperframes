// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnimationCard } from "./AnimationCard";
import { EASE_PRESETS } from "./easePresetLibrary";

const trackStudioSegmentEaseEdit = vi.hoisted(() => vi.fn());
vi.mock("../../telemetry/events", () => ({ trackStudioSegmentEaseEdit }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ANIMATION: GsapAnimation = {
  id: "position-tween",
  targetSelector: "#clip-1",
  method: "to",
  position: 0,
  duration: 2,
  ease: "power1.out",
  properties: { x: 200 },
  keyframes: {
    format: "percentage",
    keyframes: [
      { percentage: 0, properties: { x: 0 } },
      { percentage: 50, properties: { x: 100 } },
      { percentage: 100, properties: { x: 200 } },
    ],
  },
};

const FLAT_ANIMATION: GsapAnimation = {
  ...ANIMATION,
  id: "flat-position-tween",
  keyframes: undefined,
};

afterEach(() => {
  document.body.innerHTML = "";
  trackStudioSegmentEaseEdit.mockClear();
});

function renderCard(
  focusedSegment: { tweenPercentage: number; collidingAnimationIds?: string[] } | null,
  onEaseCommit = vi.fn(),
  defaultExpanded = false,
  animation = ANIMATION,
  onUpdateMeta = vi.fn(),
  onUpdateSegmentEase = vi.fn(),
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (nextFocusedSegment: { tweenPercentage: number } | null) => {
    act(() => {
      root.render(
        <AnimationCard
          animation={animation}
          defaultExpanded={defaultExpanded}
          focusedSegment={nextFocusedSegment}
          onFocusSegmentConsumed={vi.fn()}
          onUpdateProperty={vi.fn()}
          onUpdateMeta={onUpdateMeta}
          onDeleteAnimation={vi.fn()}
          onAddProperty={vi.fn()}
          onRemoveProperty={vi.fn()}
          onUpdateKeyframeEase={onEaseCommit}
          onUpdateSegmentEase={onUpdateSegmentEase}
        />,
      );
    });
  };
  render(focusedSegment);
  return { host, root, render };
}

function findButton(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  );
}

function openSegment(host: HTMLElement, label: string): void {
  const segment = findButton(host, label);
  expect(segment).toBeDefined();
  act(() => segment?.click());
}

function selectPreset(host: HTMLElement, presetId: string): string {
  const presetConfig = EASE_PRESETS.find((candidate) => candidate.id === presetId);
  if (!presetConfig) throw new Error(`Missing ease preset: ${presetId}`);
  const dropdown = host.querySelector<HTMLButtonElement>("[data-ease-type-dropdown]");
  expect(dropdown).not.toBeNull();
  act(() => dropdown?.click());

  const preset = host.querySelector<HTMLButtonElement>(`[data-ease-preset-id="${presetId}"]`);
  expect(preset).not.toBeNull();
  act(() => preset?.click());
  return presetConfig.ease;
}

function restoreScrollIntoView(descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", descriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
}

describe("AnimationCard", () => {
  it("scrolls a focused segment into view but not a manually toggled segment", () => {
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    const view = renderCard({ tweenPercentage: 50 });
    try {
      expect(scrollIntoView).toHaveBeenCalledOnce();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });

      view.render(null);
      const manualToggle = findButton(view.host, "50% → 100%");
      expect(manualToggle).toBeDefined();
      act(() => manualToggle?.click());
      expect(scrollIntoView).toHaveBeenCalledOnce();
    } finally {
      act(() => view.root.unmount());
      restoreScrollIntoView(originalScrollIntoView);
    }
  });

  it("tracks a committed segment ease alongside the existing update", () => {
    const onEaseCommit = vi.fn();
    const view = renderCard(null, onEaseCommit, true);
    openSegment(view.host, "0% → 50%");
    const ease = selectPreset(view.host, "quad-out");

    expect(onEaseCommit).toHaveBeenCalledWith(ANIMATION.id, 50, ease);
    expect(trackStudioSegmentEaseEdit).toHaveBeenCalledWith({ action: "commit", ease });
    act(() => view.root.unmount());
  });

  it("commits a focused multi-id segment ease through the bulk callback", () => {
    const onUpdateKeyframeEase = vi.fn();
    const onUpdateSegmentEase = vi.fn();
    const collidingAnimationIds = [ANIMATION.id, "scale-tween", "opacity-tween"];
    const view = renderCard(
      { tweenPercentage: 50, collidingAnimationIds },
      onUpdateKeyframeEase,
      false,
      ANIMATION,
      vi.fn(),
      onUpdateSegmentEase,
    );
    const ease = selectPreset(view.host, "quad-out");

    expect(onUpdateSegmentEase).toHaveBeenCalledExactlyOnceWith(collidingAnimationIds, 50, ease);
    expect(onUpdateKeyframeEase).not.toHaveBeenCalled();
    act(() => view.root.unmount());
  });

  it("keeps a focused single-id segment ease on the single callback", () => {
    const onUpdateKeyframeEase = vi.fn();
    const onUpdateSegmentEase = vi.fn();
    const view = renderCard(
      { tweenPercentage: 50, collidingAnimationIds: [ANIMATION.id] },
      onUpdateKeyframeEase,
      false,
      ANIMATION,
      vi.fn(),
      onUpdateSegmentEase,
    );
    const ease = selectPreset(view.host, "quad-out");

    expect(onUpdateKeyframeEase).toHaveBeenCalledExactlyOnceWith(ANIMATION.id, 50, ease);
    expect(onUpdateSegmentEase).not.toHaveBeenCalled();
    act(() => view.root.unmount());
  });

  it("commits a focused flat tween segment ease through tween metadata", () => {
    const onUpdateMeta = vi.fn();
    const onUpdateKeyframeEase = vi.fn();
    const view = renderCard(
      { tweenPercentage: 100 },
      onUpdateKeyframeEase,
      false,
      FLAT_ANIMATION,
      onUpdateMeta,
    );
    const ease = selectPreset(view.host, "quad-out");

    expect(onUpdateMeta).toHaveBeenCalledExactlyOnceWith(FLAT_ANIMATION.id, { ease });
    expect(onUpdateKeyframeEase).not.toHaveBeenCalled();
    act(() => view.root.unmount());
  });
});

function baseAnimation(overrides: Partial<GsapAnimation> = {}): GsapAnimation {
  return {
    id: "anim-1",
    method: "to",
    position: 0.8,
    duration: 1.2,
    ease: "power2.out",
    properties: { opacity: 1 },
    ...overrides,
  } as GsapAnimation;
}

const noop = () => {};

describe("AnimationCard ease editing", () => {
  it.each([
    ["spring", "power2.out", "spring(0.42)", "Spring bounce"],
    ["wiggle", "power2.out", "wiggle(3,easeInOut,0.12)", "Wiggle count"],
    ["curve", "spring(0.6)", "custom(M0,0 C0.16,1 0.3,1 1,1)", "Cubic bezier control points"],
  ] as const)(
    "commits and immediately displays the %s default when a keyframe segment switches mode",
    (mode, currentEase, ease, fieldLabel) => {
      const onUpdateKeyframeEase = vi.fn();
      const animation = baseAnimation({
        keyframes: {
          format: "percentage",
          keyframes: [
            { percentage: 0, properties: { opacity: 0 } },
            { percentage: 50, properties: { opacity: 0.5 }, ease: currentEase },
            { percentage: 100, properties: { opacity: 1 } },
          ],
        },
      });
      const view = renderCard(null, onUpdateKeyframeEase, true, animation);

      openSegment(view.host, "0% → 50%");
      const modeButton = view.host.querySelector<HTMLButtonElement>(`[data-ease-mode="${mode}"]`);
      expect(modeButton).not.toBeNull();
      act(() => modeButton?.click());

      expect(onUpdateKeyframeEase).toHaveBeenCalledExactlyOnceWith(animation.id, 50, ease);
      expect(modeButton?.getAttribute("aria-pressed")).toBe("true");
      expect(view.host.querySelector(`[aria-label="${fieldLabel}"]`)).not.toBeNull();
      act(() => view.root.unmount());
    },
  );

  it("commits one preset change to the selected keyframe segment", () => {
    const onUpdateKeyframeEase = vi.fn();
    const animation = baseAnimation({
      keyframes: {
        format: "percentage",
        keyframes: [
          { percentage: 0, properties: { opacity: 0 } },
          { percentage: 50, properties: { opacity: 0.5 } },
          { percentage: 100, properties: { opacity: 1 } },
        ],
      },
    });
    const view = renderCard(null, onUpdateKeyframeEase, true, animation);

    openSegment(view.host, "0% → 50%");
    const ease = selectPreset(view.host, "quad-out");

    expect(onUpdateKeyframeEase).toHaveBeenCalledExactlyOnceWith(animation.id, 50, ease);
    expect(trackStudioSegmentEaseEdit).toHaveBeenCalledExactlyOnceWith({
      action: "commit",
      ease,
    });
    act(() => view.root.unmount());
  });

  it("commits one preset change through flat tween metadata", () => {
    const onUpdateMeta = vi.fn();
    const onUpdateKeyframeEase = vi.fn();
    const animation = baseAnimation({ id: "flat-tween" });
    const view = renderCard(null, onUpdateKeyframeEase, true, animation, onUpdateMeta);

    const ease = selectPreset(view.host, "quad-out");

    expect(onUpdateMeta).toHaveBeenCalledExactlyOnceWith(animation.id, { ease });
    expect(onUpdateKeyframeEase).not.toHaveBeenCalled();
    expect(trackStudioSegmentEaseEdit).not.toHaveBeenCalled();
    act(() => view.root.unmount());
  });
});

describe("AnimationCard flat branch", () => {
  it("renders a mint border-left and panel-token colors when flat", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <AnimationCard
          animation={baseAnimation()}
          defaultExpanded={false}
          flat
          onUpdateProperty={noop}
          onUpdateMeta={noop}
          onDeleteAnimation={noop}
          onAddProperty={noop}
          onRemoveProperty={noop}
        />,
      );
    });
    const card = host.querySelector('[data-flat-effect-card="true"]');
    expect(card).not.toBeNull();
    expect(card?.className).toContain("border-panel-accent");
    act(() => root.unmount());
  });

  it("still renders the legacy (non-flat) appearance when flat is omitted", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <AnimationCard
          animation={baseAnimation()}
          defaultExpanded={false}
          onUpdateProperty={noop}
          onUpdateMeta={noop}
          onDeleteAnimation={noop}
          onAddProperty={noop}
          onRemoveProperty={noop}
        />,
      );
    });
    expect(host.querySelector('[data-flat-effect-card="true"]')).toBeNull();
    expect(host.textContent).toContain("power2.out");
    act(() => root.unmount());
  });

  it("toggles expanded state when the collapsed header button is clicked, in both modes", () => {
    for (const flat of [false, true]) {
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      act(() => {
        root.render(
          <AnimationCard
            animation={baseAnimation()}
            defaultExpanded={false}
            flat={flat || undefined}
            onUpdateProperty={noop}
            onUpdateMeta={noop}
            onDeleteAnimation={noop}
            onAddProperty={noop}
            onRemoveProperty={noop}
          />,
        );
      });
      expect(host.textContent).not.toContain("Remove");
      const button = host.querySelector("button");
      expect(button).not.toBeNull();
      act(() => {
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(host.textContent).toContain("Remove");
      act(() => root.unmount());
    }
  });

  it("invokes onDeleteAnimation with the animation id when Remove is clicked, in flat mode", () => {
    const onDeleteAnimation = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <AnimationCard
          animation={baseAnimation()}
          defaultExpanded={true}
          flat
          onUpdateProperty={noop}
          onUpdateMeta={noop}
          onDeleteAnimation={onDeleteAnimation}
          onAddProperty={noop}
          onRemoveProperty={noop}
        />,
      );
    });
    const buttons = Array.from(host.querySelectorAll("button"));
    const removeButton = buttons.find((b) => b.textContent === "Remove");
    expect(removeButton).not.toBeUndefined();
    act(() => {
      removeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDeleteAnimation).toHaveBeenCalledWith("anim-1");
    act(() => root.unmount());
  });
});
