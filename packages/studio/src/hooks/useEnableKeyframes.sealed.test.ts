// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { describePreviewElements, queryPreviewElements } from "../player/lib/previewElements";
import { usePlayerStore } from "../player/store/playerStore";
import { standInFor } from "../components/editor/previewSelection";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { applyKeyframeAtPlayhead, type EnableKeyframesSession } from "./useEnableKeyframes";
import { sealedPreviewFrame } from "../player/lib/sealedPreviewFrame.test-helpers";

afterEach(() => {
  usePlayerStore.setState({ currentTime: 0, isPlaying: false });
  document.body.innerHTML = "";
  for (const name of ["gsap", "__timelines", "__player"]) Reflect.deleteProperty(window, name);
});

/** The frame's GSAP: one keyframed tween moving #box, paused half way where GSAP has it at 120, 40. */
function frameGsapAt(seconds: number) {
  const box = document.getElementById("box")!;
  const live = { x: 120, y: 40 } as Record<string, number>;
  const tween = {
    targets: () => [box],
    vars: { keyframes: { "0%": { x: 0, y: 0 }, "100%": { x: 200, y: 80 } }, duration: 1 },
    startTime: () => 0,
    duration: () => 1,
    _initted: true,
  };
  Object.assign(window, {
    gsap: { getProperty: (el: Element, prop: string) => (el === box ? live[prop] : 0) },
    __timelines: { main: { getChildren: () => [tween], time: () => seconds } },
    __player: { getTime: () => seconds },
  });
}

const keyframed: GsapAnimation = {
  id: "#box-to-0-position",
  targetSelector: "#box",
  method: "to",
  position: 0,
  duration: 1,
  properties: {},
  keyframes: {
    format: "percentage",
    keyframes: [
      { percentage: 0, properties: { x: 0, y: 0 } },
      { percentage: 100, properties: { x: 200, y: 80 } },
    ],
  },
};

// fails without the fix: a sealed preview's GSAP values were out of reach, so the add did nothing.
it("adds a keyframe at the playhead with the sealed preview's GSAP values there", async () => {
  document.body.innerHTML = `<main data-composition-id="main"><div id="box"></div></main>`;
  frameGsapAt(0.5);
  usePlayerStore.setState({ currentTime: 0.5, isPlaying: false });
  const iframe = sealedPreviewFrame().iframe;
  const [match] = (await queryPreviewElements(iframe, "#box"))!.matches;
  const [described] = (await describePreviewElements(iframe, [match!.handle]))!;
  const sel = { id: "box", selector: "#box", element: standInFor(iframe, described!) };
  const addKeyframes = vi.fn(async () => undefined);
  const session = {
    handleGsapAddKeyframeBatch: addKeyframes,
    handleGsapRemoveKeyframe: vi.fn(),
  } as unknown as EnableKeyframesSession;

  await applyKeyframeAtPlayhead(session, sel as DomEditSelection, keyframed, 0.5, iframe);

  expect(addKeyframes).toHaveBeenCalledWith(keyframed.id, 50, { x: 120, y: 40 }, undefined);
});
