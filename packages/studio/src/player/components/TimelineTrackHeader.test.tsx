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
    ease?: string;
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
  keyframeClip?: TimelineElement;
  animations?: GsapAnimation[];
  clipCount?: number;
  currentTime?: number;
  expanded?: boolean;
  onSeek?: (time: number) => void;
  onTogglePropertyGroupKeyframe?: TimelineEditCallbacks["onTogglePropertyGroupKeyframe"];
  onToggleTrackHidden?: TimelineEditCallbacks["onToggleTrackHidden"];
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
          // A real fractional z-order sort key, so a label built from it would
          // read out "track 0.16666666666666666".
          trackNumber={1 / 6}
          trackDisplayNumber={1}
          trackLabel="Hero card"
          lanesId="timeline-lanes-track-0"
          contentOrigin={LABEL_COL_W}
          keyframeClip={next.keyframeClip ?? ELEMENT}
          clipCount={next.clipCount ?? 1}
          isExpanded={next.expanded !== false}
          animations={next.animations ?? [POSITION, OPACITY]}
          currentTime={next.currentTime ?? 0}
          isTrackHidden={false}
          isAudioTrack={false}
          theme={defaultTimelineTheme}
          onToggleClipExpanded={vi.fn()}
          onToggleTrackHidden={next.onToggleTrackHidden ?? vi.fn()}
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
  // An expanded sub-composition child sits on the MASTER timeline at a
  // host-absolute start, but its tweens are parsed from its own file and are
  // local to it. Feeding the raw start straight into the clip-% math put every
  // lane keyframe far outside the clip.
  it("keeps an expanded sub-comp child's lane percentages inside the clip", () => {
    const child: TimelineElement = {
      id: "pill",
      tag: "div",
      start: 16.5,
      duration: 2,
      track: 0,
      expandedParentStart: 16,
      sourceFile: "scene.html",
    };
    const local: GsapAnimation = {
      id: "pill-tween",
      targetSelector: "#pill",
      method: "to",
      position: 0.5,
      resolvedStart: 0.5,
      duration: 2,
      properties: {},
      propertyGroup: "position",
      keyframes: {
        format: "percentage",
        keyframes: [
          { percentage: 0, properties: { x: 0 } },
          { percentage: 100, properties: { x: 100 } },
        ],
      },
    };
    // Playhead at the clip's midpoint (master time), so the 100% keyframe is
    // ahead of it. On the raw host-absolute basis every keyframe rebased to a
    // large negative percentage and nothing was ever ahead of the playhead.
    const view = renderHeader({
      keyframeClip: child,
      animations: [local],
      currentTime: 17.5,
    });

    expect(
      view.host.querySelector<HTMLButtonElement>('button[aria-label="Next Position keyframe"]')
        ?.disabled,
    ).toBe(false);
    act(() => view.root.unmount());
  });

  // The header shows one clip's lanes, so how many clips the track holds is
  // otherwise invisible from the label column. A single-clip track stays silent.
  it("shows the track's clip count only once the track holds more than one clip", () => {
    const view = renderHeader({ clipCount: 1 });
    expect(view.host.querySelector('[aria-label="1 clips"]')).toBeNull();

    view.rerender({ clipCount: 3 });
    expect(view.host.querySelector('[aria-label="3 clips"]')?.textContent).toBe("3");
    act(() => view.root.unmount());
  });

  // The eye acts on the layer, so it has to be reachable without a pointer and
  // in every disclosure state — a hover-gated eye is unusable by keyboard.
  it("keeps the visibility eye mounted whether the layer is expanded or collapsed", () => {
    const view = renderHeader({ expanded: true });
    expect(view.host.querySelector('button[aria-label="Hide track 1"]')).not.toBeNull();

    view.rerender({ expanded: false });
    expect(view.host.querySelector('button[aria-label="Hide track 1"]')).not.toBeNull();
    act(() => view.root.unmount());
  });

  // trackNumber is a fractional z-order sort key, so building the label from it
  // made screen readers announce "Hide track 0.16666666666666666". The display
  // number is label-only; the toggle still routes by the real key.
  it("announces the display track number but toggles with the real fractional key", () => {
    const onToggleTrackHidden = vi.fn();
    const view = renderHeader({ onToggleTrackHidden });
    const eye = view.host.querySelector<HTMLButtonElement>('button[aria-label="Hide track 1"]');

    expect(eye).not.toBeNull();
    expect(eye?.title).toBe("Hide track 1");
    expect(view.host.innerHTML).not.toContain("0.16666666666666666");

    act(() => eye?.click());
    expect(onToggleTrackHidden).toHaveBeenCalledWith(1 / 6, true);
    act(() => view.root.unmount());
  });

  it("adds and removes a keyframe on the explicitly targeted property-group tween", () => {
    const onTogglePropertyGroupKeyframe = vi.fn();
    const view = renderHeader({ currentTime: 0.5, onTogglePropertyGroupKeyframe });

    click(view.host, "Add Opacity keyframe");
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
    click(view.host, "Remove Opacity keyframe");
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

  // The lane header sits inside the track row, whose own click handler selects
  // the track. Every control in the label column has to own its click, or
  // seeking to a keyframe also reselects whatever is behind the header.
  it("keeps lane-header control clicks off the ancestor track row", () => {
    const onAncestorClick = vi.fn();
    const view = renderHeader({
      currentTime: 1,
      onSeek: vi.fn(),
      onTogglePropertyGroupKeyframe: vi.fn(),
    });
    // React 18 delegates from the root container, so an ancestor of it is where
    // a leaked click actually shows up.
    document.body.addEventListener("click", onAncestorClick);

    // Every control in the lane's label column, found by row rather than by
    // label, so a wording change to one button can't silently drop it here.
    const controls = view.host.querySelectorAll<HTMLButtonElement>(
      '[data-property-group="position"] button',
    );
    expect(controls.length).toBeGreaterThanOrEqual(3);
    for (const button of controls) {
      act(() => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }

    document.body.removeEventListener("click", onAncestorClick);
    expect(onAncestorClick).not.toHaveBeenCalled();
    act(() => view.root.unmount());
  });

  it("fills the toggle diamond exactly at that group's keyframe", () => {
    const view = renderHeader({ currentTime: 0.5 });
    const positionToggle = view.host.querySelector<HTMLButtonElement>(
      'button[aria-label="Add Position keyframe"]',
    );
    expect(positionToggle?.textContent).toBe("◇");

    view.rerender({ currentTime: 1 });
    expect(
      view.host.querySelector<HTMLButtonElement>('button[aria-label="Remove Position keyframe"]')
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

  it("samples mid-segment values along the segment's ease, not linearly", () => {
    // GSAP hangs a segment's ease on the keyframe it arrives at, so 0% -> 50%
    // runs power2.in. Half way through that segment power2.in(0.5) = 0.125, so
    // the readout is 12.5/6.25 and NOT the linear 50/25.
    const eased = animation("eased-position", "position", [
      { percentage: 0, properties: { x: 0, y: 0 } },
      { percentage: 50, properties: { x: 100, y: 50 }, ease: "power2.in" },
      { percentage: 100, properties: { x: 200, y: 100 }, ease: "power2.in" },
    ]);
    const onTogglePropertyGroupKeyframe = vi.fn();
    const view = renderHeader({
      animations: [eased],
      currentTime: 0.5,
      onTogglePropertyGroupKeyframe,
    });

    expect(view.host.querySelector('[data-property-group="position"]')?.textContent).toContain(
      "12.5, 6.25",
    );

    // The same sampled value is what an added keyframe gets stamped with, so a
    // header insert lands on the existing curve instead of deforming it.
    click(view.host, "Add Position keyframe");
    expect(onTogglePropertyGroupKeyframe).toHaveBeenCalledOnce();
    expect(onTogglePropertyGroupKeyframe.mock.calls[0][1]).toMatchObject({
      properties: { x: 12.5, y: 6.25 },
    });
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
            id="timeline-property-lanes-alignment-test"
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
