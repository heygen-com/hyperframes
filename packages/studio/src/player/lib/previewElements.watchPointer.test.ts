// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { watchPreviewPointer } from "./previewElements";
import { previewRequest } from "./previewChannel";
import { detachedFakeIframe, serveEditingRequests } from "../hooks/timelinePlayerTestHarness";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((clean) => clean()));

const TITLE = {
  handle: "0123456789abcdef:1",
  tag: "h1",
  rect: { x: 0, y: 0, width: 10, height: 10 },
};
const SUB = { ...TITLE, handle: "0123456789abcdef:2", tag: "h2" };
const seqOf = (params: unknown) => (params as { seq: number }).seq;

/** A frame Studio cannot script. `knowsWatch: false` answers `watch-pointer` as a runtime without it does. */
function sealedFrame({ knowsWatch }: { knowsWatch: boolean }) {
  const asked: unknown[] = [];
  let framePort: MessagePort | null = null;
  const onPort = (port: MessagePort) =>
    queueMicrotask(() => {
      framePort = port;
      const answer = port.onmessage!.bind(port);
      port.onmessage = (event: MessageEvent<{ id: number; kind: string; params: unknown }>) => {
        if (event.data.kind !== "watch-pointer") return answer(event);
        asked.push(event.data.params);
        if (knowsWatch) return answer(event);
        const { id } = event.data;
        port.postMessage({
          v: 2,
          id,
          ok: false,
          code: "unknown-kind",
          message: "unknown request kind",
        });
      };
    });
  const frame: Record<string, unknown> = {};
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  Object.defineProperty(frame, "document", {
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  cleanups.push(serveEditingRequests(frame, () => ({ watching: true }), onPort));
  /** `seq` undefined sends an untagged push, as a frame that does not echo it would. */
  const push = (target: unknown, seq?: number) =>
    framePort!.postMessage({
      v: 2,
      event: "pointer-targets",
      at: 1,
      target,
      stack: target ? [target] : [],
      ...(seq === undefined ? {} : { seq }),
    });
  return { iframe, asked, push };
}

it("hands on each answer the frame pushes, and sends the stop", async () => {
  const { iframe, asked, push } = sealedFrame({ knowsWatch: true });
  await previewRequest(iframe, "set-loop-start", { seconds: 0 });
  const answers: unknown[] = [];
  const watch = watchPreviewPointer(iframe, (answer) => answers.push(answer));
  watch.at(0.5, 0.25);
  await vi.waitFor(() =>
    expect(asked).toEqual([{ point: { x: 0.5, y: 0.25 }, seq: expect.any(Number) }]),
  );
  const seq = seqOf(asked[0]);
  push(TITLE, seq);
  push(null, seq);
  await vi.waitFor(() => expect(answers).toHaveLength(3));
  expect(answers).toEqual([
    "pending",
    { target: TITLE, stack: [TITLE] },
    { target: null, stack: [] },
  ]);
  watch.stop();
  await vi.waitFor(() => expect(asked).toHaveLength(2));
  expect(asked[1]).toEqual({ point: null });
  push(TITLE, seq);
  await previewRequest(iframe, "set-loop-start", { seconds: 0 });
  expect(answers).toHaveLength(3);
});

it("tells the caller a frame without the watch cannot push, so it asks instead", async () => {
  const { iframe } = sealedFrame({ knowsWatch: false });
  await previewRequest(iframe, "set-loop-start", { seconds: 0 });
  const answers: unknown[] = [];
  watchPreviewPointer(iframe, (answer) => answers.push(answer)).at(0.5, 0.5);
  await vi.waitFor(() => expect(answers).toEqual(["pending", "frame-cannot-watch"]));
});

it("passes on no push for an older point or an untagged one, so a press under B never takes A's answer", async () => {
  const { iframe, asked, push } = sealedFrame({ knowsWatch: true });
  await previewRequest(iframe, "set-loop-start", { seconds: 0 });
  const answers: unknown[] = [];
  const watch = watchPreviewPointer(iframe, (answer) => answers.push(answer));
  watch.at(0.1, 0.1);
  watch.at(0.9, 0.9);
  await vi.waitFor(() => expect(asked).toHaveLength(2));
  push(TITLE, seqOf(asked[0]));
  push(TITLE);
  push(SUB, seqOf(asked[1]));
  await vi.waitFor(() => expect(answers).toHaveLength(3));
  await previewRequest(iframe, "set-loop-start", { seconds: 0 });
  expect(answers).toEqual(["pending", "pending", { target: SUB, stack: [SUB] }]);
  watch.stop();
});

it("reports no failure for a watch the caller already stopped", async () => {
  const { iframe, asked } = sealedFrame({ knowsWatch: false });
  await previewRequest(iframe, "set-loop-start", { seconds: 0 });
  const answers: unknown[] = [];
  const watch = watchPreviewPointer(iframe, (answer) => answers.push(answer));
  watch.at(0.5, 0.5);
  watch.stop();
  await vi.waitFor(() => expect(asked).toHaveLength(2));
  await previewRequest(iframe, "set-loop-start", { seconds: 0 });
  expect(answers).toEqual(["pending"]);
});

it("gives a new watch none of a stopped watch's late pushes", async () => {
  const { iframe, asked, push } = sealedFrame({ knowsWatch: true });
  await previewRequest(iframe, "set-loop-start", { seconds: 0 });
  const old = watchPreviewPointer(iframe, () => {});
  old.at(0.1, 0.1);
  old.stop();
  const answers: unknown[] = [];
  watchPreviewPointer(iframe, (answer) => answers.push(answer)).at(0.9, 0.9);
  await vi.waitFor(() => expect(asked).toHaveLength(3));
  push(TITLE, seqOf(asked[0]));
  push(SUB, seqOf(asked[2]));
  await vi.waitFor(() => expect(answers).toHaveLength(2));
  await previewRequest(iframe, "set-loop-start", { seconds: 0 });
  expect(answers).toEqual(["pending", { target: SUB, stack: [SUB] }]);
});
