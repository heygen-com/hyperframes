// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureScene, forceSceneVisibleInClone } from "./capture.js";

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

describe("captureScene with html-in-canvas", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLCanvasElement.prototype as { layoutSubtree?: boolean }).layoutSubtree;
  });

  it("draws a scene the runtime hid, and its timed clips, visible when asked to", async () => {
    document.body.innerHTML =
      '<div id="scene" style="visibility: hidden; opacity: 0"><p data-start="0" style="visibility: hidden">Title</p></div>';
    Object.defineProperty(HTMLCanvasElement.prototype, "layoutSubtree", {
      value: true,
      configurable: true,
    });
    const drawn: string[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
      fillRect: () => {},
      drawImage: () => {},
      drawElementImage: (el: HTMLElement) => {
        const title = el.querySelector("p") as HTMLElement;
        drawn.push(el.style.opacity, el.style.visibility, title.style.visibility);
      },
    })) as unknown as HTMLCanvasElement["getContext"]);

    await captureScene(document.getElementById("scene") as HTMLElement, "#000", 16, 9, {
      forceVisible: true,
    });

    expect(drawn).toEqual(["1", "visible", "visible"]);
  });
});
