// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  dropElementCropLift,
  liftElementCrop,
  rememberFrameClipPath,
} from "../components/editor/domEditOverlayCrop";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { OverlayRect } from "../components/editor/domEditOverlayGeometry";
import { useCropOverlay } from "./useCropOverlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sent: Array<(reply: unknown) => void> = [];
let sealed = true;
vi.mock("../player/lib/previewChannel", () => ({
  previewRequest: () => new Promise((answer) => sent.push(answer)),
}));
vi.mock("../components/editor/previewDrafts", () => ({
  previewStandIn: () => (sealed ? { iframe: {}, handle: "hf-1" } : undefined),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  sent.length = 0;
});

const rect: OverlayRect = {
  left: 0,
  top: 0,
  width: 400,
  height: 200,
  editScaleX: 1,
  editScaleY: 1,
};

/** The selection box's crop hug as the overlay last drew it. */
function drawn(element: HTMLElement) {
  const seen: Array<number | null> = [];
  function Probe() {
    const { cropOutlineInsetPx } = useCropOverlay({
      selection: { element } as DomEditSelection,
      overlayRect: rect,
    });
    seen.push(cropOutlineInsetPx?.right ?? null);
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return () => seen.at(-1);
}

// fails without the fix: the lift lives outside React, so the box kept hugging the crop after the crop handles lifted it.
it("a sealed layer picked with no press drops its crop hug once the crop handles lift it, and gets it back when the frame refuses", async () => {
  sealed = true;
  const element = document.createElement("div");
  rememberFrameClipPath(element, "inset(0px 150px 0px 0px)", "inset(0px 150px 0px 0px)");
  const hug = drawn(element);
  expect(hug()).toBe(150);
  act(() => liftElementCrop(element));
  expect(hug(), "the box shows the whole layer while it is lifted").toBe(null);
  await act(async () => sent[0]!({ lifted: false, clipPath: null }));
  expect(hug(), "a lift the frame refused leaves the crop showing").toBe(150);
});

it("an unsealed layer's crop hug follows its lift and its drop", () => {
  sealed = false;
  const element = document.body.appendChild(document.createElement("div"));
  element.id = "target";
  element.style.setProperty("clip-path", "inset(0px 150px 0px 0px)");
  const hug = drawn(element);
  expect(hug()).toBe(150);
  act(() => liftElementCrop(element));
  expect(hug()).toBe(null);
  act(() => dropElementCropLift(element));
  expect(hug()).toBe(150);
  element.remove();
});
