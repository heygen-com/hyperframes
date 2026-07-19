// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GsapAnimation, PropertyGroupName } from "@hyperframes/core/gsap-parser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineClipDiamonds } from "./TimelineClipDiamonds";
import {
  getTimelinePropertyLanes,
  TimelinePropertyLanes,
  type TimelinePropertyLanesProps,
} from "./TimelinePropertyLanes";
import { timelineKeyframeSelectionKey } from "./timelineKeyframeIdentity";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function animation(
  id: string,
  propertyGroup: PropertyGroupName,
  keyframes: Array<{
    percentage: number;
    properties: Record<string, number | string>;
    ease?: string;
  }>,
): GsapAnimation {
  return {
    id,
    targetSelector: "#clip-1",
    method: "to",
    position: 0,
    duration: 1,
    properties: {},
    propertyGroup,
    keyframes: { format: "percentage", keyframes },
  };
}

function flatAnimation(
  id: string,
  propertyGroup: PropertyGroupName,
  properties: Record<string, number | string>,
): GsapAnimation {
  return {
    id,
    targetSelector: "#clip-1",
    method: "to",
    position: 0,
    duration: 1,
    properties,
    propertyGroup,
  };
}

function renderPropertyLanes(overrides: Partial<TimelinePropertyLanesProps> = {}): {
  host: HTMLDivElement;
  root: Root;
} {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <TimelinePropertyLanes
        animations={[]}
        clipStart={0}
        clipDuration={1}
        clipLeftPx={0}
        clipWidthPx={200}
        accentColor="#4ba3d2"
        isSelected
        currentPercentage={-10}
        elementId="clip-1"
        selectedKeyframes={new Set()}
        {...overrides}
      />,
    );
  });
  return { host, root };
}

function laneDiamonds(host: HTMLElement, group: string): HTMLButtonElement[] {
  return Array.from(
    host.querySelectorAll<HTMLButtonElement>(
      `[data-property-group="${group}"] button[data-keyframe-percentage]`,
    ),
  );
}

function expectLanePercentages(host: HTMLElement, group: string, percentages: string[]) {
  expect(laneDiamonds(host, group).map((diamond) => diamond.dataset.keyframePercentage)).toEqual(
    percentages,
  );
}

function laneEaseButtons(host: HTMLElement, group: string): HTMLButtonElement[] {
  return Array.from(
    host.querySelectorAll<HTMLButtonElement>(
      `[data-property-group="${group}"] button[data-keyframe-ease-button]`,
    ),
  );
}

function laneEaseSegments(host: HTMLElement, group: string): HTMLElement[] {
  return Array.from(
    host.querySelectorAll<HTMLElement>(
      `[data-property-group="${group}"] [data-keyframe-ease-segment]`,
    ),
  );
}

