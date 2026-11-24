// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";
import { retirePreviewEditingClient } from "../../player/lib/previewChannel";
import {
  afterStudioManualEditGestures,
  beginStudioManualEditGesture,
  endStudioManualEditGesture,
  isStudioManualEditGestureCurrent,
  isStudioManualEditGestureLiveIn,
  studioGestureDraws,
} from "./manualEditGesture";
import { createManualOffsetDragMember, endManualOffsetDragMembers } from "./manualOffsetDrag";
import { readDragStamp } from "../../hooks/draggedGsapPosition";
import {
  findPreviewElementForSelection,
  gestureDocumentOf,
  resolvePreviewSelection,
} from "./previewSelection";

const MODES = process.env.HF_PARITY_MODE ? [process.env.HF_PARITY_MODE] : ["unsealed", "sealed"];
const PATH = "index.html";
const frames: HTMLIFrameElement[] = [];
const titles: HTMLElement[] = [];

afterEach(() => {
  titles.splice(0).forEach((element) => endStudioManualEditGesture(element));
  frames.splice(0).forEach(retirePreviewEditingClient);
  document.body.innerHTML = "";
});

/** The Title as each mode's gestures see it: the live node, or a sealed frame's stand-in, with the document a
 * reload asks whether a gesture is live in. */
async function title(mode: string): Promise<{ element: HTMLElement; doc: Document }> {
  document.body.innerHTML = '<h1 id="title">Title</h1>';
  if (mode === "unsealed") {
    titles.push(document.getElementById("title")!);
    return { element: titles[0]!, doc: document };
  }
  const { iframe } = sealedPreviewFrame();
  frames.push(iframe);
  const options = { activeCompositionPath: PATH, isMasterView: false, skipSourceProbe: true };
  const found = await findPreviewElementForSelection(
    iframe,
    { id: "title", sourceFile: PATH },
    PATH,
  );
  const selection = (await resolvePreviewSelection(iframe, found!, options))!;
  titles.push(selection.element);
  return { element: selection.element, doc: gestureDocumentOf(iframe)! };
}

describe.each(MODES)("%s preview", (mode) => {
  // fails without the fix: the press's move gesture took the text edit's mark and ending it cleared the mark, so an
  // outside write reloaded the preview under the open edit and dropped what was typed.
  it("holds a reload while a text edit is open after a press's gesture on it begins and ends", async () => {
    const { element, doc } = await title(mode);
    const edit = beginStudioManualEditGesture(element, "edit");
    const move = beginStudioManualEditGesture(element, "move");
    const reload = vi.fn();
    afterStudioManualEditGestures(doc, reload);
    endStudioManualEditGesture(element, move);
    expect(isStudioManualEditGestureLiveIn(doc)).toBe(true);
    expect(isStudioManualEditGestureCurrent(element, edit)).toBe(true);
    expect(studioGestureDraws(element)).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
    endStudioManualEditGesture(element, edit);
    expect(isStudioManualEditGestureLiveIn(doc)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  // fails without the fix: the resumed gesture kept the newer gesture's moment, so its commit used the wrong time.
  it("gives a resumed gesture back the moment it started at", async () => {
    const { element } = await title(mode);
    const resize = beginStudioManualEditGesture(element, "resize", { time: 2, keyframePct: null });
    const move = beginStudioManualEditGesture(element, "move", { time: 5, keyframePct: 50 });
    expect(readDragStamp(element).at).toEqual({ time: 5, keyframePct: 50 });
    endStudioManualEditGesture(element, move);
    expect(isStudioManualEditGestureCurrent(element, resize)).toBe(true);
    expect(readDragStamp(element).at).toEqual({ time: 2, keyframePct: null });
  });

  it("gives a resumed gesture that started without a moment none", async () => {
    const { element } = await title(mode);
    const edit = beginStudioManualEditGesture(element, "edit");
    const move = beginStudioManualEditGesture(element, "move", { time: 5, keyframePct: null });
    endStudioManualEditGesture(element, move);
    expect(isStudioManualEditGestureCurrent(element, edit)).toBe(true);
    expect(readDragStamp(element).at).toBeUndefined();
  });

  it("keeps the newest gesture current while an older one on the element is still live", async () => {
    const { element, doc } = await title(mode);
    const edit = beginStudioManualEditGesture(element, "edit");
    const move = beginStudioManualEditGesture(element, "move");
    endStudioManualEditGesture(element, edit);
    expect(isStudioManualEditGestureCurrent(element, move)).toBe(true);
    expect(studioGestureDraws(element)).toContain("translate");
    expect(isStudioManualEditGestureLiveIn(doc)).toBe(true);
    endStudioManualEditGesture(element, move);
    expect(isStudioManualEditGestureLiveIn(doc)).toBe(false);
  });

  // fails without the fix: a drag that ended after a newer gesture began skipped ending its own gesture, which then
  // held every reload after the newer one ended.
  it("lets a reload run once a superseded drag and the newer gesture have both ended", async () => {
    const { element, doc } = await title(mode);
    element.getBoundingClientRect = () => new DOMRect(100, 200, 40, 20);
    const made = createManualOffsetDragMember({
      key: "title",
      selection: { element } as never,
      element,
      rect: { left: 100, top: 200, width: 40, height: 20, editScaleX: 1, editScaleY: 1 },
    });
    if (!made.ok) throw new Error(made.reason);
    const edit = beginStudioManualEditGesture(element, "edit");
    const reload = vi.fn();
    afterStudioManualEditGestures(doc, reload);
    endManualOffsetDragMembers([made.member]);
    expect(isStudioManualEditGestureCurrent(element, edit)).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    endStudioManualEditGesture(element, edit);
    expect(isStudioManualEditGestureLiveIn(doc)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });
});
