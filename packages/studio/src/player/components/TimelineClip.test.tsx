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
      element: { id: "hero", label: "Hero", tag: "div", start: 1, duration: 1, track: 0 },
    });

    expect(host.querySelector(".timeline-clip__label")?.textContent).toBe("Hero");
    expect(host.querySelector(".timeline-clip__timecode")).toBeNull();

    act(() => root.unmount());
  });

  it("drops the label chip under 60px even when the clip is selected", () => {
    const { host, root } = renderClip({
      element: { id: "fx", label: "FX", tag: "div", start: 0, duration: 1, track: 0 },
      pps: 59,
      isSelected: true,
    });

    expect(host.querySelector(".timeline-clip__label")).toBeNull();
    expect(host.querySelector(".timeline-clip__timecode")).toBeNull();
    expect(host.querySelector(".timeline-clip")?.getAttribute("data-ladder")).toBe("picture");

    act(() => root.unmount());
  });

  it("keeps the label at 60px and fills one frame under 24px", () => {
    const labeled = renderClip({
      element: { id: "wide", label: "City", tag: "video", start: 0, duration: 1, track: 0 },
      pps: 200,
    });
    expect(labeled.host.querySelector(".timeline-clip__label")?.textContent).toBe("City");
    expect(labeled.host.querySelector(".timeline-clip")?.getAttribute("data-ladder")).toBe(
      "labeled",
    );
    expect(labeled.host.querySelector<HTMLElement>(".timeline-clip")?.style.borderRadius).toBe(
      "var(--timeline-clip-radius)",
    );
    act(() => labeled.root.unmount());

    const frame = renderClip({
      element: { id: "sliver", label: "City", tag: "img", start: 0, duration: 1, track: 0 },
      pps: 23,
      isSelected: true,
    });
    expect(frame.host.querySelector(".timeline-clip__label")).toBeNull();
    expect(frame.host.querySelector(".timeline-clip")?.getAttribute("data-ladder")).toBe("frame");
    act(() => frame.root.unmount());
  });

  it("gives audio clips the pill radius", () => {
    const { host, root } = renderClip({
      element: { id: "vo", label: "Voice", tag: "audio", start: 0, duration: 2, track: 1 },
      pps: 100,
    });
    expect(host.querySelector<HTMLElement>(".timeline-clip")?.style.borderRadius).toBe(
      "var(--timeline-clip-audio-radius)",
    );
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
      clipBackgroundHover: "var(--test-clip-bg-hover)",
      clipBackgroundDragging: "var(--test-clip-bg-dragging)",
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
    expect(clip.style.getPropertyValue("--clip-bg")).toBe("var(--test-clip-bg)");
    expect(clip.style.getPropertyValue("--clip-border-active")).toBe(
      "var(--test-clip-border-active)",
    );
    expect(clip.style.getPropertyValue("--clip-handle")).toBe("var(--test-handle)");
    expect(clip.querySelector<HTMLElement>(".timeline-clip__handle-bar")?.style.background).toBe(
      "var(--clip-handle)",
    );
    act(() => root.unmount());
  });

  it("keeps default token references off the properties they resolve", () => {
    const { host, root } = renderClip({
      element: {
        id: "default-theme",
        label: "Default",
        tag: "div",
        start: 0,
        duration: 1,
        track: 0,
      },
      isSelected: true,
    });
    const clip = host.querySelector<HTMLElement>(".timeline-clip")!;
    expect(clip.style.getPropertyValue("--clip-bg")).toBe("var(--timeline-clip-bg)");
    expect(clip.style.getPropertyValue("--clip-bg")).not.toBe("var(--clip-bg)");
    expect(clip.style.getPropertyValue("--clip-handle")).toBe("var(--timeline-handle)");
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
