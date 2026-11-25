// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import {
  collectSubCompositionDomChildren,
  collectSubCompositionHostState,
  hydrateTimelineFromPreview,
  reseekPreviewAtTime,
} from "./timelineSyncHydration";
import type { ClipManifestClip, PlaybackAdapter } from "../lib/playbackTypes";

const { sealedFrames } = vi.hoisted(() => ({ sealedFrames: new WeakSet<HTMLIFrameElement>() }));
vi.mock("../lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/previewChannel")>()),
  previewFrameOpaque: (iframe: HTMLIFrameElement) => sealedFrames.has(iframe),
}));

const clip = (over: Partial<ClipManifestClip>): ClipManifestClip => ({
  id: "x",
  label: "x",
  start: 0,
  duration: 1,
  track: 0,
  kind: "element",
  tagName: "div",
  compositionId: null,
  parentCompositionId: null,
  compositionSrc: null,
  assetUrl: null,
  ...over,
});

/**
 * The shape a storyboard scene actually publishes: the clip that carries
 * `data-hidden` is a `<video>` one level BELOW an id'd region wrapper.
 */
function mountScene(): Document {
  document.body.innerHTML = `
    <div id="scene-2-slot" data-composition-id="scene-2" data-composition-src="scene-2.html">
      <div data-hf-inner-root>
        <div id="scene-2-video-region" class="hf-region">
          <video id="scene-2-video" class="clip" data-start="0" data-hidden></video>
        </div>
        <div id="scene-2-title" class="clip" data-start="0" data-hidden></div>
        <div id="scene-2-caption" class="clip" data-start="0" data-timeline-locked
             data-timeline-role="caption" data-fx-chain="blur" data-automation="opacity"></div>
      </div>
    </div>`;
  return document;
}

// A composition clip is keyed by its ELEMENT id, not its `data-composition-id`
// (the runtime's clip tree publishes `scene-2-slot`), so the collector resolves
// the host by clip.id in the clip's own composition, exactly as the sibling walk does.
const sceneClips = [clip({ id: "scene-2-slot", kind: "composition", compositionId: "scene-2" })];

describe("collectSubCompositionHostState", () => {
  it("reaches a clip nested below an id'd wrapper, which the sibling walk cannot", () => {
    const doc = mountScene();

    // The walk that defines rows stops at the first id'd descendant, so the
    // video inside the region wrapper is never recorded there. That is why the
    // eye on a hidden scene video had no state to read.
    const siblings = collectSubCompositionDomChildren(doc, sceneClips, new Map());
    expect(siblings.map((child) => child.id)).toEqual([
      "scene-2-video-region",
      "scene-2-title",
      "scene-2-caption",
    ]);

    const state = collectSubCompositionHostState(doc, sceneClips);
    expect(state.get("scene-2-video")?.hidden).toBe(true);
  });

  it("records every data-* attribute an expanded child row needs", () => {
    const state = collectSubCompositionHostState(mountScene(), sceneClips);

    expect(state.get("scene-2-title")).toEqual({ hidden: true });
    expect(state.get("scene-2-caption")).toEqual({
      timelineLocked: true,
      timelineRole: "caption",
      fxChain: "blur",
      automation: "opacity",
    });
  });

  it("omits elements carrying no state, so a visible child reads as visible", () => {
    const state = collectSubCompositionHostState(mountScene(), sceneClips);

    expect(state.has("scene-2-video-region")).toBe(false);
    expect(state.get("scene-2-video")?.hidden).toBe(true);
  });

  it("reads its own host when an earlier sub-composition repeats the host's id", () => {
    document.body.innerHTML = `
      <main data-composition-id="main">
        <div id="intro-slot" data-composition-id="intro" data-composition-src="intro.html">
          <div data-hf-inner-root data-composition-id="intro">
            <div id="scene-2-slot"><p id="intro-note" data-hidden></p></div>
          </div>
        </div>
        <div id="scene-2-slot" data-composition-id="scene-2" data-composition-src="scene-2.html">
          <div data-hf-inner-root><div id="scene-2-title" data-hidden></div></div>
        </div>
      </main>`;
    const host = clip({
      id: "scene-2-slot",
      kind: "composition",
      compositionId: "scene-2",
      compositionAncestors: ["main"],
    });

    expect([...collectSubCompositionHostState(document, [host]).keys()]).toEqual(["scene-2-title"]);
    const rows = collectSubCompositionDomChildren(document, [host], new Map());
    expect(rows.map((child) => child.id)).toEqual(["scene-2-title"]);
  });

  it("reads a scene the preview unmounted from the markup it mounts with", () => {
    const markup = mountScene().getElementById("scene-2-slot")!.cloneNode(true) as Element;
    document.body.innerHTML = `<div id="scene-2-slot" data-composition-id="scene-2" data-hf-parked-scene></div>`;
    const view = window as Window & { __hfParkedSceneMarkup?: (el: Element) => Element | null };
    view.__hfParkedSceneMarkup = (el) => (el.hasAttribute("data-hf-parked-scene") ? markup : null);
    try {
      const rows = collectSubCompositionDomChildren(document, sceneClips, new Map());
      expect(rows.map((child) => child.id)).toEqual([
        "scene-2-video-region",
        "scene-2-title",
        "scene-2-caption",
      ]);
      expect(collectSubCompositionHostState(document, sceneClips).get("scene-2-video")).toEqual({
        hidden: true,
      });
    } finally {
      delete view.__hfParkedSceneMarkup;
    }
  });

  it("returns empty without a document, rather than throwing", () => {
    expect(collectSubCompositionHostState(null, sceneClips).size).toBe(0);
  });

  it("ignores clips that are not compositions", () => {
    const doc = mountScene();
    const state = collectSubCompositionHostState(doc, [clip({ id: "scene-2-slot" })]);

    expect(state.size).toBe(0);
  });
});

describe("hydrateTimelineFromPreview", () => {
  it("attaches the shortcut listeners to a frame whose document it cannot read", () => {
    const frame = {};
    Object.defineProperty(frame, "document", {
      get: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    const iframe = document.createElement("iframe");
    Object.defineProperty(iframe, "contentWindow", { value: frame });
    Object.defineProperty(iframe, "contentDocument", { value: null });
    const attachIframeShortcutListeners = vi.fn();
    hydrateTimelineFromPreview({
      iframe,
      adapter: { getDuration: () => 1 } as unknown as PlaybackAdapter,
      processTimelineMessage: vi.fn(),
      readSealedTimeline: vi.fn(),
      enrichMissingCompositions: vi.fn(),
      applyPreviewAudioState: vi.fn(),
      attachIframeShortcutListeners,
      syncTimelineElements: vi.fn(),
    });
    expect(attachIframeShortcutListeners).toHaveBeenCalledOnce();
  });
});

describe("reseekPreviewAtTime", () => {
  // Each seek message is its own task in a sealed frame, so a guard seek paints: at 1 s it showed frame 29.
  it.each([0, 0.5, 1, 3.5])("seeks a sealed frame once, to %s", (t) => {
    const iframe = document.createElement("iframe");
    sealedFrames.add(iframe);
    const seek = vi.fn();
    reseekPreviewAtTime({ seek }, t, iframe);
    expect(seek.mock.calls).toEqual([[t]]);
  });

  it("seeks a frame Studio can script to a guard time first, so an unchanged time still renders", () => {
    const seek = vi.fn();
    reseekPreviewAtTime({ seek }, 1, document.createElement("iframe"));
    expect(seek.mock.calls).toEqual([[0.999], [1]]);
  });
});
