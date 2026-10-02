// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "./Timeline";
import { installTimelineMountEnv } from "./timelineMountTestEnv";
import { usePlayerStore } from "../store/playerStore";
import { CLIP_Y, TRACK_H, getTimelineRowTop } from "./timelineLayout";
import { TIMELINE_ASSET_MIME } from "../../utils/timelineAssetDrop";
import type { TimelineProps } from "./TimelineTypes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installTimelineMountEnv();

afterEach(() => {
  document.body.innerHTML = "";
});

const GHOST_MID = getTimelineRowTop(3) + TRACK_H / 2;
const ROW1_MID = getTimelineRowTop(1) + TRACK_H / 2;

async function mountThreeTracks(props: TimelineProps = {}) {
  usePlayerStore.setState({
    duration: 10,
    currentTime: 0,
    timelineReady: true,
    gsapAnimations: new Map(),
    selectedElementId: null,
    selectedElementIds: new Set(),
    elements: [0, 1, 2].map((track) => ({
      id: `c${track}`,
      key: `c${track}`,
      domId: `c${track}`,
      tag: "div",
      start: 0,
      duration: 2,
      track,
    })),
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Timeline {...props} />));
  const ghost = () => host.querySelector<HTMLElement>('[data-testid="timeline-ghost-lane"]');
  return { host, root, ghost };
}

describe("Timeline ghost lane", () => {
  it("draws one empty track below the last with a drop hint", async () => {
    const { root, ghost } = await mountThreeTracks({ onAssetDrop: vi.fn() });
    expect(ghost()?.textContent).toBe("Drop media here");
    expect(ghost()?.getAttribute("aria-hidden")).toBe("true");
    expect(ghost()?.style.top).toBe(`${getTimelineRowTop(3) + CLIP_Y}px`);
    expect(ghost()?.dataset.active).toBeUndefined();
    act(() => root.unmount());
  });

  it("drops the hint without a drop handler and the lane without a bottom pad", async () => {
    const readOnly = await mountThreeTracks();
    expect(readOnly.ghost()?.textContent).toBe("");
    act(() => readOnly.root.unmount());
    const unpadded = await mountThreeTracks({ trackPadding: { bottom: 0 } });
    expect(unpadded.ghost()).toBeNull();
    act(() => unpadded.root.unmount());
  });

  it("lights up under a file dragged into it and opens a new track on drop", async () => {
    const onAssetDrop = vi.fn();
    const { host, root, ghost } = await mountThreeTracks({ onAssetDrop });
    const viewport = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]")!;
    const drag = (type: string, clientY: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        clientX: { value: 400 },
        clientY: { value: clientY },
        dataTransfer: {
          value: {
            types: [TIMELINE_ASSET_MIME],
            files: [],
            dropEffect: "none",
            getData: (mime: string) => (mime === TIMELINE_ASSET_MIME ? '{"path":"a.png"}' : ""),
          },
        },
      });
      act(() => void viewport.dispatchEvent(event));
    };
    drag("dragover", ROW1_MID);
    expect(ghost()?.dataset.active).toBeUndefined();
    drag("dragover", GHOST_MID);
    expect(ghost()?.dataset.active).toBe("true");
    drag("drop", GHOST_MID);
    expect(onAssetDrop).toHaveBeenCalledWith("a.png", expect.objectContaining({ track: 3 }));
    act(() => root.unmount());
  });

  it.each([0, 2])("lights up under clip c%i dragged into it", async (track) => {
    const { host, root, ghost } = await mountThreeTracks({
      onMoveElement: vi.fn(),
      onResizeElement: vi.fn(),
    });
    const pointer = (target: EventTarget, type: string, clientY: number) =>
      act(
        () =>
          void target.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              button: 0,
              pointerId: 1,
              clientX: 400,
              clientY,
            }),
          ),
      );
    const clipMid = getTimelineRowTop(track) + TRACK_H / 2;
    pointer(host.querySelector(`[data-clip][data-el-id="c${track}"]`)!, "pointerdown", clipMid);
    pointer(window, "pointermove", ROW1_MID);
    expect(ghost()?.dataset.active).toBeUndefined();
    pointer(window, "pointermove", GHOST_MID);
    expect(ghost()?.dataset.active).toBe("true");
    // Dragging the last track's clip adds a preview row; the lane must stay under the pointer.
    expect(ghost()?.style.top).toBe(`${getTimelineRowTop(3) + CLIP_Y}px`);
    act(() => root.unmount());
  });
});
