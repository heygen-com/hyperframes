// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  PREVIEW_RASTER_ATTR,
  RUNTIME_STAMPED_ATTR,
  STUDIO_PREVIEW_LAZY_ATTR,
  PREVIEW_VIDEO_CANVAS_ATTR,
  PREVIEW_VIDEO_FRAME_ATTR,
  PREVIEW_VIDEO_SOURCE_ATTR,
} from "@hyperframes/core/studio-preview-mark";
import { liveMarkupWithoutPreviewMarks } from "./authoredSource";

describe("liveMarkupWithoutPreviewMarks", () => {
  it("omits generated video surfaces and their hiding marks from copied composition markup", () => {
    const live = document.createElement("div");
    live.innerHTML = `<canvas ${PREVIEW_VIDEO_CANVAS_ATTR}></canvas><video src="original.webm" ${PREVIEW_VIDEO_FRAME_ATTR} ${PREVIEW_VIDEO_SOURCE_ATTR}></video><canvas id="authored"></canvas>`;
    expect(liveMarkupWithoutPreviewMarks(live)).toBe(
      '<div><video src="original.webm"></video><canvas id="authored"></canvas></div>',
    );
    expect(live.querySelectorAll("canvas")).toHaveLength(2);
  });
  it("drops the preview's raster mark from an element and its descendants", () => {
    const live = document.createElement("div");
    live.innerHTML = `<div class="line" ${PREVIEW_RASTER_ATTR}><span class="word">LOUD</span></div>`;
    live.setAttribute(PREVIEW_RASTER_ATTR, "");
    expect(liveMarkupWithoutPreviewMarks(live)).toBe(
      '<div><div class="line"><span class="word">LOUD</span></div></div>',
    );
    expect(live.hasAttribute(PREVIEW_RASTER_ATTR)).toBe(true);
  });

  it("gives a lazily previewed image back its authored loading", () => {
    const live = document.createElement("div");
    live.innerHTML = `<img src="a.png" loading="lazy" ${STUDIO_PREVIEW_LAZY_ATTR}>`;
    expect(liveMarkupWithoutPreviewMarks(live)).toBe('<div><img src="a.png"></div>');
  });

  it("drops the runtime's stamp so copied markup cannot carry it into a project file", () => {
    const live = document.createElement("div");
    live.innerHTML = `<div id="title" data-start="0" data-duration="10" ${RUNTIME_STAMPED_ATTR}="1"></div>`;
    live.setAttribute(RUNTIME_STAMPED_ATTR, "1");
    expect(liveMarkupWithoutPreviewMarks(live)).toBe(
      '<div><div id="title" data-start="0" data-duration="10"></div></div>',
    );
  });
});
