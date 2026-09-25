// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { buildMissingCompositionElements } from "./timelineIframeHelpers";
import type { TimelineElement } from "../store/playerStore";
import type { IframeWindow } from "./playbackTypes";

it("labels a composition row from its own host when a sub-composition repeats the host's id", () => {
  document.body.innerHTML =
    '<main data-composition-id="main">' +
    '<div data-composition-id="strip" data-composition-src="compositions/strip.html"><div id="scene"></div></div>' +
    '<div id="scene" data-hf-id="hf-scene" data-composition-id="scene" data-composition-file="compositions/scene.html"></div>' +
    "</main>";
  const row = {
    id: "scene",
    key: "scene",
    tag: "div",
    start: 0,
    duration: 4,
    track: 0,
    hfId: "hf-scene",
  };
  const { updatedEls, patched } = buildMissingCompositionElements(
    document,
    window as unknown as IframeWindow,
    [row as TimelineElement],
    10,
  );
  expect([patched, updatedEls[0]?.compositionSrc]).toEqual([true, "compositions/scene.html"]);
});
