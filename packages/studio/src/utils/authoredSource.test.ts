// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { PREVIEW_RASTER_ATTR } from "@hyperframes/core/studio-preview-mark";
import { liveMarkupWithoutPreviewMarks } from "./authoredSource";

describe("liveMarkupWithoutPreviewMarks", () => {
  it("drops the preview's raster mark from an element and its descendants", () => {
    const live = document.createElement("div");
    live.innerHTML = `<div class="line" ${PREVIEW_RASTER_ATTR}><span class="word">LOUD</span></div>`;
    live.setAttribute(PREVIEW_RASTER_ATTR, "");
    expect(liveMarkupWithoutPreviewMarks(live)).toBe(
      '<div><div class="line"><span class="word">LOUD</span></div></div>',
    );
    expect(live.hasAttribute(PREVIEW_RASTER_ATTR)).toBe(true);
  });
});
