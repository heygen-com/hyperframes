// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const channel = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../player/lib/previewChannel", () => ({
  previewFrameOpaque: () => true,
  previewRequest: channel.request,
}));
import { applyUndoRestoreToPreview } from "./gsapUndoRestore";

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

  // fails without the fix: the frame refuses an element GSAP has parsed, and the undo reloaded the preview.
  it("re-runs the unchanged script in place when the frame refuses an element GSAP has parsed", async () => {
    channel.request.mockImplementation(async (_frame, request) =>
      request === "restore-attributes" ? { applied: false } : { result: "applied" },
    );
    const { reload, iframe } = undo(box(90) + script("{ x: 1 }"), box(0) + script("{ x: 1 }"));
    await settled();
    expect(channel.request).toHaveBeenLastCalledWith(
      iframe,
      "soft-reload",
      expect.objectContaining({ script: expect.stringContaining("{ x: 1 }"), time: 2 }),
    );
    expect(channel.request.mock.lastCall![2].restore).toEqual([
      { file: null, elements: [BOX_AT_0] },
    ]);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads instead of re-running when a later undo was sent before the frame refused", async () => {
    let refuse: (reply: unknown) => void = () => {};
    channel.request.mockImplementation((_frame, request) =>
      request === "restore-attributes"
        ? new Promise((resolve) => (refuse = resolve))
        : Promise.resolve({ result: "applied" }),
    );
    const reload = vi.fn();
    const iframe = document.createElement("iframe");
    const files = (from: string, to: string) => ({
      "index.html": {
        previous: page(from + script("{ x: 1 }")),
        restored: page(to + script("{ x: 1 }")),
      },
    });
    applyUndoRestoreToPreview(iframe, null, files(box(90), box(0)), 2, reload);
    const first = refuse;
    applyUndoRestoreToPreview(iframe, null, files(box(0), box(50)), 2, reload);
    first({ applied: false });
    await settled();
    expect(channel.request).not.toHaveBeenCalledWith(iframe, "soft-reload", expect.anything());
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads when the frame refuses the attributes and the re-run of the unchanged script", async () => {
    channel.request.mockImplementation(async (_frame, request) =>
      request === "restore-attributes" ? { applied: false } : { result: "cannot-soft-reload" },
    );
    const { reload } = undo(box(90) + script("{ x: 1 }"), box(0) + script("{ x: 1 }"));
    await settled();
    await settled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads when the frame cannot re-run the changed script", async () => {
    channel.request.mockResolvedValue({ result: "cannot-soft-reload" });
    const { reload } = undo(box(90) + script("{ x: 1 }"), box(0) + script("{ x: 2 }"));
    await settled();
    expect(reload).toHaveBeenCalledOnce();
  });
});
