// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ELEMENT_TEXT,
  MAX_ELEMENT_VALUE,
  MAX_STAGE_CLIP_KEYS,
  MAX_STAGE_ITEMS,
  type StageMeasuredItem,
} from "@hyperframes/core/runtime/editing-port";
import { detachedFakeIframe, serveEditingRequests } from "../hooks/timelinePlayerTestHarness";
import { measurePreviewStage, readStageMeasuredItem } from "./previewStageMeasure";

const closers: Array<() => void> = [];
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  document.body.innerHTML = "";
});

function opaqueFrame(answer: (kind: string, params: unknown) => unknown) {
  const frame: Record<string, unknown> = { postMessage: () => {} };
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  Object.defineProperty(frame, "document", {
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const handed = vi.fn(answer);
  closers.push(serveEditingRequests(frame, handed));
  return { iframe, handed };
}

function validItem(extra: Partial<StageMeasuredItem> = {}): StageMeasuredItem {
  return {
    key: "hf-title",
    hfId: "hf-title",
    id: "title",
    tag: "h1",
    parent: "0",
    text: "Hello",
    box: { x: 10, y: 20, width: 200, height: 40 },
    fontSize: "48px",
    color: "rgb(255, 255, 255)",
    background: "rgba(0, 0, 0, 0)",
    placed: true,
    visible: true,
    clipKeys: ["index.html#title"],
    hasElementChildren: false,
    textStart: { x: 10, y: 40 },
    hasBackgroundImage: false,
    ...extra,
  };
}

describe("readStageMeasuredItem", () => {
  it("accepts a valid wire item, strips extra properties, and rejects malformed fields", () => {
    const withExtra = { ...validItem(), unexpected: "dropped" };
    expect(readStageMeasuredItem(withExtra)).toEqual(validItem());
    expect(
      readStageMeasuredItem(validItem({ textStart: null, hfId: null, id: null, parent: null })),
    ).toEqual(validItem({ textStart: null, hfId: null, id: null, parent: null }));
    for (const bad of [
      null,
      [],
      validItem({ key: "" }),
      validItem({ key: "k".repeat(MAX_ELEMENT_VALUE + 1) }),
      validItem({ tag: "" }),
      validItem({ text: "t".repeat(MAX_ELEMENT_TEXT + 1) }),
      validItem({ box: { x: Number.NaN, y: 0, width: 10, height: 10 } }),
      validItem({ box: { x: 0, y: Number.POSITIVE_INFINITY, width: 10, height: 10 } }),
      validItem({ textStart: { x: Number.NaN, y: 0 } }),
      validItem({ placed: "yes" as never }),
      validItem({ visible: 1 as never }),
      validItem({ hasElementChildren: undefined as never }),
      validItem({ hasBackgroundImage: null as never }),
      validItem({ clipKeys: [""] }),
      validItem({
        clipKeys: Array.from({ length: MAX_STAGE_CLIP_KEYS + 1 }, (_, i) => `index.html#c${i}`),
      }),
    ]) {
      expect(readStageMeasuredItem(bad)).toBeNull();
    }
  });
});

describe("measurePreviewStage", () => {
  it("round-trips a bounded stage snapshot over the editing port", async () => {
    const item = validItem();
    const { iframe, handed } = opaqueFrame(() => ({ items: [item], truncated: false }));
    const result = await measurePreviewStage(iframe, { maxItems: 50 });
    expect(result).toEqual({ items: [item], truncated: false });
    expect(handed).toHaveBeenCalledWith("stage-measure", { maxItems: 50 });
  });

  it("refuses out-of-range maxItems without sending a request", async () => {
    const { iframe, handed } = opaqueFrame(() => ({ items: [], truncated: false }));
    expect(await measurePreviewStage(iframe, { maxItems: 0 })).toBeNull();
    expect(await measurePreviewStage(iframe, { maxItems: MAX_STAGE_ITEMS + 1 })).toBeNull();
    expect(await measurePreviewStage(iframe, { maxItems: 1.5 })).toBeNull();
    expect(handed).not.toHaveBeenCalled();
  });

  it("returns null when the frame returns more items than requested or a malformed entry", async () => {
    const oversized = opaqueFrame(() => ({ items: [validItem(), validItem()], truncated: false }));
    expect(await measurePreviewStage(oversized.iframe, { maxItems: 1 })).toBeNull();

    const malformed = opaqueFrame(() => ({
      items: [validItem({ box: { x: Number.NaN, y: 0, width: 1, height: 1 } })],
      truncated: false,
    }));
    expect(await measurePreviewStage(malformed.iframe)).toBeNull();

    const badFlag = opaqueFrame(() => ({ items: [validItem()], truncated: "no" }));
    expect(await measurePreviewStage(badFlag.iframe)).toBeNull();
  });
});
