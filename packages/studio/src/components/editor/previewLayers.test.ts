// @vitest-environment happy-dom

import { act, createElement, useRef } from "react";
import { MAX_QUERY_MATCHES } from "@hyperframes/core/runtime/editing-port";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The frame's real runtime agent, serving the opaque frame from this document.
import { installEditingAgent } from "../../../../core/src/runtime/editingAgent";
import { installReactActEnvironment } from "../../hooks/domSelectionTestHarness";
import { watchPreviewFrame } from "../../player/lib/bridgePlayback";
import { getElementZIndex } from "../../player/lib/layerOrdering";
import { detachedFakeIframe } from "../../player/hooks/timelinePlayerTestHarness";
import { previewLayers } from "../../player/lib/previewElements";
import type { TimelineElement } from "../../player";
import { findMatchingTimelineElementId } from "../../utils/studioHelpers";
import { collectDomEditLayerItems, type DomEditSelection } from "./domEditing";
import type { DomEditLayerItem } from "./domEditingTypes";
import { layerKindOf } from "./layerKind";
import { sortLayersByZIndex } from "./layersPanelSort";
import { useMarqueeGestures } from "./marqueeCommit";
import { collectPreviewLayerItems, layerDataAttribute } from "./previewLayers";
import { findPreviewElementForSelection, resolvePreviewSelection } from "./previewSelection";
import { isLayerDraggable } from "./useLayerDrag";

installReactActEnvironment();
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

const FIXTURE = `
  <main data-composition-id="main" data-width="1920" data-height="1080">
    <div id="card" class="clip" style="z-index: 4"><h1 id="title">Launch <b>day</b></h1><img id="pic"></div>
    <div id="pair" data-hf-group="pair"><i id="a"></i><i data-hf-id="b-hf"></i></div>
    <div id="parked" data-hf-clip-hidden style="visibility: hidden"><p id="inside" style="visibility: visible">x</p></div>
    <div id="cropped" style="clip-path: inset(0 0 0 200px); background: red"></div>
    <div id="host" data-composition-src="compositions/a.html"><span id="in-host">in</span></div>
    <i class="tile"></i><i class="tile" id="t2"></i>
    <div id="backdrop" style="background: #111"></div>
    <div id="faded" style="opacity: 0"></div>
  </main>`;
const RECTS: Record<string, number[]> = {
  card: [100, 100, 400, 300],
  title: [110, 110, 300, 60],
  pic: [110, 200, 200, 150],
  pair: [600, 100, 10, 10],
  a: [600, 100, 80, 80],
  "b-hf": [700, 140, 80, 80],
  host: [900, 500, 300, 200],
  "in-host": [910, 510, 100, 20],
  t2: [1300, 800, 50, 50],
  backdrop: [0, 0, 1920, 1080],
  faded: [120, 120, 50, 50],
  cropped: [700, 300, 400, 60],
};
const FRAME = [100, 50, 960, 540];

function sized(element: Element, [x, y, width, height]: number[]) {
  element.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }) as DOMRect;
  Object.defineProperty(element, "offsetWidth", { value: width, configurable: true });
  Object.defineProperty(element, "offsetHeight", { value: height, configurable: true });
  return element;
}
const byName = (name: string) =>
  document.getElementById(name) ?? document.querySelector(`[data-hf-id="${name}"]`);

const closers: Array<() => void> = [];
beforeEach(() => {
  document.body.innerHTML = FIXTURE;
  sized(document.querySelector("main")!, [0, 0, 1920, 1080]);
  for (const [name, rect] of Object.entries(RECTS)) sized(byName(name)!, rect);
});
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  document.body.innerHTML = "";
});

/** A frame Studio scripts directly; its document is this one. */
function liveFrame() {
  const iframe = detachedFakeIframe(window as unknown as Record<string, unknown>);
  Object.defineProperty(iframe, "contentDocument", { value: document });
  return sized(iframe, FRAME) as HTMLIFrameElement;
}

