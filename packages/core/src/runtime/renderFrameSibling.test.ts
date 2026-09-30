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

  it("resolves a staged copy of a scene to the copy's own frame (#3994)", () => {
    // Page-side shader transitions clone the scene, ids included, into a staging
    // layer. The copy's video must pair with the copy's frame: pairing it with the
    // live one sent two color-grading canvases fighting over one <img>.
    const scene =
      `<div class="scene"><video id="clip" ${MEDIA_RENDER_ID_ATTR}="clip"></video>` +
      `<img id="__render_frame_clip__" class="__render_frame__"></div>`;
    document.body.innerHTML = scene + `<div class="staging">${scene}</div>`;

    const [liveVideo, stagedVideo] = Array.from(document.querySelectorAll("video"));
    const [liveFrame, stagedFrame] = Array.from(document.querySelectorAll("img"));
    expect(findInjectedRenderFrame(liveVideo!)).toBe(liveFrame);
    expect(findInjectedRenderFrame(stagedVideo!)).toBe(stagedFrame);
  });

  it("finds its frame past a node inserted between them", () => {
    document.body.innerHTML =
      '<video id="solo"></video><canvas></canvas><img id="__render_frame_solo__" class="__render_frame__">';
    expect(findInjectedRenderFrame(document.querySelector("video")!)).toBe(
      document.querySelector("img"),
    );
  });

  it("still resolves a frame that is not a sibling, by id", () => {
    document.body.innerHTML =
      '<div><video id="solo"></video></div><img id="__render_frame_solo__" class="__render_frame__">';
    expect(findInjectedRenderFrame(document.querySelector("video")!)).toBe(
      document.querySelector("img"),
    );
  });

  it("returns null in preview, where no sibling exists", () => {
    document.body.innerHTML = '<video id="solo"></video>';
    expect(findInjectedRenderFrame(document.querySelector("video")!)).toBeNull();
  });
});
