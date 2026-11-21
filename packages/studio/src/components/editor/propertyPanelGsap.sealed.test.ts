// @vitest-environment happy-dom

import { gsap } from "gsap";
import { parseGsapScriptAcorn } from "@hyperframes/parsers/gsap-parser-acorn";
import { afterEach, expect, it } from "vitest";
import { makeSelection } from "../../hooks/domSelectionTestHarness";
import { settleGsapSnapshot } from "../../hooks/gsapFrameSnapshot";
import { describePreviewElements, queryPreviewElements } from "../../player/lib/previewElements";
import { usePlayerStore } from "../../player/store/playerStore";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";
import { standInFor } from "./previewSelection";
import { readGsapRuntimeValuesForPanel } from "./propertyPanelHelpers";

const script = (vars: string) => `var tl = gsap.timeline({ paused: true });
tl.to("#box", { ${vars}, duration: 1, ease: "none" }, 0);
window.__timelines["main"] = tl;`;

const mainTimeline = () =>
  (window as unknown as { __timelines?: Record<string, gsap.core.Timeline> }).__timelines?.main;

afterEach(() => {
  mainTimeline()?.kill();
  document.body.innerHTML = "";
  for (const name of ["gsap", "__timelines", "__player"]) Reflect.deleteProperty(window, name);
  usePlayerStore.setState({ currentTime: 0, isPlaying: false });
});

/** The box half way through its tween, behind a frame Studio cannot read, selected by its stand-in. */
async function sealedBox(source: string) {
  document.body.innerHTML = `<div data-composition-id="main"><div id="box"></div></div>`;
  Object.assign(window, { gsap, __timelines: {}, __player: { getTime: () => 0.5 } });
  new Function("gsap", "window", source)(gsap, window);
  mainTimeline()?.seek(0.5);
  usePlayerStore.setState({ currentTime: 0.5, isPlaying: false });
  const { iframe } = sealedPreviewFrame();
  const handle = (await queryPreviewElements(iframe, "#box"))!.matches[0]!.handle;
  const standIn = standInFor(iframe, (await describePreviewElements(iframe, [handle]))![0]!);
  const selection = { ...makeSelection("box", standIn), id: "box", handle };
  await settleGsapSnapshot(iframe);
  return { iframe, selection, animations: parseGsapScriptAcorn(source).animations };
}

it("shows a sealed preview's GSAP values for the selected layer, read at the playhead", async () => {
  const { iframe, selection, animations } = await sealedBox(script("x: 200, y: 80"));
  const values = readGsapRuntimeValuesForPanel(animations[0]!.id, animations, selection, {
    current: iframe,
  });
  expect(values).toMatchObject({ x: 100, y: 40 });
});

it("leaves out GSAP's transform for a sealed layer its tweens do not move", async () => {
  const { iframe, selection, animations } = await sealedBox(script("opacity: 0"));
  const values = readGsapRuntimeValuesForPanel(animations[0]!.id, animations, selection, {
    current: iframe,
  });
  expect(values).toEqual({ opacity: 0.5 });
});

it("shows a sealed layer's rotation and scale when its tweens only turn and grow it", async () => {
  const { iframe, selection, animations } = await sealedBox(script("rotation: 90, scale: 2"));
  const values = readGsapRuntimeValuesForPanel(animations[0]!.id, animations, selection, {
    current: iframe,
  });
  expect(values).toMatchObject({ rotation: 45, scale: 1.5 });
});
