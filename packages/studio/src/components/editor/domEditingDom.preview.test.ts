// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import {
  PREVIEW_VIDEO_FRAME_ATTR,
  PREVIEW_VIDEO_CANVAS_ATTR,
} from "@hyperframes/core/studio-preview-mark";
import { getCuratedComputedStyles, isElementVisibleThroughAncestors } from "./domEditingDom";
import {
  collectDomEditLayerItems,
  resolveDomEditSelection,
  resolveVisualDomEditSelectionTarget,
} from "./domEditing";

const options = { activeCompositionPath: "index.html", isMasterView: true, skipSourceProbe: true };
afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

function preview(opacity: string) {
  document.head.innerHTML = `<style>[${PREVIEW_VIDEO_FRAME_ATTR}] { opacity: 0 !important; }</style>`;
  document.body.innerHTML = `<main data-composition-id="main"><canvas ${PREVIEW_VIDEO_CANVAS_ATTR} style="opacity:${opacity}" data-hf-ignore></canvas><video id="clip" ${PREVIEW_VIDEO_FRAME_ATTR} style="opacity:${opacity}" src="clip.mp4"></video></main>`;
  const video = document.querySelector("video")!;
  const canvas = document.querySelector("canvas")!;
  const root = document.querySelector("main")!;
  Object.defineProperty(video, "getBoundingClientRect", {
    value: () => ({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 210,
      bottom: 120,
      width: 200,
      height: 100,
    }),
  });
  return { video, canvas, root };
}

it("keeps a provider-backed video selectable and listed with its logical opacity", async () => {
  const { video, canvas, root } = preview("0.65");
  expect(getComputedStyle(video).opacity).toBe("0");
  expect(isElementVisibleThroughAncestors(video)).toBe(true);
  expect(resolveVisualDomEditSelectionTarget([canvas, video])).toBe(video);
  expect(collectDomEditLayerItems(root, options).map((item) => item.element)).toEqual([video]);
  const selected = await resolveDomEditSelection(video, options);
  expect(selected?.computedStyles.opacity).toBe("0.65");
  expect(selected?.inlineStyles.opacity).toBe("0.65");
  expect(getComputedStyle(video).opacity).toBe("0");
});

it("keeps authored zero opacity invisible and reports zero to the inspector", async () => {
  const { video, canvas } = preview("0");
  expect(isElementVisibleThroughAncestors(video)).toBe(false);
  expect(resolveVisualDomEditSelectionTarget([canvas, video])).toBeNull();
  expect(getCuratedComputedStyles(video).opacity).toBe("0");
  const selected = await resolveDomEditSelection(video, options);
  expect(selected?.computedStyles.opacity).toBe("0");
  expect(video.style.opacity).toBe("0");
});

it("still respects a hidden ancestor when the preview frame itself is visible", () => {
  const { video, root } = preview("0.65");
  root.style.opacity = "0";
  expect(isElementVisibleThroughAncestors(video)).toBe(false);
  expect(resolveVisualDomEditSelectionTarget([video])).toBeNull();
});

it("does not treat an unrelated preceding canvas as the video's visible frame", () => {
  const { video, canvas } = preview("0.65");
  canvas.removeAttribute(PREVIEW_VIDEO_CANVAS_ATTR);
  expect(isElementVisibleThroughAncestors(video)).toBe(false);
  expect(getCuratedComputedStyles(video).opacity).toBe("0");
});
