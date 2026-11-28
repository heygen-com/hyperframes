// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { rememberGestureStartLayouts } from "./gestureStartLayouts";
import {
  applyStudioBoxSize,
  applyStudioBoxSizeDraft,
  forgetStudioBoxSizeDraftBase,
  readStudioBoxSizeDraftBase,
} from "./manualEditsDom";
import {
  STUDIO_ORIGINAL_BOX_HEIGHT_ATTR,
  STUDIO_ORIGINAL_BOX_WIDTH_ATTR,
} from "./manualEditsTypes";
import { registerPreviewStandIn } from "./previewDrafts";

/** An element laid out 240 x 160 in the page, as an open preview's is. */
function openElement() {
  const element = document.createElement("div");
  Object.defineProperties(element, {
    offsetWidth: { configurable: true, value: 240 },
    offsetHeight: { configurable: true, value: 160 },
  });
  return element;
}

/** A sealed preview's stand-in for that element: it has no layout here; the frame measured 240 x 160 at the press. */
function sealedStandIn(handle: string) {
  const standIn = document.createElement("div");
  registerPreviewStandIn(standIn, document.createElement("iframe"), handle);
  rememberGestureStartLayouts([{ handle, layout: { width: 240, height: 160 } }]);
  return standIn;
}

const originalBox = (element: HTMLElement) => [
  element.getAttribute(STUDIO_ORIGINAL_BOX_WIDTH_ATTR),
  element.getAttribute(STUDIO_ORIGINAL_BOX_HEIGHT_ATTR),
];

// fails without the fix: the stamp read the stand-in's own offset size, so a sealed resize saved 0 x 0.
describe("a sealed resize saves the element's original box as an open one does", () => {
  it("stamps the box the frame measured at the press, the same as open's", () => {
    const open = openElement();
    applyStudioBoxSize(open, { width: 340, height: 227 });
    const sealed = sealedStandIn("a:1");
    applyStudioBoxSize(sealed, { width: 340, height: 227 });
    expect(originalBox(open)).toEqual(["240", "160"]);
    expect(originalBox(sealed)).toEqual(originalBox(open));
  });

  it("starts a sealed resize draft from that box too", () => {
    const sealed = sealedStandIn("a:2");
    applyStudioBoxSizeDraft(sealed, { width: 300, height: 200 });
    expect(readStudioBoxSizeDraftBase(sealed)).toEqual({ width: 240, height: 160 });
    forgetStudioBoxSizeDraftBase(sealed);
  });
});
