// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GsapAnimation, PropertyGroupName } from "@hyperframes/core/gsap-parser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelinePropertyLanes } from "./TimelinePropertyLanes";
import { TimelineTrackHeader } from "./TimelineTrackHeader";
import { defaultTimelineTheme } from "./timelineTheme";
import type { TimelineElement } from "../store/playerStore";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import { LABEL_COL_W } from "./timelineLayout";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

const ELEMENT: TimelineElement = {
  id: "clip-1",
  label: "Hero card",
  tag: "div",
  start: 0,
  duration: 2,
  track: 0,
};

function animation(
  id: string,
  propertyGroup: PropertyGroupName,
  keyframes: Array<{
    percentage: number;
    properties: Record<string, number | string>;
  }>,
): GsapAnimation {
  return {
    id,
    targetSelector: "#clip-1",
    method: "to",
    position: 0,
    duration: 2,
    properties: {},
    propertyGroup,
    keyframes: { format: "percentage", keyframes },
  };
}

const POSITION = animation("position-tween", "position", [
  { percentage: 0, properties: { x: 0, y: 0 } },
  { percentage: 50, properties: { x: 100, y: 50 } },
  { percentage: 100, properties: { x: 200, y: 100 } },
]);

const OPACITY = animation("opacity-tween", "visual", [
  { percentage: 0, properties: { opacity: 0 } },
  { percentage: 50, properties: { opacity: 0.5 } },
  { percentage: 100, properties: { opacity: 1 } },
]);

interface RenderHeaderOptions {
  animations?: GsapAnimation[];
  currentTime?: number;
  expanded?: boolean;
  onSeek?: (time: number) => void;
  onTogglePropertyGroupKeyframe?: TimelineEditCallbacks["onTogglePropertyGroupKeyframe"];
}

function renderHeader(options: RenderHeaderOptions = {}): {
  host: HTMLDivElement;
  root: Root;
  rerender: (next: RenderHeaderOptions) => void;
} {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (next: RenderHeaderOptions) => {
    act(() => {
      root.render(
        <TimelineTrackHeader
          trackNumber={0}
          trackLabel="Hero card"
          contentOrigin={LABEL_COL_W}
          keyframeClip={ELEMENT}
          isExpanded={next.expanded !== false}
          animations={next.animations ?? [POSITION, OPACITY]}
          currentTime={next.currentTime ?? 0}
          isTrackHidden={false}
          isAudioTrack={false}
          isActive
          isHovered={false}
          theme={defaultTimelineTheme}
          onToggleClipExpanded={vi.fn()}
          onToggleTrackHidden={vi.fn()}
          onTogglePropertyGroupKeyframe={next.onTogglePropertyGroupKeyframe}
          onSeek={next.onSeek}
        />,
      );
    });
  };
  render(options);
  return { host, root, rerender: render };
}

function click(host: HTMLElement, label: string) {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).not.toBeNull();
  act(() => button?.click());
}

