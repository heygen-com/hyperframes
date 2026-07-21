// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnimationCard } from "./AnimationCard";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { EASE_PRESETS } from "./easePresetLibrary";

const trackStudioSegmentEaseEdit = vi.hoisted(() => vi.fn());
vi.mock("../../telemetry/events", () => ({ trackStudioSegmentEaseEdit }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  trackStudioSegmentEaseEdit.mockClear();
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

function renderExpandedCard({
  animation,
  flat,
  onUpdateMeta = vi.fn(),
  onUpdateKeyframeEase = vi.fn(),
}: {
  animation: GsapAnimation;
  flat?: boolean;
  onUpdateMeta?: ReturnType<typeof vi.fn>;
  onUpdateKeyframeEase?: ReturnType<typeof vi.fn>;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <AnimationCard
        animation={animation}
        defaultExpanded
        flat={flat}
        onUpdateProperty={noop}
        onUpdateMeta={onUpdateMeta}
        onDeleteAnimation={noop}
        onAddProperty={noop}
        onRemoveProperty={noop}
        onUpdateKeyframeEase={onUpdateKeyframeEase}
      />,
    );
  });
  return { host, root };
}

describe("AnimationCard ease editing", () => {
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
    const view = renderExpandedCard({ animation, onUpdateKeyframeEase });

    const segment = Array.from(view.host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("0% → 50%"),
    );
    expect(segment).toBeDefined();
    act(() => segment?.click());
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
    const view = renderExpandedCard({
      animation,
      flat: true,
      onUpdateMeta,
      onUpdateKeyframeEase,
    });

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
