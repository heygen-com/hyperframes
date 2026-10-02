// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import {
  applyMediaMetadataFromElement,
  getTimelineElementSelector,
  isVideoAudible,
  resolveMediaElement,
} from "./timelineElementHelpers";

describe("isVideoAudible — the compiler's data-has-audio rule", () => {
  it("explicit data-has-audio wins", () => {
    expect(isVideoAudible({ tag: "video", hasAudioAttr: "true", muted: false })).toBe(true);
    expect(isVideoAudible({ tag: "video", hasAudioAttr: "false", muted: false })).toBe(false);
  });
  it("no attribute: an unmuted video is audible, a muted one is not", () => {
    expect(isVideoAudible({ tag: "video", hasAudioAttr: null, muted: false })).toBe(true);
    expect(isVideoAudible({ tag: "video", hasAudioAttr: undefined, muted: true })).toBe(false);
  });
  it("never true for non-video without the attribute", () => {
    expect(isVideoAudible({ tag: "img", hasAudioAttr: null, muted: false })).toBe(false);
  });
});

describe("preview nodes built in another realm", () => {
  // The Studio preview's body carries the editor window's prototypes, so its
  // nodes fail `instanceof` against their own window's HTMLElement.
  function foreignNode(html: string): Element {
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const node = holder.firstElementChild!;
    document.body.appendChild(node);
    Object.setPrototypeOf(node, Object.create(Element.prototype));
    expect(node instanceof HTMLElement).toBe(false);
    return node;
  }

  it("gives a row with an id its id selector", () => {
    const el = foreignNode(`<div id="layer-00" class="clip layer"></div>`);
    expect(getTimelineElementSelector(el)).toBe("#layer-00");
  });

  it("reads media metadata off a foreign <video>", () => {
    const el = foreignNode(`<video src="a.mp4" data-source-duration="12"></video>`);
    expect(resolveMediaElement(el)).toBe(el);
    const entry = { id: "v", tag: "div", start: 0, duration: 4, track: 0 } as TimelineElement;
    applyMediaMetadataFromElement(entry, el);
    expect(entry.sourceDuration).toBe(12);
  });
});