describe("TimelineTrackHeader", () => {
  it("adds and removes a keyframe on the explicitly targeted property-group tween", () => {
    const onTogglePropertyGroupKeyframe = vi.fn();
    const view = renderHeader({ currentTime: 0.5, onTogglePropertyGroupKeyframe });

    click(view.host, "Toggle Opacity keyframe");
    expect(onTogglePropertyGroupKeyframe).toHaveBeenLastCalledWith(
      ELEMENT,
      expect.objectContaining({
        animationId: "opacity-tween",
        propertyGroup: "visual",
        tweenPercentage: 25,
        properties: { opacity: 0.25 },
        remove: false,
      }),
    );

    view.rerender({ currentTime: 1, onTogglePropertyGroupKeyframe });
    click(view.host, "Toggle Opacity keyframe");
    expect(onTogglePropertyGroupKeyframe).toHaveBeenLastCalledWith(
      ELEMENT,
      expect.objectContaining({
        animationId: "opacity-tween",
        propertyGroup: "visual",
        tweenPercentage: 50,
        properties: { opacity: 0.5 },
        remove: true,
      }),
    );
    expect(onTogglePropertyGroupKeyframe).not.toHaveBeenCalledWith(
      ELEMENT,
      expect.objectContaining({ animationId: "position-tween" }),
    );
    act(() => view.root.unmount());
  });

  it("seeks only to the selected group's adjacent keyframes", () => {
    const onSeek = vi.fn();
    const view = renderHeader({
      currentTime: 1,
      animations: [
        POSITION,
        animation("opacity-tween", "visual", [
          { percentage: 25, properties: { opacity: 0.25 } },
          { percentage: 50, properties: { opacity: 0.5 } },
          { percentage: 75, properties: { opacity: 0.75 } },
        ]),
      ],
      onSeek,
    });

    click(view.host, "Next Position keyframe");
    expect(onSeek).toHaveBeenLastCalledWith(2);
    click(view.host, "Previous Position keyframe");
    expect(onSeek).toHaveBeenLastCalledWith(0);
    expect(onSeek).not.toHaveBeenCalledWith(1.5);
    act(() => view.root.unmount());
  });

  it("fills the toggle diamond exactly at that group's keyframe", () => {
    const view = renderHeader({ currentTime: 0.5 });
    const positionToggle = view.host.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle Position keyframe"]',
    );
    expect(positionToggle?.textContent).toBe("◇");

    view.rerender({ currentTime: 1 });
    expect(
      view.host.querySelector<HTMLButtonElement>('button[aria-label="Toggle Position keyframe"]')
        ?.textContent,
    ).toBe("◆");
    act(() => view.root.unmount());
  });

  it("updates formatted group values when the playhead moves", () => {
    const view = renderHeader({ currentTime: 0.5 });
    expect(view.host.querySelector('[data-property-group="position"]')?.textContent).toContain(
      "50, 25",
    );
    expect(view.host.querySelector('[data-property-group="visual"]')?.textContent).toContain("25%");

    view.rerender({ currentTime: 1.5 });
    expect(view.host.querySelector('[data-property-group="position"]')?.textContent).toContain(
      "150, 75",
    );
    expect(view.host.querySelector('[data-property-group="visual"]')?.textContent).toContain("75%");
    act(() => view.root.unmount());
  });

  it("disables the previous chevron at or before the group's first keyframe", () => {
    const view = renderHeader({ currentTime: 0 });
    const prevAt0 = view.host.querySelector<HTMLButtonElement>(
      'button[aria-label="Previous Position keyframe"]',
    );
    expect(prevAt0).not.toBeNull();
    expect(prevAt0?.disabled).toBe(true);

    view.rerender({ currentTime: 1 });
    const prevAt1 = view.host.querySelector<HTMLButtonElement>(
      'button[aria-label="Previous Position keyframe"]',
    );
    expect(prevAt1?.disabled).toBe(false);
    act(() => view.root.unmount());
  });

  it("uses the same lane row offsets when collapsed, expanded once, and expanded multiple times", () => {
    const view = renderHeader({ expanded: false });
    expect(view.host.querySelectorAll("[data-timeline-lane-top]")).toHaveLength(0);

    const assertAligned = (animations: GsapAnimation[]) => {
      view.rerender({ animations });
      const lanesHost = document.createElement("div");
      document.body.append(lanesHost);
      const lanesRoot = createRoot(lanesHost);
      act(() => {
        lanesRoot.render(
          <TimelinePropertyLanes
            animations={animations}
            clipStart={0}
            clipDuration={2}
            clipLeftPx={120}
            clipWidthPx={200}
            accentColor="#3CE6AC"
            isSelected
            currentPercentage={0}
            elementId="clip-1"
            selectedKeyframes={new Set()}
          />,
        );
      });
      expect(
        Array.from(view.host.querySelectorAll<HTMLElement>("[data-timeline-lane-top]")).map(
          (row) => row.style.top,
        ),
      ).toEqual(
        Array.from(lanesHost.querySelectorAll<HTMLElement>("[data-timeline-lane-top]")).map(
          (row) => row.style.top,
        ),
      );
      expect(
        Array.from(lanesHost.querySelectorAll<HTMLElement>("[data-timeline-property-lane]")).map(
          (row) => row.style.left,
        ),
      ).toEqual(animations.map(() => "120px"));
      act(() => lanesRoot.unmount());
    };

    assertAligned([POSITION]);
    assertAligned([POSITION, OPACITY]);
    act(() => view.root.unmount());
  });
});
