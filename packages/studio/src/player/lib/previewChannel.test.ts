// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_PROBE_MS,
  previewClipManifest,
  previewEditingClient,
  previewFrameOpaque,
  previewSeekPainted,
  setFrameLoopStart,
} from "./previewChannel";
import { bridgePlaybackAdapter, watchPreviewFrame } from "./bridgePlayback";
import { runtimeProtocolMetadata } from "@hyperframes/core/runtime/protocol";
import { resolveFramePlaybackAdapter } from "../hooks/playbackAdapterResolution";
import { detachedFakeIframe, serveEditingRequests } from "../hooks/timelinePlayerTestHarness";

const closers: Array<() => void> = [];
afterEach(() => closers.splice(0).forEach((close) => close()));

/** A frame on another origin: any read of its window throws, as a browser's does. */
function opaqueFrame() {
  const posted: unknown[] = [];
  const postMessage = (message: unknown) => posted.push(message);
  const frame = new Proxy({} as Record<string, unknown>, {
    get: (_target, key) => {
      if (key === "postMessage") return postMessage;
      throw new DOMException(`blocked read of ${String(key)}`, "SecurityError");
    },
  });
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  Object.defineProperty(iframe, "contentWindow", { value: frame });
  Object.defineProperty(iframe, "contentDocument", { value: null });
  return { iframe, frame, posted };
}

/** Posts from `frame` as its runtime does, from an opaque origin unless told otherwise. */
function fromFrame(frame: object, data: Record<string, unknown>, origin = "null") {
  const source = frame as Window;
  window.dispatchEvent(
    new MessageEvent("message", { source, origin, data: { source: "hf-preview", ...data } }),
  );
}

