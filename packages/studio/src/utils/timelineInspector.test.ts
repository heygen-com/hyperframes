import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import {
  canInspectTimelineElement,
  getTimelineLayerVisibilityInPreview,
  getTimelineElementKey,
  isAudioTimelineElement,
  isTimelineElementActiveAtTime,
  isTimelineLayerVisibleInPreview,
  shouldShowTimelineInspectorBounds,
} from "./timelineInspector";

function createDocument(markup: string): Document {
  const window = new Window();
  window.document.body.innerHTML = markup;
  return window.document;
}

function attachVisibleBox(element: HTMLElement) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 34,
      height: 24,
      left: 10,
      right: 90,
      top: 10,
      width: 80,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    }),
  });
}

describe("timeline inspector", () => {
  it("keeps visual clips inspectable and audio-only clips out of the visual panel", () => {
    expect(canInspectTimelineElement({ tag: "section" })).toBe(true);
    expect(canInspectTimelineElement({ tag: "video", src: "assets/demo.mp4" })).toBe(true);
    expect(canInspectTimelineElement({ tag: "audio" })).toBe(false);
    expect(canInspectTimelineElement({ tag: "div", src: "assets/narration.mp3" })).toBe(false);
    expect(isAudioTimelineElement({ tag: "sfx" })).toBe(true);
  });

  it("uses stable timeline keys and only shows bounds at clip edges", () => {
    expect(getTimelineElementKey({ id: "card", key: "index.html#card" })).toBe("index.html#card");
    expect(shouldShowTimelineInspectorBounds(2, { start: 2, duration: 4 })).toBe(true);
    expect(shouldShowTimelineInspectorBounds(6, { start: 2, duration: 4 })).toBe(true);
    expect(shouldShowTimelineInspectorBounds(4, { start: 2, duration: 4 })).toBe(false);
  });

  it("keeps selected layer bounds visible only while the clip is active", () => {
    expect(isTimelineElementActiveAtTime(1.99, { start: 2, duration: 4 }, 0)).toBe(false);
    expect(isTimelineElementActiveAtTime(2, { start: 2, duration: 4 }, 0)).toBe(true);
    expect(isTimelineElementActiveAtTime(4, { start: 2, duration: 4 }, 0)).toBe(true);
    expect(isTimelineElementActiveAtTime(6, { start: 2, duration: 4 }, 0)).toBe(true);
    expect(isTimelineElementActiveAtTime(6.01, { start: 2, duration: 4 }, 0)).toBe(false);
  });

  it("uses composite visibility for nested layers", () => {
    const hiddenDoc = createDocument(`<div style="opacity: 0"><span id="label">Label</span></div>`);
    const hiddenLabel = hiddenDoc.getElementById("label") as HTMLElement;
    attachVisibleBox(hiddenLabel);
    expect(isTimelineLayerVisibleInPreview(hiddenLabel)).toBe(false);

    const visibleDoc = createDocument(
      `<div style="opacity: 1"><span id="label">Label</span></div>`,
    );
    const visibleLabel = visibleDoc.getElementById("label") as HTMLElement;
    attachVisibleBox(visibleLabel);
    expect(isTimelineLayerVisibleInPreview(visibleLabel)).toBe(true);
    expect(getTimelineLayerVisibilityInPreview(visibleLabel)).toMatchObject({
      compositeOpacity: 1,
      hasBox: true,
      inViewport: true,
      visible: true,
    });
  });
});
