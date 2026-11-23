import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import gsap from "gsap";
import { initSandboxRuntimeModular } from "./init";
import type { RuntimeTimelineLike } from "./types";

// Importing gsap installs it on window; a test opts in by setting window.gsap itself.
delete window.gsap;

// jsdom keeps a declaration's !important when a value is assigned over it; browsers drop it.
const styleProto = Object.getPrototypeOf(
  document.createElement("div").style,
) as CSSStyleDeclaration;
const visibilityAccessor = Object.getOwnPropertyDescriptor(styleProto, "visibility")!;
const setProperty = styleProto.setProperty;
beforeAll(() => {
  Object.defineProperty(styleProto, "visibility", {
    ...visibilityAccessor,
    set(this: CSSStyleDeclaration, value: string) {
      this.removeProperty("visibility");
      visibilityAccessor.set!.call(this, value);
    },
  });
  styleProto.setProperty = function (this: CSSStyleDeclaration, name, value, priority) {
    if (!priority) this.removeProperty(name);
    setProperty.call(this, name, value, priority ?? "");
  };
});
afterAll(() => {
  Object.defineProperty(styleProto, "visibility", visibilityAccessor);
  styleProto.setProperty = setProperty;
});

function mountClipHiddenByTimeline() {
  document.body.innerHTML =
    `<div id="root" data-composition-id="main" data-root="true" data-start="0" data-duration="5" data-width="640" data-height="360">` +
    `<div id="clip" class="clip" data-start="0" data-duration="5"></div>` +
    `<div id="late" class="clip" data-start="1" data-duration="4"></div>` +
    `<div id="short" class="clip" data-start="0" data-duration="4"></div>` +
    `</div>`;
  const tl = gsap.timeline({ paused: true });
  tl.set("#clip", { visibility: "hidden" }, 2.67);
  tl.set("#late", { visibility: "hidden" }, 2.67);
  tl.set("#short", { visibility: "hidden" }, 2.67);
  window.__timelines = { main: tl as unknown as RuntimeTimelineLike };
  const parent = window.parent;
  Object.defineProperty(window, "parent", { configurable: true, value: {} });
  try {
    initSandboxRuntimeModular();
  } finally {
    Object.defineProperty(window, "parent", { configurable: true, value: parent });
  }
  return {
    clip: document.getElementById("clip")!,
    late: document.getElementById("late")!,
    short: document.getElementById("short")!,
  };
}

describe("a timeline set that hides a timed clip", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const paths = {
    preview: (t: number) => window.__player?.seek(t),
    render: (t: number) => window.__player?.renderSeek(t),
  };

  for (const [name, seek] of Object.entries(paths)) {
    // Each clip's visibility after each seek: clip (starts at 0), late (starts at 1), short (ends at 4).
    const seenAt = (times: number[]) => {
      const { clip, late, short } = mountClipHiddenByTimeline();
      return times.map((t) => {
        seek(t);
        return [clip, late, short].map((el) => el.style.visibility[0]).join("");
      });
    };

    it(`hides each clip from its position on the ${name} path`, () => {
      expect(seenAt([0.5, 1.5, 2.6, 2.7, 4, 2.6, 1.5])).toEqual([
        "vhv",
        "vvv",
        "vvv",
        "hhh",
        "hhh",
        "vvv",
        "vvv",
      ]);
    });

    it(`hides each clip on a first seek past its position on the ${name} path`, () => {
      expect(seenAt([3])).toEqual(["hhh"]);
    });

    it(`hides a clip after a seek from before its window straight past its position on the ${name} path`, () => {
      expect(seenAt([0.5, 3, 1.5])).toEqual(["vhv", "hhh", "vvv"]);
    });

    it(`hides a clip when its window is left and re-entered past its position on the ${name} path`, () => {
      expect(seenAt([2, 4.5, 3])).toEqual(["vvv", "hhh", "hhh"]);
    });
  }

  for (const [name, seek] of Object.entries(paths)) {
    it(`hides a clip a tween left at inherit once its window has ended on the ${name} path`, () => {
      document.body.innerHTML =
        `<div data-composition-id="main" data-root="true" data-start="0" data-duration="5" data-width="640" data-height="360">` +
        `<div id="c" class="clip" data-start="0" data-duration="2"></div></div>`;
      const tl = gsap.timeline({ paused: true });
      tl.to("#c", { autoAlpha: 0.5, duration: 0.5 }, 1);
      window.__timelines = { main: tl as unknown as RuntimeTimelineLike };
      const parent = window.parent;
      Object.defineProperty(window, "parent", { configurable: true, value: {} });
      try {
        initSandboxRuntimeModular();
      } finally {
        Object.defineProperty(window, "parent", { configurable: true, value: parent });
      }
      seek(3);
      expect(document.getElementById("c")!.style.visibility).toBe("hidden");
    });
  }

  for (const [name, seek] of Object.entries(paths)) {
    it(`hides the timed children of a scene a script hides on the ${name} path`, () => {
      document.body.innerHTML =
        `<div data-composition-id="main" data-root="true" data-start="0" data-duration="5" data-width="640" data-height="360">` +
        `<div id="scene" class="clip" data-start="0" data-duration="5">` +
        `<div id="kid" class="clip" data-start="0" data-duration="5"></div><div id="plain"></div></div></div>`;
      const tl = gsap.timeline({ paused: true });
      tl.set("#scene", { visibility: "hidden" }, 2.67);
      window.__timelines = { main: tl as unknown as RuntimeTimelineLike };
      const parent = window.parent;
      Object.defineProperty(window, "parent", { configurable: true, value: {} });
      try {
        initSandboxRuntimeModular();
      } finally {
        Object.defineProperty(window, "parent", { configurable: true, value: parent });
      }
      const computed = () =>
        ["scene", "kid", "plain"].map(
          (id) => getComputedStyle(document.getElementById(id)!).visibility[0],
        );
      const seen: string[] = [];
      for (const t of [1, 3, 3.5, 1]) {
        seek(t);
        seen.push(computed().join(""));
      }
      expect(seen).toEqual(["vvv", "hhh", "hhh", "vvv"]);
    });
  }
});
