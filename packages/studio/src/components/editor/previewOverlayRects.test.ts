// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The frame's real runtime agent, serving the opaque frame from this document.
import { installEditingAgent } from "../../../../core/src/runtime/editingAgent";
import { makeSelection, installReactActEnvironment } from "../../hooks/domSelectionTestHarness";
import { watchPreviewFrame } from "../../player/lib/bridgePlayback";
import { queryPreviewElements } from "../../player/lib/previewElements";
import { detachedFakeIframe } from "../../player/hooks/timelinePlayerTestHarness";
import type { DomEditSelection } from "./domEditing";
import { orientedGroupAwareOverlayRect, type OverlayRect } from "./domEditOverlayGeometry";
import type { UseDomEditOverlayGesturesOptions } from "./domEditOverlayGestures";
import { createPreviewGestureStarts } from "./previewGestureStarts";
import { useDomEditOverlayRects } from "./useDomEditOverlayRects";

const frames = vi.hoisted(() => new Set<() => void>());
vi.mock("./overlayFrameLoop", () => ({
  subscribeOverlayFrame: (update: () => void) => {
    frames.add(update);
    return () => frames.delete(update);
  },
}));

const press = vi.hoisted(() => ({ changing: true, start: vi.fn((..._args: unknown[]) => true) }));
vi.mock("./domEditOverlayStartGesture", () => ({
  startGesture: press.start,
  startGroupDrag: vi.fn(() => true),
}));
vi.mock("../../player/previewReloading", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../player/previewReloading")>()),
  isPreviewChanging: () => press.changing,
  giveUpOnPreviewChange: vi.fn(),
}));

installReactActEnvironment();

// The 2D slice of each that the overlay reads; one set for both frames, which share this window.
class FakeDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  constructor(init?: string) {
    const m = init ? /matrix\(([^)]+)\)/.exec(init) : null;
    if (m) [this.a, this.b, this.c, this.d, this.e, this.f] = m[1]!.split(",").map(Number);
  }
  multiply(o: FakeDOMMatrix) {
    const out = new FakeDOMMatrix();
    out.a = this.a * o.a + this.c * o.b;
    out.b = this.b * o.a + this.d * o.b;
    out.c = this.a * o.c + this.c * o.d;
    out.d = this.b * o.c + this.d * o.d;
    out.e = this.a * o.e + this.c * o.f + this.e;
    out.f = this.b * o.e + this.d * o.f + this.f;
    return out;
  }
  rotateSelf() {
    return this;
  }
  transformPoint(p: { x: number; y: number }) {
    return { x: this.a * p.x + this.c * p.y + this.e, y: this.b * p.x + this.d * p.y + this.f };
  }
}

const FIXTURE = `
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div id="host" data-composition-src="a.html" data-width="960" data-height="540">
      <p id="inner"></p><span id="speck"></span>
    </div>
    <div id="turned" style="transform: matrix(0.8, 0.6, -0.6, 0.8, 0, 0)"></div>
    <div id="grp" data-hf-group="g"><i id="m1"></i><i id="m2"></i></div>
    <div id="clipped" style="clip-path: inset(10px 20px 30px 40px)"></div>
    <div style="display: none"><span id="gone"></span></div>
  </div>`;
const RECTS: Record<string, number[]> = {
  host: [200, 100, 960, 540],
  inner: [220, 140, 300, 80],
  speck: [230, 150, 2, 2],
  turned: [600, 400, 300, 200],
  m1: [50, 60, 100, 100],
  m2: [400, 500, 120, 90],
  grp: [0, 0, 10, 10],
  clipped: [900, 700, 400, 300],
  gone: [1, 1, 50, 50],
};

function sized(element: Element, [x, y, width, height]: number[]) {
  element.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }) as DOMRect;
  Object.defineProperty(element, "offsetWidth", { value: width, configurable: true });
  Object.defineProperty(element, "offsetHeight", { value: height, configurable: true });
  return element;
}

