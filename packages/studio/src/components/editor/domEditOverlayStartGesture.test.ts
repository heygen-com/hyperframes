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
      const selection = { element, capabilities: { canApplyManualOffset: true } };
      const ref = <T>(current: T) => ({ current });
      const opts = {
        selectionRef: ref(selection as unknown as DomEditSelection),
        overlayRectRef: ref({
          left: 0,
          top: 0,
          width: 50,
          height: 40,
          editScaleX: 1,
          editScaleY: 1,
        }),
        boxRef: ref(null),
        overlayRef: ref(null),
        iframeRef: ref(null),
        gestureRef: ref<GestureState | null>(null),
        rafPausedRef: ref(false),
        onManualDragStartRef: ref(vi.fn()),
        onBlockedMoveRef: ref(vi.fn()),
      };
      const press = {
        clientX: 10,
        clientY: 10,
        pointerId: 1,
        button: 0,
        preventDefault() {},
        stopPropagation() {},
        currentTarget: { setPointerCapture() {} },
      };

      const handlers = createDomEditOverlayGestureHandlers(opts as never);
      expect(handlers.startGesture("drag", press as never)).toBe(true);

      expect(opts.gestureRef.current?.pathOffsetMember?.plainTranslate).toBe(true);
      expect(getProperty).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(element.style.getPropertyValue("translate")).toBe("40px 30px");
    },
  );
});

describe("a rotate on a page that loads GSAP", () => {
  it("never asks GSAP about an element it does not turn, and draws the turn as its CSS rotate", () => {
    const getProperty = vi.fn(() => 0);
    const set = vi.fn();
    const element = document.createElement("div");
    element.style.setProperty("rotate", "30deg");
    document.body.append(element);
    Object.assign(window, {
      gsap: { getProperty, set },
      __timelines: { main: { getChildren: () => [] } },
    });
    const selection = { element, capabilities: { canApplyManualRotation: true } };
    const ref = <T>(current: T) => ({ current });
    const opts = {
      selectionRef: ref(selection as unknown as DomEditSelection),
      overlayRectRef: ref({ left: 0, top: 0, width: 50, height: 40, editScaleX: 1, editScaleY: 1 }),
      boxRef: ref(document.createElement("div")),
      overlayRef: ref(null),
      iframeRef: ref(null),
      gestureRef: ref<GestureState | null>(null),
      groupGestureRef: ref(null),
      blockedMoveRef: ref(null),
      rafPausedRef: ref(false),
      onCanvasPointerMoveRef: ref(vi.fn()),
    };
    const pointer = (clientX: number, clientY: number) => ({
      clientX,
      clientY,
      pointerId: 1,
      button: 0,
      shiftKey: false,
      preventDefault() {},
      stopPropagation() {},
      currentTarget: { setPointerCapture() {} },
    });

    const handlers = createDomEditOverlayGestureHandlers(opts as never);
    expect(handlers.startGesture("rotate", pointer(25, -20) as never)).toBe(true);
    expect(opts.gestureRef.current?.plainRotation).toEqual({
      property: "rotate",
      prefix: "",
      share: 0,
    });
    expect(opts.gestureRef.current?.actualRotation).toBeCloseTo(30);
    handlers.onPointerMove(pointer(60, 20) as never);

    expect(element.style.getPropertyValue("rotate")).toMatch(/deg$/);
    expect(element.style.getPropertyValue("rotate")).not.toBe("30deg");
    expect(getProperty).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});
