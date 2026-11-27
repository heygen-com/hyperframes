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

it("ignores more sources than one decode may name, and replaces a decode a newer one overtakes", async () => {
  const { replies, decode, port2 } = host();
  decode([at(A), at(A), at(A), at(A), at(A)]);
  decode(new Array(2 ** 32 - 1));
  port2.postMessage({ type: "suspend", id: ++lastId });
  await vi.waitFor(() => expect(replies).toEqual([{ type: "suspended", id: lastId }]));
  expect(decoder.decode).not.toHaveBeenCalled();

  decoder.decode.mockReturnValue(new Promise(() => {}));
  decode([at(A)]);
  const overtaken = lastId;
  await vi.waitFor(() => expect(decoder.decode).toHaveBeenCalledOnce());
  decode([at(A)]);
  await vi.waitFor(() => expect(replies).toHaveLength(2));
  expect(replies[1]).toEqual({ type: "failed", id: overtaken, message: "Preview decode replaced" });
  expect(decoder.decode.mock.calls[0]![1].aborted).toBe(true);
  expect(decoder.decode).toHaveBeenCalledOnce();
});

// fails without the fix: a scrub's newest frame was refused while the aborted one settled, so the preview showed black.
it("decodes the newest ask once an aborted decode settles, never two at once", async () => {
  let settle = (_frames: unknown[]) => {};
  decoder.decode.mockReturnValueOnce(new Promise((resolve) => (settle = resolve)));
  const { replies, decode, port2 } = host();
  decode([at(A)]);
  const first = lastId;
  await vi.waitFor(() => expect(decoder.decode).toHaveBeenCalledOnce());
  port2.postMessage({ type: "abort", id: first });
  decoder.decode.mockResolvedValueOnce([]);
  decode([at(A)]);
  const newest = lastId;
  port2.postMessage({ type: "suspend", id: ++lastId });
  await vi.waitFor(() => expect(replies).toEqual([{ type: "suspended", id: lastId }]));
  expect(decoder.decode).toHaveBeenCalledOnce();

  settle([]);
  await vi.waitFor(() =>
    expect(replies.at(-1)).toEqual({ type: "frames", id: newest, frames: [] }),
  );
  expect(decoder.decode).toHaveBeenCalledTimes(2);
  expect(replies.filter((reply) => reply.id === first)).toEqual([]);
});

it("answers a flood of 20 asks with 19 replaced and decodes only the newest, one call at a time", async () => {
  const held: Array<() => void> = [];
  let running = 0;
  let most = 0;
  decoder.decode.mockImplementation(() => {
    most = Math.max(most, ++running);
    return new Promise((resolve) =>
      held.push(() => {
        running -= 1;
        resolve([]);
      }),
    );
  });
  const { replies, decode } = host();
  for (let i = 0; i < 20; i += 1) decode([at(A)]);
  const newest = lastId;
  await vi.waitFor(() => expect(replies).toHaveLength(19));
  expect(replies.every((reply) => reply.message === "Preview decode replaced")).toBe(true);
  await vi.waitFor(() => expect(held).toHaveLength(1));
  held.shift()!();
  await vi.waitFor(() => expect(held).toHaveLength(1));
  held.shift()!();
  await vi.waitFor(() =>
    expect(replies.at(-1)).toEqual({ type: "frames", id: newest, frames: [] }),
  );
  expect(replies).toHaveLength(20);
  expect(decoder.decode).toHaveBeenCalledTimes(2);
  expect(most).toBe(1);
});

it("decodes the next ask after one whose decoder throws", async () => {
  decoder.decode.mockRejectedValueOnce(new Error("decoder broke"));
  const { replies, decode } = host();
  decode([at(A)]);
  const broken = lastId;
  await vi.waitFor(() => expect(replies).toHaveLength(1));
  expect(replies[0]).toEqual({ type: "failed", id: broken, message: "decoder broke" });
  decoder.decode.mockResolvedValueOnce([]);
  decode([at(A)]);
  await vi.waitFor(() =>
    expect(replies.at(-1)).toEqual({ type: "frames", id: lastId, frames: [] }),
  );
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
