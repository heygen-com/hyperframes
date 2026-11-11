// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  previewClipManifest,
  previewEditingClient,
  previewFrameScriptable,
  previewSeekPainted,
  setPreviewLoopStart,
} from "./previewChannel";
import { bridgePlaybackAdapter } from "./bridgePlayback";
import { resolveFramePlaybackAdapter } from "../hooks/playbackAdapterResolution";
import { makeFakeIframe, serveEditingRequests } from "../hooks/timelinePlayerTestHarness";

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
  Object.defineProperty(iframe, "contentWindow", { value: frame });
  Object.defineProperty(iframe, "contentDocument", { value: null });
  return { iframe, frame, posted };
}

function fromFrame(frame: object, data: Record<string, unknown>) {
  const source = frame as Window;
  window.dispatchEvent(
    new MessageEvent("message", { source, data: { source: "hf-preview", ...data } }),
  );
}

/** A same-origin fake frame whose runtime answers editing requests with `answer`. */
function servedFrame(answer: (kind: string, params: unknown) => unknown) {
  const frame: Record<string, unknown> = {};
  const iframe = makeFakeIframe(frame);
  const handed = vi.fn(answer);
  closers.push(serveEditingRequests(frame, handed));
  return { iframe, handed };
}

describe("previewFrameScriptable", () => {
  it("is true for a same-origin frame and false for one whose document is out of reach", () => {
    expect(
      previewFrameScriptable(document.body.appendChild(document.createElement("iframe"))),
    ).toBe(true);
    expect(previewFrameScriptable(opaqueFrame().iframe)).toBe(false);
    const throwing = document.createElement("iframe");
    Object.defineProperty(throwing, "contentDocument", {
      get: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(previewFrameScriptable(throwing)).toBe(false);
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

  it("sends the loop start only when it changes", async () => {
    const seen: unknown[] = [];
    const { iframe } = servedFrame((_kind, params) => {
      seen.push((params as { seconds: unknown }).seconds);
      return { applied: true };
    });
    setPreviewLoopStart(iframe, 2);
    setPreviewLoopStart(iframe, 2);
    setPreviewLoopStart(iframe, null);
    await vi.waitFor(() => expect(seen).toEqual([2, null]));
  });

  it("waits for the runtime's seek to paint, and settles anyway when no runtime answers", async () => {
    const { iframe, handed } = servedFrame(() => ({ waited: true }));
    await previewSeekPainted(iframe);
    expect(handed).toHaveBeenCalledWith("wait-for-seek", {});
    await expect(previewSeekPainted(opaqueFrame().iframe, 20)).resolves.toBeUndefined();
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
