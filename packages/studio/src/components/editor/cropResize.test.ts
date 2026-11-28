// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  gsapResizeLaidOut,
  prepareCropResize,
  readCropFollowingResize,
  saveCropResize,
} from "./cropResize";
import type { DomEditSelection } from "./domEditingTypes";
import {
  applyStudioBoxSizeDraft,
  captureStudioBoxSize,
  clearStudioBoxSize,
  restoreStudioBoxSize,
} from "./manualEdits";
import { withInlineLayoutBox } from "../../hooks/domSelectionTestHarness";
import { registerPreviewStandIn } from "./previewDrafts";

function sizedElement(width: number, height: number, clip: string): HTMLElement {
  const el = withInlineLayoutBox(document.createElement("div"));
  el.style.cssText = `width: ${width}px; height: ${height}px; clip-path: ${clip}`;
  return el;
}

describe("crop during a resize", () => {
  it("follows the box only while a resize draft is live", () => {
    const el = sizedElement(300, 200, "inset(10px 60px 20px 30px round 8px)");
    const before = captureStudioBoxSize(el);
    const crop = (top: number, right: number, bottom: number, left: number) => ({
      top,
      right,
      bottom,
      left,
      radius: 8,
    });
    applyStudioBoxSizeDraft(el, { width: 600, height: 400 });
    expect(readCropFollowingResize(el)).toEqual(crop(20, 120, 40, 60));
    restoreStudioBoxSize(el, before);
    // An animated width is not a resize: the crop keeps its pixels.
    el.style.width = "600px";
    expect(readCropFollowingResize(el)).toEqual(crop(10, 60, 20, 30));
  });

  it("leaves the crop alone when the box kept its size (a resize saved as scale)", () => {
    const el = sizedElement(300, 200, "inset(0px 60px 0px 0px)");
    applyStudioBoxSizeDraft(el, { width: 450, height: 300 });
    const stage = prepareCropResize(el);
    clearStudioBoxSize(el);
    el.style.width = "300px";
    el.style.height = "200px";
    expect(stage()).toBeNull();
    expect(el.style.getPropertyValue("clip-path")).toBe("inset(0px 60px 0px 0px)");
  });

  it("puts the crop back, !important and all, when its save fails", async () => {
    const el = sizedElement(300, 200, "none");
    el.style.setProperty("clip-path", "inset(0px 60px 0px 0px)", "important");
    const stage = prepareCropResize(el);
    el.style.width = "450px";
    let priorityWhileSaving = "";
    const commit = vi.fn(() => {
      priorityWhileSaving = el.style.getPropertyPriority("clip-path");
      return Promise.reject(new Error("save failed"));
    });
    const selection = { element: el } as unknown as DomEditSelection;
    await expect(saveCropResize(stage, selection, commit, "undo-key")).rejects.toThrow(
      "save failed",
    );

    const value = "inset(0px 90px 0px 0px) !important";
    expect(commit.mock.calls[0]![1]).toEqual([
      { type: "inline-style", property: "clip-path", value },
    ]);
    expect(priorityWhileSaving).toBe("important");
    expect(el.style.getPropertyValue("clip-path")).toBe("inset(0px 60px 0px 0px)");
    expect(el.style.getPropertyPriority("clip-path")).toBe("important");
  });

  it("scales the crop once: the stage ends the draft", () => {
    const el = sizedElement(300, 200, "inset(0px 60px 0px 0px)");
    applyStudioBoxSizeDraft(el, { width: 450, height: 300 });
    prepareCropResize(el)();
    expect(readCropFollowingResize(el)).toMatchObject({ right: 90 });
  });

  it("leaves a crop edited while the size saved, and a tweened crop, alone", () => {
    const edited = sizedElement(300, 200, "inset(0px 60px 0px 0px)");
    const stageEdited = prepareCropResize(edited);
    edited.style.width = "450px";
    edited.style.setProperty("clip-path", "inset(0px 100px 0px 0px)");
    expect(stageEdited()).toBeNull();

    const tweened = sizedElement(300, 200, "inset(0px 60px 0px 0px)");
    const child = { targets: () => [tweened], vars: { clipPath: "inset(0px 120px 0px 0px)" } };
    Object.assign(window, { __timelines: { main: { getChildren: () => [child] } } });
    const stageTweened = prepareCropResize(tweened);
    tweened.style.width = "450px";
    expect(stageTweened()).toBeNull();
    Object.assign(window, { __timelines: undefined });
  });

  it("leaves a crop alone when GSAP tweens it by object-of-arrays keyframes", () => {
    const tweened = sizedElement(300, 200, "inset(0px 60px 0px 0px)");
    const kf = { clipPath: ["inset(0px 60px 0px 0px)", "inset(0px 120px 0px 0px)"] };
    const child = { targets: () => [tweened], vars: { keyframes: kf } };
    Object.assign(window, { __timelines: { main: { getChildren: () => [child] } } });
    const stage = prepareCropResize(tweened);
    tweened.style.width = "450px";
    expect(stage()).toBeNull();
    Object.assign(window, { __timelines: undefined });
  });

  it("decides before the write, which may add a width tween of its own", () => {
    const el = sizedElement(300, 200, "inset(0px 60px 0px 0px)");
    const stage = prepareCropResize(el);
    const tween = { targets: () => [el], vars: { width: 600 }, duration: () => 4 };
    Object.assign(window, { __timelines: { main: { getChildren: () => [tween] } } });
    el.style.width = "600px";
    expect(stage()?.patch.value).toBe("inset(0px 120px 0px 0px)");
    Object.assign(window, { __timelines: undefined });
  });

  it("follows only the axes GSAP does not tween, while dragging and once saved", () => {
    const resize = (vars: object, duration: number) => {
      const el = sizedElement(300, 200, "inset(20px 60px 20px 0px)");
      const tween = { targets: () => [el], vars, duration: () => duration };
      // The tween's timeline is not the first key, as after a soft reload.
      const timelines = { sub: { getChildren: () => [] }, main: { getChildren: () => [tween] } };
      Object.assign(window, { __timelines: timelines });
      applyStudioBoxSizeDraft(el, { width: 600, height: 400 });
      const { top, right } = readCropFollowingResize(el)!;
      const saved = prepareCropResize(el)()?.patch.value ?? null;
      Object.assign(window, { __timelines: undefined });
      return [[top, right], saved];
    };
    // A held width still scales; a height tween leaves the width free.
    expect(resize({ width: 473 }, 0)).toEqual([[40, 120], "inset(40px 120px 40px 0px)"]);
    expect(resize({ height: 300 }, 4)).toEqual([[20, 120], "inset(20px 120px 20px 0px)"]);
    // A width tween, in either keyframe form, leaves the height free.
    const widthOnly = [[40, 60], "inset(40px 60px 40px 0px)"];
    const percent = { "0%": { width: 300 }, "100%": { width: 600 } };
    expect(resize({ keyframes: percent }, 4)).toEqual(widthOnly);
    expect(resize({ keyframes: { width: [300, 600] } }, 4)).toEqual(widthOnly);
    expect(resize({ width: 600, height: 400 }, 4)).toEqual([[20, 60], null]);
  });
});

