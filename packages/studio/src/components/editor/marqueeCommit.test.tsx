// @vitest-environment happy-dom
import { act, useRef } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installReactActEnvironment, mountReactHarness } from "../../hooks/domSelectionTestHarness";
import { useMarqueeGestures } from "./marqueeCommit";

// Layout stands in for a real preview: every element is visible and sits at the band's start.
vi.mock("./domEditingElement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./domEditingElement")>()),
  isElementComputedVisible: () => true,
}));
vi.mock("./domEditOverlayGeometry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./domEditOverlayGeometry")>()),
  toVisibleOverlayRect: () => ({ left: 10, top: 10, width: 40, height: 40 }),
}));

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

it("a reload promoted mid-band selects from the preview on screen, not the retired one", async () => {
  const preview = () => {
    const iframe = document.createElement("iframe");
    const doc = document.implementation.createHTMLDocument("preview");
    doc.body.innerHTML = '<div data-composition-id="main"><h1 id="title">Title</h1></div>';
    Object.defineProperty(iframe, "contentDocument", { value: doc });
    return iframe;
  };
  const [retired, live] = [preview(), preview()];
  const picked: HTMLElement[][] = [];
  const iframeRef = { current: retired as HTMLIFrameElement | null };
  function Band() {
    const overlayRef = useRef<HTMLDivElement>(null);
    const marquee = useMarqueeGestures({
      iframeRef,
      overlayRef,
      activeCompositionPathRef: useRef<string | null>("index.html"),
      onMarqueeSelectRef: useRef(() => undefined),
      resolveHits: async (elements: HTMLElement[]) => {
        picked.push(elements);
        return [];
      },
    });
    return (
      <div
        ref={overlayRef}
        data-band-overlay
        onPointerDown={marquee.begin}
        onPointerMove={marquee.onPointerMove}
        onPointerUp={marquee.onPointerUp}
      />
    );
  }
  const band = mountReactHarness(<Band />);
  const fire = (type: string, x: number, y: number) =>
    act(() => {
      document.querySelector("[data-band-overlay]")!.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerId: 1,
          clientX: x,
          clientY: y,
        }),
      );
    });
  try {
    fire("pointerdown", 0, 0);
    fire("pointermove", 120, 90);
    iframeRef.current = live;
    await act(async () => fire("pointerup", 120, 90));
    expect(picked.at(-1)?.length).toBeGreaterThan(0);
    for (const element of picked.at(-1)!) expect(element.ownerDocument).toBe(live.contentDocument);
  } finally {
    act(() => band.unmount());
  }
});
