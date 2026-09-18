// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  collectSubCompositionDomChildren,
  collectTopLevelElementIds,
  syncManifestTimeline,
  collectSubCompositionHostState,
} from "./timelineSyncHydration";
import type { ClipManifestClip } from "../lib/playbackTypes";

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
// the host with getElementById(clip.id) exactly as the sibling walk does.
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

  it("returns empty without a document, rather than throwing", () => {
    expect(collectSubCompositionHostState(null, sceneClips).size).toBe(0);
  });

  it("ignores clips that are not compositions", () => {
    const doc = mountScene();
    const state = collectSubCompositionHostState(doc, [clip({ id: "scene-2-slot" })]);

    expect(state.size).toBe(0);
  });
});

describe("collectTopLevelElementIds", () => {
  const docOf = (html: string) => new DOMParser().parseFromString(html, "text/html");

  it("names the sub-composition host and a timed element, not what is nested inside them", () => {
    const doc = docOf(`<div data-composition-id="root">
      <div id="wrap"><div id="a" data-start="0" data-duration="2"><div id="inner" data-start="0"></div></div></div>
      <div id="scene" data-composition-id="scene" data-composition-src="scene.html"><div id="box" data-start="0"></div></div>
    </div>`);
    expect([...collectTopLevelElementIds(doc)!].sort()).toEqual(["a", "scene"]);
  });

  it("is null when the document has no composition root", () => {
    expect(collectTopLevelElementIds(docOf("<p>hi</p>"))).toBeNull();
    expect(collectTopLevelElementIds(null)).toBeNull();
  });
});

describe("syncManifestTimeline", () => {
  it("commits an empty timeline so a composition with no rows clears the store", () => {
    const calls: unknown[][] = [];
    syncManifestTimeline([], 10, 0, (els, duration) => calls.push([els, duration]));
    expect(calls).toEqual([[[], 10]]);
  });

  it("falls back to the store duration for clamping and passes no duration on", () => {
    const calls: unknown[][] = [];
    syncManifestTimeline([], 0, 5, (els, duration) => calls.push([els, duration]));
    expect(calls).toEqual([[[], undefined]]);
  });
});
