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

  it("says the files keep a GSAP script, and reloads at once when the script itself changed", () => {
    channel.request.mockResolvedValue({ applied: true });
    undo(box(90) + script("{ x: 1 }"), box(0) + script("{ x: 1 }"));
    expect(channel.request.mock.calls[0]![2]).toMatchObject({ scripted: true });
    channel.request.mockReset();
    const { reload, strategy, iframe } = undo(
      box(90) + script("{ x: 1 }"),
      box(0) + script("{ x: 2 }"),
    );
    expect(strategy).toBe("full");
    expect(reload).toHaveBeenCalledOnce();
    expect(channel.request).toHaveBeenCalledExactlyOnceWith(iframe, "mark-scenes-stale", {
      files: ["index.html"],
    });
  });
});
