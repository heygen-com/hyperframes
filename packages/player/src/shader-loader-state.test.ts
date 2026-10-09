// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createShaderLoader } from "./shader-loader-element.js";
import { ShaderLoaderState } from "./shader-loader-state.js";

function loader() {
  const elements = createShaderLoader();
  const visibleLabels = () =>
    [...elements.root.querySelectorAll<HTMLElement>(".hfp-shader-loader-row")]
      .filter((row) => row.style.visibility !== "hidden")
      .map((row) => row.querySelector(".hfp-shader-loader-label")?.textContent);
  return { state: new ShaderLoaderState(elements), visibleLabels, root: elements.root };
}

describe("shader loader progress rows", () => {
  it("shows no progress rows on the Loading assets card", () => {
    const { state, visibleLabels } = loader();
    state.showAssetsLoading();
    expect(visibleLabels()).toEqual([]);
  });

  it("hides the transition rows a shader load left behind when assets start loading", () => {
    const { state, visibleLabels } = loader();
    state.update(
      {
        loading: true,
        ready: false,
        currentTransition: 1,
        transitionTotal: 3,
        transitionFrame: 2,
        transitionFrames: 30,
      },
      "player",
    );
    expect(visibleLabels()).toEqual(["transition", "rendering transition frames"]);

    state.showAssetsLoading();
    expect(visibleLabels()).toEqual([]);
  });

  it("shows the transition row only once it has a count", () => {
    const { state, visibleLabels } = loader();
    state.update({ loading: true, ready: false }, "player");
    expect(visibleLabels()).toEqual([]);

    state.update({ loading: true, ready: false, progress: 2, total: 5 }, "player");
    expect(visibleLabels()).toEqual(["transition"]);
  });

  it("hides the Loading assets card but not a shader load that took the panel over", () => {
    const { state, root } = loader();
    state.showAssetsLoading();
    state.hideAssetsLoading();
    expect(root.classList.contains("hfp-visible")).toBe(false);

    state.showAssetsLoading();
    state.update({ loading: true, ready: false }, "player");
    state.hideAssetsLoading();
    expect(root.classList.contains("hfp-visible")).toBe(true);
  });

  it("keeps the Loading assets card through shader messages that draw nothing", () => {
    const { state, root } = loader();
    state.showAssetsLoading();
    state.update({ loading: false, ready: false }, "player");
    state.update({ loading: false, ready: true }, "player");
    state.update({ loading: true, ready: false }, "composition");
    expect(root.classList.contains("hfp-visible")).toBe(true);
    expect(root.getAttribute("aria-label")).toBe("Loading assets");
  });
});
