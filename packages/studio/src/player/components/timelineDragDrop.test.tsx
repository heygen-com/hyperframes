// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TIMELINE_ASSET_MIME } from "../../utils/timelineAssetDrop";
import { usePlayerStore } from "../store/playerStore";
import { createTimelineRowGeometry } from "./timelineLayout";
import { useTimelineAssetDrop } from "./timelineDragDrop";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface DropTransfer {
  types: string[];
  files: File[];
  dropEffect: DataTransfer["dropEffect"];
  getData: (type: string) => string;
}

function dragEvent(transfer: DropTransfer, clientX: number, clientY: number): React.DragEvent {
  return {
    clientX,
    clientY,
    dataTransfer: transfer,
    preventDefault: vi.fn(),
  } as unknown as React.DragEvent;
}

function assetTransfer(payload: string): DropTransfer {
  return {
    types: [TIMELINE_ASSET_MIME],
    files: [],
    dropEffect: "none",
    getData: (type) => (type === TIMELINE_ASSET_MIME ? payload : ""),
  };
}

function renderHarness(onAssetDrop: ReturnType<typeof vi.fn>, sessionEpoch = 1) {
  const tracks = Array.from({ length: 100 }, (_, index) => index);
  const geometry = createTimelineRowGeometry(
    tracks,
    tracks.map(() => 48),
  );
  const scroll = document.createElement("div");
  scroll.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 800, bottom: 240, width: 800, height: 240 }) as DOMRect;
  Object.defineProperties(scroll, {
    scrollLeft: { configurable: true, writable: true, value: 0 },
    scrollTop: { configurable: true, writable: true, value: 0 },
    scrollWidth: { configurable: true, value: 10_000 },
    scrollHeight: { configurable: true, value: geometry.canvasHeight },
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 240 },
  });
  document.body.append(scroll);
  const root = createRoot(document.createElement("div"));
  let api: ReturnType<typeof useTimelineAssetDrop> | null = null;

  function Probe({ epoch }: { epoch: number }) {
    api = useTimelineAssetDrop({
      scrollRef: { current: scroll },
      ppsRef: { current: 40 },
      durationRef: { current: 120 },
      trackOrderRef: { current: tracks },
      rowGeometryRef: { current: geometry },
      contentOrigin: 0,
      sessionEpoch: epoch,
      onAssetDrop,
    });
    return null;
  }

  act(() => root.render(<Probe epoch={sessionEpoch} />));
  return {
    scroll,
    root,
    get api() {
      if (!api) throw new Error("drop harness did not render");
      return api;
    },
    rerender(epoch: number) {
      act(() => root.render(<Probe epoch={epoch} />));
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  usePlayerStore.getState().reset();
  document.body.innerHTML = "";
});

describe("useTimelineAssetDrop", () => {
  it("edge-autoscrolls the sole timeline viewport while a supported asset is held", () => {
    let frame: FrameRequestCallback | null = null;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => undefined);
    const view = renderHarness(vi.fn());

    act(() => view.api.handleAssetDragOver(dragEvent(assetTransfer("{}"), 790, 120)));
    expect(view.api.isDragOver).toBe(true);
    expect(frame).not.toBeNull();
    act(() => frame?.(0));
    expect(view.scroll.scrollLeft).toBeGreaterThan(0);
    expect(view.scroll.scrollTop).toBe(0);

    act(() => view.api.clearDropPreview());
    expect(view.api.isDragOver).toBe(false);
    act(() => view.root.unmount());
  });

  it("keeps the drop actor while moving between descendants", () => {
    const view = renderHarness(vi.fn());
    const parent = document.createElement("div");
    const child = document.createElement("div");
    parent.append(child);
    act(() => view.api.handleAssetDragOver(dragEvent(assetTransfer("{}"), 400, 100)));
    act(() =>
      view.api.handleAssetDragLeave({
        relatedTarget: child,
        currentTarget: parent,
      } as unknown as React.DragEvent),
    );
    expect(view.api.isDragOver).toBe(true);
    act(() => view.root.unmount());
  });

  it("drops once on a model row outside the mounted window and appends below the last row", () => {
    const onAssetDrop = vi.fn();
    const view = renderHarness(onAssetDrop);
    usePlayerStore.getState().setCurrentTime(12.5);
    view.scroll.scrollTop = view.scroll.scrollHeight - view.scroll.clientHeight;
    const transfer = assetTransfer(JSON.stringify({ path: "/media/hero.mp4" }));

    act(() => {
      view.api.handleAssetDragOver(dragEvent(transfer, 400, 239));
      view.api.handleAssetDrop(dragEvent(transfer, 400, 239));
    });

    expect(onAssetDrop).toHaveBeenCalledTimes(1);
    expect(onAssetDrop).toHaveBeenCalledWith("/media/hero.mp4", { start: 12.5, track: 100 });
    expect(view.api.isDragOver).toBe(false);
    act(() => view.root.unmount());
  });

  it("ignores malformed payloads and clears the actor on project reset", () => {
    const onAssetDrop = vi.fn();
    const view = renderHarness(onAssetDrop, 1);
    const transfer = assetTransfer("not-json");

    act(() => view.api.handleAssetDragOver(dragEvent(transfer, 400, 100)));
    expect(view.api.isDragOver).toBe(true);
    view.rerender(2);
    expect(view.api.isDragOver).toBe(false);

    act(() => view.api.handleAssetDrop(dragEvent(transfer, 400, 100)));
    expect(onAssetDrop).not.toHaveBeenCalled();
    act(() => view.root.unmount());
  });
});
