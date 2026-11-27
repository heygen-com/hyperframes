// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_STAGE_ACTS } from "@hyperframes/core/runtime/editing-port";
import { detachedFakeIframe, serveEditingRequests } from "../hooks/timelinePlayerTestHarness";
import { previewEditingClient } from "./previewChannel";
import {
  holdPreviewStage,
  onPreviewStageActReady,
  onPreviewStageInput,
  previewStageDrawer,
  readyPreviewStage,
  restorePreviewStage,
} from "./previewStageAct";

const closers: Array<() => void> = [];
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  document.body.innerHTML = "";
});

function opaqueFrame(
  answer: (kind: string, params: unknown) => unknown,
  onPort?: (port: MessagePort) => void,
) {
  const frame: Record<string, unknown> = { postMessage: () => {} };
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  const handed = vi.fn(answer);
  closers.push(serveEditingRequests(frame, handed, onPort));
  return { iframe, handed };
}

const rect = { x: 1, y: 2, width: 30, height: 40 };
const held = (key: string) => ({ key, rect, textStart: null, chars: 0 });
const act = (key: string) => ({
  key,
  hfId: key,
  borrow: ["opacity" as const],
  draw: { styles: { opacity: "0" } },
});
const opts = { deferred: false, caretColor: "#3ce6ac" };

describe("holdPreviewStage", () => {
  it("returns what the frame held for the keys it asked", async () => {
    const { iframe, handed } = opaqueFrame(() => ({ op: "hold", held: [held("a")] }));
    expect(await holdPreviewStage(iframe, [act("a"), act("b")], opts)).toEqual([held("a")]);
    expect(handed).toHaveBeenCalledWith("stage-act", {
      op: "hold",
      acts: [act("a"), act("b")],
      ...opts,
    });
  });

  it.each([
    ["another op's reply", { op: "frame", held: [held("a")] }],
    ["a key it did not ask", { op: "hold", held: [held("z")] }],
    ["more entries than asked", { op: "hold", held: [held("a"), held("a")] }],
    ["a non-finite box", { op: "hold", held: [{ ...held("a"), rect: { ...rect, x: Infinity } }] }],
    ["a negative char count", { op: "hold", held: [{ ...held("a"), chars: -1 }] }],
    ["no list", { op: "hold", held: "a" }],
  ])("is null for %s", async (_, reply) => {
    const { iframe } = opaqueFrame(() => reply);
    expect(await holdPreviewStage(iframe, [act("a")], opts)).toBeNull();
  });

  it("gives back a hold the frame answers too late", async () => {
    const ops: string[] = [];
    let port!: MessagePort;
    const { iframe } = opaqueFrame(
      () => null,
      (p) => (port = p),
    );
    previewEditingClient(iframe);
    await vi.waitFor(() => expect(port).toBeDefined());
    port.onmessage = (event: MessageEvent<{ id: number; params: { op: string } }>) => {
      const { id, params } = event.data;
      ops.push(params.op);
      if (params.op === "hold") return;
      port.postMessage({ v: 1, id, ok: true, result: { op: "restore", restored: 1 } });
    };
    expect(await holdPreviewStage(iframe, [act("a")], { ...opts, timeoutMs: 10 })).toBeNull();
    await vi.waitFor(() => expect(ops).toEqual(["hold", "restore"]));
  });

  it("sends nothing over the cap", async () => {
    const { iframe, handed } = opaqueFrame(() => ({ op: "hold", held: [] }));
    expect(
      await holdPreviewStage(iframe, Array(MAX_STAGE_ACTS + 1).fill(act("a")), opts),
    ).toBeNull();
    expect(handed).not.toHaveBeenCalledWith("stage-act", expect.anything());
  });
});

describe("ready and restore", () => {
  it("reads each reply against what was asked", async () => {
    const replies: Record<string, unknown> = {
      ready: { op: "ready", held: [held("a")] },
      restore: { op: "restore", restored: 1 },
    };
    const { iframe } = opaqueFrame((_, params) => replies[(params as { op: string }).op]);
    expect(await readyPreviewStage(iframe, ["a"])).toEqual([held("a")]);
    expect(await restorePreviewStage(iframe, ["a"])).toBe(1);
  });

  it("is null when the frame gives back more than asked", async () => {
    const { iframe } = opaqueFrame(() => ({ op: "restore", restored: 2 }));
    expect(await restorePreviewStage(iframe, ["a"])).toBeNull();
  });
});

