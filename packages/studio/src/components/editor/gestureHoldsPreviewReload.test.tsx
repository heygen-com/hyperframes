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
import { PreviewReadOnlyProvider } from "./previewReadOnlyContext";
import { STUDIO_MANUAL_EDIT_GESTURE_ATTR } from "./manualEditsTypes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const layout = vi.hoisted(() => ({
  group: [] as unknown[],
  rect: { left: 100, top: 100, width: 200, height: 100, editScaleX: 1, editScaleY: 1 },
}));
vi.mock("./useDomEditOverlayRects", () => ({
  useDomEditOverlayRects: () => {
    const { rect, group } = layout;
    const groupOverlayItemsRef = { current: group };
    const noop = () => undefined;
    return {
      overlayRect: rect,
      overlayRectRef: { current: rect },
      groupOverlayItems: group,
      groupOverlayItemsRef,
      hoverRect: null,
      childRects: [],
      setOverlayRect: noop,
      setGroupOverlayItems: noop,
    };
  },
}));
vi.mock("../../utils/gsapSoftReload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/gsapSoftReload")>()),
  ensureMotionPathPluginLoaded: vi.fn(),
}));

const BOX = '[data-dom-edit-selection-box="true"]';
const RECT = layout.rect;
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
function mountEditor(
  group: boolean,
  saving: { landed: Promise<void> } = { landed: Promise.resolve() },
) {
  file = { title: "", sub: "" };
  const live = makePreview(TWO_LAYERS);
  player = mountPlayerWithPreview(live);
  const selections = ["title", "sub"].map((id) => makeSelection(id, byId(live, id)));
  for (const s of selections) s.capabilities.canApplyManualRotation = true;
  const saveStyle = (sel: DomEditSelection | null, style: string) =>
    saving.landed.then(() => void (file = { ...file, [sel?.id ?? "title"]: style }));
  layout.group = group
    ? selections.map((s) => ({ key: s.id, selection: s, element: s.element, rect: RECT }))
    : [];
  const write = (sel: DomEditSelection, next: { x: number; y: number }) =>
    saveStyle(sel, `translate: ${next.x}px ${next.y}px`);
  const onPathOffsetCommit = vi.fn(write);
  const onGroupPathOffsetCommit = vi.fn(
    async (updates: { selection: DomEditSelection; next: { x: number; y: number } }[]) => {
      for (const { selection, next } of updates) await write(selection, next);
    },
  );
  const host = document.body.appendChild(document.createElement("div"));
  overlayRoot = createRoot(host);
  const render = (readOnly: boolean) =>
    act(() =>
      overlayRoot.render(
        <PreviewReadOnlyProvider readOnly={readOnly}>
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
            onBoxSizeCommit={(sel, size) => saveStyle(sel, `width: ${size.width}px`)}
            onRotationCommit={(sel, next) => saveStyle(sel, `rotate: ${next.angle}deg`)}
            onStyleCommit={(property, value) => saveStyle(selections[0]!, `${property}: ${value}`)}
          />
        </PreviewReadOnlyProvider>,
      ),
    );
  render(false);
  const overlay = host.querySelector('[aria-label="Composition canvas"]') as HTMLElement;
  return { live, overlay, box: overlay.querySelector(BOX)!, onPathOffsetCommit, render };
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

describe("a reload during a drag", () => {
  it.each([
    ["one layer", false],
    ["a group", true],
  ])(
    "that paints before the drop of %s waits, then shows the drop from a fresh load",
    async (_, group) => {
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
    },
  );

  const handle = (overlay: HTMLElement, selector: string) => overlay.querySelector(selector)!;
  const corner = (overlay: HTMLElement) =>
    [...overlay.querySelectorAll<HTMLElement>("div.h-4.w-4")].reduce((a, b) =>
      parseFloat(b.style.left) + parseFloat(b.style.top) >
      parseFloat(a.style.left) + parseFloat(a.style.top)
        ? b
        : a,
    );
  // Each edit presses at `from`, drags to `to`, and releases on `on`.
  const edits = {
    move: (o: HTMLElement) => ({ press: handle(o, BOX), on: o, from: [150, 150], to: [190, 170] }),
    resize: (o: HTMLElement) => ({ press: corner(o), on: o, from: [300, 200], to: [340, 220] }),
    rotate: (o: HTMLElement) => ({
      press: handle(o, '[aria-label="Rotate selection"]'),
      on: o,
      from: [200, 80],
      to: [270, 150],
    }),
    crop: (o: HTMLElement) => {
      const edge = handle(o, '[aria-label="Crop left"]');
      return { press: edge, on: edge, from: [100, 150], to: [140, 150] };
    },
  };

  function drag(edit: ReturnType<(typeof edits)["move"]>) {
    pointer(edit.press, "pointerdown", edit.from[0]!, edit.from[1]!);
    pointer(edit.on, "pointermove", edit.to[0]!, edit.to[1]!);
  }

  it.each(Object.keys(edits) as (keyof typeof edits)[])(
    "that paints after a %s shows it from a fresh load, not the file before it",
    async (kind) => {
      const { live, overlay } = mountEditor(false);
      const edit = edits[kind](overlay);
      drag(edit);
      act(() => api().refreshPlayer());
      const beforeDrop = served("?_t=1");
      pointer(edit.on, "pointerup", edit.to[0]!, edit.to[1]!);
      await settle();
      expect(file.title, "the edit saved").not.toBe("");

      const requested = await paintShadow(api, beforeDrop);
      expect(api().iframeRef.current, "the file before the edit").toBe(live);
      const fresh = served("?_t=2");
      expect(await paintShadow(api, fresh)).toBeGreaterThan(requested);
      expect(byId(fresh, "title").getAttribute("style")).toBe(file.title);
    },
  );

  it("requested while the drop is still saving shows the drop from a fresh load", async () => {
    let land: () => void = () => {};
    const { live, overlay } = mountEditor(false, { landed: new Promise((r) => (land = r)) });
    const edit = edits.move(overlay);
    drag(edit);
    pointer(edit.on, "pointerup", edit.to[0]!, edit.to[1]!);
    await settle();
    act(() => api().refreshPlayer());
    const beforeSave = served("?_t=1");
    await act(async () => land());
    await settle();
    expect(file.title).toBe("translate: 40px 20px");

    const requested = await paintShadow(api, beforeSave);
    expect(api().iframeRef.current, "the file before the save").toBe(live);
    const fresh = served("?_t=2");
    expect(await paintShadow(api, fresh)).toBeGreaterThan(requested);
    expect(byId(fresh, "title").style.getPropertyValue("translate")).toBe("40px 20px");
  });
});

type Editor = ReturnType<typeof mountEditor>;

describe("every way a drag ends without a drop clears its mark and promotes the held reload", () => {
  it.each([
    ["pointercancel", (e: Editor) => pointer(e.overlay, "pointercancel", 0, 0)],
    ["lostpointercapture", (e: Editor) => pointer(e.box, "lostpointercapture", 0, 0)],
    ["window blur", () => act(() => void window.dispatchEvent(new Event("blur")))],
    ["a switch to read-only", (e: Editor) => e.render(true)],
    ["overlay unmount", () => act(() => overlayRoot.unmount())],
  ])("%s", async (_, end) => {
    const editor = mountEditor(false);
    pointer(editor.box, "pointerdown", 150, 150);
    pointer(editor.overlay, "pointermove", 190, 170);
    expect(marked(editor.live.contentDocument!)).toHaveLength(1);
    const held = await reloadMidGesture();
    expect(api().iframeRef.current).toBe(editor.live);

    end(editor);
    await settle();
    expect(marked(editor.live.contentDocument!)).toHaveLength(0);
    expect(byId(editor.live, "title").style.getPropertyValue("translate")).not.toBe("40px 20px");
    expect(editor.onPathOffsetCommit).not.toHaveBeenCalled();
    expect(api().iframeRef.current, "nothing was saved, so the held copy is current").toBe(
      held.shadow,
    );
  });

  it.each([
    ["one layer", false],
    ["a group", true],
  ])(
    "a press on %s that throws before the drag is armed leaves no mark behind",
    async (_, group) => {
      const editor = mountEditor(group);
      HTMLElement.prototype.setPointerCapture = () => {
        throw new Error("capture refused");
      };
      const swallow = (event: ErrorEvent) => event.preventDefault();
      window.addEventListener("error", swallow);
      try {
        pointer(editor.box, "pointerdown", 150, 150);
      } catch {
        // React may rethrow the handler's error; either way the mark must be gone.
      } finally {
        window.removeEventListener("error", swallow);
      }
      expect(marked(editor.live.contentDocument!)).toHaveLength(0);
      const { shadow } = await reloadMidGesture();
      expect(api().iframeRef.current).toBe(shadow);
    },
  );
});

describe("an inline text edit", () => {
  it("holds a reload while open, and the reload after it shows the saved text", async () => {
    const live = makePreview(TWO_LAYERS);
    player = mountPlayerWithPreview(live);
    let land: () => void = () => {};
    const onCommit = vi.fn(() => new Promise<void>((resolve) => (land = resolve)));
    let controls: ReturnType<typeof useInlineTextEdit> | null = null;
    function Editor() {
      controls = useInlineTextEdit({ onCommit });
      return null;
    }
    overlayRoot = createRoot(document.body.appendChild(document.createElement("div")));
    act(() => overlayRoot.render(<Editor />));
    act(() => void controls!.start(byId(live, "title")));
    const held = await reloadMidGesture();
    expect(api().iframeRef.current).toBe(live);

    act(() => controls!.commit());
    await settle();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(marked(live.contentDocument!), "closed, though the save is still out").toHaveLength(0);
    expect(api().iframeRef.current, "the held copy predates the text").toBe(live);
    expect(api().previewSlots.find((slot) => slot.role === "shadow")?.gen).toBe(held.gen);

    await act(async () => land());
    await settle();
    const afterSave = served("?_t=2");
    expect(await paintShadow(api, afterSave)).toBeGreaterThan(held.gen);
    expect(api().iframeRef.current).toBe(afterSave);
  });
});
