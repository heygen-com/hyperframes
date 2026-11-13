// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The frame's real runtime agent, serving the opaque frame from this document.
import { installEditingAgent } from "../../../../core/src/runtime/editingAgent";
import { detachedFakeIframe } from "../../player/hooks/timelinePlayerTestHarness";
import { describePreviewElements, queryPreviewElements } from "../../player/lib/previewElements";
import { resolvePreviewSelection, standInFor } from "./previewSelection";
import { manualOffsetMoveRevert } from "./gestureUndoRevert";
import { writePlainMove } from "./plainTranslate";
import {
  beginStudioManualEditGesture,
  captureStudioBoxSize,
  restoreStudioBoxSize,
} from "./manualEdits";
import { STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR } from "./manualEditsTypes";
import {
  applyManualOffsetDragCommit,
  applyManualOffsetDragDraft,
  createManualOffsetDragMember,
  endManualOffsetDragMembers,
  restoreManualOffsetDragMembers,
  type ManualOffsetDragMember,
} from "./manualOffsetDrag";
import { endResizeWithoutMember, resolveResizeDraftRect } from "./resizeDraft";
import { applySoftReloadFinalization } from "../../utils/gsapSoftReload";
import type { DomEditSelection } from "./domEditing";
import type { GestureState } from "./domEditOverlayGestures";
import { previewRequest } from "../../player/lib/previewChannel";

vi.mock("../../player/lib/previewChannel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../player/lib/previewChannel")>();
  return { ...actual, previewRequest: vi.fn(actual.previewRequest) };
});
const draftRequests = () =>
  vi.mocked(previewRequest).mock.calls.filter(([, kind]) => kind === "draft");

const closers: Array<() => void> = [];
beforeEach(() => {
  document.body.innerHTML = `<main data-composition-id="main"><div id="card" style="width: 200px; height: 100px"></div><div id="chip" style="translate: 30px 0px"></div><div id="centred" style="width: 200px; height: 100px; translate: -50% -50%"></div><div id="moved" data-hf-studio-original-inline-translate="" style="translate: 10px 20px"></div></main>`;
});
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  document.body.innerHTML = "";
});

/** A frame whose window refuses every read, as a cross-origin one does; its runtime serves this document. */
function opaqueFrame(): HTMLIFrameElement {
  const blocked = () => {
    throw new DOMException("blocked", "SecurityError");
  };
  const target: Record<string, unknown> = {};
  const frame = new Proxy(target, {
    get: (_, key) => (key === "postMessage" ? target.postMessage : blocked()),
  });
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  const parent = {
    postMessage: (data: unknown, _origin: string, ports: MessagePort[]) =>
      window.dispatchEvent(
        new MessageEvent("message", { source: frame as unknown as Window, data, ports }),
      ),
  } as unknown as Window;
  const agent = installEditingAgent(parent);
  target.postMessage = (data: unknown) =>
    window.dispatchEvent(new MessageEvent("message", { source: parent, data }));
  closers.push(() => agent.dispose());
  return iframe;
}

async function described(iframe: HTMLIFrameElement, selector: string) {
  const handle = (await queryPreviewElements(iframe, selector))!.matches[0]!.handle;
  return (await describePreviewElements(iframe, [handle]))![0]!;
}

