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
