// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSelection } from "../../hooks/domSelectionTestHarness";
import { useInlineTextEdit } from "../../hooks/useInlineTextEdit";
import {
  makePreview,
  mountPlayerWithPreview,
  paintShadow,
  resetPlayerStore,
  type TimelinePlayerApi,
} from "../../player/hooks/timelinePlayerTestHarness";
import type { DomEditSelection } from "./domEditing";
import "./domEditOverlayTestMocks";
import { DomEditOverlay } from "./DomEditOverlay";
import { STUDIO_MANUAL_EDIT_GESTURE_ATTR } from "./manualEditsTypes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const layout = vi.hoisted(() => ({ group: [] as unknown[] }));
vi.mock("./useDomEditOverlayRects", () => {
  const rect = { left: 100, top: 100, width: 200, height: 100, editScaleX: 1, editScaleY: 1 };
  return {
    useDomEditOverlayRects: () => ({
      overlayRect: rect,
      overlayRectRef: { current: rect },
      setOverlayRect: () => undefined,
      hoverRect: null,
      groupOverlayItems: layout.group,
      groupOverlayItemsRef: { current: layout.group },
      setGroupOverlayItems: () => undefined,
      childRects: [],
    }),
  };
});
vi.mock("../../utils/gsapSoftReload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/gsapSoftReload")>()),
  ensureMotionPathPluginLoaded: vi.fn(),
}));

const BOX = '[data-dom-edit-selection-box="true"]';
const RECT = { left: 100, top: 100, width: 200, height: 100, editScaleX: 1, editScaleY: 1 };
const TWO_LAYERS = '<h1 id="title">Title</h1><p id="sub">Sub</p>';

/** What the server serves: the file as the last commit left it. */
let file = { title: "", sub: "" };
const served = (query: string) =>
  makePreview(
    `<h1 id="title" style="${file.title}">Title</h1><p id="sub" style="${file.sub}">Sub</p>`,
    query,
  );

let overlayRoot: Root;
let player: ReturnType<typeof mountPlayerWithPreview>;

const marked = (doc: Document) => doc.querySelectorAll(`[${STUDIO_MANUAL_EDIT_GESTURE_ATTR}]`);
const byId = (iframe: HTMLIFrameElement | null, id: string) =>
  iframe!.contentDocument!.getElementById(id) as HTMLElement;
const api = (): TimelinePlayerApi => player.getApi();

function pointer(target: Element, type: string, x: number, y: number) {
  const init = { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y };
  act(() => void target.dispatchEvent(new PointerEvent(type, init)));
}

/** The real player with a two-layer preview, and the real overlay editing it. */
function mountEditor(group: boolean) {
  file = { title: "", sub: "" };
  const live = makePreview(TWO_LAYERS);
  player = mountPlayerWithPreview(live);
  const selections = ["title", "sub"].map((id) => makeSelection(id, byId(live, id)));
  layout.group = group
    ? selections.map((s) => ({ key: s.id, selection: s, element: s.element, rect: RECT }))
    : [];
  const write = (sel: DomEditSelection, next: { x: number; y: number }) => {
    file = { ...file, [sel.id!]: `translate: ${next.x}px ${next.y}px` };
    return Promise.resolve();
  };
  const onPathOffsetCommit = vi.fn(write);
  const onGroupPathOffsetCommit = vi.fn(
    async (updates: { selection: DomEditSelection; next: { x: number; y: number } }[]) => {
      for (const { selection, next } of updates) await write(selection, next);
    },
  );
  const host = document.body.appendChild(document.createElement("div"));
  overlayRoot = createRoot(host);
  act(() =>
    overlayRoot.render(
      <DomEditOverlay
        iframeRef={api().iframeRef}
        activeCompositionPath={null}
        selection={group ? null : selections[0]!}
        groupSelections={group ? selections : []}
        hoverSelection={null}
        onCanvasMouseDown={() => undefined}
        onCanvasPointerMove={() => Promise.resolve(null)}
        onCanvasPointerLeave={() => undefined}
        onSelectionChange={() => undefined}
        onBlockedMove={() => undefined}
        onPathOffsetCommit={onPathOffsetCommit}
        onGroupPathOffsetCommit={onGroupPathOffsetCommit}
        onBoxSizeCommit={() => undefined}
        onRotationCommit={() => undefined}
      />,
    ),
  );
  const overlay = host.firstElementChild as HTMLElement;
  return { live, overlay, box: overlay.querySelector(BOX)!, onPathOffsetCommit };
}

