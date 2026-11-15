// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The frame's real runtime agent, serving the opaque frame from this document.
import { installEditingAgent } from "../../../../core/src/runtime/editingAgent";
import {
  getAllPreviewTargetsFromPointer,
  getPreviewTargetFromPointer,
} from "../../utils/studioPreviewHelpers";
import {
  elementWithin,
  findPointerTarget,
  findPointerTargets,
  pointerMayHitElement,
  selectionDataAttribute,
} from "./previewSelection";
import type { PreviewElement } from "../../player/lib/previewElements";
import { detachedFakeIframe } from "../../player/hooks/timelinePlayerTestHarness";
import { installReactActEnvironment } from "../../hooks/domSelectionTestHarness";
import { useDomSelection } from "../../hooks/useDomSelection";
import { usePreviewInteraction } from "../../hooks/usePreviewInteraction";
import { useCanvasContextMenuState } from "./useCanvasContextMenuState";
import type { TimelineElement } from "../../player";

installReactActEnvironment();

const FIXTURE = `
  <main data-composition-id="main" data-width="1920" data-height="1080">
    <section id="block"><div id="mask" style="overflow: hidden"><h1 id="title">Launch</h1></div></section>
    <div id="ghost" style="pointer-events: none"><p id="under-ghost">hidden from clicks</p></div>
    <div id="backdrop" style="background: #111"></div>
    <p data-hf-id="note">Note</p>
    <div id="pair" data-hf-group="pair"><i id="a" style="background: red"></i><i data-hf-id="b-hf" style="background: blue"></i></div>
  </main>`;
const RECTS: Record<string, number[]> = {
  title: [44, 44, 220, 48],
  mask: [40, 40, 260, 64],
  block: [30, 30, 300, 100],
  "under-ghost": [500, 40, 200, 60],
  ghost: [500, 40, 200, 60],
  backdrop: [0, 0, 1920, 1080],
  pair: [0, 0, 1, 1],
  a: [1000, 600, 100, 100],
  "b-hf": [1300, 800, 100, 100],
};
/** Frame points, in the composition's pixels, and what lies under each, topmost first. */
const STACKS: Array<[x: number, y: number, ids: string[]]> = [
  [60, 60, ["title", "mask", "block", "backdrop"]],
  [560, 60, ["under-ghost", "ghost", "backdrop"]],
  [900, 500, ["backdrop"]],
  [1200, 700, ["backdrop"]],
  [1050, 650, ["a", "pair", "backdrop"]],
];
const FRAME = [100, 50, 960, 540];

function sized(element: Element, [x, y, width, height]: number[]) {
  element.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }) as DOMRect;
  return element;
}

const at = (x: number, y: number) => STACKS.find(([px, py]) => px === x && py === y)?.[2] ?? [];
const byId = (id: string) =>
  document.getElementById(id) ?? document.querySelector(`[data-hf-id="${id}"]`);

const closers: Array<() => void> = [];
beforeEach(() => {
  document.body.innerHTML = FIXTURE;
  sized(document.querySelector("main")!, [0, 0, 1920, 1080]);
  for (const [id, rect] of Object.entries(RECTS)) sized(byId(id)!, rect);
  const stack = (x: number, y: number) => at(Math.round(x), Math.round(y)).map((id) => byId(id)!);
  Object.assign(document, {
    elementsFromPoint: stack,
    elementFromPoint: (x: number, y: number) => stack(x, y)[0] ?? null,
  });
});
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  document.body.innerHTML = "";
  delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
});

/** A frame Studio scripts directly; its document is this one. */
function liveFrame(): HTMLIFrameElement {
  const iframe = detachedFakeIframe({});
  Object.defineProperty(iframe, "contentDocument", { value: document });
  return sized(iframe, FRAME) as HTMLIFrameElement;
}

/** A frame Studio cannot read, whose runtime is the real editing agent over this document. */
function opaqueFrame(): HTMLIFrameElement {
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
  return iframe;
}

/** The client point over frame point (x, y): the frame shows the composition at half size. */
const client = (x: number, y: number) => [FRAME[0]! + x / 2, FRAME[1]! + y / 2] as const;
const nameOf = (element: HTMLElement | PreviewElement | null | undefined) => {
  if (!element) return null;
  if ("handle" in element)
    return element.id ?? element.attributes.find(([k]) => k === "data-hf-id")?.[1];
  return element.id || element.getAttribute("data-hf-id");
};

