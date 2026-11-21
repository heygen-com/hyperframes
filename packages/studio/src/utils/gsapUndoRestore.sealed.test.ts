// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const channel = vi.hoisted(() => ({ request: vi.fn() }));
const PREVIEW_LOAD = vi.hoisted(() => ({}));
vi.mock("../player/lib/previewChannel", async () => {
  const { admittedAnswer } = await import("../../tests/previewAnswerMock");
  const PREVIEW_STALE = Symbol("preview-stale");
  return {
    previewFrameOpaque: () => true,
    previewEditingClient: () => PREVIEW_LOAD,
    previewRequest: channel.request,
    previewAnswer: admittedAnswer(channel.request, PREVIEW_STALE),
    PREVIEW_REJECTED: Symbol("preview-rejected"),
    PREVIEW_STALE,
  };
});
import { applyUndoRestoreToPreview } from "./gsapUndoRestore";
import { applySoftReload } from "./gsapSoftReload";
import { SAVED_STATE_DEADLINE_MS } from "./sealedPreviewLedger";
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
// A reload tells the frame its scenes are stale; that request is the reload's, not the restore's.
const sentToFrame = () =>
  channel.request.mock.calls
    .map(([, request, params]) => [request, params] as const)
    .filter(([request]) => request !== "mark-scenes-stale");

beforeEach(() => {
  channel.request.mockReset();
});

describe("undo on a sealed preview", () => {
  it("sends the restored attributes to the frame instead of reloading", async () => {
    channel.request.mockResolvedValue({ applied: true });
    const { reload, strategy, iframe } = undo(box(90), box(0));
    expect(strategy).toBe("soft");
    expect(channel.request).toHaveBeenCalledWith(
      iframe,
      "restore-attributes",
      {
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
      },
      SAVED_STATE_DEADLINE_MS,
    );
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
      restore.length > 0 ? SAVED_STATE_DEADLINE_MS : undefined,
    );
    await settled();
    expect(reload).not.toHaveBeenCalled();
  });

  // fails without the fix: the frame refused an element GSAP has parsed, and the undo reloaded the preview.
  it("carries the script re-run in the restore request when the file keeps a script", async () => {
    channel.request.mockResolvedValue({ applied: true });
    const { reload, strategy, iframe } = undo(
      box(90) + script("{ x: 1 }"),
      box(0) + script("{ x: 1 }"),
    );
    expect(strategy).toBe("soft");
    expect(channel.request).toHaveBeenCalledExactlyOnceWith(
      iframe,
      "restore-attributes",
      {
        scopes: [{ file: null, elements: [BOX_AT_0] }],
        scripted: true,
        time: 2,
        rerun: {
          script: expect.stringContaining("{ x: 1 }"),
          sets: [],
          authored: expect.any(Array),
          timing: [],
        },
      },
      SAVED_STATE_DEADLINE_MS,
    );
    await settled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("sends no re-run when the files have no script", () => {
    channel.request.mockResolvedValue({ applied: true });
    undo(box(90), box(0));
    expect(channel.request.mock.calls[0]![2]).not.toHaveProperty("rerun");
  });

  // fails without the fix: a late refusal re-ran the undo's older script over an edit sent meanwhile.
  it("leaves an edit sent while the restore waits, and the playhead it was sent at", async () => {
    let answer: (reply: unknown) => void = () => {};
    channel.request.mockImplementation((_frame, request) =>
      request === "restore-attributes"
        ? new Promise((resolve) => (answer = resolve))
        : Promise.resolve({ result: "applied" }),
    );
    const { reload, iframe } = undo(box(90) + script("{ x: 1 }"), box(0) + script("{ x: 1 }"));
    const edit = page(box(0) + script("{ x: 9 }"));
    applySoftReload(iframe, 'gsap.timeline().to("#t", { x: 9 });', {
      currentTimeOverride: 3,
      authoredHtml: edit,
      previousHtml: page(box(0) + script("{ x: 1 }")),
    });
    answer({ applied: false });
    await settled();
    expect(sentToFrame().map(([request, params]) => [request, params.time])).toEqual([
      ["restore-attributes", 2],
      ["soft-reload", 3],
    ]);
    expect(reload).toHaveBeenCalledOnce();
  });

  // fails without the fix: a reply lost to a new preview load re-ran the undo into that load.
  it("sends nothing more after a reply a new preview load lost", async () => {
    channel.request.mockResolvedValue(null);
    const { reload } = undo(box(90) + script("{ x: 1 }"), box(0) + script("{ x: 1 }"));
    await settled();
    expect(sentToFrame().map(([request]) => request)).toEqual(["restore-attributes"]);
    expect(reload).toHaveBeenCalledOnce();
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

  // fails without the fix: a request that timed out reloaded over a newer run already shown.
  it.each([
    ["no newer run was sent for its timeline", false, 1],
    ["a newer run on its timeline was sent", true, 0],
  ])("reloads a timed-out re-run only when %s", async (_name, newer, reloads) => {
    const late: Array<(reply: unknown) => void> = [];
    channel.request.mockImplementation(() => new Promise((resolve) => late.push(resolve)));
    const iframe = document.createElement("iframe");
    const reload = vi.fn();
    const run = (x: number, onAsyncFailure?: () => void) =>
      applySoftReload(
        iframe,
        `window.__timelines["main"] = gsap.timeline().to("#t", { x: ${x} });`,
        {
          currentTimeOverride: 1,
          authoredHtml: page(box(0)),
          previousHtml: page(box(0)),
          onAsyncFailure,
        },
      );
    run(1, reload);
    if (newer) run(2);
    late[0]!(null);
    await settled();
    expect(reload).toHaveBeenCalledTimes(reloads);
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
