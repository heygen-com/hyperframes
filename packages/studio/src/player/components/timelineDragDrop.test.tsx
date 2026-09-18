// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { TIMELINE_ASSET_MIME, TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { createTimelineRowGeometry } from "./timelineLayout";
import { useTimelineAssetDrop } from "./timelineDragDrop";
import { configureTimelineTestViewport } from "./timelineTestViewport";

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

function fileTransfer(files: File[]): DropTransfer {
  return { types: ["Files"], files, dropEffect: "none", getData: () => "" };
}

/** Drag-over then drop `transfer` at (x, y), wrapped in one `act`. */
function dropAt(
  api: ReturnType<typeof useTimelineAssetDrop>,
  transfer: DropTransfer,
  x: number,
  y: number,
): void {
  act(() => {
    api.handleAssetDragOver(dragEvent(transfer, x, y));
    api.handleAssetDrop(dragEvent(transfer, x, y));
  });
}

function renderHarness(
  onAssetDrop: Mock,
  sessionEpoch = 1,
  options: {
    onBlockDrop?: Mock;
    onFileDrop?: Mock;
    strict?: boolean;
    elements?: TimelineElement[];
  } = {},
) {
  const tracks = Array.from({ length: 100 }, (_, index) => index);
  const geometry = createTimelineRowGeometry(
    tracks,
    tracks.map(() => 48),
  );
  const scroll = document.createElement("div");
  configureTimelineTestViewport(scroll, geometry.canvasHeight);
  document.body.append(scroll);
  const root = createRoot(document.createElement("div"));
  let api: ReturnType<typeof useTimelineAssetDrop> | null = null;

  function Probe({ epoch }: { epoch: number }) {
    api = useTimelineAssetDrop({
      scrollRef: { current: scroll },
      ppsRef: { current: 40 },
      trackOrderRef: { current: tracks },
      rowGeometryRef: { current: geometry },
      contentOrigin: 0,
      sessionEpoch: epoch,
      onAssetDrop,
      onBlockDrop: options.onBlockDrop,
      onFileDrop: options.onFileDrop,
      elements: options.elements ?? [],
    });
    return null;
  }

  const renderProbe = (epoch: number) =>
    root.render(
      options.strict ? (
        <React.StrictMode>
          <Probe epoch={epoch} />
        </React.StrictMode>
      ) : (
        <Probe epoch={epoch} />
      ),
    );
  act(() => renderProbe(sessionEpoch));
  return {
    scroll,
    root,
    get api() {
      if (!api) throw new Error("drop harness did not render");
      return api;
    },
    rerender(epoch: number) {
      act(() => renderProbe(epoch));
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
    view.scroll.scrollTop = view.scroll.scrollHeight - view.scroll.clientHeight;
    const transfer = assetTransfer(JSON.stringify({ path: "/media/hero.mp4" }));

    dropAt(view.api, transfer, 400, 239);

    expect(onAssetDrop).toHaveBeenCalledTimes(1);
    // pps=40, clientX=400 -> 10s at the pointer, not the playhead.
    expect(onAssetDrop).toHaveBeenCalledWith("/media/hero.mp4", { start: 10, track: 100 });
    expect(view.api.isDragOver).toBe(false);
    act(() => view.root.unmount());
  });

  it("places the drop at the pointer x, ignoring the playhead", () => {
    const onAssetDrop = vi.fn();
    // A clip already on the main track — the AD96 empty-main-track snap must
    // not interfere with this test's actual subject (pointer x vs. playhead).
    const seed: TimelineElement = { id: "seed", tag: "video", start: 0, duration: 3, track: 0 };
    const view = renderHarness(onAssetDrop, 1, { elements: [seed] });
    usePlayerStore.getState().setCurrentTime(50);
    const transfer = assetTransfer(JSON.stringify({ path: "/media/hero.mp4" }));

    dropAt(view.api, transfer, 80, 100);

    // pps=40, clientX=80 -> 2s, far from the 50s playhead: proves start tracks
    // the drop position, not usePlayerStore.currentTime.
    expect(onAssetDrop).toHaveBeenCalledWith("/media/hero.mp4", { start: 2, track: 0 });
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

  it("falls through a malformed asset payload to a valid block payload", () => {
    const onAssetDrop = vi.fn();
    const onBlockDrop = vi.fn();
    const view = renderHarness(onAssetDrop, 1, { onBlockDrop });
    const transfer: DropTransfer = {
      types: [TIMELINE_ASSET_MIME, TIMELINE_BLOCK_MIME],
      files: [],
      dropEffect: "none",
      getData: (type) =>
        type === TIMELINE_ASSET_MIME
          ? "not-json"
          : type === TIMELINE_BLOCK_MIME
            ? JSON.stringify({ name: "title-card" })
            : "",
    };

    dropAt(view.api, transfer, 400, 100);

    expect(onAssetDrop).not.toHaveBeenCalled();
    // pps=40, clientX=400 -> 10s at the pointer.
    expect(onBlockDrop).toHaveBeenCalledExactlyOnceWith("title-card", { start: 10, track: 0 });
    act(() => view.root.unmount());
  });

  it("clears an escaped drag after StrictMode effect replay", () => {
    const view = renderHarness(vi.fn(), 1, { strict: true });
    act(() => view.api.handleAssetDragOver(dragEvent(assetTransfer("{}"), 400, 100)));
    expect(view.api.isDragOver).toBe(true);

    act(() => window.dispatchEvent(new Event("dragend")));
    expect(view.api.isDragOver).toBe(false);
    act(() => view.root.unmount());
  });

  describe("magnetic first clip on an empty main track (AD96)", () => {
    it("an asset dropped onto an empty main track snaps to start 0", () => {
      const onAssetDrop = vi.fn();
      const view = renderHarness(onAssetDrop);
      const transfer = assetTransfer(JSON.stringify({ path: "/media/hero.mp4" }));

      dropAt(view.api, transfer, 80, 100);

      // clientX=80 would normally place it at 2s (see the playhead test); the
      // empty main track (track 0) overrides that to 0.
      expect(onAssetDrop).toHaveBeenCalledWith("/media/hero.mp4", { start: 0, track: 0 });
      act(() => view.root.unmount());
    });

    it("an audio asset dropped onto an empty track 0 is not snapped (not the main track)", () => {
      const onAssetDrop = vi.fn();
      const view = renderHarness(onAssetDrop);
      const transfer = assetTransfer(JSON.stringify({ path: "/media/song.mp3" }));

      dropAt(view.api, transfer, 80, 100);

      expect(onAssetDrop).toHaveBeenCalledWith("/media/song.mp3", { start: 2, track: 0 });
      act(() => view.root.unmount());
    });

    it("a file dropped onto an empty main track snaps the batch's start to 0", () => {
      const onFileDrop = vi.fn();
      const view = renderHarness(vi.fn(), 1, { onFileDrop });
      const file = new File(["data"], "clip.mp4", { type: "video/mp4" });
      const transfer = fileTransfer([file]);

      dropAt(view.api, transfer, 80, 100);

      expect(onFileDrop).toHaveBeenCalledWith([file], { start: 0, track: 0 });
      act(() => view.root.unmount());
    });
  });
});
