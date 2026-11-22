// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { PausedFrameAsk } from "@hyperframes/core/runtime/editing-port";
import { pausedFrameHost } from "./pausedVideoProvider";
import type { PausedVideoDecoder } from "./pausedVideoDecoder";

const decoder = { decode: vi.fn(), suspend: vi.fn(async () => {}), dispose: vi.fn() };
const closers: Array<() => void> = [];
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

let lastId = 0;
function host() {
  const { port1, port2 } = new MessageChannel();
  const studio = pausedFrameHost(port1, "/api/projects/p1", {
    decoder: async () => decoder as unknown as PausedVideoDecoder,
    files: async () => new Set(["assets/a.mp4"]),
  });
  const replies: Array<Record<string, unknown>> = [];
  port2.onmessage = (event) => replies.push(event.data);
  closers.push(() => {
    studio.close();
    port2.close();
  });
  const decode = (asks: unknown[]) => port2.postMessage({ type: "decode", id: ++lastId, asks });
  return { replies, decode, port2 };
}
const at = (path: string, params: Record<string, string> = {}): PausedFrameAsk => ({
  path,
  params,
  time: 0,
});
const A = "/api/projects/p1/preview/assets/a.mp4";

it.each([
  ["a URL the frame names", "http://evil.test/api/projects/p1/preview/assets/a.mp4"],
  ["a host-relative URL", "//evil.test/api/projects/p1/preview/assets/a.mp4"],
  ["another project's file", "/api/projects/p2/preview/assets/a.mp4"],
  ["a path that climbs out", "/api/projects/p1/preview/assets/../../secret.mp4"],
  ["an encoded climb", "/api/projects/p1/preview/assets/%2e%2e/%2e%2e/secret.mp4"],
  ["a file the project does not have", "/api/projects/p1/preview/assets/b.mp4"],
])("refuses %s without reading anything", async (_, path) => {
  const { replies, decode } = host();
  decode([at(path)]);
  await vi.waitFor(() => expect(replies).toHaveLength(1));
  expect(replies[0]).toMatchObject({ type: "failed" });
  expect(decoder.decode).not.toHaveBeenCalled();
});

it("ignores an ask carrying any option but the proxy's", async () => {
  const { replies, decode, port2 } = host();
  decode([at(A, { url: "http://evil.test/x.mp4" })]);
  port2.postMessage({ type: "suspend", id: ++lastId });
  await vi.waitFor(() => expect(replies).toEqual([{ type: "suspended", id: lastId }]));
  expect(decoder.decode).not.toHaveBeenCalled();
});

it("refuses more sources than one decode may name, and a second decode while one runs", async () => {
  const { replies, decode } = host();
  decode([at(A), at(A), at(A), at(A), at(A)]);
  await vi.waitFor(() => expect(replies).toHaveLength(1));
  expect(replies[0]).toMatchObject({ type: "failed", message: "Preview decode over budget" });

  decoder.decode.mockReturnValue(new Promise(() => {}));
  decode([at(A)]);
  await vi.waitFor(() => expect(decoder.decode).toHaveBeenCalledOnce());
  decode([at(A)]);
  await vi.waitFor(() => expect(replies).toHaveLength(2));
  expect(replies[1]).toMatchObject({ type: "failed", message: "Preview decoder busy" });
  expect(decoder.decode).toHaveBeenCalledOnce();
});

it("refuses frames over the byte budget and releases them", async () => {
  vi.stubGlobal("createImageBitmap", vi.fn());
  const release = vi.fn();
  decoder.decode.mockResolvedValue([
    { source: {}, timestamp: 0, duration: 1, width: 8192, height: 8192, release },
  ]);
  const { replies, decode } = host();
  decode([at(A)]);
  await vi.waitFor(() => expect(replies).toHaveLength(1));
  expect(replies[0]).toMatchObject({ type: "failed", message: "Preview decode over budget" });
  expect(release).toHaveBeenCalledOnce();
  expect(createImageBitmap).not.toHaveBeenCalled();
});