/** A sealed preview's stand-in: no layout here; the frame laid the element out 300 x 200. */
function sealedStandIn(clip: string): HTMLElement {
  const standIn = document.createElement("div");
  standIn.style.setProperty("clip-path", clip);
  registerPreviewStandIn(standIn, document.createElement("iframe"), "a:1");
  return standIn;
}
const FRAME_BOX = { width: 300, height: 200 };

// fails without the fix: a sealed stand-in's crop read its own 0 x 0 box, so it never followed a resize.
describe("crop during a sealed resize", () => {
  it("is drawn following the draft, from the box the frame measured", () => {
    const standIn = sealedStandIn("inset(10px 60px 20px 30px)");
    applyStudioBoxSizeDraft(standIn, { width: 600, height: 400 }, FRAME_BOX);
    expect(readCropFollowingResize(standIn)).toMatchObject({
      top: 20,
      right: 120,
      bottom: 40,
      left: 60,
    });
    clearStudioBoxSize(standIn);
  });

  it("saves rescaled to the size the resize laid out, or kept when it saved a scale", () => {
    const resized = sealedStandIn("inset(0px 60px 0px 0px)");
    expect(prepareCropResize(resized, FRAME_BOX)({ width: 600, height: 200 })?.patch.value).toBe(
      "inset(0px 120px 0px 0px)",
    );
    const scaled = sealedStandIn("inset(0px 60px 0px 0px)");
    expect(prepareCropResize(scaled, FRAME_BOX)(null)).toBeNull();
  });

  it("waits for a box the frame is still measuring", async () => {
    const standIn = sealedStandIn("inset(0px 60px 0px 0px)");
    const stage = prepareCropResize(standIn, Promise.resolve(FRAME_BOX));
    const commit = vi.fn(async () => undefined);
    const selection = { element: standIn } as unknown as DomEditSelection;
    await saveCropResize(stage, selection, commit, "k", { width: 600, height: 400 });
    expect(commit.mock.calls[0]?.[1]).toEqual([
      { type: "inline-style", property: "clip-path", value: "inset(0px 120px 0px 0px)" },
    ]);
  });
});

it("takes a GSAP resize's laid-out size, or none when it saved a scale", () => {
  const next = { width: 300.4, height: 200.6 };
  expect(gsapResizeLaidOut({ status: "persisted", savedAsScale: true }, next)).toBeNull();
  expect(gsapResizeLaidOut({ status: "persisted" }, next)).toEqual({ width: 300, height: 201 });
});