describe("canvas hit-tests on an opaque frame match same-origin ones", () => {
  it.each(STACKS.map(([x, y]) => [x, y]))("at (%d, %d)", async (x, y) => {
    const [cx, cy] = client(x, y);
    const live = liveFrame();
    const opaque = opaqueFrame();
    const pick = nameOf(getPreviewTargetFromPointer(live, cx, cy));
    expect(nameOf(await findPointerTarget(opaque, cx, cy))).toBe(pick);
    const stack = getAllPreviewTargetsFromPointer(live, cx, cy).map(nameOf);
    expect((await findPointerTargets(opaque, cx, cy)).map(nameOf)).toEqual(stack);
  });

  it("picks what each rule decides: the leaf, not a pointer-events:none layer, not a backdrop, a group's gap", async () => {
    const opaque = opaqueFrame();
    const picks = [];
    for (const [x, y] of STACKS)
      picks.push(nameOf(await findPointerTarget(opaque, ...client(x, y))));
    expect(picks).toEqual(["title", null, null, "pair", "a"]);
  });

  it("knows whether a press lands on an element only where the frame last answered", async () => {
    const opaque = opaqueFrame();
    const title = client(60, 60);
    const empty = client(900, 500);
    expect(pointerMayHitElement(opaque, ...empty)).toBe(true);
    await findPointerTarget(opaque, ...empty);
    expect(pointerMayHitElement(opaque, ...empty)).toBe(false);
    expect(pointerMayHitElement(opaque, ...title)).toBe(true);
    await findPointerTarget(opaque, ...title);
    expect(pointerMayHitElement(opaque, ...title)).toBe(true);
    expect(pointerMayHitElement(liveFrame(), ...empty)).toBe(false);
  });

  it("says it cannot tell when the frame has no editing agent", async () => {
    vi.useFakeTimers();
    try {
      const iframe = sized(detachedFakeIframe({}), FRAME) as HTMLIFrameElement;
      Object.defineProperty(iframe, "contentDocument", { value: null });
      Object.defineProperty(iframe.contentWindow!, "document", {
        get: () => {
          throw new DOMException("blocked", "SecurityError");
        },
      });
      const found = findPointerTarget(iframe, ...client(60, 60));
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await found).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useDomSelection over an opaque frame's canvas", () => {
  type Resolve = ReturnType<typeof useDomSelection>["resolveDomSelectionFromPreviewPoint"];
  let interaction: ReturnType<typeof usePreviewInteraction> | null = null;
  let menu: ReturnType<typeof useCanvasContextMenuState> | null = null;
  function renderSelection(iframe: HTMLIFrameElement, wrapResolve = (resolve: Resolve) => resolve) {
    let hook: ReturnType<typeof useDomSelection> | null = null;
    function Harness() {
      hook = useDomSelection({
        projectId: null,
        activeCompPath: "index.html",
        isMasterView: true,
        compIdToSrc: new Map(),
        captionEditMode: false,
        previewIframeRef: { current: iframe },
        timelineElements: [],
        getTimelineSelectionSet: () => new Set(),
        setSelectedTimelineElementId: vi.fn(),
        setTimelineSelectionSet: vi.fn(),
        setRightCollapsed: vi.fn(),
        setRightPanelTab: vi.fn(),
        previewIframe: iframe,
        refreshKey: 0,
        rightPanelTab: "design",
      });
      interaction = usePreviewInteraction({
        captionEditMode: false,
        compositionLoading: false,
        previewIframeRef: { current: iframe },
        showToast: vi.fn(),
        applyDomSelection: hook.applyDomSelection,
        resolveDomSelectionFromPreviewPoint: wrapResolve(hook.resolveDomSelectionFromPreviewPoint),
        resolveAllDomSelectionsFromPreviewPoint: hook.resolveAllDomSelectionsFromPreviewPoint,
        updateDomEditHoverSelection: hook.updateDomEditHoverSelection,
        setActiveGroupElement: hook.setActiveGroupElement,
      });
      // The overlay's right-click path, which awaits the same lookup a pointer move runs.
      menu = useCanvasContextMenuState({
        selection: hook.domEditSelection,
        selectionRef: { current: hook.domEditSelection },
        hoverSelectionRef: { current: hook.domEditHoverSelection },
        onCanvasPointerMoveRef: { current: interaction.handlePreviewCanvasPointerMove },
        onSelectionChangeRef: { current: hook.applyDomSelection },
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(React.createElement(Harness)));
    closers.push(() => act(() => root.unmount()));
    return () => hook!;
  }

  it("selects the clicked element and keeps a hover on it", async () => {
    const hook = renderSelection(opaqueFrame());
    const point = client(60, 60);
    const picked = await act(() => hook().resolveDomSelectionFromPreviewPoint(...point));
    expect(picked).toMatchObject({ id: "title", selector: "#title" });
    act(() => hook().updateDomEditHoverSelection(picked));
    expect(hook().domEditHoverSelection).toBe(picked);
    const cycle = await act(() => hook().resolveAllDomSelectionsFromPreviewPoint(...point));
    expect(cycle.map((selection) => selection.id)).toEqual(["title", "mask", "block"]);
  });

  const move = (x: number, y: number) => {
    const [clientX, clientY] = client(x, y);
    const event = { clientX, clientY } as React.PointerEvent<HTMLDivElement>;
    return interaction!.handlePreviewCanvasPointerMove(event);
  };

  it.each([
    ["opaque", opaqueFrame],
    ["same-origin", liveFrame],
  ])("drops a hover the pointer left before it resolved (%s)", async (_kind, frame) => {
    const hook = renderSelection(frame());
    const moved = move(60, 60);
    act(() => interaction!.handlePreviewCanvasPointerLeave());
    await act(() => moved);
    expect(hook().domEditHoverSelection).toBeNull();
  });

  it("keeps the newest move's hover when an older one resolves after it", async () => {
    let calls = 0;
    const hook = renderSelection(opaqueFrame(), (resolve) => async (...args) => {
      const delay = ++calls === 1 ? 60 : 0;
      const picked = await resolve(...args);
      await new Promise((done) => setTimeout(done, delay));
      return picked;
    });
    const older = move(60, 60);
    const newer = move(1050, 650);
    await act(() => Promise.all([older, newer]));
    expect(hook().domEditHoverSelection).toMatchObject({ id: "pair" });
  });

  it("opens the menu on a right-click whose lookup a pointer move overtook", async () => {
    const hook = renderSelection(opaqueFrame());
    const [clientX, clientY] = client(60, 60);
    const rightClick = { clientX, clientY, preventDefault: () => {} };
    const opened = menu!.handleContextMenu(rightClick as React.MouseEvent<HTMLDivElement>);
    const jitter = move(1050, 650);
    await act(() => Promise.all([opened, jitter]));
    expect(hook().domEditSelection).toMatchObject({ id: "title" });
    expect(menu!.contextMenu?.sel).toMatchObject({ id: "title" });
    expect(hook().domEditHoverSelection).toMatchObject({ id: "pair" });
  });

  it("takes a hover of the same element from a reloaded frame, whose handle is new", async () => {
    const hook = renderSelection(opaqueFrame());
    const picked = (await act(() =>
      hook().resolveDomSelectionFromPreviewPoint(...client(60, 60)),
    ))!;
    act(() => hook().updateDomEditHoverSelection(picked));
    const reloaded = { ...picked, handle: "0123456789abcdef:1" };
    act(() => hook().updateDomEditHoverSelection(reloaded));
    expect(hook().domEditHoverSelection).toBe(reloaded);
    act(() => hook().updateDomEditHoverSelection({ ...reloaded }));
    expect(hook().domEditHoverSelection).toBe(reloaded);
  });

  it("drills into a group and stays in it while selecting its members", async () => {
    const hook = renderSelection(opaqueFrame());
    const group = (await act(() =>
      hook().resolveDomSelectionFromPreviewPoint(...client(1200, 700)),
    ))!;
    expect(selectionDataAttribute(group, "data-hf-group")).toBe("pair");
    expect(group.element.hasAttribute("data-hf-group")).toBe(false);
    act(() => hook().setActiveGroupElement(group.element));
    const member = (await act(() =>
      hook().resolveDomSelectionFromPreviewPoint(...client(1050, 650), {
        activeGroupElement: group.element,
      }),
    ))!;
    expect(member.id).toBe("a");
    expect(elementWithin(group.element, member.element)).toBe(true);
    expect(elementWithin(member.element, group.element)).toBe(false);
    act(() => hook().applyDomSelection(member));
    expect(hook().activeGroupElement).toBe(group.element);
  });

  it("selects a timeline clip the frame knows only by its clip id", async () => {
    const hook = renderSelection(opaqueFrame());
    const clip = (id: string) => ({ id, key: `index.html:${id}:0` }) as unknown as TimelineElement;
    await act(() => hook().handleTimelineElementSelect(clip("title")));
    expect(hook().domEditSelection).toMatchObject({ id: "title" });
    await act(() => hook().handleTimelineElementSelect(clip("note")));
    expect(hook().domEditSelection).toMatchObject({ hfId: "note" });
    await act(() => hook().handleTimelineElementSelect(clip("nowhere")));
    expect(hook().domEditSelection).toBeNull();
    const moved = { ...clip("title"), selector: "#renamed" } as TimelineElement;
    await act(() => hook().handleTimelineElementSelect(moved));
    expect(hook().domEditSelection).toBeNull();
  });
});
