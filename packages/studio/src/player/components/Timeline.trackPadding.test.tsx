// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Timeline } from "./Timeline";
import { installTimelineMountEnv } from "./timelineMountTestEnv";
import { usePlayerStore } from "../store/playerStore";
import { RULER_H, TRACK_H, TRACKS_BOTTOM_PAD, TRACKS_TOP_PAD } from "./timelineLayout";
import type { TimelineProps } from "./TimelineTypes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installTimelineMountEnv();

afterEach(() => {
  document.body.innerHTML = "";
});

async function mountCanvas(trackPadding?: TimelineProps["trackPadding"]) {
  usePlayerStore.setState({
    duration: 10,
    currentTime: 0,
    timelineReady: true,
    gsapAnimations: new Map(),
    elements: [{ id: "card", label: "Card", tag: "div", start: 0, duration: 4, track: 0 }],
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Timeline trackPadding={trackPadding} />));
  const canvas = Array.from(host.querySelectorAll<HTMLElement>("div.relative")).find(
    (el) => el.style.height && el.style.width,
  );
  const height = canvas?.style.height;
  const firstRowTop = host.querySelector<HTMLElement>('[data-timeline-row="0"]')?.style.top;
  act(() => root.unmount());
  return { height, firstRowTop };
}

describe("Timeline trackPadding", () => {
  it("keeps Studio's pads by default", async () => {
    expect(await mountCanvas()).toEqual({
      height: `${RULER_H + TRACKS_TOP_PAD + TRACK_H + TRACKS_BOTTOM_PAD}px`,
      firstRowTop: `${RULER_H + TRACKS_TOP_PAD}px`,
    });
  });

  it("places the first row and sizes the canvas from the host's pads", async () => {
    expect(await mountCanvas({ top: 0, bottom: TRACK_H })).toEqual({
      height: `${RULER_H + 2 * TRACK_H}px`,
      firstRowTop: `${RULER_H}px`,
    });
  });
});
