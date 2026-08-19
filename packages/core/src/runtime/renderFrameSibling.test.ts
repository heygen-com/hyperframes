import { describe, it, expect, beforeEach } from "vitest";
import { MEDIA_RENDER_ID_ATTR } from "../compiler/mediaRenderIds";
import {
  readMediaRenderId,
  renderFrameElementId,
  findInjectedRenderFrame,
} from "./renderFrameSibling";

function videoWith(attrs: Record<string, string>): HTMLVideoElement {
  const el = document.createElement("video");
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
}

describe("readMediaRenderId", () => {
  it("prefers the stamped render id over the author id", () => {
    expect(readMediaRenderId(videoWith({ id: "clip", [MEDIA_RENDER_ID_ATTR]: "clip__hf2" }))).toBe(
      "clip__hf2",
    );
  });

  it("falls back to the author id in an uncompiled document", () => {
    expect(readMediaRenderId(videoWith({ id: "clip" }))).toBe("clip");
  });

  it("returns null when the element has neither", () => {
    expect(readMediaRenderId(videoWith({}))).toBeNull();
  });
});

describe("renderFrameElementId", () => {
  // Pins the id format the engine's in-page bridge mirrors when it CREATES the
  // sibling (screenshotService.ensureRenderFrameSiblings). If this format
  // changes on one side only, the readers stop finding the frame.
  it("wraps the render id in the injector's sibling id format", () => {
    expect(renderFrameElementId(videoWith({ id: "hero" }))).toBe("__render_frame_hero__");
    expect(renderFrameElementId(videoWith({ id: "c", [MEDIA_RENDER_ID_ATTR]: "c__hf2" }))).toBe(
      "__render_frame_c__hf2__",
    );
  });
});

describe("findInjectedRenderFrame", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves each colliding video to its own frame, not the first one's", () => {
    // Two scenes sharing `<video id="clip">`. Resolving by author id returned
    // scene-a's frame for both, so scene-b read another clip's pixels.
    document.body.innerHTML =
      `<video id="clip" ${MEDIA_RENDER_ID_ATTR}="clip"></video>` +
      `<img id="__render_frame_clip__" class="__render_frame__">` +
      `<video id="clip" ${MEDIA_RENDER_ID_ATTR}="clip__hf2"></video>` +
      `<img id="__render_frame_clip__hf2__" class="__render_frame__">`;

    const [first, second] = Array.from(document.querySelectorAll("video"));
    expect(findInjectedRenderFrame(first!)?.id).toBe("__render_frame_clip__");
    expect(findInjectedRenderFrame(second!)?.id).toBe("__render_frame_clip__hf2__");
  });

  it("still resolves by author id when the document was never compiled", () => {
    document.body.innerHTML =
      '<video id="solo"></video><img id="__render_frame_solo__" class="__render_frame__">';
    expect(findInjectedRenderFrame(document.querySelector("video")!)?.id).toBe(
      "__render_frame_solo__",
    );
  });

  it("returns null in preview, where no sibling exists", () => {
    document.body.innerHTML = '<video id="solo"></video>';
    expect(findInjectedRenderFrame(document.querySelector("video")!)).toBeNull();
  });
});
