// @vitest-environment happy-dom
import { act, useRef } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { installReactActEnvironment, mountReactHarness } from "../../hooks/domSelectionTestHarness";
import { useMarqueeGestures } from "./marqueeCommit";

installReactActEnvironment();
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

function Overlay() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const marquee = useMarqueeGestures({
    iframeRef: useRef<HTMLIFrameElement>(null),
    overlayRef,
    activeCompositionPathRef: useRef<string | null>("index.html"),
    onMarqueeSelectRef: useRef(undefined),
  });
  return (
    <div
      ref={overlayRef}
      data-overlay
      onPointerDown={marquee.begin}
      onPointerMove={marquee.onPointerMove}
      onPointerUp={marquee.onPointerUp}
    >
      {marquee.marqueeRect && <div data-band />}
    </div>
  );
}

const pointer = (type: string, clientX: number, clientY: number) =>
  act(() => {
    document
      .querySelector("[data-overlay]")!
      .dispatchEvent(
        new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX, clientY }),
      );
  });
const escape = () => {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
};

let root: Root;
let hostEscapes: KeyboardEvent[];
const hostListener = (e: KeyboardEvent) => {
  if (e.key === "Escape") hostEscapes.push(e);
};

beforeEach(() => {
  hostEscapes = [];
  window.addEventListener("keydown", hostListener);
  root = mountReactHarness(<Overlay />);
});

afterEach(() => {
  window.removeEventListener("keydown", hostListener);
  act(() => root.unmount());
  document.body.innerHTML = "";
});

it("an escape cancels a preview band while the pointer is still down, and stops there", () => {
  pointer("pointerdown", 10, 10);
  pointer("pointermove", 120, 90);
  expect(document.querySelector("[data-band]")).not.toBeNull();

  const event = escape();

  expect(document.querySelector("[data-band]")).toBeNull();
  expect(event.defaultPrevented).toBe(true);
  expect(hostEscapes).toHaveLength(0);
});

it("an escape with no band in flight still reaches the host", () => {
  const event = escape();

  expect(event.defaultPrevented).toBe(false);
  expect(hostEscapes).toHaveLength(1);
});
