import gsap from "gsap";
import { describe, expect, it } from "vitest";
import { clipsFirstRenderedIn } from "./firstRenderReveal";
import type { RuntimeTimelineChildLike } from "./types";

describe("clipsFirstRenderedIn", () => {
  document.body.innerHTML =
    `<div id="scene" data-hf-clip-hidden><div id="clip" data-hf-clip-hidden><p id="text"></p></div></div>` +
    `<div id="shown"><p id="free"></p></div>`;
  const root = gsap.timeline({ paused: true });
  const scene = gsap.timeline();
  scene.to("#text", { x: 1, duration: 1 }, 1);
  scene.to("#free", { x: 1, duration: 1 }, 1);
  root.add(scene, 10);
  const ids = (clips: Set<Element> | null) => (clips ? [...clips].map((el) => el.id) : null);

  it("returns the hidden clips around targets of tweens starting in the span, at their nested time", () => {
    const tl = root as unknown as RuntimeTimelineChildLike;
    expect(ids(clipsFirstRenderedIn(tl, 5, 11.5))).toEqual(["clip", "scene"]);
    expect(ids(clipsFirstRenderedIn(tl, 11, 20))).toEqual([]);
    expect(ids(clipsFirstRenderedIn(tl, 0, 10.5))).toEqual([]);
  });

  it("cannot tell for a nested timeline that repeats", () => {
    const looped = gsap.timeline({ paused: true });
    looped.add(gsap.timeline({ repeat: 2 }).to("#text", { x: 1, duration: 1 }), 0);
    expect(clipsFirstRenderedIn(looped as unknown as RuntimeTimelineChildLike, 0, 5)).toBeNull();
  });
});
