import { afterEach, describe, expect, it, vi } from "vitest";
import { createFarSceneSkip } from "./farScenes";
import { resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

const FAR = "data-hf-far-scene";

// Six 2 s scenes back to back, plus a scene style part that is not a host.
function film(tagged = true): HTMLElement[] {
  resetRuntimeFixtureDom();
  const tag = (i: number) => (tagged ? ` data-hf-scene="s${i}"` : "");
  document.body.innerHTML =
    `<style${tag(0)}>p{}</style>` +
    Array.from(
      { length: 6 },
      (_, i) => `<div id="s${i}"${tag(i)} data-start="${2 * i}" style="position:absolute"></div>`,
    ).join("");
  return Array.from(document.querySelectorAll<HTMLElement>("div"));
}

const spanOf = (host: Element) => {
  const start = Number(host.getAttribute("data-start"));
  return { start, end: start + 2 };
};
const farIds = () => Array.from(document.querySelectorAll(`[${FAR}]`), (el) => el.id);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("createFarSceneSkip", () => {
  it("skips every scene but the playing one and its neighbours, following play, seek and scrub", () => {
    film();
    const skip = createFarSceneSkip(spanOf);
    skip(1);
    expect(farIds()).toEqual(["s2", "s3", "s4", "s5"]);
    // Played across the cut: both scenes play at it, so each keeps its other neighbour.
    for (let t = 1; t <= 2; t += 1 / 30) skip(t);
    skip(2);
    expect(farIds()).toEqual(["s3", "s4", "s5"]);
    skip(9);
    expect(farIds()).toEqual(["s0", "s1", "s2"]);
    for (const t of [7, 3, 5]) skip(t);
    expect(farIds()).toEqual(["s0", "s4", "s5"]);
    expect(document.querySelector(`style[${FAR}]`)).toBeNull();
  });

  it("keeps a scene with no known start rendered", () => {
    film();
    const skip = createFarSceneSkip((host) => (host.id === "s5" ? null : spanOf(host)));
    skip(0);
    expect(farIds()).toEqual(["s2", "s3", "s4"]);
  });

  it("keeps a scene host in flow rendered, since containment would move what it holds", () => {
    film()[3]!.style.position = "relative";
    createFarSceneSkip(spanOf)(0);
    expect(farIds()).toEqual(["s2", "s4", "s5"]);
  });

  it("does nothing on a page without scene hosts, as in a render", () => {
    film(false);
    createFarSceneSkip(spanOf)(1);
    expect(farIds()).toEqual([]);
    expect(document.head.querySelector("style")).toBeNull();
  });

  it("holds a skipped scene at the size it rendered at", () => {
    const [, , s2] = film();
    Object.defineProperty(s2, "offsetWidth", { value: 640 });
    Object.defineProperty(s2, "offsetHeight", { value: 360 });
    createFarSceneSkip(spanOf)(0);
    const css = document.head.querySelector("style")?.textContent ?? "";
    expect(css).toContain(`[${FAR}] { content-visibility: hidden; }`);
    expect(css).toContain(`[data-hf-scene="s2"][${FAR}] { contain-intrinsic-size: 640px 360px; }`);
  });
  it("takes a leaving scene's size and position from its last render, reading nothing at the cut", () => {
    const hosts = film();
    let report: (entries: unknown[]) => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: (entries: unknown[]) => void) {
          report = callback;
        }
        observe() {}
        unobserve() {}
      },
    );
    const skip = createFarSceneSkip(spanOf);
    skip(1);
    // What the browser reports after the next layout.
    report(
      hosts.map((target) => ({ target, borderBoxSize: [{ inlineSize: 640, blockSize: 360 }] })),
    );
    // The cut's own changes leave style dirty: a read here would force a full style and layout pass.
    const computed = vi.spyOn(window, "getComputedStyle");
    for (const host of hosts)
      Object.defineProperty(host, "offsetWidth", {
        get: () => {
          throw new Error("read at the cut");
        },
      });
    skip(5);
    expect(farIds()).toEqual(["s0", "s4", "s5"]);
    expect(computed).not.toHaveBeenCalled();
    expect(document.head.querySelector("style")?.textContent).toContain(
      `[data-hf-scene="s0"][${FAR}] { contain-intrinsic-size: 640px 360px; }`,
    );
  });
});