// The mid-segment ease button is revealed on hover (Figma parity), so tests must
// hover the segment strip before its button exists. React derives onMouseEnter
// from a bubbling mouseover, so dispatching that is what arms the hover.
function revealEaseButton(segment: HTMLElement): HTMLButtonElement | null {
  act(() => {
    segment.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  return segment.querySelector<HTMLButtonElement>("button[data-keyframe-ease-button]");
}

const POSITION_SEGMENT_ANIMATION = animation("position-tween", "position", [
  { percentage: 0, properties: { x: 0 } },
  { percentage: 50, properties: { x: 50 } },
]);

describe("TimelinePropertyLanes", () => {
  it("returns a position lane with synthesized endpoints for a flat tween", () => {
    const lanes = getTimelinePropertyLanes(
      [flatAnimation("position-tween", "position", { x: 420 })],
      0,
      1,
    );

    expect(lanes).toHaveLength(1);
    expect(lanes[0]?.group).toBe("position");
    expect(lanes[0]?.keyframes).toEqual([
      {
        percentage: 0,
        tweenPercentage: 0,
        properties: { x: 0 },
        propertyGroup: "position",
        animationId: "position-tween",
      },
      {
        percentage: 100,
        tweenPercentage: 100,
        properties: { x: 420 },
        propertyGroup: "position",
        animationId: "position-tween",
      },
    ]);
  });

  it("returns both flat and authored keyframe property groups", () => {
    const lanes = getTimelinePropertyLanes(
      [
        flatAnimation("position-tween", "position", { x: 420 }),
        animation("visual-tween", "visual", [
          { percentage: 0, properties: { opacity: 0 } },
          { percentage: 100, properties: { opacity: 1 } },
        ]),
      ],
      0,
      1,
    );

    expect(lanes.map((lane) => lane.group)).toEqual(["position", "visual"]);
    expect(lanes.map((lane) => lane.keyframes.map((keyframe) => keyframe.percentage))).toEqual([
      [0, 100],
      [0, 100],
    ]);
  });

  it("renders each source property group at its independent keyframe positions", () => {
    const animations = [
      animation("position-tween", "position", [
        { percentage: 0, properties: { x: 0, y: 0 } },
        { percentage: 50, properties: { x: 100, y: 20 } },
        { percentage: 100, properties: { x: 200, y: 40 } },
      ]),
      animation("visual-tween", "visual", [{ percentage: 25, properties: { opacity: 0.5 } }]),
    ];

    const { host, root } = renderPropertyLanes({ animations });
    const position = laneDiamonds(host, "position");
    const visual = laneDiamonds(host, "visual");

    expect(position).toHaveLength(3);
    expect(visual).toHaveLength(1);
    // Diamonds are centered on their true keyframe time (0% at -half); the
    // reserved left gutter (content origin inset, tested at the Timeline level)
    // keeps the overflowing left half visible rather than clamping it inward.
    expect(position.map((diamond) => diamond.style.left)).toEqual(["-11px", "89px", "189px"]);
    expect(visual[0]?.style.left).toBe("39px");
    expect(
      host.querySelectorAll('[data-property-group="position"] [data-keyframe-connector]'),
    ).toHaveLength(2);
    act(() => root.unmount());
  });

  it("keeps both groups' diamonds when their source keyframes share 0% and 100%", () => {
    const animations = [
      animation("position-tween", "position", [
        { percentage: 0, properties: { x: 0 } },
        { percentage: 100, properties: { x: 100 } },
      ]),
      animation("visual-tween", "visual", [
        { percentage: 0, properties: { opacity: 0 } },
        { percentage: 100, properties: { opacity: 1 } },
      ]),
    ];

    const { host, root } = renderPropertyLanes({ animations });

    expectLanePercentages(host, "position", ["0", "100"]);
    expectLanePercentages(host, "visual", ["0", "100"]);
    act(() => root.unmount());
  });

  it("renders an authored hold keyframe whose value equals its predecessor", () => {
    const animations = [
      animation("position-tween", "position", [
        { percentage: 0, properties: { x: 10 } },
        { percentage: 50, properties: { x: 10 } },
        { percentage: 100, properties: { x: 20 } },
      ]),
    ];

    const { host, root } = renderPropertyLanes({ animations });

    expectLanePercentages(host, "position", ["0", "50", "100"]);
    act(() => root.unmount());
  });

  it("keeps Position@50% selection distinct from Opacity@50%", () => {
    const onClickKeyframe = vi.fn();
    const animations = [
      animation("position-tween", "position", [{ percentage: 50, properties: { x: 50 } }]),
      animation("visual-tween", "visual", [{ percentage: 50, properties: { opacity: 0.5 } }]),
    ];
    const { host, root } = renderPropertyLanes({ animations, onClickKeyframe });
    const position = laneDiamonds(host, "position")[0]!;

    act(() => {
      position.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    });

    const target = onClickKeyframe.mock.calls[0]?.[0];
    expect(target).toEqual({
      animationId: "position-tween",
      percentage: 50,
      propertyGroup: "position",
      tweenPercentage: 50,
    });

    act(() => {
      root.render(
        <TimelinePropertyLanes
          animations={animations}
          clipStart={0}
          clipDuration={1}
          clipLeftPx={0}
          clipWidthPx={200}
          accentColor="#4ba3d2"
          isSelected
          currentPercentage={-10}
          elementId="clip-1"
          selectedKeyframes={new Set([timelineKeyframeSelectionKey("clip-1", target)])}
        />,
      );
    });

    const positionFill = laneDiamonds(host, "position")[0]?.querySelector("path:last-child");
    const visualFill = laneDiamonds(host, "visual")[0]?.querySelector("path:last-child");
    expect(positionFill?.getAttribute("fill")).toBe("#4ba3d2");
    expect(visualFill?.getAttribute("fill")).toBe("#a3a3a3");
    act(() => root.unmount());
  });

  it("keeps one focusable midpoint ease button mounted per segment", () => {
    const animations = [
      animation("position-tween", "position", [
        { percentage: 0, properties: { x: 0 } },
        { percentage: 50, properties: { x: 50 } },
        { percentage: 100, properties: { x: 100 } },
      ]),
    ];
    const { host, root } = renderPropertyLanes({ animations, onSelectSegment: vi.fn() });

    const segments = laneEaseSegments(host, "position");
    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => segment.style.left)).toEqual(["0px", "100px"]);
    expect(laneDiamonds(host, "position")).toHaveLength(3);
    const buttons = laneEaseButtons(host, "position");
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.classList.contains("focus-visible:opacity-100"))).toBe(
      true,
    );

    // The ease button is available on hover even when the element is NOT selected
    // (a lane shows for the track's active/primary clip, not only the selected one).
    act(() => {
      root.render(
        <TimelinePropertyLanes
          animations={animations}
          clipStart={0}
          clipDuration={1}
          clipLeftPx={0}
          clipWidthPx={200}
          accentColor="#4ba3d2"
          isSelected={false}
          currentPercentage={-10}
          elementId="clip-1"
          selectedKeyframes={new Set()}
          onSelectSegment={vi.fn()}
        />,
      );
    });
    const unselectedSegments = laneEaseSegments(host, "position");
    expect(unselectedSegments).toHaveLength(2);
    expect(laneEaseButtons(host, "position")).toHaveLength(2);
    act(() => root.unmount());
  });

  it("reveals each segment's button with its destination keyframe ease curve", () => {
    const animations = [
      animation("position-tween", "position", [
        { percentage: 0, properties: { x: 0 } },
        { percentage: 33, properties: { x: 33 }, ease: "none" },
        { percentage: 66, properties: { x: 66 }, ease: "power2.out" },
        {
          percentage: 100,
          properties: { x: 100 },
          ease: "custom(M0,0 C0.1,0.2 0.3,0.9 1,1)",
        },
      ]),
    ];
    const { host, root } = renderPropertyLanes({ animations, onSelectSegment: vi.fn() });

    const segments = laneEaseSegments(host, "position");
    expect(segments).toHaveLength(3);
    const paths = segments.map((segment) =>
      revealEaseButton(segment)?.querySelector("path")?.getAttribute("d"),
    );
    expect(paths).toHaveLength(3);
    expect(new Set(paths).size).toBe(3);
    act(() => root.unmount());
  });

  it("selects the destination keyframe when a hovered segment's ease button is clicked", () => {
    const onSelectSegment = vi.fn();
    const { host, root } = renderPropertyLanes({
      animations: [POSITION_SEGMENT_ANIMATION],
      onSelectSegment,
    });

    const button = revealEaseButton(laneEaseSegments(host, "position")[0]!);
    act(() => button?.click());

    expect(onSelectSegment).toHaveBeenCalledWith({
      animationId: "position-tween",
      percentage: 50,
      propertyGroup: "position",
      tweenPercentage: 50,
    });
    act(() => root.unmount());
  });

  it("routes a colliding Position segment to the Position animation", () => {
    const onSelectSegment = vi.fn();
    const animations = [
      POSITION_SEGMENT_ANIMATION,
      animation("visual-tween", "visual", [
        { percentage: 0, properties: { opacity: 0 } },
        { percentage: 50, properties: { opacity: 0.5 } },
      ]),
    ];
    const { host, root } = renderPropertyLanes({ animations, onSelectSegment });

    const button = revealEaseButton(laneEaseSegments(host, "position")[0]!);
    act(() => button?.click());

    expect(onSelectSegment.mock.calls[0]?.[0]).toMatchObject({
      animationId: "position-tween",
      propertyGroup: "position",
    });
    act(() => root.unmount());
  });

  it("keeps the collapsed TimelineClipDiamonds positions and callback contract unchanged", () => {
    const onClickKeyframe = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <TimelineClipDiamonds
          keyframesData={{
            format: "percentage",
            keyframes: [
              { percentage: 0, properties: { x: 0 } },
              { percentage: 50, properties: { x: 100 } },
            ],
          }}
          clipWidthPx={200}
          clipHeightPx={48}
          accentColor="#4ba3d2"
          isSelected
          currentPercentage={-10}
          elementId="clip-1"
          selectedKeyframes={new Set(["clip-1:50"])}
          onClickKeyframe={onClickKeyframe}
        />,
      );
    });
    const diamonds = Array.from(host.querySelectorAll<HTMLButtonElement>("button"));

    // Unified keyframe-diamond size (LANE_H·ratio ≈ 22px, half 11) on collapsed
    // clips too, so 0% sits at -11px regardless of clip-bar height.
    expect(diamonds.map((diamond) => diamond.style.left)).toEqual(["-11px", "89px"]);
    expect(diamonds[1]?.querySelector("path:last-child")?.getAttribute("fill")).toBe("#4ba3d2");
    act(() => {
      diamonds[1]?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    });
    expect(onClickKeyframe).toHaveBeenCalledWith(50);
    act(() => root.unmount());
  });
});
