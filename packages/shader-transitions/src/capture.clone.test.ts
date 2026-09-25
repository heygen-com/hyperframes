// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { forceSceneVisibleInClone } from "./capture.js";

describe("forceSceneVisibleInClone", () => {
  it("shows the scene and its timed clips while the runtime's first-pass hide rule is up", () => {
    document.head.innerHTML =
      "<style>[data-start]:not(video, audio, img) { visibility: hidden !important; }</style>";
    document.body.innerHTML = '<div id="scene" data-start="0"><p data-start="0">Title</p></div>';
    const scene = document.getElementById("scene") as HTMLElement;

    forceSceneVisibleInClone(scene, document);

    const title = scene.querySelector("p") as HTMLElement;
    expect([scene, title].map((el) => getComputedStyle(el).visibility)).toEqual([
      "visible",
      "visible",
    ]);
  });
});