/** A frame Studio cannot read, whose runtime is the real editing agent over this document. */
function opaqueFrame() {
  const frame: Record<string, unknown> = {};
  const iframe = sized(detachedFakeIframe(frame), FRAME) as HTMLIFrameElement;
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

const CONTEXT = { activeCompositionPath: "index.html", isMasterView: true };
const row = ({ element: _e, preview: _p, ...rest }: DomEditLayerItem) => rest;

describe("Layers rows on an opaque frame match same-origin ones", () => {
  it("lists the same rows, with the kind and z-index each row shows", async () => {
    const live = collectDomEditLayerItems(document.querySelector("main"), CONTEXT);
    const remote = (await collectPreviewLayerItems(opaqueFrame(), CONTEXT))!.items;
    expect(remote.map(row)).toEqual(live.map(row));
    expect(remote.map((item) => item.preview!.kind)).toEqual(
      live.map((item) => layerKindOf(item.element, item.childCount > 0)),
    );
    expect(remote.map((item) => item.preview!.zIndex)).toEqual(
      live.map((item) => getElementZIndex(item.element)),
    );
    expect(remote.map((item) => item.label)).toContain("pair");
    expect(sortLayersByZIndex(remote)[0]!.id).toBe("card");
  });

  it("scopes to a drilled-into group's stand-in, and stops at the row budget", async () => {
    const opaque = opaqueFrame();
    const found = await findPreviewElementForSelection(opaque, { id: "pair" }, "index.html");
    const group = (await resolvePreviewSelection(opaque, found!, {
      ...CONTEXT,
      exactTarget: true,
    }))!;
    const scoped = { ...CONTEXT, activeGroupElement: group.element };
    const live = collectDomEditLayerItems(document.querySelector("main"), {
      ...CONTEXT,
      activeGroupElement: document.getElementById("pair"),
    });
    const inGroup = (await collectPreviewLayerItems(opaque, scoped))!;
    expect(inGroup.items.map(row)).toEqual(live.map(row));
    expect(inGroup.missingGroup).toBe(false);
    expect((await collectPreviewLayerItems(opaque, CONTEXT, 2))!.items).toHaveLength(2);

    // A reload takes the group with it: the frame lists nothing and says so, not the whole page.
    document.getElementById("pair")!.remove();
    expect(await collectPreviewLayerItems(opaque, scoped)).toEqual({
      items: [],
      missingGroup: true,
    });
  });

  it("reads a row's attributes off its description, and does not offer it for reordering", async () => {
    const remote = (await collectPreviewLayerItems(opaqueFrame(), CONTEXT))!.items;
    const pair = remote.find((item) => item.id === "pair")!;
    expect(layerDataAttribute(pair, "data-hf-group")).toBe("pair");
    expect(pair.element.hasAttribute("data-hf-group")).toBe(false);
    const host = remote.find((item) => item.id === "host")!;
    expect(layerDataAttribute(host, "data-composition-src")).toBe("compositions/a.html");
    expect(isLayerDraggable(pair)).toBe(false);
  });
});

describe("a marquee on an opaque frame matches a same-origin one", () => {
  function band(iframe: HTMLIFrameElement) {
    const picked: { selections: DomEditSelection[] | null; candidates: number } = {
      selections: null,
      candidates: 0,
    };
    function Surface() {
      const overlayRef = useRef<HTMLDivElement>(null);
      const marquee = useMarqueeGestures({
        iframeRef: { current: iframe },
        overlayRef,
        activeCompositionPathRef: { current: "index.html" },
        onMarqueeSelectRef: { current: (selections) => void (picked.selections = selections) },
      });
      picked.candidates = marquee.candidateRects.length;
      return createElement("div", {
        ref: (el: HTMLDivElement | null) => {
          if (el) overlayRef.current = sized(el, [20, 10, 1200, 800]) as HTMLDivElement;
        },
        "data-band": "",
        onPointerDown: marquee.begin,
        onPointerMove: marquee.onPointerMove,
        onPointerUp: marquee.onPointerUp,
      });
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(createElement(Surface)));
    closers.push(() => act(() => root.unmount()));
    const surface = host.querySelector("[data-band]")!;
    const pointer = (type: string, x: number, y: number) =>
      act(() => {
        surface.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            buttons: type === "pointerup" ? 0 : 1,
            pointerId: 1,
            clientX: x,
            clientY: y,
          }),
        );
      });
    return { picked, pointer };
  }

  const ids = async (iframe: HTMLIFrameElement) => {
    const { picked, pointer } = band(iframe);
    pointer("pointerdown", 130, 70);
    pointer("pointermove", 500, 200);
    pointer("pointermove", 520, 220);
    await vi.waitFor(() => expect(picked.candidates).toBeGreaterThan(0));
    const candidates = picked.candidates;
    pointer("pointerup", 520, 220);
    await vi.waitFor(() => expect(picked.selections).not.toBeNull());
    return { candidates, ids: picked.selections!.map((s) => s.id ?? s.hfId), picked };
  };

  it("outlines and selects the same elements: visible, not full-bleed, inside the band", async () => {
    const live = await ids(liveFrame());
    const remote = await ids(opaqueFrame());
    expect(remote.ids).toEqual(live.ids);
    expect(remote.candidates).toBe(live.candidates);
    // A group's members select as the group, on both kinds of frame.
    expect(remote.ids).toEqual(["card", "title", "pic", "pair", "pair"]);
    expect(remote.picked.selections!.every((selection) => selection.handle)).toBe(true);
  });

  it("selects layers past the cap on one layers reply, as same-origin does", async () => {
    // Unmeasured fillers first, so every element in the band sits past the first reply.
    const fillers = Array.from({ length: MAX_QUERY_MATCHES }, (_, i) => `<i id="f${i}"></i>`);
    document.querySelector("main")!.insertAdjacentHTML("afterbegin", fillers.join(""));
    expect((await previewLayers(opaqueFrame()))!.truncated).toBe(true);
    const remote = await ids(opaqueFrame());
    expect(remote.ids).toEqual(["card", "title", "pic", "pair", "pair"]);
  }, 20_000);
});

