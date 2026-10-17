import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("resolveCssStackingContextId with a pass memo", () => {
  it("answers siblings as alone and reads their ancestors' style once", () => {
    document.body.innerHTML =
      `<div id="ctx" style="position:relative;z-index:1"><div id="row">` +
      `<video></video><video></video><video></video></div></div><p><span></span></p>`;
    const nodes = [...document.querySelectorAll("video, span")];
    const alone = nodes.map((node) => resolveCssStackingContextId(node));
    const reads = vi.spyOn(window, "getComputedStyle");
    const byParent = new Map<Element | null, string>();
    expect(nodes.map((node) => resolveCssStackingContextId(node, byParent))).toEqual(alone);
    expect(reads.mock.calls.filter(([el]) => el === document.getElementById("row"))).toHaveLength(
      1,
    );
    reads.mockRestore();
  });
});