/** A reload whose shadow paints while the gesture is still live. */
async function reloadMidGesture() {
  act(() => api().refreshPlayer());
  const shadow = served("?_t=1");
  const gen = await paintShadow(api, shadow);
  return { shadow, gen };
}

async function settle() {
  await act(async () => {
    for (let tick = 0; tick < 10; tick++) await Promise.resolve();
  });
}

beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
});

afterEach(() => {
  act(() => overlayRoot?.unmount());
  act(() => player?.root.unmount());
  layout.group = [];
  document.body.innerHTML = "";
  resetPlayerStore();
});

describe("a reload that paints during a drag", () => {
  it.each([
    ["one layer", false],
    ["a group", true],
  ])("of %s waits for the drop, then shows the drop from a fresh load", async (_, group) => {
    const { live, overlay, box } = mountEditor(group);
    pointer(box, "pointerdown", 150, 150);
    pointer(overlay, "pointermove", 170, 160);
    pointer(overlay, "pointermove", 190, 170);
    const held = await reloadMidGesture();
    expect(api().iframeRef.current, "promoted under the pointer").toBe(live);

    pointer(overlay, "pointerup", 190, 170);
    await settle();
    expect(byId(live, "title").style.getPropertyValue("translate")).toBe("40px 20px");
    expect(file.title).toBe("translate: 40px 20px");
    if (group) expect(file.sub).toBe("translate: 40px 20px");
    expect(marked(live.contentDocument!)).toHaveLength(0);
    expect(api().iframeRef.current, "the shadow loaded before the drop").toBe(live);

    const fresh = served("?_t=2");
    expect(await paintShadow(api, fresh)).toBeGreaterThan(held.gen);
    expect(api().iframeRef.current).toBe(fresh);
    expect(byId(fresh, "title").style.getPropertyValue("translate")).toBe("40px 20px");
    if (group) expect(byId(fresh, "sub").style.getPropertyValue("translate")).toBe("40px 20px");
  });
});

describe("every way a drag ends without a drop clears its mark, so the held reload goes on", () => {
  it.each([
    [
      "pointercancel",
      (e: ReturnType<typeof mountEditor>) => pointer(e.overlay, "pointercancel", 0, 0),
    ],
    [
      "lostpointercapture",
      (e: ReturnType<typeof mountEditor>) => pointer(e.box, "lostpointercapture", 0, 0),
    ],
    ["window blur", () => act(() => void window.dispatchEvent(new Event("blur")))],
    ["overlay unmount", () => act(() => overlayRoot.unmount())],
  ])("%s", async (_, end) => {
    const editor = mountEditor(false);
    pointer(editor.box, "pointerdown", 150, 150);
    pointer(editor.overlay, "pointermove", 190, 170);
    expect(marked(editor.live.contentDocument!)).toHaveLength(1);
    await reloadMidGesture();
    expect(api().iframeRef.current).toBe(editor.live);

    end(editor);
    await settle();
    expect(marked(editor.live.contentDocument!)).toHaveLength(0);
    expect(byId(editor.live, "title").style.getPropertyValue("translate")).not.toBe("40px 20px");
    expect(editor.onPathOffsetCommit).not.toHaveBeenCalled();
    const fresh = served("?_t=2");
    await paintShadow(api, fresh);
    expect(api().iframeRef.current).toBe(fresh);
  });
});

describe("an inline text edit", () => {
  it("holds a reload from the first key until its text is saved", async () => {
    const live = makePreview(TWO_LAYERS);
    player = mountPlayerWithPreview(live);
    let saved: () => void = () => {};
    const onCommit = vi.fn(() => new Promise<void>((resolve) => (saved = resolve)));
    let controls: ReturnType<typeof useInlineTextEdit> | null = null;
    function Editor() {
      controls = useInlineTextEdit({ onCommit });
      return null;
    }
    overlayRoot = createRoot(document.body.appendChild(document.createElement("div")));
    act(() => overlayRoot.render(<Editor />));
    act(() => void controls!.start(byId(live, "title")));
    await reloadMidGesture();
    expect(api().iframeRef.current).toBe(live);

    act(() => controls!.commit());
    await settle();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(marked(live.contentDocument!), "held until the save lands").toHaveLength(1);
    await act(async () => saved());
    expect(marked(live.contentDocument!)).toHaveLength(0);
    const fresh = served("?_t=2");
    await paintShadow(api, fresh);
    expect(api().iframeRef.current).toBe(fresh);
  });
});
