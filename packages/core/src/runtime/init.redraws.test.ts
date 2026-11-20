import { afterEach, expect, it } from "vitest";
import gsap from "gsap";
import { initSandboxRuntimeModular } from "./init";
import type { RuntimeTimelineLike } from "./types";

// Importing gsap installs it on window; a test opts in by setting window.gsap itself.
delete window.gsap;

afterEach(() => {
  document.body.innerHTML = "";
});

it("counts every redraw of the page, a seek to the time it already shows included", () => {
  document.body.innerHTML =
    `<div id="root" data-composition-id="main" data-root="true" data-start="0" data-duration="4" data-width="640" data-height="360">` +
    `<div id="box" class="clip" data-start="0" data-duration="4"></div></div>`;
  const tl = gsap.timeline({ paused: true });
  tl.fromTo("#box", { width: 200 }, { width: 800, duration: 4, ease: "none" }, 0);
  window.__timelines = { main: tl as unknown as RuntimeTimelineLike };
  const parent = window.parent;
  Object.defineProperty(window, "parent", { configurable: true, value: {} });
  try {
    initSandboxRuntimeModular();
  } finally {
    Object.defineProperty(window, "parent", { configurable: true, value: parent });
  }
  const redraws = () => window.__hf?.redraws ?? 0;

  window.__player?.seek(2);
  const afterSeek = redraws();
  window.__player?.seek(2);
  expect(redraws()).toBe(afterSeek + 1);
  window.__player?.renderSeek(3);
  expect(redraws()).toBe(afterSeek + 2);
});