describe("previewStageDrawer", () => {
  it("sends one parent frame's draws together, keeps one request out, and folds draws made meanwhile", async () => {
    const asked: unknown[] = [];
    let port!: MessagePort;
    const { iframe } = opaqueFrame(
      () => null,
      (p) => (port = p),
    );
    const rects = vi.fn();
    const drawer = previewStageDrawer(iframe, rects);
    previewEditingClient(iframe);
    await vi.waitFor(() => expect(port).toBeDefined());
    const replies: Array<() => void> = [];
    port.onmessage = (
      event: MessageEvent<{ id: number; params: { draws: { key: string }[] } }>,
    ) => {
      const { id, params } = event.data;
      asked.push(params);
      const result = { op: "frame", rects: params.draws.map(({ key }) => ({ key, rect })) };
      replies.push(() => port.postMessage({ v: 1, id, ok: true, result }));
    };

    drawer.draw("a", { scale: 1 });
    drawer.draw("b", { styles: { opacity: "0.2" } });
    drawer.flush();
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    drawer.draw("a", { scale: 2 });
    drawer.flush();
    drawer.draw("a", { translate: [1, 1] });
    drawer.draw("b", { styles: { color: "rgb(1, 2, 3)" } });
    drawer.flush();
    expect(asked).toHaveLength(1);

    replies.shift()!();
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    expect(rects).toHaveBeenCalledWith(
      new Map([
        ["a", rect],
        ["b", rect],
      ]),
    );
    expect(asked).toEqual([
      {
        op: "frame",
        draws: [
          { key: "a", draw: { scale: 1 } },
          { key: "b", draw: { styles: { opacity: "0.2" } } },
        ],
      },
      {
        op: "frame",
        draws: [
          { key: "a", draw: { scale: 2, translate: [1, 1] } },
          { key: "b", draw: { styles: { color: "rgb(1, 2, 3)" } } },
        ],
      },
    ]);
  });

  it("sends draws past the cap in the next request instead of dropping them", async () => {
    const sent: number[] = [];
    const { iframe } = opaqueFrame((_, params) => {
      sent.push((params as { draws: unknown[] }).draws.length);
      return { op: "frame", rects: [] };
    });
    const drawer = previewStageDrawer(iframe, () => {});
    for (let i = 0; i <= MAX_STAGE_ACTS; i += 1) drawer.draw(`k${i}`, { scale: 1 });
    drawer.flush();
    await vi.waitFor(() => expect(sent).toEqual([MAX_STAGE_ACTS, 1]));
  });

  it("drops boxes for keys it did not draw", async () => {
    const { iframe } = opaqueFrame(() => ({ op: "frame", rects: [{ key: "z", rect }] }));
    const rects = vi.fn();
    const drawer = previewStageDrawer(iframe, rects);
    drawer.draw("a", { scale: 1 });
    drawer.flush();
    await vi.waitFor(() => expect(rects).toHaveBeenCalledWith(new Map()));
  });
});

describe("frame events", () => {
  it("passes on only deferred holds the parent asked for, and the person's input", async () => {
    let port!: MessagePort;
    const { iframe } = opaqueFrame(
      () => ({ op: "restore", restored: 0 }),
      (p) => (port = p),
    );
    const ready = vi.fn();
    const input = vi.fn();
    onPreviewStageActReady(iframe, new Set(["a"]), ready);
    onPreviewStageInput(iframe, input);
    await restorePreviewStage(iframe, null);
    port.postMessage({ v: 1, event: "stage-act-ready", held: [held("z")] });
    port.postMessage({ v: 1, event: "stage-act-ready", held: [held("a"), held("z")] });
    port.postMessage({
      v: 1,
      event: "stage-input",
      type: "keydown",
      key: "Escape",
      metaKey: false,
      ctrlKey: false,
    });
    await vi.waitFor(() => expect(input).toHaveBeenCalledTimes(1));
    expect(ready.mock.calls).toEqual([[[held("a")]]]);
    expect(input).toHaveBeenCalledWith({
      v: 1,
      event: "stage-input",
      type: "keydown",
      key: "Escape",
      metaKey: false,
      ctrlKey: false,
    });
  });
});
