// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineTrackHeader } from "./TimelineTrackHeader";
import { defaultTimelineTheme } from "./timelineTheme";
import type { TimelineElement } from "../store/playerStore";
import { LABEL_COL_W, TRACK_H } from "./timelineLayout";
import { AUTOMATION_LANE_H } from "./automationLaneHeight";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => (document.body.innerHTML = ""));

const ELEMENT: TimelineElement = {
  id: "clip-1",
  label: "Hero card",
  tag: "div",
  start: 0,
  duration: 2,
  track: 0,
};

function renderHeader(
  options: {
    clip?: TimelineElement;
    elements?: readonly TimelineElement[];
    expanded?: boolean;
    audio?: boolean;
    hidden?: boolean;
    onHidden?: (track: number, hidden: boolean, displayNumber?: number | null) => void;
    onRemove?: (target: string) => void;
  } = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const clip = options.clip ?? ELEMENT;
  act(() =>
    root.render(
      <TimelineTrackHeader
        trackNumber={1 / 6}
        trackDisplayNumber={1}
        trackLabel={clip.label ?? "Hero card"}
        lanesId="timeline-lanes-track-0"
        contentOrigin={LABEL_COL_W}
        keyframeClip={clip}
        trackElements={options.elements ?? [clip]}
        clipCount={options.elements?.length ?? 1}
        isExpanded={options.expanded !== false}
        isTrackHidden={options.hidden ?? false}
        isAudioTrack={options.audio ?? false}
        isGroupMember={false}
        theme={defaultTimelineTheme}
        onToggleClipExpanded={vi.fn()}
        onToggleTrackHidden={options.onHidden ?? vi.fn()}
        onRemoveAutomationLane={options.onRemove}
      />,
    ),
  );
  return { host, root };
}

describe("TimelineTrackHeader", () => {
  it("keeps visibility controls off audio headers", () => {
    const { host, root } = renderHeader({ audio: true });
    expect(host.querySelector('button[aria-label^="Hide track"]')).toBeNull();
    act(() => root.unmount());
  });

  it("toggles the real track key while announcing its display number", () => {
    const onHidden = vi.fn();
    const { host, root } = renderHeader({ onHidden });
    const eye = host.querySelector<HTMLButtonElement>('button[aria-label="Hide track 1"]');
    expect(eye?.title).toBe("Hide track 1");
    act(() => eye?.click());
    expect(onHidden).toHaveBeenCalledWith(1 / 6, true, 1);
    act(() => root.unmount());
  });

  it("renders and removes audio envelope rows", () => {
    const onRemove = vi.fn();
    const clip: TimelineElement = {
      ...ELEMENT,
      tag: "audio",
      automation: JSON.stringify({
        version: 1,
        lanes: [{ target: "volume", points: [{ t: 0, v: 1 }] }],
      }),
    };
    const { host, root } = renderHeader({ clip, audio: true, hidden: true, onRemove });
    const lane = host.querySelector<HTMLElement>("[data-automation-lane-label]");
    expect(lane).not.toBeNull();
    expect(lane?.style.top).toBe("48px");
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label$="automation"]')?.click());
    expect(onRemove).toHaveBeenCalledWith("volume");
    act(() => root.unmount());
  });

  it("hides audio envelope rows when collapsed", () => {
    const clip: TimelineElement = {
      ...ELEMENT,
      tag: "audio",
      automation: JSON.stringify({ version: 1, lanes: [{ target: "volume", points: [] }] }),
    };
    const { host, root } = renderHeader({ clip, audio: true, expanded: false });
    expect(host.querySelectorAll("[data-automation-lane-label]")).toHaveLength(0);
    act(() => root.unmount());
  });

  it("stacks a second automation label at the curve's own stride, not the keyframe stride", () => {
    const clip: TimelineElement = {
      ...ELEMENT,
      tag: "audio",
      automation: JSON.stringify({
        version: 1,
        lanes: [
          { target: "volume", points: [{ t: 0, v: 1 }] },
          { target: "rate", points: [{ t: 0, v: 1 }] },
        ],
      }),
    };
    const { host, root } = renderHeader({ clip, audio: true });
    const labels = [...host.querySelectorAll<HTMLElement>("[data-automation-lane-label]")];
    expect(labels).toHaveLength(2);
    const curveTops = labels.map((_, index) => TRACK_H + index * AUTOMATION_LANE_H);
    expect(labels.map((el) => Number(el.dataset.timelineLaneTop))).toEqual(curveTops);
    act(() => root.unmount());
  });

  it("names a shared audio track rather than the selected clip", () => {
    const automation = JSON.stringify({
      version: 1,
      lanes: [{ target: "volume", points: [{ t: 0, v: 1 }] }],
    });
    const first = { ...ELEMENT, id: "first", tag: "audio", automation };
    const second = { ...ELEMENT, id: "second", tag: "audio", automation };
    const { host, root } = renderHeader({ clip: second, elements: [first, second], audio: true });
    expect(host.querySelector('button[aria-label="Hide Track 1 lanes"]')).not.toBeNull();
    expect(host.textContent).not.toContain("second");
    act(() => root.unmount());
  });
});