const closers: Array<() => void> = [];
beforeEach(() => {
  Object.assign(window, { DOMMatrix: FakeDOMMatrix });
  document.body.innerHTML = FIXTURE;
  for (const [id, rect] of Object.entries(RECTS)) sized(document.getElementById(id)!, rect);
});
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  frames.clear();
  document.body.innerHTML = "";
});

/** A frame Studio scripts directly; its document and window are this one's. */
function liveFrame() {
  const iframe = detachedFakeIframe(window as unknown as Record<string, unknown>);
  Object.defineProperty(iframe, "contentDocument", { value: document });
  return sized(iframe, [100, 50, 960, 540]) as HTMLIFrameElement;
}

/** A frame Studio cannot read, whose runtime is the real editing agent over this document. */
function opaqueFrame() {
  const frame: Record<string, unknown> = {};
  const iframe = sized(detachedFakeIframe(frame), [100, 50, 960, 540]) as HTMLIFrameElement;
  Object.defineProperty(iframe, "contentDocument", { value: null });
  Object.defineProperty(frame, "document", {
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const parent = {
    postMessage: (data: unknown, _origin: string, ports: MessagePort[]) =>
      window.dispatchEvent(
        new MessageEvent("message", { source: frame as unknown as Window, data, ports }),
      ),
  } as unknown as Window;
  const agent = installEditingAgent(parent);
  frame.postMessage = (data: unknown) =>
    window.dispatchEvent(new MessageEvent("message", { source: parent, data }));
  closers.push(() => agent.dispose());
  // The size the runtime posts for its composition, as Studio mirrors it.
  watchPreviewFrame(iframe);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame as unknown as Window,
      origin: window.location.origin,
      data: { source: "hf-preview", type: "stage-size", width: 1920, height: 1080 },
    }),
  );
  return iframe;
}

type Shown = ReturnType<typeof useDomEditOverlayRects>;
interface Picked {
  selection: string | null;
  group?: string[];
  hover?: string | null;
}

/** The overlay hook over `iframe`, with the selections `picked` names; returns its latest output. */
async function overlayOn(iframe: HTMLIFrameElement, picked: Picked) {
  const opaque = iframe.contentDocument === null;
  const pick = async (id: string): Promise<DomEditSelection> => {
    const selection = makeSelection(id, document.getElementById(id)!);
    // The host is the root of its own source file.
    if (id === "host") selection.sourceFile = "a.html";
    if (!opaque) return selection;
    const reply = await queryPreviewElements(iframe, `#${id}`);
    return { ...selection, handle: reply!.matches[0]!.handle };
  };
  const overlay = sized(document.createElement("div"), [20, 10, 1200, 800]) as HTMLDivElement;
  const refs = {
    iframeRef: { current: iframe },
    overlayRef: { current: overlay },
    selectionRef: { current: picked.selection ? await pick(picked.selection) : null },
    activeCompositionPathRef: { current: "index.html" },
    groupSelectionsRef: { current: await Promise.all((picked.group ?? []).map(pick)) },
    hoverSelectionRef: { current: picked.hover ? await pick(picked.hover) : null },
    rafPausedRef: { current: false },
  };
  let shown: Shown | null = null;
  function Harness() {
    shown = useDomEditOverlayRects(refs);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(React.createElement(Harness)));
  closers.push(() => act(() => root.unmount()));
  return { refs, read: () => shown!, frame: () => act(() => frames.forEach((update) => update())) };
}

const settled = async (overlay: Awaited<ReturnType<typeof overlayOn>>) => {
  for (let i = 0; i < 3; i += 1) {
    overlay.frame();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  }
  const { overlayRect, childRects, groupOverlayItems, hoverRect } = overlay.read();
  return { overlayRect, childRects, group: groupOverlayItems.map((item) => item.rect), hoverRect };
};

