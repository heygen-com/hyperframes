// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTimelineStackingReorder, extendRootDurationIfNeeded } from "./timelineEditingHelpers";
import type { TimelineElement } from "../player/store/playerStore";
import { usePlayerStore } from "../player/store/playerStore";

afterEach(() => {
  usePlayerStore.getState().reset();
});

function makeIframeWith(html: string): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("expected iframe document");
  doc.body.innerHTML = html;
  return iframe;
}

function el(input: Partial<TimelineElement> & { id: string; tag: string }): TimelineElement {
  return {
    label: input.id,
    start: 0,
    duration: 5,
    track: 0,
    zIndex: 0,
    hasExplicitZIndex: false,
    stackingContextId: null,
    ...input,
  };
}

describe("applyTimelineStackingReorder", () => {
  it("commits via the change's own locator even when the element is not in timelineElements", () => {
    // Sub-comp children live in the preview iframe but NOT in the top-level
    // timelineElements list — the intent must be self-contained.
    const iframe = makeIframeWith(`<div id="chip" style="z-index: 1"></div>`);
    const commit = vi.fn<(entries: unknown[]) => void>();

    applyTimelineStackingReorder({
      element: el({ id: "chip", tag: "div" }),
      stackingReorder: {
        contextKey: "scene",
        placement: { type: "above", layerId: "layer:scene:x" },
        zIndexChanges: [
          {
            key: "scenes/scene.html#chip",
            zIndex: 5,
            domId: "chip",
            sourceFile: "scenes/scene.html",
          },
        ],
      },
      timelineElements: [], // element intentionally absent from the top-level list
      iframe,
      activeCompPath: "index.html",
      commit,
    });

    expect(commit).toHaveBeenCalledTimes(1);
    const entries = commit.mock.calls[0]![0] as Array<{
      zIndex: number;
      id?: string;
      sourceFile: string;
    }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.zIndex).toBe(5);
    expect(entries[0]!.id).toBe("chip");
    expect(entries[0]!.sourceFile).toBe("scenes/scene.html");
  });

  it("never commits when the dragged clip is audio", () => {
    const iframe = makeIframeWith(`<audio id="track"></audio>`);
    const commit = vi.fn<(entries: unknown[]) => void>();

    applyTimelineStackingReorder({
      element: el({ id: "track", tag: "audio" }),
      stackingReorder: {
        contextKey: "main",
        placement: { type: "above", layerId: "layer:main:x" },
        zIndexChanges: [{ key: "track", zIndex: 5, domId: "track" }],
      },
      timelineElements: [],
      iframe,
      activeCompPath: "index.html",
      commit,
    });

    expect(commit).not.toHaveBeenCalled();
  });
});

describe("extendRootDurationIfNeeded", () => {
  it("extends the player duration only when the new end is larger", () => {
    usePlayerStore.getState().setDuration(4);

    expect(extendRootDurationIfNeeded(5)).toBe(true);
    expect(usePlayerStore.getState().duration).toBe(5);

    expect(extendRootDurationIfNeeded(5)).toBe(false);
    expect(extendRootDurationIfNeeded(3)).toBe(false);
    expect(usePlayerStore.getState().duration).toBe(5);
  });
});