async function standIn(iframe: HTMLIFrameElement, selector: string): Promise<HTMLElement> {
  return standInFor(iframe, await described(iframe, selector));
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

const RECT = { left: 10, top: 20, width: 100, height: 50, editScaleX: 0.5, editScaleY: 0.5 };

function dragMember(element: HTMLElement): ManualOffsetDragMember {
  const selection = { element } as DomEditSelection;
  const made = createManualOffsetDragMember({
    key: "k",
    selection,
    element,
    rect: RECT,
    gesture: "drag",
  });
  if (!made.ok) throw new Error(made.reason);
  return made.member;
}

const card = () => document.getElementById("card")!;
/** The test DOM keeps a calc() unsimplified, so each axis is read back as the sum of its px terms. */
const shown = (element: HTMLElement) =>
  element.style
    .getPropertyValue("translate")
    .split(/ (?![^(]*\))/)
    .map((axis) =>
      [...axis.matchAll(/-?[\d.]+px/g)].reduce((sum, [px]) => sum + parseFloat(px), 0),
    );

describe("gesture drafts on an opaque frame", () => {
  it("moves the frame's element with a drag, and puts it back when the drag is cancelled", async () => {
    const member = dragMember(await standIn(opaqueFrame(), "#card"));
    applyManualOffsetDragDraft(member, 10, 0);
    applyManualOffsetDragDraft(member, 40, 20);
    await vi.waitFor(() => expect(shown(card())).toEqual([80, 40]));
    restoreManualOffsetDragMembers([member]);
    await vi.waitFor(() =>
      expect(card().getAttribute("style")).toBe("width: 200px; height: 100px;"),
    );
  });

  it("holds a saved drag where it was dropped, and the next drag starts from there", async () => {
    const element = await standIn(opaqueFrame(), "#card");
    const first = dragMember(element);
    applyManualOffsetDragCommit(first, 40, 20);
    endManualOffsetDragMembers([first]);
    await vi.waitFor(() => expect(shown(card())).toEqual([80, 40]));
    const second = dragMember(element);
    applyManualOffsetDragDraft(second, -10, 0);
    await vi.waitFor(() => expect(shown(card())).toEqual([60, 40]));
  });

  it("draws a drag that grabs the layer again before the last save settles from where that one left it", async () => {
    const element = await standIn(opaqueFrame(), "#card");
    const first = dragMember(element);
    applyManualOffsetDragCommit(first, 40, 20);
    await vi.waitFor(() => expect(shown(card())).toEqual([80, 40]));
    const second = dragMember(element);
    applyManualOffsetDragDraft(second, 10, 0);
    endManualOffsetDragMembers([first]);
    await vi.waitFor(() => expect(shown(card())).toEqual([100, 40]));
    applyManualOffsetDragCommit(second, 10, 0);
    endManualOffsetDragMembers([second]);
    await settled();
    expect(shown(card())).toEqual([100, 40]);
  });

  it("puts a move back on the frame when an undo painted over it does not go through", async () => {
    const member = dragMember(await standIn(opaqueFrame(), "#card"));
    applyManualOffsetDragCommit(member, 40, 20);
    await vi.waitFor(() => expect(shown(card())).toEqual([80, 40]));
    const putBack = manualOffsetMoveRevert([member])();
    await vi.waitFor(() =>
      expect(card().getAttribute("style")).toBe("width: 200px; height: 100px;"),
    );
    putBack();
    await vi.waitFor(() => expect(shown(card())).toEqual([80, 40]));
  });

  it("moves a % translate from the px the frame renders it at, and keeps the author's value to reset to", async () => {
    const iframe = opaqueFrame();
    const options = { activeCompositionPath: "index.html", isMasterView: false };
    const selection = await resolvePreviewSelection(
      iframe,
      await described(iframe, "#centred"),
      options,
    );
    const member = dragMember(selection!.element);
    expect(member.initialOffset).toEqual({ x: -100, y: -50 });
    const offset = applyManualOffsetDragCommit(member, 40, 0);
    expect(offset).toEqual({ x: -20, y: -50 });
    expect(writePlainMove(selection!.element, offset).slice(0, 2)).toEqual([
      { type: "inline-style", property: "translate", value: "-20px -50px" },
      { type: "attribute", property: STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR, value: "-50% -50%" },
    ]);
    const centred = document.getElementById("centred")!;
    await vi.waitFor(() => expect(shown(centred)).toEqual([-20, -50]));
  });

  it("refuses to move a % translate it has no rendered px for, rather than drop it", async () => {
    const element = await standIn(opaqueFrame(), "#centred");
    const made = createManualOffsetDragMember({
      key: "k",
      selection: { element } as DomEditSelection,
      element,
      rect: RECT,
      gesture: "drag",
    });
    expect(made.ok).toBe(false);
  });

  it("keeps the translate the author had before Studio moved the layer as the one to reset to", async () => {
    const element = await standIn(opaqueFrame(), "#moved");
    applyManualOffsetDragCommit(dragMember(element), 40, 0);
    expect(element.getAttribute(STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR)).toBe("");
  });

  it("starts a drag on a freshly loaded frame from the translate its element has", async () => {
    const member = dragMember(await standIn(opaqueFrame(), "#chip"));
    expect(member.initialOffset).toEqual({ x: 30, y: 0 });
    expect(applyManualOffsetDragCommit(member, 40, 0)).toEqual({ x: 110, y: 0 });
    const chip = document.getElementById("chip")!;
    await vi.waitFor(() => expect(shown(chip)).toEqual([110, 0]));
  });

  it("sends one request at a time and draws only the latest of the moves that waited", async () => {
    const member = dragMember(await standIn(opaqueFrame(), "#card"));
    vi.mocked(previewRequest).mockClear();
    for (let dx = 2; dx <= 40; dx += 2) applyManualOffsetDragDraft(member, dx, 0);
    await vi.waitFor(() => expect(shown(card())).toEqual([80, 0]));
    expect(draftRequests()).toHaveLength(2);
  });

  it("grows a resized box about its centre without measuring the frame, and draws it there", async () => {
    const iframe = opaqueFrame();
    const element = await standIn(iframe, "#card");
    const g = {
      ...{ originLeft: 10, originTop: 20, originWidth: 100, originHeight: 50 },
      ...{ actualWidth: 200, actualHeight: 100, editScaleX: 0.5, editScaleY: 0.5 },
      actualRotation: 0,
      pathOffsetMember: dragMember(element),
    } as GestureState;
    const size = { width: 300, height: 140 };
    const rect = resolveResizeDraftRect(g, element, null, iframe, () => null, {
      wanted: size,
      written: size,
    });
    expect(rect).toMatchObject({ left: -15, top: 10, width: 150, height: 70, angle: 0 });
    expect(g.lastResizeAnchor).toEqual({ dx: -25, dy: -10 });
    await vi.waitFor(() => expect(card().style.width).toBe("300px"));
    expect(card().style.height).toBe("140px");
    expect(shown(card())).toEqual([-50, -20]);
  });

  it("keeps a saved resize with no offset member on the frame when a later restore runs", async () => {
    const iframe = opaqueFrame();
    const element = await standIn(iframe, "#card");
    const before = captureStudioBoxSize(element);
    const token = beginStudioManualEditGesture(element, "resize");
    const g = {
      ...{ originLeft: 10, originTop: 20, originWidth: 100, originHeight: 50 },
      ...{ actualWidth: 200, actualHeight: 100, editScaleX: 0.5, editScaleY: 0.5 },
      actualRotation: 0,
    } as GestureState;
    const size = { width: 300, height: 140 };
    resolveResizeDraftRect(g, element, null, iframe, () => null, { wanted: size, written: size });
    await vi.waitFor(() => expect(card().style.width).toBe("300px"));
    endResizeWithoutMember(element, token);
    restoreStudioBoxSize(element, before);
    await settled();
    expect(card().style.width).toBe("300px");
  });

  it("leaves elements of a frame Studio scripts to the gesture alone", async () => {
    vi.mocked(previewRequest).mockClear();
    const member = dragMember(document.getElementById("chip")!);
    applyManualOffsetDragDraft(member, 40, 20);
    restoreManualOffsetDragMembers([member]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(draftRequests()).toHaveLength(0);
  });

  it("reports a timeline rebind it cannot reach, so the caller syncs the preview another way", () => {
    expect(applySoftReloadFinalization(opaqueFrame(), 1)).toBe(false);
  });
});
