// @vitest-environment happy-dom
import gsap from "gsap";
import { describe, expect, it } from "vitest";
import { createGsapAdapter } from "./gsap";
import type { RuntimeTimelineLike } from "../types";

// Every 0.1 s: hide all three frames, then show one, as frame-by-frame films do.
function steppedFilm() {
  const frames = [0, 1, 2].map(() => document.body.appendChild(document.createElement("div")));
  let calls = 0;
  const timeline = gsap.timeline({ paused: true });
  for (let k = 0; k < 30; k++) {
    timeline.set(frames, { visibility: "hidden" }, k * 0.1);
    timeline.set(frames[k % 3]!, { visibility: "visible" }, k * 0.1);
  }
  timeline.call(() => void calls++, [], 2.5);
  const adapter = createGsapAdapter({
    getTimeline: () => timeline as unknown as RuntimeTimelineLike,
  });
  const shown = () => frames.map((frame) => frame.style.visibility === "visible");
  return { timeline, adapter, shown, calls: () => calls };
}

describe("gsap adapter on a step", () => {
  it.each([0, 1, 2.7])("shows the step's frame when seeking onto it from %s s", (from) => {
    const film = steppedFilm();
    film.timeline.totalTime(from, true);
    film.adapter.seek({ time: 2.5 });
    expect(film.shown()).toEqual([false, true, false]);
  });

  it("fires a call on the step once when seeking onto it twice", () => {
    const film = steppedFilm();
    film.adapter.seek({ time: 2.5 });
    film.adapter.seek({ time: 2.5 });
    expect(film.calls()).toBe(1);
  });
});
