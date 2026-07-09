// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnimationCard } from "./AnimationCard";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
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
