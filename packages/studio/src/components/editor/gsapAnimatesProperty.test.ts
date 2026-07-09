// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { animationRuntimeAnimatesProperty, gsapAnimatesProperty } from "./gsapAnimatesProperty";

function elementWithAnimeScript(scriptText: string): HTMLElement {
  const doc = document.implementation.createHTMLDocument();
  const el = doc.createElement("div");
  el.id = "card";
  doc.body.appendChild(el);
  const script = doc.createElement("script");
  script.textContent = scriptText;
  doc.body.appendChild(script);
  return el;
}

describe("animationRuntimeAnimatesProperty", () => {
  it("detects GSAP-owned properties from registered timelines", () => {
    const el = document.createElement("div");
    el.id = "box";
    document.body.appendChild(el);
    Object.assign(window, {
      __timelines: {
        root: {
          getChildren: () => [
            {
              targets: () => [el],
              vars: { x: 20 },
            },
          ],
        },
      },
    });

    expect(gsapAnimatesProperty(el, "x")).toBe(true);
    expect(animationRuntimeAnimatesProperty(el, "x")).toBe(true);
  });

  it("detects anime-owned translate properties from source when runtime children are unavailable", () => {
    const el = elementWithAnimeScript(`
      const tl = anime.createTimeline({ autoplay: false });
      tl.add("#card", { translateX: 100, duration: 500, ease: "outQuad" }, 0);
      hyperframesAnime.register("main", tl);
    `);

    expect(gsapAnimatesProperty(el, "x")).toBe(false);
    expect(animationRuntimeAnimatesProperty(el, "x")).toBe(true);
  });

  it("does not treat unrelated anime properties as collisions", () => {
    const el = elementWithAnimeScript(`
      const tl = anime.createTimeline({ autoplay: false });
      tl.add("#card", { opacity: 1, duration: 500 }, 0);
      hyperframesAnime.register("main", tl);
    `);

    expect(animationRuntimeAnimatesProperty(el, "x")).toBe(false);
  });
});
