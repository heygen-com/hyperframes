import { describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { applyStudioMotionFromDom } from "./studioMotion";
import {
  clampStudioCustomEasePoints,
  controlPointsForGsapEase,
  parseStudioCustomEaseData,
} from "./studioMotionOps";
import { STUDIO_MOTION_TIMELINE_ID } from "./studioMotionTypes";

function preview() {
  const window = new Window();
  const timeline = {
    fromTo: vi.fn(),
    totalTime: vi.fn(),
    pause: vi.fn(),
    kill: vi.fn(),
  };
  const createTimeline = vi.fn(() => timeline);
  const createEase = vi.fn();
  const runtime = Object.assign(window, {
    gsap: { timeline: createTimeline, registerPlugin: vi.fn() },
    CustomEase: { create: createEase },
    __timelines: {} as Record<string, typeof timeline>,
    __player: { getTime: () => 0.4 },
  });
  const element = window.document.createElement("div");
  element.setAttribute(
    "data-hf-studio-motion",
    JSON.stringify({
      start: 0.25,
      duration: 0.8,
      ease: "power3.out",
      from: { y: 44, autoAlpha: 0 },
      to: { y: 0, autoAlpha: 1 },
    }),
  );
  element.style.transform = "rotate(5deg)";
  window.document.body.append(element);
  return { runtime, document: window.document, element, timeline, createTimeline, createEase };
}

describe("studio motion playback", () => {
  it("builds a paused timeline from authored DOM data at the current player time", () => {
    const { runtime, document, element, timeline, createTimeline } = preview();
    const authoredMarkup = element.outerHTML;

    expect(applyStudioMotionFromDom(document)).toBe(1);

    expect(createTimeline).toHaveBeenCalledWith({ paused: true, defaults: { overwrite: "auto" } });
    expect(timeline.fromTo).toHaveBeenCalledExactlyOnceWith(
      element,
      { y: 44, autoAlpha: 0 },
      {
        y: 0,
        autoAlpha: 1,
        duration: 0.8,
        ease: "power3.out",
        overwrite: "auto",
        immediateRender: false,
      },
      0.25,
    );
    expect(runtime.__timelines[STUDIO_MOTION_TIMELINE_ID]).toBe(timeline);
    expect(timeline.pause).toHaveBeenCalledOnce();
    expect(timeline.totalTime).toHaveBeenCalledExactlyOnceWith(0.4, false);
    expect(element.outerHTML).toBe(authoredMarkup);
  });

  it("kills the previous timeline when authored motion is removed", () => {
    const { runtime, document, element, timeline, createTimeline } = preview();
    applyStudioMotionFromDom(document);
    element.removeAttribute("data-hf-studio-motion");

    expect(applyStudioMotionFromDom(document)).toBe(0);

    expect(timeline.kill).toHaveBeenCalledOnce();
    expect(runtime.__timelines[STUDIO_MOTION_TIMELINE_ID]).toBeUndefined();
    expect(createTimeline).toHaveBeenCalledOnce();
    expect(element.style.transform).toBe("rotate(5deg)");
  });

  it("rebuilds from current attributes and honors an explicit zero seek", () => {
    const { document, element, timeline } = preview();
    applyStudioMotionFromDom(document);
    element.setAttribute(
      "data-hf-studio-motion",
      '{"start":1,"duration":2,"ease":"none","from":{"x":-20},"to":{"x":0}}',
    );

    expect(applyStudioMotionFromDom(document, 0)).toBe(1);

    expect(timeline.kill).toHaveBeenCalledOnce();
    expect(timeline.fromTo).toHaveBeenLastCalledWith(
      element,
      { x: -20 },
      { x: 0, duration: 2, ease: "none", overwrite: "auto", immediateRender: false },
      1,
    );
    expect(timeline.totalTime).toHaveBeenLastCalledWith(0, false);
  });

  it("ignores malformed and legacy marker attributes while applying valid motion", () => {
    const { document, timeline } = preview();
    for (const value of ["true", "{invalid", '{"start":0,"duration":0}']) {
      const invalid = document.createElement("div");
      invalid.setAttribute("data-hf-studio-motion", value);
      document.body.append(invalid);
    }

    expect(applyStudioMotionFromDom(document)).toBe(1);
    expect(timeline.fromTo).toHaveBeenCalledOnce();
  });

  it("registers authored CustomEase data before using its id", () => {
    const { document, element, runtime, timeline, createEase } = preview();
    element.setAttribute(
      "data-hf-studio-motion",
      '{"start":0,"duration":1,"ease":"none","customEase":{"id":"card-ease","data":"M0,0 C0.18,0.9 0.32,1.2 1,1"},"from":{"y":44},"to":{"y":0}}',
    );

    expect(applyStudioMotionFromDom(document)).toBe(1);
    expect(runtime.gsap.registerPlugin).toHaveBeenCalledWith(runtime.CustomEase);
    expect(createEase).toHaveBeenCalledExactlyOnceWith("card-ease", "M0,0 C0.18,0.9 0.32,1.2 1,1");
    expect(timeline.fromTo.mock.calls[0]?.[2].ease).toBe("card-ease");
  });
});

describe("ease previews", () => {
  it("parses GSAP CustomEase control points and rejects other curve formats", () => {
    expect(parseStudioCustomEaseData("M0,0 C0.18,0.9 0.32,1.2 1,1")).toEqual({
      x1: 0.18,
      y1: 0.9,
      x2: 0.32,
      y2: 1.2,
    });
    expect(parseStudioCustomEaseData("cubic-bezier(0.1, 0.2, 0.3, 1)")).toBeNull();
  });

  it("clamps handles to the supported range and exposes preset previews", () => {
    expect(clampStudioCustomEasePoints({ x1: -2, y1: -2, x2: 2, y2: 3 })).toEqual({
      x1: 0,
      y1: -0.6,
      x2: 1,
      y2: 1.6,
    });
    expect(controlPointsForGsapEase("power3.out")).toEqual({
      x1: 0.165,
      y1: 0.84,
      x2: 0.44,
      y2: 1,
    });
  });
});
