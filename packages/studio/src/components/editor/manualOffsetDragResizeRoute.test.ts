// @vitest-environment happy-dom

import { gsap } from "gsap";
import { afterEach, expect, it } from "vitest";
import { makeSelection } from "../../hooks/domSelectionTestHarness";
import { settleGsapSnapshot } from "../../hooks/gsapFrameSnapshot";
import { watchPreviewFrame } from "../../player/lib/bridgePlayback";
import { describePreviewElements, queryPreviewElements } from "../../player/lib/previewElements";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";
import { usePlayerStore } from "../../player/store/playerStore";
import { createManualOffsetDragMember } from "./manualOffsetDrag";
import { measurePreviewGestureStart } from "./previewGestureStartRead";
import { standInFor } from "./previewSelection";

// The edit accuracy bench's size layer: a tween writes its width and height, nothing moves it.
const SIZES_BOX = `var tl = gsap.timeline({ paused: true });
tl.to("#box", { width: 300, height: 200, duration: 2, ease: "none" }, 0);
window.__timelines["main"] = tl;`;

const sized = <T extends Element>(element: T, [x, y, width, height]: number[]): T => {
  element.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }) as DOMRect;
  return element;
};

function mount() {
  document.body.innerHTML = `<div data-composition-id="main" data-width="1920" data-height="1080"><div id="box" style="translate: 40px 30px"></div></div>`;
  sized(document.getElementById("box")!, [300, 200, 100, 50]);
  // happy-dom computes no translate; this GSAP reads it as Chrome's does, for both previews.
  const getProperty = (el: Element, prop: string) =>
    prop === "x" ? 40 : prop === "y" ? 30 : gsap.getProperty(el, prop);
  const frameGsap = Object.assign(Object.create(gsap), { getProperty });
  Object.assign(window, { gsap: frameGsap, __timelines: {} });
  new Function("gsap", "window", SIZES_BOX)(frameGsap, window);
  usePlayerStore.setState({ currentTime: 1, isPlaying: false });
}
afterEach(() => {
  document.body.innerHTML = "";
  for (const name of ["gsap", "__timelines"]) Reflect.deleteProperty(window, name);
  usePlayerStore.setState({ currentTime: 0, isPlaying: false });
});

async function sealedResizeMember() {
  const { iframe: sealed, frame } = sealedPreviewFrame();
  const iframe = sized(sealed, [100, 50, 960, 540]) as HTMLIFrameElement;
  watchPreviewFrame(iframe);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame as unknown as Window,
      origin: window.location.origin,
      data: { source: "hf-preview", type: "stage-size", width: 1920, height: 1080 },
    }),
  );
  const handle = (await queryPreviewElements(iframe, "#box"))!.matches[0]!.handle;
  const standIn = standInFor(iframe, (await describePreviewElements(iframe, [handle]))![0]!);
  await settleGsapSnapshot(iframe);
  const overlay = sized(document.createElement("div"), [20, 10, 1200, 800]);
  const { rect, start } = (await measurePreviewGestureStart(iframe, overlay, [handle]))!
    .elements[0]!;
  const selection = { ...makeSelection("box", standIn), id: "box", handle };
  return createManualOffsetDragMember({
    key: "box",
    selection,
    element: standIn,
    rect,
    gesture: "resize",
    start,
  });
}

function openResizeMember() {
  const box = document.getElementById("box")!;
  const rect = { left: 300, top: 200, width: 100, height: 50, editScaleX: 1, editScaleY: 1 };
  return createManualOffsetDragMember({
    key: "box",
    selection: { ...makeSelection("box", box), id: "box" },
    element: box,
    rect,
    gesture: "resize",
  });
}

// fails without the fix: sealed, a resize took its route from the press read's GSAP position alone, so a layer whose
// tween writes only its size was resized as plain CSS: an inline width and height in the file, no keyframe.
it.each(["unsealed", "sealed"])(
  "resizes a layer whose tween writes its size on GSAP's route, %s",
  async (mode) => {
    mount();
    const result = mode === "sealed" ? await sealedResizeMember() : openResizeMember();

    expect(result.ok && result.member.plainTranslate).toBe(false);
  },
);

// fails without the fix: sealed, the press took a layer GSAP does not move at GSAP x/y 0, 0, so a resize handed to
// GSAP saved a CSS-translated layer 50 px off (translate 40px 30px).
it.each(["unsealed", "sealed"])(
  "starts a resize handed to GSAP from the x/y GSAP reads for a CSS-translated layer, %s",
  async (mode) => {
    mount();
    const result = mode === "sealed" ? await sealedResizeMember() : openResizeMember();

    expect(result.ok && result.member.baseGsap).toEqual({ x: 40, y: 30 });
  },
);
