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
  const push = (target: unknown) =>
    framePort!.postMessage({
      v: 2,
      event: "pointer-targets",
      at: 1,
      target,
      stack: target ? [target] : [],
    });
  return { iframe, asked, push };
}

it("hands on each answer the frame pushes, and sends the stop", async () => {
  const { iframe, asked, push } = sealedFrame({ knowsWatch: true });
  await previewRequest(iframe, "set-loop-start", { seconds: 0 });
  const answers: unknown[] = [];
  const watch = watchPreviewPointer(iframe, (answer) => answers.push(answer));
  watch.at(0.5, 0.25);
  await vi.waitFor(() => expect(asked).toEqual([{ point: { x: 0.5, y: 0.25 } }]));
  push(TITLE);
  push(null);
  await vi.waitFor(() => expect(answers).toHaveLength(2));
  expect(answers).toEqual([
    { target: TITLE, stack: [TITLE] },
    { target: null, stack: [] },
  ]);
  watch.stop();
  await vi.waitFor(() => expect(asked).toHaveLength(2));
  expect(asked[1]).toEqual({ point: null });
  push(TITLE);
  await new Promise((done) => setTimeout(done, 20));
  expect(answers).toHaveLength(2);
});

it("tells the caller a frame without the watch cannot push, so it asks instead", async () => {
  const { iframe } = sealedFrame({ knowsWatch: false });
  await previewRequest(iframe, "set-loop-start", { seconds: 0 });
  const answers: unknown[] = [];
  watchPreviewPointer(iframe, (answer) => answers.push(answer)).at(0.5, 0.5);
  await vi.waitFor(() => expect(answers).toEqual(["frame-cannot-watch"]));
});
