// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

vi.mock("../../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../player/lib/previewChannel")>()),
  previewFrameOpaque: () => true,
}));

import {
  afterStudioManualEditGestures,
  beginStudioManualEditGesture,
  countStudioManualEditSave,
  endStudioManualEditGesture,
  isStudioManualEditGestureLiveIn,
  studioManualEditSavesIn,
} from "./manualEditGesture";
import { gestureDocumentOf } from "./previewSelection";

const iframe = document.createElement("iframe");

it("holds a sealed preview's reload while a gesture runs on a stand-in, and lets it go when the gesture ends", () => {
  const doc = gestureDocumentOf(iframe)!;
  const standIn = doc.createElement("div");
  const released = vi.fn();

  const token = beginStudioManualEditGesture(standIn, "move");
  expect(isStudioManualEditGestureLiveIn(gestureDocumentOf(iframe)!)).toBe(true);
  afterStudioManualEditGestures(doc, released);

  endStudioManualEditGesture(standIn, token);
  expect(isStudioManualEditGestureLiveIn(gestureDocumentOf(iframe)!)).toBe(false);
  expect(released).toHaveBeenCalledOnce();
});

it("counts a sealed preview's gesture saves where its reload looks for them", async () => {
  const before = studioManualEditSavesIn(gestureDocumentOf(iframe)!);
  const standIn = gestureDocumentOf(iframe)!.createElement("div");

  await countStudioManualEditSave(standIn, async () => {});

  expect(studioManualEditSavesIn(gestureDocumentOf(iframe)!)).toBe(before + 2);
});

it("does not count a gesture on an element its own document no longer holds", () => {
  const live = document.createElement("div");
  document.body.append(live);
  beginStudioManualEditGesture(live, "move");
  live.remove();
  expect(isStudioManualEditGestureLiveIn(document)).toBe(false);
});