/** A fake frame, same-origin unless `opaque`, whose runtime answers editing requests with `answer`. */
function servedFrame(answer: (kind: string, params: unknown) => unknown, opaque = false) {
  const frame: Record<string, unknown> = {};
  const iframe = detachedFakeIframe(frame);
  if (opaque) {
    Object.defineProperty(iframe, "contentDocument", { value: null });
    Object.defineProperty(frame, "document", {
      get: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  }
  const handed = vi.fn(answer);
  closers.push(serveEditingRequests(frame, handed));
  return { iframe, frame, handed };
}

describe("previewFrameOpaque", () => {
  it("is true only for a frame whose window refuses a read", () => {
    expect(previewFrameOpaque(document.body.appendChild(document.createElement("iframe")))).toBe(
      false,
    );
    expect(previewFrameOpaque(document.createElement("iframe"))).toBe(false);
    expect(previewFrameOpaque(opaqueFrame().iframe)).toBe(true);
    // A window that answers reads is not opaque, even with no document to hand.
    const readable = document.createElement("iframe");
    Object.defineProperty(readable, "contentWindow", { value: {} });
    expect(previewFrameOpaque(readable)).toBe(false);
  });
});

describe("previewEditingClient", () => {
  it("keeps one client per frame load and opens a fresh one after the frame loads again", async () => {
    const { iframe, handed } = servedFrame(() => ({ waited: false }));
    const first = previewEditingClient(iframe);
    expect(previewEditingClient(iframe)).toBe(first);
    iframe.dispatchEvent(new Event("load"));
    await expect(first.request("wait-for-seek", {})).rejects.toMatchObject({ code: "disposed" });
    const second = previewEditingClient(iframe);
    expect(second).not.toBe(first);
    await expect(second.request("wait-for-seek", {})).resolves.toEqual({ waited: false });
    expect(handed).toHaveBeenCalledOnce();
  });

  it("sends an opaque frame's loop start over the port, only when it changes", async () => {
    const seen: unknown[] = [];
    const { iframe } = servedFrame((_kind, params) => {
      seen.push((params as { seconds: unknown }).seconds);
      return { applied: true };
    }, true);
    setFrameLoopStart(iframe, 2);
    setFrameLoopStart(iframe, 2);
    setFrameLoopStart(iframe, null);
    await vi.waitFor(() => expect(seen).toEqual([2, null]));
  });

  it("calls a scriptable frame's own loop-start hook and never opens a port", async () => {
    const { iframe, frame, handed } = servedFrame(() => ({ applied: true }));
    const setLoopStart = vi.fn();
    frame.__hf = { setLoopStart };
    setFrameLoopStart(iframe, 2);
    setFrameLoopStart(iframe, 2);
    expect(setLoopStart.mock.calls).toEqual([[2], [2]]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handed).not.toHaveBeenCalled();
    delete frame.__hf;
    expect(() => setFrameLoopStart(iframe, null)).not.toThrow();
  });

  it("waits for the runtime's seek to paint, and settles anyway when no runtime answers", async () => {
    const { iframe, handed } = servedFrame(() => ({ waited: true }));
    await previewSeekPainted(iframe);
    expect(handed).toHaveBeenCalledWith("wait-for-seek", {});
    const started = Date.now();
    await previewSeekPainted(opaqueFrame().iframe, 15_000);
    expect(Date.now() - started).toBeLessThan(AGENT_PROBE_MS + 500);
  });

  it("returns the runtime's manifest only when its reply has the manifest's shape", async () => {
    const manifest = { clips: [], durationInFrames: 30, scenes: [] };
    let reply: unknown = { clipManifest: manifest };
    const { iframe } = servedFrame(() => reply);
    expect(await previewClipManifest(iframe)).toEqual(manifest);
    for (const bad of [
      null,
      { clipManifest: "x" },
      { clipManifest: { clips: {}, durationInFrames: 30 } },
      { clipManifest: { clips: [], durationInFrames: "30" } },
    ]) {
      reply = bad;
      expect(await previewClipManifest(iframe)).toBeNull();
    }
    reply = { clipManifest: { clips: [], durationInFrames: Infinity } };
    expect(await previewClipManifest(iframe)).toBeNull();
  });
});

describe("bridge playback for a frame Studio cannot script", () => {
  const refs = () => ({ cache: { current: null }, warned: { current: false } });

  it("drives the runtime with control messages and never reads the frame's window", () => {
    const { iframe, posted } = opaqueFrame();
    const adapter = resolveFramePlaybackAdapter(iframe, refs());
    expect(adapter).not.toBeNull();
    adapter!.play();
    adapter!.seek(4);
    adapter!.pause();
    expect(posted).toEqual([
      expect.objectContaining({ source: "hf-parent", type: "control", action: "play" }),
      expect.objectContaining({ action: "seek", timeSeconds: 4 }),
      expect.objectContaining({ action: "pause" }),
    ]);
    expect(adapter!.getTime()).toBe(4);
    expect(adapter!.isPlaying()).toBe(false);
  });

  it("keeps a seek until the runtime confirms it, so a state posted before it cannot undo it", () => {
    const { iframe, frame } = opaqueFrame();
    const adapter = bridgePlaybackAdapter(iframe)!;
    const clock = vi.spyOn(performance, "now").mockReturnValue(1_000);
    try {
      adapter.seek(4);
      fromFrame(frame, { type: "state", currentTime: 1, isPlaying: false });
      expect(adapter.getTime()).toBe(4);
      fromFrame(frame, { type: "state", currentTime: 4, isPlaying: false });
      fromFrame(frame, { type: "state", currentTime: 4.5, isPlaying: true });
      expect(adapter.getTime()).toBe(4.5);
      adapter.seek(99);
      clock.mockReturnValue(2_000);
      fromFrame(frame, { type: "state", currentTime: 12, isPlaying: false });
      expect(adapter.getTime()).toBe(12);
    } finally {
      clock.mockRestore();
    }
  });

  it("takes a seek the runtime landed on the frame before it, and plays on", () => {
    const { iframe, frame } = opaqueFrame();
    const adapter = bridgePlaybackAdapter(iframe)!;
    const at30fps = runtimeProtocolMetadata(30);
    adapter.seek(4.01);
    fromFrame(frame, { type: "state", currentTime: 4, isPlaying: true, ...at30fps });
    expect(adapter.getTime()).toBe(4);
    expect(adapter.isPlaying()).toBe(true);
    fromFrame(frame, { type: "state", currentTime: 4.3, isPlaying: true, ...at30fps });
    expect(adapter.getTime()).toBe(4.3);
  });

  it("ignores a post from a window it was not built for, or from an origin its frame cannot have", () => {
    const opaque = opaqueFrame();
    const adapter = bridgePlaybackAdapter(opaque.iframe)!;
    const stranger = opaqueFrame();
    fromFrame(stranger.frame, { type: "state", currentTime: 9, isPlaying: true });
    fromFrame(opaque.frame, { type: "state", currentTime: 8, isPlaying: true }, location.origin);
    fromFrame(
      opaque.frame,
      { type: "state", currentTime: 7, isPlaying: true },
      "https://example.com",
    );
    expect(adapter.getTime()).toBe(0);
    // A post from a frame nobody registered is dropped, not kept for a later adapter.
    expect(bridgePlaybackAdapter(stranger.iframe)!.getTime()).toBe(0);
    fromFrame(opaque.frame, { type: "state", currentTime: 2, isPlaying: false });
    expect(adapter.getTime()).toBe(2);

    const sameOrigin = document.createElement("iframe");
    sameOrigin.src = "/preview/index.html";
    const frame = {};
    Object.defineProperty(sameOrigin, "contentWindow", { value: frame });
    watchPreviewFrame(sameOrigin);
    const own = bridgePlaybackAdapter(sameOrigin)!;
    fromFrame(frame, { type: "state", currentTime: 5, isPlaying: false }, "null");
    expect(own.getTime()).toBe(0);
    fromFrame(frame, { type: "state", currentTime: 5, isPlaying: false }, location.origin);
    expect(own.getTime()).toBe(5);
  });

  it.each([
    ["srcdoc", (f: HTMLIFrameElement) => f.setAttribute("srcdoc", "<p>x</p>"), location.origin],
    [
      "about:blank",
      (f: HTMLIFrameElement) => f.setAttribute("src", "about:blank"),
      location.origin,
    ],
    ["a data: URL", (f: HTMLIFrameElement) => f.setAttribute("src", "data:text/html,x"), "null"],
    [
      "another origin",
      (f: HTMLIFrameElement) => f.setAttribute("src", "https://a.test/p"),
      "https://a.test",
    ],
  ])("accepts a frame loading %s only from the origin it has", (_name, load, origin) => {
    const iframe = document.createElement("iframe");
    load(iframe);
    const frame = {};
    Object.defineProperty(iframe, "contentWindow", { value: frame });
    const adapter = bridgePlaybackAdapter(iframe)!;
    const wrong = origin === "null" ? location.origin : "null";
    fromFrame(frame, { type: "state", currentTime: 3, isPlaying: false }, wrong);
    expect(adapter.getTime()).toBe(0);
    fromFrame(frame, { type: "state", currentTime: 3, isPlaying: false }, origin);
    expect(adapter.getTime()).toBe(3);
  });

  it("takes time, play state and duration from its own frame's state and timeline messages", () => {
    const { iframe, frame } = opaqueFrame();
    const other = opaqueFrame();
    const adapter = bridgePlaybackAdapter(iframe)!;
    fromFrame(frame, { type: "timeline", durationSeconds: 12, clips: [] });
    fromFrame(frame, { type: "state", currentTime: 3.5, isPlaying: true });
    fromFrame(other.frame, { type: "state", currentTime: 9, isPlaying: false });
    fromFrame(frame, { type: "state", currentTime: Number.NaN, isPlaying: true });
    expect(adapter.getDuration()).toBe(12);
    expect(adapter.getTime()).toBe(3.5);
    expect(adapter.isPlaying()).toBe(true);
  });
});
