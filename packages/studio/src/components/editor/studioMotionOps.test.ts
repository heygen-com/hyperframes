import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { readStudioMotionFromElement } from "./studioMotionOps";
import { STUDIO_MOTION_ATTR } from "./studioMotionTypes";

function createElement(markup: string): HTMLElement {
  const window = new Window();
  window.document.body.innerHTML = markup;
  return window.document.body.firstElementChild as HTMLElement;
}

// ── readStudioMotionFromElement semantics ──

describe("readStudioMotionFromElement", () => {
  it("returns null for element with no attribute", () => {
    const el = createElement(`<div id="test"></div>`);
    expect(readStudioMotionFromElement(el)).toBeNull();
  });

  it("returns null for legacy marker value 'true'", () => {
    const el = createElement(`<div id="test"></div>`);
    el.setAttribute(STUDIO_MOTION_ATTR, "true");
    expect(readStudioMotionFromElement(el)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const el = createElement(`<div id="test"></div>`);
    el.setAttribute(STUDIO_MOTION_ATTR, "{not valid json");
    expect(readStudioMotionFromElement(el)).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    const el = createElement(`<div id="test"></div>`);
    el.setAttribute(STUDIO_MOTION_ATTR, '"just a string"');
    expect(readStudioMotionFromElement(el)).toBeNull();
  });

  it("returns null when start < 0", () => {
    const el = createElement(`<div id="test"></div>`);
    el.setAttribute(
      STUDIO_MOTION_ATTR,
      JSON.stringify({
        start: -0.5,
        duration: 1,
        ease: "none",
        from: { opacity: 0 },
        to: { opacity: 1 },
      }),
    );
    expect(readStudioMotionFromElement(el)).toBeNull();
  });

  it("returns null when duration <= 0", () => {
    const el = createElement(`<div id="test"></div>`);
    el.setAttribute(
      STUDIO_MOTION_ATTR,
      JSON.stringify({
        start: 0,
        duration: 0,
        ease: "none",
        from: { opacity: 0 },
        to: { opacity: 1 },
      }),
    );
    expect(readStudioMotionFromElement(el)).toBeNull();
  });

  it("returns null when duration is negative", () => {
    const el = createElement(`<div id="test"></div>`);
    el.setAttribute(
      STUDIO_MOTION_ATTR,
      JSON.stringify({
        start: 0,
        duration: -1,
        ease: "none",
        from: { opacity: 0 },
        to: { opacity: 1 },
      }),
    );
    expect(readStudioMotionFromElement(el)).toBeNull();
  });

  it("returns null when from is missing", () => {
    const el = createElement(`<div id="test"></div>`);
    el.setAttribute(
      STUDIO_MOTION_ATTR,
      JSON.stringify({
        start: 0,
        duration: 1,
        ease: "none",
        to: { opacity: 1 },
      }),
    );
    expect(readStudioMotionFromElement(el)).toBeNull();
  });

  it("returns null when to is missing", () => {
    const el = createElement(`<div id="test"></div>`);
    el.setAttribute(
      STUDIO_MOTION_ATTR,
      JSON.stringify({
        start: 0,
        duration: 1,
        ease: "none",
        from: { opacity: 0 },
      }),
    );
    expect(readStudioMotionFromElement(el)).toBeNull();
  });

  it("returns null when from/to have no recognized motion properties", () => {
    const el = createElement(`<div id="test"></div>`);
    el.setAttribute(
      STUDIO_MOTION_ATTR,
      JSON.stringify({
        start: 0,
        duration: 1,
        ease: "none",
        from: { color: "red" },
        to: { color: "blue" },
      }),
    );
    expect(readStudioMotionFromElement(el)).toBeNull();
  });

  it("returns parsed motion for valid JSON", () => {
    const el = createElement(`<div id="test"></div>`);
    const motion = {
      start: 0.5,
      duration: 1,
      ease: "power3.out",
      from: { opacity: 0, y: 40 },
      to: { opacity: 1, y: 0 },
    };
    el.setAttribute(STUDIO_MOTION_ATTR, JSON.stringify(motion));

    const result = readStudioMotionFromElement(el);
    expect(result).not.toBeNull();
    expect(result).toEqual({
      start: 0.5,
      duration: 1,
      ease: "power3.out",
      customEase: undefined,
      from: { opacity: 0, y: 40 },
      to: { opacity: 1, y: 0 },
    });
  });

  it("returns parsed motion with customEase", () => {
    const el = createElement(`<div id="test"></div>`);
    const motion = {
      start: 0,
      duration: 0.6,
      ease: "studio-custom",
      customEase: { id: "studio-custom", data: "M0,0 C0.2,0.9 0.28,1 1,1" },
      from: { scale: 0.88, autoAlpha: 0 },
      to: { scale: 1, autoAlpha: 1 },
    };
    el.setAttribute(STUDIO_MOTION_ATTR, JSON.stringify(motion));

    const result = readStudioMotionFromElement(el);
    expect(result).not.toBeNull();
    expect(result!.customEase).toEqual({ id: "studio-custom", data: "M0,0 C0.2,0.9 0.28,1 1,1" });
  });

  it("defaults ease to 'none' when ease is empty string", () => {
    const el = createElement(`<div id="test"></div>`);
    el.setAttribute(
      STUDIO_MOTION_ATTR,
      JSON.stringify({
        start: 0,
        duration: 1,
        ease: "",
        from: { y: 40 },
        to: { y: 0 },
      }),
    );

    const result = readStudioMotionFromElement(el);
    expect(result).not.toBeNull();
    expect(result!.ease).toBe("none");
  });

  it("accepts start = 0 as valid", () => {
    const el = createElement(`<div id="test"></div>`);
    el.setAttribute(
      STUDIO_MOTION_ATTR,
      JSON.stringify({
        start: 0,
        duration: 0.5,
        ease: "none",
        from: { opacity: 0 },
        to: { opacity: 1 },
      }),
    );

    const result = readStudioMotionFromElement(el);
    expect(result).not.toBeNull();
    expect(result!.start).toBe(0);
  });
});
