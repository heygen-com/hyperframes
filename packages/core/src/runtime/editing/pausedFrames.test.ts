// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  PAUSED_FRAME_SOURCES,
  parsePausedFrameAsk,
  pausedFrameAsk,
  portPausedVideoProvider,
} from "./pausedFrames";

const closers: Array<() => void> = [];
afterEach(() => closers.splice(0).forEach((close) => close()));
const video = () => document.createElement("video");

it("asks by path and the proxy's own options only, and never for another server's media", () => {
  const own = `${location.origin}/api/projects/p/preview/a.mp4?hf-proxy=h264&hf-proxy-box=640x360&token=x`;
  expect(pausedFrameAsk({ video: video(), source: own, time: 1 })).toEqual({
    path: "/api/projects/p/preview/a.mp4",
    params: { "hf-proxy": "h264", "hf-proxy-box": "640x360" },
    time: 1,
  });
  expect(
    pausedFrameAsk({ video: video(), source: "https://cdn.example/a.mp4", time: 1 }),
  ).toBeNull();
});

it("tells Studio when a decode is aborted, and rejects what is pending on dispose", async () => {
  const { port1, port2 } = new MessageChannel();
  closers.push(() => port2.close());
  const asked: Array<Record<string, unknown>> = [];
  port2.onmessage = (event) => asked.push(event.data);
  const provider = portPausedVideoProvider(port1);
  const control = new AbortController();
  const source = `${location.origin}/api/projects/p/preview/a.mp4`;
  const first = provider.decode([{ video: video(), source, time: 0 }], control.signal);
  await vi.waitFor(() => expect(asked).toHaveLength(1));
  control.abort();
  await expect(first).rejects.toThrow("Preview cancelled");
  await vi.waitFor(() => expect(asked[1]).toEqual({ type: "abort", id: 1 }));
  const second = provider.decode(
    [{ video: video(), source, time: 0 }],
    new AbortController().signal,
  );
  await vi.waitFor(() => expect(asked).toHaveLength(3));
  provider.dispose();
  await expect(second).rejects.toThrow("Preview cancelled");
  await vi.waitFor(() => expect(asked.at(-1)).toEqual({ type: "close" }));
});

const ask = { path: "/a.mp4", params: {}, time: 0 };

it("reads a decode of one up to the most sources one decode may name", () => {
  for (let n = 1; n <= PAUSED_FRAME_SOURCES; n++)
    expect(parsePausedFrameAsk({ type: "decode", id: 1, asks: Array(n).fill(ask) })).toEqual({
      type: "decode",
      id: 1,
      asks: Array(n).fill(ask),
    });
});

// fails without the fix: the parser walked every slot of a list the frame only declared long.
it("refuses at once a decode naming too many sources or a list with gaps", () => {
  const started = performance.now();
  for (const asks of [
    new Array(2 ** 32 - 1),
    Array(PAUSED_FRAME_SOURCES + 1).fill(ask),
    Object.assign(new Array(3), { 0: ask, 2: ask }),
  ])
    expect(parsePausedFrameAsk({ type: "decode", id: 1, asks })).toBeNull();
  expect(performance.now() - started).toBeLessThan(1000);
});

it("fails a decode of more sources than Studio reads without asking", async () => {
  const { port1, port2 } = new MessageChannel();
  closers.push(() => port2.close());
  const asked: unknown[] = [];
  port2.onmessage = (event) => asked.push(event.data);
  const provider = portPausedVideoProvider(port1);
  closers.push(() => provider.dispose());
  const source = `${location.origin}/api/projects/p/preview/a.mp4`;
  const requests = Array.from({ length: PAUSED_FRAME_SOURCES + 1 }, () => ({
    video: video(),
    source,
    time: 0,
  }));
  await expect(provider.decode(requests, new AbortController().signal)).rejects.toThrow(
    "Preview decode over budget",
  );
  expect(asked).toEqual([]);
});
