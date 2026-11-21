// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const channel = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../player/lib/previewChannel", () => ({
  previewFrameOpaque: () => true,
  previewRequest: channel.request,
}));
import { applyUndoRestoreToPreview } from "./gsapUndoRestore";
import { onPreviewRestoredInPlace } from "../player/sceneSwap";

const page = (body: string) => `<html><body>${body}</body></html>`;
const box = (left: number) => `<div data-hf-id="box" style="left: ${left}px">t</div>`;
const script = (text: string) => `<script>gsap.timeline().to("#t", ${text});</script>`;

function undo(previous: string, restored: string) {
  const reload = vi.fn();
  const iframe = document.createElement("iframe");
  const files = { "index.html": { previous: page(previous), restored: page(restored) } };
  return { reload, strategy: applyUndoRestoreToPreview(iframe, null, files, 2, reload), iframe };
}

const BOX_AT_0 = {
  key: "hf:box",
  attributes: [
    ["data-hf-id", "box"],
    ["style", "left: 0px"],
  ],
};

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => channel.request.mockReset());

describe("undo on a sealed preview", () => {
  it("sends the restored attributes to the frame instead of reloading", async () => {
    channel.request.mockResolvedValue({ applied: true });
    const { reload, strategy, iframe } = undo(box(90), box(0));
    expect(strategy).toBe("soft");
    expect(channel.request).toHaveBeenCalledWith(iframe, "restore-attributes", {
      scopes: [
        {
          file: null,
          elements: [
            {
              key: "hf:box",
              attributes: [
                ["data-hf-id", "box"],
                ["style", "left: 0px"],
              ],
            },
          ],
        },
      ],
      scripted: false,
      time: 2,
    });
    await settled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads when the frame refuses or does not answer", async () => {
    for (const reply of [{ applied: false }, null]) {
      channel.request.mockResolvedValue(reply);
      const { reload } = undo(box(90), box(0));
      await settled();
      expect(reload).toHaveBeenCalledOnce();
    }
  });

  it("says the files keep a GSAP script when they do", () => {
    channel.request.mockResolvedValue({ applied: true });
    undo(box(90) + script("{ x: 1 }"), box(0) + script("{ x: 1 }"));
    expect(channel.request.mock.calls[0]![2]).toMatchObject({ scripted: true });
  });

  // fails without the fix: a sealed undo of a keyframe edit reloaded the whole preview.
  it.each([
    ["and the attributes it changed", box(90), [{ file: null, elements: [BOX_AT_0] }]],
    ["alone", box(0), []],
  ])("re-runs a changed script in the frame %s, in one request", async (_name, before, restore) => {
    channel.request.mockResolvedValue({ result: "applied" });
    const { reload, strategy, iframe } = undo(
      before + script("{ x: 1 }"),
      box(0) + script("{ x: 2 }"),
    );
    expect(strategy).toBe("soft");
    expect(channel.request).toHaveBeenCalledExactlyOnceWith(
      iframe,
      "soft-reload",
      expect.objectContaining({ script: expect.stringContaining("{ x: 2 }"), time: 2, restore }),
    );
    await settled();
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([
    ["the attributes it restored", { applied: true }, box(90), box(0)],
    [
      "the changed script it re-ran",
      { result: "applied" },
      box(0) + script("{ x: 1 }"),
      box(0) + script("{ x: 2 }"),
    ],
  ])("announces %s in place once", async (_name, reply, before, after) => {
    channel.request.mockResolvedValue(reply);
    let count = 0;
    const reload = vi.fn();
    const iframe = document.createElement("iframe");
    onPreviewRestoredInPlace(iframe, () => count++);
    const files = { "index.html": { previous: page(before), restored: page(after) } };
    expect(applyUndoRestoreToPreview(iframe, null, files, 2, reload)).toBe("soft");
    await settled();
    expect(count).toBe(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads when the frame cannot re-run the changed script", async () => {
    channel.request.mockResolvedValue({ result: "cannot-soft-reload" });
    const { reload, iframe } = undo(box(90) + script("{ x: 1 }"), box(0) + script("{ x: 2 }"));
    await settled();
    expect(reload).toHaveBeenCalledOnce();
    expect(channel.request).toHaveBeenCalledWith(iframe, "mark-scenes-stale", {
      files: ["index.html"],
    });
  });
});
