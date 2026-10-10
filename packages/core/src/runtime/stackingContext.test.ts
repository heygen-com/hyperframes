import { afterEach, describe, expect, it } from "vitest";
import { PREVIEW_RASTER_ATTR } from "../studioPreviewMark";
import { ROOT_CSS_STACKING_CONTEXT_ID, resolveCssStackingContextId } from "./stackingContext";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("resolveCssStackingContextId", () => {
  it("keeps the stacking context of a layer whose hint the small preview dropped", () => {
    document.body.innerHTML = `
      <div id="layer" style="position: absolute; will-change: auto" ${PREVIEW_RASTER_ATTR}>
        <div id="clip"></div>
      </div>`;
    const clip = document.getElementById("clip")!;
    expect(resolveCssStackingContextId(clip)).not.toBe(ROOT_CSS_STACKING_CONTEXT_ID);
    document.getElementById("layer")!.removeAttribute(PREVIEW_RASTER_ATTR);
    expect(resolveCssStackingContextId(clip)).toBe(ROOT_CSS_STACKING_CONTEXT_ID);
  });
});
