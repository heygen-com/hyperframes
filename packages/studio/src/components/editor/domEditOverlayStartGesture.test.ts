// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import type { GestureState } from "./domEditOverlayGestures";
import { createDomEditOverlayGestureHandlers } from "./useDomEditOverlayGestures";

afterEach(() => {
  delete (window as { gsap?: unknown }).gsap;
  delete (window as { __timelines?: unknown }).__timelines;
  document.body.innerHTML = "";
});

const PRESS = {
  clientX: 10,
  clientY: 10,
  pointerId: 1,
  button: 0,
  preventDefault() {},
  stopPropagation() {},
  currentTarget: { setPointerCapture() {} },
};

function pressOptions(element: HTMLElement) {
  const ref = <T>(current: T) => ({ current });
  const selection = { element, capabilities: { canApplyManualOffset: true } };
  return {
    selectionRef: ref(selection as unknown as DomEditSelection),
    overlayRectRef: ref({ left: 0, top: 0, width: 240, height: 160, editScaleX: 1, editScaleY: 1 }),
    boxRef: ref(null),
    overlayRef: ref(null),
    iframeRef: ref(null),
    gestureRef: ref<GestureState | null>(null),
    rafPausedRef: ref(false),
    onManualDragStartRef: ref(vi.fn()),
    onBlockedMoveRef: ref(vi.fn()),
  };
}

describe("a drag press on a page that loads GSAP", () => {
  it.each([
    ["GSAP animates nothing", false],
    ["GSAP animates only its parent", true],
  ])(
    "%s: the press never asks GSAP about the element, so its translate stays CSS",
    (_, parentTween) => {
      const getProperty = vi.fn(() => 0);
      const set = vi.fn();
      const parent = document.createElement("div");
      const element = document.createElement("div");
      element.style.setProperty("translate", "40px 30px");
      parent.append(element);
      document.body.append(parent);
      const tween = { targets: () => [parent], vars: { x: 100 }, duration: () => 2 };
      const timelines = { main: { getChildren: () => (parentTween ? [tween] : []) } };
      Object.assign(window, { gsap: { getProperty, set }, __timelines: timelines });
      const opts = pressOptions(element);
      const handlers = createDomEditOverlayGestureHandlers(opts as never);
      expect(handlers.startGesture("drag", PRESS as never)).toBe(true);

      expect(opts.gestureRef.current?.pathOffsetMember?.plainTranslate).toBe(true);
      expect(getProperty).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(element.style.getPropertyValue("translate")).toBe("40px 30px");
    },
  );
});

describe("a drag press on a centred element without GSAP", () => {
  it("starts from its -50% translate in px and leaves its style as it was", () => {
    const element = document.createElement("div");
    element.style.cssText =
      "position: absolute; left: 50%; top: 50%; width: 240px; height: 160px; translate: -50% -50%";
    document.body.append(element);
    const style = element.getAttribute("style");
    const opts = pressOptions(element);
    const handlers = createDomEditOverlayGestureHandlers(opts as never);
    expect(handlers.startGesture("drag", PRESS as never)).toBe(true);
    expect(opts.gestureRef.current?.pathOffsetMember?.initialOffset).toEqual({ x: -120, y: -80 });
    expect(element.getAttribute("style")).toBe(style);
  });
});
