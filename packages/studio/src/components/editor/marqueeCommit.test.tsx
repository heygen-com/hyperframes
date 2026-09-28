// @vitest-environment happy-dom
import { act, useRef } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installReactActEnvironment, mountReactHarness } from "../../hooks/domSelectionTestHarness";
import { useMarqueeGestures } from "./marqueeCommit";

installReactActEnvironment();
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

const onSelect = vi.fn();

function Overlay() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const marquee = useMarqueeGestures({
    iframeRef: useRef<HTMLIFrameElement>(null),
    overlayRef,
    activeCompositionPathRef: useRef<string | null>("index.html"),
    onMarqueeSelectRef: useRef(onSelect),
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
  onSelect.mockClear();
  hostEscapes = [];
  window.addEventListener("keydown", hostListener);
  root = mountReactHarness(<Overlay />);
});

afterEach(() => {
  window.removeEventListener("keydown", hostListener);
  act(() => root.unmount());
  document.body.innerHTML = "";
});

it("an escape cancels a preview band, selects nothing, and stops there", () => {
  pointer("pointerdown", 10, 10);
  pointer("pointermove", 120, 90);
  expect(document.querySelector("[data-band]")).not.toBeNull();

  const event = escape();
  pointer("pointerup", 120, 90);

  expect(document.querySelector("[data-band]")).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(true);
  expect(hostEscapes).toHaveLength(0);
});

it("an escape with no band in flight still reaches the host", () => {
  const event = escape();

  expect(event.defaultPrevented).toBe(false);
  expect(hostEscapes).toHaveLength(1);
});
