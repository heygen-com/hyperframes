// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { TimelineClip } from "./TimelineClip";
import type { TimelineEditCapabilities } from "./timelineEditing";
import { defaultTimelineTheme, type TimelineTheme } from "./timelineTheme";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

afterEach(() => {
  document.body.innerHTML = "";
});

const capabilities: TimelineEditCapabilities = {
  canMove: true,
  canTrimStart: true,
  canTrimEnd: true,
};

function renderClip({
  element,
  pps = 100,
  isSelected = false,
  hasCustomContent = true,
  theme = defaultTimelineTheme,
}: {
  element: TimelineElement;
  pps?: number;
  isSelected?: boolean;
  hasCustomContent?: boolean;
  theme?: TimelineTheme;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onClick = vi.fn();

  act(() => {
    root.render(
      <TimelineClip
        el={element}
        pps={pps}
        clipY={0}
        isSelected={isSelected}
        isHovered={false}
        hasCustomContent={hasCustomContent}
        capabilities={capabilities}
        theme={theme}
        isComposition={false}
        onHoverStart={vi.fn()}
        onHoverEnd={vi.fn()}
        onClick={onClick}
        onDoubleClick={vi.fn()}
      >
        <div data-custom-content="true" />
      </TimelineClip>,
    );
  });

  return { host, onClick, root };
}

describe("TimelineClip", () => {
  it("renders the clip label above custom content without showing default timecode", () => {
    const { host, root } = renderClip({
      element: { id: "hero", label: "Hero", tag: "div", start: 1, duration: 0.5, track: 0 },
    });

    expect(host.querySelector(".timeline-clip__label")?.textContent).toBe("Hero");
    expect(host.querySelector(".timeline-clip__timecode")).toBeNull();

    act(() => root.unmount());
  });

  it("keeps selected narrow clips labeled even when they render custom content", () => {
    const { host, root } = renderClip({
      element: { id: "fx", label: "FX", tag: "div", start: 0, duration: 0.1, track: 0 },
      isSelected: true,
    });

    expect(host.querySelector(".timeline-clip__label")?.textContent).toBe("FX");
    expect(host.querySelector(".timeline-clip__timecode")).toBeNull();

    act(() => root.unmount());
  });

  it("marks hidden clips for active-state suppression", () => {
    const { host, root } = renderClip({
      element: {
        id: "hidden",
        label: "Hidden",
        tag: "div",
        start: 0,
        duration: 1,
        track: 0,
        hidden: true,
      },
    });

    expect(host.querySelector(".timeline-clip")?.getAttribute("data-clip-hidden")).toBe("true");

    act(() => root.unmount());
  });

  it("applies selected styling when rendered as selected", () => {
    const { host, root } = renderClip({
      element: { id: "selected", label: "Selected", tag: "div", start: 0, duration: 1, track: 0 },
      isSelected: true,
    });

    expect(host.querySelector(".timeline-clip")?.classList.contains("is-selected")).toBe(true);

    act(() => root.unmount());
  });

  it("passes clip and handle theme tokens to the rendered elements", () => {
    const theme: TimelineTheme = {
      ...defaultTimelineTheme,
      clipBackground: "var(--test-clip-bg)",
      clipBackgroundActive: "var(--test-clip-bg-active)",
      clipBorder: "var(--test-clip-border)",
      clipBorderHover: "var(--test-clip-border-hover)",
      clipBorderActive: "var(--test-clip-border-active)",
      handleColor: "var(--test-handle)",
    };
    const { host, root } = renderClip({
      element: { id: "themed", label: "Themed", tag: "div", start: 0, duration: 1, track: 0 },
      isSelected: true,
      theme,
    });
    const clip = host.querySelector<HTMLElement>(".timeline-clip")!;
    expect(clip.style.getPropertyValue("--timeline-clip-bg")).toBe("var(--test-clip-bg)");
    expect(clip.style.getPropertyValue("--timeline-clip-border-active")).toBe(
      "var(--test-clip-border-active)",
    );
    expect(clip.style.getPropertyValue("--timeline-handle")).toBe("var(--test-handle)");
    expect(clip.querySelector<HTMLElement>(".timeline-clip__handle-bar")?.style.background).toBe(
      "var(--timeline-handle)",
    );
    act(() => root.unmount());
  });

  it("is a roving native button with explicit selection semantics", () => {
    const { host, onClick, root } = renderClip({
      element: { id: "hero", label: "Hero", tag: "div", start: 1, duration: 2, track: 0 },
      isSelected: true,
    });
    const clip = host.querySelector<HTMLButtonElement>(".timeline-clip")!;
    expect(clip.type).toBe("button");
    expect(clip.tabIndex).toBe(-1);
    expect(clip.getAttribute("aria-pressed")).toBe("true");
    act(() => clip.click());
    expect(onClick).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
