// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { gsap } from "gsap";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { COLOR_GRADING_SOURCE_HIDDEN_ATTR } from "@hyperframes/core/color-grading";
import { readAllAnimatedProperties, readGsapProperty } from "./gsapRuntimeReaders";

/**
 * Regression: converting a property-group tween to keyframes resolves "current
 * values" via readAllAnimatedProperties. Two ways that used to bake garbage
 * into the composition file:
 *
 * 1. The group filter only pruned the tween's OWN properties — the baseline
 *    pass still captured every property ANY tween on the element touches, so
 *    a rotation commit carried `opacity` from the intro from() tween.
 * 2. `gsap.getProperty(el, "opacity")` on a color-grading source reads the
 *    runtime hide (inline `opacity: 0 !important`), not the animated value —
 *    so the captured opacity was the transient 0, which then animated 0 → 0
 *    on the next full load and the element disappeared.
 */

function fakeIframe(
  el: Element,
  opts: { gsapValues: Record<string, number>; otherTweenVars?: Record<string, number> },
): HTMLIFrameElement {
  const children = opts.otherTweenVars
    ? [{ targets: () => [el], vars: { duration: 0.8, ...opts.otherTweenVars } }]
    : [];
  return {
    contentWindow: {
      __timelines: { main: { getChildren: () => children } },
      gsap: { getProperty: (_el: Element, prop: string) => opts.gsapValues[prop] ?? 0 },
    },
    contentDocument: document,
  } as unknown as HTMLIFrameElement;
}

function rotationSetAnim(): GsapAnimation {
  return {
    id: "#clip-set-0-rotation",
    targetSelector: "#clip",
    method: "set",
    properties: { rotation: 0 },
  } as unknown as GsapAnimation;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("readAllAnimatedProperties group filter", () => {
  it("keeps other tweens' out-of-group properties out of a grouped resolve", async () => {
    const el = document.createElement("div");
    el.id = "clip";
    document.body.appendChild(el);
    const iframe = fakeIframe(el, {
      gsapValues: { rotation: -28.1, opacity: 0, rotationX: 52, rotationY: -47 },
      otherTweenVars: { opacity: 0, rotationX: 52, rotationY: -47 },
    });

    const result = await readAllAnimatedProperties(iframe, "#clip", rotationSetAnim(), "rotation");

    expect(result).toEqual({ rotation: -28.1 });
  });
});

describe("color-grading opacity truth", () => {
  it("reads a graded source's opacity from GSAP, as for any element", () => {
    const el = document.createElement("img");
    el.id = "clip";
    el.setAttribute(COLOR_GRADING_SOURCE_HIDDEN_ATTR, "true");
    document.body.appendChild(el);
    const iframe = fakeIframe(el, { gsapValues: { opacity: 0.98 } });

    expect(readGsapProperty(iframe, "#clip", "opacity")).toBe(0.98);
  });
});

describe("readAllAnimatedProperties with a sibling tween", () => {
  it("leaves a sibling tween's rotation to that tween after an opacity keyframe edit", async () => {
    const el = document.createElement("div");
    el.id = "clip";
    document.body.appendChild(el);
    const build = (keyframes: Record<string, Record<string, number>>) => {
      const tl = gsap.timeline({ paused: true });
      tl.to(el, { duration: 4, ease: "none", keyframes }, 0);
      tl.to(el, { rotation: 90, duration: 3 }, 0);
      return tl;
    };
    const live = build({ "0%": { opacity: 0 }, "100%": { opacity: 1 } });
    live.seek(2);
    const iframe = {
      contentWindow: { __timelines: { main: live }, gsap },
      contentDocument: document,
    } as unknown as HTMLIFrameElement;
    const anim = {
      id: "#clip-to-0-visual",
      targetSelector: "#clip",
      method: "to",
      properties: {},
      keyframes: {
        keyframes: [
          { percentage: 0, properties: { opacity: 0 } },
          { percentage: 100, properties: { opacity: 1 } },
        ],
      },
    } as unknown as GsapAnimation;

    // commitKeyframeProps: these values plus the edit at the playhead, and backfilled into the rest.
    const read = await readAllAnimatedProperties(iframe, "#clip", anim);
    live.kill();
    gsap.set(el, { clearProps: "all" });
    const edited = build({
      "0%": { ...read, opacity: 0 },
      "50%": { ...read, opacity: 0.3 },
      "100%": { ...read, opacity: 1 },
    });
    edited.seek(3.2);
    edited.seek(3.5);

    expect(gsap.getProperty(el, "rotation")).toBe(90);
    edited.kill();
  });
});