it("maps an opaque selection to a timeline clip the frame knows only by its clip id", () => {
  const clip = {
    id: "card",
    key: "index.html:card:0",
    sourceFile: "index.html",
  } as TimelineElement;
  const selection = {
    id: "card",
    sourceFile: "index.html",
    isCompositionHost: false,
    handle: "0123456789abcdef:1",
  };
  expect(findMatchingTimelineElementId(selection, [clip], "index.html")).toBe("index.html:card:0");
  const unhandled = { ...selection, handle: undefined };
  expect(findMatchingTimelineElementId(unhandled, [clip], "index.html")).toBeNull();
  const hydrated = { ...clip, domId: "other" } as TimelineElement;
  expect(findMatchingTimelineElementId(selection, [hydrated], "index.html")).toBeNull();
  // Without a scope (delete, group) the row is not this selection: it has no patch target.
  expect(findMatchingTimelineElementId(selection, [clip])).toBeNull();

  // A row naming no file is in the open composition, as the forward lookup reads it.
  const bare = { id: "card", key: "compositions/a.html:card:0" } as TimelineElement;
  const inSub = { ...selection, sourceFile: "compositions/a.html" };
  expect(findMatchingTimelineElementId(inSub, [bare], "compositions/a.html")).toBe(bare.key);
  expect(findMatchingTimelineElementId(inSub, [bare], "index.html")).not.toBe(bare.key);
});

it("refuses a layers reply that names an unknown kind", async () => {
  const frame: Record<string, unknown> = {};
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  Object.defineProperty(frame, "document", {
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const { port1, port2 } = new MessageChannel();
  closers.push(() => port1.close());
  const layer = {
    handle: "0123456789abcdef:1",
    depth: 0,
    childCount: 0,
    zIndex: 0,
    kind: "plugin",
  };
  port1.onmessage = ({ data }) =>
    port1.postMessage({
      v: 1,
      id: data.id,
      ok: true,
      result: { layers: [layer], truncated: false, missingGroup: false },
    });
  frame.postMessage = () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame as unknown as Window,
        data: { source: "hf-preview", type: "editing-port", v: 1 },
        ports: [port2],
      }),
    );
  expect(await previewLayers(iframe)).toBeNull();
});