const close = (rect: OverlayRect | null) =>
  rect && Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, +value.toFixed(9)]));
const closeAll = (shown: Awaited<ReturnType<typeof settled>>) => ({
  overlayRect: close(shown.overlayRect),
  childRects: shown.childRects.map(close),
  group: shown.group.map(close),
  hoverRect: close(shown.hoverRect),
});

describe("overlay rects on an opaque frame match a scriptable one", () => {
  it.each<[string, Picked]>([
    [
      "a source host with child outlines, a group and a clipped member, a rotated hover",
      { selection: "host", group: ["grp", "clipped"], hover: "turned" },
    ],
    ["a rotated selection", { selection: "turned" }],
    ["a hidden selection draws nothing", { selection: "gone", hover: "grp" }],
  ])("%s", async (_name, picked) => {
    const live = await settled(await overlayOn(liveFrame(), picked));
    const remote = await settled(await overlayOn(opaqueFrame(), picked));
    expect(closeAll(remote)).toEqual(closeAll(live));
    if (picked.selection === "gone") expect(live.overlayRect).toBeNull();
    else expect(live.overlayRect).not.toBeNull();
  });

  it("covers what each case decides", async () => {
    const host = await settled(
      await overlayOn(opaqueFrame(), {
        selection: "host",
        group: ["grp", "clipped"],
        hover: "turned",
      }),
    );
    // Scale 0.5 into an iframe 80,40 inside the overlay; the host is its own source boundary.
    expect(host.overlayRect).toMatchObject({ left: 180, top: 90, width: 480, editScaleX: 0.5 });
    // The 2px speck is too small to outline.
    expect(host.childRects).toHaveLength(1);
    expect(host.group[0]).toMatchObject({ left: 105, top: 70, width: 235, height: 265 });
    expect(host.group[1]).toMatchObject({ left: 550, top: 395, width: 170, height: 130 });
    expect(host.hoverRect!.angle).toBeCloseTo(36.87, 2);
  });

  it("keeps one geometry read in flight however many frames ask", async () => {
    const { port1 } = new MessageChannel();
    const send = vi.spyOn(Object.getPrototypeOf(port1) as MessagePort, "postMessage");
    const geometryReads = () =>
      send.mock.calls.filter(([message]) => (message as { kind?: string }).kind === "geometry");
    const overlay = await overlayOn(opaqueFrame(), { selection: "turned" });
    overlay.frame();
    overlay.frame();
    overlay.frame();
    await vi.waitFor(() => expect(geometryReads()).toHaveLength(1));
    await vi.waitFor(() => expect(overlay.read().overlayRect).not.toBeNull());
    overlay.frame();
    overlay.frame();
    await vi.waitFor(() => expect(geometryReads()).toHaveLength(2));
    send.mockRestore();
  });
});

