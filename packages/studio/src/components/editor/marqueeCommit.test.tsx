// @vitest-environment happy-dom
import { act, useRef } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installReactActEnvironment, mountReactHarness } from "../../hooks/domSelectionTestHarness";
import { trackStudioEvent } from "../../utils/studioTelemetry";
import { useMarqueeGestures } from "./marqueeCommit";

vi.mock("../../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

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
      {marquee.marqueeRect && <div data-band data-width={marquee.marqueeRect.width} />}
    </div>
  );
}

const pointer = (type: string, clientX: number, clientY: number) =>
  act(() => {
    document.querySelector("[data-overlay]")!.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        buttons: type === "pointerup" ? 0 : 1,
        button: 0,
        pointerId: 1,
        clientX,
        clientY,
      }),
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
  vi.clearAllMocks();
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

it("a buttonless move back at the start does not shrink the band", () => {
  pointer("pointerdown", 10, 10);
  pointer("pointermove", 120, 90);
  const band = () => document.querySelector<HTMLElement>("[data-band]")?.dataset.width;
  expect(band()).toBe("110");
  act(() => {
    document.querySelector("[data-overlay]")!.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 1,
        buttons: 0,
        clientX: 10,
        clientY: 10,
      }),
    );
  });
  expect(band()).toBe("110");
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
          buttons: type === "pointerup" ? 0 : 1,
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

it.each([
  [2, false, 2, 0],
  [1, true, 2, 1],
  [2, true, 2, 1],
  [1, true, 1, 0],
])(
  "counts marquee receipt: %s hits, changed=%s, group=%s",
  async (hits, changed, count, events) => {
    const iframe = document.createElement("iframe");
    const doc = document.implementation.createHTMLDocument("preview");
    doc.body.innerHTML =
      '<div data-composition-id="main"><h1 id="title">Title</h1><p id="subtitle">Subtitle</p></div>';
    Object.defineProperty(iframe, "contentDocument", { value: doc });
    const apply = vi.fn((_selections: HTMLElement[], _additive: boolean) => ({ changed, count }));
    function Band() {
      const overlayRef = useRef<HTMLDivElement>(null);
      const marquee = useMarqueeGestures({
        iframeRef: { current: iframe },
        overlayRef,
        activeCompositionPathRef: useRef<string | null>("index.html"),
        onMarqueeSelectRef: { current: apply },
        resolveHits: (elements: HTMLElement[]) => elements.slice(0, hits),
      });
      return (
        <div
          ref={overlayRef}
          data-receipt-overlay
          onPointerDown={marquee.begin}
          onPointerMove={marquee.onPointerMove}
          onPointerUp={marquee.onPointerUp}
        />
      );
    }
    const band = mountReactHarness(<Band />);
    const fire = (type: string, x: number, y: number) =>
      act(() => {
        document.querySelector("[data-receipt-overlay]")!.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            pointerId: 1,
            clientX: x,
            clientY: y,
            shiftKey: true,
          }),
        );
      });
    try {
      fire("pointerdown", 0, 0);
      fire("pointermove", 120, 90);
      await act(async () => {
        fire("pointerup", 120, 90);
      });
      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply.mock.calls[0]![0]).toHaveLength(hits);
      expect(trackStudioEvent).toHaveBeenCalledTimes(events);
      if (events)
        expect(trackStudioEvent).toHaveBeenCalledWith("feature_used", {
          feature: "multi_select",
          surface: "preview",
          method: "drag",
        });
    } finally {
      act(() => band.unmount());
    }
  },
);
