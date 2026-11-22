// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSelection, installReactActEnvironment } from "../../hooks/domSelectionTestHarness";
import { watchPreviewFrame } from "../../player/lib/bridgePlayback";
import { queryPreviewElements } from "../../player/lib/previewElements";
import { detachedFakeIframe } from "../../player/hooks/timelinePlayerTestHarness";
import type { DomEditSelection } from "./domEditing";
import { orientedGroupAwareOverlayRect, type OverlayRect } from "./domEditOverlayGeometry";
import type { UseDomEditOverlayGesturesOptions } from "./domEditOverlayGestures";
import { createPreviewGestureStarts } from "./previewGestureStarts";
import { standInHandle } from "./previewSelection";
import { useDomEditOverlayRects } from "./useDomEditOverlayRects";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";

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
  m13 = 0;
  m23 = 0;
  m14 = 0;
  m24 = 0;
  m44 = 1;
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
  const { iframe: sealed, frame } = sealedPreviewFrame();
  const iframe = sized(sealed, [100, 50, 960, 540]) as HTMLIFrameElement;
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

const rounded = (value: unknown): unknown =>
  typeof value === "number"
    ? +value.toFixed(9)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([key, v]) => [key, rounded(v)]))
      : value;
// Drawn fields only: a live rect works out its own scale when it cuts a crop, a frame's arrives with it.
const close = (rect: OverlayRect | null) => {
  if (!rect) return rect;
  const { ownScale: _ownScale, ...drawn } = rect;
  return rounded(drawn);
};
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

  // fails without the fix: the hug cut the crop at the editor zoom alone, 175 px wide in both frames.
  it("cuts a scaled layer's crop at its own scale, the same in both", async () => {
    const grown = sized(document.createElement("div"), [1000, 100, 400, 200]);
    grown.id = "grown";
    grown.style.setProperty("clip-path", "inset(0px 50px 0px 0px)");
    grown.style.setProperty("transform", "matrix(2, 0, 0, 2, 0, 0)");
    Object.defineProperty(grown, "offsetWidth", { value: 200, configurable: true });
    Object.defineProperty(grown, "offsetHeight", { value: 100, configurable: true });
    document.querySelector("[data-composition-id]")!.append(grown);
    for (const frame of [liveFrame, opaqueFrame]) {
      const { group } = await settled(
        await overlayOn(frame(), { selection: null, group: ["grp", "grown"] }),
      );
      expect(group[1]).toMatchObject({ width: 150, height: 100 });
    }
  });

  // fails without the fix: the cut took the turned layer's upright box, 167.4 or 173.2 px wide, not 179.9.
  it("cuts a turned, scaled layer's crop at its own scale, along its own edges, the same in both", async () => {
    const [cos, sin] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
    const [width, height] = [2 * (200 * cos + 100 * sin), 2 * (200 * sin + 100 * cos)];
    const spun = sized(document.createElement("div"), [1000, 100, width, height]);
    spun.id = "spun";
    spun.style.setProperty("clip-path", "inset(0px 50px 0px 0px)");
    spun.style.setProperty(
      "transform",
      `matrix(${2 * cos}, ${2 * sin}, ${-2 * sin}, ${2 * cos}, 0, 0)`,
    );
    Object.defineProperty(spun, "offsetWidth", { value: 200, configurable: true });
    Object.defineProperty(spun, "offsetHeight", { value: 100, configurable: true });
    document.querySelector("[data-composition-id]")!.append(spun);
    for (const frame of [liveFrame, opaqueFrame]) {
      const { group } = await settled(
        await overlayOn(frame(), { selection: null, group: ["grp", "spun"] }),
      );
      const [cutW, cutH] = [2 * 150, 2 * 100];
      expect(group[1]!.width).toBeCloseTo((cutW * cos + cutH * sin) / 2, 6);
      expect(group[1]!.height).toBeCloseTo((cutW * sin + cutH * cos) / 2, 6);
    }
  });

  // fails without the fix: the crop was cut out of the upright box, 81.1 x 106.1 where the cut is 88.4 square.
  const layer = (id: string, transform: string, clip: string, box = [1000, 100, 200, 100]) => {
    const element = sized(document.createElement("div"), box);
    element.id = id;
    if (clip) element.style.setProperty("clip-path", clip);
    if (transform) element.style.setProperty("transform", transform);
    Object.defineProperty(element, "offsetWidth", { value: 200, configurable: true });
    Object.defineProperty(element, "offsetHeight", { value: 100, configurable: true });
    document.querySelector("[data-composition-id]")!.append(element);
  };
  const pairIn = async (frame: () => HTMLIFrameElement, ids: [string, string]) => {
    const { group } = await settled(await overlayOn(frame(), { selection: null, group: ids }));
    return [group[0]!, group[1]!] as const;
  };

  // fails without the fix: a scaled layer's insets crossing past its width drew a box live, none sealed.
  it("shrinks crossed insets until they meet, as CSS does, the same in both", async () => {
    const half = "matrix(0.5, 0, 0, 0.5, 0, 0)";
    layer("whole", half, "", [1050, 125, 100, 50]);
    layer("met", half, "inset(0px 300px 0px 100px)", [1050, 125, 100, 50]);
    for (const frame of [liveFrame, opaqueFrame]) {
      const [whole, met] = await pairIn(frame, ["whole", "met"]);
      expect(met.width).toBeCloseTo(0, 6);
      expect(met.left - whole.left).toBeCloseTo(((200 * 100) / 400) * 0.5 * 0.5, 6);
    }
  });

  // fails without the fix: a mirrored layer's right inset cut its visual left live and its visual right sealed.
  it("cuts a mirrored layer's right inset off its visual left, the same in both", async () => {
    layer("plain", "", "inset(0px 50px 0px 0px)");
    layer("mirrored", "matrix(-1, 0, 0, 1, 0, 0)", "inset(0px 50px 0px 0px)");
    for (const frame of [liveFrame, opaqueFrame]) {
      const [plain, mirrored] = await pairIn(frame, ["plain", "mirrored"]);
      expect(mirrored.width).toBeCloseTo(plain.width, 6);
      expect(mirrored.left - plain.left).toBeCloseTo(50 / 2, 6);
    }
  });

  it("bounds a turned layer's cropped box by its cut corners, the same in both", async () => {
    const half = Math.SQRT1_2;
    const side = (200 + 100) * half;
    const spun = sized(document.createElement("div"), [1000, 100, side, side]);
    spun.id = "spun";
    spun.style.setProperty("clip-path", "inset(0px 50px 0px 0px)");
    spun.style.setProperty("transform", `matrix(${half}, ${half}, ${-half}, ${half}, 0, 0)`);
    Object.defineProperty(spun, "offsetWidth", { value: 200, configurable: true });
    Object.defineProperty(spun, "offsetHeight", { value: 100, configurable: true });
    document.querySelector("[data-composition-id]")!.append(spun);
    for (const frame of [liveFrame, opaqueFrame]) {
      const { group } = await settled(
        await overlayOn(frame(), { selection: null, group: ["grp", "spun"] }),
      );
      const cut = ((150 + 100) * half) / 2;
      expect(group[1]).toMatchObject({
        width: expect.closeTo(cut, 6),
        height: expect.closeTo(cut, 6),
      });
    }
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

/** A sealed frame whose runtime never answers, as a frame the page has dropped. */
function silentFrame() {
  const frameWindow = new Proxy({ postMessage() {} } as Record<string, unknown>, {
    get: (target, key) => {
      if (key === "postMessage") return target.postMessage;
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const iframe = detachedFakeIframe(frameWindow);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  return sized(iframe, [100, 50, 960, 540]) as HTMLIFrameElement;
}

describe("a press held across a preview change on an opaque frame", () => {
  async function pressDuringChange(
    selection: DomEditSelection,
    {
      iframe = opaqueFrame(),
      overlayRect = null,
      whileWaiting = () => {},
    }: {
      iframe?: HTMLIFrameElement;
      overlayRect?: OverlayRect | null;
      whileWaiting?: (opts: UseDomEditOverlayGesturesOptions) => void;
    } = {},
  ) {
    press.changing = true;
    press.start.mockClear();
    const overlay = sized(document.createElement("div"), [20, 10, 1200, 800]) as HTMLDivElement;
    const opts = {
      waitingPressRef: { current: null },
      boxRef: { current: null },
      rafPausedRef: { current: false },
      iframeRef: { current: iframe },
      overlayRef: { current: overlay },
      activeCompositionPathRef: { current: "index.html" },
      selectionRef: { current: selection },
      overlayRectRef: { current: overlayRect },
      setOverlayRect: vi.fn((rect: OverlayRect | null) => (opts.overlayRectRef.current = rect)),
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
    whileWaiting(opts);
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

  // fails without the fix: the press read over the frame it was pressed on, which the change had removed, so no
  // answer came and the drag was dropped.
  it("reads over the frame shown once the change ends, when the change swapped frames", async () => {
    const turned = document.getElementById("turned")!;
    const pressedOn = opaqueFrame();
    await pressDuringChange(makeSelection("turned", turned), {
      iframe: pressedOn,
      whileWaiting: (opts) => {
        opts.iframeRef.current = opaqueFrame();
        Object.defineProperty(pressedOn, "contentWindow", { value: null });
      },
    });
    await vi.waitFor(() => expect(press.start).toHaveBeenCalledOnce(), { timeout: 3000 });
    const [, , , started] = press.start.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      { selection: DomEditSelection },
    ];
    expect(started.selection.id).toBe("turned");
    // fails without the fix: the gesture drew through the stand-in of the frame it was pressed on, now removed.
    expect(started.selection.element).not.toBe(turned);
    expect(standInHandle(started.selection.element)).toBe(started.selection.handle);
  });

  it("starts from the box Studio drew when the frame shown never answers", async () => {
    const turned = makeSelection("turned", document.getElementById("turned")!);
    const drawn = { left: 1, top: 2, width: 3, height: 4 } as OverlayRect;
    await pressDuringChange(turned, { iframe: silentFrame(), overlayRect: drawn });
    await vi.waitFor(() => expect(press.start).toHaveBeenCalledOnce(), { timeout: 3000 });
    const [, , , started] = press.start.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      { selection: DomEditSelection; rect: OverlayRect },
    ];
    expect(started).toMatchObject({ selection: turned, rect: drawn });
    expect(started.selection.element).toBe(turned.element);
  });

  // fails without the fix: the waiting box's redraws had already moved the box the drag started from.
  it("starts from the box as it was at the press, though the pointer moved while it waited", async () => {
    const turned = makeSelection("turned", document.getElementById("turned")!);
    const drawn = { left: 1, top: 2, width: 3, height: 4 } as OverlayRect;
    await pressDuringChange(turned, {
      iframe: silentFrame(),
      overlayRect: drawn,
      whileWaiting: (opts) => opts.waitingPressRef.current!.draw!(30, 0),
    });
    await vi.waitFor(() => expect(press.start).toHaveBeenCalledOnce(), { timeout: 3000 });
    const [, , , started] = press.start.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      { rect: OverlayRect },
    ];
    expect(started.rect).toEqual(drawn);
  });

  it("asks the frame shown again when a swap comes after its first ask", async () => {
    const turned = document.getElementById("turned")!;
    const drawn = { left: 1, top: 2, width: 3, height: 4 } as OverlayRect;
    const { opts, overlay } = await pressDuringChange(makeSelection("turned", turned), {
      iframe: silentFrame(),
      overlayRect: drawn,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    opts.iframeRef.current = opaqueFrame();
    await vi.waitFor(() => expect(press.start).toHaveBeenCalledOnce(), { timeout: 3000 });
    const [, , , started] = press.start.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      { rect: OverlayRect },
    ];
    expect(close(started.rect)).toEqual(
      close(orientedGroupAwareOverlayRect(overlay, liveFrame(), turned)),
    );
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