describe("a press held across a preview change on an opaque frame", () => {
  async function pressDuringChange(selection: DomEditSelection) {
    press.changing = true;
    press.start.mockClear();
    const iframe = opaqueFrame();
    const overlay = sized(document.createElement("div"), [20, 10, 1200, 800]) as HTMLDivElement;
    const opts = {
      waitingPressRef: { current: null },
      boxRef: { current: null },
      rafPausedRef: { current: false },
      iframeRef: { current: iframe },
      overlayRef: { current: overlay },
      activeCompositionPathRef: { current: "index.html" },
      selectionRef: { current: selection },
      overlayRectRef: { current: null },
      setOverlayRect: vi.fn(),
    } as unknown as UseDomEditOverlayGesturesOptions;
    const { startGesture } = createPreviewGestureStarts(opts, vi.fn(), vi.fn());
    const down = {
      pointerId: 1,
      clientX: 5,
      clientY: 6,
      currentTarget: { setPointerCapture: vi.fn() },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    startGesture("drag", down as unknown as React.PointerEvent<HTMLElement>);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(press.start).not.toHaveBeenCalled();
    press.changing = false;
    return { opts, overlay };
  }

  it("re-finds the pressed element on the page shown and starts on its box, read over the channel", async () => {
    const turned = document.getElementById("turned")!;
    const stale = { ...makeSelection("turned", turned), handle: `${"f".repeat(16)}:1` };
    const { overlay } = await pressDuringChange(stale);
    await vi.waitFor(() => expect(press.start).toHaveBeenCalledOnce());
    const [, , , started] = press.start.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      { selection: DomEditSelection; rect: OverlayRect },
    ];
    expect(started.selection.handle).not.toBe(stale.handle);
    expect(started.selection.id).toBe("turned");
    const live = orientedGroupAwareOverlayRect(overlay, liveFrame(), turned);
    expect(close(started.rect)).toEqual(close(live));
    expect(started.rect.angle).toBeCloseTo(36.87, 2);
  });

  it("drops the press when the page shown no longer has the element", async () => {
    const turned = document.getElementById("turned")!;
    const { opts } = await pressDuringChange(makeSelection("turned", turned));
    turned.remove();
    await vi.waitFor(() => expect(opts.waitingPressRef.current).toBeNull());
    expect(press.start).not.toHaveBeenCalled();
  });
});

describe("a press on a settled preview", () => {
  function pressOn(iframe: HTMLIFrameElement, selection: DomEditSelection) {
    press.changing = false;
    press.start.mockClear();
    const opts = {
      waitingPressRef: { current: null },
      boxRef: { current: null },
      rafPausedRef: { current: false },
      iframeRef: { current: iframe },
      overlayRef: { current: sized(document.createElement("div"), [20, 10, 1200, 800]) },
      activeCompositionPathRef: { current: "index.html" },
      selectionRef: { current: selection },
      overlayRectRef: { current: null },
      setOverlayRect: vi.fn(),
    } as unknown as UseDomEditOverlayGesturesOptions;
    const { startGesture } = createPreviewGestureStarts(opts, vi.fn(), vi.fn());
    const down = {
      pointerId: 1,
      clientX: 5,
      clientY: 6,
      currentTarget: { setPointerCapture: vi.fn() },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    startGesture("drag", down as unknown as React.PointerEvent<HTMLElement>);
    return opts;
  }

  it("on a scriptable frame starts the gesture at once", () => {
    pressOn(liveFrame(), makeSelection("turned", document.getElementById("turned")!));
    expect(press.start).toHaveBeenCalledOnce();
    // Synchronously, with nothing read over a channel.
    expect(press.start.mock.calls[0]![3]).toEqual({ at: expect.any(Object) });
  });

  it("on an opaque frame waits for what the gesture starts from, read in one request", async () => {
    const { port1 } = new MessageChannel();
    const send = vi.spyOn(Object.getPrototypeOf(port1) as MessagePort, "postMessage");
    const kinds = () => send.mock.calls.map(([message]) => (message as { kind?: string }).kind);
    const iframe = opaqueFrame();
    const handle = (await queryPreviewElements(iframe, "#turned"))!.matches[0]!.handle;
    const turned = document.getElementById("turned")!;
    send.mockClear();
    const opts = pressOn(iframe, { ...makeSelection("turned", turned), handle });
    expect(press.start).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(press.start).toHaveBeenCalledOnce());
    const started = press.start.mock.calls[0]![3] as {
      rect: OverlayRect;
      start: { layout: { width: number } };
      snap: { targets: unknown[] };
    };
    expect(started.start.layout.width).toBe(300);
    expect(started.snap.targets.length).toBeGreaterThan(0);
    const overlay = opts.overlayRef.current!;
    const live = orientedGroupAwareOverlayRect(overlay, liveFrame(), turned);
    expect(close(started.rect)).toEqual(close(live));
    expect(kinds().filter((kind) => kind === "gesture-start")).toHaveLength(1);
    expect(kinds()).not.toContain("geometry");
    send.mockRestore();
  });
});
